// Mode Modifier : déplacer les éléments sélectionnés (est, nord, hauteur), annuler,
// comparer avec l'original. Les maquettes d'origine ne sont jamais modifiées.
import { alerte, bouton, cadrer, cree, demanderConfirmation, directionDepuisIfc, nombre } from "../noyau";
import { boiteDe, definirSelection, nombreSelection, selectionIds, selectionModifiee } from "../apparence";
import {
  annuler,
  decalageIfc,
  definirApercu,
  definirVue,
  deplacementsModifies,
  deplacer,
  idsDeplaces,
  nombreDeplaces,
  peutAnnuler,
  peutRetablir,
  remettre,
  retablir,
  vueModifiee,
} from "../deplacements";
import { enregistrementModifie, enregistrementModifs } from "../nuage/projets";
import { enregistrerOutil, marquerOutil, outilActif } from "./panneau";
import { note, titreSection } from "./ui";

const AXES = [
  { cle: "x", libelle: "X · est", titre: "Vers l'est (négatif : vers l'ouest)" },
  { cle: "y", libelle: "Y · nord", titre: "Vers le nord (négatif : vers le sud)" },
  { cle: "z", libelle: "Hauteur", titre: "Vers le haut (négatif : vers le bas)" },
] as const;
const PAS = [1, 5, 10, 50, 100];
const CLE_PAS = "nexbim-modifier-pas";

enregistrerOutil("modifier", "Modifier", "Déplacer des éléments", (section) => {
  let pas = Number(localStorage.getItem(CLE_PAS)) || 10;
  if (!PAS.includes(pas)) pas = 10;
  let ouvert = false;

  // --- Original / Modifié
  const segments = cree("div", "segments");
  const segOriginal = bouton("segment", "Original", () => void definirVue(false), "Voir la maquette d'origine");
  const segModifie = bouton("segment", "Modifié", () => void definirVue(true), "Voir la maquette avec les déplacements");
  segments.append(segOriginal, segModifie);

  // --- Saisie du déplacement
  const titre = titreSection("Déplacer la sélection");
  const etatSelection = note("");
  const grille = cree("div", "deplacer-grille");
  const champs = new Map<string, HTMLInputElement>();
  const lire = () => {
    const v = (cle: string) => {
      const n = Number((champs.get(cle)!.value || "0").replace(",", "."));
      return Number.isFinite(n) ? n / 100 : 0;
    };
    return directionDepuisIfc(v("x"), v("y"), v("z"));
  };
  const saisieVide = () => lire().length() < 0.0005;
  const apercevoir = () => {
    const v = lire();
    const ids = selectionIds();
    if (!vueModifiee() && v.length() >= 0.0005) void definirVue(true);
    void definirApercu(ids.size && v.length() >= 0.0005 ? ids : null, v);
    majBoutons();
  };
  for (const a of AXES) {
    const champ = cree("input", "champ nombre");
    champ.type = "text";
    champ.inputMode = "decimal";
    champ.placeholder = "0";
    champ.title = a.titre;
    champ.setAttribute("aria-label", `${a.libelle}, en centimètres`);
    champ.addEventListener("input", apercevoir);
    champ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void valider();
    });
    champs.set(a.cle, champ);
    const pousser = (signe: number) => {
      const actuel = Number((champ.value || "0").replace(",", ".")) || 0;
      const suivant = Math.round((actuel + signe * pas) * 10) / 10;
      champ.value = suivant === 0 ? "" : String(suivant).replace(".", ",");
      apercevoir();
    };
    grille.append(
      cree("span", "deplacer-axe", a.libelle),
      bouton("puce pas", "−", () => pousser(-1), `Reculer de ${pas} cm`),
      champ,
      cree("span", "petit", "cm"),
      bouton("puce pas", "+", () => pousser(1), `Avancer de ${pas} cm`),
    );
  }

  const rangeePas = cree("div", "rangee");
  rangeePas.append(cree("span", "petit", "Pas"));
  const pucesPas = cree("div", "puces");
  const boutonsPas = PAS.map((p) => {
    const b = bouton("puce", p >= 100 ? `${p / 100} m` : `${p} cm`, () => {
      pas = p;
      try {
        localStorage.setItem(CLE_PAS, String(p));
      } catch {
        // Gardé pour la session seulement.
      }
      majBoutons();
    });
    pucesPas.append(b);
    return { p, b };
  });
  rangeePas.append(pucesPas);

  const actions = cree("div", "rangee");
  const btnValider = bouton("btn principal", "Déplacer", () => void valider(), "Valider le déplacement (Entrée)");
  const btnEffacer = bouton("btn", "Effacer", () => vider(), "Abandonner la saisie");
  actions.append(btnValider, btnEffacer);
  const dejaLa = note("");

  // --- Historique et remise en place
  const historique = cree("div", "rangee");
  const btnAnnuler = bouton("btn", "↶ Annuler", () => void faire(annuler), "Annuler le dernier déplacement");
  const btnRetablir = bouton("btn", "↷ Rétablir", () => void faire(retablir), "Refaire le déplacement annulé");
  historique.append(btnAnnuler, btnRetablir);

  const titreListe = titreSection("Éléments déplacés");
  const bilan = note("");
  const actionsListe = cree("div", "puces");
  const btnVoir = bouton("puce", "Les sélectionner", () => void voirDeplaces());
  const btnRemettreSel = bouton("puce", "Remettre la sélection", () => void faire(() => remettre(selectionIds())));
  const btnRemettreTout = bouton("puce danger", "Tout remettre en place", () => void toutRemettre());
  actionsListe.append(btnVoir, btnRemettreSel, btnRemettreTout);
  const etatEnregistrement = note("");

  section.append(
    segments,
    titre,
    etatSelection,
    grille,
    rangeePas,
    actions,
    dejaLa,
    historique,
    titreListe,
    bilan,
    actionsListe,
    etatEnregistrement,
  );

  function vider(apercu = true) {
    for (const c of champs.values()) c.value = "";
    if (apercu) void definirApercu(null);
    majBoutons();
  }

  async function faire(action: () => Promise<unknown>) {
    vider();
    try {
      await action();
    } catch (e) {
      alerte(e instanceof Error ? e.message : "Action impossible.");
    }
  }

  async function valider() {
    const v = lire();
    const ids = selectionIds();
    if (!ids.size || v.length() < 0.0005) return;
    btnValider.disabled = true;
    try {
      await deplacer(ids, v);
      vider(false);
    } catch (e) {
      alerte(e instanceof Error ? e.message : "Déplacement impossible.");
      vider();
    }
    majBoutons();
  }

  async function voirDeplaces() {
    const ids = idsDeplaces();
    if (!ids.size) return;
    vider();
    await definirSelection(ids);
    await cadrer(await boiteDe(ids), 1.4);
  }

  async function toutRemettre() {
    const n = nombreDeplaces();
    if (!n) return;
    const ok = await demanderConfirmation(
      "Tout remettre en place ?",
      `${n} élément${n > 1 ? "s" : ""} retrouvera sa place d'origine. Vous pourrez annuler juste après.`,
      "Tout remettre",
      true,
    );
    if (ok) await faire(() => remettre());
  }

  const cm = (m: number) => {
    const v = Math.round(m * 1000) / 10 || 0;
    return `${v > 0 ? "+" : ""}${nombre(v, 1)}`;
  };

  function majBoutons() {
    const n = nombreSelection();
    const deplaces = nombreDeplaces();
    const vide = saisieVide();
    segOriginal.classList.toggle("actif", !vueModifiee());
    segModifie.classList.toggle("actif", vueModifiee());
    segments.hidden = deplaces === 0;
    etatSelection.textContent = n
      ? `${n} élément${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""}. Saisissez le décalage : il s'affiche avant d'être validé.`
      : "Touchez un élément (ou plusieurs, avec l'outil Sélection), puis saisissez son décalage.";
    grille.classList.toggle("eteint", n === 0);
    for (const c of champs.values()) c.disabled = n === 0;
    btnValider.disabled = n === 0 || vide;
    btnEffacer.disabled = vide;
    for (const { p, b } of boutonsPas) b.classList.toggle("allume", p === pas);
    btnAnnuler.disabled = !peutAnnuler();
    btnRetablir.disabled = !peutRetablir();

    // Déplacement déjà enregistré de la sélection.
    const ids = selectionIds();
    const deja: string[] = [];
    let deplacesChoisis = 0;
    for (const [mid, liste] of ids) for (const id of liste) {
      const d = decalageIfc(mid, id);
      if (!d) continue;
      deplacesChoisis += 1;
      if (deja.length < 1) deja.push(`X ${cm(d[0])} · Y ${cm(d[1])} · hauteur ${cm(d[2])} cm`);
    }
    dejaLa.hidden = deplacesChoisis === 0;
    dejaLa.textContent =
      deplacesChoisis === 1 && n === 1
        ? `Déjà déplacé de ${deja[0]}.`
        : `${deplacesChoisis} élément${deplacesChoisis > 1 ? "s" : ""} de la sélection déjà déplacé${deplacesChoisis > 1 ? "s" : ""}.`;

    titreListe.hidden = bilan.hidden = actionsListe.hidden = deplaces === 0 && !peutAnnuler() && !peutRetablir();
    bilan.textContent = deplaces
      ? `${deplaces} élément${deplaces > 1 ? "s" : ""} déplacé${deplaces > 1 ? "s" : ""}. Les maquettes d'origine ne sont pas modifiées.`
      : "Aucun élément déplacé.";
    btnVoir.hidden = btnRemettreTout.hidden = deplaces === 0;
    btnRemettreSel.hidden = deplacesChoisis === 0;

    const e = enregistrementModifs();
    etatEnregistrement.textContent =
      e.mode === "projet"
        ? e.etat === "erreur"
          ? "Enregistrement impossible pour l'instant : vérifiez la connexion."
          : "Enregistré automatiquement dans le projet : vos invités voient les déplacements."
        : e.mode === "invite"
          ? "Vous êtes invité : vos déplacements servent à étudier, seul le créateur du projet les enregistre."
          : "Maquette d'essai : les déplacements ne sont pas enregistrés.";
    marquerOutil("modifier", deplaces > 0 ? String(deplaces) : false);
  }

  selectionModifiee.on(() => {
    // La saisie en cours valait pour l'ancienne sélection.
    if (ouvert && !saisieVide()) vider();
    else majBoutons();
  });
  deplacementsModifies.on(majBoutons);
  enregistrementModifie.on(majBoutons);
  majBoutons();

  return {
    ouvrir: () => {
      ouvert = true;
      majBoutons();
    },
    fermer: () => {
      ouvert = false;
      vider();
    },
  };
});

// Ctrl+Z / Ctrl+Y quand l'outil est ouvert.
window.addEventListener("keydown", (e) => {
  if (outilActif() !== "modifier" || !(e.ctrlKey || e.metaKey)) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  const touche = e.key.toLowerCase();
  if (touche === "z" && !e.shiftKey) {
    e.preventDefault();
    void annuler();
  } else if (touche === "y" || (touche === "z" && e.shiftKey)) {
    e.preventDefault();
    void retablir();
  }
});
