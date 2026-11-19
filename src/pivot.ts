// Navigation au doigt et à la souris. Au premier doigt (ou clic gauche), le point de la
// maquette sous le pointeur devient le centre de rotation, sans faire bouger la vue ;
// la vitesse de rotation et de zoom suit celle du geste.
import { modeOeil } from "./navigation";
import { completerTir } from "./deplacements";
import * as THREE from "three";
import { cree, lanceur, monde } from "./noyau";
import { maquettes } from "./registre";

const canvas = monde.renderer!.three.domElement;
const enCours = new Set<number>();
let tour = 0;
let depart: { x: number; y: number; id: number } | null = null;
let pivotPose = false;
/** Distance de la caméra à ce qu'on a touché : c'est elle qui donne l'allure du zoom. */
let profondeur: number | null = null;

// Petit repère du pivot, visible pendant la rotation.
const repere = cree("div", "repere-pivot");
repere.hidden = true;
document.body.append(repere);

canvas.addEventListener("pointerdown", (e) => {
  enCours.add(e.pointerId);
  // Deux doigts : zoom et déplacement, on garde le pivot du premier doigt.
  if (enCours.size > 1) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.shiftKey) return;
  const mien = ++tour;
  pivotPose = false;
  profondeur = null;
  depart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  const r = canvas.getBoundingClientRect();
  const position = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((brut) => {
      const hit = completerTir(brut, position);
      if (mien !== tour || !hit?.point) return;
      monde.camera.controls.setOrbitPoint(hit.point.x, hit.point.y, hit.point.z);
      profondeur = monde.camera.three.position.distanceTo(hit.point);
      pivotPose = true;
    })
    .catch(() => {});
});

window.addEventListener("pointermove", (e) => {
  if (!depart || e.pointerId !== depart.id || !pivotPose || enCours.size > 1 || modeOeil()) return;
  if (repere.hidden && Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > 6) {
    repere.style.left = `${depart.x}px`;
    repere.style.top = `${depart.y}px`;
    repere.hidden = false;
  }
});

const lacher = (e: PointerEvent) => {
  enCours.delete(e.pointerId);
  if (depart && e.pointerId === depart.id) {
    depart = null;
    repere.hidden = true;
  }
};
window.addEventListener("pointerup", lacher);
window.addEventListener("pointercancel", lacher);

/**
 * Le zoom de la bibliothèque avance en proportion de la distance au centre de la vue,
 * qui devient minuscule après quelques zooms : il fallait alors pincer plusieurs fois.
 * On le ramène à la distance réelle de ce qui est sous les doigts.
 */
function profondeurScene() {
  const boite = new THREE.Box3();
  for (const m of maquettes.values()) if (m.modele.object.visible) boite.union(m.modele.box);
  if (boite.isEmpty()) return null;
  return boite.getBoundingSphere(new THREE.Sphere()).center.distanceTo(monde.camera.three.position);
}

/**
 * Allure du zoom pour une distance réelle d : le pas reste proportionnel à ce qu'on
 * vise, quelle que soit la cible de la caméra (qui change après une vue orthogonale,
 * un regard, un cadrage…). Le zoom garde donc toujours la même sensation.
 */
function allurePour(d: number | null) {
  if (monde.camera.projection.current !== "Perspective" || d === null || !(d > 0)) return 1;
  const rayon = Math.max(0.5, monde.camera.controls.distance);
  return Math.min(8, Math.max(0.1, d / rayon));
}

function allureZoom() {
  return allurePour(profondeur ?? profondeurScene());
}

// --- Vitesse : plus vive au doigt, et proportionnelle à la vitesse du geste ----------

const controles = monde.camera.controls;
// La vue suit le doigt de plus près (moins de traîne).
controles.draggingSmoothTime = 0.07;

const BASE = {
  touch: { rotation: 1.4, zoom: 1.6 },
  pen: { rotation: 1.4, zoom: 1.6 },
  mouse: { rotation: 1.0, zoom: 1.0 },
};
const derniers = new Map<number, { x: number; y: number; t: number }>();
let elan = 0;

window.addEventListener(
  "pointermove",
  (e) => {
    const avant = derniers.get(e.pointerId);
    if (avant) {
      const dt = Math.max(4, e.timeStamp - avant.t);
      const v = Math.hypot(e.clientX - avant.x, e.clientY - avant.y) / dt; // pixels par milliseconde
      elan = elan * 0.6 + v * 0.4;
    }
    derniers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
    const base = BASE[e.pointerType as keyof typeof BASE] ?? BASE.mouse;
    // Geste lent : réglage fin. Geste rapide : la rotation s'amplifie, jusqu'à × 2,2.
    const gain = 1 + Math.min(1.2, Math.max(0, (elan - 0.25) * 0.9));
    controles.azimuthRotateSpeed = base.rotation * gain;
    controles.polarRotateSpeed = base.rotation * gain;
    controles.dollySpeed = e.pointerType === "mouse" ? base.zoom : base.zoom * Math.min(gain, 1.3) * allureZoom();
  },
  true,
);

const oublier = (e: PointerEvent) => {
  derniers.delete(e.pointerId);
  if (derniers.size === 0) elan = 0;
};
window.addEventListener("pointerup", oublier, true);
window.addEventListener("pointercancel", oublier, true);
// --- Molette : même règle, avec la distance de ce qui est sous la souris ---------------
const toile = monde.renderer!.three.domElement;
let visee: { d: number | null; x: number; y: number; t: number } | null = null;
let tirVisee = 0;
let attenteVisee = 0;

function viserSous(x: number, y: number) {
  const r = toile.getBoundingClientRect();
  const position = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  const mien = ++tirVisee;
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((brut) => {
      if (mien !== tirVisee) return;
      const hit = completerTir(brut, position);
      const d = hit?.point ? monde.camera.three.position.distanceTo(hit.point) : null;
      visee = { d, x, y, t: performance.now() };
    })
    .catch(() => {});
}

toile.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || e.buttons) return;
  window.clearTimeout(attenteVisee);
  attenteVisee = window.setTimeout(() => viserSous(e.clientX, e.clientY), 120);
});

window.addEventListener(
  "wheel",
  (e) => {
    const frais =
      !!visee && performance.now() - visee.t < 700 && Math.hypot(visee.x - e.clientX, visee.y - e.clientY) < 40;
    if (!frais) viserSous(e.clientX, e.clientY);
    const proche = visee && Math.hypot(visee.x - e.clientX, visee.y - e.clientY) < 80 ? visee.d : null;
    controles.dollySpeed = BASE.mouse.zoom * allurePour(proche ?? profondeurScene());
  },
  { capture: true, passive: true },
);
