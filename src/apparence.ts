// Moteur d'apparence : couleur par maquette, transparence, surlignages (recherche,
// clashs, quantitatifs, IA…), sélection, et visibilité des éléments (filtres,
// isolement). Une seule source de vérité pour éviter que les outils se marchent dessus.
import * as THREE from "three";
import * as OBF from "@thatopen/components-front";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { composants, monde, rafraichir, reglerPost, Signal, type MaterialDefinition } from "./noyau";
import { maquettes, reglages, type Maquette } from "./registre";
import {
  apresApercu,
  boiteFusion,
  brancherApparence,
  decalageDe,
  deplacesDe,
  synchroniser,
} from "./deplacements";

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

// La sélection se voit par ses arêtes jaune néon : vives là où on les voit, estompées
// à travers ce qui passe devant. L'élément garde sa couleur (et celle qu'on lui donne).
// Au-delà de ARETES_MAX éléments, un contour de silhouette prend le relais (plus léger).
const ARETES_MAX = 600;
const NEON = 0xe8ff1a;
const traitVu = new LineMaterial({ color: NEON, linewidth: 2.6, depthTest: true });
const traitCache = new LineMaterial({ color: NEON, linewidth: 1.4, depthTest: false, transparent: true, opacity: 0.3 });
const aretes = new THREE.Group();
aretes.name = "aretes-selection";
monde.scene.three.add(aretes);
const tailleEcran = new THREE.Vector2();
monde.renderer!.onBeforeUpdate.add(() => {
  if (!aretes.children.length) return;
  monde.renderer!.three.getSize(tailleEcran);
  if (!traitVu.resolution.equals(tailleEcran)) {
    traitVu.resolution.copy(tailleEcran);
    traitCache.resolution.copy(tailleEcran);
  }
  // Les coupes s'appliquent aussi aux arêtes de la sélection.
  const plans = monde.renderer!.clippingPlanes;
  if (traitVu.clippingPlanes !== plans) traitVu.clippingPlanes = traitCache.clippingPlanes = plans;
  // Une maquette masquée cache aussi ses arêtes.
  aretes.visible = [...selection.keys()].some((mid) => maquettes.get(mid)?.modele.object.visible);
});
let tourAretes = 0;

function viderAretes() {
  for (const o of [...aretes.children]) {
    aretes.remove(o);
    (o as LineSegments2).geometry.dispose();
  }
}

/** Arêtes des éléments sélectionnés (géométrie lue dans les maquettes). */
async function dessinerAretes(tour: number) {
  const points: number[] = [];
  const a = new THREE.Vector3();
  for (const [mid, ids] of selection) {
    const m = maquettes.get(mid);
    if (!m || !m.modele.object.visible) continue;
    const geos = await m.modele.getItemsGeometry([...ids]);
    if (tour !== tourAretes) return false;
    if (geos.length !== ids.size) continue;
    m.modele.object.updateMatrixWorld();
    const idsListe = [...ids];
    for (let k = 0; k < geos.length; k++) {
      const decalage = decalageDe(mid, idsListe[k]);
      for (const md of geos[k]) {
        if (!md.positions || !md.indices) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(md.positions), 3));
        g.setIndex(new THREE.BufferAttribute(md.indices, 1));
        const bords = new THREE.EdgesGeometry(g, 25);
        // La matrice arrive du worker sous forme d'objet simple.
        const brute = md.transform as unknown as { elements?: number[] } | number[];
        const matrice = new THREE.Matrix4()
          .fromArray(Array.isArray(brute) ? brute : (brute.elements ?? new THREE.Matrix4().elements))
          .premultiply(m.modele.object.matrixWorld);
        if (decalage) matrice.premultiply(new THREE.Matrix4().makeTranslation(decalage.x, decalage.y, decalage.z));
        const pos = bords.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          a.fromBufferAttribute(pos, i).applyMatrix4(matrice);
          points.push(a.x, a.y, a.z);
        }
        g.dispose();
        bords.dispose();
      }
    }
  }
  if (tour !== tourAretes) return false;
  viderAretes();
  if (!points.length) return true;
  const geo = new LineSegmentsGeometry().setPositions(points);
  const cachees = new LineSegments2(geo, traitCache);
  cachees.renderOrder = 998;
  const vues = new LineSegments2(geo, traitVu);
  vues.renderOrder = 999;
  aretes.add(cachees, vues);
  return true;
}

let contour: OBF.Outliner | null = null;

async function majContour() {
  const tour = ++tourAretes;
  const n = [...selection.values()].reduce((t, ids) => t + ids.size, 0);
  contour?.clean();
  if (n === 0) {
    viderAretes();
    reglerPost("selection", false);
    return;
  }
  if (n <= ARETES_MAX) {
    reglerPost("selection", false);
    try {
      if (await dessinerAretes(tour)) return;
    } catch (e) {
      console.warn("Arêtes de sélection", e);
    }
    if (tour !== tourAretes) return;
  }
  // Grande sélection : contour de silhouette (dans la post-production).
  viderAretes();
  reglerPost("selection", true);
  if (!contour) {
    contour = composants.get(OBF.Outliner);
    contour.world = monde;
    contour.color = new THREE.Color("#e8ff1a");
    contour.thickness = 2;
    contour.fillColor = new THREE.Color("#f0ff3d");
    contour.fillOpacity = 0.12;
    contour.enabled = true;
  }
  const carte: Record<string, Set<number>> = {};
  for (const [mid, ids] of selection) carte[mid] = new Set(ids);
  await contour.addItems(carte);
}
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

// --- Couleurs et opacités choisies à la main, élément par élément ------------------

/** Teinte d'un élément ; sans couleur, il garde celle de sa maquette. */
export type Teinte = { hex?: string; opacite: number };
const perso = new Map<string, Map<number, Teinte>>();
const CLE_PERSO = "nexbim-apparences";
const GRIS = "#c9ced6";
const stylesPerso = new Map<string, MaterialDefinition>();
/** Émis quand des couleurs ou opacités d'éléments changent. */
export const persoModifiee = new Signal();

function stylePerso(t: Teinte, m: Maquette) {
  const hex = t.hex ?? (reglages.couleurs ? m.hex : GRIS);
  const cle = `${hex}|${t.opacite}`;
  let st = stylesPerso.get(cle);
  if (!st) {
    st = style(hex, t.opacite);
    stylesPerso.set(cle, st);
  }
  return st;
}

try {
  const brut = JSON.parse(localStorage.getItem(CLE_PERSO) ?? "{}") as Record<string, Record<string, number[]>>;
  for (const [mid, groupes] of Object.entries(brut)) {
    const carte = new Map<number, Teinte>();
    for (const [cle, ids] of Object.entries(groupes)) {
      const [hex, op] = cle.split("|");
      for (const id of ids) carte.set(id, { hex: hex || undefined, opacite: Number(op) || 1 });
    }
    perso.set(mid, carte);
  }
} catch {
  // Mémoire locale illisible : on repart sans couleurs personnalisées.
}

function sauverPerso() {
  const brut: Record<string, Record<string, number[]>> = {};
  for (const [mid, carte] of perso) {
    if (!carte.size) continue;
    const groupes: Record<string, number[]> = {};
    for (const [id, t] of carte) (groupes[`${t.hex ?? ""}|${t.opacite}`] ??= []).push(id);
    brut[mid] = groupes;
  }
  try {
    localStorage.setItem(CLE_PERSO, JSON.stringify(brut));
  } catch {
    // Gardé pour la session seulement.
  }
}

/** Change la couleur et/ou l'opacité d'éléments ; null leur rend leur apparence d'origine. */
export function definirTeinte(ids: Ids, changement: Partial<Teinte> | null) {
  for (const [mid, liste] of ids) {
    let carte = perso.get(mid);
    if (!carte) {
      carte = new Map();
      perso.set(mid, carte);
    }
    for (const id of liste) {
      const t: Teinte | null = changement ? { opacite: 1, ...carte.get(id), ...changement } : null;
      if (!t || (t.hex === undefined && t.opacite >= 1)) carte.delete(id);
      else carte.set(id, t);
    }
  }
  sauverPerso();
  persoModifiee.emit();
  return appliquerApparence([...ids.keys()]);
}

/** Teinte du premier élément personnalisé parmi ceux donnés. */
export function teinteDe(ids: Ids): Teinte | null {
  for (const [mid, liste] of ids) for (const id of liste) {
    const t = perso.get(mid)?.get(id);
    if (t) return t;
  }
  return null;
}

export const nombrePerso = () => [...perso.values()].reduce((n, c) => n + c.size, 0);

/** Rend leur apparence d'origine à tous les éléments recolorés. */
export function effacerPerso() {
  const touchees = [...perso.keys()];
  perso.clear();
  sauverPerso();
  persoModifiee.emit();
  return appliquerApparence(touchees);
}

function styleDe(m: Maquette, id: number) {
  for (let i = couches.length - 1; i >= 0; i--) {
    if (couches[i].ids.get(m.id)?.has(id)) return couches[i].style;
  }
  if (!focusActif()) {
    const t = perso.get(m.id)?.get(id);
    if (t) return stylePerso(t, m);
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
  const carte = perso.get(m.id);
  if (carte?.size && !focusActif()) {
    const parStyle = new Map<MaterialDefinition, number[]>();
    for (const [id, t] of carte) {
      const st = stylePerso(t, m);
      if (!parStyle.has(st)) parStyle.set(st, []);
      parStyle.get(st)!.push(id);
    }
    for (const [st, liste] of parStyle) await modele.highlight(liste, st);
  }
  for (const c of couches) {
    const ids = c.ids.get(m.id);
    if (ids && ids.size) await modele.highlight([...ids], c.style);
  }
}

/** Réapplique toute l'apparence (après un changement de couleur, de couche…). */
export function appliquerApparence(ids?: string[]) {
  return enchainer(async () => {
    for (const m of maquettes.values()) {
      if (ids && !ids.includes(m.id)) continue;
      await appliquerModele(m);
    }
    await synchroniserDeplaces();
    await rafraichir();
  });
}

// --- Éléments déplacés : ils suivent l'apparence et la visibilité des autres -----------

function estAffiche(m: Maquette, id: number) {
  if (masquesFiltre.get(m.id)?.has(id) || masquesManuels.get(m.id)?.has(id)) return false;
  return !isolement || !!isolement.get(m.id)?.has(id);
}

const synchroniserDeplaces = () =>
  synchroniser((m, id) => ({ visible: estAffiche(m, id), style: styleDe(m, id) }));

brancherApparence(async () => {
  await appliquerVisibilite();
  await enchainer(async () => {
    await majContour();
    await rafraichir();
  });
});
apresApercu.on(() => {
  void enchainer(async () => {
    await majContour();
  });
});

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
    await majContour();
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
      // Les éléments déplacés sont redessinés à part : on les retire de leur maquette.
      const filtre = new Set([
        ...(masquesFiltre.get(m.id) ?? []),
        ...(masquesManuels.get(m.id) ?? []),
        ...deplacesDe(m.id),
      ]);
      const garder = isolement ? (isolement.get(m.id) ?? new Set<number>()) : null;
      await m.modele.setVisible(undefined, true);
      if (garder) {
        const masques = (await idsAvecGeometrie(m)).filter((id) => !garder.has(id) || filtre.has(id));
        if (masques.length) await m.modele.setVisible(masques, false);
      } else if (filtre.size) {
        await m.modele.setVisible([...filtre], false);
      }
    }
    await synchroniserDeplaces();
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
    boite.union(await boiteFusion(m, [...set]));
  }
  return boite;
}

export const idsDe = (modele: string, ...liste: number[]): Ids => new Map([[modele, new Set(liste)]]);
