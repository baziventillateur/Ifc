// Rotation autour de ce qu'on touche : au premier doigt (ou clic gauche), le point de la
// maquette sous le pointeur devient le centre de rotation, sans faire bouger la vue.
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
  if (monde.camera.projection.current !== "Perspective") return;
  const mien = ++tour;
  pivotPose = false;
  depart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  const r = canvas.getBoundingClientRect();
  const position = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((hit) => {
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
