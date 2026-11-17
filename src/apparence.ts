// Moteur d'apparence : couleur par maquette, transparence, surlignages (recherche,
// clashs, quantitatifs, IA…), sélection, et visibilité des éléments (filtres,
// isolement). Une seule source de vérité pour éviter que les outils se marchent dessus.
import * as THREE from "three";
import { rafraichir, type MaterialDefinition } from "./noyau";
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
let selection: { modele: string; id: number } | null = null;

const FANTOME = 0.18;
const TRANSPARENT = 0.2;

function focusActif() {
  return couches.some((c) => c.focus && [...c.ids.values()].some((s) => s.size > 0));
}

function styleBase(m: Maquette): MaterialDefinition | undefined {
  const teinte = reglages.couleurs ? m.couleur : new THREE.Color("#c9ced6");
  if (focusActif()) {
    return { color: teinte, opacity: FANTOME, transparent: true, renderedFaces: 0 } as MaterialDefinition;
  }
  if (m.transparente) {
    return { color: teinte, opacity: TRANSPARENT, transparent: true, renderedFaces: 0 } as MaterialDefinition;
  }
  if (reglages.couleurs) return { color: m.couleur, opacity: 1, transparent: false, renderedFaces: 0 } as MaterialDefinition;
  return undefined;
}

function styleDe(m: Maquette, id: number) {
  if (selection && selection.modele === m.id && selection.id === id) return STYLES.selection;
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
  if (selection && selection.modele === m.id) await modele.highlight([selection.id], STYLES.selection);
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

export function selectionCourante() {
  return selection;
}

/** Change la sélection en ne retouchant que les deux éléments concernés. */
export function selectionner(nouvelle: { modele: string; id: number } | null) {
  return enchainer(async () => {
    const avant = selection;
    selection = nouvelle;
    for (const s of [avant, nouvelle]) {
      if (!s) continue;
      const m = maquettes.get(s.modele);
      if (!m) continue;
      const st = styleDe(m, s.id);
      if (st) await m.modele.highlight([s.id], st);
      else await m.modele.resetHighlight([s.id]);
    }
    await rafraichir();
  });
}

export function oublierMaquette(id: string) {
  for (const c of couches) c.ids.delete(id);
  masquesFiltre.delete(id);
  isolement?.delete(id);
  if (selection?.modele === id) selection = null;
}

// --- Visibilité des éléments -------------------------------------------------------

const masquesFiltre: Ids = new Map();
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

export function appliquerVisibilite() {
  return enchainer(async () => {
    for (const m of maquettes.values()) {
      tousIds.delete(m.id);
      const filtre = masquesFiltre.get(m.id);
      const garder = isolement ? (isolement.get(m.id) ?? new Set<number>()) : null;
      await m.modele.setVisible(undefined, true);
      if (garder) {
        const masques = (await idsAvecGeometrie(m)).filter((id) => !garder.has(id) || filtre?.has(id));
        if (masques.length) await m.modele.setVisible(masques, false);
      } else if (filtre && filtre.size) {
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
