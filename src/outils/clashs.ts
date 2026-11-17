// Outil « Clashs » : lancer la détection, parcourir les conflits, rapport.
import * as THREE from "three";
import { bouton, boutonIcone, cadrer, cree, nombre, rafraichir, telechargerCsv, versIfc } from "../noyau";
import { changement, maquettes } from "../registre";
import { definirCouche, idsDe, retirerCouche, STYLES } from "../apparence";
import { fermerFiche } from "../fiche";
import { libelleCategorie } from "../libelles";
import { demandeRemarque } from "../evenements";
import { detecterClashs, type Clash, type Statut } from "../clashs-moteur";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { interrupteur, note, puces, selecteur, titreSection } from "./ui";

export const STATUTS: Record<Statut, string> = {
  nouveau: "Nouveau",
  "a-traiter": "À traiter",
  accepte: "Accepté",
  resolu: "Résolu",
};

/** Derniers résultats, lus aussi par l'assistant. */
export let derniersClashs: Clash[] = [];
let courant: Clash | null = null;

async function quitterVue() {
  courant = null;
  await retirerCouche("clash-a");
  await retirerCouche("clash-b");
}

async function voir(c: Clash) {
  courant = c;
  await fermerFiche();
  c.a.m.modele.object.visible = true;
  c.b.m.modele.object.visible = true;
  await definirCouche("clash-a", STYLES.clashA, idsDe(c.a.m.id, c.a.e.id), true);
  await definirCouche("clash-b", STYLES.clashB, idsDe(c.b.m.id, c.b.e.id), true);
  await rafraichir();
  await cadrer(c.boite.clone().expandByScalar(1.5), 1.3);
  changement.emit();
}

export const nomElement = (e: { nom: string; cat: string }) => e.nom || libelleCategorie(e.cat);

export { detecterClashs };

enregistrerOutil("clashs", "Clashs", "Détection des clashs", (section) => {
  let idA = "";
  let idB = "";
  let tolerance = 1;
  let exclure = true;

  const choixA = cree("div", "champ-groupe");
  const choixB = cree("div", "champ-groupe");
  const rangeeChoix = cree("div", "rangee choix-maquettes");
  rangeeChoix.append(choixA, cree("span", "contre", "contre"), choixB);

  const tol = cree("input", "champ nombre");
  tol.type = "number";
  tol.min = "0";
  tol.max = "50";
  tol.step = "0.5";
  tol.value = String(tolerance);
  tol.addEventListener("change", () => (tolerance = Math.max(0, Number(tol.value) || 0)));
  const ligneTol = cree("label", "rangee petit");
  ligneTol.append(cree("span", "", "Ignorer les contacts de moins de"), tol, cree("span", "", "cm"));
  const exc = interrupteur("Ignorer locaux, réservations et terrain", exclure, (v) => (exclure = v));
  const lancer = bouton("btn principal large", "Lancer la détection", () => void detecter());
  const bilan = note("Choisissez deux maquettes, par exemple la CVC contre la structure.");

  const detail = cree("div", "detail-clash");
  detail.hidden = true;
  const entete = cree("div", "rangee-titre");
  const listeTitre = titreSection("");
  const exporter = bouton("lien", "Export Excel (CSV)", () => exporterCsv());
  entete.append(listeTitre, exporter);
  entete.hidden = true;
  let filtreActuel = "tous";
  const filtre = puces(
    [
      { valeur: "tous", libelle: "Tous" },
      { valeur: "ouverts", libelle: "À traiter" },
      { valeur: "fermes", libelle: "Acceptés / résolus" },
    ],
    "tous",
    (v) => {
      filtreActuel = v;
      dessinerListe();
    },
  );
  filtre.racine.hidden = true;
  const liste = cree("div", "liste");

  section.append(rangeeChoix, ligneTol, exc.racine, lancer, bilan, detail, entete, filtre.racine, liste);

  function remplirChoix() {
    const liste = [...maquettes.values()];
    const options = liste.map((m) => ({ valeur: m.id, libelle: m.id }));
    const valide = (id: string) => maquettes.has(id);
    if (!valide(idA) || !valide(idB) || (idA === idB && liste.length > 1)) {
      // Par défaut : un réseau (CVC, plomberie…) contre la structure, si on les reconnaît.
      const str = liste.find((m) => m.lot === "Structure");
      const res = liste.find((m) => !["Structure", "Architecture"].includes(m.lot) && m !== str);
      if (str && res) [idA, idB] = [res.id, str.id];
      else [idA, idB] = [liste[0]?.id ?? "", (liste[1] ?? liste[0])?.id ?? ""];
    }
    choixA.replaceChildren(cree("span", "petit", "Maquette A"), selecteur(options, idA, (v) => (idA = v)));
    choixB.replaceChildren(cree("span", "petit", "Maquette B"), selecteur(options, idB, (v) => (idB = v)));
    lancer.disabled = options.length === 0;
  }

  async function detecter() {
    const ma = maquettes.get(idA);
    const mb = maquettes.get(idB);
    if (!ma || !mb) return;
    lancer.disabled = true;
    await quitterVue();
    detail.hidden = true;
    liste.replaceChildren();
    try {
      derniersClashs = await detecterClashs(ma, mb, { tolerance: tolerance / 100, exclure }, (t) => {
        bilan.textContent = t;
      });
      bilan.textContent = derniersClashs.length
        ? `${derniersClashs.length} conflit${derniersClashs.length > 1 ? "s" : ""} entre « ${ma.id} » et « ${mb.id} ».`
        : `Aucun conflit entre « ${ma.id} » et « ${mb.id} ».`;
    } catch (e) {
      console.error(e);
      bilan.textContent = "La détection a échoué sur ces maquettes.";
      derniersClashs = [];
    } finally {
      lancer.disabled = false;
    }
    dessinerListe();
  }

  function compteOuverts() {
    return derniersClashs.filter((c) => c.statut === "nouveau" || c.statut === "a-traiter").length;
  }

  function dessinerListe() {
    entete.hidden = derniersClashs.length === 0;
    filtre.racine.hidden = derniersClashs.length === 0;
    listeTitre.textContent = `Conflits · ${compteOuverts()} à traiter`;
    marquerOutil("clashs", compteOuverts() ? String(compteOuverts()) : false);
    const visibles = derniersClashs.filter((c) =>
      filtreActuel === "ouverts"
        ? c.statut === "nouveau" || c.statut === "a-traiter"
        : filtreActuel === "fermes"
          ? c.statut === "accepte" || c.statut === "resolu"
          : true,
    );
    let niveau = "";
    const enfants: HTMLElement[] = [];
    for (const c of visibles.slice(0, 400)) {
      if (c.niveau !== niveau) {
        niveau = c.niveau;
        enfants.push(cree("div", "sous-titre-liste", niveau));
      }
      const r = cree("button", "resultat" + (c === courant ? " actif" : ""));
      r.type = "button";
      const t = cree("div", "resultat-texte");
      t.append(
        cree("strong", "", `${c.n}. ${nomElement(c.a.e)} × ${nomElement(c.b.e)}`),
        cree("span", "petit", `${libelleCategorie(c.a.e.cat)} × ${libelleCategorie(c.b.e.cat)} · ≈ ${nombre(c.penetration * 100, 0)} cm`),
      );
      const pastille = cree("span", "statut " + c.statut, STATUTS[c.statut]);
      r.append(t, pastille);
      r.addEventListener("click", () => void ouvrir(c));
      enfants.push(r);
    }
    liste.replaceChildren(...enfants);
  }

  async function ouvrir(c: Clash) {
    await voir(c);
    if (c.statut === "nouveau") c.statut = "a-traiter";
    dessinerDetail();
    dessinerListe();
  }

  function dessinerDetail() {
    const c = courant;
    detail.hidden = !c;
    if (!c) return;
    const i = derniersClashs.indexOf(c);
    const nav = cree("div", "rangee-titre");
    nav.append(
      titreSection(`Conflit ${c.n} / ${derniersClashs.length} · ${c.niveau}`),
      boutonIcone("precedent", () => i > 0 && void ouvrir(derniersClashs[i - 1]), "Conflit précédent"),
      boutonIcone("suivant", () => i < derniersClashs.length - 1 && void ouvrir(derniersClashs[i + 1]), "Conflit suivant"),
    );
    const ligneEl = (couleur: string, x: Clash["a"]) => {
      const d = cree("div", "ligne-clash");
      const p = cree("span", "point");
      p.style.setProperty("--teinte", couleur);
      d.append(p, cree("span", "", `${nomElement(x.e)} — ${libelleCategorie(x.e.cat)} (${x.m.id})`));
      return d;
    };
    const statut = puces(
      (Object.keys(STATUTS) as Statut[]).filter((s) => s !== "nouveau").map((s) => ({ valeur: s, libelle: STATUTS[s] })),
      c.statut === "nouveau" ? null : c.statut,
      (v) => {
        c.statut = v as Statut;
        dessinerListe();
      },
    );
    const actions = cree("div", "puces");
    actions.append(
      bouton("puce", "+ Remarque", () =>
        demandeRemarque.emit({
          type: "Clash",
          titre: `Clash : ${nomElement(c.a.e)} × ${nomElement(c.b.e)}`,
          description: `${c.niveau} — ${libelleCategorie(c.a.e.cat)} (${c.a.m.id}) contre ${libelleCategorie(c.b.e.cat)} (${c.b.m.id}), pénétration ≈ ${nombre(c.penetration * 100, 0)} cm.`,
          elements: [
            { modele: c.a.m.id, id: c.a.e.id },
            { modele: c.b.m.id, id: c.b.e.id },
          ],
        }),
      ),
      bouton("puce", "Recentrer", () => void cadrer(c.boite.clone().expandByScalar(1.5), 1.3)),
      bouton("puce", "Quitter la vue conflit", async () => {
        await quitterVue();
        detail.hidden = true;
        dessinerListe();
      }),
    );
    detail.replaceChildren(nav, ligneEl("#ef4444", c.a), ligneEl("#22c55e", c.b), statut.racine, actions);
  }

  function exporterCsv() {
    const centre = (c: Clash) => versIfc(c.boite.getCenter(new THREE.Vector3()));
    telechargerCsv(`clashs-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        "N°",
        "Statut",
        "Niveau",
        "Maquette A",
        "Élément A",
        "Catégorie A",
        "GUID A",
        "Maquette B",
        "Élément B",
        "Catégorie B",
        "GUID B",
        "Pénétration (cm)",
        "X",
        "Y",
        "Z",
      ],
      ...derniersClashs.map((c) => {
        const [x, y, z] = centre(c);
        return [
          c.n,
          STATUTS[c.statut],
          c.niveau,
          c.a.m.id,
          nomElement(c.a.e),
          libelleCategorie(c.a.e.cat),
          c.a.e.guid,
          c.b.m.id,
          nomElement(c.b.e),
          libelleCategorie(c.b.e.cat),
          c.b.e.guid,
          Number((c.penetration * 100).toFixed(1)),
          Number(x.toFixed(3)),
          Number(y.toFixed(3)),
          Number(z.toFixed(3)),
        ];
      }),
    ]);
  }

  changement.on(() => {
    if (!section.hidden) remplirChoix();
    const ids = new Set(maquettes.keys());
    if (derniersClashs.some((c) => !ids.has(c.a.m.id) || !ids.has(c.b.m.id))) {
      derniersClashs = [];
      courant = null;
      detail.hidden = true;
      dessinerListe();
    }
  });

  return {
    ouvrir: () => remplirChoix(),
    fermer: () => {
      void quitterVue();
      detail.hidden = true;
      dessinerListe();
    },
  };
});

/** Pour l'assistant : lance une détection et met à jour la liste de l'outil. */
export async function detecterPourAssistant(a: string, b: string, toleranceCm = 1) {
  const ma = maquettes.get(a);
  const mb = maquettes.get(b);
  if (!ma || !mb) throw new Error("Maquette introuvable");
  derniersClashs = await detecterClashs(ma, mb, { tolerance: toleranceCm / 100, exclure: true });
  marquerOutil("clashs", derniersClashs.length ? String(derniersClashs.length) : false);
  return derniersClashs;
}
