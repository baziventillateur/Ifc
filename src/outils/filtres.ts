// Filtres par niveau et par type d'élément, toutes maquettes confondues.
import { bouton, cree, nombre } from "../noyau";
import { changement, maquettes } from "../registre";
import { indexDeTout, SANS_NIVEAU } from "../index-elements";
import { definirFiltre, filtreActif, type Ids } from "../apparence";
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

  const caseA = (libelle: string, compte: number, masques: Set<string>) => {
    const l = cree("label", "case");
    const i = cree("input");
    i.type = "checkbox";
    i.checked = !masques.has(libelle);
    i.addEventListener("change", () => {
      if (i.checked) masques.delete(libelle);
      else masques.add(libelle);
      planifier();
    });
    l.append(i, cree("span", "case-texte", libelle), cree("span", "compte", nombre(compte, 0)));
    // Toucher longuement le nom : n'afficher que celui-ci.
    l.addEventListener("dblclick", (e) => {
      e.preventDefault();
      for (const x of masques === masquesNiveaux ? niveauxConnus : typesConnus) masques.add(x);
      masques.delete(libelle);
      void dessiner();
      planifier();
    });
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
    for (const { idx } of res) {
      for (const e of idx.elements.values()) {
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
    listeNiveaux.replaceChildren(...niveauxConnus.map((k) => caseA(k, niveaux.get(k)!.n, masquesNiveaux)));
    listeTypes.replaceChildren(...typesConnus.map((k) => caseA(k, types.get(k)!, masquesTypes)));
    etat.textContent = res.length
      ? "Décochez ce que vous voulez masquer. Double-touchez un nom pour n'afficher que lui."
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
