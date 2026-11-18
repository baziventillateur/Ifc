// Mesures : distances et surfaces, avec accrochage visible aux sommets et aux arêtes.
// - Distance orthogonale par défaut : hauteur, ou horizontale selon l'axe de l'arête
//   cliquée (sinon les axes X / Y de la maquette). La cote se place au second point,
//   avec une ligne de rappel vers le premier. Mode libre pour les cotes obliques.
// - Surface : polygone de points, aire (m²) et périmètre.
// Tout est dessiné par-dessus l'image (SVG) : visible à travers les murs, net à tout zoom.
import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import { alerte, bouton, boutonIcone, cree, el, lanceur, monde, nombre } from "../noyau";
import { definirModeClic } from "../fiche";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { interrupteur, note } from "./ui";

type Point = { point: THREE.Vector3; classe: FRAGS.SnappingClass; p1?: THREE.Vector3; p2?: THREE.Vector3 };
type Axe = "libre" | "hauteur" | "h1" | "h2";
type Calcul = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  axe: Axe;
  valeur: number;
  /** Extrémités de la flèche (la cote est placée au second point). */
  f1: THREE.Vector3;
  f2: THREE.Vector3;
};
type Distance = Calcul & { type: "distance"; trace: SVGGElement; etiquette: HTMLElement };
type Surface = {
  type: "surface";
  points: THREE.Vector3[];
  aire: number;
  perimetre: number;
  trace: SVGGElement;
  etiquette: HTMLElement;
};
type Mesure = Distance | Surface;

const HAUT = new THREE.Vector3(0, 1, 0);
const CLE = "nexbim-mesure";
const reglages = { mode: "distance" as "distance" | "surface", ortho: true };
try {
  Object.assign(reglages, JSON.parse(localStorage.getItem(CLE) || "{}"));
} catch {
  // Réglages par défaut.
}
const sauver = () => {
  try {
    localStorage.setItem(CLE, JSON.stringify(reglages));
  } catch {
    // Gardé pour la session.
  }
};

const calque = el("etiquettes");
const SVG = "http://www.w3.org/2000/svg";
const dessin = document.createElementNS(SVG, "svg");
dessin.classList.add("dessin-cotes");
calque.append(dessin);
const svg = <K extends keyof SVGElementTagNameMap>(nom: K, classe: string) => {
  const e = document.createElementNS(SVG, nom);
  e.setAttribute("class", classe);
  return e;
};

const mesures: Mesure[] = [];
let actif = false;
let liste: HTMLElement;
let actions: HTMLElement | null = null;

// --- Projection et dessin -----------------------------------------------------------

type P2 = { x: number; y: number };
function ecran(p: THREE.Vector3): P2 | null {
  const v = p.clone().project(monde.camera.three);
  if (v.z > 1 || v.z < -1) return null;
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}

const attr = (e: Element, valeurs: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(valeurs)) e.setAttribute(k, String(v));
};

function fleche(poly: SVGPolygonElement, p: P2, dx: number, dy: number, long: number) {
  const larg = long * 0.42;
  const bx = p.x - dx * long;
  const by = p.y - dy * long;
  poly.setAttribute("points", `${p.x},${p.y} ${bx - dy * larg},${by + dx * larg} ${bx + dy * larg},${by - dx * larg}`);
}

function nouveauTraceDistance(apercu = false) {
  const g = svg("g", "trace-cote" + (apercu ? " apercu" : ""));
  g.append(
    svg("line", "cote-rappel"),
    svg("line", "cote-halo"),
    svg("line", "cote-trait"),
    svg("polygon", "cote-fleche"),
    svg("polygon", "cote-fleche"),
  );
  dessin.insertBefore(g, repere);
  return g;
}

function nouveauTraceSurface(apercu = false) {
  const g = svg("g", "trace-surface" + (apercu ? " apercu" : ""));
  g.append(svg("polygon", "surface-fond"), svg("polyline", "surface-bord"), svg("g", "surface-sommets"));
  dessin.insertBefore(g, repere);
  return g;
}

function placerEtiquette(div: HTMLElement, p: P2 | null) {
  div.style.display = p ? "" : "none";
  if (p) div.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
}

function tracerDistance(trace: SVGGElement, etiquette: HTMLElement, m: Calcul) {
  const pa = ecran(m.a);
  const p1 = ecran(m.f1);
  const p2 = ecran(m.f2);
  trace.style.display = p1 && p2 ? "" : "none";
  if (!p1 || !p2) {
    placerEtiquette(etiquette, null);
    return;
  }
  const [rappel, halo, trait, fl1, fl2] = [...trace.children] as [
    SVGLineElement,
    SVGLineElement,
    SVGLineElement,
    SVGPolygonElement,
    SVGPolygonElement,
  ];
  const longueur = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const dx = (p2.x - p1.x) / longueur;
  const dy = (p2.y - p1.y) / longueur;
  const tete = Math.min(13, longueur / 3);
  for (const l of [halo, trait])
    attr(l, {
      x1: p1.x + dx * tete * 0.6,
      y1: p1.y + dy * tete * 0.6,
      x2: p2.x - dx * tete * 0.6,
      y2: p2.y - dy * tete * 0.6,
    });
  fleche(fl1, p1, -dx, -dy, tete);
  fleche(fl2, p2, dx, dy, tete);
  // Ligne de rappel : du premier point cliqué au départ de la flèche (cote orthogonale).
  const rappelUtile = m.axe !== "libre" && pa && Math.hypot(pa.x - p1.x, pa.y - p1.y) > 2;
  rappel.style.display = rappelUtile ? "" : "none";
  if (rappelUtile && pa) attr(rappel, { x1: pa.x, y1: pa.y, x2: p1.x, y2: p1.y });
  placerEtiquette(etiquette, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
}

function tracerSurface(trace: SVGGElement, etiquette: HTMLElement, points: THREE.Vector3[], fermee: boolean) {
  const ecrans = points.map(ecran);
  const visibles = ecrans.filter((p): p is P2 => !!p);
  const ok = visibles.length === ecrans.length && visibles.length > 0;
  trace.style.display = ok ? "" : "none";
  if (!ok) {
    placerEtiquette(etiquette, null);
    return;
  }
  const [fond, bord, sommets] = [...trace.children] as [SVGPolygonElement, SVGPolylineElement, SVGGElement];
  const suite = visibles.map((p) => `${p.x},${p.y}`).join(" ");
  fond.setAttribute("points", visibles.length >= 3 ? suite : "");
  bord.setAttribute("points", fermee && visibles.length >= 3 ? `${suite} ${visibles[0].x},${visibles[0].y}` : suite);
  while (sommets.children.length < visibles.length) sommets.append(svg("circle", "surface-sommet"));
  while (sommets.children.length > visibles.length) sommets.lastChild!.remove();
  visibles.forEach((p, i) => attr(sommets.children[i], { cx: p.x, cy: p.y, r: 3.2 }));
  const c = visibles.reduce((s, p) => ({ x: s.x + p.x / visibles.length, y: s.y + p.y / visibles.length }), {
    x: 0,
    y: 0,
  });
  placerEtiquette(etiquette, visibles.length >= 3 ? c : null);
}

// --- Calculs -------------------------------------------------------------------------

/** Axes horizontaux : ceux de l'arête accrochée si elle est horizontale, sinon X / Y. */
function axesDe(p: Point) {
  if (p.p1 && p.p2) {
    const d = p.p2.clone().sub(p.p1);
    const dh = Math.hypot(d.x, d.z);
    if (dh > 1e-3 && Math.abs(d.y) < dh * 0.2) {
      const h1 = new THREE.Vector3(d.x, 0, d.z).normalize();
      return { h1, h2: new THREE.Vector3().crossVectors(HAUT, h1).normalize() };
    }
  }
  return { h1: new THREE.Vector3(1, 0, 0), h2: new THREE.Vector3(0, 0, 1) };
}

/** Axe dominant (hauteur ou l'un des deux horizontaux) et composante du vecteur d. */
function axeDominant(d: THREE.Vector3, p: Point) {
  const { h1, h2 } = axesDe(p);
  const choix: [Axe, THREE.Vector3, number][] = [
    ["hauteur", HAUT, d.dot(HAUT)],
    ["h1", h1, d.dot(h1)],
    ["h2", h2, d.dot(h2)],
  ];
  return choix.reduce((m, x) => (Math.abs(x[2]) > Math.abs(m[2]) ? x : m));
}

function calculer(a: Point, b: THREE.Vector3): Calcul {
  const d = b.clone().sub(a.point);
  if (!reglages.ortho) return { a: a.point, b, axe: "libre", valeur: d.length(), f1: a.point.clone(), f2: b.clone() };
  const [axe, dir, c] = axeDominant(d, a);
  // La cote est placée au second point et remonte jusqu'au niveau du premier.
  return { a: a.point, b, axe, valeur: Math.abs(c), f1: b.clone().addScaledVector(dir, -c), f2: b.clone() };
}

/** Sommet suivant d'une surface, aligné sur l'axe dominant depuis le précédent (mode orthogonal). */
function pointSurface(precedent: Point | null, p: THREE.Vector3) {
  if (!reglages.ortho || !precedent) return p.clone();
  const [, dir, c] = axeDominant(p.clone().sub(precedent.point), precedent);
  return precedent.point.clone().addScaledVector(dir, c);
}

function aireDe(points: THREE.Vector3[]) {
  if (points.length < 3) return 0;
  const n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) n.add(new THREE.Vector3().crossVectors(points[i], points[(i + 1) % points.length]));
  return n.length() / 2;
}

const perimetreDe = (points: THREE.Vector3[]) =>
  points.reduce((s, p, i) => s + p.distanceTo(points[(i + 1) % points.length]), 0);

const NOMS_AXE: Record<Axe, string> = { libre: "Libre", hauteur: "Hauteur", h1: "Horizontale", h2: "Horizontale" };
const texteDistance = (m: { axe: Axe; valeur: number }) =>
  `${m.axe === "hauteur" ? "↕ " : m.axe === "libre" ? "" : "↔ "}${nombre(m.valeur)} m`;
const texteSurface = (aire: number) => `${nombre(aire)} m²`;

// --- Accrochage au survol -------------------------------------------------------------

const repere = svg("g", "repere-accroche");
const arete = svg("line", "arete-accrochee");
const marque = svg("rect", "marque-accroche");
repere.append(arete, marque);
repere.style.display = "none";
dessin.append(repere);

let survol: Point | null = null;

async function viserMesure(e: { clientX: number; clientY: number }): Promise<Point | null> {
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  const position = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const hit: any = await lanceur.castRay({
    position,
    items: [],
    snappingClasses: [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE],
  } as any);
  if (!hit?.point) return null;
  return {
    point: hit.point.clone(),
    classe: hit.snappingClass ?? FRAGS.SnappingClass.FACE,
    p1: hit.snappedEdgeP1?.clone(),
    p2: hit.snappedEdgeP2?.clone(),
  };
}

function tracerRepere() {
  const p = actif && survol ? ecran(survol.point) : null;
  repere.style.display = p ? "" : "none";
  if (!survol || !p) return;
  const classe = survol.classe;
  const taille = classe === FRAGS.SnappingClass.POINT ? 10 : classe === FRAGS.SnappingClass.LINE ? 9 : 7;
  attr(marque, { x: p.x - taille / 2, y: p.y - taille / 2, width: taille, height: taille });
  marque.setAttribute("rx", classe === FRAGS.SnappingClass.FACE ? String(taille / 2) : "1");
  marque.setAttribute("transform", classe === FRAGS.SnappingClass.LINE ? `rotate(45 ${p.x} ${p.y})` : "");
  const e1 = classe === FRAGS.SnappingClass.LINE && survol.p1 ? ecran(survol.p1) : null;
  const e2 = classe === FRAGS.SnappingClass.LINE && survol.p2 ? ecran(survol.p2) : null;
  arete.style.display = e1 && e2 ? "" : "none";
  if (e1 && e2) attr(arete, { x1: e1.x, y1: e1.y, x2: e2.x, y2: e2.y });
}

// --- Saisie en cours ------------------------------------------------------------------

let premier: Point | null = null;
let apercuDistance: { trace: SVGGElement; etiquette: HTMLElement; m: Calcul } | null = null;
let polygone: Point[] = [];
let apercuSurface: { trace: SVGGElement; etiquette: HTMLElement } | null = null;

function oublierSaisie() {
  premier = null;
  apercuDistance?.trace.remove();
  apercuDistance?.etiquette.remove();
  apercuDistance = null;
  polygone = [];
  apercuSurface?.trace.remove();
  apercuSurface?.etiquette.remove();
  apercuSurface = null;
  majActions();
}

function pointsApercuSurface() {
  const pts = polygone.map((p) => p.point);
  if (survol) pts.push(pointSurface(polygone[polygone.length - 1] ?? null, survol.point));
  return pts;
}

function majApercus() {
  if (premier && survol) {
    if (!apercuDistance) {
      const etiquette = cree("div", "cote apercu");
      calque.append(etiquette);
      apercuDistance = { trace: nouveauTraceDistance(true), etiquette, m: calculer(premier, survol.point) };
    }
    apercuDistance.m = calculer(premier, survol.point);
    apercuDistance.etiquette.textContent = texteDistance(apercuDistance.m);
  }
  if (polygone.length) {
    if (!apercuSurface) {
      const etiquette = cree("div", "cote surface apercu");
      calque.append(etiquette);
      apercuSurface = { trace: nouveauTraceSurface(true), etiquette };
    }
    apercuSurface.etiquette.textContent = texteSurface(aireDe(pointsApercuSurface()));
  }
}

function retracer() {
  for (const m of mesures) {
    if (m.type === "distance") tracerDistance(m.trace, m.etiquette, m);
    else tracerSurface(m.trace, m.etiquette, m.points, true);
  }
  if (apercuDistance) tracerDistance(apercuDistance.trace, apercuDistance.etiquette, apercuDistance.m);
  if (apercuSurface) tracerSurface(apercuSurface.trace, apercuSurface.etiquette, pointsApercuSurface(), false);
  tracerRepere();
}
monde.renderer!.onAfterUpdate.add(retracer);

// Survol à la souris : un seul calcul à la fois, au plus une fois par image.
const canvas = monde.renderer!.three.domElement;
let enCalcul = false;
let dernier: PointerEvent | null = null;
canvas.addEventListener("pointermove", (e) => {
  if (!actif || e.pointerType !== "mouse" || e.buttons !== 0) return;
  dernier = e;
  if (enCalcul) return;
  enCalcul = true;
  requestAnimationFrame(async () => {
    try {
      survol = await viserMesure(dernier!);
      majApercus();
      retracer();
    } catch (err) {
      console.warn(err);
    } finally {
      enCalcul = false;
    }
  });
});
canvas.addEventListener("pointerleave", () => {
  survol = null;
  retracer();
});

// --- Validation des clics --------------------------------------------------------------

async function toucher(e: PointerEvent) {
  const v = await viserMesure(e);
  if (!v) {
    alerte("Touchez un élément de la maquette.", 2500);
    return;
  }
  survol = v;
  if (reglages.mode === "distance") {
    if (!premier) {
      premier = v;
      majApercus();
      retracer();
      majActions();
      return;
    }
    const m = calculer(premier, v.point);
    oublierSaisie();
    if (m.valeur < 1e-4) return;
    const etiquette = cree("div", "cote", texteDistance(m));
    calque.append(etiquette);
    const mesure: Distance = { type: "distance", ...m, trace: nouveauTraceDistance(), etiquette };
    mesures.push(mesure);
    tracerDistance(mesure.trace, mesure.etiquette, mesure);
    dessinerListe();
    return;
  }
  // Surface : un clic près du premier sommet ferme le polygone.
  const debut = polygone.length >= 3 ? ecran(polygone[0].point) : null;
  if (debut && Math.hypot(debut.x - e.clientX, debut.y - e.clientY) < 14) {
    terminerSurface();
    return;
  }
  polygone.push({ ...v, point: pointSurface(polygone[polygone.length - 1] ?? null, v.point) });
  majApercus();
  retracer();
  majActions();
}

function terminerSurface() {
  const points = polygone.map((p) => p.point);
  oublierSaisie();
  if (points.length < 3) {
    alerte("Une surface demande au moins 3 points.", 2500);
    return;
  }
  const aire = aireDe(points);
  const etiquette = cree("div", "cote surface", texteSurface(aire));
  calque.append(etiquette);
  const mesure: Surface = {
    type: "surface",
    points,
    aire,
    perimetre: perimetreDe(points),
    trace: nouveauTraceSurface(),
    etiquette,
  };
  mesures.push(mesure);
  tracerSurface(mesure.trace, mesure.etiquette, points, true);
  dessinerListe();
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!actif) return;
    if (e.key === "Enter" && polygone.length) terminerSurface();
    else if (e.key === "Escape" && (premier || polygone.length)) {
      e.stopImmediatePropagation();
      oublierSaisie();
    }
  },
  true,
);

// --- Panneau ---------------------------------------------------------------------------

function supprimer(m: Mesure) {
  m.trace.remove();
  m.etiquette.remove();
  mesures.splice(mesures.indexOf(m), 1);
  dessinerListe();
}

function dessinerListe() {
  liste.replaceChildren();
  mesures.forEach((m, i) => {
    const rang = cree("div", "resultat");
    const txt = cree("div", "resultat-texte");
    if (m.type === "distance") {
      txt.append(
        cree("strong", "", `${i + 1}. ${NOMS_AXE[m.axe]} ${nombre(m.valeur)} m`),
        cree(
          "span",
          "petit",
          m.axe === "libre" ? "cote oblique" : `en ligne droite : ${nombre(m.a.distanceTo(m.b))} m`,
        ),
      );
    } else {
      txt.append(
        cree("strong", "", `${i + 1}. Surface ${nombre(m.aire)} m²`),
        cree("span", "petit", `${m.points.length} sommets · périmètre ${nombre(m.perimetre)} m`),
      );
    }
    rang.append(txt, boutonIcone("retirer", () => supprimer(m), "Supprimer cette mesure"));
    liste.append(rang);
  });
  marquerOutil("mesure", mesures.length ? String(mesures.length) : false);
}

function majActions() {
  if (!actions) return;
  actions.replaceChildren();
  if (polygone.length) {
    actions.append(
      bouton("btn principal", `Terminer (${polygone.length} sommets)`, terminerSurface),
      bouton("btn", "Annuler", oublierSaisie),
    );
  } else if (premier) {
    actions.append(bouton("btn", "Annuler le premier point", oublierSaisie));
  }
}

enregistrerOutil("mesure", "Mesure", "Mesurer", (section) => {
  liste = cree("div", "liste");
  actions = cree("div", "rangee mesure-actions");
  const modes = cree("div", "segments");
  const aide = note("");
  const dessinerModes = () => {
    modes.replaceChildren(
      ...(["distance", "surface"] as const).map((mode) => {
        const b = bouton("segment" + (reglages.mode === mode ? " actif" : ""), mode === "distance" ? "Distance" : "Surface", () => {
          reglages.mode = mode;
          sauver();
          oublierSaisie();
          dessinerModes();
        });
        b.setAttribute("aria-pressed", String(reglages.mode === mode));
        return b;
      }),
    );
    aide.textContent =
      reglages.mode === "distance"
        ? "Touchez deux points : la cote suit le pointeur après le premier. Repère vert : sommet (carré), arête (losange)."
        : "Touchez les sommets, puis le premier sommet (ou « Terminer », ou Entrée) pour fermer la surface.";
  };
  dessinerModes();
  section.append(
    modes,
    interrupteur("Orthogonale (hauteur ou horizontale)", reglages.ortho, (v) => {
      reglages.ortho = v;
      sauver();
      majApercus();
      retracer();
    }).racine,
    aide,
    actions,
    liste,
    bouton("btn", "Effacer les mesures", () => {
      oublierSaisie();
      for (const m of [...mesures]) supprimer(m);
    }),
  );
  return {
    ouvrir: () => {
      actif = true;
      definirModeClic(toucher);
    },
    fermer: () => {
      actif = false;
      survol = null;
      oublierSaisie();
      retracer();
      definirModeClic(null);
    },
  };
});
