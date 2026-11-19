// Navigation au doigt et à la souris. Au premier doigt (ou clic gauche), le point de la
// maquette sous le pointeur devient le centre de rotation, sans faire bouger la vue ;
// la vitesse de rotation et de zoom suit celle du geste.
import { completerTir } from "./deplacements";
import * as THREE from "three";
import { cree, lanceur, monde } from "./noyau";

const canvas = monde.renderer!.three.domElement;
const enCours = new Set<number>();
let tour = 0;
let depart: { x: number; y: number; id: number } | null = null;
let pivotPose = false;

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
      pivotPose = true;
    })
    .catch(() => {});
});

window.addEventListener("pointermove", (e) => {
  if (!depart || e.pointerId !== depart.id || !pivotPose || enCours.size > 1) return;
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
    controles.dollySpeed = e.pointerType === "mouse" ? base.zoom : base.zoom * gain;
  },
  true,
);

const oublier = (e: PointerEvent) => {
  derniers.delete(e.pointerId);
  if (derniers.size === 0) elan = 0;
};
window.addEventListener("pointerup", oublier, true);
window.addEventListener("pointercancel", oublier, true);
// La molette garde sa vitesse habituelle.
window.addEventListener("wheel", () => (controles.dollySpeed = BASE.mouse.zoom), { capture: true, passive: true });
