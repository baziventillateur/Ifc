// Mesure de distance entre deux points touchés, avec accrochage aux sommets et arêtes.
// La cote est dessinée par-dessus l'image (SVG) : trait vert avec une flèche à chaque
// bout, toujours visible à travers les murs, de même épaisseur quel que soit le zoom.
import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import { alerte, bouton, boutonIcone, cree, el, monde, nombre } from "../noyau";
import { definirModeClic, viser } from "../fiche";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { note } from "./ui";

type Cote = { a: THREE.Vector3; b: THREE.Vector3; trace: SVGGElement; etiquette: HTMLElement };

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

function nouveauTrace() {
  const g = svg("g", "trace-cote");
  g.append(svg("line", "cote-halo"), svg("line", "cote-trait"), svg("polygon", "cote-fleche"), svg("polygon", "cote-fleche"));
  dessin.append(g);
  return g;
}
const cotes: Cote[] = [];
let premier: { point: THREE.Vector3; repere: HTMLElement } | null = null;
let liste: HTMLElement;

/** Position à l'écran d'un point de la maquette, ou null s'il est derrière la caméra. */
function ecran(p: THREE.Vector3) {
  const v = p.clone().project(monde.camera.three);
  if (v.z > 1 || v.z < -1) return null;
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}

function placer(div: HTMLElement, p: THREE.Vector3) {
  const e = ecran(p);
  div.style.display = e ? "" : "none";
  if (e) div.style.transform = `translate(${e.x}px, ${e.y}px) translate(-50%, -50%)`;
}

/** Flèche pleine dont la pointe est en p, orientée selon d (vecteur unitaire). */
function fleche(poly: SVGPolygonElement, p: { x: number; y: number }, dx: number, dy: number, long: number) {
  const larg = long * 0.42;
  const bx = p.x - dx * long;
  const by = p.y - dy * long;
  poly.setAttribute("points", `${p.x},${p.y} ${bx - dy * larg},${by + dx * larg} ${bx + dy * larg},${by - dx * larg}`);
}

function tracer(c: Cote) {
  const pa = ecran(c.a);
  const pb = ecran(c.b);
  const visible = !!(pa && pb);
  c.trace.style.display = visible ? "" : "none";
  c.etiquette.style.display = visible ? "" : "none";
  if (!pa || !pb) return;
  const longueur = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const dx = (pb.x - pa.x) / longueur;
  const dy = (pb.y - pa.y) / longueur;
  const tete = Math.min(13, longueur / 3);
  const [halo, trait, f1, f2] = [...c.trace.children] as [SVGLineElement, SVGLineElement, SVGPolygonElement, SVGPolygonElement];
  for (const l of [halo, trait]) {
    l.setAttribute("x1", String(pa.x + dx * tete * 0.6));
    l.setAttribute("y1", String(pa.y + dy * tete * 0.6));
    l.setAttribute("x2", String(pb.x - dx * tete * 0.6));
    l.setAttribute("y2", String(pb.y - dy * tete * 0.6));
  }
  fleche(f1, pa, -dx, -dy, tete);
  fleche(f2, pb, dx, dy, tete);
  c.etiquette.style.transform = `translate(${(pa.x + pb.x) / 2}px, ${(pa.y + pb.y) / 2}px) translate(-50%, -50%)`;
}

monde.renderer!.onAfterUpdate.add(() => {
  for (const c of cotes) tracer(c);
  if (premier) placer(premier.repere, premier.point);
});

function texteCote(a: THREE.Vector3, b: THREE.Vector3) {
  return `${nombre(a.distanceTo(b))} m`;
}

function detail(a: THREE.Vector3, b: THREE.Vector3) {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const vert = Math.abs(b.y - a.y);
  return `horizontale ${nombre(horiz)} m · verticale ${nombre(vert)} m`;
}

function dessinerListe() {
  liste.replaceChildren();
  cotes.forEach((c, i) => {
    const rang = cree("div", "resultat");
    const txt = cree("div", "resultat-texte");
    txt.append(cree("strong", "", `${i + 1}. ${texteCote(c.a, c.b)}`), cree("span", "petit", detail(c.a, c.b)));
    rang.append(
      txt,
      boutonIcone("retirer", () => supprimer(c), "Supprimer cette mesure"),
    );
    liste.append(rang);
  });
  marquerOutil("mesure", cotes.length ? String(cotes.length) : false);
}

function supprimer(c: Cote) {
  c.trace.remove();
  c.etiquette.remove();
  cotes.splice(cotes.indexOf(c), 1);
  dessinerListe();
}

function oublierPremier() {
  premier?.repere.remove();
  premier = null;
}

async function toucher(e: PointerEvent) {
  const v = await viser(e, [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE]);
  if (!v) {
    alerte("Touchez un élément de la maquette.", 2500);
    return;
  }
  if (!premier) {
    const repere = cree("div", "repere-mesure");
    calque.append(repere);
    premier = { point: v.point, repere };
    placer(repere, v.point);
    return;
  }
  const a = premier.point;
  const b = v.point;
  oublierPremier();
  if (a.distanceTo(b) < 1e-4) return;
  const etiquette = cree("div", "cote", texteCote(a, b));
  calque.append(etiquette);
  const c: Cote = { a, b, trace: nouveauTrace(), etiquette };
  cotes.push(c);
  tracer(c);
  dessinerListe();
}

enregistrerOutil("mesure", "Mesure", "Mesurer", (section) => {
  liste = cree("div", "liste");
  section.append(
    note("Touchez deux points : la mesure s'accroche aux sommets et aux arêtes."),
    liste,
    bouton("btn", "Effacer les mesures", () => {
      oublierPremier();
      for (const c of [...cotes]) supprimer(c);
    }),
  );
  return {
    ouvrir: () => definirModeClic(toucher),
    fermer: () => {
      oublierPremier();
      definirModeClic(null);
    },
  };
});
