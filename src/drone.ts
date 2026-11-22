// Anti-gravité façon drone : la manette et les touches donnent une poussée, pas une vitesse.
// On prend de l'élan, on glisse quand on lâche (freiné par l'air), et pour s'arrêter
// pile il faut contre-pousser. L'image penche dans le sens de l'accélération (roulis quand
// on part de côté, tangage quand on accélère ou freine) et cette assiette revient en place
// comme un ressort peu amorti : petits à-coups à l'arrêt, comme la vue d'un drone.
import * as THREE from "three";
import { monde } from "./noyau";

/** Poussée demandée : avant / côté (−1 à 1), montée (gaz), rotation sur place (lacet, −1 à 1)
 * et vitesse de croisière (m/s) atteinte poussée à fond. « aPlat » : on avance à l'horizontale,
 * comme un drone (sinon là où l'on regarde). */
export type Commande = { avance: number; cote: number; monte: number; lacet?: number; vitesse: number; aPlat?: boolean };

const FREIN = 1.25; // 1/s : plus on va vite, plus on glisse loin (vitesse / FREIN mètres)
const ARRET = 0.02; // m/s : en dessous, sans poussée, on s'immobilise
const PULSATION = 8; // rad/s : ressort de l'assiette
const AMORTI = 0.38; // < 1 : il dépasse un peu et oscille avant de se poser
const ROULIS_MAX = 0.12; // rad (≈ 7°)
const LACET_MAX = 80; // degrés par seconde, manette à fond
const REPONSE_LACET = 5; // 1/s : la rotation démarre et s'arrête en douceur
const TANGAGE_MAX = 0.08; // rad (≈ 4,5°)

const commandes = new Map<string, Commande>();
const vitesse = new THREE.Vector3();
const assiette = { tangage: 0, roulis: 0, vt: 0, vr: 0 };
let deplacer: ((d: THREE.Vector3) => void) | null = null;
let tourner: ((degres: number) => void) | null = null;
let enService: () => boolean = () => false;
let tauxLacet = 0; // degrés par seconde
let boucle = 0;
let dernier = 0;

/** La visite fournit le déplacement de l'œil et dit si le vol libre est en cours. */
export function brancherDrone(f: (d: THREE.Vector3) => void, actif: () => boolean, rotation: (degres: number) => void) {
  deplacer = f;
  enService = actif;
  tourner = rotation;
}

/** Poussée d'une source (manette, clavier) ; null ou nulle : elle lâche. */
export function commanderDrone(source: string, c: Commande | null) {
  if (c && (c.avance || c.cote || c.monte || c.lacet)) commandes.set(source, c);
  else commandes.delete(source);
  if (!boucle && enService()) {
    dernier = performance.now();
    boucle = requestAnimationFrame(pas);
  }
}

/** Fin du vol (atterrissage, sortie de visite) : plus d'élan ni d'inclinaison. */
export function arreterDrone() {
  commandes.clear();
  vitesse.set(0, 0, 0);
  tauxLacet = 0;
  Object.assign(assiette, { tangage: 0, roulis: 0, vt: 0, vr: 0 });
  if (boucle) cancelAnimationFrame(boucle);
  boucle = 0;
}

const HAUT = new THREE.Vector3(0, 1, 0);
const position = new THREE.Vector3();
const devant = new THREE.Vector3();
const plat = new THREE.Vector3();
const droite = new THREE.Vector3();
const poussee = new THREE.Vector3();
const accel = new THREE.Vector3();
const u = new THREE.Vector3();
const pasDeplacement = new THREE.Vector3();

function ressort(x: number, v: number, cible: number, dt: number): [number, number] {
  const a = PULSATION * PULSATION * (cible - x) - 2 * AMORTI * PULSATION * v;
  v += a * dt;
  return [x + v * dt, v];
}

function pas(t: number) {
  boucle = 0;
  if (!enService()) return arreterDrone();
  // Pas de temps réel découpé en petits pas : même comportement sur un téléphone lent.
  const total = THREE.MathUtils.clamp((t - dernier) / 1000, 0, 0.25);
  dernier = t;
  const n = Math.max(1, Math.ceil(total / (1 / 60)));
  const dt = total / n;
  const controles = monde.camera.controls;
  controles.getPosition(position);
  controles.getTarget(devant).sub(position);
  if (devant.lengthSq() < 1e-8) {
    monde.camera.three.updateMatrixWorld();
    devant.setFromMatrixColumn(monde.camera.three.matrixWorld, 2).negate();
  }
  devant.normalize();
  plat.copy(devant).setY(0);
  if (plat.lengthSq() < 1e-6) {
    monde.camera.three.updateMatrixWorld();
    plat.setFromMatrixColumn(monde.camera.three.matrixWorld, 1).setY(0);
  }
  plat.normalize();
  droite.copy(plat).cross(HAUT).normalize();

  // Poussée (vers où l'on regarde, ou à l'horizontale pour le drone) moins la traînée.
  poussee.set(0, 0, 0);
  let cibleLacet = 0;
  for (const c of commandes.values()) {
    cibleLacet += (c.lacet ?? 0) * LACET_MAX;
    u.copy(c.aPlat ? plat : devant).multiplyScalar(c.avance).addScaledVector(droite, c.cote);
    if (u.lengthSq() > 1) u.normalize();
    u.y += c.monte;
    poussee.addScaledVector(u, c.vitesse * FREIN);
  }
  cibleLacet = THREE.MathUtils.clamp(cibleLacet, -LACET_MAX, LACET_MAX);
  pasDeplacement.set(0, 0, 0);
  let rotationTotale = 0;
  for (let i = 0; i < n; i++) {
    accel.copy(poussee).addScaledVector(vitesse, -FREIN);
    vitesse.addScaledVector(accel, dt);
    if (!commandes.size && vitesse.length() < ARRET) vitesse.set(0, 0, 0);
    pasDeplacement.addScaledVector(vitesse, dt);
    // Rotation sur l'axe vertical : prend et perd son élan.
    tauxLacet += (cibleLacet - tauxLacet) * (1 - Math.exp(-REPONSE_LACET * dt));
    if (!cibleLacet && Math.abs(tauxLacet) < 0.5) tauxLacet = 0;
    rotationTotale += tauxLacet * dt;
    // Assiette : le drone penche vers où il accélère (nez vers le bas en partant, vers le
    // haut en freinant ; roulis du côté où il part).
    const cibleTangage = THREE.MathUtils.clamp(-accel.dot(plat) * 0.012, -TANGAGE_MAX, TANGAGE_MAX);
    const cibleRoulis = THREE.MathUtils.clamp(-accel.dot(droite) * 0.02, -ROULIS_MAX, ROULIS_MAX);
    [assiette.tangage, assiette.vt] = ressort(assiette.tangage, assiette.vt, cibleTangage, dt);
    [assiette.roulis, assiette.vr] = ressort(assiette.roulis, assiette.vr, cibleRoulis, dt);
  }
  if (pasDeplacement.lengthSq() > 0) deplacer?.(pasDeplacement);
  if (rotationTotale) tourner?.(rotationTotale);

  const pose =
    Math.abs(assiette.tangage) + Math.abs(assiette.roulis) < 2e-4 && Math.abs(assiette.vt) + Math.abs(assiette.vr) < 2e-3;
  if (commandes.size || vitesse.lengthSq() > 0 || tauxLacet || !pose) boucle = requestAnimationFrame(pas);
  else Object.assign(assiette, { tangage: 0, roulis: 0, vt: 0, vr: 0 });
}

// L'inclinaison n'est appliquée qu'au dessin de l'image : la caméra (et tout ce qui la lit,
// visée, plan, coupe) garde sa direction réelle.
const sauve = new THREE.Quaternion();
const rotation = new THREE.Quaternion();
const angles = new THREE.Euler();
let appliquee = false;
monde.renderer!.onBeforeUpdate.add(() => {
  if (Math.abs(assiette.tangage) + Math.abs(assiette.roulis) < 1e-5) return;
  const cam = monde.camera.three;
  sauve.copy(cam.quaternion);
  angles.set(assiette.tangage, 0, assiette.roulis, "XYZ");
  cam.quaternion.multiply(rotation.setFromEuler(angles));
  cam.updateMatrixWorld();
  appliquee = true;
});
monde.renderer!.onAfterUpdate.add(() => {
  if (!appliquee) return;
  appliquee = false;
  const cam = monde.camera.three;
  cam.quaternion.copy(sauve);
  cam.updateMatrixWorld();
});

/** Pour les essais : vitesse et assiette du drone. */
export const etatDrone = () => ({ vitesse: vitesse.toArray(), ...assiette });
if (import.meta.env.DEV) (window as unknown as { __drone: typeof etatDrone }).__drone = etatDrone;
