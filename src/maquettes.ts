// Chargement des maquettes (exemple, IFC, mémoire de l'appareil) et panneau « Maquettes ».
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import {
  alerte,
  attente,
  bouton,
  boutonIcone,
  cadrer,
  composants,
  cree,
  el,
  fragments,
  grille,
  recentrerPivot,
  monde,
  rafraichir,
} from "./noyau";
import {
  changement,
  definirCouleurMaquette,
  maquettes,
  marquerExemple,
  reglages,
  visibles,
  type Maquette,
} from "./registre";
import {
  appliquerApparence,
  appliquerVisibilite,
  couleursModifiees,
  enregistrer,
  oublierMaquette,
  persoModifiee,
  reinitialiserCouleurs,
  selectionIds,
  selectionModifiee,
} from "./apparence";
import { fermerFiche } from "./fiche";
import { oublierIndex } from "./index-elements";
import { demanderPersistance, ecrire, effacer, lire, lireTout } from "./stockage";

const MODELES_EXEMPLE = [
  { id: "Architecture", fichier: "modeles/ecole_architecture.frag" },
  { id: "Structure", fichier: "modeles/ecole_structure.frag" },
];

const calques = el("calques");
const calquesEntete = el("calques-entete");
const calquesTitre = el("calques-titre");
const calquesListe = el("calques-liste");
const calquesPied = el("calques-pied");
const nomMaquette = el("nom-maquette");
const btnCouleurs = el<HTMLButtonElement>("btn-couleurs");

export const exempleAffiche = () => [...maquettes.values()].some((m) => m.exemple);

// --- Titre et panneau ------------------------------------------------------------

function majTitre() {
  const n = maquettes.size;
  if (exempleAffiche()) nomMaquette.textContent = "École (exemple)";
  else if (n === 0) nomMaquette.textContent = "Aucune maquette";
  else if (n === 1) nomMaquette.textContent = [...maquettes.keys()][0];
  else nomMaquette.textContent = `${n} maquettes`;
}

async function changerVisibilite(changements: [Maquette, boolean][], libelle = "affichage des maquettes") {
  enregistrer(libelle, () => {
    for (const [m, v] of changements) m.modele.object.visible = v;
  });
  await fermerFiche();
  await rafraichir();
  changement.emit();
}

/** Marque discrètement les maquettes qui contiennent un élément sélectionné. */
function marquerChoisies() {
  const choisies = selectionIds();
  let nombre = 0;
  for (const rang of calquesListe.querySelectorAll<HTMLElement>(".calque")) {
    const oui = (choisies.get(rang.dataset.maquette ?? "")?.size ?? 0) > 0;
    rang.classList.toggle("choisie", oui);
    if (oui) nombre += 1;
  }
  // Panneau replié : le titre dit quand même quelle maquette est concernée.
  calques.classList.toggle("a-selection", nombre > 0);
}
selectionModifiee.on(marquerChoisies);

function dessinerCalques() {
  const liste = [...maquettes.values()];
  calques.hidden = liste.length === 0;
  calquesTitre.textContent = `Maquettes · ${liste.length}`;
  calquesListe.replaceChildren();
  for (const m of liste) {
    const rang = cree("div", "calque");
    rang.dataset.maquette = m.id;
    rang.classList.toggle("masque", !m.modele.object.visible);
    const nom = bouton(
      "calque-nom",
      "",
      () => void changerVisibilite([[m, !m.modele.object.visible]]),
      `Afficher / masquer « ${m.id} » (${m.lot})`,
    );
    const choix = cree("input", "choix-couleur");
    choix.type = "color";
    choix.value = m.hex;
    choix.style.setProperty("--teinte", m.hex);
    choix.title = `Couleur de « ${m.id} »`;
    choix.setAttribute("aria-label", `Couleur de « ${m.id} »`);
    choix.addEventListener("input", () => {
      // Aperçu immédiat de la pastille ; la recoloration se fait au relâchement.
      choix.style.setProperty("--teinte", choix.value);
    });
    choix.addEventListener("change", () => {
      // Choisir une couleur allume le mode couleurs, sinon elle ne se voit pas.
      enregistrer(`couleur de « ${m.id} »`, () => {
        definirCouleurMaquette(m, choix.value);
        if (!reglages.couleurs) {
          reglages.couleurs = true;
          try {
            localStorage.setItem("visio-couleurs", "1");
          } catch {
            // Mémoire locale indisponible : réglage gardé pour la session.
          }
        }
      });
      void appliquerApparence();
      dessinerCalques();
    });
    nom.append(cree("span", "texte", m.id));
    rang.append(choix, nom);

    const transp = boutonIcone(
      "transparence",
      () => {
        enregistrer(m.transparente ? `« ${m.id} » opaque` : `« ${m.id} » transparente`, () => {
          m.transparente = !m.transparente;
        });
        void appliquerApparence([m.id]);
        dessinerCalques();
      },
      m.transparente ? `Rendre « ${m.id} » opaque` : `Rendre « ${m.id} » transparente`,
      "icone" + (m.transparente ? " allume" : ""),
    );
    rang.append(transp);
    if (m.transparente) {
      const curseur = cree("input", "curseur-transparence");
      curseur.type = "range";
      curseur.min = "5";
      curseur.max = "100";
      curseur.step = "5";
      curseur.value = String(Math.round(m.opacite * 100));
      curseur.title = `Opacité de « ${m.id} »`;
      curseur.setAttribute("aria-label", `Opacité de « ${m.id} »`);
      const valeur = cree("span", "valeur-transparence", `${curseur.value} %`);
      curseur.addEventListener("input", () => {
        enregistrer(
          `opacité de « ${m.id} »`,
          () => {
            m.opacite = Number(curseur.value) / 100;
          },
          `opacite-${m.id}`,
        );
        valeur.textContent = `${curseur.value} %`;
        void appliquerApparence([m.id]);
      });
      rang.append(curseur, valeur);
    }
    if (liste.length > 1) {
      rang.append(
        boutonIcone(
          "isoler",
          () => void changerVisibilite(liste.map((x) => [x, x === m]), `« ${m.id} » seule`),
          `Afficher seulement « ${m.id} »`,
        ),
      );
    }
    // Masquer seulement : la suppression d'une maquette se fait dans « Projet » (corbeille).
    const visible = m.modele.object.visible;
    rang.append(
      boutonIcone(
        visible ? "oeil" : "oeilBarre",
        () => void changerVisibilite([[m, !visible]], visible ? `« ${m.id} » masquée` : `« ${m.id} » affichée`),
        visible ? `Masquer « ${m.id} »` : `Afficher « ${m.id} »`,
        "icone" + (visible ? "" : " eteint"),
      ),
    );
    calquesListe.append(rang);
  }
  marquerChoisies();
  calquesPied.classList.toggle("seul", liste.length < 2);
  btnCouleurs.classList.toggle("allume", reglages.couleurs);
  btnCouleurs.setAttribute("aria-pressed", String(reglages.couleurs));
  majReinit();
  majTitre();
}

changement.on(dessinerCalques);

calquesEntete.addEventListener("click", () => {
  const replie = calques.classList.toggle("replie");
  calquesEntete.setAttribute("aria-expanded", String(!replie));
});

btnCouleurs.addEventListener("click", () => {
  enregistrer(reglages.couleurs ? "couleurs éteintes" : "couleurs allumées", () => {
    reglages.couleurs = !reglages.couleurs;
    try {
      localStorage.setItem("visio-couleurs", reglages.couleurs ? "1" : "0");
    } catch {
      // Mémoire locale indisponible : réglage gardé pour la session.
    }
  });
  void appliquerApparence();
  dessinerCalques();
});

// Petit bouton « ↺ » à côté de « Couleurs » : revenir aux couleurs d'origine de la maquette.
const btnReinit = el<HTMLButtonElement>("btn-couleurs-init");
function majReinit() {
  btnReinit.hidden = !couleursModifiees();
}
btnReinit.addEventListener("click", () => {
  void reinitialiserCouleurs();
  dessinerCalques();
  alerte("Couleurs d'origine rétablies. Ctrl+Z ou ↶ pour revenir en arrière.", 3500);
});
persoModifiee.on(majReinit);
try {
  reglages.couleurs = localStorage.getItem("visio-couleurs") === "1";
} catch {
  reglages.couleurs = false;
}

el("btn-tout-afficher").addEventListener("click", () =>
  void changerVisibilite([...maquettes.values()].map((m) => [m, true]), "tout afficher"),
);

el("btn-tout-retirer").addEventListener("click", () =>
  void changerVisibilite([...maquettes.values()].map((m) => [m, false]), "tout masquer"),
);

// --- Vue ------------------------------------------------------------------------------

export async function recadrer() {
  await rafraichir();
  const liste = visibles();
  if (liste.length === 0) return;

  recentrerPivot();
  // Sur l'exemple, on cadre le bâtiment plutôt que le terrain autour.
  const batiment = exempleAffiche() ? maquettes.get("Structure") : undefined;
  if (batiment && batiment.modele.object.visible) {
    const sphere = batiment.modele.box.getBoundingSphere(new THREE.Sphere());
    if (sphere.radius > 0) {
      sphere.radius *= 0.8;
      await monde.camera.controls.setLookAt(
        sphere.center.x + sphere.radius * 1.1,
        sphere.center.y + sphere.radius * 0.9,
        sphere.center.z + sphere.radius * 1.1,
        sphere.center.x,
        sphere.center.y,
        sphere.center.z,
        false,
      );
      await monde.camera.controls.fitToSphere(sphere, true);
      return;
    }
  }
  const boite = new THREE.Box3();
  for (const m of liste) boite.union(m.modele.box);
  await cadrer(boite, 1);
}

/** Pose la grille sous le point le plus bas des maquettes, pour qu'elle ne traverse pas le bâtiment. */
function caleGrille() {
  const boite = new THREE.Box3();
  for (const m of maquettes.values()) boite.union(m.modele.box);
  grille.three.position.y = boite.isEmpty() ? 0 : boite.min.y - 0.02;
}

// --- Chargement et retrait ------------------------------------------------------

export async function vider(garderEnMemoire = false) {
  await fermerFiche();
  for (const id of [...maquettes.keys()]) {
    oublierMaquette(id);
    oublierIndex(id);
    await fragments.core.disposeModel(id);
  }
  // La prochaine maquette chargée redéfinit le repère commun.
  fragments.core.baseCoordinates = null;
  if (!garderEnMemoire) await effacer("maquettes");
  caleGrille();
  changement.emit();
}

export async function retirer(id: string) {
  await fermerFiche();
  oublierMaquette(id);
  oublierIndex(id);
  await fragments.core.disposeModel(id);
  if (maquettes.size === 0) fragments.core.baseCoordinates = null;
  await effacer("maquettes", id);
  caleGrille();
  await appliquerApparence();
  await appliquerVisibilite();
  changement.emit();
}

async function apresChargement() {
  caleGrille();
  await appliquerApparence();
  await appliquerVisibilite();
  await recadrer();
  changement.emit();
}

export async function chargerExemple() {
  try {
    attente("Chargement de la maquette d'exemple…", 0.1);
    await vider();
    marquerExemple(true);
    let fait = 0;
    await Promise.all(
      MODELES_EXEMPLE.map(async ({ id, fichier }) => {
        const reponse = await fetch(new URL(fichier, document.baseURI));
        if (!reponse.ok) throw new Error(`Fichier introuvable : ${fichier}`);
        await fragments.core.load(await reponse.arrayBuffer(), { modelId: id });
        fait += 1;
        attente("Chargement de la maquette d'exemple…", fait / MODELES_EXEMPLE.length);
      }),
    );
    await apresChargement();
  } catch (erreur) {
    console.error(erreur);
    alerte("La maquette d'exemple n'a pas pu être chargée.");
  } finally {
    marquerExemple(false);
    attente(null);
  }
}

const chargeurIfc = composants.get(OBC.IfcLoader);
let chargeurPret: Promise<void> | null = null;
function preparerChargeurIfc() {
  if (!chargeurPret) {
    chargeurPret = chargeurIfc.setup({
      autoSetWasm: false,
      wasm: { path: new URL("wasm/", document.baseURI).href, absolute: true },
    });
    chargeurPret.catch(() => (chargeurPret = null));
  }
  return chargeurPret;
}

function idUnique(nom: string) {
  if (!maquettes.has(nom)) return nom;
  let i = 2;
  while (maquettes.has(`${nom} (${i})`)) i += 1;
  return `${nom} (${i})`;
}

/** Copie convertie gardée sur l'appareil ; « version » = identifiant de la maquette dans le cloud. */
type Enregistrement = { id: string; ordre: number; date: string; version?: string; donnees: ArrayBuffer };

/** Version convertie (.frag) d'une maquette affichée, prête à être envoyée ou gardée. */
export async function bufferDe(id: string) {
  const m = maquettes.get(id);
  if (!m) throw new Error(`Maquette absente : ${id}`);
  return m.modele.getBuffer(false);
}

/** Rattache la copie de l'appareil à sa maquette du cloud (elle sera reconnue à coup sûr). */
export async function noterVersion(id: string, version: string) {
  const e = await lire<Enregistrement>("maquettes", id);
  if (e && e.version !== version) await ecrire("maquettes", id, { ...e, version });
}

/** Garde la maquette convertie sur l'appareil, pour la rouvrir sans reconversion. */
async function memoriser(id: string) {
  const m = maquettes.get(id);
  if (!m) return;
  try {
    const donnees = await m.modele.getBuffer(false);
    const ordre = [...maquettes.keys()].indexOf(id);
    const ok = await ecrire("maquettes", id, { id, ordre, date: new Date().toISOString(), donnees });
    if (!ok) alerte("Mémoire de l'appareil pleine : la maquette ne sera pas gardée.");
  } catch (e) {
    console.warn("Maquette non mémorisée", e);
  }
}

let chargementEnCours = false;
/** Vrai pendant qu'une maquette est lue ou convertie. */
export const chargementOccupe = () => chargementEnCours;

/** Ajoute une ou plusieurs maquettes IFC à celles déjà affichées. */
export async function ajouterIfc(fichiers: File[]): Promise<string[]> {
  if (chargementEnCours) return [];
  const ifc = fichiers.filter((f) => /\.ifc$/i.test(f.name));
  if (ifc.length === 0) {
    alerte("Ce fichier n'est pas un IFC. Depuis Revit : Fichier → Exporter → IFC.");
    return [];
  }
  chargementEnCours = true;
  const echecs: string[] = [];
  const ajoutees: string[] = [];
  try {
    attente("Préparation…", 0.02);
    await preparerChargeurIfc();
    if (exempleAffiche()) await vider();
    // Une maquette après l'autre : moins de mémoire, surtout sur téléphone.
    for (const [rang, fichier] of ifc.entries()) {
      const nom = fichier.name.replace(/\.ifc$/i, "");
      const etape = ifc.length > 1 ? `${rang + 1}/${ifc.length} · ` : "";
      try {
        attente(`${etape}Lecture de « ${nom} »…`, 0.02);
        const tampon = new Uint8Array(await fichier.arrayBuffer());
        const id = idUnique(nom);
        await chargeurIfc.load(tampon, true, id, {
          processData: {
            progressCallback: (a: number) => attente(`${etape}Conversion de « ${nom} »…`, a),
          },
        });
        ajoutees.push(id);
      } catch (erreur) {
        console.error(erreur);
        echecs.push(fichier.name);
      }
    }
    await apresChargement();
  } catch (erreur) {
    console.error(erreur);
    echecs.splice(0, echecs.length, ...ifc.map((f) => f.name));
  } finally {
    chargementEnCours = false;
    attente(null);
  }

  if (ajoutees.length) {
    demanderPersistance();
    for (const id of ajoutees) await memoriser(id);
  }
  if (echecs.length > 0) {
    alerte(
      echecs.length === 1
        ? `« ${echecs[0]} » n'a pas pu être lu. Vérifiez qu'il n'est pas corrompu.`
        : `${echecs.length} fichiers n'ont pas pu être lus.`,
    );
  } else if (ifc.length < fichiers.length) {
    alerte("Seuls les fichiers .ifc ont été ajoutés.");
  }
  return ajoutees;
}

export type MaquetteNuage = {
  /** Nom affiché (identifiant local de la maquette). */
  nom: string;
  /** Identifiant de la maquette dans le cloud : une copie de cette version est à jour. */
  version: string;
  /** Date de dépôt, pour reconnaître les copies gardées avant les versions. */
  date: string;
  /** Version convertie (.frag) dans le cloud, si elle existe. */
  frag?: () => Promise<ArrayBuffer>;
  /** Fichier IFC d'origine, en dernier recours. */
  ifc: () => Promise<File>;
  /** Appelé quand la maquette a dû être convertie ici (mise à niveau dans le cloud). */
  sansFrag?: (ifc?: File) => Promise<void>;
};

/**
 * Affiche les maquettes d'un projet du cloud, de la plus rapide à la plus lente :
 * 1. copie déjà sur l'appareil (aucun téléchargement) ;
 * 2. version convertie gardée dans le cloud (légère, ouverte sans conversion) ;
 * 3. fichier IFC, converti ici en dernier recours (anciennes maquettes).
 */
export async function ouvrirDepuisNuage(liste: MaquetteNuage[]) {
  await vider(true);
  const cache = await lireTout<Enregistrement>("maquettes");
  const noms = new Set(liste.map((l) => l.nom));
  for (const e of cache) if (!noms.has(e.id)) await effacer("maquettes", e.id);

  const total = liste.length;
  let ouvertes = 0;
  let echecs = 0;
  const aConvertir: MaquetteNuage[] = [];
  const aCompleter: MaquetteNuage[] = [];
  try {
    // 1. Copies de l'appareil.
    const reste: MaquetteNuage[] = [];
    for (const l of liste) {
      const garde = cache.find(
        (c) =>
          c.id === l.nom &&
          (c.version === l.version || (!c.version && Date.parse(c.date) >= Date.parse(l.date))),
      );
      if (!garde) {
        reste.push(l);
        continue;
      }
      attente(`Ouverture de « ${l.nom} »…`, ouvertes / total);
      try {
        await fragments.core.load(garde.donnees, { modelId: l.nom });
        ouvertes += 1;
        if (garde.version !== l.version) await noterVersion(l.nom, l.version);
        if (!l.frag) aCompleter.push(l);
      } catch (err) {
        console.error(err);
        reste.push(l);
      }
    }

    // 2. Versions converties du cloud : téléchargées en même temps, ouvertes à l'arrivée.
    const avecFrag = reste.filter((l) => l.frag);
    aConvertir.push(...reste.filter((l) => !l.frag));
    if (avecFrag.length) attente(`Téléchargement de ${avecFrag.length} maquette(s)…`, ouvertes / total);
    const arrivees = avecFrag.map(async (l) => {
      try {
        return { l, donnees: await l.frag!() };
      } catch (err) {
        console.error(err);
        return { l, donnees: null };
      }
    });
    for (const arrivee of arrivees) {
      const { l, donnees } = await arrivee;
      if (!donnees) {
        aConvertir.push(l);
        continue;
      }
      attente(`Ouverture de « ${l.nom} »…`, ouvertes / total);
      try {
        // Copie gardée avant l'ouverture : le moteur reprend le fichier pour lui en l'ouvrant.
        const copie: Enregistrement = {
          id: l.nom,
          ordre: liste.indexOf(l),
          date: new Date().toISOString(),
          version: l.version,
          donnees,
        };
        demanderPersistance();
        if (!(await ecrire("maquettes", l.nom, copie))) console.warn("Copie non gardée", l.nom);
        await fragments.core.load(donnees, { modelId: l.nom });
        ouvertes += 1;
      } catch (err) {
        console.error(err);
        aConvertir.push(l);
      }
    }
    if (maquettes.size > 0) await apresChargement();
  } finally {
    attente(null);
  }

  // 3. Dernier recours : l'IFC, converti ici.
  for (const l of aConvertir) {
    let fichier: File;
    try {
      attente(`Téléchargement de « ${l.nom} » (fichier d'origine)…`, 0.05);
      fichier = await l.ifc();
    } catch (err) {
      console.error(err);
      echecs += 1;
      attente(null);
      continue;
    }
    const ids = await ajouterIfc([fichier]);
    if (ids.includes(l.nom)) {
      await noterVersion(l.nom, l.version);
      if (l.sansFrag) void l.sansFrag(fichier).catch((err) => console.error("Mise à niveau", err));
    }
  }
  // Copies d'appareil d'anciennes maquettes : on envoie leur version convertie au cloud.
  for (const l of aCompleter) if (l.sansFrag) void l.sansFrag().catch((err) => console.error("Mise à niveau", err));
  if (echecs > 0) alerte(`${echecs} maquette(s) n'ont pas pu être téléchargées.`);
}

/** Rouvre les maquettes gardées sur l'appareil. Renvoie false s'il n'y en a pas. */
export async function rouvrirMemorisees() {
  const liste = (await lireTout<Enregistrement>("maquettes")).sort((a, b) => a.ordre - b.ordre);
  if (liste.length === 0) return false;
  try {
    for (const [i, e] of liste.entries()) {
      attente(`Ouverture de « ${e.id} »…`, i / liste.length);
      try {
        await fragments.core.load(e.donnees, { modelId: e.id });
      } catch (err) {
        console.error(err);
        await effacer("maquettes", e.id);
      }
    }
    await apresChargement();
  } finally {
    attente(null);
  }
  return maquettes.size > 0;
}
