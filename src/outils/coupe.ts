// Plans de coupe. L'outil s'ouvre sur les ciseaux : le curseur devient des ciseaux et
// un clic sur une face pose tout de suite la coupe, alignée sur elle ; la poignée ✂ la
// déplace perpendiculairement à la face. Les coupes horizontale (par niveau) et
// verticale (selon X ou Y) sont rangées dans « Autres coupes ».
import { completerTir } from "../deplacements";
import { jouerBruitage } from "../sons";
import * as THREE from "three";
import { alerte, bouton, cree, el, lanceur, monde, nombre, rafraichir, versIfc } from "../noyau";
import { definirModeClic } from "../fiche";
import { changement, visibles } from "../registre";
import { solsDesNiveaux } from "../niveaux";
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

// Icône ciseaux (barre d'outils) et curseur ciseaux (clic au centre, à la croisée).
const TRAITS_CISEAUX =
  '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>';
export const ICONE_CISEAUX = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TRAITS_CISEAUX}</svg>`;
const CURSEUR_CISEAUX = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-1 -1 26 26" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#111" stroke-width="4.2">${TRAITS_CISEAUX}</g><g stroke="#fff" stroke-width="2">${TRAITS_CISEAUX}</g><circle cx="12" cy="12" r="1.6" fill="#ff8c1a" stroke="none"/></svg>`,
)}") 15 15, crosshair`;

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
poignee.title = "Glisser pour déplacer la coupe · clic droit (ou toucher) : inverser, supprimer…";
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
// Un simple toucher (sans glisser) ou un clic droit ouvre le menu de la coupe.
let glisse: { x: number; y: number; depart: number; ux: number; uy: number; ppm: number; bouge: boolean } | null = null;
poignee.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;
  const d = directionEcran();
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  fermerMenuCoupe();
  poignee.setPointerCapture(e.pointerId);
  glisse = { x: e.clientX, y: e.clientY, depart: face.decalage, ux: d.ux, uy: d.uy, ppm: d.ppm, bouge: false };
  poignee.classList.add("prise");
});
poignee.addEventListener("pointermove", (e) => {
  if (!glisse) return;
  if (!glisse.bouge && Math.hypot(e.clientX - glisse.x, e.clientY - glisse.y) < 5) return;
  glisse.bouge = true;
  const t = ((e.clientX - glisse.x) * glisse.ux + (e.clientY - glisse.y) * glisse.uy) / glisse.ppm;
  face.decalage = Math.round((glisse.depart + t) * 100) / 100;
  void appliquer();
});
const lacher = (e: PointerEvent) => {
  const toucher = glisse && !glisse.bouge && e.type === "pointerup";
  glisse = null;
  poignee.classList.remove("prise");
  majFace();
  if (toucher) ouvrirMenuCoupe();
};
poignee.addEventListener("pointerup", lacher);
poignee.addEventListener("pointercancel", lacher);
poignee.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  ouvrirMenuCoupe();
});

// --- Menu de la coupe (sur les ciseaux) ---------------------------------------------------
let menuCoupe: HTMLElement | null = null;
function fermerMenuCoupe() {
  menuCoupe?.remove();
  menuCoupe = null;
}
function ouvrirMenuCoupe() {
  fermerMenuCoupe();
  if (!face.actif) return;
  const menu = cree("div", "menu-compte menu-coupe");
  const item = (texte: string, action: () => void, classe = "") =>
    bouton("menu-compte-item" + (classe ? ` ${classe}` : ""), texte, () => {
      fermerMenuCoupe();
      action();
    });
  menu.append(
    item("⇄ Inverser le sens de coupe", inverserCoupe),
    ...(face.decalage ? [item("↺ Remettre sur la face", remettreSurFace)] : []),
    item("✂ Nouvelle coupe ailleurs", nouvelleCoupe),
    item("✕ Supprimer le plan de coupe", supprimerCoupe, "danger"),
  );
  document.body.append(menu);
  // À côté des ciseaux, sans sortir de l'écran.
  const r = poignee.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const x = Math.min(Math.max(6, r.right + 6), window.innerWidth - m.width - 6);
  const y = Math.min(Math.max(6, r.top), window.innerHeight - m.height - 6);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menuCoupe = menu;
}
document.addEventListener(
  "pointerdown",
  (e) => {
    if (menuCoupe && !menuCoupe.contains(e.target as Node) && e.target !== poignee) fermerMenuCoupe();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuCoupe) fermerMenuCoupe();
});

/** Voir de l'autre côté : on garde l'autre moitié, au même endroit. */
function inverserCoupe() {
  face.origine.copy(ancre());
  face.decalage = 0;
  face.normale.negate();
  jouerBruitage("coupe");
  void appliquer();
  majFace();
}
function remettreSurFace() {
  face.decalage = 0;
  void appliquer();
  majFace();
}
function supprimerCoupe() {
  face.actif = false;
  armerCiseaux();
  void appliquer();
  majFace();
}
/** Les ciseaux se réarment pour un seul clic : la coupe suivante remplace celle-ci. */
function nouvelleCoupe() {
  aRemplacer = true;
  armerCiseaux();
  majFace();
  alerte("Cliquez sur la face où poser la nouvelle coupe.", 2500);
}

async function choisirFace(e: PointerEvent) {
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  const position = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const hit: any = completerTir(await lanceur.castRay({ position, items: [] } as any), position);
  armerCiseaux();
  if (!hit?.point) {
    alerte("Cliquez sur une surface de la maquette.", 2500);
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
  aRemplacer = false;
  // Coupe posée : les clics suivants servent de nouveau à la maquette (sélection, etc.).
  armerCiseaux();
  jouerBruitage("coupe");
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

let outilOuvert = false;
/** « Nouvelle coupe ailleurs » demandée : le prochain clic sur une face remplace la coupe. */
let aRemplacer = false;
/** Outil Coupe ouvert et pas encore de coupe (ou nouvelle coupe demandée) : un clic sur une
 * face pose la coupe. Une fois posée, les clics ne recoupent plus. */
function armerCiseaux() {
  definirModeClic(outilOuvert && (!face.actif || aRemplacer) ? choisirFace : null, CURSEUR_CISEAUX);
}

export function retirerCoupes() {
  etat.h.actif = false;
  etat.v.actif = false;
  face.actif = false;
  aRemplacer = false;
  fermerMenuCoupe();
  armerCiseaux();
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

  // --- Sur une face (les ciseaux)
  const zoneFace = cree("div", "coupe-face");
  majFace = () => {
    zoneFace.replaceChildren();
    if (face.actif) {
      zoneFace.append(
        note(
          aRemplacer
            ? "Cliquez sur la face où poser la nouvelle coupe."
            : `Coupe posée, décalée de ${nombre(face.decalage)} m. Glissez ✂ pour la déplacer ; clic droit (ou toucher) sur ✂ pour l'inverser ou la supprimer.`,
        ),
      );
      const rang = cree("div", "puces");
      rang.append(
        bouton("puce", "Inverser le sens", inverserCoupe, "Voir de l'autre côté de la coupe"),
        bouton("puce", "Remettre sur la face", remettreSurFace),
        bouton("puce" + (aRemplacer ? " actif" : ""), "Nouvelle coupe", () => {
          if (aRemplacer) {
            aRemplacer = false;
            armerCiseaux();
            majFace();
          } else nouvelleCoupe();
        }, "Poser la coupe sur une autre face"),
        bouton("puce danger", "Supprimer", supprimerCoupe),
      );
      zoneFace.append(rang);
    } else {
      zoneFace.append(note("✂ Cliquez sur un mur, une dalle ou une face inclinée : la coupe se pose dessus."));
    }
  };
  majFace();

  const toutRetirer = bouton("btn", "Retirer toutes les coupes", () => {
    h.input.checked = false;
    v.input.checked = false;
    retirerCoupes();
  });

  // --- Autres coupes, repliées
  const autres = cree("details", "reglages");
  autres.append(
    cree("summary", "", "Autres coupes : horizontale, par niveau, verticale"),
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

  section.append(zoneFace, autres);

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
    const tries = await solsDesNiveaux(visibles());
    if (n !== calcul) return;
    niveauxNote.textContent = tries.length
      ? "Coupe à 1,20 m au-dessus du sol du niveau."
      : "Aucun niveau trouvé dans les maquettes.";
    for (const { nom, y } of tries) {
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
      outilOuvert = true;
      armerCiseaux();
      regler();
      void chargerNiveaux();
      majFace();
    },
    fermer: () => {
      outilOuvert = false;
      definirModeClic(null);
    },
  };
}, ICONE_CISEAUX);
