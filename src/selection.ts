// Sélection multiple, masquage et isolement : Ctrl+clic, Maj+glisser, raccourcis
// clavier (H, Suppr, I, Maj+H, Échap), barre d'actions et outil « Sélection ».
import * as THREE from "three";
import { bouton, cree, monde } from "./noyau";
import { maquettes } from "./registre";
import {
  affichesDe,
  definirIsolement,
  definirSelection,
  isolementActif,
  masquer,
  masquesIds,
  masquesModifies,
  nombreMasques,
  nombreSelection,
  reafficher,
  selectionIds,
  selectionModifiee,
  idsDe,
  type Ids,
} from "./apparence";
import { definirSelectionMultiple, elementCourant, fermerFiche, selectionMultiple } from "./fiche";
import { demandeMenu, demandeRemarque } from "./evenements";
import { indexDeTout } from "./index-elements";
import { libelleCategorie } from "./libelles";
import { enregistrerOutil, marquerOutil } from "./outils/panneau";
import { interrupteur, note, titreSection } from "./outils/ui";

const canvas = monde.renderer!.three.domElement;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// --- Actions -----------------------------------------------------------------------

async function masquerSelection() {
  const ids = selectionIds();
  if (ids.size === 0) return;
  await fermerFiche();
  await masquer(ids);
}

async function isolerSelection() {
  if (isolementActif()) {
    await definirIsolement(null);
  } else {
    const ids = selectionIds();
    if (ids.size === 0) return;
    await definirIsolement(ids);
  }
  dessiner();
}

async function toutReafficher() {
  await definirIsolement(null);
  await reafficher();
  dessiner();
}

function remarqueSurSelection() {
  const elements: { modele: string; id: number }[] = [];
  for (const [modele, ids] of selectionIds()) for (const id of ids) elements.push({ modele, id });
  if (elements.length) demandeRemarque.emit({ titre: pluriel(elements.length, "élément"), elements });
}

// --- Barre d'actions ---------------------------------------------------------------

const barre = cree("div", "barre-selection");
barre.hidden = true;
document.body.append(barre);
let dessinerPanneau = () => {};

function dessiner() {
  const n = nombreSelection();
  const masques = nombreMasques();
  barre.replaceChildren();
  if (n >= 2 || (n === 1 && (selectionMultiple() || !elementCourant()))) {
    barre.append(
      cree("span", "compte", pluriel(n, "élément")),
      bouton("puce", "Masquer", () => void masquerSelection(), "Masquer la sélection (H ou Suppr)"),
      bouton("puce", isolementActif() ? "Tout voir" : "Isoler", () => void isolerSelection(), "Isoler la sélection (I)"),
      bouton(
        "puce",
        "Couleur",
        () => {
          const r = barre.getBoundingClientRect();
          demandeMenu.emit({ ids: selectionIds(), x: r.left, y: r.top - 190 });
        },
        "Couleur et opacité de la sélection (ou clic droit sur la maquette)",
      ),
      bouton("puce", "+ Remarque", remarqueSurSelection),
      bouton("puce", "✕", () => void definirSelection(new Map()), "Désélectionner (Échap)"),
    );
  } else if (selectionMultiple()) {
    barre.append(cree("span", "compte", "Touchez les éléments à sélectionner"));
  }
  if (masques > 0 || (isolementActif() && barre.childElementCount === 0)) {
    barre.append(
      bouton(
        "puce allume",
        masques > 0 ? `${pluriel(masques, "masqué")} · réafficher` : "Tout réafficher",
        () => void toutReafficher(),
        "Tout réafficher (Maj+H)",
      ),
    );
  }
  barre.hidden = barre.childElementCount === 0;
  document.body.classList.toggle("selection-active", !barre.hidden);
  marquerOutil("selection", masques > 0 ? String(masques) : selectionMultiple());
  dessinerPanneau();
}

selectionModifiee.on(dessiner);
masquesModifies.on(dessiner);

// --- Clavier -----------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const cible = e.target as HTMLElement | null;
  if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const touche = e.key.toLowerCase();
  if (touche === "h" && e.shiftKey) void toutReafficher();
  else if (touche === "h" || touche === "delete" || touche === "backspace") {
    if (nombreSelection() === 0) return;
    void masquerSelection();
  } else if (touche === "i") void isolerSelection();
  else if (touche === "escape" && nombreSelection() > 0) void fermerFiche();
  else return;
  e.preventDefault();
});

// --- Maj + glisser : sélection par rectangle -------------------------------------------

const cadre = cree("div", "cadre-selection");
cadre.hidden = true;
document.body.append(cadre);
let depart: { x: number; y: number } | null = null;

canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (!e.shiftKey || e.button !== 0 || e.pointerType === "touch") return;
    depart = { x: e.clientX, y: e.clientY };
    monde.camera.controls.enabled = false;
    e.stopPropagation();
  },
  true,
);

window.addEventListener("pointermove", (e) => {
  if (!depart) return;
  cadre.hidden = false;
  cadre.style.left = `${Math.min(depart.x, e.clientX)}px`;
  cadre.style.top = `${Math.min(depart.y, e.clientY)}px`;
  cadre.style.width = `${Math.abs(e.clientX - depart.x)}px`;
  cadre.style.height = `${Math.abs(e.clientY - depart.y)}px`;
});

window.addEventListener("pointerup", (e) => {
  if (!depart) return;
  const d = depart;
  depart = null;
  cadre.hidden = true;
  monde.camera.controls.enabled = true;
  if (Math.abs(e.clientX - d.x) < 6 || Math.abs(e.clientY - d.y) < 6) return;
  void selectionnerRectangle(
    Math.min(d.x, e.clientX),
    Math.min(d.y, e.clientY),
    Math.max(d.x, e.clientX),
    Math.max(d.y, e.clientY),
  );
});

/** Ajoute à la sélection les éléments affichés dont le centre tombe dans le rectangle. */
async function selectionnerRectangle(x1: number, y1: number, x2: number, y2: number) {
  const r = canvas.getBoundingClientRect();
  const camera = monde.camera.three;
  camera.updateMatrixWorld();
  const suivante = selectionIds();
  const centre = new THREE.Vector3();
  const PAQUET = 4000;
  for (const m of maquettes.values()) {
    if (!m.modele.object.visible) continue;
    const ids = await affichesDe(m);
    const pris = suivante.get(m.id) ?? new Set<number>();
    for (let i = 0; i < ids.length; i += PAQUET) {
      const lot = ids.slice(i, i + PAQUET);
      const boites = await m.modele.getBoxes(lot);
      lot.forEach((id, k) => {
        const b = boites[k];
        if (!b || b.isEmpty()) return;
        b.getCenter(centre).project(camera);
        if (centre.z < -1 || centre.z > 1) return;
        const x = r.left + ((centre.x + 1) / 2) * r.width;
        const y = r.top + ((1 - centre.y) / 2) * r.height;
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) pris.add(id);
      });
    }
    if (pris.size) suivante.set(m.id, pris);
  }
  await fermerFiche(true);
  await definirSelection(suivante);
}

// --- Outil « Sélection » -----------------------------------------------------------

enregistrerOutil("selection", "Sélection", "Sélection multiple et éléments masqués", (section) => {
  const multi = interrupteur("Sélection multiple (chaque toucher ajoute)", false, (v) => {
    definirSelectionMultiple(v);
    dessiner();
  });
  const actions = cree("div", "puces");
  const etat = note("");
  const liste = cree("div", "liste-masques");
  section.append(
    multi.racine,
    etat,
    actions,
    titreSection("Éléments masqués"),
    liste,
    note("Clavier : Ctrl+clic ajoute · Maj+glisser encadre · clic droit : couleur et opacité · H ou Suppr masque · I isole · Maj+H réaffiche tout · Échap désélectionne."),
  );

  let ouvert = false;
  let tour = 0;
  dessinerPanneau = () => {
    if (!ouvert) return;
    const n = nombreSelection();
    etat.textContent = n ? `${pluriel(n, "élément")} sélectionné${n > 1 ? "s" : ""}.` : "Aucun élément sélectionné.";
    actions.replaceChildren(
      bouton("puce", "Masquer", () => void masquerSelection()),
      bouton("puce", isolementActif() ? "Tout voir" : "Isoler", () => void isolerSelection()),
      bouton("puce", "+ Remarque", remarqueSurSelection),
      bouton("puce", "Désélectionner", () => void fermerFiche()),
      bouton("puce", "Tout réafficher", () => void toutReafficher()),
    );
    void listerMasques(++tour);
  };

  async function listerMasques(mien: number) {
    const masques: Ids = masquesIds();
    if (masques.size === 0) {
      liste.replaceChildren(note("Aucun."));
      return;
    }
    const index = await indexDeTout([...maquettes.values()].filter((m) => masques.has(m.id)));
    if (mien !== tour) return;
    const lignes: HTMLElement[] = [];
    let reste = 0;
    for (const { m, idx } of index) {
      for (const id of masques.get(m.id) ?? []) {
        if (lignes.length >= 60) {
          reste += 1;
          continue;
        }
        const e = idx.elements.get(id);
        const l = cree("div", "rang-masque");
        l.append(
          cree("span", "", e ? `${libelleCategorie(e.cat)} · ${e.nom || "sans nom"}` : `Élément ${id}`),
          bouton("lien", "Réafficher", () => void reafficher(idsDe(m.id, id))),
        );
        lignes.push(l);
      }
    }
    if (reste) lignes.push(note(`… et ${reste} autres.`));
    liste.replaceChildren(...lignes);
  }

  return {
    ouvrir: () => {
      ouvert = true;
      dessinerPanneau();
    },
    fermer: () => {
      ouvert = false;
    },
  };
});
