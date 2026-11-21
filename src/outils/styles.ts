// Styles d'affichage : arêtes dessinées (couleur, épaisseur) et ombrage, pour mieux
// lire les volumes quand tout est de la même teinte (gros œuvre en béton, par exemple).
import * as THREE from "three";
import * as OBF from "@thatopen/components-front";
import { bouton, cree, definirProjection, estOrtho, nombre, projectionModifiee, rafraichir, reglerPost, reglerProche } from "../noyau";
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

  // --- Projection (même réglage que le bouton Ortho de la barre du haut)
  const vue = cree("div", "segments");
  const segPersp = bouton("segment", "Perspective", () => void definirProjection("Perspective"));
  const segOrtho = bouton("segment", "Orthogonale", () => void definirProjection("Orthographic"), "Sans perspective (touche O)");
  vue.append(segPersp, segOrtho);
  const majVue = () => {
    segPersp.classList.toggle("actif", !estOrtho());
    segOrtho.classList.toggle("actif", estOrtho());
  };
  projectionModifiee.on(majVue);
  majVue();

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

  // --- Voir à travers les objets proches
  // Par défaut : jusqu'à 0,5 m, transparence 45 % ; « Réinitialiser » y revient.
  const PROCHE_DEFAUT = { distance: 0.5, force: 0.45 };
  const CLE_PROCHE = "nexbim-proche-2";
  const procheR = { actif: false, ...PROCHE_DEFAUT };
  try {
    const lu = JSON.parse(localStorage.getItem(CLE_PROCHE) || "null");
    if (lu) {
      if (typeof lu.actif === "boolean") procheR.actif = lu.actif;
      if (lu.distance > 0) procheR.distance = Math.min(30, Math.max(0.5, Number(lu.distance)));
      if (lu.force > 0) procheR.force = Math.min(0.9, Math.max(0.1, Number(lu.force)));
    } else {
      // Ancien réglage : on garde seulement l'interrupteur, les valeurs passent aux nouvelles valeurs par défaut.
      const ancien = JSON.parse(localStorage.getItem("nexbim-proche") || "{}");
      if (typeof ancien.actif === "boolean") procheR.actif = ancien.actif;
    }
  } catch {
    // Réglages par défaut.
  }
  const blocProche = cree("div", "styles-perso");
  const valeurDistance = cree("span", "valeur-reglage");
  const valeurForce = cree("span", "valeur-reglage");
  const majProcheUi = () => {
    valeurDistance.textContent = `${nombre(procheR.distance, 1)} m`;
    valeurForce.textContent = `${Math.round(procheR.force * 100)} %`;
    reglagesProche.hidden = !procheR.actif;
    reinitProche.hidden = procheR.distance === PROCHE_DEFAUT.distance && procheR.force === PROCHE_DEFAUT.force;
    try {
      localStorage.setItem(CLE_PROCHE, JSON.stringify(procheR));
    } catch {
      // Gardé pour la session seulement.
    }
    reglerProche(procheR);
  };
  const pasDistance = (sens: number) => {
    const pas = procheR.distance + (sens < 0 ? -0.01 : 0) < 2 ? 0.5 : procheR.distance + (sens < 0 ? -0.01 : 0) < 10 ? 1 : 5;
    procheR.distance = Math.min(30, Math.max(0.5, Math.round((procheR.distance + sens * pas) * 2) / 2));
    majProcheUi();
  };
  const pasForce = (sens: number) => {
    procheR.force = Math.min(0.9, Math.max(0.1, Math.round((procheR.force + sens * 0.05) * 100) / 100));
    majProcheUi();
  };
  const ligne = (libelle: string, valeur: HTMLElement, moins: () => void, plus: () => void) => {
    const l = cree("div", "rangee reglage-pas");
    l.append(cree("span", "petit", libelle), bouton("puce pas", "−", moins), valeur, bouton("puce pas", "+", plus));
    return l;
  };
  const reglagesProche = cree("div", "styles-proche");
  const reinitProche = bouton("lien", "Réinitialiser (0,5 m · 45 %)", () => {
    Object.assign(procheR, PROCHE_DEFAUT);
    majProcheUi();
  });
  reglagesProche.append(
    ligne("Jusqu'à", valeurDistance, () => pasDistance(-1), () => pasDistance(1)),
    ligne("Transparence", valeurForce, () => pasForce(-1), () => pasForce(1)),
    reinitProche,
  );
  blocProche.append(
    interrupteur("Voir à travers les objets proches", procheR.actif, (v) => {
      procheR.actif = v;
      majProcheUi();
    }).racine,
    reglagesProche,
  );
  majProcheUi();

  const persoEtat = note("");
  const persoBouton = bouton("btn", "Tout rétablir", () => void effacerPerso());

  section.append(
    choix,
    legende,
    perso,
    titreSection("Vue"),
    vue,
    blocProche,
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
