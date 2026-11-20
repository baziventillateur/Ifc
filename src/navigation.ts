// Navigation à la souris et au clavier, façon jeu vidéo :
// - bouton de la molette enfoncé : déplacer la vue, le point saisi reste sous la souris ;
// - clic droit maintenu : tourner la tête sans bouger (comme une caméra posée dans la pièce) ;
// - flèches : ↑ avancer, ↓ reculer, ← → pas de côté ; Page préc. / suiv. : monter, descendre ;
//   Maj pour aller plus vite.
import * as THREE from "three";
import { completerTir } from "./deplacements";
import {
  alerte,
  bouton,
  cree,
  definirProjection,
  estOrtho,
  fragments,
  lanceur,
  monde,
  projectionModifiee,
  recentrerPivot,
} from "./noyau";
import { maquettes } from "./registre";

const canvas = monde.renderer!.three.domElement;
const controles = monde.camera.controls;
const ACTION = (controles.constructor as unknown as { ACTION: Record<string, number> }).ACTION;

// --- Bouton de la molette : déplacer -------------------------------------------------

// Mode « œil » (bouton sur la vue, pour le téléphone) : un doigt tourne la tête sur
// place au lieu de faire tourner la maquette. Deux doigts zooment et déplacent toujours.
let oeil = false;
export const modeOeil = () => oeil;

function reglerBoutons() {
  controles.mouseButtons.middle = ACTION.TRUCK as never;
  controles.mouseButtons.right = ACTION.NONE as never;
  controles.mouseButtons.left = (oeil ? ACTION.NONE : ACTION.ROTATE) as never;
  controles.touches.one = (oeil ? ACTION.NONE : ACTION.TOUCH_ROTATE) as never;
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
let regard: { x: number; y: number; actif: boolean; id: number; droit: boolean } | null = null;
const appuis = new Set<number>();

function tournerTete(lacet: number, tangage: number) {
  const position = controles.getPosition(new THREE.Vector3());
  const cible = controles.getTarget(new THREE.Vector3());
  const versCible = cible.sub(position);
  // Cible jamais plus proche que la distance minimale, sinon la caméra recule d'un coup.
  const longueur = Math.max(controles.minDistance, 0.5, versCible.length());
  const s = new THREE.Spherical().setFromVector3(versCible);
  s.theta -= THREE.MathUtils.degToRad(lacet);
  s.phi = THREE.MathUtils.clamp(s.phi + THREE.MathUtils.degToRad(tangage), 0.06, Math.PI - 0.06);
  s.radius = longueur;
  const nouvelle = new THREE.Vector3().setFromSpherical(s).add(position);
  void controles.setLookAt(position.x, position.y, position.z, nouvelle.x, nouvelle.y, nouvelle.z, false);
}

canvas.addEventListener("pointerdown", (e) => {
  appuis.add(e.pointerId);
  if (e.pointerType === "mouse" && e.button === 2) {
    regard = { x: e.clientX, y: e.clientY, actif: false, id: e.pointerId, droit: true };
  } else if (oeil && (e.pointerType !== "mouse" || e.button === 0)) {
    // Un second doigt : c'est un zoom ou un déplacement, plus un regard.
    if (appuis.size > 1) finRegard();
    else regard = { x: e.clientX, y: e.clientY, actif: false, id: e.pointerId, droit: false };
  }
});
window.addEventListener("pointermove", (e) => {
  if (!regard || e.pointerId !== regard.id) return;
  if (regard.droit && !(e.buttons & 2)) {
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
  // Souris : comme dans un jeu vidéo, le regard suit la souris (gauche → on regarde à
  // gauche, haut → on regarde en haut). Doigt : on tire l'image avec soi (photo à 360°).
  const sens = e.pointerType === "mouse" ? 1 : -1;
  // Au doigt, sur un petit écran, il faut tourner plus vite pour un même geste.
  const k = e.pointerType === "mouse" ? SENSIBILITE : SENSIBILITE * 1.8;
  tournerTete(sens * dx * k, sens * dy * k);
});
function finRegard() {
  if (regard?.actif) canvas.classList.remove("regard");
  regard = null;
}
window.addEventListener("pointerup", (e) => {
  appuis.delete(e.pointerId);
  if (regard && e.pointerId === regard.id) finRegard();
});
window.addEventListener("pointercancel", (e) => {
  appuis.delete(e.pointerId);
  finRegard();
});

// --- Projection : un bouton rond à côté de l'œil ---------------------------------------
// Toucher : bascule entre la vue orthogonale (sans perspective) et la perspective.
// Appui long : liste des angles de vue (60° à 150°) ; on glisse le doigt sur la valeur
// et on le lève, ou on la touche ensuite. L'angle choisi est gardé sur l'appareil.
const ANGLES = [60, 85, 105, 120, 135, 150];
const CLE_ANGLE = "nexbim-angle";
let angle = 60;
try {
  const lu = Number(localStorage.getItem(CLE_ANGLE));
  if (ANGLES.includes(lu)) angle = lu;
} catch {
  // Angle normal.
}
const btnProjection = document.getElementById("btn-projection");
const ICONE_ORTHO =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v15h15"/><path d="M5 13h6v6"/></svg>';

function appliquerAngle() {
  const cam = monde.camera.threePersp;
  if (cam.fov === angle) return;
  cam.fov = angle;
  cam.updateProjectionMatrix();
  void fragments.core.update(true);
}

function majBoutonProjection() {
  if (!btnProjection) return;
  const ortho = estOrtho();
  btnProjection.classList.toggle("actif", ortho);
  btnProjection.innerHTML = ortho ? ICONE_ORTHO : `<span>${angle}°</span>`;
  btnProjection.title = ortho
    ? "Vue orthogonale (sans perspective). Toucher : perspective. Appui long : angle de vue."
    : `Perspective ${angle}°. Toucher : vue orthogonale. Appui long : changer l'angle.`;
}

const basculerProjection = () => void definirProjection(estOrtho() ? "Perspective" : "Orthographic");

function choisirAngle(a: number) {
  angle = a;
  try {
    localStorage.setItem(CLE_ANGLE, String(a));
  } catch {
    // Gardé pour la session seulement.
  }
  appliquerAngle();
  majBoutonProjection();
  if (estOrtho()) void definirProjection("Perspective");
}

appliquerAngle();
majBoutonProjection();
projectionModifiee.on(majBoutonProjection);

let listeAngles: HTMLElement | null = null;
function fermerAngles() {
  listeAngles?.remove();
  listeAngles = null;
  window.removeEventListener("pointerdown", toucheDehors, true);
}
function toucheDehors(e: PointerEvent) {
  const cible = e.target as Node;
  if (listeAngles?.contains(cible) || btnProjection?.contains(cible)) return;
  fermerAngles();
}
function ouvrirAngles() {
  if (!btnProjection) return;
  fermerAngles();
  const liste = cree("div", "choix-angle");
  const ortho = bouton("choix-angle-option" + (estOrtho() ? " actif" : ""), "", () => {
    fermerAngles();
    void definirProjection("Orthographic");
  });
  ortho.innerHTML = `${ICONE_ORTHO}<span>Ortho</span>`;
  liste.append(ortho);
  for (const a of ANGLES) {
    const b = bouton("choix-angle-option" + (!estOrtho() && a === angle ? " actif" : ""), `${a}°`, () => {
      fermerAngles();
      choisirAngle(a);
    });
    liste.append(b);
  }
  document.body.append(liste);
  const r = btnProjection.getBoundingClientRect();
  const l = liste.getBoundingClientRect();
  liste.style.top = `${r.bottom + 6}px`;
  liste.style.left = `${Math.min(window.innerWidth - l.width - 4, Math.max(4, r.left + r.width / 2 - l.width / 2))}px`;
  listeAngles = liste;
  window.addEventListener("pointerdown", toucheDehors, true);
}

function optionSous(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const option = el?.closest<HTMLElement>(".choix-angle-option");
  return option && listeAngles?.contains(option) ? option : null;
}

let appuiProjection: { id: number; x: number; y: number; long: boolean; minuterie: number } | null = null;
btnProjection?.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const id = e.pointerId;
  appuiProjection = {
    id,
    x: e.clientX,
    y: e.clientY,
    long: false,
    minuterie: window.setTimeout(() => {
      if (!appuiProjection || appuiProjection.id !== id) return;
      appuiProjection.long = true;
      navigator.vibrate?.(12);
      ouvrirAngles();
    }, 420),
  };
});
window.addEventListener("pointermove", (e) => {
  const a = appuiProjection;
  if (!a || e.pointerId !== a.id) return;
  if (!a.long) {
    // Le doigt part ailleurs avant l'appui long : rien.
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) > 14) {
      window.clearTimeout(a.minuterie);
      appuiProjection = null;
    }
    return;
  }
  const sous = optionSous(e.clientX, e.clientY);
  listeAngles?.querySelectorAll(".choix-angle-option").forEach((o) => o.classList.toggle("survol", o === sous));
});
window.addEventListener("pointerup", (e) => {
  const a = appuiProjection;
  if (!a || e.pointerId !== a.id) return;
  window.clearTimeout(a.minuterie);
  appuiProjection = null;
  if (!a.long) {
    basculerProjection();
    return;
  }
  // Doigt levé sur une valeur : elle est choisie. Sinon la liste reste ouverte.
  optionSous(e.clientX, e.clientY)?.click();
});
window.addEventListener("pointercancel", (e) => {
  if (appuiProjection && e.pointerId === appuiProjection.id) {
    window.clearTimeout(appuiProjection.minuterie);
    appuiProjection = null;
  }
});
btnProjection?.addEventListener("contextmenu", (e) => e.preventDefault());
// Au clavier (Entrée, Espace) : bascule simple.
btnProjection?.addEventListener("click", (e) => {
  if (e.detail === 0) basculerProjection();
});
// Touche O : même bascule.
window.addEventListener("keydown", (e) => {
  if (e.key !== "o" && e.key !== "O") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  basculerProjection();
});

const btnOeil = document.getElementById("btn-oeil");
export function definirOeil(actif: boolean) {
  oeil = actif;
  finRegard();
  reglerBoutons();
  btnOeil?.classList.toggle("actif", oeil);
  btnOeil?.setAttribute("aria-pressed", String(oeil));
  if (oeil) alerte("Mode regard : un doigt pour tourner la tête sur place. Retouchez l'œil pour en sortir.", 3500);
}
btnOeil?.addEventListener("click", () => definirOeil(!oeil));

// --- Flèches du clavier : marcher dans la maquette ----------------------------------------

const TOUCHES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
const enfoncees = new Set<string>();
let rapide = false;
let dernier = 0;
let boucle = 0;
const VITESSE = 4; // mètres par seconde

function pas(t: number) {
  boucle = 0;
  if (!enfoncees.size) return;
  const dt = Math.min(0.25, (t - dernier) / 1000);
  dernier = t;
  const facteur = rapide ? 3 : 1;
  const sens = (plus: string, moins: string) => (enfoncees.has(plus) ? 1 : 0) - (enfoncees.has(moins) ? 1 : 0);
  const avance = sens("ArrowUp", "ArrowDown");
  // Gauche / droite : pas de côté, comme dans un jeu vidéo (la souris sert à tourner la tête).
  const cote = sens("ArrowRight", "ArrowLeft");
  const monte = sens("PageUp", "PageDown");

  if (avance || cote || monte) {
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
    const droite = devant.clone().cross(new THREE.Vector3(0, 1, 0));
    const d = devant.multiplyScalar(avance).addScaledVector(droite, cote);
    if (d.lengthSq() > 1) d.normalize();
    d.multiplyScalar(VITESSE * facteur * dt);
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

// --- Voir de très près sans que l'objet soit rogné -----------------------------------
// La caméra ne dessine rien en deçà d'une distance minimale (1 m à l'origine) : en
// zoomant sur un détail, il était coupé puis disparaissait. Dès qu'on est près ou
// dans la maquette, cette distance tombe à 5 cm ; de loin, elle reste plus grande,
// ce qui garde un dessin net des surfaces lointaines.
const boiteScene = new THREE.Box3();
let boiteAJour = 0;
monde.renderer!.onBeforeUpdate.add(() => {
  const cam = monde.camera.threePersp;
  const t = performance.now();
  if (t - boiteAJour > 2000) {
    boiteAJour = t;
    boiteScene.makeEmpty();
    for (const m of maquettes.values()) if (m.modele.object.visible) boiteScene.union(m.modele.box);
  }
  if (boiteScene.isEmpty()) return;
  const distance = boiteScene.distanceToPoint(cam.position);
  const diagonale = boiteScene.min.distanceTo(boiteScene.max);
  const pres = THREE.MathUtils.clamp(distance * 0.02, 0.05, 1);
  const loin = Math.max(1000, (distance + diagonale) * 1.5);
  if (Math.abs(cam.near - pres) > pres * 0.1 || Math.abs(cam.far - loin) > loin * 0.1) {
    cam.near = pres;
    cam.far = loin;
    cam.updateProjectionMatrix();
  }
});
