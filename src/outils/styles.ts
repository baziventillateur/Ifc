// Styles d'affichage : arêtes dessinées (couleur, épaisseur) et ombrage, pour mieux
// lire les volumes quand tout est de la même teinte (gros œuvre en béton, par exemple).
import * as THREE from "three";
import * as OBF from "@thatopen/components-front";
import { cree, monde, rafraichir } from "../noyau";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { curseur, interrupteur, note, titreSection } from "./ui";

const CLE = "nexbim-styles";
const reglages = { aretes: false, couleur: "#111418", epaisseur: 1, ombres: false };
try {
  Object.assign(reglages, JSON.parse(localStorage.getItem(CLE) || "{}"));
} catch {
  // Mémoire locale indisponible : réglages par défaut.
}

async function appliquer() {
  try {
    localStorage.setItem(CLE, JSON.stringify(reglages));
  } catch {
    // Réglages gardés pour la session seulement.
  }
  const post = monde.renderer!.postproduction;
  const actif = reglages.aretes || reglages.ombres;
  if (actif) {
    post.enabled = true;
    post.style = reglages.aretes
      ? reglages.ombres
        ? OBF.PostproductionAspect.COLOR_PEN_SHADOWS
        : OBF.PostproductionAspect.COLOR_PEN
      : OBF.PostproductionAspect.COLOR_SHADOWS;
    if (reglages.aretes) {
      post.edgesPass.color = new THREE.Color(reglages.couleur);
      post.edgesPass.width = reglages.epaisseur;
    }
  } else if (post.enabled) {
    post.enabled = false;
  }
  marquerOutil("styles", actif);
  await rafraichir();
}

enregistrerOutil("styles", "Styles", "Styles d'affichage", (section) => {
  const couleur = cree("input", "choix-teinte");
  couleur.type = "color";
  couleur.value = reglages.couleur;
  couleur.addEventListener("input", () => {
    reglages.couleur = couleur.value;
    void appliquer();
  });
  const rangCouleur = cree("label", "rangee");
  rangCouleur.append(cree("span", "", "Couleur des arêtes"), couleur);

  const epaisseur = curseur(1, 4, 1, reglages.epaisseur, (v) => {
    reglages.epaisseur = v;
    epaisseur.sortie.textContent = `${v} px`;
    void appliquer();
  });
  epaisseur.sortie.textContent = `${reglages.epaisseur} px`;

  const teintes = cree("div", "puces");
  for (const [nom, hex] of [
    ["Noir", "#111418"],
    ["Blanc", "#ffffff"],
    ["Orange", "#ff8a1f"],
    ["Bleu", "#3b82f6"],
    ["Rouge", "#ef4444"],
  ]) {
    const b = cree("button", "puce", nom);
    b.type = "button";
    b.addEventListener("click", () => {
      reglages.couleur = hex;
      couleur.value = hex;
      void appliquer();
    });
    teintes.append(b);
  }

  section.append(
    interrupteur("Dessiner les arêtes", reglages.aretes, (v) => {
      reglages.aretes = v;
      void appliquer();
    }).racine,
    rangCouleur,
    teintes,
    titreSection("Épaisseur"),
    epaisseur.racine,
    interrupteur("Ombrage des creux", reglages.ombres, (v) => {
      reglages.ombres = v;
      void appliquer();
    }).racine,
    note("Les arêtes font ressortir les volumes quand tout est de la même couleur. Sur un téléphone ancien, l'affichage peut être moins fluide."),
  );
});

// Réglages retrouvés au démarrage.
if (reglages.aretes || reglages.ombres) window.setTimeout(() => void appliquer(), 1500);
