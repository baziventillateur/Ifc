// Plan de localisation de la visite, comme dans les jeux vidéo.
// - Un radar rond (bas à gauche sur ordinateur, haut à gauche sur téléphone) : le plan du
//   niveau tourne pour que la direction du regard soit toujours vers le haut ; flèche
//   orange et champ de vision au centre, « N » sur le bord, photos situées en points orange.
// - Au toucher (ou touche M) : tout le niveau au milieu de l'écran, « Suivre » ou « Global »,
//   choix de l'étage, et un toucher sur le plan y emmène.
//
// Le plan, c'est la coupe des murs, poteaux et façades à 1,20 m au-dessus du sol du niveau,
// calculée une fois par niveau en arrière-plan à partir de la vraie géométrie. Ensuite, le
// dessin n'est qu'un tracé de lignes, refait seulement quand la vue bouge.

import * as THREE from "three";
import { jouerBruitage } from "./sons";
import { bouton, cree, monde, pause } from "./noyau";
import { changement, visibles, type Maquette } from "./registre";
import { boitesDe, decalageDe } from "./deplacements";
import type { Sol } from "./niveaux";

const HAUTEUR_COUPE = 1.2; // au-dessus du sol du niveau (m)
const RAYON_RADAR = 12; // mètres visibles du centre au bord du radar
const ENCRE = "#1d2530";
const ORANGE = "#ff8a1f";
const CATEGORIES = [/^IFCWALL/, /^IFCCOLUMN$/, /^IFCCURTAINWALL$/, /^IFCPLATE$/, /^IFCMEMBER$/];

// --- Coupe des murs à une hauteur -------------------------------------------------------

type Porteurs = { ids: number[]; boites: (THREE.Box3 | null)[] };
const porteurs = new Map<string, Promise<Porteurs>>();
function porteursDe(m: Maquette) {
  let p = porteurs.get(m.id);
  if (!p) {
    p = (async () => {
      const parCategorie = await m.modele.getItemsOfCategories(CATEGORIES);
      const ids = [...new Set(Object.values(parCategorie).flat())];
      const boites = ids.length ? await boitesDe(m, ids) : [];
      return { ids, boites };
    })();
    porteurs.set(m.id, p);
    p.catch(() => porteurs.delete(m.id));
  }
  return p;
}

/** Un niveau dessiné : les traits (x1, z1, x2, z2…) et leur emprise. */
type Trace = { traits: Float32Array; chemin: Path2D; min: THREE.Vector2; max: THREE.Vector2 };
const traces = new Map<string, Promise<Trace>>();
changement.on(() => traces.clear());

function cleTrace(sol: Sol) {
  return `${visibles()
    .map((m) => m.id)
    .sort()
    .join("|")}@${Math.round(sol.y * 100)}`;
}
function traceDe(sol: Sol) {
  const cle = cleTrace(sol);
  let p = traces.get(cle);
  if (!p) {
    p = calculerTrace(sol.y + HAUTEUR_COUPE);
    traces.set(cle, p);
    p.catch(() => traces.delete(cle));
  }
  return p;
}

async function calculerTrace(y0: number): Promise<Trace> {
  // Un soupçon au-dessus : évite de tomber pile sur les sommets d'une dalle ou d'un appui.
  const y = y0 + 0.0137;
  const sortie: number[] = [];
  for (const m of visibles()) {
    const { ids, boites } = await porteursDe(m);
    const coupes = ids.filter((_, i) => {
      const b = boites[i];
      return b && !b.isEmpty() && b.min.y < y && b.max.y > y;
    });
    m.modele.object.updateMatrixWorld(true);
    const mondeModele = m.modele.object.matrixWorld;
    for (let i = 0; i < coupes.length; i += 150) {
      const lot = coupes.slice(i, i + 150);
      const geos = await m.modele.getItemsGeometry(lot);
      lot.forEach((id, k) => {
        const decalage = decalageDe(m.id, id);
        for (const md of geos[k] ?? []) {
          if (!md.positions || !md.indices || md.positions.length < 9) continue;
          couper(md.positions, md.indices, mondeModele.clone().multiply(md.transform), decalage, y, sortie);
        }
      });
      await pause();
    }
  }
  const traits = new Float32Array(sortie);
  const chemin = new Path2D();
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);
  for (let i = 0; i < traits.length; i += 4) {
    chemin.moveTo(traits[i], traits[i + 1]);
    chemin.lineTo(traits[i + 2], traits[i + 3]);
    min.x = Math.min(min.x, traits[i], traits[i + 2]);
    min.y = Math.min(min.y, traits[i + 1], traits[i + 3]);
    max.x = Math.max(max.x, traits[i], traits[i + 2]);
    max.y = Math.max(max.y, traits[i + 1], traits[i + 3]);
  }
  return { traits, chemin, min, max };
}

/** Coupe chaque triangle par le plan horizontal y : un trait (x, z) par triangle traversé. */
function couper(
  pos: ArrayLike<number>,
  idx: ArrayLike<number>,
  m: THREE.Matrix4,
  d: THREE.Vector3 | null,
  y: number,
  sortie: number[],
) {
  const e = m.elements;
  const n = pos.length / 3;
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);
  const dx = d?.x ?? 0;
  const dy = d?.y ?? 0;
  const dz = d?.z ?? 0;
  for (let i = 0; i < n; i++) {
    const a = pos[i * 3];
    const b = pos[i * 3 + 1];
    const c = pos[i * 3 + 2];
    X[i] = e[0] * a + e[4] * b + e[8] * c + e[12] + dx;
    Y[i] = e[1] * a + e[5] * b + e[9] * c + e[13] + dy - y;
    Z[i] = e[2] * a + e[6] * b + e[10] * c + e[14] + dz;
  }
  const p: number[] = [];
  const arete = (a: number, b: number) => {
    if (Y[a] > 0 === Y[b] > 0) return;
    const s = Y[a] / (Y[a] - Y[b]);
    p.push(X[a] + (X[b] - X[a]) * s, Z[a] + (Z[b] - Z[a]) * s);
  };
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const ya = Y[a] > 0;
    if (ya === Y[b] > 0 && ya === Y[c] > 0) continue;
    p.length = 0;
    arete(a, b);
    arete(b, c);
    arete(c, a);
    if (p.length === 4) sortie.push(p[0], p[1], p[2], p[3]);
  }
}

// --- Liens avec la visite et les photos ---------------------------------------------------

type Visite = {
  niveaux: Sol[];
  /** Se rendre à un endroit d'un niveau (toucher sur le plan). */
  allerA: (sol: Sol, x: number, z: number, teleport?: boolean) => void;
  /** Étage au-dessus (+1) ou en dessous (−1). */
  etage?: (sens: 1 | -1) => void;
  /** Étages accessibles (null : boutons cachés, par exemple en anti-gravité). */
  etagesDispo?: () => { haut: boolean; bas: boolean } | null;
};
let visite: Visite | null = null;
type PointPhoto = { id: string; p: [number, number, number] };
let sourcePhotos: () => PointPhoto[] = () => [];
let ouvrirPhoto: (id: string) => void = () => undefined;
/** Les photos situées (captures.ts) : points orange sur le plan, touchables en vue globale. */
export function definirPhotosDuPlan(source: () => PointPhoto[], ouvrir: (id: string) => void) {
  sourcePhotos = source;
  ouvrirPhoto = ouvrir;
}

/** Le niveau sous l'œil : le plus haut sol au moins 40 cm plus bas. */
function niveauSousOeil(y: number) {
  let n: Sol | null = null;
  for (const s of visite?.niveaux ?? []) if (s.y <= y - 0.4) n = s;
  return n ?? visite?.niveaux[0] ?? null;
}
const photosDe = (sol: Sol) => sourcePhotos().filter((ph) => ph.p[1] > sol.y - 0.3 && ph.p[1] < sol.y + 2.6);

// --- Radar --------------------------------------------------------------------------------

const radar = cree("div", "radar");
radar.hidden = true;
const disque = cree("button", "radar-disque");
disque.type = "button";
disque.setAttribute("aria-label", "Plan du niveau : toucher pour tout voir (touche M)");
const toile = cree("canvas", "radar-toile");
const attente = cree("span", "radar-attente", "Plan en préparation…");
disque.append(toile, attente);
const etiquette = cree("span", "radar-niveau");
radar.append(disque, etiquette);
disque.addEventListener("click", () => ouvrirGlobal());

// Monter / descendre d'un étage : deux flèches à droite du radar.
const FLECHE = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const boutonsEtage = cree("div", "radar-etages");
const btnHaut = bouton("radar-etage", "", () => visite?.etage?.(1), "Monter d'un étage (E ou Espace)");
btnHaut.innerHTML = FLECHE('<path d="m5 11 7-7 7 7"/><path d="M12 20V4"/>');
const btnBas = bouton("radar-etage", "", () => visite?.etage?.(-1), "Descendre d'un étage (C ou A)");
btnBas.innerHTML = FLECHE('<path d="m19 13-7 7-7-7"/><path d="M12 4v16"/>');
boutonsEtage.append(btnHaut, btnBas);
radar.append(boutonsEtage);
const etatEtages = { vu: "" };
function majEtages() {
  const d = visite?.etagesDispo?.() ?? null;
  const cle = d ? `${d.haut}${d.bas}` : "";
  if (cle === etatEtages.vu) return;
  etatEtages.vu = cle;
  boutonsEtage.hidden = !d;
  btnHaut.disabled = !d?.haut;
  btnBas.disabled = !d?.bas;
}

let niveauRadar: Sol | null = null;
let traceRadar: Trace | null = null;
let demande = 0;
let boucle = 0;
const derniere = { x: NaN, z: NaN, a: NaN, w: 0, n: "" };
const tmp = new THREE.Vector3();

function placerRadar() {
  // Téléphone : sous les onglets de la colonne de gauche. Ordinateur : coin bas gauche (CSS).
  const colonne = document.querySelector(".colonne");
  if (colonne && radar.parentElement !== colonne) colonne.append(radar);
  else if (!colonne && !radar.parentElement) document.body.append(radar);
}

function cap(cam: THREE.Camera, avant: number) {
  const d = cam.getWorldDirection(tmp);
  return Math.hypot(d.x, d.z) < 1e-3 ? avant : Math.atan2(d.z, d.x);
}
let capRadar = -Math.PI / 2;

function suivreNiveau(y: number) {
  const n = niveauSousOeil(y);
  if (!n || n === niveauRadar) return;
  niveauRadar = n;
  traceRadar = null;
  etiquette.textContent = n.nom;
  attente.hidden = false;
  const id = ++demande;
  void traceDe(n)
    .then((t) => {
      if (id !== demande) return;
      traceRadar = t;
      attente.hidden = true;
      derniere.n = "";
    })
    .catch(() => {
      if (id === demande) attente.textContent = "Plan indisponible";
    });
}

function tourDeRadar() {
  boucle = requestAnimationFrame(tourDeRadar);
  if (!visite || radar.hidden) return;
  majEtages();
  const cam = monde.camera.three;
  suivreNiveau(cam.position.y);
  capRadar = cap(cam, capRadar);
  const w = disque.clientWidth;
  const cle = `${traceRadar ? 1 : 0}${niveauRadar?.nom}`;
  if (
    Math.abs(cam.position.x - derniere.x) < 0.01 &&
    Math.abs(cam.position.z - derniere.z) < 0.01 &&
    Math.abs(capRadar - derniere.a) < 0.002 &&
    w === derniere.w &&
    cle === derniere.n
  ) {
    return;
  }
  Object.assign(derniere, { x: cam.position.x, z: cam.position.z, a: capRadar, w, n: cle });
  dessinerRadar(w);
}

function preparerToile(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Angle de vue horizontal de la caméra (pour le cône de vision). */
function angleHorizontal() {
  const p = monde.camera.threePersp;
  return 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov) / 2) * p.aspect);
}

function dessinerVision(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, longueur: number, taille: number) {
  const demi = Math.min(angleHorizontal(), THREE.MathUtils.degToRad(170)) / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Champ de vision (vers +x avant rotation).
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, longueur, -demi, demi);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,138,31,0.26)";
  ctx.fill();
  // Flèche.
  ctx.beginPath();
  ctx.moveTo(taille * 1.1, 0);
  ctx.lineTo(-taille * 0.8, taille * 0.8);
  ctx.lineTo(-taille * 0.4, 0);
  ctx.lineTo(-taille * 0.8, -taille * 0.8);
  ctx.closePath();
  ctx.fillStyle = ORANGE;
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

function dessinerPhotos(ctx: CanvasRenderingContext2D, sol: Sol | null, rayon: number, echelle: number) {
  if (!sol) return;
  for (const ph of photosDe(sol)) {
    ctx.beginPath();
    ctx.arc(ph.p[0], ph.p[2], rayon / echelle, 0, Math.PI * 2);
    ctx.fillStyle = ORANGE;
    ctx.fill();
    ctx.lineWidth = 1.4 / echelle;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
}

function dessinerRadar(w: number) {
  if (w < 10) return;
  const ctx = preparerToile(toile, w, w);
  const r = w / 2;
  const cam = monde.camera.three.position;
  const echelle = r / RAYON_RADAR;
  // Le plan tourne : la direction du regard pointe vers le haut.
  const rotation = -Math.PI / 2 - capRadar;
  if (traceRadar) {
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(rotation);
    ctx.scale(echelle, echelle);
    ctx.translate(-cam.x, -cam.z);
    ctx.lineWidth = 1.5 / echelle;
    ctx.lineCap = "round";
    ctx.strokeStyle = ENCRE;
    ctx.stroke(traceRadar.chemin);
    dessinerPhotos(ctx, niveauRadar, w > 150 ? 4 : 3, echelle);
    ctx.restore();
  }
  dessinerVision(ctx, r, r, -Math.PI / 2, r * 0.62, w > 150 ? 8 : 6);
  // Le nord sur le bord (le nord du plan est vers -z).
  const aNord = -Math.PI / 2 + rotation;
  const rn = r - (w > 150 ? 12 : 9);
  const nx = r + Math.cos(aNord) * rn;
  const ny = r + Math.sin(aNord) * rn;
  ctx.beginPath();
  ctx.arc(nx, ny, w > 150 ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = ENCRE;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${w > 150 ? 11 : 9}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", nx, ny + 0.5);
}

// --- Vue globale --------------------------------------------------------------------------

const fond = cree("div", "plan-global");
fond.hidden = true;
const boite = cree("div", "plan-global-boite");
boite.setAttribute("role", "dialog");
boite.setAttribute("aria-label", "Plan du niveau");
const entete = cree("div", "plan-global-entete");
const nomNiveau = cree("span", "radar-niveau");
const modes = cree("div", "plan-global-modes");
modes.setAttribute("role", "group");
modes.setAttribute("aria-label", "Mode du plan");
const btnSuivre = cree("button", "", "Suivre");
const btnGlobal = cree("button", "", "Global");
for (const b of [btnSuivre, btnGlobal]) b.type = "button";
modes.append(btnSuivre, btnGlobal);
const btnFermer = cree("button", "plan-global-fermer", "✕");
btnFermer.type = "button";
btnFermer.setAttribute("aria-label", "Fermer le plan");
entete.append(nomNiveau, modes, btnFermer);
const corps = cree("div", "plan-global-corps");
const toileGlobale = cree("canvas", "plan-global-toile");
const attenteGlobale = cree("span", "plan-global-attente", "Plan en préparation…");
const zone = cree("div", "plan-global-zone");
// Loupe : + / − et retour à 1× (aussi au pincement, à la molette et au clavier).
const loupeBtns = cree("div", "plan-global-loupe");
const btnPlus = bouton("plan-global-loupe-btn", "+", () => zoomerCentre(1.6), "Zoomer (+)");
const btnMoins = bouton("plan-global-loupe-btn", "−", () => zoomerCentre(1 / 1.6), "Reculer (−)");
const btnUn = bouton("plan-global-loupe-btn un", "1×", () => remettreLoupe(), "Revenir au plan entier");
loupeBtns.append(btnPlus, btnMoins, btnUn);
zone.append(toileGlobale, attenteGlobale, loupeBtns);
const etages = cree("div", "plan-global-etages");
corps.append(zone, etages);
const aide = cree(
  "p",
  "plan-global-aide",
  "Touchez un endroit pour vous y rendre · Pincez ou molette pour zoomer, glissez pour déplacer · Échap ou ✕ pour revenir",
);
boite.append(entete, corps, aide);
fond.append(boite);
document.body.append(fond);

let modeGlobal: "suivre" | "global" = "global";
let niveauGlobal: Sol | null = null;
let traceGlobale: Trace | null = null;
/** Transformation plan → écran de la vue globale (pour retrouver l'endroit touché). */
let vers = { echelle: 1, ox: 0, oy: 0 };
let boucleGlobale = 0;

// --- Loupe de la carte : zoom autour d'un point, déplacement ------------------------------
const ZOOM_MAX = 14;
/** Agrandissement et décalage (en pixels) appliqués par-dessus le cadrage du plan. */
const loupe = { z: 1, tx: 0, ty: 0 };
function majLoupe() {
  btnPlus.disabled = loupe.z >= ZOOM_MAX - 1e-3;
  btnMoins.disabled = loupe.z <= 1 + 1e-3;
  btnUn.hidden = loupe.z <= 1 + 1e-3 && Math.abs(loupe.tx) + Math.abs(loupe.ty) < 1;
}
function remettreLoupe() {
  loupe.z = 1;
  loupe.tx = 0;
  loupe.ty = 0;
  majLoupe();
  dessinerGlobal();
}
/** Zoome d'un facteur f en gardant immobile le point (px, py) de la carte. */
function zoomer(f: number, px: number, py: number) {
  const z = Math.min(ZOOM_MAX, Math.max(1, loupe.z * f));
  const k = z / loupe.z;
  loupe.tx = px - k * (px - loupe.tx);
  loupe.ty = py - k * (py - loupe.ty);
  loupe.z = z;
  // Revenu à 1× par le zoom arrière : le plan se recentre.
  if (z <= 1 + 1e-3 && f < 1) loupe.tx = loupe.ty = 0;
  majLoupe();
  dessinerGlobal();
}
function zoomerCentre(f: number) {
  zoomer(f, zone.clientWidth / 2, zone.clientHeight / 2);
}

const doigts = new Map<number, { x: number; y: number }>();
let depart: { x: number; y: number } | null = null;
let glisse = false;
function posDans(e: PointerEvent | WheelEvent) {
  const r = toileGlobale.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
toileGlobale.addEventListener("pointerdown", (e) => {
  toileGlobale.setPointerCapture?.(e.pointerId);
  doigts.set(e.pointerId, posDans(e));
  if (doigts.size === 1) {
    depart = posDans(e);
    glisse = false;
  } else glisse = true;
});
toileGlobale.addEventListener("pointermove", (e) => {
  const avant = doigts.get(e.pointerId);
  if (!avant) return;
  const ici = posDans(e);
  if (doigts.size === 1) {
    if (!glisse && depart && Math.hypot(ici.x - depart.x, ici.y - depart.y) > 6) glisse = true;
    if (glisse) {
      loupe.tx += ici.x - avant.x;
      loupe.ty += ici.y - avant.y;
      majLoupe();
    }
  } else if (doigts.size === 2) {
    // Pincement : zoom autour du milieu des deux doigts, qui entraîne aussi le plan.
    const [a, b] = [...doigts.entries()].map(([id, p]) => (id === e.pointerId ? ici : p));
    const [a0, b0] = [...doigts.values()];
    const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
    const d1 = Math.hypot(a.x - b.x, a.y - b.y);
    if (d0 > 10) zoomer(d1 / d0, m0.x, m0.y);
    loupe.tx += m1.x - m0.x;
    loupe.ty += m1.y - m0.y;
    majLoupe();
  }
  doigts.set(e.pointerId, ici);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
  toileGlobale.addEventListener(type, (e) => {
    doigts.delete(e.pointerId);
    if (!doigts.size) depart = null;
  });
}
zone.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = posDans(e);
    const pas = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomer(Math.exp(-pas * 0.0018), p.x, p.y);
  },
  { passive: false },
);

function majModes() {
  btnSuivre.setAttribute("aria-pressed", String(modeGlobal === "suivre"));
  btnGlobal.setAttribute("aria-pressed", String(modeGlobal === "global"));
}
btnSuivre.addEventListener("click", () => ((modeGlobal = "suivre"), majModes(), remettreLoupe()));
btnGlobal.addEventListener("click", () => ((modeGlobal = "global"), majModes(), remettreLoupe()));
btnFermer.addEventListener("click", () => fermerGlobal());
fond.addEventListener("pointerdown", (e) => e.target === fond && fermerGlobal());

function remplirEtages() {
  etages.replaceChildren();
  for (const s of [...(visite?.niveaux ?? [])].reverse()) {
    const b = cree("button", "", s.nom);
    b.type = "button";
    b.title = s.nom;
    b.setAttribute("aria-pressed", String(s === niveauGlobal));
    b.addEventListener("click", () => choisirNiveauGlobal(s));
    etages.append(b);
  }
}

function choisirNiveauGlobal(s: Sol) {
  niveauGlobal = s;
  traceGlobale = null;
  nomNiveau.textContent = s.nom;
  attenteGlobale.hidden = false;
  remplirEtages();
  dessinerGlobal();
  void traceDe(s).then((t) => {
    if (niveauGlobal !== s) return;
    traceGlobale = t;
    attenteGlobale.hidden = true;
    dessinerGlobal();
  });
}

export function ouvrirGlobal() {
  if (!visite || !fond.hidden) return;
  fond.hidden = false;
  jouerBruitage("carte_ouvre");
  modeGlobal = "global";
  majModes();
  loupe.z = 1;
  loupe.tx = loupe.ty = 0;
  majLoupe();
  choisirNiveauGlobal(niveauSousOeil(monde.camera.three.position.y) ?? visite.niveaux[0]);
  const tour = () => {
    boucleGlobale = requestAnimationFrame(tour);
    dessinerGlobal();
  };
  boucleGlobale = requestAnimationFrame(tour);
}
export function fermerGlobal(sonFermeture = true) {
  if (fond.hidden) return;
  fond.hidden = true;
  if (sonFermeture) jouerBruitage("carte_ferme");
  cancelAnimationFrame(boucleGlobale);
}

function dessinerGlobal() {
  if (fond.hidden || !niveauGlobal) return;
  const w = zone.clientWidth;
  const h = zone.clientHeight;
  if (w < 10 || h < 10) return;
  const ctx = preparerToile(toileGlobale, w, h);
  const cam = monde.camera.three.position;
  const ici = niveauSousOeil(cam.y) === niveauGlobal;
  let echelle: number;
  let cx: number;
  let cz: number;
  const t = traceGlobale;
  if (modeGlobal === "suivre" || !t || !Number.isFinite(t.min.x)) {
    echelle = Math.min(w, h) / 2 / (RAYON_RADAR * 1.3);
    cx = ici || !t ? cam.x : (t.min.x + t.max.x) / 2;
    cz = ici || !t ? cam.z : (t.min.y + t.max.y) / 2;
  } else {
    const marge = 14;
    echelle = Math.min((w - marge * 2) / Math.max(1, t.max.x - t.min.x), (h - marge * 2) / Math.max(1, t.max.y - t.min.y));
    cx = (t.min.x + t.max.x) / 2;
    cz = (t.min.y + t.max.y) / 2;
  }
  // Cadrage du plan, puis la loupe par-dessus.
  vers = {
    echelle: echelle * loupe.z,
    ox: loupe.z * (w / 2 - cx * echelle) + loupe.tx,
    oy: loupe.z * (h / 2 - cz * echelle) + loupe.ty,
  };
  echelle = vers.echelle;
  if (t) {
    ctx.save();
    ctx.translate(vers.ox, vers.oy);
    ctx.scale(echelle, echelle);
    ctx.lineWidth = 1.4 / echelle;
    ctx.lineCap = "round";
    ctx.strokeStyle = ENCRE;
    ctx.stroke(t.chemin);
    dessinerPhotos(ctx, niveauGlobal, 6, echelle);
    ctx.restore();
  }
  if (ici) {
    dessinerVision(ctx, vers.ox + cam.x * echelle, vers.oy + cam.z * echelle, capRadar, Math.max(28, 4 * echelle), 9);
  }
}

// Toucher sur le plan : une photo s'ouvre, ou l'on s'y rend.
toileGlobale.addEventListener("click", (e) => {
  // Un glissé ou un pincement n'est pas un toucher.
  if (glisse) return void (glisse = false);
  if (!visite || !niveauGlobal) return;
  const r = toileGlobale.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const x = (sx - vers.ox) / vers.echelle;
  const z = (sy - vers.oy) / vers.echelle;
  const photo = photosDe(niveauGlobal).find((ph) => Math.hypot(ph.p[0] - x, ph.p[2] - z) * vers.echelle < 14);
  // Vers un endroit : c'est le son de téléportation qu'on entend, pas la carte qui se ferme.
  fermerGlobal(!!photo);
  if (photo) return ouvrirPhoto(photo.id);
  visite.allerA(niveauGlobal, x, z, true);
});

// Clavier : M ouvre ou ferme le plan, Échap le ferme (sans quitter la visite).
window.addEventListener(
  "keydown",
  (e) => {
    const cible = e.target as HTMLElement | null;
    if (cible?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (!fond.hidden && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      zoomerCentre(e.key === "-" ? 1 / 1.6 : 1.6);
    } else if (e.key === "Escape" && !fond.hidden) {
      e.stopImmediatePropagation();
      e.preventDefault();
      fermerGlobal();
    } else if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.altKey && visite && !radar.hidden) {
      e.preventDefault();
      if (fond.hidden) ouvrirGlobal();
      else fermerGlobal();
    }
  },
  { capture: true },
);

// --- Ouverture par la visite ----------------------------------------------------------------

/** Affiche le radar pendant la marche (visite.ts). */
export function ouvrirPlan(v: Visite) {
  if (visite === v && !radar.hidden) return;
  visite = v;
  placerRadar();
  radar.hidden = false;
  document.body.classList.add("plan-visible");
  niveauRadar = null;
  derniere.n = "";
  if (!boucle) boucle = requestAnimationFrame(tourDeRadar);
  // Les autres niveaux se préparent ensuite, sans gêner.
  const reste = [...v.niveaux];
  const suivant = () => {
    const s = reste.shift();
    if (!s || visite !== v) return;
    void traceDe(s)
      .catch(() => undefined)
      .then(() => window.setTimeout(suivant, 400));
  };
  window.setTimeout(suivant, 3000);
}

/** Cache le radar (sortie de la marche ou de la visite). */
export function fermerPlan() {
  visite = null;
  radar.hidden = true;
  document.body.classList.remove("plan-visible");
  fermerGlobal();
  cancelAnimationFrame(boucle);
  boucle = 0;
}
