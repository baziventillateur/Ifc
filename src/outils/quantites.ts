// Quantitatifs par type d'élément : nombre, volume, surface, longueur. Export pour Excel.
import { bouton, cree, nombre, telechargerCsv } from "../noyau";
import { changement, visibles } from "../registre";
import { definirCouche, retirerCouche, STYLES } from "../apparence";
import { quantifier, tousLesElements, type LigneQ, type Regroupement } from "../requetes";
import { enregistrerOutil } from "./panneau";
import { note, puces } from "./ui";

type Mode = "type" | "niveau";

enregistrerOutil("quantites", "Quantités", "Quantitatifs", (section) => {
  let mode: Mode = "type";
  let lignes: LigneQ[] = [];
  let ligneActive: HTMLElement | null = null;

  const choix = puces(
    [
      { valeur: "type", libelle: "Par type" },
      { valeur: "niveau", libelle: "Par niveau" },
    ],
    mode,
    (v) => {
      mode = v as Mode;
      void calculer();
    },
  );
  const exporter = bouton("puce", "Export Excel (CSV)", () => {
    if (!lignes.length) return;
    const entete = ["Maquette", "Catégorie", mode === "type" ? "Type" : "Niveau", "Nombre", "Volume (m³)", "Surface (m²)", "Longueur (m)"];
    telechargerCsv(
      `quantitatifs-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        entete,
        ...lignes.map((l) => [
          l.cle[0],
          l.cle[1],
          l.cle[2],
          l.nb,
          Number(l.volume.toFixed(3)),
          Number(l.surface.toFixed(2)),
          Number(l.longueur.toFixed(2)),
        ]),
      ],
    );
  });
  choix.racine.append(exporter);
  const bilan = note("");
  const tableau = cree("div", "tableau-q");
  section.append(choix.racine, bilan, tableau);

  const cellule = (v: number, unite: string) => (v > 0 ? `${nombre(v, v >= 100 ? 0 : 2)}${unite}` : "—");

  function rangee(classe: string, libelle: string, l: { nb: number; volume: number; surface: number; longueur: number }) {
    const r = cree("div", "q " + classe);
    r.append(
      cree("span", "q-nom", libelle),
      cree("span", "q-nb", nombre(l.nb, 0)),
      cree("span", "q-v", cellule(l.volume, "")),
      cree("span", "q-s", cellule(l.surface, "")),
      cree("span", "q-l", cellule(l.longueur, "")),
    );
    return r;
  }

  let tour = 0;
  async function calculer() {
    const n = ++tour;
    tableau.replaceChildren();
    bilan.textContent = "Calcul…";
    const liste = visibles();
    const tous = await tousLesElements(liste, (a) => {
      if (n === tour) bilan.textContent = `Analyse des maquettes… ${Math.round(a * 100)} %`;
    });
    const reg: Regroupement[] = ["maquette", "categorie", mode];
    const res = await quantifier(tous, reg, (a) => {
      if (n === tour) bilan.textContent = `Calcul des volumes… ${Math.round(a * 100)} %`;
    });
    if (n !== tour) return;
    lignes = res;
    bilan.textContent = liste.length
      ? "Quantités lues dans l'IFC ; volume mesuré sur la géométrie quand l'IFC ne le donne pas. Touchez une ligne pour la voir."
      : "Aucune maquette visible.";

    const entete = cree("div", "q entete");
    entete.append(
      cree("span", "q-nom", ""),
      cree("span", "q-nb", "Nb"),
      cree("span", "q-v", "m³"),
      cree("span", "q-s", "m²"),
      cree("span", "q-l", "m"),
    );
    tableau.append(entete);

    const parMaquette = new Map<string, Map<string, LigneQ[]>>();
    for (const l of res) {
      if (!parMaquette.has(l.cle[0])) parMaquette.set(l.cle[0], new Map());
      const cats = parMaquette.get(l.cle[0])!;
      if (!cats.has(l.cle[1])) cats.set(l.cle[1], []);
      cats.get(l.cle[1])!.push(l);
    }
    for (const [maq, cats] of parMaquette) {
      if (parMaquette.size > 1) tableau.append(cree("div", "q maquette", maq));
      for (const [cat, sous] of cats) {
        const total = sous.reduce(
          (t, l) => ({
            nb: t.nb + l.nb,
            volume: t.volume + l.volume,
            surface: t.surface + l.surface,
            longueur: t.longueur + l.longueur,
          }),
          { nb: 0, volume: 0, surface: 0, longueur: 0 },
        );
        const tete = rangee("categorie", `▸ ${cat}`, total);
        const enfants = sous.map((l) => {
          const r = rangee("sous", l.cle[2], l);
          r.hidden = true;
          r.addEventListener("click", () => {
            ligneActive?.classList.remove("active");
            if (ligneActive === r) {
              ligneActive = null;
              void retirerCouche("quantites");
              return;
            }
            ligneActive = r;
            r.classList.add("active");
            void definirCouche("quantites", STYLES.quantites, l.ids);
          });
          return r;
        });
        tete.addEventListener("click", () => {
          const ouvert = enfants[0]?.hidden;
          for (const e of enfants) e.hidden = !ouvert;
          (tete.firstChild as HTMLElement).textContent = `${ouvert ? "▾" : "▸"} ${cat}`;
        });
        tableau.append(tete, ...enfants);
      }
    }
  }

  changement.on(() => {
    if (!section.hidden) void calculer();
  });

  return {
    ouvrir: () => void calculer(),
    fermer: () => {
      ligneActive = null;
      void retirerCouche("quantites");
    },
  };
});
