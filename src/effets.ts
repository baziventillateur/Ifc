// Effets « jeu vidéo » de la visite à la première personne, au choix (cochés dans le panneau
// de visite, retenus sur l'appareil) :
// - Marche : la vue se balance légèrement à chaque pas (haut-bas, un peu de côté, une
//   pointe d'inclinaison), selon la vitesse réelle de déplacement. Ne coûte rien.
// - Flou des bords : le centre reste net, les bords et les coins se floutent et s'assombrissent
//   un peu (comme dans les jeux de tir). Le flou se renforce quand on court ou qu'on
//   tourne vite. Coûte une copie de l'image et une passe par image : en option.
//
// Le balancement décale la caméra le temps du dessin seulement : les outils (sélection,
// mesure, captures…) voient toujours la vraie position de l'œil.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { monde } from "./noyau";
import { modeVisite } from "./navigation";
import { arActif } from "./suivi";

export type Effet = "marche" | "flou";
const CLE = "nexbim-effets";
const reglages: Record<Effet, boolean> = { marche: false, flou: false };
try {
  Object.assign(reglages, JSON.parse(localStorage.getItem(CLE) ?? "{}"));
} catch {
  // Désactivés par défaut.
}
export const effetActif = (e: Effet) => reglages[e];
export function reglerEffet(e: Effet, oui: boolean) {
  reglages[e] = oui;
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
  }
  avant.p.copy(p);
  avant.d.copy(d);
  avant.pret = true;
}

// --- Balancement de marche -------------------------------------------------------------

let phase = 0;
let ampleur = 0; // 0 à l'arrêt, 1 en marche
const sauve = { p: new THREE.Vector3(), q: new THREE.Quaternion(), applique: false };

function balancer(dt: number) {
  const viser = THREE.MathUtils.clamp(vitesse / 1.2, 0, 1);
  ampleur += (viser - ampleur) * (1 - Math.exp(-dt * 6));
  if (ampleur < 0.002) {
    ampleur = 0;
    return;
  }
  // Foulée plus longue quand on va vite : la cadence reste naturelle.
  const foulee = 0.6 + 0.12 * vitesse;
  phase += ((vitesse * dt) / foulee) * Math.PI;
  const A = Math.min(0.06, 0.025 + 0.006 * vitesse) * ampleur; // haut-bas (m)
  const c = cam();
  sauve.p.copy(c.position);
  sauve.q.copy(c.quaternion);
  sauve.applique = true;
  c.updateMatrixWorld();
  const droite = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
  // Un creux à chaque pas, un aller-retour de côté tous les deux pas.
  // (la phase avance d'un demi-tour par pas).
  c.position.y += A * (Math.abs(Math.sin(phase)) - 0.5);
  c.position.addScaledVector(droite, A * 0.55 * Math.sin(phase));
  c.rotateZ(THREE.MathUtils.degToRad(0.45) * ampleur * Math.sin(phase));
  c.updateMatrixWorld();
}
function retablir() {
  if (!sauve.applique) return;
  const c = cam();
  c.position.copy(sauve.p);
  c.quaternion.copy(sauve.q);
  c.updateMatrixWorld();
  sauve.applique = false;
}

// --- Flou des bords ---------------------------------------------------------------------

const matFlou = new THREE.ShaderMaterial({
  uniforms: {
    tImage: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    rayon: { value: 12 },
    force: { value: 0.7 },
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
  dt = dernier ? Math.min(0.1, (t - dernier) / 1000) : 0;
  dernier = t;
  if (!enMarche() || !(reglages.marche || reglages.flou)) {
    avant.pret = false;
    vitesse = rotation = ampleur = 0;
    return;
  }
  mesurer(dt);
  if (reglages.marche) balancer(dt);
});
monde.renderer!.onAfterUpdate.add(() => {
  try {
    if (reglages.flou && enMarche()) flouter(dt);
  } finally {
    retablir();
    debutImage = -1;
  }
});
