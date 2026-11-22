// Effets « jeu vidéo » de la visite à la première personne, au choix (cochés dans le panneau
// de visite, retenus sur l'appareil). Tout se passe dans le navigateur, rien sur le serveur.
// - Marche : la vue se balance légèrement à chaque pas (haut-bas, un peu de côté, une
//   pointe d'inclinaison) selon la vitesse réelle, et l'angle de vue s'élargit un peu
//   quand on court. Ne coûte rien.
// - Flou : le centre reste net, les bords et les coins se floutent et s'assombrissent un
//   peu (comme dans les jeux de tir), plus quand on court ; en tournant vite, l'image
//   file dans le sens du mouvement. Coûte une copie de l'image et une passe par image.
// - Bruit de pas : un pas léger, fabriqué sur place (aucun fichier son), à chaque foulée.
//
// Balancement et angle de vue changent la caméra le temps du dessin seulement : les outils
// (sélection, mesure, captures…) voient toujours la vraie position de l'œil.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { monde } from "./noyau";
import { courseEnCours, modeVisite, volLibre } from "./navigation";
import { arActif } from "./suivi";

export type Effet = "marche" | "flou" | "pas";
const CLE = "nexbim-effets";
const reglages: Record<Effet, boolean> = { marche: false, flou: false, pas: false };
try {
  Object.assign(reglages, JSON.parse(localStorage.getItem(CLE) ?? "{}"));
} catch {
  // Désactivés par défaut.
}
export const effetActif = (e: Effet) => reglages[e];
export function reglerEffet(e: Effet, oui: boolean) {
  reglages[e] = oui;
  // Le son ne peut démarrer qu'après un geste de l'utilisateur : ce clic en est un.
  if (e === "pas" && oui) preparerSon();
  try {
    localStorage.setItem(CLE, JSON.stringify(reglages));
  } catch {
    // Gardé pour la session.
  }
}

/** Mise en pause (photo affichée à son point de vue, capture d'écran…). */
let pauses = 0;
export function suspendreEffets(oui: boolean) {
  pauses = Math.max(0, pauses + (oui ? 1 : -1));
}

const enMarche = () => modeVisite() && pauses === 0 && !arActif() && !monde.renderer!.three.xr.isPresenting;

// --- Mesure du mouvement de l'œil -------------------------------------------------------

const cam = () => monde.camera.three;
const avant = { p: new THREE.Vector3(), d: new THREE.Vector3(0, 0, -1), t: 0, pret: false };
let vitesse = 0; // m/s, lissée
let rotation = 0; // rad/s, lissée
/** Vitesse de rotation à l'écran (rad/s) : vers la droite, vers le haut. */
const tourne = new THREE.Vector2();
const inverse = new THREE.Quaternion();
function mesurer(dt: number) {
  const c = cam();
  const p = c.position;
  const d = c.getWorldDirection(new THREE.Vector3());
  if (avant.pret && dt > 0) {
    let pas = Math.hypot(p.x - avant.p.x, p.z - avant.p.z);
    if (pas > 1.5) pas = 0; // saut (changement de niveau, retour au plan…)
    const tour = Math.min(avant.d.angleTo(d), 0.5);
    const k = 1 - Math.exp(-dt * 10);
    vitesse += (pas / dt - vitesse) * k;
    rotation += (tour / dt - rotation) * k;
    // L'ancienne direction vue depuis la caméra actuelle : de combien l'image a glissé.
    const l = avant.d.clone().applyQuaternion(inverse.copy(c.quaternion).invert());
    const ax = tour < 0.5 ? Math.atan2(l.x, -l.z) : 0;
    const ay = tour < 0.5 ? Math.atan2(l.y, -l.z) : 0;
    tourne.x += (ax / dt - tourne.x) * k;
    tourne.y += (ay / dt - tourne.y) * k;
  }
  avant.p.copy(p);
  avant.d.copy(d);
  avant.pret = true;
}

// --- Balancement de marche -------------------------------------------------------------

let phase = 0;
let ampleur = 0; // 0 à l'arrêt, 1 en marche
let gauche = false;
const sauve = { p: new THREE.Vector3(), q: new THREE.Quaternion(), applique: false, fov: 0 };

/** La foulée avance (un demi-tour de phase par pas) ; un pas posé à chaque demi-tour. */
function avancerPhase(dt: number) {
  // En anti-gravité, on ne marche pas : ni balancement ni pas.
  const viser = volLibre() ? 0 : THREE.MathUtils.clamp(vitesse / 1.2, 0, 1);
  ampleur += (viser - ampleur) * (1 - Math.exp(-dt * 6));
  if (ampleur < 0.002) {
    ampleur = 0;
    return;
  }
  // Foulée plus longue quand on va vite : la cadence reste naturelle.
  const foulee = 0.6 + 0.12 * vitesse;
  const pasAvant = Math.floor(phase / Math.PI);
  phase += ((vitesse * dt) / foulee) * Math.PI;
  if (Math.floor(phase / Math.PI) !== pasAvant && vitesse > 0.5 && reglages.pas && !volLibre()) {
    gauche = !gauche;
    jouerPas(THREE.MathUtils.clamp(0.6 + vitesse / 8, 0.6, 1.2), gauche);
  }
}

function garder() {
  if (sauve.applique) return;
  const c = cam();
  sauve.p.copy(c.position);
  sauve.q.copy(c.quaternion);
  sauve.fov = monde.camera.threePersp.fov;
  sauve.applique = true;
}

function balancer() {
  if (!ampleur) return;
  const A = Math.min(0.06, 0.025 + 0.006 * vitesse) * ampleur; // haut-bas (m)
  const c = cam();
  garder();
  c.updateMatrixWorld();
  const droite = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
  // Un creux à chaque pas, un aller-retour de côté tous les deux pas.
  // (la phase avance d'un demi-tour par pas).
  c.position.y += A * (Math.abs(Math.sin(phase)) - 0.5);
  c.position.addScaledVector(droite, A * 0.55 * Math.sin(phase));
  c.rotateZ(THREE.MathUtils.degToRad(0.45) * ampleur * Math.sin(phase));
  c.updateMatrixWorld();
}
/** En courant (Maj), l'angle de vue s'élargit un peu (jusqu'à +9°), puis revient en douceur. */
let elan = 0;
function elargir(dt: number) {
  const viser = courseEnCours() && vitesse > 0.8 ? 1 : 0;
  elan += (viser - elan) * (1 - Math.exp(-dt * (viser > elan ? 4 : 3)));
  if (elan < 0.003) {
    elan = 0;
    return;
  }
  const persp = monde.camera.threePersp;
  if (cam() !== persp) return;
  garder();
  persp.fov = Math.min(170, sauve.fov + 9 * elan);
  persp.updateProjectionMatrix();
}

function retablir() {
  if (!sauve.applique) return;
  const c = cam();
  c.position.copy(sauve.p);
  c.quaternion.copy(sauve.q);
  c.updateMatrixWorld();
  const persp = monde.camera.threePersp;
  if (persp.fov !== sauve.fov) {
    persp.fov = sauve.fov;
    persp.updateProjectionMatrix();
  }
  sauve.applique = false;
}

// --- Bruit de pas -----------------------------------------------------------------------
// Vrais enregistrements libres de droits (Kenney, CC0) regroupés dans public/sons/pas.mp3
// (150 Ko, chargé seulement quand la case est cochée). Cinq sons au choix ; chaque pas
// tire un enregistrement au hasard, légèrement varié (hauteur, force), à gauche puis à droite.

export type StylePas = "tactique" | "lourd" | "beton" | "bottes" | "gravats";
export const STYLES_PAS: { cle: StylePas; nom: string }[] = [
  { cle: "tactique", nom: "Tactique (bottes + équipement)" },
  { cle: "lourd", nom: "Tactique lourd" },
  { cle: "beton", nom: "Béton" },
  { cle: "bottes", nom: "Bottes" },
  { cle: "gravats", nom: "Chantier (gravats)" },
];
/** Début et durée (s) de chaque enregistrement dans pas.mp3. */
const SONS_PAS: Record<"beton" | "bottes" | "gravats" | "equipement", [number, number][]> = {"beton": [[0.0, 0.103], [0.253, 0.1047], [0.5078, 0.1099], [0.7676, 0.1076], [1.0252, 0.1115]], "bottes": [[1.2867, 0.2489], [1.6856, 0.2825], [2.118, 0.2422], [2.5102, 0.269], [2.9292, 0.3228], [3.4021, 0.2758], [3.8278, 0.2421], [4.22, 0.2556], [4.6256, 0.2556], [5.0312, 0.2152]], "gravats": [[5.3964, 0.3713], [5.9177, 0.3713], [6.439, 0.3713], [6.9603, 0.3713], [7.4817, 0.3713]], "equipement": [[8.003, 0.661], [8.814, 0.4151], [9.3791, 0.4766], [10.0057, 0.3844], [10.54, 0.2767], [10.9667, 0.4766], [11.5933, 0.3382], [12.0815, 0.3075]]};
const VOLUME_PAS = 0.11;
const CLE_STYLE = "nexbim-pas-son";
let stylePas: StylePas = "tactique";
try {
  const lu = localStorage.getItem(CLE_STYLE) as StylePas | null;
  if (lu && STYLES_PAS.some((x) => x.cle === lu)) stylePas = lu;
} catch {
  // Tactique par défaut.
}
export const styleDesPas = () => stylePas;
export function choisirStylePas(s: StylePas) {
  stylePas = s;
  try {
    localStorage.setItem(CLE_STYLE, s);
  } catch {
    // Gardé pour la session.
  }
}

let son: AudioContext | null = null;
let tampon: AudioBuffer | null = null;
let chargement: Promise<void> | null = null;
function preparerSon() {
  try {
    if (!son) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      son = new C();
    }
    if (son.state === "suspended") void son.resume();
    if (!chargement) {
      const a = son;
      chargement = fetch("./sons/pas.mp3")
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => a.decodeAudioData(b))
        .then((t) => void (tampon = t))
        .catch((e) => {
          console.warn("sons de pas", e);
          chargement = null;
        });
    }
  } catch {
    son = null;
  }
}
// Réglage retenu d'une visite précédente : le son démarre au premier geste.
for (const type of ["pointerdown", "keydown"] as const) {
  window.addEventListener(type, () => reglages.pas && (!son || son.state !== "running" || !tampon) && preparerSon(), { passive: true });
}

const derniers: Record<string, number> = {};
/** Lit un enregistrement au hasard d'un groupe (jamais deux fois le même de suite). */
function lire(groupe: keyof typeof SONS_PAS, vers: AudioNode, t: number, vitesse: number, gain: number, dureeMax?: number) {
  const a = son!;
  const liste = SONS_PAS[groupe];
  let i = Math.floor(Math.random() * liste.length);
  if (liste.length > 1 && i === derniers[groupe]) i = (i + 1) % liste.length;
  derniers[groupe] = i;
  const [debut, duree] = liste[i];
  const d = Math.min(duree, dureeMax ?? duree);
  const src = a.createBufferSource();
  src.buffer = tampon;
  src.playbackRate.value = vitesse;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  if (dureeMax && dureeMax < duree) {
    // Coupé avant la fin : on l'éteint en douceur.
    g.gain.setValueAtTime(gain, t + (d / vitesse) * 0.6);
    g.gain.linearRampToValueAtTime(0, t + d / vitesse);
  }
  src.connect(g).connect(vers);
  src.start(t, debut, d + 0.005);
}

function jouerPas(fort: number, aGauche: boolean, retard = 0) {
  const a = son;
  if (!a || a.state !== "running" || !tampon) return;
  const t = a.currentTime + 0.005 + retard;
  const sortie = a.createGain();
  sortie.gain.value = VOLUME_PAS * fort * (0.85 + Math.random() * 0.3);
  const cote = a.createStereoPanner();
  cote.pan.value = aGauche ? -0.16 : 0.16;
  sortie.connect(cote).connect(a.destination);
  const course = courseEnCours();
  let entree: AudioNode = sortie;
  if (stylePas === "lourd") {
    // Plus grave et plus appuyé.
    const grave = a.createBiquadFilter();
    grave.type = "lowshelf";
    grave.frequency.value = 180;
    grave.gain.value = 7;
    grave.connect(sortie);
    entree = grave;
  }
  const groupe = stylePas === "beton" ? "beton" : stylePas === "gravats" ? "gravats" : "bottes";
  const hauteur = (stylePas === "lourd" ? 0.86 : stylePas === "gravats" ? 0.92 : 1) * (0.95 + Math.random() * 0.1) * (course ? 1.06 : 1);
  lire(groupe, entree, t, hauteur, 1);
  // Façon jeu de tir : le bruit de l'équipement (sangles, tissu) suit souvent le pas.
  if ((stylePas === "tactique" || stylePas === "lourd") && Math.random() < 0.65) {
    const aigu = a.createBiquadFilter();
    aigu.type = "highpass";
    aigu.frequency.value = 1200;
    aigu.connect(sortie);
    lire("equipement", aigu, t + 0.02 + Math.random() * 0.04, 0.95 + Math.random() * 0.15, stylePas === "lourd" ? 0.32 : 0.26, 0.22);
  }
}

/** Fait entendre trois pas du son choisi (au choix dans le panneau Mode jeu). */
export function ecouterPas() {
  preparerSon();
  const essai = () => {
    if (!son || son.state !== "running" || !tampon) return;
    for (let k = 0; k < 3; k++) jouerPas(1, k % 2 === 0, k * 0.42);
  };
  if (tampon && son?.state === "running") essai();
  else void chargement?.then(() => window.setTimeout(essai, 60));
}

// --- Flou des bords ---------------------------------------------------------------------

const matFlou = new THREE.ShaderMaterial({
  uniforms: {
    tImage: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    rayon: { value: 12 },
    force: { value: 0.7 },
    trainee: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tImage;
    uniform vec2 resolution;
    uniform float rayon;
    uniform float force;
    uniform vec2 trainee;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float aspect = resolution.x / resolution.y;
      // 0 au centre, 1 dans les coins.
      float d = length(c * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
      float zone = smoothstep(0.38, 1.0, d);
      float r = zone * rayon * force;
      vec3 col = texture(tImage, vUv).rgb;
      if (r > 0.75) {
        // Huit points autour, lus dans une version réduite de l'image : flou doux et léger.
        float lod = log2(max(r * 0.5, 1.0));
        vec3 somme = textureLod(tImage, vUv, lod).rgb;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398 + 0.39;
          vec2 o = vec2(cos(a), sin(a)) * r * 0.7 / resolution;
          somme += textureLod(tImage, vUv + o, lod).rgb;
        }
        col = mix(col, somme / 9.0, smoothstep(0.75, 3.0, r));
      }
      // En tournant vite : l'image file dans le sens du mouvement, surtout sur les bords.
      vec2 t = trainee * mix(0.45, 1.0, zone);
      float lt = length(t);
      if (lt > 1.0) {
        float lodm = log2(max(lt / 7.0, 1.0));
        vec3 s = vec3(0.0);
        for (int i = 0; i < 7; i++) {
          s += textureLod(tImage, vUv + t * (float(i) / 6.0 - 0.5) / resolution, lodm).rgb;
        }
        col = mix(col, s / 7.0, smoothstep(1.0, 6.0, lt));
      }
      // Vignette : les coins s'assombrissent un peu.
      col *= 1.0 - 0.32 * force * smoothstep(0.55, 1.15, d);
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const quad = new FullScreenQuad(matFlou);
let image: THREE.FramebufferTexture | null = null;
const taille = new THREE.Vector2();
let force = 0.7;

function flouter(dt: number) {
  const r = monde.renderer!.three;
  r.getDrawingBufferSize(taille);
  if (taille.x < 2 || taille.y < 2) return;
  if (!image || image.image.width !== taille.x || image.image.height !== taille.y) {
    image?.dispose();
    image = new THREE.FramebufferTexture(taille.x, taille.y);
    image.minFilter = THREE.LinearMipmapLinearFilter;
    image.magFilter = THREE.LinearFilter;
  }
  // Plus de flou en courant ou en tournant vite.
  const viser = 0.7 + 0.3 * THREE.MathUtils.clamp(vitesse / 3 + rotation / 2, 0, 1);
  force += (viser - force) * (1 - Math.exp(-dt * 5));
  r.setRenderTarget(null);
  r.copyFramebufferToTexture(image);
  // Versions réduites de l'image, lues par le flou.
  const gl = r.getContext();
  const h = (r.properties.get(image) as { __webglTexture?: WebGLTexture }).__webglTexture;
  if (!h) return;
  r.state.bindTexture(gl.TEXTURE_2D, h);
  gl.generateMipmap(gl.TEXTURE_2D);
  r.state.unbindTexture();
  matFlou.uniforms.tImage.value = image;
  matFlou.uniforms.resolution.value.copy(taille);
  matFlou.uniforms.rayon.value = taille.y * 0.014;
  matFlou.uniforms.force.value = force;
  // Traînée : le glissement de l'image pendant 1/45 s, en pixels (borné).
  const persp = monde.camera.threePersp;
  const focale = cam() === persp ? taille.y / 2 / Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2) : 0;
  const tr = matFlou.uniforms.trainee.value as THREE.Vector2;
  tr.set(tourne.x, tourne.y).multiplyScalar(focale / 45);
  if (tr.length() > taille.y * 0.04) tr.setLength(taille.y * 0.04);
  const auto = r.autoClear;
  r.autoClear = false;
  quad.render(r);
  r.autoClear = auto;
}

// --- Branchement sur le dessin -----------------------------------------------------------

let dernier = 0;
let dt = 0;
let debutImage = -1;
monde.renderer!.onBeforeUpdate.add(() => {
  // Déclenché deux fois par image par la bibliothèque (avant et après le dessin) : on ne
  // compte qu'une fois par image.
  const t = performance.now();
  if (debutImage >= 0 && t - debutImage < 100) return;
  debutImage = t;
  // Vrai temps écoulé (borné à 0,5 s) : la vitesse mesurée reste juste même si une image tarde.
  dt = dernier ? Math.min(0.5, (t - dernier) / 1000) : 0;
  dernier = t;
  if (!enMarche() || !(reglages.marche || reglages.flou || reglages.pas)) {
    avant.pret = false;
    vitesse = rotation = ampleur = elan = 0;
    tourne.set(0, 0);
    return;
  }
  mesurer(dt);
  avancerPhase(dt);
  if (reglages.marche) {
    balancer();
    elargir(dt);
  }
});
monde.renderer!.onAfterUpdate.add(() => {
  try {
    if (reglages.flou && enMarche()) flouter(dt);
  } finally {
    retablir();
    debutImage = -1;
  }
});

/** Pour les essais : état mesuré. */
export const etatEffets = () => ({ vitesse, rotation, phase, ampleur, elan, son: son?.state ?? "aucun" });
