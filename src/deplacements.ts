// Éléments déplacés (mode Modifier). Un élément déplacé est masqué dans sa maquette et
// redessiné à sa nouvelle place ; la maquette d'origine n'est jamais touchée. On peut
// donc revenir à l'original à tout moment, annuler, et enregistrer les déplacements
// à part (par identifiant IFC) dans le projet.
import * as THREE from "three";
import { directionDepuisIfc, directionVersIfc, monde, Signal, type MaterialDefinition } from "./noyau";
import { changement, maquettes, type Maquette } from "./registre";

type Ids = Map<string, Set<number>>;
/** Déplacements enregistrés : maquette → identifiant IFC → [x, y, z] en mètres (repère IFC). */
export type Donnees = Record<string, Record<string, [number, number, number]>>;

export const LIMITE_DEPLACES = 3000;
const EPSILON = 0.0005;

const table = new Map<string, Map<number, THREE.Vector3>>();
let apercu: { ids: Ids; v: THREE.Vector3 } | null = null;
let modifie = true;
/** Déplacements lus dans le projet dont la maquette n'est pas encore chargée. */
let enAttente: Donnees = {};

/** Émis quand les déplacements validés changent (pas pendant un aperçu). */
export const deplacementsModifies = new Signal();

let reappliquer: () => Promise<void> = async () => {};
/** Le moteur d'apparence se branche ici pour remettre la vue à jour après un changement. */
export function brancherApparence(f: () => Promise<void>) {
  reappliquer = f;
}

// --- État -----------------------------------------------------------------------------

export const vueModifiee = () => modifie;

/** Décalage affiché d'un élément (scène, mètres), aperçu compris ; null s'il est à sa place. */
export function decalageDe(mid: string, id: number): THREE.Vector3 | null {
  const base = modifie ? table.get(mid)?.get(id) : undefined;
  const enApercu = apercu?.ids.get(mid)?.has(id);
  if (!enApercu) return base ?? null;
  const v = apercu!.v.clone();
  if (base) v.add(base);
  return v;
}

/** Éléments redessinés ailleurs : à masquer dans leur maquette. */
export function deplacesDe(mid: string): Set<number> {
  const ids = new Set<number>(modifie ? (table.get(mid)?.keys() ?? []) : []);
  for (const id of apercu?.ids.get(mid) ?? []) ids.add(id);
  return ids;
}

export const nombreDeplaces = () => [...table.values()].reduce((n, c) => n + c.size, 0);

export function idsDeplaces(): Ids {
  const ids: Ids = new Map();
  for (const [mid, carte] of table) if (carte.size) ids.set(mid, new Set(carte.keys()));
  return ids;
}

/** Décalage validé d'un élément, en mètres dans le repère IFC (x est, y nord, z haut). */
export function decalageIfc(mid: string, id: number): [number, number, number] | null {
  const v = table.get(mid)?.get(id);
  return v ? directionVersIfc(v) : null;
}

// --- Historique -----------------------------------------------------------------------

type Pas = { mid: string; id: number; avant: THREE.Vector3 | null; apres: THREE.Vector3 | null }[];
const faits: Pas[] = [];
const defaits: Pas[] = [];

function poser(pas: Pas, sens: "avant" | "apres") {
  for (const p of pas) {
    const v = p[sens];
    if (v) {
      if (!table.has(p.mid)) table.set(p.mid, new Map());
      table.get(p.mid)!.set(p.id, v.clone());
    } else {
      table.get(p.mid)?.delete(p.id);
    }
  }
}

async function valider(pas: Pas) {
  if (!pas.length) return;
  poser(pas, "apres");
  faits.push(pas);
  if (faits.length > 100) faits.shift();
  defaits.length = 0;
  modifie = true;
  await reappliquer();
  deplacementsModifies.emit();
}

/** Déplace des éléments de v (scène, mètres), en plus de leur déplacement actuel. */
export async function deplacer(ids: Ids, v: THREE.Vector3) {
  apercu = null;
  const pas: Pas = [];
  for (const [mid, liste] of ids) {
    if (!maquettes.has(mid)) continue;
    for (const id of liste) {
      const avant = table.get(mid)?.get(id) ?? null;
      const apres = (avant?.clone() ?? new THREE.Vector3()).add(v);
      pas.push({ mid, id, avant: avant?.clone() ?? null, apres: apres.length() < EPSILON ? null : apres });
    }
  }
  const nouveaux = pas.filter((p) => !p.avant && p.apres).length;
  if (nombreDeplaces() + nouveaux > LIMITE_DEPLACES) {
    await reappliquer();
    throw new Error(`Pas plus de ${LIMITE_DEPLACES} éléments déplacés à la fois.`);
  }
  await valider(pas);
  return pas.length;
}

/** Remet des éléments à leur place d'origine ; sans argument, tous. */
export async function remettre(ids?: Ids) {
  apercu = null;
  const pas: Pas = [];
  for (const [mid, carte] of table) {
    for (const [id, v] of carte) {
      if (ids && !ids.get(mid)?.has(id)) continue;
      pas.push({ mid, id, avant: v.clone(), apres: null });
    }
  }
  await valider(pas);
  return pas.length;
}

export const peutAnnuler = () => faits.length > 0;
export const peutRetablir = () => defaits.length > 0;

export async function annuler() {
  const pas = faits.pop();
  if (!pas) return;
  apercu = null;
  poser(pas, "avant");
  defaits.push(pas);
  modifie = true;
  await reappliquer();
  deplacementsModifies.emit();
}

export async function retablir() {
  const pas = defaits.pop();
  if (!pas) return;
  apercu = null;
  poser(pas, "apres");
  faits.push(pas);
  modifie = true;
  await reappliquer();
  deplacementsModifies.emit();
}

/** Montre la maquette modifiée (true) ou l'originale (false), sans rien perdre. */
export async function definirVue(vueModifieeVoulue: boolean) {
  if (modifie === vueModifieeVoulue) return;
  modifie = vueModifieeVoulue;
  await reappliquer();
  deplacementsModifies.emit();
}

// --- Aperçu pendant la saisie ---------------------------------------------------------

let apercuEnCours: Promise<void> = Promise.resolve();
let apercuVoulu: { ids: Ids; v: THREE.Vector3 } | null = null;

/** Montre le déplacement en cours de saisie, sans le valider ; null pour l'abandonner. */
export function definirApercu(ids: Ids | null, v?: THREE.Vector3) {
  const memes =
    !!apercu && !!ids && apercu.ids.size === ids.size && [...ids].every(([m, s]) => apercu!.ids.get(m)?.size === s.size);
  apercuVoulu = ids && v && v.length() >= EPSILON ? { ids, v: v.clone() } : null;
  if (apercuVoulu && memes && surcouchesPretes(ids!)) {
    // Mêmes éléments : on ne fait que glisser ce qui est déjà dessiné.
    apercu = apercuVoulu;
    placer();
    apresApercu.emit();
    return apercuEnCours;
  }
  apercuEnCours = apercuEnCours.then(async () => {
    if (apercu === apercuVoulu) return;
    apercu = apercuVoulu;
    await reappliquer();
    apresApercu.emit();
  });
  return apercuEnCours;
}
/** Émis quand l'aperçu a bougé (pour redessiner le contour de la sélection). */
export const apresApercu = new Signal();

// --- Enregistrement -------------------------------------------------------------------

const arrondi = (n: number) => Math.round(n * 10000) / 10000;

/** Déplacements validés, par identifiant IFC, prêts à être enregistrés. */
export async function exporter(): Promise<Donnees> {
  const donnees: Donnees = {};
  for (const [mid, parGuid] of Object.entries(enAttente)) donnees[mid] = { ...parGuid };
  for (const [mid, carte] of table) {
    const m = maquettes.get(mid);
    if (!m) continue;
    delete donnees[mid];
    if (!carte.size) continue;
    const ids = [...carte.keys()];
    const guids = await m.modele.getGuidsByLocalIds(ids);
    const sortie: Record<string, [number, number, number]> = {};
    ids.forEach((id, i) => {
      const g = guids[i];
      if (!g) return;
      const [x, y, z] = directionVersIfc(carte.get(id)!);
      sortie[g] = [arrondi(x), arrondi(y), arrondi(z)];
    });
    if (Object.keys(sortie).length) donnees[mid] = sortie;
  }
  return donnees;
}

async function resoudre() {
  let change = false;
  for (const [mid, parGuid] of Object.entries(enAttente)) {
    const m = maquettes.get(mid);
    if (!m) continue;
    delete enAttente[mid];
    const guids = Object.keys(parGuid);
    if (!guids.length) continue;
    const ids = await m.modele.getLocalIdsByGuids(guids);
    const carte = new Map<number, THREE.Vector3>();
    guids.forEach((g, i) => {
      const id = ids[i];
      const d = parGuid[g];
      if (id === null || id === undefined || !Array.isArray(d)) return;
      const v = directionDepuisIfc(Number(d[0]) || 0, Number(d[1]) || 0, Number(d[2]) || 0);
      if (v.length() >= EPSILON) carte.set(id, v);
    });
    if (carte.size) {
      table.set(mid, carte);
      change = true;
    }
  }
  if (change) {
    await reappliquer();
    deplacementsModifies.emit();
  }
}

/** Remplace tous les déplacements par ceux lus dans le projet (ou rien). */
export async function importer(donnees: Donnees | null) {
  const avait = nombreDeplaces() > 0 || !!apercu;
  table.clear();
  apercu = null;
  faits.length = 0;
  defaits.length = 0;
  modifie = true;
  enAttente = {};
  for (const [mid, parGuid] of Object.entries(donnees ?? {})) {
    if (parGuid && typeof parGuid === "object") enAttente[mid] = { ...parGuid };
  }
  if (avait) await reappliquer();
  await resoudre();
  deplacementsModifies.emit();
}

changement.on(() => {
  // Une maquette retirée emporte ses déplacements ; une maquette arrivée reçoit les siens.
  for (const mid of [...table.keys()]) if (!maquettes.has(mid)) table.delete(mid);
  if (Object.keys(enAttente).some((mid) => maquettes.has(mid))) void resoudre();
});

// --- Dessin des éléments déplacés -----------------------------------------------------

type Surcouche = {
  groupe: THREE.Group;
  materiau: THREE.MeshLambertMaterial;
  base: { couleur: THREE.Color; opacite: number };
};
const racine = new THREE.Group();
racine.name = "elements-deplaces";
monde.scene.three.add(racine);
const surcouches = new Map<string, Surcouche>();
const cle = (mid: string, id: number) => `${mid}\u0000${id}`;

function surcouchesPretes(ids: Ids) {
  for (const [mid, liste] of ids) for (const id of liste) if (!surcouches.has(cle(mid, id))) return false;
  return true;
}

function liberer(c: string) {
  const s = surcouches.get(c);
  if (!s) return;
  racine.remove(s.groupe);
  for (const o of s.groupe.children) (o as THREE.Mesh).geometry.dispose();
  s.materiau.dispose();
  surcouches.delete(c);
}

async function construire(m: Maquette, ids: number[]) {
  const modele = m.modele;
  modele.object.updateMatrixWorld(true);
  const mondeModele = modele.object.matrixWorld;
  const PAQUET = 200;
  for (let i = 0; i < ids.length; i += PAQUET) {
    const lot = ids.slice(i, i + PAQUET);
    const [geos, definitions] = await Promise.all([
      modele.getItemsGeometry(lot),
      modele.getItemsMaterialDefinition(lot).catch(() => []),
    ]);
    const baseDe = new Map<number, { couleur: THREE.Color; opacite: number }>();
    for (const d of definitions) {
      const c = d.definition.color as unknown as { r: number; g: number; b: number };
      const base = {
        couleur: new THREE.Color(c?.r ?? 0.8, c?.g ?? 0.8, c?.b ?? 0.8),
        opacite: d.definition.transparent ? (d.definition.opacity ?? 1) : 1,
      };
      for (const id of d.localIds) if (!baseDe.has(id)) baseDe.set(id, base);
    }
    lot.forEach((id, k) => {
      const groupe = new THREE.Group();
      const base = baseDe.get(id) ?? { couleur: new THREE.Color("#c9ced6"), opacite: 1 };
      const materiau = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true });
      for (const md of geos[k] ?? []) {
        if (!md.positions || !md.indices || md.positions.length < 9) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(md.positions), 3));
        g.setIndex(new THREE.BufferAttribute(Uint32Array.from(md.indices), 1));
        g.applyMatrix4(mondeModele.clone().multiply(md.transform));
        const maille = new THREE.Mesh(g, materiau);
        maille.userData = { mid: m.id, id };
        groupe.add(maille);
      }
      groupe.userData = { mid: m.id, id };
      racine.add(groupe);
      surcouches.set(cle(m.id, id), { groupe, materiau, base });
    });
  }
}

function placer() {
  for (const s of surcouches.values()) {
    const { mid, id } = s.groupe.userData as { mid: string; id: number };
    const v = decalageDe(mid, id);
    if (v) s.groupe.position.copy(v);
  }
}

export type EtatElement = { visible: boolean; style?: MaterialDefinition };

/** Met le dessin des éléments déplacés en accord avec l'apparence et la visibilité. */
export async function synchroniser(etatDe: (m: Maquette, id: number) => EtatElement) {
  const voulus = new Set<string>();
  for (const m of maquettes.values()) {
    const ids = [...deplacesDe(m.id)];
    const manquants = ids.filter((id) => !surcouches.has(cle(m.id, id)));
    for (const id of ids) voulus.add(cle(m.id, id));
    if (manquants.length) await construire(m, manquants);
  }
  for (const c of [...surcouches.keys()]) if (!voulus.has(c)) liberer(c);
  for (const s of surcouches.values()) {
    const { mid, id } = s.groupe.userData as { mid: string; id: number };
    const m = maquettes.get(mid);
    if (!m) continue;
    const etat = etatDe(m, id);
    s.groupe.userData.affiche = etat.visible;
    const st = etat.style;
    const couleur = (st?.color as THREE.Color | undefined) ?? s.base.couleur;
    const opacite = st ? (st.transparent ? (st.opacity ?? 1) : 1) : s.base.opacite;
    s.materiau.color.copy(couleur);
    s.materiau.opacity = opacite;
    s.materiau.transparent = opacite < 1;
    s.materiau.depthWrite = opacite >= 1;
    s.materiau.needsUpdate = true;
  }
  placer();
}

monde.renderer!.onBeforeUpdate.add(() => {
  if (!surcouches.size) return;
  const plans = monde.renderer!.clippingPlanes;
  for (const s of surcouches.values()) {
    const m = maquettes.get(s.groupe.userData.mid);
    s.groupe.visible = !!s.groupe.userData.affiche && !!m?.modele.object.visible;
    if (s.materiau.clippingPlanes !== plans) s.materiau.clippingPlanes = plans;
  }
});

// --- Boîtes et visée ------------------------------------------------------------------

/** Boîtes englobantes (scène) d'éléments, déplacements compris. */
export async function boitesDe(m: Maquette, ids: number[]) {
  const boites = await m.modele.getBoxes(ids);
  if (deplacesDe(m.id).size) {
    ids.forEach((id, i) => {
      const v = decalageDe(m.id, id);
      if (v && boites[i] && !boites[i].isEmpty()) boites[i].translate(v);
    });
  }
  return boites;
}

/** Boîte englobante commune (scène) d'éléments d'une maquette, déplacements compris. */
export async function boiteFusion(m: Maquette, ids: number[]) {
  const deplaces = deplacesDe(m.id);
  if (!ids.some((id) => deplaces.has(id))) return m.modele.getMergedBox(ids);
  const boite = new THREE.Box3();
  for (const b of await boitesDe(m, ids)) if (b && !b.isEmpty()) boite.union(b);
  return boite;
}

const rayon = new THREE.Raycaster();

/**
 * Complète un tir dans les maquettes : si un élément déplacé est touché avant, c'est
 * lui qui est rendu, sous la même forme (point, normale, localId, fragments.modelId).
 */
export function completerTir(hit: any, position: THREE.Vector2): any {
  if (!surcouches.size) return hit;
  const cibles: THREE.Object3D[] = [];
  for (const s of surcouches.values()) if (s.groupe.visible) cibles.push(s.groupe);
  if (!cibles.length) return hit;
  monde.camera.three.updateMatrixWorld();
  rayon.setFromCamera(position, monde.camera.three);
  const touche = rayon.intersectObjects(cibles, true)[0];
  if (!touche) return hit;
  if (hit?.point) {
    const dMaquette = (hit.point as THREE.Vector3).clone().sub(rayon.ray.origin).dot(rayon.ray.direction);
    const dSurcouche = touche.point.clone().sub(rayon.ray.origin).dot(rayon.ray.direction);
    if (dMaquette <= dSurcouche) return hit;
  }
  const normale = touche.face
    ? touche.face.normal.clone().transformDirection(touche.object.matrixWorld)
    : rayon.ray.direction.clone().negate();
  if (normale.dot(rayon.ray.direction) > 0) normale.negate();
  const { mid, id } = touche.object.userData as { mid: string; id: number };
  return { point: touche.point.clone(), normal: normale, localId: id, fragments: { modelId: mid }, deplace: true };
}
