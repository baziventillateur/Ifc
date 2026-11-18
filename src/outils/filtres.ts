// Filtres par niveau et par type d'élément, toutes maquettes confondues.
import { bouton, cree, nombre } from "../noyau";
import { changement, maquettes } from "../registre";
import { indexDeTout, SANS_NIVEAU } from "../index-elements";
import {
  definirFiltre,
  definirSelection,
  filtreActif,
  selectionIds,
  selectionModifiee,
  type Ids,
} from "../apparence";
import { fermerFiche } from "../fiche";
import { libelleCategorie } from "../libelles";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { note, titreSection } from "./ui";

const masquesNiveaux = new Set<string>();
const masquesTypes = new Set<string>();

async function appliquer() {
  const res = await indexDeTout([...maquettes.values()]);
  const masques: Ids = new Map();
  for (const { m, idx } of res) {
    const s = new Set<number>();
    for (const e of idx.elements.values()) {
      if (masquesNiveaux.has(e.niveau) || masquesTypes.has(libelleCategorie(e.cat))) s.add(e.id);
    }
    if (s.size) masques.set(m.id, s);
  }
  await definirFiltre(masques);
  marquerOutil("filtres", filtreActif());
}

enregistrerOutil("filtres", "Filtres", "Filtrer par niveau et par type", (section) => {
  const etat = note("");
  const listeNiveaux = cree("div", "cases");
  const listeTypes = cree("div", "cases");
  let attenteAppli: number | undefined;
  const planifier = () => {
    window.clearTimeout(attenteAppli);
    attenteAppli = window.setTimeout(() => void appliquer(), 120);
  };

  const entete = (titre: string, masques: Set<string>, toutes: () => string[]) => {
    const r = cree("div", "rangee-titre");
    r.append(
      titreSection(titre),
      bouton("lien", "Tout", () => {
        masques.clear();
        void dessiner();
        planifier();
      }),
      bouton("lien", "Aucun", () => {
        for (const x of toutes()) masques.add(x);
        void dessiner();
        planifier();
      }),
    );
    return r;
  };

  let niveauxConnus: string[] = [];
  let typesConnus: string[] = [];
  section.append(
    etat,
    entete("Niveaux", masquesNiveaux, () => niveauxConnus),
    listeNiveaux,
    entete("Types d'éléments", masquesTypes, () => typesConnus),
    listeTypes,
    bouton("btn", "Réinitialiser les filtres", () => {
      masquesNiveaux.clear();
      masquesTypes.clear();
      void dessiner();
      planifier();
    }),
  );

  // Éléments de chaque ligne, pour les sélectionner d'un clic sur le nom.
  const idsNiveaux = new Map<string, Ids>();
  const idsTypes = new Map<string, Ids>();
  const noter = (carte: Map<string, Ids>, cle: string, mid: string, id: number) => {
    let ids = carte.get(cle);
    if (!ids) carte.set(cle, (ids = new Map()));
    let s = ids.get(mid);
    if (!s) ids.set(mid, (s = new Set()));
    s.add(id);
  };

  const effacerChoix = () => {
    for (const x of section.querySelectorAll(".case.choisie")) x.classList.remove("choisie");
  };
  // Une sélection faite ailleurs efface le repère des lignes choisies.
  let interne = false;
  selectionModifiee.on(() => {
    if (!interne) effacerChoix();
  });

  async function choisir(ligne: HTMLElement, ids: Ids | undefined, ajouter: boolean) {
    if (!ids) return;
    const suivante: Ids = ajouter ? selectionIds() : new Map();
    for (const [mid, liste] of ids) {
      const s = suivante.get(mid) ?? new Set<number>();
      for (const id of liste) s.add(id);
      suivante.set(mid, s);
    }
    interne = true;
    try {
      await fermerFiche(true);
      await definirSelection(suivante);
    } finally {
      interne = false;
    }
    if (!ajouter) effacerChoix();
    ligne.classList.add("choisie");
  }

  const caseA = (libelle: string, compte: number, masques: Set<string>, carte: Map<string, Ids>) => {
    const l = cree("div", "case");
    const i = cree("input");
    i.type = "checkbox";
    i.checked = !masques.has(libelle);
    i.title = "Afficher / masquer";
    i.addEventListener("change", () => {
      if (i.checked) masques.delete(libelle);
      else masques.add(libelle);
      planifier();
    });
    const nom = cree("span", "case-nom");
    nom.title = "Sélectionner ces éléments (Ctrl : ajouter) · double-clic : n'afficher qu'eux";
    nom.append(cree("span", "case-texte", libelle), cree("span", "compte", nombre(compte, 0)));
    nom.addEventListener("click", (e) => void choisir(l, carte.get(libelle), e.ctrlKey || e.metaKey || e.shiftKey));
    // Double-clic sur le nom : n'afficher que celui-ci.
    nom.addEventListener("dblclick", (e) => {
      e.preventDefault();
      for (const x of masques === masquesNiveaux ? niveauxConnus : typesConnus) masques.add(x);
      masques.delete(libelle);
      void definirSelection(new Map());
      void dessiner();
      planifier();
    });
    l.append(i, nom);
    return l;
  };

  let n = 0;
  async function dessiner() {
    const tour = ++n;
    etat.textContent = "Analyse des maquettes…";
    const res = await indexDeTout([...maquettes.values()], (a) => {
      if (tour === n) etat.textContent = `Analyse des maquettes… ${Math.round(a * 100)} %`;
    });
    if (tour !== n) return;
    const niveaux = new Map<string, { alt: number; n: number }>();
    const types = new Map<string, number>();
    idsNiveaux.clear();
    idsTypes.clear();
    for (const { m, idx } of res) {
      for (const e of idx.elements.values()) {
        noter(idsNiveaux, e.niveau, m.id, e.id);
        noter(idsTypes, libelleCategorie(e.cat), m.id, e.id);
        const alt = idx.niveaux.get(e.niveau) ?? Number.POSITIVE_INFINITY;
        const nv = niveaux.get(e.niveau) ?? { alt, n: 0 };
        nv.n += 1;
        nv.alt = Math.min(nv.alt, alt);
        niveaux.set(e.niveau, nv);
        const t = libelleCategorie(e.cat);
        types.set(t, (types.get(t) ?? 0) + 1);
      }
    }
    niveauxConnus = [...niveaux.entries()]
      .sort((a, b) => a[1].alt - b[1].alt || a[0].localeCompare(b[0], "fr"))
      .map(([k]) => k);
    typesConnus = [...types.keys()].sort((a, b) => a.localeCompare(b, "fr"));
    listeNiveaux.replaceChildren(...niveauxConnus.map((k) => caseA(k, niveaux.get(k)!.n, masquesNiveaux, idsNiveaux)));
    listeTypes.replaceChildren(...typesConnus.map((k) => caseA(k, types.get(k)!, masquesTypes, idsTypes)));
    etat.textContent = res.length
      ? "La case masque ou affiche. Touchez un nom pour sélectionner ses éléments, puis clic droit pour les colorer. Double-touchez pour n'afficher que lui."
      : "Aucune maquette chargée.";
    if (niveauxConnus.length === 1 && niveauxConnus[0] === SANS_NIVEAU) {
      etat.textContent += " Ces maquettes ne déclarent pas de niveaux.";
    }
  }

  changement.on(() => {
    if (!section.hidden) void dessiner();
    if (masquesNiveaux.size || masquesTypes.size) void appliquer();
  });

  return { ouvrir: () => void dessiner() };
});
