// Styles d'affichage : arêtes dessinées (couleur, épaisseur) et ombrage, pour mieux
// lire les volumes quand tout est de la même teinte (gros œuvre en béton, par exemple).
import * as THREE from "three";
import * as OBF from "@thatopen/components-front";
import { bouton, cree, nombre, rafraichir, reglerPost } from "../noyau";
import { effacerPerso, nombrePerso, persoModifiee } from "../apparence";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { interrupteur, note, titreSection } from "./ui";

const CLE = "nexbim-styles";
const NOIR = "#111418";
type Mode = "rapide" | "aretes" | "detaille" | "perso";
type Rendu = { aretes: boolean; epaisseur: number; ombres: boolean; lisser: boolean };
const MODELES: Record<Exclude<Mode, "perso">, Rendu> = {
  rapide: { aretes: false, epaisseur: 1, ombres: false, lisser: false },
  aretes: { aretes: true, epaisseur: 1, ombres: false, lisser: false },
  detaille: { aretes: true, epaisseur: 1, ombres: true, lisser: true },
};
const EPAISSEURS = [0.5, 1, 1.5, 2];
/** mode : le style choisi ; perso : les réglages du style personnalisé. */
const etat: { mode: Mode; perso: Rendu } = { mode: "rapide", perso: { ...MODELES.aretes } };
try {
  const lus = JSON.parse(localStorage.getItem(CLE) || "{}");
  if (lus.mode) {
    if (lus.mode in MODELES || lus.mode === "perso") etat.mode = lus.mode;
    Object.assign(etat.perso, lus.perso);
  } else if (lus.aretes || lus.ombres) {
    // Anciens réglages : gardés comme style personnalisé.
    etat.mode = "perso";
    etat.perso = { aretes: !!lus.aretes, epaisseur: Number(lus.epaisseur) || 1, ombres: !!lus.ombres, lisser: !!lus.lisser };
  }
  if (!EPAISSEURS.includes(etat.perso.epaisseur)) etat.perso.epaisseur = Math.min(2, Math.max(0.5, etat.perso.epaisseur));
} catch {
  // Mémoire locale indisponible : style rapide.
}
const rendu = (): Rendu => (etat.mode === "perso" ? etat.perso : MODELES[etat.mode]);

async function appliquer() {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    // Réglages gardés pour la session seulement.
  }
  const reglages = rendu();
  const actif = reglages.aretes || reglages.ombres;
  const aspect = !actif
    ? null
    : reglages.aretes
      ? reglages.ombres
        ? OBF.PostproductionAspect.COLOR_PEN_SHADOWS
        : OBF.PostproductionAspect.COLOR_PEN
      : OBF.PostproductionAspect.COLOR_SHADOWS;
  const post = reglerPost("styles", actif, aspect);
  if (actif) {
    if (reglages.aretes) {
      post.edgesPass.color = new THREE.Color(NOIR);
      post.edgesPass.width = reglages.epaisseur;
    }
    if (post.smaaEnabled !== reglages.lisser) post.smaaEnabled = reglages.lisser;
  }
  marquerOutil("styles", actif);
  await rafraichir();
}

const SVG_CUBE = (aretes: boolean, ombres: boolean) => `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
<path d="M16 4 27 10 16 16 5 10Z" fill="#dfe3e8"/>
<path d="M5 10 16 16V28L5 22Z" fill="${ombres ? "#8e97a3" : "#c3c9d1"}"/>
<path d="M27 10 16 16V28L27 22Z" fill="${ombres ? "#5d6672" : "#aab1bb"}"/>
${aretes ? '<path d="M16 4 27 10V22L16 28 5 22V10ZM5 10 16 16 27 10M16 16V28" fill="none" stroke="#0b0d10" stroke-width="1.6" stroke-linejoin="round"/>' : ""}</svg>`;
const SVG_REGLAGES = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
<path d="M6 10h20M6 16h20M6 22h20"/><circle cx="12" cy="10" r="2.6" fill="#161b22"/><circle cx="21" cy="16" r="2.6" fill="#161b22"/><circle cx="10" cy="22" r="2.6" fill="#161b22"/></svg>`;

enregistrerOutil("styles", "Styles", "Styles d'affichage", (section) => {
  // --- Les styles tout faits
  const choix = cree("div", "styles-choix");
  const CHOIX: { mode: Mode; nom: string; titre: string; svg: string }[] = [
    { mode: "rapide", nom: "Rapide", titre: "Sans arêtes : le plus fluide, sur tous les téléphones", svg: SVG_CUBE(false, false) },
    { mode: "aretes", nom: "Arêtes", titre: "Arêtes noires fines (1 px)", svg: SVG_CUBE(true, false) },
    { mode: "detaille", nom: "Détaillé", titre: "Arêtes lissées et ombrage des creux : le plus beau, un peu plus lent", svg: SVG_CUBE(true, true) },
    { mode: "perso", nom: "Perso", titre: "Vos propres réglages", svg: SVG_REGLAGES },
  ];
  const tuiles = CHOIX.map((c) => {
    const b = bouton("style-tuile", "", () => {
      etat.mode = c.mode;
      maj();
      void appliquer();
    }, c.titre);
    b.innerHTML = c.svg;
    b.append(cree("span", "", c.nom));
    choix.append(b);
    return { mode: c.mode, b };
  });
  const legende = note("");

  // --- Réglages du style personnalisé
  const perso = cree("div", "styles-perso");
  const aretes = interrupteur("Dessiner les arêtes (noires)", etat.perso.aretes, (v) => {
    etat.perso.aretes = v;
    maj();
    void appliquer();
  });
  const rangEpaisseur = cree("div", "rangee");
  const pucesEpaisseur = cree("div", "puces");
  const boutonsEpaisseur = EPAISSEURS.map((e) => {
    const b = bouton("puce", `${String(e).replace(".", ",")} px`, () => {
      etat.perso.epaisseur = e;
      etat.perso.aretes = true;
      aretes.input.checked = true;
      maj();
      void appliquer();
    });
    pucesEpaisseur.append(b);
    return { e, b };
  });
  rangEpaisseur.append(cree("span", "petit", "Épaisseur"), pucesEpaisseur);
  perso.append(
    aretes.racine,
    rangEpaisseur,
    interrupteur("Lisser les arêtes (un peu plus lent)", etat.perso.lisser, (v) => {
      etat.perso.lisser = v;
      void appliquer();
    }).racine,
    interrupteur("Ombrage des creux", etat.perso.ombres, (v) => {
      etat.perso.ombres = v;
      void appliquer();
    }).racine,
  );

  const LEGENDES: Record<Mode, string> = {
    rapide: "Rapide : sans arêtes, le plus fluide sur tous les téléphones.",
    aretes: "Arêtes : traits noirs de 1 px, pour mieux lire les volumes.",
    detaille: "Détaillé : arêtes lissées et ombrage des creux. Un peu plus lent sur un téléphone ancien.",
    perso: "Personnalisé : réglez les arêtes et l'ombrage vous-même.",
  };
  const maj = () => {
    for (const t of tuiles) t.b.classList.toggle("actif", t.mode === etat.mode);
    legende.textContent = LEGENDES[etat.mode];
    perso.hidden = etat.mode !== "perso";
    for (const { e, b } of boutonsEpaisseur) b.classList.toggle("allume", etat.perso.aretes && e === etat.perso.epaisseur);
  };
  maj();

  const persoEtat = note("");
  const persoBouton = bouton("btn", "Tout rétablir", () => void effacerPerso());

  section.append(
    choix,
    legende,
    perso,
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
if (rendu().aretes || rendu().ombres) window.setTimeout(() => void appliquer(), 1500);
