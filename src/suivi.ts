// Capteurs du téléphone pour la visite à la première personne (étape 2, admin pour l'instant).
// - Caméra AR (WebXR, Chrome sur Android) : le téléphone suit ses propres déplacements en
//   filmant autour de lui, au centimètre près, même à l'intérieur. La maquette reste affichée
//   par-dessus l'image de la caméra (calque « dom-overlay ») : on ne voit que la maquette.
// - Gyroscope : seulement l'orientation (lever le téléphone = regarder en haut).
import * as THREE from "three";
import { monde } from "./noyau";

/** Une mesure : position (AR seulement) et orientation du téléphone, repère de la scène three.js. */
export type Lecture = { pos: THREE.Vector3; quat: THREE.Quaternion; perdu: boolean };

// --- Caméra AR (WebXR) -------------------------------------------------------------------

export const arPossible: Promise<boolean> = (async () => {
  try {
    return (await navigator.xr?.isSessionSupported("immersive-ar")) === true;
  } catch {
    return false;
  }
})();

let session: XRSession | null = null;
let espace: XRReferenceSpace | null = null;
let glXR: WebGLRenderingContext | null = null;
let battement = 0;
let derniereImage = 0;

export const arActif = () => session !== null;

/** Le navigateur peut suspendre l'animation de la page pendant la session : on la surveille. */
function battre() {
  battement = performance.now();
  if (session) requestAnimationFrame(battre);
}

/**
 * Ouvre la caméra AR (à appeler depuis un toucher). chaqueImage reçoit la pose du téléphone
 * à chaque image ; fin est appelé quand la session se termine (bouton retour compris).
 * Renvoie null si tout va bien, sinon le message d'erreur à afficher.
 */
export async function ouvrirAR(chaqueImage: (l: Lecture) => void, fin: () => void): Promise<string | null> {
  if (session) return null;
  if (!navigator.xr) return "Ce navigateur ne gère pas la réalité augmentée (utilisez Chrome sur Android).";
  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["dom-overlay"],
      domOverlay: { root: document.body },
    });
  } catch (e) {
    session = null;
    const nom = (e as Error)?.name;
    return nom === "NotSupportedError"
      ? "Ce téléphone ne permet pas la réalité augmentée dans le navigateur."
      : "Caméra AR refusée ou indisponible : autorisez la caméra pour nexbim.paceapp.fr.";
  }
  const s = session;
  try {
    const toile = document.createElement("canvas");
    glXR = toile.getContext("webgl", { xrCompatible: true, alpha: true, antialias: false }) as WebGLRenderingContext | null;
    if (!glXR) throw new Error("webgl");
    s.updateRenderState({ baseLayer: new XRWebGLLayer(s, glXR) });
    espace = await s.requestReferenceSpace("local");
  } catch {
    await s.end().catch(() => undefined);
    session = null;
    return "Impossible de démarrer le suivi par la caméra sur cet appareil.";
  }
  s.addEventListener("end", () => {
    session = null;
    espace = null;
    glXR = null;
    fin();
  });
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  derniereImage = performance.now();
  const image: XRFrameRequestCallback = (t, frame) => {
    if (!session) return;
    s.requestAnimationFrame(image);
    const dt = Math.min(0.1, (t - derniereImage) / 1000);
    derniereImage = t;
    // Calque WebXR laissé transparent : seule la page (la maquette) est visible.
    const calque = s.renderState.baseLayer;
    if (glXR && calque) {
      glXR.bindFramebuffer(glXR.FRAMEBUFFER, calque.framebuffer);
      glXR.clearColor(0, 0, 0, 0);
      glXR.clear(glXR.COLOR_BUFFER_BIT);
    }
    const pose = espace ? frame.getViewerPose(espace) : undefined;
    if (pose) {
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      pos.set(p.x, p.y, p.z);
      quat.set(o.x, o.y, o.z, o.w);
      chaqueImage({ pos, quat, perdu: pose.emulatedPosition });
    } else {
      chaqueImage({ pos, quat, perdu: true });
    }
    // Animation de la page suspendue : on dessine la vue nous-mêmes.
    if (performance.now() - battement > 500) {
      monde.camera.update(dt);
      monde.renderer!.update();
    }
  };
  s.requestAnimationFrame(image);
  battre();
  return null;
}

export function fermerAR() {
  void session?.end().catch(() => undefined);
}

// --- Gyroscope -------------------------------------------------------------------------

type Angles = { a: number; b: number; g: number };
let angles: Angles | null = null;
let gyroOuvert = false;
const lisse = new THREE.Quaternion();
let lissePret = false;

export const gyroPossible = () => typeof DeviceOrientationEvent !== "undefined";
export const gyroActif = () => gyroOuvert;

function surOrientation(e: DeviceOrientationEvent) {
  if (e.alpha === null || e.beta === null || e.gamma === null) return;
  angles = { a: e.alpha, b: e.beta, g: e.gamma };
}

/** Orientation du téléphone → orientation de caméra (l'objectif regarde par le dos de l'écran). */
const eulerTel = new THREE.Euler();
const versDos = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° autour de X
const axeZ = new THREE.Vector3(0, 0, 1);
const qEcran = new THREE.Quaternion();
function quaternionTelephone({ a, b, g }: Angles, sortie: THREE.Quaternion) {
  const rad = THREE.MathUtils.degToRad;
  eulerTel.set(rad(b), rad(a), -rad(g), "YXZ");
  sortie.setFromEuler(eulerTel).multiply(versDos);
  const angleEcran = screen.orientation?.angle ?? 0;
  return sortie.multiply(qEcran.setFromAxisAngle(axeZ, -rad(angleEcran)));
}

/** Démarre le gyroscope (à appeler depuis un toucher, iPhone oblige). Renvoie un message en cas d'échec. */
export async function ouvrirGyro(): Promise<string | null> {
  if (gyroOuvert) return null;
  if (!gyroPossible()) return "Pas de gyroscope accessible sur cet appareil.";
  // iPhone : il faut demander l'accès. Ailleurs la réponse n'est pas toujours fiable :
  // on se fie surtout à l'arrivée des mesures.
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  let refus = false;
  if (typeof D.requestPermission === "function") {
    try {
      refus = (await D.requestPermission()) !== "granted";
    } catch {
      refus = true;
    }
  }
  angles = null;
  lissePret = false;
  window.addEventListener("deviceorientation", surOrientation);
  gyroOuvert = true;
  const debut = performance.now();
  while (!angles && performance.now() - debut < 1500) await new Promise((r) => setTimeout(r, 50));
  if (!angles) {
    fermerGyro();
    return refus ? "Accès aux capteurs de mouvement refusé." : "Pas de gyroscope détecté sur cet appareil.";
  }
  return null;
}

export function fermerGyro() {
  window.removeEventListener("deviceorientation", surOrientation);
  gyroOuvert = false;
  angles = null;
  lissePret = false;
}

/** Dernière orientation du téléphone, lissée pour gommer les tremblements. */
const brute = new THREE.Quaternion();
export function orientationGyro(): THREE.Quaternion | null {
  if (!gyroOuvert || !angles) return null;
  quaternionTelephone(angles, brute);
  if (!lissePret) {
    lisse.copy(brute);
    lissePret = true;
  } else {
    lisse.slerp(brute, 0.35);
  }
  return lisse;
}

// --- Écran allumé pendant le suivi ---------------------------------------------------------

let verrou: WakeLockSentinel | null = null;
let voulu = false;
export async function garderEcran(oui: boolean) {
  voulu = oui;
  try {
    if (oui && !verrou && "wakeLock" in navigator) {
      verrou = await navigator.wakeLock.request("screen");
      verrou.addEventListener("release", () => (verrou = null));
    } else if (!oui && verrou) {
      await verrou.release();
      verrou = null;
    }
  } catch {
    // Pas de verrou d'écran : le téléphone pourra se mettre en veille.
  }
}
// Le verrou saute quand on quitte l'onglet : on le reprend au retour.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && voulu) void garderEcran(true);
});
