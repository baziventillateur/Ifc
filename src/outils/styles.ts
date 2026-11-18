// Styles d'affichage : arêtes dessinées (couleur, épaisseur) et ombrage, pour mieux
// lire les volumes quand tout est de la même teinte (gros œuvre en béton, par exemple).
import * as THREE from "three";
import * as OBF from "@thatopen/components-front";
import { bouton, cree, monde, nombre, rafraichir } from "../noyau";
import { effacerPerso, nombrePerso, persoModifiee } from "../apparence";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { curseur, interrupteur, note, titreSection } from "./ui";

const CLE = "nexbim-styles";
const reglages = { aretes: false, couleur: "#111418", epaisseur: 1, ombres: false, intensite: 0.55, lisser: false };
/** Teinte neutre vers laquelle l'intensité adoucit les arêtes (gris clair des maquettes). */
const NEUTRE = new THREE.Color("#c9ced6");
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
      post.edgesPass.color = NEUTRE.clone().lerp(new THREE.Color(reglages.couleur), reglages.intensite);
      post.edgesPass.width = reglages.epaisseur;
    }
    if (post.smaaEnabled !== reglages.lisser) post.smaaEnabled = reglages.lisser;
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

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const intensite = curseur(15, 100, 5, Math.round(reglages.intensite * 100), (v) => {
    reglages.intensite = v / 100;
    intensite.sortie.textContent = pct(reglages.intensite);
    void appliquer();
  });
  intensite.sortie.textContent = pct(reglages.intensite);

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

  const persoEtat = note("");
  const persoBouton = bouton("btn", "Tout rétablir", () => void effacerPerso());

  section.append(
    interrupteur("Dessiner les arêtes", reglages.aretes, (v) => {
      reglages.aretes = v;
      void appliquer();
    }).racine,
    rangCouleur,
    teintes,
    titreSection("Intensité"),
    intensite.racine,
    titreSection("Épaisseur"),
    epaisseur.racine,
    interrupteur("Lisser les arêtes (moins de pixels, un peu plus lent)", reglages.lisser, (v) => {
      reglages.lisser = v;
      void appliquer();
    }).racine,
    interrupteur("Ombrage des creux", reglages.ombres, (v) => {
      reglages.ombres = v;
      void appliquer();
    }).racine,
    note("Les arêtes font ressortir les volumes quand tout est de la même couleur. Sur un téléphone ancien, l'affichage peut être moins fluide."),
    titreSection("Couleurs posées à la main"),
    persoEtat,
    persoBouton,
  );
  const majPerso = () => {
    const n = nombrePerso();
    persoEtat.textContent = n
      ? `${nombre(n, 0)} élément${n > 1 ? "s" : ""} recoloré${n > 1 ? "s" : ""} (clic droit sur une sélection).`
      : "Aucune. Sélectionnez des éléments puis clic droit pour changer leur couleur ou leur opacité.";
    persoBouton.hidden = n === 0;
  };
  persoModifiee.on(majPerso);
  majPerso();
});

// Réglages retrouvés au démarrage.
if (reglages.aretes || reglages.ombres) window.setTimeout(() => void appliquer(), 1500);
