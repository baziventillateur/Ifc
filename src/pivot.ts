// Navigation au doigt et à la souris. Au premier doigt (ou clic gauche), le point de la
// maquette sous le pointeur devient le centre de rotation, sans faire bouger la vue ;
// la vitesse de rotation et de zoom suit celle du geste.
import { modeOeil } from "./navigation";
import { completerTir } from "./deplacements";
import * as THREE from "three";
import { cree, lanceur, monde, recentrerPivot } from "./noyau";
import { maquettes } from "./registre";

const canvas = monde.renderer!.three.domElement;
const enCours = new Set<number>();
let tour = 0;
let depart: { x: number; y: number; id: number } | null = null;
let pivotPose = false;
/** Point de la maquette touché par le premier doigt : sa distance donne l'allure du zoom. */
let pointTouche: THREE.Vector3 | null = null;
/** Point de la maquette entre les deux doigts (pincement en cours). */
let pointPince: THREE.Vector3 | null = null;
/** Distance actuelle de la caméra à un point (elle change pendant le zoom). */
const distanceA = (p: THREE.Vector3 | null) => (p ? monde.camera.three.position.distanceTo(p) : null);
/** Dernier point de la maquette touché ou visé : estimation tant qu'un tir n'a pas répondu. */
let dernierPoint: THREE.Vector3 | null = null;
const doigts = new Map<number, { x: number; y: number }>();

// Petit repère du pivot, visible pendant la rotation.
const repere = cree("div", "repere-pivot");
repere.hidden = true;
document.body.append(repere);

function ndc(x: number, y: number) {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}

canvas.addEventListener("pointerdown", (e) => {
  enCours.add(e.pointerId);
  doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // Deux doigts : zoom et déplacement, on garde le pivot du premier doigt, et on
  // mesure ce qui est entre les deux doigts (c'est vers là qu'on zoome).
  if (enCours.size === 2) {
    caleCible(distanceA(pointTouche) ?? profondeurEstimee());
    const [a, b] = [...doigts.values()];
    if (a && b) {
      const position = ndc((a.x + b.x) / 2, (a.y + b.y) / 2);
      const mien = tour;
      pointPince = null;
      void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
        .then((brut) => {
          const hit = completerTir(brut, position);
          if (hit?.point) dernierPoint = (hit.point as THREE.Vector3).clone();
          if (mien !== tour || !hit?.point) return;
          pointPince = (hit.point as THREE.Vector3).clone();
          if (enCours.size > 1) caleCible(distanceA(pointPince));
        })
        .catch(() => {});
    }
  }
  if (enCours.size > 1) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.shiftKey) return;
  const mien = ++tour;
  pivotPose = false;
  pointTouche = null;
  pointPince = null;
  depart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  const r = canvas.getBoundingClientRect();
  const position = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((brut) => {
      const hit = completerTir(brut, position);
      if (hit?.point) dernierPoint = (hit.point as THREE.Vector3).clone();
      if (mien !== tour || !hit?.point) return;
      monde.camera.controls.setOrbitPoint(hit.point.x, hit.point.y, hit.point.z);
      pointTouche = (hit.point as THREE.Vector3).clone();
      dernierPoint = (hit.point as THREE.Vector3).clone();
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

window.addEventListener(
  "pointermove",
  (e) => {
    if (doigts.has(e.pointerId)) doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  },
  true,
);
let dernierMilieu: { x: number; y: number } | null = null;
window.addEventListener(
  "pointermove",
  () => {
    if (doigts.size === 2) {
      const [a, b] = [...doigts.values()];
      dernierMilieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  },
  true,
);
const oublierDoigt = (e: PointerEvent) => {
  const etait = doigts.get(e.pointerId);
  doigts.delete(e.pointerId);
  if (doigts.size > 0 || e.pointerType === "mouse" || !etait) return;
  const ou = dernierMilieu ?? etait;
  dernierMilieu = null;
  window.setTimeout(() => {
    if (doigts.size) return;
    const position = ndc(ou.x, ou.y);
    void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
      .then((brut) => {
        const hit = completerTir(brut, position);
        if (hit?.point) dernierPoint = (hit.point as THREE.Vector3).clone();
      })
      .catch(() => {});
  }, 250);
};
window.addEventListener("pointerup", oublierDoigt, true);
window.addEventListener("pointercancel", oublierDoigt, true);

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

/** Estimation de la distance de ce qu'on regarde, quand aucun tir n'a encore répondu. */
function profondeurEstimee() {
  if (dernierPoint) {
    const cam = monde.camera.three;
    const vers = dernierPoint.clone().sub(cam.position);
    if (vers.dot(cam.getWorldDirection(new THREE.Vector3())) > 0) return vers.length();
  }
  return profondeurScene();
}

/**
 * Allure du zoom. Le pas de la bibliothèque est proportionnel à la distance de la cible
 * de la caméra, qui n'a souvent rien à voir avec ce qu'on regarde (après une vue
 * orthogonale, un regard, un cadrage…). On le ramène à la distance réelle d de ce qui
 * est sous les doigts ou la souris. Sans mesure sûre (tir pas encore revenu, sur une
 * grosse maquette), on n'est jamais plus lent que la bibliothèque : zoom vif partout.
 */
// En vue orthogonale, le zoom est un peu plus vif (il n'y a pas l'effet d'approche).
const ALLURE_ORTHO = 1.4;
// Distance plancher : le zoom avance d'une part de la distance de ce qu'on vise, ce qui
// le faisait ralentir sans fin en approchant d'un mur (jamais traversé). En deçà de
// cette distance, il avance comme si l'objet visé était à PLANCHER mètres, donc
// derrière le mur : on garde l'allure et on passe au travers.
const PLANCHER = 2;

function allurePour(d: number | null, sure: boolean) {
  if (monde.camera.projection.current !== "Perspective") return ALLURE_ORTHO;
  if (d === null || !(d > 0)) {
    d = profondeurEstimee();
    sure = false;
  }
  if (d === null || !(d > 0)) return 1;
  d = Math.max(d, PLANCHER);
  const rayon = Math.max(0.5, monde.camera.controls.distance);
  return Math.min(8, Math.max(sure ? 0.1 : 0.5, d / rayon));
}

/**
 * Le zoom ne peut pas avancer plus loin que la cible de la caméra à chaque pas : si
 * elle est bien plus près que ce qu'on regarde, il piétine (c'était la lenteur en
 * perspective). Au début de chaque zoom, la cible est remise dans l'axe de la vue, à
 * la distance de ce qu'on regarde. L'image ne bouge pas.
 */
function caleCible(d: number | null) {
  if (monde.camera.projection.current !== "Perspective" || d === null || !(d > 0)) return;
  const c = monde.camera.controls;
  const voulu = Math.max(d, c.minDistance, 0.5);
  if (c.distance > voulu * 2 || c.distance < voulu / 2) recentrerPivot(voulu);
}

function allureZoom() {
  const d = distanceA(pointPince ?? pointTouche);
  return allurePour(d, d !== null);
}

// --- Vitesse : plus vive au doigt, et proportionnelle à la vitesse du geste ----------

const controles = monde.camera.controls;
// La vue suit le doigt de plus près (moins de traîne).
controles.draggingSmoothTime = 0.07;

// Au téléphone, l'écran est petit : la rotation va nettement plus vite qu'à la souris.
const BASE = {
  touch: { rotation: 2.4, zoom: 2.0 },
  pen: { rotation: 2.4, zoom: 2.0 },
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
/** Profondeur d'un point devant la caméra, le long de l'axe de la vue (négative s'il est derrière). */
function profondeurDevant(p: THREE.Vector3) {
  const cam = monde.camera.three;
  return p.clone().sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3()));
}

// --- Vue orthogonale : la caméra ne bouge pas en zoomant ---------------------------
// Elle avançait avec le zoom pour traverser les murs, mais sans perspective le plan de
// coupe de la caméra tranche toute la largeur de l'image : on voyait une coupe qui
// suivait la caméra. La vue orthogonale montre maintenant toujours la maquette entière
// (navigation.ts) ; pour voir l'intérieur : la coupe (ciseaux) ou la perspective.

// --- Molette : même règle, avec la distance de ce qui est sous la souris ---------------
const toile = monde.renderer!.three.domElement;
let visee: { point: THREE.Vector3 | null; x: number; y: number; t: number } | null = null;
let tirVisee = 0;
let attenteVisee = 0;
let derniereMolette = 0;

function viserSous(x: number, y: number) {
  const r = toile.getBoundingClientRect();
  const position = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  const mien = ++tirVisee;
  void (lanceur.castRay({ position, items: [] } as any) as Promise<any>)
    .then((brut) => {
      if (mien !== tirVisee) return;
      const hit = completerTir(brut, position);
      const point = hit?.point ? (hit.point as THREE.Vector3).clone() : null;
      if (point) dernierPoint = point;
      visee = { point, x, y, t: performance.now() };
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
      !!visee &&
      performance.now() - visee.t < 700 &&
      Math.hypot(visee.x - e.clientX, visee.y - e.clientY) < 40 &&
      (!visee.point || profondeurDevant(visee.point) > 0.05);
    if (!frais) viserSous(e.clientX, e.clientY);
    const proche = visee && Math.hypot(visee.x - e.clientX, visee.y - e.clientY) < 80 ? distanceA(visee.point) : null;
    const maintenant = performance.now();
    if (maintenant - derniereMolette > 300) caleCible(proche ?? profondeurEstimee());
    derniereMolette = maintenant;
    controles.dollySpeed = BASE.mouse.zoom * allurePour(proche, proche !== null);
  },
  { capture: true, passive: true },
);
