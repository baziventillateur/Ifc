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
  definirVueFixe,
  estOrtho,
  fragments,
  lanceur,
  monde,
  projectionModifiee,
  recentrerPivot,
} from "./noyau";
import { maquettes } from "./registre";
import { commanderDrone } from "./drone";

const canvas = monde.renderer!.three.domElement;
const controles = monde.camera.controls;
const ACTION = (controles.constructor as unknown as { ACTION: Record<string, number> }).ACTION;

// --- Bouton de la molette : déplacer -------------------------------------------------

// Mode « œil » (bouton sur la vue, pour le téléphone) : un doigt tourne la tête sur
// place au lieu de faire tourner la maquette. Deux doigts zooment et déplacent toujours.
let oeil = false;
// Visite à la première personne (visite.ts) : regard comme en mode œil, sans zoom ni
// déplacement libre ; on avance avec la manette, les flèches ou le GPS.
let visite = false;
export const modeOeil = () => oeil || visite;
export const modeVisite = () => visite;

// Placement dans la visite (visite.ts) : sur le plan, un doigt pose et oriente le repère ;
// la vue ne tourne plus (deux doigts déplacent et zooment toujours).
let unDoigtBloque = false;
export function bloquerUnDoigt(oui: boolean) {
  unDoigtBloque = oui;
  reglerBoutons();
}

function reglerBoutons() {
  const regarder = oeil || visite || unDoigtBloque;
  controles.mouseButtons.middle = (visite ? ACTION.NONE : ACTION.TRUCK) as never;
  controles.mouseButtons.right = ACTION.NONE as never;
  controles.mouseButtons.left = (regarder ? ACTION.NONE : ACTION.ROTATE) as never;
  controles.touches.one = (regarder ? ACTION.NONE : ACTION.TOUCH_ROTATE) as never;
  if (visite) {
    // En visite orthogonale, la molette et le pincement agrandissent la vue sans bouger l'œil.
    const ortho = monde.camera.projection.current === "Orthographic";
    controles.mouseButtons.wheel = (ortho ? ACTION.ZOOM : ACTION.NONE) as never;
    controles.touches.two = (ortho ? ACTION.TOUCH_ZOOM : ACTION.NONE) as never;
    controles.touches.three = ACTION.NONE as never;
  }
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
/** Visite suivie par les capteurs du téléphone : le doigt corrige seulement la direction. */
let regardExterne: ((lacet: number) => void) | null = null;
export function definirRegardExterne(f: ((lacet: number) => void) | null) {
  regardExterne = f;
}

function tournerTete(lacet: number, tangage: number) {
  const position = controles.getPosition(new THREE.Vector3());
  const cible = controles.getTarget(new THREE.Vector3());
  const versCible = cible.sub(position);
  // Cible jamais plus proche que la distance minimale, sinon la caméra recule d'un coup.
  const longueur = Math.max(controles.minDistance, 0.5, versCible.length());
  const s = new THREE.Spherical().setFromVector3(versCible);
  s.theta -= THREE.MathUtils.degToRad(lacet);
  // En visite orthogonale (coupe verticale), le regard reste horizontal.
  s.phi = visite && estOrtho()
    ? Math.PI / 2
    : THREE.MathUtils.clamp(s.phi + THREE.MathUtils.degToRad(tangage), 0.06, Math.PI - 0.06);
  s.radius = longueur;
  const nouvelle = new THREE.Vector3().setFromSpherical(s).add(position);
  void controles.setLookAt(position.x, position.y, position.z, nouvelle.x, nouvelle.y, nouvelle.z, false);
}

canvas.addEventListener("pointerdown", (e) => {
  appuis.add(e.pointerId);
  if (e.pointerType === "mouse" && e.button === 2) {
    regard = { x: e.clientX, y: e.clientY, actif: false, id: e.pointerId, droit: true };
  } else if ((oeil || visite) && (e.pointerType !== "mouse" || e.button === 0)) {
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
  // En visite à la première personne, comme dans un jeu : la vue suit le doigt (glisser vers
  // la gauche = regarder à gauche, vers le haut = regarder en haut).
  const sens = e.pointerType === "mouse" || visite ? 1 : -1;
  // Au doigt, sur un petit écran, il faut tourner plus vite pour un même geste.
  const k = e.pointerType === "mouse" ? SENSIBILITE : SENSIBILITE * 1.8;
  if (regardExterne) regardExterne(sens * dx * k);
  else tournerTete(sens * dx * k, sens * dy * k);
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

// --- Deux doigts qui tournent l'un autour de l'autre : la vue tourne -------------------
// Le pincement garde son rôle (avancer, reculer) ; la torsion fait tourner autour du point
// visé, ou tourner la tête en mode œil et en visite. Un petit seuil évite de tourner sans
// le vouloir en pinçant.

const touchers = new Map<number, { x: number; y: number }>();
let torsion: { angle: number; cumul: number; actif: boolean } | null = null;
const SEUIL_TORSION = THREE.MathUtils.degToRad(9);
function angleDesDoigts() {
  const [a, b] = [...touchers.values()];
  return Math.atan2(b.y - a.y, b.x - a.x);
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  touchers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  torsion = touchers.size === 2 ? { angle: angleDesDoigts(), cumul: 0, actif: false } : null;
});
window.addEventListener("pointermove", (e) => {
  if (!touchers.has(e.pointerId)) return;
  touchers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchers.size !== 2 || !torsion || unDoigtBloque) return;
  const a = angleDesDoigts();
  let d = a - torsion.angle;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  torsion.angle = a;
  torsion.cumul += d;
  if (!torsion.actif) {
    if (Math.abs(torsion.cumul) < SEUIL_TORSION) return;
    torsion.actif = true;
    d = torsion.cumul;
  }
  if (oeil || visite) {
    // Torsion dans le sens des aiguilles d'une montre : on tourne la tête à droite.
    const lacet = THREE.MathUtils.radToDeg(d);
    if (regardExterne) regardExterne(lacet);
    else tournerTete(lacet, 0);
  } else {
    // Vue extérieure : la maquette tourne avec les doigts, autour du point visé.
    void controles.rotate(d, 0, false);
  }
});
const leverToucher = (e: PointerEvent) => {
  if (!touchers.delete(e.pointerId)) return;
  torsion = touchers.size === 2 ? { angle: angleDesDoigts(), cumul: 0, actif: false } : null;
};
window.addEventListener("pointerup", leverToucher);
window.addEventListener("pointercancel", leverToucher);

// --- Projection : un bouton rond à côté de l'œil ---------------------------------------
// Toucher : bascule entre la vue orthogonale (sans perspective) et la perspective.
// Appui long : deux angles de vue, normal (60°) et large (100°, pour les intérieurs).
// En visite à la première personne, trois angles nommés, comme dans les jeux de tir
// (Call of Duty mesure l'angle à l'horizontale d'un écran 16:9 : 80° par défaut, réglable
// de 60 à 120°) : serré 80°, normal 100°, grand angle 120°. Sur téléphone tenu droit,
// l'angle s'applique à la hauteur de l'écran (le grand côté).
// On glisse le doigt sur la valeur et on le lève, ou on la touche ensuite.
// Les angles choisis sont gardés sur l'appareil.
const ANGLES = [60, 100];
export type AngleVisite = "serre" | "normal" | "grand";
export const ANGLES_VISITE: { cle: AngleVisite; nom: string; h: number }[] = [
  { cle: "serre", nom: "Serré", h: 80 },
  { cle: "normal", nom: "Normal", h: 100 },
  { cle: "grand", nom: "Grand angle", h: 120 },
];
const CLE_ANGLE = "nexbim-angle";
const CLE_ANGLE_VISITE = "nexbim-angle-visite-2";
const plusProche = (liste: number[], v: number) =>
  liste.reduce((m, a) => (Math.abs(a - v) < Math.abs(m - v) ? a : m));
let angle = 60;
let angleVisite: AngleVisite = "normal";
try {
  // Un ancien réglage (85°, 120°…) prend l'angle proposé le plus proche.
  const lu = Number(localStorage.getItem(CLE_ANGLE));
  if (lu > 0) angle = plusProche(ANGLES, lu);
  const luVisite = localStorage.getItem(CLE_ANGLE_VISITE) as AngleVisite | null;
  if (luVisite && ANGLES_VISITE.some((a) => a.cle === luVisite)) angleVisite = luVisite;
  // Ancien réglage en degrés (100, 120, 150) : normal ou grand angle.
  else if (Number(localStorage.getItem("nexbim-angle-visite")) >= 120) angleVisite = "grand";
} catch {
  // Angles par défaut.
}
export const angleVisiteChoisi = () => angleVisite;
/** Angle vertical de la caméra pour un angle de visite, selon la forme de l'écran. */
function verticalDe(a: AngleVisite) {
  const h = ANGLES_VISITE.find((x) => x.cle === a)!.h;
  const taille = monde.renderer!.getSize();
  if (taille.y > taille.x) return h; // téléphone tenu droit : le grand côté
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h / 2)) * (9 / 16)));
}
/** Angle de vue de la visite (pour l'animation d'entrée). */
export const angleDeVisite = () => verticalDe(angleVisite);
const angleActuel = () => (visite ? zoome(verticalDe(angleVisite)) : angle);
const btnProjection = document.getElementById("btn-projection");
const ICONE_ORTHO =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v15h15"/><path d="M5 13h6v6"/></svg>';

function appliquerAngle(majMaquettes = true) {
  const cam = monde.camera.threePersp;
  if (Math.abs(cam.fov - angleActuel()) < 0.01) return;
  cam.fov = angleActuel();
  cam.updateProjectionMatrix();
  if (majMaquettes) void fragments.core.update(true);
}

// --- Zoom à la molette pendant la visite -------------------------------------------------
// À l'arrêt, la molette vers l'avant resserre l'angle de vue (comme des jumelles), vers
// l'arrière elle le rouvre. Il revient en douceur à l'angle normal dès qu'on a marché 2 m,
// qu'on court, qu'on se téléporte ou qu'on change d'étage. L'angle de la vraie caméra
// change : un clic vise toujours ce qu'on voit.
const ZOOM_MAX = 6;
let zoom = 1;
let zoomCible = 1;
let boucleZoom = 0;
let instantZoom = 0;
let marcheDepuisZoom = 0;
const oeilZoom = new THREE.Vector3();
let oeilZoomPret = false;
const oeilActuel = new THREE.Vector3();
function zoome(vertical: number) {
  if (zoom === 1) return vertical;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vertical / 2)) / zoom));
}
function lancerZoom() {
  if (boucleZoom) return;
  instantZoom = performance.now();
  boucleZoom = requestAnimationFrame(pasZoom);
}
function pasZoom(t: number) {
  boucleZoom = 0;
  const dt = Math.min(0.1, Math.max(0, (t - instantZoom) / 1000));
  instantZoom = t;
  if (!visite || estOrtho()) zoomCible = 1;
  if (zoomCible > 1) {
    controles.getPosition(oeilActuel);
    if (oeilZoomPret) {
      const d = Math.hypot(oeilActuel.x - oeilZoom.x, oeilActuel.z - oeilZoom.z);
      marcheDepuisZoom += d;
      const saut = d > 1.5 || Math.abs(oeilActuel.y - oeilZoom.y) > 1.5; // téléportation, étage
      if (saut || marcheDepuisZoom >= 2 || (courseEnCours() && d > 0.005)) zoomCible = 1;
    }
    oeilZoom.copy(oeilActuel);
    oeilZoomPret = true;
  }
  // On resserre vite, on revient plus doucement.
  zoom += (zoomCible - zoom) * (1 - Math.exp(-dt * (zoomCible > zoom ? 12 : 4.5)));
  if (Math.abs(zoom - zoomCible) < 0.004) zoom = zoomCible;
  appliquerAngle(zoom === zoomCible);
  if (zoom !== zoomCible || zoomCible > 1) boucleZoom = requestAnimationFrame(pasZoom);
}
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!visite || estOrtho()) return;
    e.preventDefault();
    const cran = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomCible = THREE.MathUtils.clamp(zoomCible * Math.exp(-cran * 0.002), 1, ZOOM_MAX);
    if (zoomCible < 1.02) zoomCible = 1;
    // La distance de marche se compte à partir du dernier coup de molette.
    marcheDepuisZoom = 0;
    oeilZoomPret = false;
    lancerZoom();
  },
  { passive: false },
);
/** Remet l'angle normal tout de suite (entrée ou sortie de visite). */
function annulerZoom() {
  zoom = zoomCible = 1;
  if (boucleZoom) cancelAnimationFrame(boucleZoom);
  boucleZoom = 0;
}

/** Petit cône de vision, plus ou moins ouvert selon l'angle de visite. */
function iconeAngle(a: AngleVisite) {
  const [x1, y1, x2] = a === "serre" ? [8, 5, 16] : a === "normal" ? [4.5, 6, 19.5] : [2, 9, 22];
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M${x1} ${y1}L12 19L${x2} ${y1}"/></svg>`;
}
const nomAngle = (a: AngleVisite) => ANGLES_VISITE.find((x) => x.cle === a)!.nom;

function majBoutonProjection() {
  if (!btnProjection) return;
  const ortho = estOrtho();
  btnProjection.classList.toggle("actif", ortho);
  btnProjection.innerHTML = ortho ? ICONE_ORTHO : visite ? iconeAngle(angleVisite) : `<span>${angle}°</span>`;
  btnProjection.title = ortho
    ? "Vue orthogonale (sans perspective). Toucher : perspective. Appui long : angle de vue."
    : visite
      ? `Angle de vue : ${nomAngle(angleVisite).toLowerCase()}. Toucher : vue orthogonale. Appui long : changer l'angle.`
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
/** Angle de la visite : serré, normal ou grand angle (aussi depuis le panneau « Mode jeu »). */
export function choisirAngleVisite(a: AngleVisite) {
  angleVisite = a;
  try {
    localStorage.setItem(CLE_ANGLE_VISITE, a);
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
// En tournant le téléphone, l'angle de visite se recalcule pour la nouvelle forme d'écran.
window.addEventListener("resize", () => visite && appliquerAngle());

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
  if (visite) {
    for (const a of ANGLES_VISITE) {
      const b = bouton("choix-angle-option" + (!estOrtho() && a.cle === angleVisite ? " actif" : ""), "", () => {
        fermerAngles();
        choisirAngleVisite(a.cle);
      });
      b.innerHTML = `${iconeAngle(a.cle)}<span>${a.nom}</span>`;
      liste.append(b);
    }
  } else {
    for (const a of ANGLES) {
      const b = bouton("choix-angle-option" + (!estOrtho() && a === angle ? " actif" : ""), `${a}°`, () => {
        fermerAngles();
        choisirAngle(a);
      });
      liste.append(b);
    }
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

/** Entrée et sortie de la visite : la molette et les deux doigts reprennent leur rôle à la sortie. */
export function definirVisite(actif: boolean) {
  visite = actif;
  annulerZoom();
  definirVueFixe(actif);
  finRegard();
  if (!actif) {
    const ortho = monde.camera.projection.current === "Orthographic";
    controles.mouseButtons.wheel = (ortho ? ACTION.ZOOM : ACTION.DOLLY) as never;
    const pincer = (ortho ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK) as never;
    controles.touches.two = pincer;
    controles.touches.three = pincer;
  }
  reglerBoutons();
  // La visite a ses propres angles de vue (plus larges).
  appliquerAngle();
  majBoutonProjection();
}

// --- Clavier : marcher dans la maquette, comme dans un jeu vidéo -------------------------
// ZQSD (clavier français) / WASD (clavier anglais) : marcher. On lit la place de la
// touche, pas la lettre, donc les deux claviers marchent. Maj : courir.
// Flèches : en visite (et en mode œil), elles tournent la tête ; ailleurs, elles marchent.
// E / A (Q sur clavier anglais), Page haut / bas : monter, descendre (en visite : changer
// d'étage, voir visite.ts).

type Sens = "avant" | "arriere" | "gauche" | "droite" | "haut" | "bas";
const TOUCHES: Record<string, Sens> = {
  ArrowUp: "avant",
  KeyW: "avant",
  ArrowDown: "arriere",
  KeyS: "arriere",
  ArrowLeft: "gauche",
  KeyA: "gauche",
  ArrowRight: "droite",
  KeyD: "droite",
  PageUp: "haut",
  KeyE: "haut",
  PageDown: "bas",
  KeyQ: "bas",
};
const FLECHES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

// Anti-gravité (visite) : on n'est plus collé au niveau. Z avance là où l'on regarde
// (on monte en regardant vers le haut) ; Espace / E montent, C / A descendent.
let vol = false;
// Mode drone : sans gravité aussi, mais piloté comme un drone (deux manettes, élan, inertie).
let drone = false;
export const volLibre = () => (vol || drone) && visite;
export const modeDrone = () => drone && visite;
export function definirVol(oui: boolean) {
  vol = oui;
  if (oui) drone = false;
}
export function definirDrone(oui: boolean) {
  drone = oui;
  if (oui) vol = false;
  else commanderDrone("clavier", null);
}
/** Tourne la vue sur l'axe vertical (degrés, positif vers la droite), même suivie par les capteurs. */
export function tournerRegard(lacet: number) {
  if (regardExterne) regardExterne(lacet);
  else tournerTete(lacet, 0);
}

const sensDe = (e: KeyboardEvent): Sens | undefined => {
  const s = TOUCHES[e.key] ?? TOUCHES[e.code];
  if (s || !volLibre()) return s;
  return e.code === "Space" ? "haut" : e.code === "KeyC" ? "bas" : undefined;
};

// Courir, comme dans les jeux : Maj maintenue (Call of Duty sur ordinateur), ou Z tapé
// deux fois puis gardé enfoncé ; au téléphone, manette poussée au-delà du bord (visite.ts).
let doubleZ = false;
let dernierZ = 0;
let courseManette = false;
export function definirCourseManette(oui: boolean) {
  courseManette = oui;
}
const enCourse = () => rapide || doubleZ;
/** Touches enfoncées (par place sur le clavier) et le sens de chacune. */
const enfoncees = new Map<string, Sens>();
let rapide = false;
let dernier = 0;
let boucle = 0;
const VITESSE = 4; // mètres par seconde, hors visite
const REGARD_LACET = 100; // flèches gauche / droite : degrés par seconde
const REGARD_TANGAGE = 70; // flèches haut / bas

// Vitesse de déplacement en visite (clavier et manette), au choix.
export type Allure = "lente" | "moyenne" | "rapide";
const ALLURES: Record<Allure, number> = { lente: 1.5, moyenne: 3, rapide: 6 }; // m/s
const CLE_ALLURE = "nexbim-allure";
let allure: Allure = "moyenne";
try {
  const a = localStorage.getItem(CLE_ALLURE) as Allure | null;
  if (a && a in ALLURES) allure = a;
} catch {
  // Moyenne par défaut.
}
export const allureVisite = () => allure;
/** Vitesse de marche en visite (m/s), manette poussée à fond ou touche enfoncée. */
export const vitesseVisite = () => ALLURES[allure];
/** Passe à la vitesse suivante : lente → moyenne → rapide → lente. */
export function allureSuivante(): Allure {
  const ordre: Allure[] = ["lente", "moyenne", "rapide"];
  allure = ordre[(ordre.indexOf(allure) + 1) % ordre.length];
  try {
    localStorage.setItem(CLE_ALLURE, allure);
  } catch {
    // Gardée pour la session.
  }
  return allure;
}

/** On court en visite : Maj tenue avec une touche de marche (pas les flèches du regard). */
export function courseEnCours() {
  if (!visite) return false;
  if (courseManette) return true;
  if (!enCourse()) return false;
  for (const [code, s] of enfoncees) {
    if (FLECHES.has(code)) continue;
    if (s === "avant" || s === "arriere" || s === "gauche" || s === "droite") return true;
  }
  return false;
}

function pas(t: number) {
  boucle = 0;
  if (!enfoncees.size) return;
  const dt = Math.min(0.25, (t - dernier) / 1000);
  dernier = t;
  const facteur = enCourse() ? (visite ? 2 : 3) : 1;
  const tete = oeil || visite;
  const marche = new Set<Sens>();
  const regarde = new Set<Sens>();
  for (const [code, s] of enfoncees) (tete && FLECHES.has(code) ? regarde : marche).add(s);
  const sens = (dans: Set<Sens>, plus: Sens, moins: Sens) => (dans.has(plus) ? 1 : 0) - (dans.has(moins) ? 1 : 0);
  const avance = sens(marche, "avant", "arriere");
  // Gauche / droite : pas de côté, comme dans un jeu vidéo (la souris sert à tourner la tête).
  const cote = sens(marche, "droite", "gauche");
  // En visite, on reste à hauteur d'yeux : ces touches changent d'étage (visite.ts),
  // sauf en anti-gravité où elles font monter et descendre.
  const volant = volLibre();
  const monte = visite && !volant ? 0 : sens(marche, "haut", "bas");
  let lacet = sens(regarde, "droite", "gauche");
  const tangage = sens(regarde, "arriere", "avant");
  if (modeDrone()) {
    // Drone : poussée avec élan ; ← → font pivoter le drone sur place (avec inertie aussi).
    commanderDrone("clavier", { avance, cote, monte, lacet, vitesse: vitesseVisite() * facteur, aPlat: true });
    lacet = 0;
    if (tangage) tournerTete(0, tangage * REGARD_TANGAGE * dt);
    boucle = requestAnimationFrame(pas);
    return;
  }
  if (lacet || tangage) {
    const k = dt * (rapide ? 1.6 : 1);
    if (regardExterne) {
      if (lacet) regardExterne(lacet * REGARD_LACET * k);
    } else tournerTete(lacet * REGARD_LACET * k, tangage * REGARD_TANGAGE * k);
  }

  if (avance || cote || monte) {
    if (avance && !visite && monde.camera.projection.current === "Orthographic") {
      // Sans perspective, avancer ne change rien à l'image : on agrandit la vue. En visite,
      // on avance vraiment : la coupe suit l'œil (sinon elle restait en arrière).
      const cam = monde.camera.three as THREE.OrthographicCamera;
      void controles.zoomTo(cam.zoom * (1 + avance * dt * 1.2 * facteur), false);
    }
    const position = controles.getPosition(new THREE.Vector3());
    const cible = controles.getTarget(new THREE.Vector3());
    // On marche à plat, dans la direction du regard (en anti-gravité : droit devant soi,
    // vers le haut ou le bas).
    const devant = cible.clone().sub(position);
    if (!volant) devant.setY(0);
    if (devant.lengthSq() < 1e-6) {
      monde.camera.three.updateMatrixWorld();
      devant.setFromMatrixColumn(monde.camera.three.matrixWorld, 1).setY(0);
    }
    devant.normalize();
    const droite = devant.clone().cross(new THREE.Vector3(0, 1, 0));
    const d = devant.multiplyScalar(avance).addScaledVector(droite, cote);
    if (d.lengthSq() > 1) d.normalize();
    d.multiplyScalar((visite ? vitesseVisite() : VITESSE) * facteur * dt);
    d.y += monte * (visite ? vitesseVisite() : VITESSE * 0.75) * facteur * dt;
    position.add(d);
    cible.add(d);
    void controles.setLookAt(position.x, position.y, position.z, cible.x, cible.y, cible.z, false);
  }
  boucle = requestAnimationFrame(pas);
}

window.addEventListener("keydown", (e) => {
  rapide = e.shiftKey;
  const s = sensDe(e);
  if (!s || e.ctrlKey || e.metaKey || e.altKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable], .dialogue")) return;
  e.preventDefault();
  if (enfoncees.has(e.code)) return;
  // Z tapé deux fois de suite (moins de 0,35 s) : on court tant qu'il reste enfoncé.
  if (e.code === "KeyW" && !e.repeat) {
    // Heure de la frappe (pas du traitement) : juste même si une image tarde.
    const t = e.timeStamp;
    doubleZ = t - dernierZ < 350;
    dernierZ = t;
  }
  if (!enfoncees.size) recentrerPivot();
  enfoncees.set(e.code, s);
  if (!boucle) {
    dernier = performance.now();
    boucle = requestAnimationFrame(pas);
  }
});
window.addEventListener("keyup", (e) => {
  rapide = e.shiftKey;
  if (e.code === "KeyW") doubleZ = false;
  enfoncees.delete(e.code);
  if (!enfoncees.size) commanderDrone("clavier", null);
});
window.addEventListener("blur", () => {
  enfoncees.clear();
  commanderDrone("clavier", null);
  doubleZ = rapide = false;
});

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
  bornerOrtho();
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

// --- Vue orthogonale : profondeur de dessin ----------------------------------------
// Rien n'est dessiné derrière la caméra (l'ombrage des creux y donnait des zones
// noires) ; devant, on voit jusqu'au bout de la maquette, même de très loin.
const centreBoite = new THREE.Vector3();
function bornerOrtho() {
  const o = monde.camera.threeOrtho;
  boiteScene.getCenter(centreBoite);
  const loin = Math.max(5000, o.position.distanceTo(centreBoite) + boiteScene.min.distanceTo(boiteScene.max));
  if (o.near !== 0.05 || Math.abs(o.far - loin) > loin * 0.1) {
    o.near = 0.05;
    o.far = loin;
    o.updateProjectionMatrix();
  }
}
