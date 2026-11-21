// Visite à la première personne (bouton manette).
// 1. On choisit un niveau ; la maquette s'affiche en plan, coupée à 1,20 m du sol.
// 2. On touche l'endroit où l'on se trouve, puis la direction du regard.
// 3. On marche dans la maquette à hauteur d'yeux : un doigt pour regarder autour de soi,
//    la manette à l'écran (ou les flèches du clavier) pour avancer.
// GPS : après un calage sur deux points touchés sur le plan, la position réelle du
// téléphone déplace la vue. Le calage est gardé sur l'appareil pour le jeu de maquettes.
// Capteurs (admin pour l'instant, voir suivi.ts) : caméra AR pour suivre les pas au
// centimètre, ou gyroscope pour orienter la vue en bougeant le téléphone.
import * as THREE from "three";
import { ajusterDecalage, alerte, bloquerDecalage, bouton, cree, definirProjection, el, estOrtho, monde, rafraichir } from "./noyau";
import { definirModeClic } from "./fiche";
import { definirOeil, definirRegardExterne, definirVisite, modeOeil } from "./navigation";
import { estAdmin, hauteurTelephone } from "./nuage/projets";
import { replierCalques } from "./maquettes";
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
const MARCHE = 1.4; // allure à la manette (m/s), manette poussée à fond
const CALAGE_MS = 5000; // durée de mesure GPS sur chaque point
const PRECISION_MAX = 35; // au-delà (m), une position GPS est ignorée
const ECART_MIN = 8; // distance minimale entre les deux points du calage (m)

const canvas = monde.renderer!.three.domElement;
const controles = monde.camera.controls;
const btnVisite = el<HTMLButtonElement>("btn-visite");

type Etape = "niveau" | "place" | "regard" | "marche" | "ar" | "gps1" | "gps2" | "recaler" | "mesure";
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
entete.append(titre, etatGps, btnReplier, fermer);
panneau.append(entete, texte, actions);
document.body.append(panneau);

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

function poserMarqueur(p: THREE.Vector3, direction?: THREE.Vector3) {
  const cam = monde.camera.three as THREE.OrthographicCamera;
  const hauteur = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom : 30;
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
function pointAuSol(e: PointerEvent, y: number) {
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

async function entrerEnMarche(direction: THREE.Vector3) {
  if (!place || !niveau) return;
  monde.renderer!.setPlane(false, planCoupe);
  marqueur.visible = false;
  definirModeClic(null);
  if (estOrtho()) await definirProjection("Perspective");
  definirVisite(true);
  // À hauteur d'yeux, pas de décalage de mise en page quand la fiche s'ouvre.
  bloquerDecalage(true);
  await regarderDepuis(place, direction);
  etape = "marche";
  manette.hidden = !tactile();
  // Suivi par capteurs : la pose du téléphone repart de ce point et de cette direction.
  if (arActif() || gyroActif()) ancrer(direction);
  dessiner();
  if (gyroActif()) relancer();
  await rafraichir();
}

/** Déplace l'œil à plat (garde la hauteur du niveau et la direction du regard). */
function decaler(dx: number, dz: number) {
  if (!niveau) return;
  if (arActif() && ancre) {
    // La caméra AR place la vue à chaque image : on décale son point de départ.
    ancre.p0.x += dx;
    ancre.p0.z += dz;
    return;
  }
  const position = controles.getPosition(new THREE.Vector3());
  const cible = controles.getTarget(new THREE.Vector3());
  const dy = niveau.y + yeux() - position.y;
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
let poussee: { id: number; cx: number; cy: number; x: number; y: number } | null = null;

manette.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const r = manette.getBoundingClientRect();
  poussee = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: 0, y: 0 };
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
};
manette.addEventListener("pointerup", lacher);
manette.addEventListener("pointercancel", lacher);

// Boucle d'animation : manette et suivi GPS.
let boucle = 0;
let dernier = 0;
function avancer(t: number) {
  boucle = 0;
  if (!actif || etape !== "marche") return;
  const dt = Math.min(0.1, (t - dernier) / 1000);
  dernier = t;
  let encore = false;
  if (poussee && (poussee.x || poussee.y)) {
    encore = true;
    const position = controles.getPosition(new THREE.Vector3());
    const devant = controles.getTarget(new THREE.Vector3()).sub(position).setY(0);
    if (devant.lengthSq() > 1e-6) {
      devant.normalize();
      const droite = devant.clone().cross(new THREE.Vector3(0, 1, 0));
      const d = devant.multiplyScalar(-poussee.y).addScaledVector(droite, poussee.x);
      if (d.lengthSq() > 1) d.normalize();
      d.multiplyScalar(MARCHE * dt);
      decaler(d.x, d.z);
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
        ancre.attente = false;
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

type Ancre = { attente: boolean; dir: THREE.Vector3; p0: THREE.Vector3; x0: THREE.Vector3; theta: number };
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
  ancre = { attente: true, dir: d.normalize(), p0: p, x0: new THREE.Vector3(), theta: 0 };
  derniere.ok = false;
  majRegard();
}

/** Regarde depuis pos dans la direction du téléphone, tournée vers la maquette. */
function viserDepuis(pos: THREE.Vector3, devant: THREE.Vector3) {
  const d = devant.clone().applyAxisAngle(AXE_Y, ancre!.theta);
  // Jamais tout à fait à la verticale : la caméra ne saurait plus où est le haut.
  const plat = Math.hypot(d.x, d.z);
  if (plat < 1e-3) return;
  d.y = THREE.MathUtils.clamp(d.y, -0.97, 0.97);
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
  if (!actif || !ancre) return;
  if (l.perdu !== arPerdu) {
    arPerdu = l.perdu;
    if (etape === "marche") dessiner();
  }
  if (etape !== "marche" || l.perdu) return;
  devantDe(l.quat, devantTel);
  if (ancre.attente) {
    ancre.x0.copy(l.pos);
    ancre.theta = lacet(ancre.dir) - lacet(devantTel);
    ancre.attente = false;
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

// --- Étapes ----------------------------------------------------------------------------

function armerClic() {
  definirModeClic(async (e) => {
    if (!niveau) return;
    if (etape === "place") {
      const p = pointAuSol(e, niveau.y);
      if (!p) return;
      place = p;
      poserMarqueur(p);
      etape = "regard";
      dessiner();
    } else if (etape === "regard" && place) {
      const p = pointAuSol(e, niveau.y);
      if (!p) return;
      const dir = p.clone().sub(place);
      poserMarqueur(place, dir);
      await entrerEnMarche(dir);
    } else if (etape === "gps1" || etape === "gps2" || etape === "recaler") {
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
    // Changement de niveau en marchant : même endroit, autre étage.
    const p = controles.getPosition(new THREE.Vector3());
    decaler(0, 0);
    place = new THREE.Vector3(p.x, sol.y, p.z);
    alerte(`Niveau ${sol.nom}.`, 2000);
    dessiner();
    return;
  }
  etape = "place";
  await vueEnPlan(sol);
  armerClic();
  dessiner();
}

/** Direction du regard au moment de repasser en plan (retrouvée en revenant à la marche). */
const regardAvantPlan = new THREE.Vector3(0, 0, -1);

async function versPlan(e: Etape) {
  if (!niveau) return;
  if (etape === "marche") {
    const p = controles.getPosition(new THREE.Vector3());
    regardAvantPlan.copy(controles.getTarget(new THREE.Vector3()).sub(p));
    // Le repère du plan montre où l'on est maintenant (on a pu marcher depuis).
    place = new THREE.Vector3(p.x, niveau.y, p.z);
  }
  etape = e;
  bloquerDecalage(false);
  manette.hidden = true;
  definirVisite(false);
  await vueEnPlan(niveau);
  if (place) poserMarqueur(place, regardAvantPlan);
  armerClic();
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

function dessiner() {
  panneau.classList.toggle("compact", etape === "marche" || etape === "ar");
  // Hors de la marche, le panneau donne une consigne : on le déplie.
  if (etape !== "marche") replierPanneau(false);
  actions.replaceChildren();
  titre.textContent = niveau && etape !== "niveau" ? `Visite · ${niveau.nom}` : "Visite";
  switch (etape) {
    case "niveau":
      texte.textContent = niveaux.length
        ? "Choisissez le niveau où vous êtes."
        : "Aucun niveau trouvé dans les maquettes.";
      actions.append(listeNiveaux((s) => void choisirNiveau(s)));
      break;
    case "place":
      texte.textContent = "Touchez sur le plan l'endroit où vous êtes.";
      actions.append(puce("Autre niveau", () => ((etape = "niveau"), dessiner())));
      break;
    case "regard":
      texte.textContent = "Touchez maintenant la direction de votre regard.";
      actions.append(
        puce("Entrer sans direction", () => void entrerEnMarche(new THREE.Vector3(0, 0, -1)), "", "Regarder vers le haut du plan"),
        puce("Replacer", () => ((etape = "place"), dessiner())),
      );
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
              ? "Manette pour avancer, un doigt pour regarder autour de vous."
              : "Flèches pour avancer, clic maintenu pour regarder autour de vous.";
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
  etape = "niveau";
  niveau = null;
  place = null;
  panneau.hidden = false;
  texte.textContent = "Recherche des niveaux…";
  actions.replaceChildren();
  niveaux = regrouper(await solsDesNiveaux());
  if (!actif) return;
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
  marqueur.visible = false;
  definirModeClic(null);
  definirVisite(false);
  bloquerDecalage(false);
  monde.renderer!.setPlane(false, planCoupe);
  btnVisite.classList.remove("actif");
  btnVisite.setAttribute("aria-pressed", "false");
  replierCalques(calquesReplies);
  replierPanneau(false);
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
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !actif) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  void quitter();
});
