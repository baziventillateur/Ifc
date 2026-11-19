// Navigation à la souris et au clavier, façon jeu vidéo :
// - bouton de la molette enfoncé : déplacer la vue, le point saisi reste sous la souris ;
// - clic droit maintenu : tourner la tête sans bouger (comme une caméra posée dans la pièce) ;
// - flèches : ↑ avancer, ↓ reculer, ← → tourner la tête ; Page préc. / suiv. : monter, descendre ;
//   Maj pour aller plus vite.
import * as THREE from "three";
import { completerTir } from "./deplacements";
import { lanceur, monde, projectionModifiee, recentrerPivot } from "./noyau";
import { maquettes } from "./registre";

const canvas = monde.renderer!.three.domElement;
const controles = monde.camera.controls;
const ACTION = (controles.constructor as unknown as { ACTION: Record<string, number> }).ACTION;

// --- Bouton de la molette : déplacer -------------------------------------------------

function reglerBoutons() {
  controles.mouseButtons.middle = ACTION.TRUCK as never;
  controles.mouseButtons.right = ACTION.NONE as never;
}
reglerBoutons();
// Le changement de projection remet les boutons d'origine de la bibliothèque.
projectionModifiee.on(reglerBoutons);

const TRUCK_BASE = 2; // réglage d'origine de la bibliothèque : exact à la distance de la cible
let saisi: THREE.Vector3 | null = null;
let tirPan = 0;

function centreScene() {
  const boite = new THREE.Box3();
  for (const m of maquettes.values()) if (m.modele.object.visible) boite.union(m.modele.box);
  return boite.isEmpty() ? null : boite.getCenter(new THREE.Vector3());
}

/** Le déplacement suit la souris à la profondeur du point saisi, pas à celle de la cible. */
function reglerAllurePan() {
  if (monde.camera.projection.current !== "Perspective") {
    controles.truckSpeed = TRUCK_BASE;
    return;
  }
  const cam = monde.camera.three;
  const point = saisi ?? centreScene();
  if (!point) {
    controles.truckSpeed = TRUCK_BASE;
    return;
  }
  const direction = cam.getWorldDirection(new THREE.Vector3());
  const profondeur = point.clone().sub(cam.position).dot(direction);
  const cible = controles.getTarget(new THREE.Vector3());
  const rayon = Math.max(0.01, cam.position.distanceTo(cible));
  const rapport = profondeur > 0.05 ? profondeur / rayon : 1;
  controles.truckSpeed = TRUCK_BASE * Math.min(50, Math.max(0.02, rapport));
}

function viser(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  const position = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  const mien = ++tirPan;
  saisi = null;
  reglerAllurePan();
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((brut) => {
      const hit = completerTir(brut, position);
      if (mien !== tirPan || !hit?.point) return;
      saisi = (hit.point as THREE.Vector3).clone();
      reglerAllurePan();
    })
    .catch(() => {});
}

canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType === "mouse" && e.button === 1) {
      e.preventDefault(); // pas de défilement automatique du navigateur
      viser(e);
    } else if (e.pointerType !== "mouse") {
      // Au doigt : le déplacement à deux doigts suit aussi ce qu'on touche.
      viser(e);
    }
  },
  true,
);
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault();
});
canvas.addEventListener("auxclick", (e) => e.preventDefault());

// --- Clic droit maintenu : tourner la tête sur place ------------------------------------

const SENSIBILITE = 0.22; // degrés par pixel
const SEUIL = 5;
let regard: { x: number; y: number; actif: boolean; id: number } | null = null;

function tournerTete(lacet: number, tangage: number) {
  const position = controles.getPosition(new THREE.Vector3());
  const cible = controles.getTarget(new THREE.Vector3());
  const versCible = cible.sub(position);
  const longueur = Math.max(0.5, versCible.length());
  const s = new THREE.Spherical().setFromVector3(versCible);
  s.theta -= THREE.MathUtils.degToRad(lacet);
  s.phi = THREE.MathUtils.clamp(s.phi + THREE.MathUtils.degToRad(tangage), 0.06, Math.PI - 0.06);
  s.radius = longueur;
  const nouvelle = new THREE.Vector3().setFromSpherical(s).add(position);
  void controles.setLookAt(position.x, position.y, position.z, nouvelle.x, nouvelle.y, nouvelle.z, false);
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" || e.button !== 2) return;
  regard = { x: e.clientX, y: e.clientY, actif: false, id: e.pointerId };
});
window.addEventListener("pointermove", (e) => {
  if (!regard || e.pointerId !== regard.id) return;
  if (!(e.buttons & 2)) {
    finRegard();
    return;
  }
  const dx = e.clientX - regard.x;
  const dy = e.clientY - regard.y;
  if (!regard.actif) {
    if (Math.hypot(dx, dy) < SEUIL) return;
    regard.actif = true;
    // La cible revient dans l'axe de la vue : on tourne autour de l'œil, pas d'un objet.
    recentrerPivot();
    canvas.classList.add("regard");
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Sans capture, le geste marche quand même tant que la souris reste sur la vue.
    }
  }
  regard.x = e.clientX;
  regard.y = e.clientY;
  tournerTete(dx * SENSIBILITE, dy * SENSIBILITE);
});
function finRegard() {
  if (regard?.actif) canvas.classList.remove("regard");
  regard = null;
}
window.addEventListener("pointerup", (e) => {
  if (regard && e.pointerId === regard.id) finRegard();
});
window.addEventListener("pointercancel", finRegard);

// --- Flèches du clavier : marcher dans la maquette ----------------------------------------

const TOUCHES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
const enfoncees = new Set<string>();
let rapide = false;
let dernier = 0;
let boucle = 0;
const VITESSE = 4; // mètres par seconde
const ROTATION = 70; // degrés par seconde

function pas(t: number) {
  boucle = 0;
  if (!enfoncees.size) return;
  const dt = Math.min(0.25, (t - dernier) / 1000);
  dernier = t;
  const facteur = rapide ? 3 : 1;
  const sens = (plus: string, moins: string) => (enfoncees.has(plus) ? 1 : 0) - (enfoncees.has(moins) ? 1 : 0);
  const avance = sens("ArrowUp", "ArrowDown");
  const tourne = sens("ArrowRight", "ArrowLeft");
  const monte = sens("PageUp", "PageDown");

  if (tourne) tournerTete(tourne * ROTATION * dt * (rapide ? 1.6 : 1), 0);
  if (avance || monte) {
    if (avance && monde.camera.projection.current === "Orthographic") {
      // Sans perspective, avancer ne change rien à l'image : on agrandit la vue.
      const cam = monde.camera.three as THREE.OrthographicCamera;
      void controles.zoomTo(cam.zoom * (1 + avance * dt * 1.2 * facteur), false);
    }
    const position = controles.getPosition(new THREE.Vector3());
    const cible = controles.getTarget(new THREE.Vector3());
    // On marche à plat, dans la direction du regard.
    const devant = cible.clone().sub(position).setY(0);
    if (devant.lengthSq() < 1e-6) {
      monde.camera.three.updateMatrixWorld();
      devant.setFromMatrixColumn(monde.camera.three.matrixWorld, 1).setY(0);
    }
    devant.normalize();
    const d = devant.multiplyScalar(avance * VITESSE * facteur * dt);
    d.y += monte * VITESSE * 0.75 * facteur * dt;
    position.add(d);
    cible.add(d);
    void controles.setLookAt(position.x, position.y, position.z, cible.x, cible.y, cible.z, false);
  }
  boucle = requestAnimationFrame(pas);
}

window.addEventListener("keydown", (e) => {
  rapide = e.shiftKey;
  if (!TOUCHES.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable], .dialogue")) return;
  e.preventDefault();
  if (enfoncees.has(e.key)) return;
  if (!enfoncees.size) recentrerPivot();
  enfoncees.add(e.key);
  if (!boucle) {
    dernier = performance.now();
    boucle = requestAnimationFrame(pas);
  }
});
window.addEventListener("keyup", (e) => {
  rapide = e.shiftKey;
  enfoncees.delete(e.key);
});
window.addEventListener("blur", () => enfoncees.clear());
