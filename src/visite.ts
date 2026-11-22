// Visite à la première personne (bouton manette).
// 1. On choisit un niveau (la maquette s'affiche en plan, coupée à 1,20 m du sol), ou on
//    touche directement la maquette à l'endroit où l'on est.
// 2. Sur le plan : on pose le doigt où l'on est ; en le faisant glisser, la flèche du
//    repère s'oriente. On lâche : la vue plonge jusqu'à hauteur d'yeux (animation).
// 3. On marche dans la maquette : un doigt pour regarder autour de soi, la manette à
//    l'écran (ou les flèches du clavier) pour avancer.
// GPS : après un calage sur deux points touchés sur le plan, la position réelle du
// téléphone déplace la vue. Le calage est gardé sur l'appareil pour le jeu de maquettes.
// Capteurs (admin pour l'instant, voir suivi.ts) : caméra AR pour suivre les pas au
// centimètre, ou gyroscope pour orienter la vue en bougeant le téléphone.
import * as THREE from "three";
import { ajusterDecalage, alerte, bloquerDecalage, bouton, cree, definirProjection, el, estOrtho, monde, rafraichir } from "./noyau";
import { definirModeClic, viser } from "./fiche";
import {
  ANGLES_VISITE,
  allureSuivante,
  allureVisite,
  angleDeVisite,
  angleVisiteChoisi,
  bloquerUnDoigt,
  choisirAngleVisite,
  definirCourseManette,
  definirOeil,
  definirRegardExterne,
  definirVisite,
  definirVol,
  modeOeil,
  vitesseVisite,
  volLibre,
} from "./navigation";
import { estAdmin, hauteurTelephone } from "./nuage/projets";
import { replierCalques } from "./maquettes";
import { activerAvancement } from "./avancement";
import { STYLES_PAS, choisirStylePas, ecouterPas, effetActif, reglerEffet, styleDesPas, type Effet } from "./effets";
import { fermerPlan, ouvrirPlan } from "./plan";
import { prendrePhoto } from "./captures";
import { inviterPleinEcran, pleinEcranModifie } from "./plein-ecran";
import {
  arActif,
  arPossible,
  fermerAR,
  fermerGyro,
  garderEcran,
  gyroActif,
  gyroPossible,
  ouvrirAR,
  ouvrirGyro,
  orientationGyro,
  type Lecture as Pose,
} from "./suivi";
import { solsDesNiveaux, type Sol } from "./niveaux";
import { maquettes, visibles } from "./registre";

/** Hauteur de la vue au-dessus du sol : celle du téléphone tenu en main (1,40 m, ou taille − 30 cm). */
const yeux = () => hauteurTelephone();
const COUPE_PLAN = 1.2; // hauteur de la coupe du plan au-dessus du sol (m)
const CALAGE_MS = 5000; // durée de mesure GPS sur chaque point
const PRECISION_MAX = 35; // au-delà (m), une position GPS est ignorée
const ECART_MIN = 8; // distance minimale entre les deux points du calage (m)

const canvas = monde.renderer!.three.domElement;
const controles = monde.camera.controls;
const btnVisite = el<HTMLButtonElement>("btn-visite");

type Etape = "niveau" | "place" | "marche" | "ar" | "gps1" | "gps2" | "recaler" | "mesure";
let actif = false;
let etape: Etape = "niveau";
let niveaux: Sol[] = [];
let niveau: Sol | null = null;
let place: THREE.Vector3 | null = null;
/** La liste des maquettes était-elle repliée avant la visite (elle l'est pendant). */
let calquesReplies = false;
/** Vue d'avant la visite, retrouvée en sortant. */
let avant: { pos: THREE.Vector3; cible: THREE.Vector3; ortho: boolean; oeil: boolean } | null = null;

// --- Panneau (en bas de l'écran) ---------------------------------------------------------

const panneau = cree("div", "visite-panneau");
panneau.hidden = true;
const texte = cree("div", "visite-texte");
const actions = cree("div", "visite-actions");
const fermer = bouton("visite-fermer", "✕", () => void quitter(), "Quitter la visite");
const entete = cree("div", "visite-entete");
const titre = cree("strong", "", "Visite");
const etatGps = cree("span", "visite-gps");
// Replié : il ne reste que la ligne du titre, pour dégager la vue en marchant.
const btnReplier = bouton("replier", "▾", () => replierPanneau(!panneau.classList.contains("replie")), "Replier le panneau");
function replierPanneau(oui: boolean) {
  panneau.classList.toggle("replie", oui);
  btnReplier.setAttribute("aria-label", oui ? "Déplier le panneau" : "Replier le panneau");
  btnReplier.setAttribute("aria-expanded", String(!oui));
}
titre.addEventListener("click", () => replierPanneau(!panneau.classList.contains("replie")));
// En passant en plein écran pendant la marche, le panneau se replie.
pleinEcranModifie.on((plein) => plein && actif && etape === "marche" && replierPanneau(true));
entete.append(titre, etatGps, btnReplier, fermer);
panneau.append(entete, texte, actions);
document.body.append(panneau);

// Bouton photo du chantier : rond orange au-dessus de la manette, visible pendant la marche
// (même panneau replié). La photo est rangée à l'endroit où l'on est, dans la direction du regard.
const btnPhoto = bouton(
  "visite-photo",
  "",
  () => {
    // La caméra AR occupe l'objectif du téléphone : on l'arrête pour la photo.
    if (arActif()) {
      fermerAR();
      alerte("Caméra AR arrêtée pour la photo : relancez-la ensuite.", 3500);
    }
    void prendrePhoto();
  },
  "Photo du chantier, rangée à cet endroit de la maquette",
);
btnPhoto.innerHTML =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/><circle cx="12" cy="12.8" r="3.4"/></svg><span>Photo</span>';
btnPhoto.hidden = true;
document.body.append(btnPhoto);

// La fiche d'un élément s'ouvre en bas (téléphone) ou à droite (ordinateur) : le panneau
// de la visite et la manette se placent à côté au lieu de la recouvrir.
const fiche = document.getElementById("fiche");
function placerPanneau() {
  const ouverte = !!fiche?.classList.contains("ouverte");
  const enBas = window.innerWidth < 820;
  const haut = ouverte && enBas ? Math.round(fiche!.getBoundingClientRect().height) : 0;
  panneau.style.bottom = haut ? `${haut + 8}px` : "";
  panneau.style.right = ouverte && !enBas ? "360px" : "";
  manette.style.bottom = haut ? `${haut + 12}px` : "";
  btnPhoto.style.bottom = haut ? `${haut + 128}px` : "";
}
if (fiche) {
  new MutationObserver(placerPanneau).observe(fiche, { attributes: true, attributeFilter: ["class"] });
  new ResizeObserver(placerPanneau).observe(fiche);
  window.addEventListener("resize", placerPanneau);
}

const puce = (libelle: string, action: () => void, classe = "", aide?: string) =>
  bouton("visite-puce" + (classe ? ` ${classe}` : ""), libelle, action, aide);

// --- Marqueur au sol (sur le plan) ------------------------------------------------------

const marqueur = new THREE.Group();
{
  const mat = (c: string) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true });
  const disque = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat("#ff8a1f"));
  const bord = new THREE.Mesh(new THREE.RingGeometry(1, 1.25, 40), mat("#ffffff"));
  const fleche = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.7, 1.3), new THREE.Vector2(0.7, 1.3), new THREE.Vector2(0, 2.6)])),
    mat("#ff8a1f"),
  );
  fleche.name = "fleche";
  fleche.visible = false;
  for (const m of [disque, bord, fleche]) {
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 999;
    marqueur.add(m);
  }
  marqueur.visible = false;
  monde.scene.three.add(marqueur);
}

function opaciteMarqueur(o: number) {
  marqueur.traverse((m) => {
    const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = o;
  });
}

function poserMarqueur(p: THREE.Vector3, direction?: THREE.Vector3 | null) {
  const cam = monde.camera.three as THREE.OrthographicCamera & THREE.PerspectiveCamera;
  const hauteur = cam.isOrthographicCamera
    ? (cam.top - cam.bottom) / cam.zoom
    : 2 * cam.position.distanceTo(p) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  opaciteMarqueur(1);
  marqueur.scale.setScalar(Math.max(0.15, hauteur * 0.012));
  marqueur.position.set(p.x, p.y + 0.02, p.z);
  const fleche = marqueur.getObjectByName("fleche")!;
  fleche.visible = !!direction;
  // La flèche est dessinée vers -Z (le haut du plan) : on la tourne vers la direction.
  if (direction) marqueur.rotation.y = Math.atan2(-direction.x, -direction.z);
  marqueur.visible = true;
  void rafraichir();
}

// --- Vue en plan d'un niveau -----------------------------------------------------------

const planCoupe = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

function emprise() {
  const b = new THREE.Box3();
  for (const m of visibles()) b.union(m.modele.box);
  return b;
}

async function vueEnPlan(sol: Sol) {
  planCoupe.constant = sol.y + COUPE_PLAN;
  monde.renderer!.setPlane(true, planCoupe);
  if (!estOrtho()) await definirProjection("Orthographic");
  // Cadrage sur les murs et poteaux du niveau (sinon sur toute la maquette, terrain compris).
  const b = sol.emprise.isEmpty() ? emprise() : sol.emprise.clone();
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3());
  // Vue de dessus, nord du plan en haut.
  await controles.setLookAt(c.x, sol.y + 300, c.z + 0.001, c.x, sol.y, c.z, false);
  const zone = new THREE.Box3(new THREE.Vector3(b.min.x, sol.y, b.min.z), new THREE.Vector3(b.max.x, sol.y + 0.5, b.max.z));
  // Marge en bas pour le panneau de la visite.
  await controles.fitToBox(zone, false, { paddingTop: 3, paddingBottom: 10, paddingLeft: 3, paddingRight: 3 });
  await rafraichir();
}

/** Point du sol du niveau sous le doigt (le plan est coupé : on ne vise pas la maquette). */
function pointAuSol(e: { clientX: number; clientY: number }, y: number) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rayon = new THREE.Raycaster();
  monde.camera.three.updateMatrixWorld();
  rayon.setFromCamera(ndc, monde.camera.three);
  const p = new THREE.Vector3();
  return rayon.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
}

// --- Marche --------------------------------------------------------------------------

/** Place l'œil au-dessus d'un point du sol, en regardant dans une direction horizontale. */
async function regarderDepuis(sol: THREE.Vector3, direction: THREE.Vector3) {
  const d = direction.clone().setY(0);
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
  d.normalize();
  const oeil = new THREE.Vector3(sol.x, niveau!.y + yeux(), sol.z);
  const cible = oeil.clone().addScaledVector(d, 3);
  await controles.setFocalOffset(0, 0, 0, false);
  await controles.setLookAt(oeil.x, oeil.y, oeil.z, cible.x, cible.y, cible.z, false);
  controles.update(0);
}

async function entrerEnMarche(direction: THREE.Vector3, anime = true) {
  if (!place || !niveau || enAnimation) return;
  definirModeClic(null);
  bloquerUnDoigt(false);
  if (estOrtho()) await definirProjection("Perspective");
  // À hauteur d'yeux, pas de décalage de mise en page quand la fiche s'ouvre.
  bloquerDecalage(true);
  const d = direction.clone().setY(0);
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
  d.normalize();
  if (anime) await plonger(new THREE.Vector3(place.x, niveau.y + yeux(), place.z), d);
  monde.renderer!.setPlane(false, planCoupe);
  marqueur.visible = false;
  definirVisite(true);
  await regarderDepuis(place, d);
  etape = "marche";
  manette.hidden = !tactile();
  // Suivi par capteurs : la pose du téléphone repart de ce point et de cette direction.
  if (arActif() || gyroActif()) ancrer(direction);
  dessiner();
  if (gyroActif()) relancer();
  await rafraichir();
}

/** Déplace l'œil à plat (garde la hauteur du niveau et la direction du regard) ; en
 * anti-gravité, il garde sa hauteur et peut aussi monter ou descendre. */
function decaler(dx: number, dz: number, haut = 0) {
  if (!niveau) return;
  if (arActif() && ancre) {
    // La caméra AR place la vue à chaque image : on décale son point de départ.
    ancre.p0.x += dx;
    ancre.p0.z += dz;
    return;
  }
  const position = controles.getPosition(new THREE.Vector3());
  const cible = controles.getTarget(new THREE.Vector3());
  const dy = volLibre() ? haut : niveau.y + yeux() - position.y;
  position.x += dx;
  position.z += dz;
  position.y += dy;
  cible.x += dx;
  cible.z += dz;
  cible.y += dy;
  void controles.setLookAt(position.x, position.y, position.z, cible.x, cible.y, cible.z, false);
}

// --- Manette à l'écran (téléphone) -------------------------------------------------------

const tactile = () => window.matchMedia("(pointer: coarse)").matches;
const manette = cree("div", "manette");
const bille = cree("div", "manette-bille");
manette.append(bille);
manette.hidden = true;
document.body.append(manette);
const RAYON_MANETTE = 38;
let poussee: { id: number; cx: number; cy: number; x: number; y: number; course: boolean } | null = null;

manette.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const r = manette.getBoundingClientRect();
  poussee = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: 0, y: 0, course: false };
  manette.setPointerCapture(e.pointerId);
  bouger(e);
  if (!boucle) {
    dernier = performance.now();
    boucle = requestAnimationFrame(avancer);
  }
});
function bouger(e: PointerEvent) {
  if (!poussee || e.pointerId !== poussee.id) return;
  let dx = e.clientX - poussee.cx;
  let dy = e.clientY - poussee.cy;
  const l = Math.hypot(dx, dy);
  // Comme dans les jeux sur téléphone : manette poussée vers l'avant au-delà du bord,
  // on court (la bille devient orange).
  const course = l > RAYON_MANETTE * 1.5 && dy < -Math.abs(dx);
  if (course !== poussee.course) {
    poussee.course = course;
    manette.classList.toggle("course", course);
    definirCourseManette(course);
  }
  if (l > RAYON_MANETTE) {
    dx = (dx / l) * RAYON_MANETTE;
    dy = (dy / l) * RAYON_MANETTE;
  }
  poussee.x = dx / RAYON_MANETTE;
  poussee.y = dy / RAYON_MANETTE;
  bille.style.transform = `translate(${dx}px, ${dy}px)`;
}
manette.addEventListener("pointermove", bouger);
const lacher = (e: PointerEvent) => {
  if (!poussee || e.pointerId !== poussee.id) return;
  poussee = null;
  bille.style.transform = "";
  manette.classList.remove("course");
  definirCourseManette(false);
};
manette.addEventListener("pointerup", lacher);
manette.addEventListener("pointercancel", lacher);

// Boucle d'animation : manette et suivi GPS.
let boucle = 0;
let dernier = 0;
/** Une photo est affichée à son point de vue : la marche (manette, capteurs) attend. */
let suspendu = false;
function avancer(t: number) {
  boucle = 0;
  if (!actif || etape !== "marche" || suspendu) return;
  const dt = Math.min(0.1, (t - dernier) / 1000);
  dernier = t;
  let encore = false;
  if (poussee && (poussee.x || poussee.y)) {
    encore = true;
    const position = controles.getPosition(new THREE.Vector3());
    // En anti-gravité, on avance là où l'on regarde (vers le haut ou le bas).
    const devant = controles.getTarget(new THREE.Vector3()).sub(position);
    if (!volLibre()) devant.setY(0);
    if (devant.lengthSq() > 1e-6) {
      devant.normalize();
      const droite = devant.clone().cross(new THREE.Vector3(0, 1, 0)).setY(0).normalize();
      const d = devant.multiplyScalar(-poussee.y).addScaledVector(droite, poussee.x);
      if (d.lengthSq() > 1) d.normalize();
      d.multiplyScalar(vitesseVisite() * (poussee.course ? 2 : 1) * dt);
      decaler(d.x, d.z, d.y);
    }
  } else if (poussee) {
    encore = true;
  }
  if (suiviGps && cibleGps) {
    // On rejoint la position GPS lissée, sans dépasser une allure de course.
    const p = controles.getPosition(new THREE.Vector3());
    const ecart = new THREE.Vector2(cibleGps.x - p.x, cibleGps.y - p.z);
    const l = ecart.length();
    if (l > 0.05) {
      const pas = l > 40 ? l : Math.min(l, 3 * dt + l * 0.08);
      ecart.multiplyScalar(pas / l);
      decaler(ecart.x, ecart.y);
      encore = true;
    }
  }
  if (gyroActif() && ancre) {
    const q = orientationGyro();
    if (q) {
      devantDe(q, devantTel);
      if (ancre.attente) {
        ancre.theta = lacet(ancre.dir) - lacet(devantTel);
        ancre.tangage = tangageDe(devantTel);
        ancre.attente = false;
      } else if (ancre.recalerTangage) {
        ancre.tangage = tangageDe(devantTel);
        ancre.recalerTangage = false;
      }
      viserDepuis(controles.getPosition(new THREE.Vector3()), devantTel);
    }
  }
  if (encore || suiviGps || gyroActif()) boucle = requestAnimationFrame(avancer);
}
function relancer() {
  if (!boucle) {
    dernier = performance.now();
    boucle = requestAnimationFrame(avancer);
  }
}

// --- GPS ---------------------------------------------------------------------------------

type Lecture = { lat: number; lon: number; prec: number; t: number };
type Calage = { lat0: number; lon0: number; ax: number; az: number; angle: number; le: string };
const R_TERRE = 6371000;
let veille: number | null = null;
const lectures: Lecture[] = [];
let suiviGps = false;
let cibleGps: THREE.Vector2 | null = null;
let calage: Calage | null = null;
let point1: { p: THREE.Vector3; g: Lecture } | null = null;

function cleCalage() {
  const ids = [...maquettes.values()].map((m) => m.id).sort().join("|");
  let h = 5381;
  for (let i = 0; i < ids.length; i++) h = ((h << 5) + h + ids.charCodeAt(i)) >>> 0;
  return `nexbim-calage-gps:${h.toString(36)}`;
}
function lireCalage(): Calage | null {
  try {
    const c = JSON.parse(localStorage.getItem(cleCalage()) ?? "null");
    return c && Number.isFinite(c.angle) ? c : null;
  } catch {
    return null;
  }
}
function ecrireCalage(c: Calage | null) {
  calage = c;
  try {
    if (c) localStorage.setItem(cleCalage(), JSON.stringify(c));
    else localStorage.removeItem(cleCalage());
  } catch {
    // Gardé pour la session seulement.
  }
}

/** Mètres vers l'est et vers le nord depuis un point d'origine. */
function versMetres(lat: number, lon: number, lat0: number, lon0: number) {
  const rad = Math.PI / 180;
  return {
    est: (lon - lon0) * rad * Math.cos(lat0 * rad) * R_TERRE,
    nord: (lat - lat0) * rad * R_TERRE,
  };
}

/** Position GPS → point de la scène (x, z), d'après le calage. */
function versScene(c: Calage, lat: number, lon: number) {
  const { est, nord } = versMetres(lat, lon, c.lat0, c.lon0);
  // Repère « plan » : x vers l'est, z vers le sud ; puis rotation du calage.
  const x0 = est;
  const z0 = -nord;
  const co = Math.cos(c.angle);
  const si = Math.sin(c.angle);
  return new THREE.Vector2(c.ax + x0 * co - z0 * si, c.az + x0 * si + z0 * co);
}

function demarrerGps() {
  if (veille !== null) return true;
  if (!("geolocation" in navigator)) {
    alerte("Ce navigateur ne donne pas accès au GPS.");
    return false;
  }
  veille = navigator.geolocation.watchPosition(
    (pos) => {
      const l = { lat: pos.coords.latitude, lon: pos.coords.longitude, prec: pos.coords.accuracy || 99, t: Date.now() };
      lectures.push(l);
      while (lectures.length > 200) lectures.shift();
      majEtatGps(l.prec);
      if (suiviGps && calage && l.prec <= PRECISION_MAX) {
        const p = versScene(calage, l.lat, l.lon);
        // Lissage : une mesure précise compte davantage.
        const k = THREE.MathUtils.clamp(5 / l.prec, 0.15, 0.8);
        cibleGps = cibleGps ? cibleGps.lerp(p, k) : p;
        relancer();
      }
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        arreterGps();
        alerte("Accès à la position refusé : autorisez-le pour nexbim.paceapp.fr dans les réglages du navigateur.", 6000);
        if (actif) dessiner();
        return;
      }
      // Pas de signal pour l'instant : on l'indique sans interrompre.
      etatGps.textContent = "GPS : pas de signal";
      etatGps.className = "visite-gps faible";
    },
    { enableHighAccuracy: true, maximumAge: 0 },
  );
  return true;
}

function arreterGps() {
  if (veille !== null) navigator.geolocation.clearWatch(veille);
  veille = null;
  suiviGps = false;
  cibleGps = null;
  majEtatGps(null);
}

function majEtatGps(prec: number | null) {
  etatGps.textContent = prec === null ? "" : `GPS ±${Math.round(prec)} m`;
  etatGps.className = "visite-gps" + (prec === null ? "" : prec <= 6 ? " bon" : prec <= 15 ? " moyen" : " faible");
}

/** Moyenne des positions reçues depuis un instant (une mesure précise pèse davantage). */
function moyenne(depuis: number): Lecture | null {
  const l = lectures.filter((x) => x.t >= depuis && x.prec <= PRECISION_MAX * 2);
  if (!l.length) return null;
  let sp = 0;
  let lat = 0;
  let lon = 0;
  for (const x of l) {
    const p = 1 / (x.prec * x.prec);
    sp += p;
    lat += x.lat * p;
    lon += x.lon * p;
  }
  return { lat: lat / sp, lon: lon / sp, prec: Math.min(...l.map((x) => x.prec)), t: Date.now() };
}

/** Mesure GPS de quelques secondes sur un point (le téléphone reste immobile). */
async function mesurer(): Promise<Lecture | null> {
  const debut = Date.now();
  const precedente = etape;
  etape = "mesure";
  for (let s = Math.ceil(CALAGE_MS / 1000); s > 0; s--) {
    texte.textContent = `Mesure GPS… restez immobile (${s} s).`;
    actions.replaceChildren();
    await new Promise((r) => setTimeout(r, 1000));
    if (!actif) return null;
  }
  etape = precedente;
  // Rien reçu pendant la mesure : la dernière position récente fera l'affaire.
  return moyenne(debut) ?? moyenne(Date.now() - 20000);
}

async function placerPointGps(e: PointerEvent) {
  if (!niveau) return;
  const p = pointAuSol(e, niveau.y);
  if (!p) return;
  poserMarqueur(p);
  definirModeClic(null);
  const g = await mesurer();
  if (!actif) return;
  if (!g) {
    alerte("Pas de position GPS reçue. Rapprochez-vous d'une ouverture, puis recommencez.", 6000);
    armerClic();
    dessiner();
    return;
  }
  if (etape === "gps1") {
    point1 = { p, g };
    etape = "gps2";
    armerClic();
    dessiner();
    return;
  }
  if (etape === "recaler" && calage) {
    // Même orientation, on corrige seulement le décalage.
    const ici = versScene(calage, g.lat, g.lon);
    ecrireCalage({ ...calage, ax: calage.ax + p.x - ici.x, az: calage.az + p.z - ici.y, le: new Date().toISOString() });
    place = p;
    cibleGps = new THREE.Vector2(p.x, p.z);
    suiviGps = true;
    await entrerEnMarche(regardAvantPlan.clone());
    relancer();
    alerte(`Position recalée (GPS ±${Math.round(g.prec)} m).`, 3500);
    return;
  }
  // Second point : orientation du plan par rapport au nord.
  const a = point1!;
  const plan = new THREE.Vector2(p.x - a.p.x, p.z - a.p.z);
  const { est, nord } = versMetres(g.lat, g.lon, a.g.lat, a.g.lon);
  const terrain = new THREE.Vector2(est, -nord);
  if (plan.length() < ECART_MIN) {
    alerte(`Les deux points sont trop proches (${plan.length().toFixed(0)} m) : éloignez-vous d'au moins 20 m.`, 6000);
    armerClic();
    dessiner();
    return;
  }
  const angle = Math.atan2(plan.y, plan.x) - Math.atan2(terrain.y, terrain.x);
  ecrireCalage({ lat0: a.g.lat, lon0: a.g.lon, ax: a.p.x, az: a.p.z, angle, le: new Date().toISOString() });
  const rapport = terrain.length() / plan.length();
  place = p;
  suiviGps = true;
  cibleGps = new THREE.Vector2(p.x, p.z);
  await entrerEnMarche(new THREE.Vector3(plan.x, 0, plan.y));
  relancer();
  alerte(
    rapport < 0.65 || rapport > 1.5
      ? `Calage fait, mais le GPS est imprécis ici (${terrain.length().toFixed(0)} m mesurés pour ${plan.length().toFixed(0)} m sur le plan). Recalez dès que possible.`
      : "Calage fait : la vue suit maintenant votre position.",
    6000,
  );
}

// --- Capteurs du téléphone (admin) ----------------------------------------------------------
// La pose du téléphone est relative à son point de départ : on l'« ancre » sur la position
// et la direction de la vue (theta = rotation entre le repère du téléphone et la maquette).

type Ancre = {
  attente: boolean;
  dir: THREE.Vector3;
  p0: THREE.Vector3;
  x0: THREE.Vector3;
  theta: number;
  /** Inclinaison du téléphone tenu « droit » au départ : elle devient l'horizontale. */
  tangage: number;
  /** Portrait ↔ paysage : on reprend l'horizontale à la mesure suivante. */
  recalerTangage: boolean;
};
let ancre: Ancre | null = null;
let arDispo = false;
void arPossible.then((v) => (arDispo = v));
let arPerdu = true;
/** Dernière position donnée par la caméra AR (téléphone et vue), pour corriger la direction sur place. */
const derniere = { xr: new THREE.Vector3(), vue: new THREE.Vector3(), ok: false };
const AXE_Y = new THREE.Vector3(0, 1, 0);
const devantTel = new THREE.Vector3();
/** Cap d'une direction (0 = vers -Z, le haut du plan). */
const lacet = (d: THREE.Vector3) => Math.atan2(-d.x, -d.z);
const devantDe = (q: THREE.Quaternion, sortie: THREE.Vector3) => sortie.set(0, 0, -1).applyQuaternion(q);

/** La prochaine mesure du téléphone correspondra à la vue actuelle (ou à la direction donnée). */
function ancrer(direction?: THREE.Vector3) {
  const p = controles.getPosition(new THREE.Vector3());
  const d = direction ? direction.clone() : controles.getTarget(new THREE.Vector3()).sub(p);
  d.setY(0);
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
  ancre = { attente: true, dir: d.normalize(), p0: p, x0: new THREE.Vector3(), theta: 0, tangage: 0, recalerTangage: false };
  derniere.ok = false;
  majRegard();
}

/**
 * Inclinaison du téléphone (vers le haut > 0). Au-delà de 30°, on ne la prend pas pour
 * l'horizontale : on considère que le téléphone visait le sol ou le plafond.
 */
function tangageDe(devant: THREE.Vector3) {
  const t = Math.asin(THREE.MathUtils.clamp(devant.y, -1, 1));
  return Math.abs(t) <= THREE.MathUtils.degToRad(30) ? t : 0;
}
window.matchMedia("(orientation: landscape)").addEventListener("change", () => {
  if (ancre) ancre.recalerTangage = true;
});

/** Regarde depuis pos dans la direction du téléphone, tournée vers la maquette. */
function viserDepuis(pos: THREE.Vector3, devant: THREE.Vector3) {
  const d = devant.clone().applyAxisAngle(AXE_Y, ancre!.theta);
  // Jamais tout à fait à la verticale : la caméra ne saurait plus où est le haut.
  const plat = Math.hypot(d.x, d.z);
  if (plat < 1e-3) return;
  // Le téléphone tenu comme au départ regarde à l'horizontale.
  const tangage = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) - ancre!.tangage, -1.33, 1.33);
  // Vue orthogonale : coupe verticale, regard horizontal (seul le cap du téléphone compte).
  d.y = estOrtho() ? 0 : Math.sin(tangage);
  const k = Math.sqrt(1 - d.y * d.y) / plat;
  d.x *= k;
  d.z *= k;
  void controles.setLookAt(pos.x, pos.y, pos.z, pos.x + d.x, pos.y + d.y, pos.z + d.z, false);
}

/** En montant un escalier avec la caméra AR, on change de niveau tout seul. */
function suivreNiveau(sol: number) {
  let n: Sol | null = null;
  for (const s of niveaux) if (s.y <= sol + 0.6) n = s;
  n ??= niveaux[0] ?? null;
  if (n && n !== niveau) {
    niveau = n;
    dessiner();
  }
}

function surImageAR(l: Pose) {
  if (!actif || !ancre || suspendu) return;
  if (l.perdu !== arPerdu) {
    arPerdu = l.perdu;
    if (etape === "marche") dessiner();
  }
  if (etape !== "marche" || l.perdu) return;
  devantDe(l.quat, devantTel);
  if (ancre.attente) {
    ancre.x0.copy(l.pos);
    ancre.theta = lacet(ancre.dir) - lacet(devantTel);
    ancre.tangage = tangageDe(devantTel);
    ancre.attente = false;
  } else if (ancre.recalerTangage) {
    ancre.tangage = tangageDe(devantTel);
    ancre.recalerTangage = false;
  }
  // Déplacement depuis l'ancrage, tourné dans le repère de la maquette ; la hauteur suit aussi.
  const v = l.pos.clone().sub(ancre.x0);
  const monte = v.y;
  v.setY(0).applyAxisAngle(AXE_Y, ancre.theta);
  const pos = new THREE.Vector3(ancre.p0.x + v.x, ancre.p0.y + monte, ancre.p0.z + v.z);
  viserDepuis(pos, devantTel);
  derniere.xr.copy(l.pos);
  derniere.vue.copy(pos);
  derniere.ok = true;
  suivreNiveau(pos.y - yeux());
}

function majRegard() {
  definirRegardExterne(
    actif && (arActif() || gyroActif())
      ? (l) => {
          if (!ancre || ancre.attente) return;
          // On tourne sur place : le point de départ devient l'endroit où l'on est.
          if (arActif() && derniere.ok) {
            ancre.p0.copy(derniere.vue);
            ancre.x0.copy(derniere.xr);
          }
          ancre.theta -= THREE.MathUtils.degToRad(l);
        }
      : null,
  );
}

async function lancerAR() {
  // Appelé depuis le toucher sur « Démarrer » : la session doit s'ouvrir tout de suite.
  if (gyroActif()) fermerGyro();
  if (suiviGps) arreterGps();
  etape = "marche";
  arPerdu = true;
  ancrer();
  const erreur = await ouvrirAR(surImageAR, finAR);
  if (erreur) {
    ancre = null;
    alerte(erreur, 6000);
  }
  majRegard();
  if (actif) dessiner();
}

function finAR() {
  if (!gyroActif()) ancre = null;
  majRegard();
  if (!actif) return;
  if (etape === "ar") etape = "marche";
  dessiner();
}

async function lancerGyro() {
  const erreur = await ouvrirGyro();
  if (erreur) {
    alerte(erreur, 5000);
    return;
  }
  if (!actif || etape !== "marche") return fermerGyro();
  ancrer();
  dessiner();
  relancer();
  alerte("Tenez le téléphone droit devant vous : la vue suit ses mouvements.", 3500);
}

function arreterGyro() {
  fermerGyro();
  ancre = null;
  majRegard();
  dessiner();
}

// --- Se placer : toucher l'endroit, glisser pour orienter la flèche ---------------------
// Sur le plan : on pose le doigt où l'on est (le repère apparaît), on glisse pour tourner
// sa flèche, on lâche pour entrer. Un simple toucher entre avec la direction par défaut.
// Sur la maquette en 3D (choix du niveau) : un toucher place directement (niveau trouvé
// d'après la hauteur du point) ; un appui long puis glisser oriente la flèche.

const SEUIL_PX = 10;
const APPUI_LONG = 320;
/** Direction par défaut : celle de la vue avant la visite, ou du regard avant de repasser en plan. */
const capDefaut = new THREE.Vector3(0, 0, -1);
type Geste = {
  id: number;
  x: number;
  y: number;
  plan: boolean;
  p: THREE.Vector3 | null;
  dir: THREE.Vector3 | null;
  minuterie: number;
  long: boolean;
  /** Appui long : recherche du point touché dans la maquette (en cours ou finie). */
  recherche: Promise<void> | null;
  /** Dernière position du doigt (pour orienter dès que le point est trouvé). */
  dernier: { clientX: number; clientY: number } | null;
};
let geste: Geste | null = null;
const appuis = new Set<number>();

function dirDefaut(p: THREE.Vector3) {
  const d = capDefaut.clone().setY(0);
  if (d.lengthSq() > 1e-6) return d.normalize();
  // Vue de dessus avant la visite : on regarde vers le milieu du niveau.
  const c = (niveau && !niveau.emprise.isEmpty() ? niveau.emprise : emprise()).getCenter(new THREE.Vector3());
  const v = c.sub(p).setY(0);
  return v.lengthSq() > 4 ? v.normalize() : new THREE.Vector3(0, 0, -1);
}

/** Niveau d'un point touché dans la maquette : le plus haut sol sous ce point. */
function niveauSous(y: number) {
  let n: Sol | null = null;
  for (const s of niveaux) if (s.y <= y + 0.25) n = s;
  return n ?? niveaux[0] ?? null;
}

/** Point touché dans la maquette en 3D → endroit où se tenir sur le sol de son niveau. */
async function pointDansMaquette(x: number, y: number) {
  const v = await viser({ clientX: x, clientY: y });
  if (!v) return null;
  const n = niveauSous(v.point.y);
  if (!n) return null;
  const p = v.point.clone();
  // Un mur ou un meuble touché : on se place un peu devant, côté caméra.
  if (p.y - n.y > 0.4) {
    const recul = p.clone().sub(monde.camera.three.position).setY(0);
    if (recul.lengthSq() > 1e-6) p.addScaledVector(recul.normalize(), -0.4);
  }
  p.y = n.y;
  return { p, n };
}

function orienter(e: { clientX: number; clientY: number }, g = geste) {
  if (!g) return;
  g.dernier = { clientX: e.clientX, clientY: e.clientY };
  if (!g.p) return;
  if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < SEUIL_PX) return;
  const q = pointAuSol(e, g.p.y);
  if (!q) return;
  const d = q.sub(g.p).setY(0);
  if (d.lengthSq() < 1e-4) return;
  g.dir = d.normalize();
  if (geste === g) poserMarqueur(g.p, g.dir);
}

canvas.addEventListener("pointerdown", (e) => {
  appuis.add(e.pointerId);
  if (!actif || enAnimation || (etape !== "place" && etape !== "niveau") || !niveaux.length) return;
  if (appuis.size > 1) {
    // Deux doigts : on déplace ou zoome la vue, pas de placement.
    annulerGeste();
    return;
  }
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (etape === "place" && niveau) {
    const p = pointAuSol(e, niveau.y);
    if (!p) return;
    geste = { id: e.pointerId, x: e.clientX, y: e.clientY, plan: true, p, dir: null, minuterie: 0, long: false, recherche: null, dernier: null };
    poserMarqueur(p);
    return;
  }
  // Maquette en 3D : appui long pour poser le repère et l'orienter.
  const g: Geste = { id: e.pointerId, x: e.clientX, y: e.clientY, plan: false, p: null, dir: null, minuterie: 0, long: false, recherche: null, dernier: null };
  g.minuterie = window.setTimeout(() => {
    if (geste !== g) return;
    // Doigt immobile : c'est un appui long, la vue ne tourne plus.
    g.long = true;
    controles.enabled = false;
    navigator.vibrate?.(15);
    g.recherche = pointDansMaquette(g.x, g.y).then((r) => {
      if (!r) return;
      g.p = r.p;
      niveau = r.n;
      if (geste === g) poserMarqueur(r.p);
      if (g.dernier) orienter(g.dernier, g);
    });
  }, APPUI_LONG);
  geste = g;
});

window.addEventListener("pointermove", (e) => {
  if (!geste || e.pointerId !== geste.id) return;
  if (geste.plan || geste.long) return orienter(e);
  // Le doigt bouge avant l'appui long : c'est la vue qu'on tourne.
  if (Math.hypot(e.clientX - geste.x, e.clientY - geste.y) > SEUIL_PX) annulerGeste();
});

window.addEventListener("pointerup", (e) => {
  appuis.delete(e.pointerId);
  if (!geste || e.pointerId !== geste.id) return;
  const g = geste;
  geste = null;
  window.clearTimeout(g.minuterie);
  controles.enabled = true;
  void finirGeste(g, e);
});
window.addEventListener("pointercancel", (e) => {
  appuis.delete(e.pointerId);
  if (geste && e.pointerId === geste.id) annulerGeste();
});

function annulerGeste() {
  if (!geste) return;
  window.clearTimeout(geste.minuterie);
  if (geste.p) {
    // Le repère revient à la place connue (ou disparaît).
    if (place && etape === "place") poserMarqueur(place, regardAvantPlan);
    else marqueur.visible = false;
  }
  geste = null;
  controles.enabled = true;
}

async function finirGeste(g: Geste, e: PointerEvent) {
  if (g.plan || g.long) {
    if (g.recherche) await g.recherche;
    if (!g.p || !niveau) {
      if (g.long) alerte("Touchez une surface de la maquette (sol, mur…).", 2500);
      return;
    }
    place = g.p;
    await entrerEnMarche(g.dir ?? dirDefaut(g.p));
    return;
  }
  // Simple toucher sur la maquette en 3D.
  if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > SEUIL_PX) return;
  const r = await pointDansMaquette(g.x, g.y);
  if (!r || !actif || etape !== "niveau") return;
  niveau = r.n;
  place = r.p;
  const dir = r.p.clone().sub(monde.camera.three.position).setY(0);
  await entrerEnMarche(dir.lengthSq() > 1e-6 ? dir.normalize() : dirDefaut(r.p));
}

// --- Animation d'entrée, comme dans un jeu vidéo ------------------------------------------
// 1. Recul : la caméra prend un peu de champ en s'élargissant à 120°.
// 2. Élan : elle fonce vers l'œil en arrivant par l'arrière, très vite au début, puis
//    ralentit franchement juste avant de s'arrêter ; le regard se redresse, les murs
//    « poussent » (la coupe du plan monte) et l'angle revient à celui de la visite.

let enAnimation = false;
const sortieCubique = (t: number) => 1 - Math.pow(1 - t, 3);
const sortieQuartique = (t: number) => 1 - Math.pow(1 - t, 4);
const entreeSortie = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const palier = (a: number, b: number, t: number) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);

function plonger(oeil: THREE.Vector3, dir: THREE.Vector3) {
  const p0 = controles.getPosition(new THREE.Vector3());
  const t0 = controles.getTarget(new THREE.Vector3());
  const cible = oeil.clone().addScaledVector(dir, 3);
  // Recul : dans l'axe de la vue, un peu plus haut.
  const axe = p0.clone().sub(t0);
  const loin = Math.max(1, axe.length());
  axe.normalize();
  const p1 = p0.clone().addScaledVector(axe, Math.max(2, loin * 0.18));
  p1.y += Math.min(6, loin * 0.05);
  // Élan : courbe qui passe au-dessus et en arrière de l'œil.
  const hauteur = Math.max(4, p1.y - oeil.y);
  const derriere = Math.min(9, 2.5 + hauteur * 0.1);
  const passage = new THREE.Vector3(oeil.x - dir.x * derriere, oeil.y + Math.min(14, hauteur * 0.22), oeil.z - dir.z * derriere);
  const persp = monde.camera.threePersp;
  const fov0 = persp.fov;
  const fovElan = 120;
  const fovFin = angleDeVisite();
  const coupe = monde.renderer!.clippingPlanes.includes(planCoupe);
  const coupe0 = planCoupe.constant;
  const RECUL = 380;
  const ELAN = 880;
  const pos = new THREE.Vector3();
  const vise = new THREE.Vector3();
  enAnimation = true;
  controles.enabled = false;
  return new Promise<void>((fin) => {
    const debut = performance.now();
    const arreter = () => {
      enAnimation = false;
      controles.enabled = true;
      fin();
    };
    const image = (t: number) => {
      if (!actif) return arreter();
      const ecoule = t - debut;
      if (ecoule < RECUL) {
        const k = sortieCubique(ecoule / RECUL);
        pos.copy(p0).lerp(p1, k);
        void controles.setLookAt(pos.x, pos.y, pos.z, t0.x, t0.y, t0.z, false);
        persp.fov = fov0 + (fovElan - fov0) * k;
      } else {
        const u = Math.min(1, (ecoule - RECUL) / ELAN);
        const e = sortieQuartique(u);
        const a = (1 - e) * (1 - e);
        const b = 2 * (1 - e) * e;
        const c = e * e;
        pos.set(
          p1.x * a + passage.x * b + oeil.x * c,
          p1.y * a + passage.y * b + oeil.y * c,
          p1.z * a + passage.z * b + oeil.z * c,
        );
        // Le regard se redresse un peu avant l'arrivée.
        vise.copy(t0).lerp(cible, entreeSortie(palier(0, 0.8, u)));
        void controles.setLookAt(pos.x, pos.y, pos.z, vise.x, vise.y, vise.z, false);
        persp.fov = fovElan + (fovFin - fovElan) * entreeSortie(palier(0.55, 1, u));
        if (coupe) planCoupe.constant = coupe0 + 3.5 * sortieCubique(palier(0, 0.75, u));
        opaciteMarqueur(1 - palier(0, 0.35, u));
        if (u >= 1) {
          persp.updateProjectionMatrix();
          return arreter();
        }
      }
      persp.updateProjectionMatrix();
      requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
}

// --- Étapes ----------------------------------------------------------------------------

function armerClic() {
  definirModeClic(async (e) => {
    if (!niveau) return;
    // Niveau et plan : c'est le geste de placement (plus bas) qui répond.
    if (etape === "gps1" || etape === "gps2" || etape === "recaler") {
      await placerPointGps(e);
    }
  }, "crosshair");
}

async function choisirNiveau(sol: Sol) {
  const enMarche = etape === "marche";
  const ancien = niveau;
  niveau = sol;
  if (enMarche) {
    if (arActif() && ancre && ancien) ancre.p0.y += sol.y - ancien.y;
    // Changement de niveau en marchant : même endroit, autre étage (montée rapide).
    const p = controles.getPosition(new THREE.Vector3());
    if (arActif()) decaler(0, 0);
    else monterVers(sol.y + yeux());
    place = new THREE.Vector3(p.x, sol.y, p.z);
    alerte(`Niveau ${sol.nom}.`, 2000);
    dessiner();
    return;
  }
  etape = "place";
  await vueEnPlan(sol);
  armerClic();
  bloquerUnDoigt(true);
  dessiner();
}

/** Glisse l'œil à la hauteur voulue (les autres mouvements continuent pendant ce temps). */
let montee = 0;
function monterVers(y: number) {
  const id = ++montee;
  const depart = controles.getPosition(new THREE.Vector3()).y;
  const t0 = performance.now();
  const DUREE = 420;
  const pas = (t: number) => {
    if (id !== montee || !actif || etape !== "marche") return;
    // L'horodatage de l'image peut précéder l'appel : on borne à 0.
    const k = THREE.MathUtils.clamp((t - t0) / DUREE, 0, 1);
    const y1 = depart + (y - depart) * (1 - (1 - k) ** 3);
    const p = controles.getPosition(new THREE.Vector3());
    const c = controles.getTarget(new THREE.Vector3());
    void controles.setLookAt(p.x, y1, p.z, c.x, c.y + y1 - p.y, c.z, false);
    if (k < 1) requestAnimationFrame(pas);
  };
  requestAnimationFrame(pas);
}

/** Anti-gravité : on décolle du niveau, ou on retombe sur le sol en dessous. */
function basculerVol() {
  if (!actif || etape !== "marche" || arActif()) return;
  const oui = !volLibre();
  definirVol(oui);
  if (oui) {
    alerte(tactile() ? "Anti-gravité : avancez là où vous regardez." : "Anti-gravité : Z avance là où vous regardez, Espace / C pour monter et descendre.", 3000);
  } else {
    // Le sol sous les pieds : le niveau le plus haut sous l'œil.
    const p = controles.getPosition(new THREE.Vector3());
    const sol = niveauSous(p.y - yeux());
    if (sol) {
      niveau = sol;
      place = new THREE.Vector3(p.x, sol.y, p.z);
      tomberVers(sol.y + yeux());
    }
  }
  dessiner();
}

/** Retombée comme en vrai (de plus en plus vite), ou petite montée si l'on est sous le sol. */
function tomberVers(y: number) {
  const depart = controles.getPosition(new THREE.Vector3()).y;
  const h = depart - y;
  if (h <= 0.05) return monterVers(y);
  const id = ++montee;
  const t0 = performance.now();
  const DUREE = Math.min(1100, Math.max(250, Math.sqrt((2 * h) / 9.81) * 1000));
  const pas = (t: number) => {
    if (id !== montee || !actif || etape !== "marche" || volLibre()) return;
    const k = THREE.MathUtils.clamp((t - t0) / DUREE, 0, 1);
    const y1 = depart - h * k * k;
    const p = controles.getPosition(new THREE.Vector3());
    const c = controles.getTarget(new THREE.Vector3());
    void controles.setLookAt(p.x, y1, p.z, c.x, c.y + y1 - p.y, c.z, false);
    if (k < 1) requestAnimationFrame(pas);
  };
  requestAnimationFrame(pas);
}

/** Étage au-dessus (+1) ou en dessous (−1), au clavier. */
function changerNiveau(sens: 1 | -1) {
  if (!niveau || enAnimation) return;
  const s = niveaux[niveaux.indexOf(niveau) + sens];
  if (!s) return alerte(sens > 0 ? "Vous êtes au dernier niveau." : "Vous êtes au niveau le plus bas.", 1800);
  void choisirNiveau(s);
}

/** Retour au choix du niveau : la vue d'avant la visite revient (on peut y toucher la maquette). */
async function retourNiveaux() {
  etape = "niveau";
  marqueur.visible = false;
  monde.renderer!.setPlane(false, planCoupe);
  bloquerUnDoigt(false);
  definirModeClic(() => undefined);
  const a = avant;
  if (a) {
    await definirProjection(a.ortho ? "Orthographic" : "Perspective");
    await controles.setLookAt(a.pos.x, a.pos.y, a.pos.z, a.cible.x, a.cible.y, a.cible.z, false);
  }
  dessiner();
}

/** Direction du regard au moment de repasser en plan (retrouvée en revenant à la marche). */
const regardAvantPlan = new THREE.Vector3(0, 0, -1);

async function versPlan(e: Etape) {
  if (!niveau) return;
  if (etape === "marche") {
    const p = controles.getPosition(new THREE.Vector3());
    regardAvantPlan.copy(controles.getTarget(new THREE.Vector3()).sub(p));
    capDefaut.copy(regardAvantPlan).setY(0);
    // Le repère du plan montre où l'on est maintenant (on a pu marcher depuis).
    place = new THREE.Vector3(p.x, niveau.y, p.z);
  }
  etape = e;
  bloquerDecalage(false);
  manette.hidden = true;
  btnPhoto.hidden = true;
  definirVisite(false);
  await vueEnPlan(niveau);
  if (place) poserMarqueur(place, regardAvantPlan);
  armerClic();
  bloquerUnDoigt(e === "place");
  dessiner();
}

function listeNiveaux(action: (s: Sol) => void) {
  const liste = cree("div", "visite-niveaux");
  // Du plus haut au plus bas, comme dans un ascenseur.
  for (const s of [...niveaux].reverse()) {
    liste.append(puce(s.nom, () => action(s), s === niveau ? "actif" : ""));
  }
  return liste;
}

// Plan de localisation (radar) pendant la marche : toucher un endroit du plan y emmène.
const lienPlan = {
  get niveaux() {
    return niveaux;
  },
  allerA(sol: Sol, x: number, z: number) {
    if (!actif || etape !== "marche") return;
    const p = controles.getPosition(new THREE.Vector3());
    const d = controles.getTarget(new THREE.Vector3()).sub(p);
    const ancien = niveau;
    // En anti-gravité, on garde sa hauteur au-dessus du sol du niveau.
    const y = volLibre() && ancien ? p.y + sol.y - ancien.y : sol.y + yeux();
    niveau = sol;
    place = new THREE.Vector3(x, sol.y, z);
    if (arActif() && ancre) {
      ancre.p0.x += x - p.x;
      ancre.p0.z += z - p.z;
      ancre.p0.y += y - p.y;
    } else {
      void controles.setLookAt(x, y, z, x + d.x, y + d.y, z + d.z, false);
    }
    if (ancien !== sol) alerte(`Niveau ${sol.nom}.`, 1800);
    dessiner();
    void rafraichir();
  },
};

function dessiner() {
  if (actif && etape === "marche") ouvrirPlan(lienPlan);
  else fermerPlan();
  panneau.classList.toggle("compact", etape === "marche" || etape === "ar");
  btnPhoto.hidden = !actif || etape !== "marche";
  // Hors de la marche, le panneau donne une consigne : on le déplie.
  if (etape !== "marche") replierPanneau(false);
  actions.replaceChildren();
  titre.textContent =
    etape === "marche" && volLibre() ? "Visite · anti-gravité" : niveau && etape !== "niveau" ? `Visite · ${niveau.nom}` : "Visite";
  switch (etape) {
    case "niveau":
      texte.textContent = niveaux.length
        ? "Choisissez votre niveau, ou touchez dans la maquette l'endroit où vous êtes (appui long et glisser pour orienter)."
        : "Aucun niveau trouvé dans les maquettes.";
      actions.append(listeNiveaux((s) => void choisirNiveau(s)));
      break;
    case "place":
      texte.textContent = "Posez le doigt où vous êtes. Glissez pour orienter la flèche, puis lâchez.";
      actions.append(puce("Autre niveau", () => void retourNiveaux()));
      break;
    case "marche": {
      const ar = arActif();
      const gyro = gyroActif();
      texte.textContent = ar
        ? arPerdu
          ? "Suivi perdu : visez un mur ou un sol avec du relief, et bougez doucement."
          : "La vue suit vos pas. Glissez un doigt pour corriger la direction."
        : gyro
          ? suiviGps
            ? "Le GPS déplace la vue, le téléphone l'oriente. Glissez un doigt pour corriger la direction."
            : "Le téléphone oriente la vue, la manette fait avancer. Glissez un doigt pour corriger la direction."
          : suiviGps
            ? "La vue suit votre position. Un doigt pour regarder autour de vous."
            : tactile()
              ? volLibre()
                ? "Anti-gravité : la manette avance là où vous regardez. Poussez au-delà du bord pour aller plus vite."
                : "Manette pour avancer (poussez au-delà du bord pour courir), un doigt pour regarder."
              : volLibre()
                ? "Anti-gravité : Z avance là où vous regardez, Espace / C montent et descendent. G pour retomber."
                : "ZQSD pour marcher (Maj ou Z deux fois : courir), flèches ou clic maintenu pour regarder. E / Espace : étage au-dessus, A / C : en dessous. G : anti-gravité.";
      const niveauBtn = puce("Niveau", () => {
        const deja = actions.querySelector(".visite-niveaux");
        if (deja) return deja.remove();
        actions.append(listeNiveaux((s) => void choisirNiveau(s)));
      });
      const gps = suiviGps
        ? puce("Arrêter le GPS", () => {
            suiviGps = false;
            cibleGps = null;
            arreterGps();
            manette.hidden = !tactile();
            dessiner();
          }, "actif")
        : puce("Suivre le GPS", () => void lancerGps(), "", "Faire suivre la vue par la position du téléphone");
      if (!ar) actions.append(gps);
      if (suiviGps && !ar) {
        actions.append(
          puce("Recaler", () => void versPlan("recaler"), "", "Touchez sur le plan où vous êtes vraiment"),
          puce("Nouveau calage", () => {
            ecrireCalage(null);
            suiviGps = false;
            void versPlan("gps1");
          }),
        );
      }
      // Capteurs du téléphone : en essai, réservés à l'administrateur.
      if (estAdmin()) {
        if (arDispo) {
          actions.append(
            ar
              ? puce("Arrêter la caméra", () => fermerAR(), "actif")
              : puce("Caméra AR", () => ((etape = "ar"), dessiner()), "", "Suivre vos pas avec la caméra du téléphone"),
          );
        }
        if (!ar && tactile() && gyroPossible()) {
          actions.append(
            gyro
              ? puce("Gyroscope", () => arreterGyro(), "actif")
              : puce("Gyroscope", () => void lancerGyro(), "", "Orienter la vue en bougeant le téléphone"),
          );
        }
      }
      // Mode jeu : effets (effets.ts) et angle de vue, sans valeurs à saisir.
      const effets = puce("Mode jeu", () => {
        const deja = actions.querySelector(".visite-effets");
        if (deja) return deja.remove();
        const ligne = cree("div", "visite-effets");
        // Son des pas : cinq choix, chacun se fait entendre au toucher.
        const sonsPas = cree("div", "visite-angles");
        const nomSon = cree("span", "visite-angles-titre", "");
        const majNomSon = () => (nomSon.textContent = STYLES_PAS.find((x) => x.cle === styleDesPas())?.nom ?? "");
        sonsPas.append(cree("span", "visite-angles-titre", "Pas"));
        STYLES_PAS.forEach((st, i) => {
          const b = puce(String(i + 1), () => {
            choisirStylePas(st.cle);
            if (!effetActif("pas")) {
              reglerEffet("pas", true);
              const c = ligne.querySelectorAll<HTMLInputElement>(".visite-case input")[2];
              if (c) c.checked = true;
            }
            sonsPas.querySelectorAll(".visite-puce").forEach((x) => x.classList.toggle("actif", x === b));
            majNomSon();
            b.blur();
            ecouterPas();
          }, st.cle === styleDesPas() ? "actif" : "", st.nom);
          sonsPas.append(b);
        });
        majNomSon();
        sonsPas.append(nomSon);
        const angles = cree("div", "visite-angles");
        angles.append(cree("span", "visite-angles-titre", "Angle"));
        for (const a of ANGLES_VISITE) {
          const b = puce(a.nom, () => {
            choisirAngleVisite(a.cle);
            angles.querySelectorAll(".visite-puce").forEach((x) => x.classList.toggle("actif", x === b));
            b.blur();
          }, a.cle === angleVisiteChoisi() ? "actif" : "", `Angle de vue ${a.nom.toLowerCase()}`);
          angles.append(b);
        }
        const caseEffet = (e: Effet, libelle: string, aide: string) => {
          const l = cree("label", "visite-case");
          l.title = aide;
          const c = cree("input");
          c.type = "checkbox";
          c.checked = effetActif(e);
          c.addEventListener("change", () => {
            reglerEffet(e, c.checked);
            // Les touches ZQSD doivent marcher aussitôt (pas rester sur la case).
            c.blur();
          });
          l.append(c, document.createTextNode(libelle));
          return l;
        };
        ligne.append(
          caseEffet("marche", "Marche", "La vue se balance à chaque pas et s'élargit un peu quand on court"),
          caseEffet("flou", "Flou", "Centre net, bords flous et assombris, image qui file en tournant vite (demande un peu plus à la carte graphique)"),
          caseEffet("pas", "Bruit de pas", "Un pas léger à chaque foulée"),
          sonsPas,
          angles,
        );
        actions.append(ligne);
      }, "", "Mode jeu : angle de vue, marche, flou, bruit de pas");
      if (!ar) actions.append(effets);
      if (!ar && !suiviGps) {
        actions.append(
          puce("Anti-gravité", () => basculerVol(), volLibre() ? "actif" : "", "Ne plus être collé au niveau : aller partout, monter, descendre (touche G)"),
        );
      }
      const vitesse = puce(`Vitesse : ${allureVisite()}`, () => {
        vitesse.textContent = `Vitesse : ${allureSuivante()}`;
      }, "", "Vitesse de déplacement : lente, moyenne ou rapide");
      if (!ar && !suiviGps) actions.append(vitesse);
      actions.append(niveauBtn, puce("Plan", () => void versPlan("place"), "", "Revenir au plan pour vous replacer"));
      manette.hidden = suiviGps || ar || !tactile();
      void garderEcran(suiviGps || ar || gyro);
      break;
    }
    case "ar":
      texte.textContent =
        "Mettez-vous à l'endroit de la vue, téléphone droit devant vous dans la même direction, puis touchez Démarrer.";
      actions.append(
        puce("Démarrer", () => void lancerAR(), "actif"),
        puce("Annuler", () => ((etape = "marche"), dessiner())),
      );
      break;
    case "gps1":
      texte.textContent =
        "Calage GPS, point 1 : placez-vous sur un endroit facile à repérer (angle de poteau, porte…), puis touchez-le sur le plan.";
      actions.append(puce("Annuler", () => void annulerGps()));
      break;
    case "gps2":
      texte.textContent = "Point 2 : marchez au moins 20 m en ligne droite, puis touchez sur le plan l'endroit où vous êtes.";
      actions.append(puce("Annuler", () => void annulerGps()));
      break;
    case "recaler":
      texte.textContent = "Touchez sur le plan l'endroit où vous êtes vraiment.";
      actions.append(puce("Annuler", () => void annulerGps()));
      break;
    case "mesure":
      break;
  }
}

async function lancerGps() {
  if (!demarrerGps()) return;
  calage = lireCalage();
  if (calage) {
    suiviGps = true;
    const l = moyenne(Date.now() - 15000);
    if (l && l.prec <= PRECISION_MAX) cibleGps = versScene(calage, l.lat, l.lon);
    dessiner();
    relancer();
    alerte("Calage retrouvé : la vue suit votre position. « Recaler » si elle est décalée.", 4500);
    return;
  }
  await versPlan("gps1");
}

async function annulerGps() {
  point1 = null;
  if (!suiviGps) arreterGps();
  if (place && niveau) {
    await entrerEnMarche(regardAvantPlan.clone());
  } else {
    etape = "niveau";
    dessiner();
  }
}

// --- Entrée et sortie -----------------------------------------------------------------

async function demarrer() {
  if (!visibles().length) {
    alerte("Ouvrez d'abord une maquette.");
    return;
  }
  actif = true;
  btnVisite.classList.add("actif");
  btnVisite.setAttribute("aria-pressed", "true");
  avant = {
    pos: controles.getPosition(new THREE.Vector3()),
    cible: controles.getTarget(new THREE.Vector3()),
    ortho: estOrtho(),
    oeil: modeOeil(),
  };
  if (avant.oeil) definirOeil(false);
  calquesReplies = replierCalques(true);
  activerAvancement(true);
  etape = "niveau";
  niveau = null;
  place = null;
  panneau.hidden = false;
  texte.textContent = "Recherche des niveaux…";
  actions.replaceChildren();
  niveaux = regrouper(await solsDesNiveaux());
  if (!actif) return;
  // Toucher la maquette sert à se placer (pas à ouvrir la fiche d'un élément).
  definirModeClic(() => undefined);
  capDefaut.copy(avant.cible).sub(avant.pos).setY(0);
  inviterPleinEcran(true);
  dessiner();
}

/** Deux maquettes nomment souvent différemment le même étage : on fusionne les sols à moins de 30 cm. */
function regrouper(sols: Sol[]): Sol[] {
  const res: Sol[] = [];
  for (const s of sols) {
    const proche = res.find((r) => Math.abs(r.y - s.y) < 0.3);
    if (!proche) res.push({ ...s, emprise: s.emprise.clone() });
    else {
      proche.emprise.union(s.emprise);
      if (!proche.nom.split(" · ").includes(s.nom)) proche.nom += ` · ${s.nom}`;
    }
  }
  return res;
}

async function quitter() {
  if (!actif) return;
  actif = false;
  arreterGps();
  fermerAR();
  fermerGyro();
  ancre = null;
  definirRegardExterne(null);
  void garderEcran(false);
  point1 = null;
  poussee = null;
  manette.hidden = true;
  panneau.hidden = true;
  btnPhoto.hidden = true;
  marqueur.visible = false;
  definirModeClic(null);
  bloquerUnDoigt(false);
  inviterPleinEcran(false);
  geste = null;
  controles.enabled = true;
  fermerPlan();
  definirVol(false);
  definirCourseManette(false);
  definirVisite(false);
  bloquerDecalage(false);
  monde.renderer!.setPlane(false, planCoupe);
  btnVisite.classList.remove("actif");
  btnVisite.setAttribute("aria-pressed", "false");
  replierCalques(calquesReplies);
  replierPanneau(false);
  activerAvancement(false);
  const a = avant;
  avant = null;
  if (a) {
    await definirProjection(a.ortho ? "Orthographic" : "Perspective");
    await controles.setLookAt(a.pos.x, a.pos.y, a.pos.z, a.cible.x, a.cible.y, a.cible.z, false);
    // Applique tout de suite : le recentrage qui suit lit la position réelle de la caméra.
    controles.update(0);
    if (a.oeil) definirOeil(true);
  }
  ajusterDecalage(false);
  await rafraichir();
}

btnVisite.addEventListener("click", () => void (actif ? quitter() : demarrer()));

/** Pour les autres outils (captures : revenir à un point de vue). */
export const visiteActive = () => actif;
export const quitterVisite = () => quitter();

/** Photo affichée à son point de vue : la visite se met en pause, puis repart d'où l'on est. */
export function suspendreVisite(oui: boolean) {
  if (!actif || suspendu === oui) return;
  suspendu = oui;
  manette.hidden = oui || suiviGps || arActif() || !tactile() || etape !== "marche";
  if (oui) return;
  // Les capteurs repartent de la vue actuelle.
  if (arActif() || gyroActif()) ancrer();
  relancer();
}
// Clavier, en marche : changer d'étage. E, Espace ou Page haut : au-dessus ; A (Q sur
// clavier anglais), C, Ctrl + Espace ou Page bas : en dessous. Une pression, un étage.
window.addEventListener("keydown", (e) => {
  if (!actif || etape !== "marche" || suspendu || e.altKey || e.metaKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable], .dialogue")) return;
  if (e.code === "KeyG" && !e.ctrlKey && !e.repeat && !arActif()) {
    e.preventDefault();
    return basculerVol();
  }
  // En anti-gravité, ces touches font monter et descendre (navigation.ts).
  if (volLibre()) return;
  let sens: 1 | -1 | 0 = 0;
  if (e.code === "Space") sens = e.ctrlKey ? -1 : 1;
  else if (e.ctrlKey) return;
  else if (e.code === "KeyE" || e.code === "PageUp") sens = 1;
  else if (e.code === "KeyQ" || e.code === "KeyC" || e.code === "PageDown") sens = -1;
  if (!sens) return;
  // Espace ne doit pas « cliquer » le dernier bouton touché.
  e.preventDefault();
  if (!e.repeat) changerNiveau(sens);
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !actif) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  void quitter();
});
