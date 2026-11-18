// Plans de coupe : horizontal (par niveau), vertical (selon X ou Y), et sur une face :
// on touche une surface, le plan s'aligne sur elle, puis la poignée « ciseaux » le
// déplace perpendiculairement à la face.
import * as THREE from "three";
import { alerte, bouton, cree, el, lanceur, monde, nombre, rafraichir, versIfc } from "../noyau";
import { definirModeClic } from "../fiche";
import { changement, visibles } from "../registre";
import { indexDeTout } from "../index-elements";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { curseur, interrupteur, note, puces, titreSection } from "./ui";

const planH = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const planV = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const etat = {
  h: { actif: false, y: 0 },
  v: { actif: false, axe: "x" as "x" | "y", pos: 0, inverse: false },
};

function bornes() {
  const b = new THREE.Box3();
  for (const m of visibles()) b.union(m.modele.box);
  return b;
}

// --- Coupe sur une face -----------------------------------------------------------------

const planF = new THREE.Plane();
const face = {
  actif: false,
  /** Point de la face touchée et normale tournée vers la partie gardée. */
  origine: new THREE.Vector3(),
  normale: new THREE.Vector3(0, 0, 1),
  decalage: 0,
};
let majFace: () => void = () => {};

const calque = el("etiquettes");
const poignee = cree("button", "poignee-coupe", "✂");
poignee.type = "button";
poignee.title = "Glisser pour déplacer la coupe";
poignee.hidden = true;
const valeurPoignee = cree("span", "valeur-poignee", "");
valeurPoignee.hidden = true;
const SVG = "http://www.w3.org/2000/svg";
const axePoignee = document.createElementNS(SVG, "svg");
axePoignee.classList.add("dessin-cotes");
const traitAxe = document.createElementNS(SVG, "line");
traitAxe.setAttribute("class", "axe-coupe");
axePoignee.append(traitAxe);
calque.append(axePoignee, poignee, valeurPoignee);

const ancre = () => face.origine.clone().addScaledVector(face.normale, face.decalage);

function ecran(p: THREE.Vector3) {
  const v = p.clone().project(monde.camera.three);
  if (v.z > 1 || v.z < -1) return null;
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}

/** Direction de la normale à l'écran (vecteur unitaire) et pixels par mètre. */
function directionEcran() {
  const a = ancre();
  const p0 = ecran(a);
  const p1 = ecran(a.clone().add(face.normale));
  if (!p0 || !p1) return null;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const ppm = Math.hypot(dx, dy);
  if (ppm < 1e-3) return null;
  return { p0, ux: dx / ppm, uy: dy / ppm, ppm };
}

function placerPoignee() {
  const d = face.actif ? directionEcran() : null;
  poignee.hidden = !d;
  valeurPoignee.hidden = !d;
  axePoignee.style.display = d ? "" : "none";
  if (!d) return;
  poignee.style.transform = `translate(${d.p0.x}px, ${d.p0.y}px) translate(-50%, -50%)`;
  valeurPoignee.style.transform = `translate(${d.p0.x + 20}px, ${d.p0.y - 26}px)`;
  valeurPoignee.textContent = `${face.decalage >= 0 ? "+" : ""}${nombre(face.decalage)} m`;
  const l = 70;
  traitAxe.setAttribute("x1", String(d.p0.x - d.ux * l));
  traitAxe.setAttribute("y1", String(d.p0.y - d.uy * l));
  traitAxe.setAttribute("x2", String(d.p0.x + d.ux * l));
  traitAxe.setAttribute("y2", String(d.p0.y + d.uy * l));
}
monde.renderer!.onAfterUpdate.add(placerPoignee);

// Glisser la poignée : le plan avance le long de sa normale (trajectoire perpendiculaire à la face).
let glisse: { x: number; y: number; depart: number; ux: number; uy: number; ppm: number } | null = null;
poignee.addEventListener("pointerdown", (e) => {
  const d = directionEcran();
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  poignee.setPointerCapture(e.pointerId);
  glisse = { x: e.clientX, y: e.clientY, depart: face.decalage, ux: d.ux, uy: d.uy, ppm: d.ppm };
  poignee.classList.add("prise");
});
poignee.addEventListener("pointermove", (e) => {
  if (!glisse) return;
  const t = ((e.clientX - glisse.x) * glisse.ux + (e.clientY - glisse.y) * glisse.uy) / glisse.ppm;
  face.decalage = Math.round((glisse.depart + t) * 100) / 100;
  void appliquer();
});
const lacher = () => {
  glisse = null;
  poignee.classList.remove("prise");
  majFace();
};
poignee.addEventListener("pointerup", lacher);
poignee.addEventListener("pointercancel", lacher);

async function choisirFace(e: PointerEvent) {
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  const position = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const hit: any = await lanceur.castRay({ position, items: [] } as any);
  definirModeClic(null);
  if (!hit?.point) {
    alerte("Touchez une surface de la maquette.", 2500);
    majFace();
    return;
  }
  const point = hit.point.clone() as THREE.Vector3;
  let n: THREE.Vector3 | null = hit.normal ? (hit.normal.clone() as THREE.Vector3).normalize() : null;
  if (!n || n.lengthSq() < 0.5) n = monde.camera.three.getWorldDirection(new THREE.Vector3()).negate();
  // La normale de la face regarde la caméra : on garde ce qui est derrière la face.
  const versCamera = monde.camera.three.position.clone().sub(point);
  if (n.dot(versCamera) < 0) n.negate();
  face.origine.copy(point);
  face.normale.copy(n).negate();
  face.decalage = 0;
  face.actif = true;
  await appliquer();
  majFace();
}

async function appliquer() {
  planH.constant = etat.h.y;
  if (etat.v.axe === "x") {
    planV.normal.set(etat.v.inverse ? 1 : -1, 0, 0);
    planV.constant = etat.v.inverse ? -etat.v.pos : etat.v.pos;
  } else {
    // L'axe Y de l'IFC correspond à -Z dans la scène.
    planV.normal.set(0, 0, etat.v.inverse ? -1 : 1);
    planV.constant = etat.v.inverse ? etat.v.pos : -etat.v.pos;
  }
  planF.setFromNormalAndCoplanarPoint(face.normale, ancre());
  monde.renderer!.setPlane(etat.h.actif, planH);
  monde.renderer!.setPlane(etat.v.actif, planV);
  monde.renderer!.setPlane(face.actif, planF);
  marquerOutil("coupe", etat.h.actif || etat.v.actif || face.actif);
  placerPoignee();
  await rafraichir();
}

export function retirerCoupes() {
  etat.h.actif = false;
  etat.v.actif = false;
  face.actif = false;
  void appliquer();
  majFace();
}

enregistrerOutil("coupe", "Coupe", "Plans de coupe", (section) => {
  const ifcY = (y: number) => versIfc(new THREE.Vector3(0, y, 0))[2];

  // --- Horizontale
  const h = interrupteur("Coupe horizontale", false, (v) => {
    etat.h.actif = v;
    void appliquer();
  });
  const hauteur = curseur(0, 1, 0.05, 0, (v) => {
    etat.h.y = v;
    etat.h.actif = true;
    h.input.checked = true;
    hauteur.sortie.textContent = `cote ${nombre(ifcY(v))} m`;
    void appliquer();
  });
  const niveaux = cree("div", "puces");
  const niveauxNote = note("");

  // --- Verticale
  const v = interrupteur("Coupe verticale", false, (x) => {
    etat.v.actif = x;
    void appliquer();
  });
  const position = curseur(0, 1, 0.05, 0, (x) => {
    etat.v.pos = x;
    etat.v.actif = true;
    v.input.checked = true;
    afficherPosition();
    void appliquer();
  });
  const afficherPosition = () => {
    const p =
      etat.v.axe === "x"
        ? versIfc(new THREE.Vector3(etat.v.pos, 0, 0))[0]
        : versIfc(new THREE.Vector3(0, 0, etat.v.pos))[1];
    position.sortie.textContent = `${etat.v.axe.toUpperCase()} ${nombre(p)} m`;
  };
  const axes = puces(
    [
      { valeur: "x", libelle: "Selon X" },
      { valeur: "y", libelle: "Selon Y" },
    ],
    "x",
    (axe) => {
      etat.v.axe = axe as "x" | "y";
      regler();
      etat.v.actif = true;
      v.input.checked = true;
      void appliquer();
    },
  );
  const inverser = bouton("puce", "Inverser le côté", () => {
    etat.v.inverse = !etat.v.inverse;
    void appliquer();
  });
  axes.racine.append(inverser);

  // --- Sur une face
  const zoneFace = cree("div", "coupe-face");
  majFace = () => {
    zoneFace.replaceChildren();
    if (face.actif) {
      zoneFace.append(
        note(`Coupe alignée sur la face, décalée de ${nombre(face.decalage)} m. Glissez les ciseaux ✂ pour la déplacer.`),
      );
      const rang = cree("div", "puces");
      rang.append(
        bouton("puce", "Autre face", () => {
          definirModeClic(choisirFace);
          alerte("Touchez la surface sur laquelle aligner la coupe.", 4000);
        }),
        bouton("puce", "Garder l'autre côté", () => {
          face.origine.copy(ancre());
          face.decalage = 0;
          face.normale.negate();
          void appliquer();
          majFace();
        }),
        bouton("puce", "Remettre sur la face", () => {
          face.decalage = 0;
          void appliquer();
          majFace();
        }),
        bouton("puce danger", "Retirer", () => {
          face.actif = false;
          void appliquer();
          majFace();
        }),
      );
      zoneFace.append(rang);
    } else {
      zoneFace.append(
        bouton("btn principal", "Couper sur une face", () => {
          definirModeClic(choisirFace);
          alerte("Touchez la surface sur laquelle aligner la coupe.", 4000);
        }),
        note("Touchez un mur, une dalle ou une face inclinée : la coupe s'aligne dessus."),
      );
    }
  };
  majFace();

  const toutRetirer = bouton("btn", "Retirer les coupes", () => {
    h.input.checked = false;
    v.input.checked = false;
    retirerCoupes();
  });

  section.append(
    titreSection("Sur une face"),
    zoneFace,
    h.racine,
    hauteur.racine,
    titreSection("Couper au niveau"),
    niveaux,
    niveauxNote,
    v.racine,
    axes.racine,
    position.racine,
    toutRetirer,
  );

  function regler() {
    const b = bornes();
    if (b.isEmpty()) return;
    if (!etat.h.actif) etat.h.y = b.max.y + 0.01;
    hauteur.regler(b.min.y, b.max.y + 0.01, etat.h.y);
    hauteur.sortie.textContent = `cote ${nombre(ifcY(etat.h.y))} m`;
    const [mi, ma] = etat.v.axe === "x" ? [b.min.x, b.max.x] : [b.min.z, b.max.z];
    if (!etat.v.actif || etat.v.pos < mi || etat.v.pos > ma) etat.v.pos = (mi + ma) / 2;
    position.regler(mi, ma, etat.v.pos);
    afficherPosition();
  }

  let calcul = 0;
  async function chargerNiveaux() {
    const n = ++calcul;
    niveaux.replaceChildren();
    niveauxNote.textContent = "Analyse des niveaux…";
    const liste = visibles();
    const res = await indexDeTout(liste);
    if (n !== calcul) return;
    // Hauteur du sol de chaque niveau : bas des murs et poteaux (sinon de tous ses éléments).
    const sols = new Map<string, { y: number; alt: number }>();
    for (const { m, idx } of res) {
      const parNiveau = new Map<string, number[]>();
      for (const e of idx.elements.values()) {
        if (e.niveau === "Sans niveau") continue;
        const porteur = /^IFC(WALL|COLUMN)/.test(e.cat);
        const cle = e.niveau + (porteur ? "|p" : "|a");
        if (!parNiveau.has(cle)) parNiveau.set(cle, []);
        parNiveau.get(cle)!.push(e.id);
      }
      for (const [nom, alt] of idx.niveaux) {
        if (!Number.isFinite(alt)) continue;
        const ids = (parNiveau.get(nom + "|p") ?? parNiveau.get(nom + "|a") ?? []).slice(0, 300);
        if (!ids.length) continue;
        const boites = await m.modele.getBoxes(ids);
        const bas = boites.map((b) => b.min.y).sort((a, b) => a - b);
        const y = bas[Math.floor(bas.length * 0.2)];
        const avant = sols.get(nom);
        if (!avant || y < avant.y) sols.set(nom, { y, alt });
      }
    }
    if (n !== calcul) return;
    const tries = [...sols.entries()].sort((a, b) => a[1].y - b[1].y);
    niveauxNote.textContent = tries.length
      ? "Coupe à 1,20 m au-dessus du sol du niveau."
      : "Aucun niveau trouvé dans les maquettes.";
    for (const [nom, { y }] of tries) {
      niveaux.append(
        bouton("puce", nom, () => {
          etat.h.y = y + 1.2;
          etat.h.actif = true;
          h.input.checked = true;
          regler();
          void appliquer();
        }),
      );
    }
  }

  changement.on(() => {
    if (!section.hidden) {
      regler();
      void chargerNiveaux();
    }
  });

  return {
    ouvrir: () => {
      regler();
      void chargerNiveaux();
      majFace();
    },
    fermer: () => definirModeClic(null),
  };
});
