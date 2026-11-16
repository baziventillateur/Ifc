import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import urlOuvrier from "@thatopen/fragments/worker?url";
import { libelleCategorie, libelleAttribut, formaterValeur } from "./libelles";

type Donnees = Record<string, any>;

const MODELES_EXEMPLE = [
  { id: "Architecture", fichier: "modeles/ecole_architecture.frag" },
  { id: "Structure", fichier: "modeles/ecole_structure.frag" },
];

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const voile = el("voile");
const voileTexte = el("voile-texte");
const jauge = el("jauge");
const fiche = el("fiche");
const ficheCategorie = el("fiche-categorie");
const ficheNom = el("fiche-nom");
const ficheCorps = el("fiche-corps");
const calques = el("calques");
const aide = el("aide");
const nomMaquette = el("nom-maquette");
const champFichier = el<HTMLInputElement>("fichier");
const depot = el("depot");

function attente(texte: string | null, avancement?: number) {
  if (texte === null) {
    voile.classList.add("cache");
    return;
  }
  voile.classList.remove("cache");
  voileTexte.textContent = texte;
  jauge.style.width = `${Math.round((avancement ?? 0) * 100)}%`;
}

// --- Scène 3D -------------------------------------------------------------

const composants = new OBC.Components();
const mondes = composants.get(OBC.Worlds);
const monde = mondes.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();

monde.scene = new OBC.SimpleScene(composants);
monde.scene.setup();
monde.scene.three.background = new THREE.Color("#0f1318");

monde.renderer = new OBC.SimpleRenderer(composants, el("scene"));
monde.camera = new OBC.OrthoPerspectiveCamera(composants);
composants.init();

const grille = composants.get(OBC.Grids).create(monde);
grille.config.color = new THREE.Color("#2a323d");

// --- Moteur de maquettes ---------------------------------------------------

const fragments = composants.get(OBC.FragmentsManager);
fragments.init(urlOuvrier);

monde.camera.controls.addEventListener("update", () => fragments.core.update());

fragments.list.onItemSet.add(({ value: modele }) => {
  modele.useCamera(monde.camera.three);
  monde.scene.three.add(modele.object);
  fragments.core.update(true);
  dessinerCalques();
});

fragments.list.onItemDeleted.add(() => dessinerCalques());

// Évite le scintillement entre faces superposées.
fragments.core.models.materials.list.onItemSet.add(({ value: materiau }) => {
  const m = materiau as any;
  if (!m.isLodMaterial) {
    m.polygonOffset = true;
    m.polygonOffsetUnits = 1;
    m.polygonOffsetFactor = Math.random();
  }
});

const chargeurIfc = composants.get(OBC.IfcLoader);
let chargeurPret: Promise<void> | null = null;

function preparerChargeurIfc() {
  if (!chargeurPret) {
    chargeurPret = chargeurIfc.setup({
      autoSetWasm: false,
      wasm: { path: new URL("wasm/", document.baseURI).href, absolute: true },
    });
  }
  return chargeurPret;
}

// --- Sélection et fiche d'élément -----------------------------------------

composants.get(OBC.Raycasters).get(monde);
const surligneur = composants.get(OBF.Highlighter);
surligneur.setup({
  world: monde,
  selectMaterialDefinition: {
    color: new THREE.Color("#ff8a1f"),
    opacity: 1,
    transparent: false,
    renderedFaces: 0,
  },
});

surligneur.events.select.onHighlight.add(async (selection) => {
  for (const [idModele, ids] of Object.entries(selection)) {
    const modele = fragments.list.get(idModele);
    const idLocal = [...ids][0];
    if (!modele || idLocal === undefined) continue;
    await afficherFiche(modele, idLocal, idModele);
    return;
  }
});

surligneur.events.select.onClear.add(() => fermerFiche());

el("fiche-fermer").addEventListener("click", () => {
  void surligneur.clear("select");
  fermerFiche();
});

function fermerFiche() {
  fiche.classList.remove("ouverte");
}

function valeur(champ: any) {
  if (champ && typeof champ === "object" && "value" in champ) return champ.value;
  return undefined;
}

function ligne(cle: string, contenu: string) {
  const div = document.createElement("div");
  div.className = "ligne";
  const c = document.createElement("span");
  c.className = "cle";
  c.textContent = cle;
  const v = document.createElement("span");
  v.className = "valeur";
  v.textContent = contenu;
  div.append(c, v);
  return div;
}

function groupe(titre: string, lignes: HTMLElement[]) {
  const bloc = document.createElement("div");
  bloc.className = "groupe";
  const t = document.createElement("div");
  t.className = "groupe-titre";
  t.textContent = titre;
  bloc.append(t, ...lignes);
  return bloc;
}

async function afficherFiche(modele: any, idLocal: number, idModele: string) {
  const [donnees] = (await modele.getItemsData([idLocal], {
    attributesDefault: true,
    relations: { IsDefinedBy: { attributes: true, relations: true } },
  })) as Donnees[];
  if (!donnees) return;

  const categorie = String(valeur(donnees._category) ?? "");
  ficheCategorie.textContent = libelleCategorie(categorie);
  ficheNom.textContent = String(valeur(donnees.Name) ?? "Élément sans nom");
  ficheCorps.replaceChildren();
  aide.classList.add("cache");

  // Identité
  const identite: HTMLElement[] = [];
  if (fragments.list.size > 1) identite.push(ligne("Maquette", idModele));
  identite.push(ligne("Classe IFC", categorie || "—"));
  for (const [cle, champ] of Object.entries(donnees)) {
    if (cle.startsWith("_") || cle === "Name" || Array.isArray(champ)) continue;
    const v = valeur(champ);
    if (v === undefined || v === null || v === "") continue;
    identite.push(ligne(libelleAttribut(cle), formaterValeur(v)));
  }
  const guid = valeur(donnees._guid);
  if (guid) identite.push(ligne("Identifiant (GUID)", String(guid)));
  ficheCorps.append(groupe("Identité", identite));

  // Volume mesuré sur la géométrie
  try {
    const volume = await modele.getItemsVolume([idLocal]);
    if (Number.isFinite(volume) && volume > 0) {
      ficheCorps.append(
        groupe("Mesure sur la maquette", [ligne("Volume", `${formaterValeur(volume)} m³`)]),
      );
    }
  } catch {
    // Certains éléments n'ont pas de volume mesurable.
  }

  // Jeux de propriétés et quantités
  const definitions = Array.isArray(donnees.IsDefinedBy) ? (donnees.IsDefinedBy as Donnees[]) : [];
  let nbJeux = 0;
  for (const jeu of definitions) {
    const contenu = [jeu.HasProperties, jeu.Quantities].find(Array.isArray) as Donnees[] | undefined;
    if (!contenu) continue;
    const lignes: HTMLElement[] = [];
    for (const propriete of contenu) {
      const nom = valeur(propriete.Name);
      if (nom === undefined) continue;
      const cleValeur = Object.keys(propriete).find(
        (k) => !k.startsWith("_") && k !== "Name" && /Value$/.test(k),
      );
      const v = cleValeur ? valeur(propriete[cleValeur]) : undefined;
      if (v === undefined || v === null || v === "") continue;
      lignes.push(ligne(String(nom), formaterValeur(v)));
    }
    if (lignes.length === 0) continue;
    ficheCorps.append(groupe(String(valeur(jeu.Name) ?? "Propriétés"), lignes));
    nbJeux += 1;
  }

  if (nbJeux === 0) {
    const vide = document.createElement("div");
    vide.className = "vide";
    vide.textContent = "Aucun jeu de propriétés renseigné pour cet élément.";
    ficheCorps.append(vide);
  }

  ficheCorps.scrollTop = 0;
  fiche.classList.add("ouverte");
}

// --- Calques (une pastille par maquette chargée) --------------------------

function dessinerCalques() {
  calques.replaceChildren();
  if (fragments.list.size < 2) return;
  for (const [id, modele] of fragments.list) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "calque";
    bouton.textContent = id;
    bouton.classList.toggle("masque", !modele.object.visible);
    bouton.addEventListener("click", () => {
      modele.object.visible = !modele.object.visible;
      bouton.classList.toggle("masque", !modele.object.visible);
      void surligneur.clear("select");
      fermerFiche();
      fragments.core.update(true);
    });
    calques.append(bouton);
  }
}

// --- Chargement -------------------------------------------------------------

async function vider() {
  await surligneur.clear("select");
  fermerFiche();
  for (const id of [...fragments.list.keys()]) {
    await fragments.core.disposeModel(id);
  }
}

async function recadrer() {
  await fragments.core.update(true);
  // Sur l'exemple, on cadre le bâtiment plutôt que le terrain autour.
  const batiment = fragments.list.get("Structure");
  const visible = [...fragments.list.values()].some((m) => m.object.visible);
  if (batiment && batiment.object.visible && fragments.list.size > 1) {
    const sphere = batiment.box.getBoundingSphere(new THREE.Sphere());
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
  if (visible) await monde.camera.fitToItems();
}

async function chargerExemple() {
  try {
    attente("Chargement de la maquette d'exemple…", 0.1);
    await vider();
    let fait = 0;
    await Promise.all(
      MODELES_EXEMPLE.map(async ({ id, fichier }) => {
        const reponse = await fetch(new URL(fichier, document.baseURI));
        if (!reponse.ok) throw new Error(`Fichier introuvable : ${fichier}`);
        const tampon = await reponse.arrayBuffer();
        await fragments.core.load(tampon, { modelId: id });
        fait += 1;
        attente("Chargement de la maquette d'exemple…", fait / MODELES_EXEMPLE.length);
      }),
    );
    nomMaquette.textContent = "École (exemple)";
    await recadrer();
    attente(null);
  } catch (erreur) {
    console.error(erreur);
    attente(null);
    alerte("La maquette d'exemple n'a pas pu être chargée.");
  }
}

async function chargerIfc(fichier: File) {
  if (!/\.ifc$/i.test(fichier.name)) {
    alerte("Ce fichier n'est pas un IFC. Depuis Revit : Fichier → Exporter → IFC.");
    return;
  }
  try {
    attente("Lecture du fichier…", 0.02);
    await preparerChargeurIfc();
    const tampon = new Uint8Array(await fichier.arrayBuffer());
    await vider();
    const nom = fichier.name.replace(/\.ifc$/i, "");
    await chargeurIfc.load(tampon, true, nom, {
      processData: {
        progressCallback: (avancement: number) => attente("Conversion de la maquette…", avancement),
      },
    });
    nomMaquette.textContent = nom;
    await recadrer();
    attente(null);
  } catch (erreur) {
    console.error(erreur);
    attente(null);
    alerte("Ce fichier IFC n'a pas pu être lu. Vérifiez qu'il n'est pas corrompu.");
  }
}

let minuterieAlerte: number | undefined;
function alerte(texte: string) {
  aide.textContent = texte;
  aide.classList.remove("cache");
  window.clearTimeout(minuterieAlerte);
  minuterieAlerte = window.setTimeout(() => aide.classList.add("cache"), 6000);
}

// --- Commandes ---------------------------------------------------------------

el("btn-ouvrir").addEventListener("click", () => champFichier.click());
el("btn-exemple").addEventListener("click", () => void chargerExemple());
el("btn-recadrer").addEventListener("click", () => void recadrer());

champFichier.addEventListener("change", () => {
  const fichier = champFichier.files?.[0];
  champFichier.value = "";
  if (fichier) void chargerIfc(fichier);
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  depot.classList.add("actif");
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) depot.classList.remove("actif");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depot.classList.remove("actif");
  const fichier = e.dataTransfer?.files?.[0];
  if (fichier) void chargerIfc(fichier);
});

window.setTimeout(() => aide.classList.add("cache"), 9000);

void chargerExemple();

if (import.meta.env.DEV) {
  (window as any).__visio = { surligneur, fragments, monde };
}
