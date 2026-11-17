// Recherche d'éléments par nom, type, niveau ou propriété.
import { bouton, cree, nombre } from "../noyau";
import { definirCouche, definirIsolement, isolementActif, retirerCouche, STYLES } from "../apparence";
import { montrerElement } from "../fiche";
import { libelleCategorie } from "../libelles";
import { chercher, versIds, type Trouve } from "../requetes";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { interrupteur, note } from "./ui";

const PRESETS = [
  { libelle: "Porteurs", requete: "loadbearing:oui" },
  { libelle: "Extérieurs", requete: "isexternal:oui" },
  { libelle: "Coupe-feu", requete: "firerating:" },
  { libelle: "Sans niveau", requete: "niveau:sans" },
];
const MAX_AFFICHES = 150;

enregistrerOutil("recherche", "Recherche", "Rechercher des éléments", (section) => {
  let resultats: Trouve[] = [];
  let isoler = false;

  const formulaire = cree("form", "rangee");
  const champ = cree("input", "champ");
  champ.type = "search";
  champ.placeholder = "ex. poteau R+1, béton, loadbearing:oui";
  champ.setAttribute("enterkeyhint", "search");
  const go = cree("button", "btn principal", "Chercher");
  go.type = "submit";
  formulaire.append(champ, go);

  const presets = cree("div", "puces");
  for (const p of PRESETS) {
    presets.append(
      bouton("puce", p.libelle, () => {
        champ.value = p.requete;
        void lancer();
      }),
    );
  }

  const bilan = note("Plusieurs mots : tous doivent correspondre. « propriété:valeur » cherche dans les propriétés.");
  const options = cree("div", "rangee");
  const inter = interrupteur("Isoler les résultats", false, (v) => {
    isoler = v;
    void montrer();
  });
  options.append(
    inter.racine,
    bouton("lien", "Effacer", () => {
      champ.value = "";
      resultats = [];
      inter.input.checked = false;
      isoler = false;
      void montrer();
      liste.replaceChildren();
      bilan.textContent = "";
    }),
  );
  const liste = cree("div", "liste");
  section.append(formulaire, presets, options, bilan, liste);

  formulaire.addEventListener("submit", (e) => {
    e.preventDefault();
    void lancer();
  });

  async function montrer() {
    const ids = resultats.length ? versIds(resultats) : null;
    await definirCouche("recherche", STYLES.recherche, ids);
    if (isoler && ids) await definirIsolement(ids);
    else if (isolementActif() && !isoler) await definirIsolement(null);
    marquerOutil("recherche", resultats.length ? nombre(resultats.length, 0) : false);
  }

  async function lancer() {
    const texte = champ.value.trim();
    if (!texte) return;
    bilan.textContent = "Recherche…";
    resultats = await chercher({ texte }, undefined, (a) => {
      bilan.textContent = `Analyse des maquettes… ${Math.round(a * 100)} %`;
    });
    const nbMaquettes = new Set(resultats.map((r) => r.m.id)).size;
    bilan.textContent = resultats.length
      ? `${nombre(resultats.length, 0)} élément${resultats.length > 1 ? "s" : ""}` +
        (nbMaquettes > 1 ? ` dans ${nbMaquettes} maquettes` : "") +
        (resultats.length > MAX_AFFICHES ? ` (${MAX_AFFICHES} premiers listés)` : "")
      : "Aucun élément trouvé.";
    liste.replaceChildren(
      ...resultats.slice(0, MAX_AFFICHES).map((r) => {
        const rang = cree("button", "resultat");
        rang.type = "button";
        const t = cree("div", "resultat-texte");
        t.append(
          cree("strong", "", r.e.nom || libelleCategorie(r.e.cat)),
          cree("span", "petit", [libelleCategorie(r.e.cat), r.e.niveau, r.e.type].filter(Boolean).join(" · ")),
        );
        rang.append(t);
        rang.addEventListener("click", () => void montrerElement(r.m.id, r.e.id, true));
        return rang;
      }),
    );
    await montrer();
  }

  return {
    ouvrir: () => champ.focus(),
    fermer: () => {
      // Le surlignage reste visible tant que la recherche n'est pas effacée.
      if (!resultats.length) void retirerCouche("recherche");
    },
  };
});
