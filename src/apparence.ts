// Moteur d'apparence : couleur par maquette, transparence, surlignages (recherche,
// clashs, quantitatifs, IA…), sélection, et visibilité des éléments (filtres,
// isolement). Une seule source de vérité pour éviter que les outils se marchent dessus.
import * as THREE from "three";
import { rafraichir, Signal, type MaterialDefinition } from "./noyau";
import { maquettes, reglages, type Maquette } from "./registre";

export type Ids = Map<string, Set<number>>;

const style = (hex: string, opacite = 1): MaterialDefinition =>
  ({
    color: new THREE.Color(hex),
    opacity: opacite,
    transparent: opacite < 1,
    renderedFaces: 0,
  }) as MaterialDefinition;

export const STYLES = {
  selection: style("#ff8a1f"),
  recherche: style("#22d3ee"),
  clashA: style("#ef4444"),
  clashB: style("#22c55e"),
  quantites: style("#e879f9"),
  ia: style("#a78bfa"),
  remarque: style("#facc15"),
};

type Couche = { nom: string; style: MaterialDefinition; ids: Ids; focus: boolean };
const couches: Couche[] = [];
const selection: Ids = new Map();
/** Émis quand la sélection change. */
export const selectionModifiee = new Signal();
/** Émis quand la liste des éléments masqués à la main change. */
export const masquesModifies = new Signal();

const FANTOME = 0.18;

function focusActif() {
  return couches.some((c) => c.focus && [...c.ids.values()].some((s) => s.size > 0));
}

function styleBase(m: Maquette): MaterialDefinition | undefined {
  const teinte = reglages.couleurs ? m.couleur : new THREE.Color("#c9ced6");
  if (focusActif()) {
    return { color: teinte, opacity: FANTOME, transparent: true, renderedFaces: 0 } as MaterialDefinition;
  }
  if (m.transparente) {
    return { color: teinte, opacity: m.opacite, transparent: true, renderedFaces: 0 } as MaterialDefinition;
  }
  if (reglages.couleurs) return { color: m.couleur, opacity: 1, transparent: false, renderedFaces: 0 } as MaterialDefinition;
  return undefined;
}

function styleDe(m: Maquette, id: number) {
  if (selection.get(m.id)?.has(id)) return STYLES.selection;
  for (let i = couches.length - 1; i >= 0; i--) {
    if (couches[i].ids.get(m.id)?.has(id)) return couches[i].style;
  }
  return styleBase(m);
}

let file: Promise<void> = Promise.resolve();
/** Exécute les mises à jour d'apparence l'une après l'autre. */
function enchainer(action: () => Promise<void>) {
  file = file.then(action).catch((e) => console.error(e));
  return file;
}

async function appliquerModele(m: Maquette) {
  const modele = m.modele;
  await modele.resetHighlight();
  const base = styleBase(m);
  if (base) await modele.highlight(undefined, base);
  for (const c of couches) {
    const ids = c.ids.get(m.id);
    if (ids && ids.size) await modele.highlight([...ids], c.style);
  }
  const choisis = selection.get(m.id);
  if (choisis && choisis.size) await modele.highlight([...choisis], STYLES.selection);
}

/** Réapplique toute l'apparence (après un changement de couleur, de couche…). */
export function appliquerApparence(ids?: string[]) {
  return enchainer(async () => {
    for (const m of maquettes.values()) {
      if (ids && !ids.includes(m.id)) continue;
      await appliquerModele(m);
    }
    await rafraichir();
  });
}

/** Définit (ou retire avec null) une couche de surlignage. */
export function definirCouche(nom: string, styleCouche: MaterialDefinition, ids: Ids | null, focus = false) {
  const i = couches.findIndex((c) => c.nom === nom);
  if (i >= 0) couches.splice(i, 1);
  if (ids && [...ids.values()].some((s) => s.size)) couches.push({ nom, style: styleCouche, ids, focus });
  return appliquerApparence();
}

export function retirerCouche(nom: string) {
  if (!couches.some((c) => c.nom === nom)) return Promise.resolve();
  return definirCouche(nom, STYLES.selection, null);
}

export function aCouche(nom: string) {
  return couches.some((c) => c.nom === nom);
}

/** L'élément sélectionné quand il n'y en a qu'un. */
export function selectionCourante() {
  if (nombreSelection() !== 1) return null;
  for (const [modele, ids] of selection) for (const id of ids) return { modele, id };
  return null;
}

export const nombreSelection = () => [...selection.values()].reduce((n, s) => n + s.size, 0);

export function selectionIds(): Ids {
  const copie: Ids = new Map();
  for (const [k, v] of selection) if (v.size) copie.set(k, new Set(v));
  return copie;
}

/** Remplace la sélection en ne retouchant que les éléments qui changent. */
export function definirSelection(nouvelle: Ids) {
  return enchainer(async () => {
    const change: Ids = new Map();
    const noter = (mid: string, id: number) => {
      if (!change.has(mid)) change.set(mid, new Set());
      change.get(mid)!.add(id);
    };
    for (const [mid, ids] of selection) for (const id of ids) if (!nouvelle.get(mid)?.has(id)) noter(mid, id);
    for (const [mid, ids] of nouvelle) for (const id of ids) if (!selection.get(mid)?.has(id)) noter(mid, id);
    selection.clear();
    for (const [mid, ids] of nouvelle) if (ids.size && maquettes.has(mid)) selection.set(mid, new Set(ids));
    if (change.size === 0) return;

    for (const [mid, ids] of change) {
      const m = maquettes.get(mid);
      if (!m) continue;
      const parStyle = new Map<MaterialDefinition | undefined, number[]>();
      for (const id of ids) {
        const st = styleDe(m, id);
        if (!parStyle.has(st)) parStyle.set(st, []);
        parStyle.get(st)!.push(id);
      }
      for (const [st, liste] of parStyle) {
        if (st) await m.modele.highlight(liste, st);
        else await m.modele.resetHighlight(liste);
      }
    }
    await rafraichir();
    selectionModifiee.emit();
  });
}

export function selectionner(nouvelle: { modele: string; id: number } | null) {
  return definirSelection(nouvelle ? idsDe(nouvelle.modele, nouvelle.id) : new Map());
}

/** Ajoute l'élément à la sélection, ou l'en retire s'il y est déjà. */
export function basculerSelection(modele: string, id: number) {
  const suivante = selectionIds();
  const ids = suivante.get(modele) ?? new Set<number>();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  suivante.set(modele, ids);
  return definirSelection(suivante);
}

export function oublierMaquette(id: string) {
  for (const c of couches) c.ids.delete(id);
  masquesFiltre.delete(id);
  isolement?.delete(id);
  if (selection.delete(id)) selectionModifiee.emit();
  if (masquesManuels.delete(id)) masquesModifies.emit();
}

// --- Visibilité des éléments -------------------------------------------------------

const masquesFiltre: Ids = new Map();
const masquesManuels: Ids = new Map();
let isolement: Ids | null = null;
const tousIds = new Map<string, Promise<number[]>>();

function idsAvecGeometrie(m: Maquette) {
  let p = tousIds.get(m.id);
  if (!p) {
    p = m.modele.getItemsIdsWithGeometry();
    tousIds.set(m.id, p);
  }
  return p;
}

export function definirFiltre(masques: Ids) {
  masquesFiltre.clear();
  for (const [k, v] of masques) masquesFiltre.set(k, v);
  return appliquerVisibilite();
}

export function definirIsolement(ids: Ids | null) {
  isolement = ids;
  return appliquerVisibilite();
}

export const isolementActif = () => isolement !== null;

/** Masque des éléments à la main (touche H). */
export function masquer(ids: Ids) {
  for (const [mid, liste] of ids) {
    if (!masquesManuels.has(mid)) masquesManuels.set(mid, new Set());
    for (const id of liste) masquesManuels.get(mid)!.add(id);
  }
  masquesModifies.emit();
  return appliquerVisibilite();
}

/** Réaffiche des éléments masqués à la main ; sans argument, tous. */
export function reafficher(ids?: Ids) {
  if (!ids) masquesManuels.clear();
  else for (const [mid, liste] of ids) for (const id of liste) masquesManuels.get(mid)?.delete(id);
  masquesModifies.emit();
  return appliquerVisibilite();
}

export function masquesIds(): Ids {
  const copie: Ids = new Map();
  for (const [k, v] of masquesManuels) if (v.size) copie.set(k, new Set(v));
  return copie;
}

export const nombreMasques = () => [...masquesManuels.values()].reduce((n, s) => n + s.size, 0);

/** Identifiants des éléments actuellement affichés d'une maquette. */
export async function affichesDe(m: Maquette) {
  const filtre = masquesFiltre.get(m.id);
  const manuel = masquesManuels.get(m.id);
  const garder = isolement ? (isolement.get(m.id) ?? new Set<number>()) : null;
  return (await idsAvecGeometrie(m)).filter(
    (id) => !filtre?.has(id) && !manuel?.has(id) && (!garder || garder.has(id)),
  );
}

export function appliquerVisibilite() {
  return enchainer(async () => {
    for (const m of maquettes.values()) {
      tousIds.delete(m.id);
      const filtre = new Set([...(masquesFiltre.get(m.id) ?? []), ...(masquesManuels.get(m.id) ?? [])]);
      const garder = isolement ? (isolement.get(m.id) ?? new Set<number>()) : null;
      await m.modele.setVisible(undefined, true);
      if (garder) {
        const masques = (await idsAvecGeometrie(m)).filter((id) => !garder.has(id) || filtre.has(id));
        if (masques.length) await m.modele.setVisible(masques, false);
      } else if (filtre.size) {
        await m.modele.setVisible([...filtre], false);
      }
    }
    await rafraichir();
  });
}

export function filtreActif() {
  return [...masquesFiltre.values()].some((s) => s.size > 0);
}

/** Boîte englobante (scène) d'éléments, toutes maquettes confondues. */
export async function boiteDe(ids: Ids) {
  const boite = new THREE.Box3();
  for (const [mid, set] of ids) {
    const m = maquettes.get(mid);
    if (!m || !set.size) continue;
    boite.union(await m.modele.getMergedBox([...set]));
  }
  return boite;
}

export const idsDe = (modele: string, ...liste: number[]): Ids => new Map([[modele, new Set(liste)]]);
