// Noyau partagé : scène 3D, moteur de maquettes, petits utilitaires d'interface.
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import type * as FRAGS from "@thatopen/fragments";
import urlOuvrier from "@thatopen/fragments/worker?url";

export type Modele = FRAGS.FragmentsModel;
export type MaterialDefinition = FRAGS.MaterialDefinition;

export const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/** Crée un élément HTML avec une classe et un texte. */
export function cree<K extends keyof HTMLElementTagNameMap>(
  balise: K,
  classe = "",
  texte?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(balise);
  if (classe) n.className = classe;
  if (texte !== undefined) n.textContent = texte;
  return n;
}

export function bouton(classe: string, texte: string, action: () => void, titre?: string) {
  const b = cree("button", classe, texte);
  b.type = "button";
  if (titre) {
    b.title = titre;
    b.setAttribute("aria-label", titre);
  }
  b.addEventListener("click", action);
  return b;
}

// --- Scène ---------------------------------------------------------------------

export const composants = new OBC.Components();
export const monde = composants
  .get(OBC.Worlds)
  .create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBF.PostproductionRenderer>();

monde.scene = new OBC.SimpleScene(composants);
monde.scene.setup();
// Fond gris anthracite : moins dur que le noir, les maquettes claires ressortent.
monde.scene.three.background = new THREE.Color("#262b32");
monde.renderer = new OBF.PostproductionRenderer(composants, el("scene"));
monde.camera = new OBC.OrthoPerspectiveCamera(composants);
composants.init();

export const grille = composants.get(OBC.Grids).create(monde);
grille.config.color = new THREE.Color("#2a323d");
// Pas de quadrillage au sol : il chargeait la vue sans rien apporter.
grille.visible = false;

export const fragments = composants.get(OBC.FragmentsManager);
fragments.init(urlOuvrier);
monde.camera.controls.addEventListener("update", () => fragments.core.update());

// --- Voir à travers les objets proches ------------------------------------------------
// Les surfaces à moins de « distance » mètres de la caméra sont dessinées en trame
// légère (un pixel sur n est laissé vide) : on devine ce qu'il y a derrière, par
// exemple un tuyau qui traverse une poutre. Plus on est près, plus c'est transparent ;
// au-delà de la distance, tout reste plein. Aucun tri ni recalcul : c'est le dessin
// de chaque pixel qui décide, donc ça suit la caméra sans ralentir.
const proche = { uProche: { value: 0 }, uProcheForce: { value: 0.45 } };
const reglageProche = { actif: false, distance: 4, force: 0.45 };

/** Ajoute l'effet « objets proches » à un matériau (maquettes et éléments déplacés). */
export function brancherProche(materiau: THREE.Material) {
  const m = materiau as THREE.Material & { __proche?: boolean };
  if (m.__proche) return;
  m.__proche = true;
  const avant = m.onBeforeCompile;
  const cleAvant = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    avant?.call(m, shader, renderer);
    if (!shader.vertexShader.includes("#include <project_vertex>")) return;
    if (!shader.fragmentShader.includes("#include <clipping_planes_fragment>")) return;
    shader.uniforms.uProche = proche.uProche;
    shader.uniforms.uProcheForce = proche.uProcheForce;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying float vProcheZ;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vProcheZ = -mvPosition.z;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uProche;\nuniform float uProcheForce;\nvarying float vProcheZ;\nvoid main() {")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
  if (uProche > 0.0 && vProcheZ < uProche) {
    float procheF = uProcheForce * (1.0 - smoothstep(0.55, 1.0, vProcheZ / uProche));
    float procheT = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    if (procheT < procheF) discard;
  }`,
      );
  };
  m.customProgramCacheKey = () => `${cleAvant ? cleAvant.call(m) : ""}|proche`;
  m.needsUpdate = true;
}

function majProche() {
  // En vue orthogonale, la distance à la caméra ne veut rien dire : effet coupé.
  const ortho = monde.camera.projection.current === "Orthographic";
  proche.uProche.value = reglageProche.actif && !ortho ? reglageProche.distance : 0;
  proche.uProcheForce.value = reglageProche.force;
  void fragments.core.update(true);
}

/** Règle l'effet « voir à travers les objets proches » (distance en mètres, force de 0 à 1). */
export function reglerProche(r: { actif: boolean; distance: number; force: number }) {
  Object.assign(reglageProche, r);
  majProche();
}

// Évite le scintillement entre faces superposées.
fragments.core.models.materials.list.onItemSet.add(({ value: materiau }) => {
  const m = materiau as any;
  if (!m.isLodMaterial) {
    m.polygonOffset = true;
    m.polygonOffsetUnits = 1;
    m.polygonOffsetFactor = Math.random();
    brancherProche(m);
  }
});

export const lanceur = composants.get(OBC.Raycasters).get(monde);

export function rafraichir() {
  // La mise à jour peut ne se terminer qu'à l'image suivante (ou jamais, onglet en
  // arrière-plan) : on ne fait pas attendre l'interface plus d'un instant.
  return Promise.race([
    fragments.core.update(true),
    new Promise<void>((r) => setTimeout(r, 350)),
  ]) as Promise<void>;
}

/**
 * Sur téléphone, les panneaux du bas (outil, fiche) cachent une partie de la vue :
 * on décale le point visé pour qu'il reste au centre de la zone encore visible.
 */
// --- Post-production (arêtes, ombres, contour de sélection) ------------------------
// Allumée seulement quand un outil en a besoin : elle coûte un peu sur les petits appareils.
const besoinsPost = new Set<string>();
let aspectStyles: OBF.PostproductionAspect | null = null;

/** Déclare (ou retire) un besoin de post-production ; « styles » fixe aussi l'aspect. */
function majCameraPost() {
  const post = monde.renderer!.postproduction as unknown as {
    updateCamera?: () => void;
    _glossPass?: { renderCamera: THREE.Camera };
    _simpleOutlinePass?: { camera?: THREE.Camera; renderCamera?: THREE.Camera };
  };
  try {
    post.updateCamera?.();
    if (post._glossPass) post._glossPass.renderCamera = monde.camera.three;
  } catch {
    // Post-production pas encore prête : elle prendra la bonne caméra à sa création.
  }
}

export function reglerPost(raison: string, oui: boolean, aspect?: OBF.PostproductionAspect | null) {
  if (aspect !== undefined) aspectStyles = aspect;
  if (oui) besoinsPost.add(raison);
  else besoinsPost.delete(raison);
  const post = monde.renderer!.postproduction;
  const actif = besoinsPost.size > 0;
  if (post.enabled !== actif) post.enabled = actif;
  if (actif) post.style = aspectStyles ?? OBF.PostproductionAspect.COLOR;
  if (actif) majCameraPost();
  return post;
}

/** Décalage vertical de mise en page en cours (panneau ouvert en bas sur téléphone). */
let decalageMise = 0;

/**
 * Le pivot de rotation posé sous le doigt (pivot.ts) déplace la cible de la caméra et
 * la compense par un décalage. Avant un cadrage, on remet la cible dans l'axe de la vue,
 * sans bouger l'image, en gardant le décalage de mise en page.
 */
export function recentrerPivot(rayon?: number) {
  const c = monde.camera.controls;
  const cam = monde.camera.three;
  cam.updateMatrixWorld();
  const position = cam.position.clone();
  const haut = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const direction = cam.getWorldDirection(new THREE.Vector3());
  const base = position.addScaledVector(haut, decalageMise);
  // Jamais plus près que la distance minimale de la bibliothèque : sinon elle recule
  // la caméra d'un coup pour la respecter (le « sursaut » quand on regarde de près).
  const cible = base.clone().addScaledVector(direction, Math.max(rayon ?? c.distance, c.minDistance, 0.5));
  void c.setFocalOffset(0, decalageMise, 0, false);
  void c.setLookAt(base.x, base.y, base.z, cible.x, cible.y, cible.z, false);
}

let decalageBloque = false;
/** Visite à la première personne : l'œil reste à sa hauteur, sans décalage de mise en page. */
export function bloquerDecalage(bloque: boolean) {
  decalageBloque = bloque;
  if (bloque) {
    decalageMise = 0;
    void monde.camera.controls.setFocalOffset(0, 0, 0, false);
  }
}

export function ajusterDecalage(transition = true) {
  if (decalageBloque) return;
  const canvas = monde.renderer!.three.domElement;
  const H = canvas.clientHeight || window.innerHeight;
  let bas = 0;
  if (window.innerWidth < 820) {
    const outil = document.getElementById("outil");
    if (outil && !outil.hidden) bas = Math.max(bas, outil.offsetHeight);
    const fiche = document.getElementById("fiche");
    if (fiche?.classList.contains("ouverte")) bas = Math.max(bas, fiche.offsetHeight);
  }
  const haut = (document.querySelector(".barre") as HTMLElement | null)?.offsetHeight ?? 0;
  const cam = monde.camera.three;
  const hauteurVue = (cam as THREE.OrthographicCamera).isOrthographicCamera
    ? ((cam as THREE.OrthographicCamera).top - (cam as THREE.OrthographicCamera).bottom) /
      (cam as THREE.OrthographicCamera).zoom
    : 2 * monde.camera.controls.distance *
      Math.tan(THREE.MathUtils.degToRad((cam as THREE.PerspectiveCamera).fov ?? 60) / 2);
  const d = bas > 0 ? ((bas - haut) / 2 / H) * hauteurVue : 0;
  recentrerPivot();
  decalageMise = d;
  void monde.camera.controls.setFocalOffset(0, d, 0, transition);
}

/** Cadre la caméra sur une boîte (coordonnées de la scène). */
export async function cadrer(boite: THREE.Box3, marge = 1.15) {
  if (boite.isEmpty()) return;
  const sphere = boite.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius * marge, 1.5);
  recentrerPivot();
  await monde.camera.controls.fitToSphere(sphere, true);
  ajusterDecalage();
}

// --- Repère du projet (coordonnées IFC réelles) --------------------------------
// La scène est en Y vers le haut et recentrée près de l'origine ; l'IFC est en Z
// vers le haut, en coordonnées réelles (Lambert 93 par exemple).

export function versIfc(p: THREE.Vector3): [number, number, number] {
  const b = fragments.core.baseCoordinates ?? [0, 0, 0];
  return [p.x - b[0], b[2] - p.z, p.y - b[1]];
}

export function depuisIfc(x: number, y: number, z: number) {
  const b = fragments.core.baseCoordinates ?? [0, 0, 0];
  return new THREE.Vector3(x + b[0], z + b[1], b[2] - y);
}

export const directionVersIfc = (d: THREE.Vector3): [number, number, number] => [d.x, -d.z, d.y];
export const directionDepuisIfc = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

// --- Attente et messages -----------------------------------------------------------

const voile = el("voile");
const voileTexte = el("voile-texte");
const jauge = el("jauge");
const aide = el("aide");

export function attente(texte: string | null, avancement?: number) {
  if (texte === null) {
    voile.classList.add("cache");
    return;
  }
  voile.classList.remove("cache");
  voileTexte.textContent = texte;
  jauge.style.width = `${Math.round((avancement ?? 0) * 100)}%`;
}

let minuterieAlerte: number | undefined;
export function alerte(texte: string, duree = 6000) {
  aide.textContent = texte;
  aide.classList.remove("cache");
  window.clearTimeout(minuterieAlerte);
  minuterieAlerte = window.setTimeout(() => aide.classList.add("cache"), duree);
}

export const pause = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Petits signaux ----------------------------------------------------------------

export class Signal<T = void> {
  private ecouteurs = new Set<(v: T) => void>();
  on(f: (v: T) => void) {
    this.ecouteurs.add(f);
    return () => this.ecouteurs.delete(f);
  }
  emit(v: T) {
    for (const f of [...this.ecouteurs]) f(v);
  }
}

// --- Texte -------------------------------------------------------------------------

export const normaliser = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const nf = (max: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: max });
const f0 = nf(0);
const f1 = nf(1);
const f2 = nf(2);
export const nombre = (v: number, decimales = 2) =>
  (decimales === 0 ? f0 : decimales === 1 ? f1 : f2).format(v);

/** Échappe une valeur pour un fichier CSV (séparateur « ; », lisible par Excel en français). */
export function telechargerCsv(nom: string, lignes: (string | number)[][]) {
  const cellule = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texte = "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
  telecharger(nom, new Blob([texte], { type: "text/csv;charset=utf-8" }));
}

export function telecharger(nom: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = cree("a");
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const dateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

// --- Icônes (traits simples, 14 px) --------------------------------------------------

const ICONES: Record<string, string> = {
  transparence:
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  isoler: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
  retirer: '<path d="M4 4l8 8M12 4l-8 8"/>',
  oeil: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/>',
  oeilBarre:
    '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" opacity=".45"/><path d="M2.5 13.5l11-11"/>',
  precedent: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  suivant: '<path d="M6 3.5l4.5 4.5L6 12.5"/>',
};

export function icone(nom: keyof typeof ICONES | string) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", "14");
  s.setAttribute("height", "14");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.5");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONES[nom] ?? "";
  return s;
}

/** Bouton icône accessible. */
/** Fenêtre de confirmation de l'appli (à la place de celle du navigateur). */
export function demanderConfirmation(titre: string, texte: string, action: string, danger = false) {
  return new Promise<boolean>((ok) => {
    const fond = cree("div", "dialogue-fond");
    const boite = cree("div", "dialogue");
    boite.setAttribute("role", "alertdialog");
    const fin = (v: boolean) => {
      fond.remove();
      window.removeEventListener("keydown", clavier, true);
      ok(v);
    };
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        fin(false);
      }
    };
    const pied = cree("div", "dialogue-pied");
    const valider = bouton(danger ? "btn danger" : "btn principal", action, () => fin(true));
    pied.append(bouton("btn", "Annuler", () => fin(false)), valider);
    boite.append(cree("div", "dialogue-titre", titre), cree("p", "dialogue-texte", texte), pied);
    fond.append(boite);
    fond.addEventListener("pointerdown", (e) => {
      if (e.target === fond) fin(false);
    });
    window.addEventListener("keydown", clavier, true);
    document.body.append(fond);
    valider.focus();
  });
}

export function boutonIcone(nom: string, action: () => void, titre: string, classe = "icone") {
  const b = bouton(classe, "", action, titre);
  b.append(icone(nom));
  return b;
}

// --- Projection : perspective ou orthogonale (sans perspective) -------------------
// En orthogonale, ce qui garde la même taille à l'écran quelle que soit la distance.
// Au retour en perspective, on garde le cadrage obtenu en orthogonale.
export const projectionModifiee = new Signal();
monde.camera.projection.matchOrthoDistanceEnabled = true;
// Reculer loin la caméra orthogonale ne change rien à l'image ; on voit tout le site
// (bornes ajustées à la maquette dans navigation.ts).
monde.camera.threeOrtho.far = 5000;
monde.camera.projection.onChanged.add((cam: THREE.PerspectiveCamera | THREE.OrthographicCamera) => {
  for (const [, modele] of fragments.list) modele.useCamera(cam);
  const ortho = monde.camera.projection.current === "Orthographic";
  // Au doigt, pincer agrandit la vue (zoom) au lieu d'avancer la caméra.
  const ACTION = (monde.camera.controls.constructor as unknown as { ACTION: Record<string, number> }).ACTION;
  const pincer = (ortho ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK) as never;
  monde.camera.controls.touches.two = pincer;
  monde.camera.controls.touches.three = pincer;
  // Les passes d'arêtes et d'ombrage gardaient l'ancienne caméra : image dédoublée.
  majCameraPost();
  majProche();
  projectionModifiee.emit();
});
let bascule: Promise<void> | null = null;

export function estOrtho() {
  return monde.camera.projection.current === "Orthographic";
}

let rayonAvantOrtho = 0;

export async function definirProjection(vers: "Perspective" | "Orthographic") {
  if (bascule) await bascule;
  if (monde.camera.projection.current === vers) return;
  recentrerPivot();
  const c = monde.camera.controls;
  // Retour en perspective : la caméra reste où elle est. La bibliothèque la replaçait
  // à une distance calculée, ce qui la faisait reculer (à travers les murs, en intérieur).
  const retour = vers === "Perspective";
  const position = c.getPosition(new THREE.Vector3());
  const direction = c.getTarget(new THREE.Vector3()).sub(position).normalize();
  const ortho = monde.camera.threeOrtho;
  const hauteurVue = (ortho.top - ortho.bottom) / ortho.zoom;
  if (!retour) rayonAvantOrtho = c.distance;
  let surface: number | null = null;
  if (retour) {
    // Ce qui est au centre de l'écran : sert à garder le cadrage si on a zoomé en vue
    // orthogonale, et à placer la cible de la caméra à la bonne distance.
    const hit: any = await lanceur.castRay({ position: new THREE.Vector2(0, 0), items: [] } as any).catch(() => null);
    if (hit?.point) surface = (hit.point as THREE.Vector3).clone().sub(position).dot(direction);
    if (surface !== null && !(surface > 0)) surface = null;
  }
  bascule = monde.camera.projection.set(vers).finally(() => (bascule = null));
  await bascule;
  if (retour) {
    const fov = THREE.MathUtils.degToRad(monde.camera.threePersp.fov);
    const voulue = hauteurVue / (2 * Math.tan(fov / 2));
    // On avance (jamais on ne recule) pour garder le cadrage : en vue orthogonale, la
    // caméra se tient loin, hors de la maquette.
    const avance = surface !== null ? Math.max(0, surface - Math.max(voulue, 0.3)) : 0;
    const p = position.clone().addScaledVector(direction, avance);
    // Cible à la distance de ce qui est visé (sinon celle d'avant la vue orthogonale) :
    // une cible trop proche rendait ensuite le zoom très lent.
    const reste = surface !== null ? surface - avance : rayonAvantOrtho;
    const t = p.clone().addScaledVector(direction, Math.max(c.minDistance, 6, reste || 0));
    await c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
  }
  ajusterDecalage(false);
}
