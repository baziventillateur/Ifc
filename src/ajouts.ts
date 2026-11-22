// Objets ajoutés (outil « Objets ») : une bibliothèque des objets déjà présents dans les
// maquettes du projet (portes, mobilier, sanitaires, luminaires, murs…), qu'on pose où
// l'on veut, qu'on tourne, déplace et redimensionne (cotes en mètres, échelle 1 au départ).
// « Copier » dans la fiche d'un élément fait la même chose depuis cet élément.
//
// Les ajouts forment une couche à part (« maquette » des ajouts) : les maquettes d'origine
// ne sont jamais touchées. Un ajout garde l'identifiant IFC de son modèle, sa position,
// son orientation et ses cotes ; il est enregistré dans le projet (table « ajouts »).
import * as THREE from "three";
import { jouerBruitage } from "./sons";
import { alerte, bouton, brancherProche, cree, el, monde, rafraichir } from "./noyau";
import { changement, maquettes, visibles, type Maquette } from "./registre";
import { definirModeClic, modeClicActif, selectionChangee, viser } from "./fiche";
import { enregistrerOutil, marquerOutil, ouvrirOutil, outilActif } from "./outils/panneau";
import { indexDeTout } from "./index-elements";
import { libelleCategorie } from "./libelles";
import { nuage } from "./nuage/client";
import { projetCharge } from "./nuage/projets";
import { noter } from "./historique";

// --- Données ----------------------------------------------------------------------------

type Donnees = {
  guid: string;
  /** Maquette d'où vient le modèle (repère pour le retrouver). */
  maquette: string;
  nom: string;
  cat: string;
  /** Position du pied de l'objet (scène, m), orientation (rad), échelle (x, y, z). */
  p: [number, number, number];
  rot: number;
  echelle: [number, number, number];
};
type Ajout = Donnees & { id: string; groupe: THREE.Group | null };

const ajouts = new Map<string, Ajout>();
let projet: string | null = null;
let affiches = true;
let choisi: string | null = null;

const racine = new THREE.Group();
racine.name = "objets-ajoutes";
monde.scene.three.add(racine);

// --- Modèles (gabarits) : la géométrie d'un élément, posée sur son pied -------------------

type Gabarit = { mailles: THREE.BufferGeometry[]; materiau: THREE.MeshLambertMaterial; taille: THREE.Vector3 };
const gabarits = new Map<string, Promise<Gabarit | null>>();

async function trouver(guid: string, indice?: string): Promise<{ m: Maquette; id: number } | null> {
  const liste = [...maquettes.values()].sort((a, b) => (a.id === indice ? -1 : b.id === indice ? 1 : 0));
  for (const m of liste) {
    const [id] = await m.modele.getLocalIdsByGuids([guid]).catch(() => [null]);
    if (id !== null && id !== undefined) return { m, id };
  }
  return null;
}

function gabaritDe(guid: string, indice?: string) {
  let p = gabarits.get(guid);
  if (!p) {
    p = (async () => {
      const t = await trouver(guid, indice);
      if (!t) return null;
      const { m, id } = t;
      m.modele.object.updateMatrixWorld(true);
      const [geos, defs] = await Promise.all([
        m.modele.getItemsGeometry([id]),
        m.modele.getItemsMaterialDefinition([id]).catch(() => []),
      ]);
      const mailles: THREE.BufferGeometry[] = [];
      const boite = new THREE.Box3();
      for (const md of geos[0] ?? []) {
        if (!md.positions || !md.indices || md.positions.length < 9) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(md.positions), 3));
        g.setIndex(new THREE.BufferAttribute(Uint32Array.from(md.indices), 1));
        g.applyMatrix4(m.modele.object.matrixWorld.clone().multiply(md.transform));
        g.computeBoundingBox();
        boite.union(g.boundingBox!);
        mailles.push(g);
      }
      if (!mailles.length) return null;
      // Le pied de l'objet (milieu du bas) devient l'origine.
      const pied = new THREE.Vector3((boite.min.x + boite.max.x) / 2, boite.min.y, (boite.min.z + boite.max.z) / 2);
      for (const g of mailles) {
        g.translate(-pied.x, -pied.y, -pied.z);
        g.computeVertexNormals();
      }
      const c = defs[0]?.definition.color as unknown as { r: number; g: number; b: number } | undefined;
      const materiau = new THREE.MeshLambertMaterial({
        color: c ? new THREE.Color(c.r, c.g, c.b) : new THREE.Color("#c9ced6"),
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const op = defs[0]?.definition.transparent ? (defs[0].definition.opacity ?? 1) : 1;
      if (op < 1) Object.assign(materiau, { transparent: true, opacity: op, depthWrite: false });
      brancherProche(materiau);
      return { mailles, materiau, taille: boite.getSize(new THREE.Vector3()) };
    })();
    gabarits.set(guid, p);
    p.catch(() => gabarits.delete(guid));
  }
  return p;
}

// --- Dessin --------------------------------------------------------------------------------

const matCadre = new THREE.LineBasicMaterial({ color: 0xff8a1f, depthTest: false, transparent: true });

async function dessiner(a: Ajout) {
  const g = await gabaritDe(a.guid, a.maquette);
  if (!g || !ajouts.has(a.id)) return;
  if (!a.groupe) {
    a.groupe = new THREE.Group();
    for (const geo of g.mailles) {
      const maille = new THREE.Mesh(geo, g.materiau);
      maille.userData.ajout = a.id;
      a.groupe.add(maille);
    }
    // Cadre orange, montré quand l'objet est choisi.
    const boite = new THREE.BoxGeometry(g.taille.x, g.taille.y, g.taille.z).translate(0, g.taille.y / 2, 0);
    const cadre = new THREE.LineSegments(new THREE.EdgesGeometry(boite), matCadre);
    cadre.name = "cadre";
    cadre.renderOrder = 999;
    cadre.visible = false;
    a.groupe.add(cadre);
    a.groupe.userData.ajout = a.id;
    racine.add(a.groupe);
  }
  a.groupe.position.fromArray(a.p);
  a.groupe.rotation.set(0, a.rot, 0);
  a.groupe.scale.fromArray(a.echelle);
  const cadre = a.groupe.getObjectByName("cadre");
  if (cadre) cadre.visible = a.id === choisi;
  void rafraichir();
}

function oublier(a: Ajout) {
  if (a.groupe) {
    racine.remove(a.groupe);
    a.groupe.getObjectByName("cadre")?.traverse((o) => (o as THREE.LineSegments).geometry?.dispose());
  }
  a.groupe = null;
}

// Coupes et visibilité, comme les maquettes.
monde.renderer!.onBeforeUpdate.add(() => {
  racine.visible = affiches && visibles().length > 0;
  if (!racine.children.length) return;
  const plans = monde.renderer!.clippingPlanes;
  racine.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m && m !== matCadre && m.clippingPlanes !== plans) m.clippingPlanes = plans;
  });
});
// Une maquette arrive : les ajouts qui l'attendaient s'affichent.
changement.on(() => {
  for (const a of ajouts.values()) if (!a.groupe) void dessiner(a);
});

// --- Enregistrement dans le projet --------------------------------------------------------

const donnees = (a: Ajout): Donnees => ({
  guid: a.guid,
  maquette: a.maquette,
  nom: a.nom,
  cat: a.cat,
  p: a.p.map((v) => Math.round(v * 1000) / 1000) as Donnees["p"],
  rot: Math.round(a.rot * 10000) / 10000,
  echelle: a.echelle.map((v) => Math.round(v * 1000) / 1000) as Donnees["echelle"],
});

async function sauver(a: Ajout) {
  if (!projet) return;
  const { error } = await nuage
    .from("ajouts")
    .upsert({ id: a.id, projet_id: projet, donnees: donnees(a), maj_le: new Date().toISOString() });
  if (error) {
    console.warn("ajouts", error.message);
    alerte("L'objet n'a pas pu être enregistré dans le projet.", 4000);
  }
}
async function supprimerEnBase(id: string) {
  if (!projet) return;
  const { error } = await nuage.from("ajouts").delete().eq("id", id);
  if (error) console.warn("ajouts", error.message);
}

projetCharge.on((id) => void charger(id));
async function charger(id: string | null) {
  projet = id;
  choisir(null);
  for (const a of ajouts.values()) oublier(a);
  ajouts.clear();
  majCompte();
  if (!id) return;
  const { data, error } = await nuage.from("ajouts").select("id, donnees").eq("projet_id", id).limit(2000);
  if (error || projet !== id) return;
  for (const r of (data ?? []) as { id: string; donnees: Donnees }[]) {
    const a: Ajout = { ...r.donnees, id: r.id, groupe: null };
    ajouts.set(a.id, a);
    void dessiner(a);
  }
  majCompte();
}

// --- Actions (avec annuler / rétablir) ------------------------------------------------------

function appliquer(id: string, d: Donnees | null) {
  const a = ajouts.get(id);
  if (!d) {
    if (a) {
      oublier(a);
      ajouts.delete(id);
      if (choisi === id) choisir(null);
      void supprimerEnBase(id);
    }
  } else if (a) {
    Object.assign(a, d);
    void dessiner(a);
    void sauver(a);
  } else {
    const nouveau: Ajout = { ...d, id, groupe: null };
    ajouts.set(id, nouveau);
    void dessiner(nouveau);
    void sauver(nouveau);
  }
  majCompte();
  majPanneau();
}

function changer(id: string, apres: Donnees | null, libelle: string, cle?: string) {
  const a = ajouts.get(id);
  const avant = a ? donnees(a) : null;
  appliquer(id, apres);
  noter({ libelle, cle, annuler: async () => appliquer(id, avant), refaire: async () => appliquer(id, apres) });
}

function modifier(id: string, f: (d: Donnees) => void, libelle: string, cle?: string) {
  const a = ajouts.get(id);
  if (!a) return;
  const d = donnees(a);
  f(d);
  changer(id, d, libelle, cle);
}

// --- Bibliothèque des objets du projet -------------------------------------------------------

const CATEGORIES =
  /^IFC(DOOR|WINDOW|FURNISHINGELEMENT|FURNITURE|SYSTEMFURNITUREELEMENT|SANITARYTERMINAL|LIGHTFIXTURE|LAMP|FLOWTERMINAL|AIRTERMINAL|ELECTRICAPPLIANCE|OUTLET|SWITCHINGDEVICE|BUILDINGELEMENTPROXY|COLUMN|STAIR|STAIRFLIGHT|RAILING|TRANSPORTELEMENT|FIRESUPPRESSIONTERMINAL|WASTETERMINAL|SPACEHEATER|UNITARYEQUIPMENT|WALL|WALLSTANDARDCASE|CURTAINWALL|PLATE|MEMBER|BEAM|SLAB|COVERING|ROOF)$/;
/** Un modèle de la bibliothèque : un type d'objet du projet, avec un exemple. */
type Modele = { cle: string; nom: string; cat: string; nombre: number; m: Maquette; id: number };

/** Nom lisible : sans les numéros d'identifiant ajoutés par les logiciels (« :123456 »). */
const nomPropre = (s: string) => s.replace(/:\d{4,}$/, "").replace(/\s+/g, " ").trim();

async function lireBibliotheque(progression: (t: string) => void): Promise<Modele[]> {
  const liste = visibles();
  const index = await indexDeTout(liste, (a, nom) => progression(`Lecture des objets… ${Math.round(a * 100)} % (${nom})`));
  const modeles = new Map<string, Modele>();
  index.forEach(({ m, idx }) => {
    for (const e of idx.elements.values()) {
      if (!CATEGORIES.test(e.cat)) continue;
      const nom = nomPropre(e.type || e.nom || libelleCategorie(e.cat));
      const cle = `${e.cat}|${nom.toLowerCase()}`;
      const deja = modeles.get(cle);
      if (deja) deja.nombre += 1;
      else modeles.set(cle, { cle, nom, cat: e.cat, nombre: 1, m, id: e.id });
    }
  });
  return [...modeles.values()].sort((a, b) => b.nombre - a.nombre);
}

// --- Poser, déplacer ------------------------------------------------------------------------

type Pose = { nom: string; cat: string; guid: string; maquette: string };
let pose: Pose | null = null;
let deplace: string | null = null;
let fantome: THREE.Group | null = null;
let angleFantome = 0;

async function source(m: Maquette, id: number, nom: string, cat: string): Promise<Pose | null> {
  const [guid] = await m.modele.getGuidsByLocalIds([id]).catch(() => [null]);
  return guid ? { guid, maquette: m.id, nom, cat } : null;
}

async function commencerPose(p: Pose) {
  terminerModes();
  pose = p;
  angleFantome = 0;
  const g = await gabaritDe(p.guid, p.maquette);
  if (!g || pose !== p) {
    if (!g) alerte("Cet objet n'a pas de géométrie à copier.", 3500);
    pose = null;
    majPanneau();
    return;
  }
  // Aperçu orange qui suit la souris (ordinateur).
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.45, depthWrite: false });
  fantome = new THREE.Group();
  for (const geo of g.mailles) fantome.add(new THREE.Mesh(geo, mat));
  fantome.visible = false;
  racine.add(fantome);
  definirModeClic((e) => void poserIci(e), "copy");
  majPanneau();
}

async function poserIci(e: PointerEvent) {
  const p = pose;
  if (!p) return;
  const v = await viser(e);
  if (!v) return alerte("Touchez une surface de la maquette (sol, dalle…).", 2500);
  const id = crypto.randomUUID();
  changer(id, { ...p, p: v.point.toArray() as Donnees["p"], rot: angleFantome, echelle: [1, 1, 1] }, `pose de « ${p.nom} »`);
  jouerBruitage("pose");
  terminerModes();
  choisir(id);
}

function commencerDeplacement(id: string) {
  terminerModes();
  deplace = id;
  definirModeClic(async (e) => {
    const v = await viser(e);
    const cible = deplace;
    if (!v || !cible) return;
    terminerModes();
    jouerBruitage("pose");
    modifier(cible, (d) => (d.p = v.point.toArray() as Donnees["p"]), "déplacement d'un objet");
  }, "move");
  majPanneau();
}

function terminerModes() {
  if (pose || deplace) definirModeClic(null);
  pose = null;
  deplace = null;
  if (fantome) {
    racine.remove(fantome);
    (fantome.children[0] as THREE.Mesh | undefined)?.material && ((fantome.children[0] as THREE.Mesh).material as THREE.Material).dispose();
    fantome = null;
  }
  majPanneau();
}

const toile = monde.renderer!.three.domElement;
let derniereVisee = 0;
toile.addEventListener("pointermove", (e) => {
  if (!pose || !fantome || e.pointerType !== "mouse") return;
  const t = performance.now();
  if (t - derniereVisee < 70) return;
  derniereVisee = t;
  void viser(e).then((v) => {
    if (!fantome) return;
    fantome.visible = !!v;
    if (v) {
      fantome.position.copy(v.point);
      fantome.rotation.set(0, angleFantome, 0);
      void rafraichir();
    }
  });
});

// --- Choisir un objet ajouté (toucher dans la vue) -------------------------------------------

function ajoutSous(x: number, y: number): string | null {
  if (!affiches || !racine.children.length) return null;
  const r = toile.getBoundingClientRect();
  const rayon = new THREE.Raycaster();
  monde.camera.three.updateMatrixWorld();
  rayon.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), monde.camera.three);
  racine.updateMatrixWorld(true);
  const cibles = [...ajouts.values()].map((a) => a.groupe).filter((g): g is THREE.Group => !!g);
  const touche = rayon.intersectObjects(cibles, true).find((i) => i.object.type === "Mesh");
  return (touche?.object.userData.ajout as string | undefined) ?? null;
}
let appui: { id: string; x: number; y: number } | null = null;
toile.addEventListener(
  "pointerdown",
  (e) => {
    appui = null;
    if (modeClicActif() || e.button > 0) return;
    const id = ajoutSous(e.clientX, e.clientY);
    if (!id) return;
    appui = { id, x: e.clientX, y: e.clientY };
    // Ni la caméra ni la fiche ne prennent ce toucher.
    e.stopImmediatePropagation();
    e.preventDefault();
  },
  { capture: true },
);
toile.addEventListener(
  "pointerup",
  (e) => {
    const a = appui;
    appui = null;
    if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > 10) return;
    choisir(a.id === choisi ? null : a.id);
    if (choisi && outilActif() !== "objets") ouvrirOutil("objets");
  },
  { capture: true },
);

function choisir(id: string | null) {
  choisi = id;
  for (const a of ajouts.values()) {
    const cadre = a.groupe?.getObjectByName("cadre");
    if (cadre) cadre.visible = a.id === id;
  }
  majPanneau();
  void rafraichir();
}

// Clavier : R tourne l'objet à poser ou choisi, Suppr l'efface, Échap arrête.
window.addEventListener("keydown", (e) => {
  const cible = e.target as HTMLElement | null;
  if (cible?.closest?.("input, textarea, select, [contenteditable]")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "KeyR" && (pose || choisi)) {
    e.preventDefault();
    tourner(e.shiftKey ? -15 : 15);
  } else if ((e.key === "Delete" || e.key === "Backspace") && choisi && !pose) {
    e.preventDefault();
    supprimer(choisi);
  } else if (e.key === "Escape" && (pose || deplace)) {
    e.stopImmediatePropagation();
    terminerModes();
  }
});

function tourner(degres: number) {
  const r = THREE.MathUtils.degToRad(degres);
  if (pose) {
    angleFantome += r;
    if (fantome) fantome.rotation.set(0, angleFantome, 0);
    void rafraichir();
    return;
  }
  if (choisi) modifier(choisi, (d) => (d.rot += r), "rotation d'un objet", `rot-${choisi}`);
}

function supprimer(id: string) {
  const a = ajouts.get(id);
  if (!a) return;
  jouerBruitage("suppression");
  changer(id, null, `suppression de « ${a.nom} »`);
}

function dupliquer(id: string) {
  const a = ajouts.get(id);
  if (!a) return;
  const d = donnees(a);
  // À côté de l'original, dans son axe.
  const pas = 0.3 + (gabaritTaille(a)?.x ?? 1) * a.echelle[0];
  d.p = [d.p[0] + Math.cos(a.rot) * pas, d.p[1], d.p[2] - Math.sin(a.rot) * pas];
  const nouveau = crypto.randomUUID();
  changer(nouveau, d, `copie de « ${a.nom} »`);
  choisir(nouveau);
}

const tailles = new Map<string, THREE.Vector3>();
function gabaritTaille(a: Ajout) {
  return tailles.get(a.guid) ?? null;
}

// --- Panneau de l'outil ---------------------------------------------------------------------

let panneau: HTMLElement | null = null;
let zoneChoisi: HTMLElement | null = null;
let zoneMode: HTMLElement | null = null;
let zoneListe: HTMLElement | null = null;
let recherche: HTMLInputElement | null = null;
let bibliotheque: Modele[] | null = null;
let lecture: Promise<void> | null = null;
let ouverts = new Set<string>();

function majCompte() {
  marquerOutil("objets", ajouts.size ? String(ajouts.size) : false);
  const c = panneau?.querySelector<HTMLElement>(".objets-compte");
  if (c) c.textContent = ajouts.size ? `Objets ajoutés (${ajouts.size})` : "Objets ajoutés";
}

const ICONE =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/><path d="M17 3.5v4M15 5.5h4"/></svg>';

enregistrerOutil(
  "objets",
  "Objets",
  "Objets : bibliothèque et ajouts",
  (section) => {
    panneau = section;
    const haut = cree("div", "objets-haut");
    const vis = cree("label", "objets-visibles");
    const caseVis = cree("input");
    caseVis.type = "checkbox";
    caseVis.checked = affiches;
    caseVis.addEventListener("change", () => {
      affiches = caseVis.checked;
      if (!affiches) choisir(null);
      void rafraichir();
    });
    vis.append(caseVis, cree("span", "objets-compte", "Objets ajoutés"));
    haut.append(vis);
    zoneMode = cree("div", "objets-mode");
    zoneChoisi = cree("div", "objets-choisi");
    recherche = cree("input", "objets-recherche");
    recherche.type = "search";
    recherche.placeholder = "Chercher un objet du projet (porte, WC, table…)";
    recherche.addEventListener("input", () => dessinerListe());
    zoneListe = cree("div", "objets-liste");
    section.append(haut, zoneMode, zoneChoisi, cree("div", "groupe-titre", "Bibliothèque du projet"), recherche, zoneListe);
    majCompte();
    majPanneau();
    return {
      ouvrir: () => {
        majPanneau();
        void chargerBibliotheque();
      },
      fermer: () => {
        terminerModes();
        choisir(null);
      },
    };
  },
  ICONE,
);

async function chargerBibliotheque(forcer = false) {
  if (!zoneListe) return;
  if (bibliotheque && !forcer) return dessinerListe();
  if (lecture) return lecture;
  zoneListe.replaceChildren(cree("p", "objets-note", visibles().length ? "Lecture des objets du projet…" : "Aucune maquette affichée."));
  if (!visibles().length) return;
  lecture = lireBibliotheque((t) => {
    const n = zoneListe?.querySelector(".objets-note");
    if (n) n.textContent = t;
  })
    .then((b) => {
      bibliotheque = b;
      dessinerListe();
    })
    .catch((e) => {
      console.warn("bibliothèque", e);
      zoneListe?.replaceChildren(cree("p", "objets-note", "Lecture des objets impossible."));
    })
    .finally(() => (lecture = null));
  return lecture;
}
changement.on(() => {
  bibliotheque = null;
  if (outilActif() === "objets") void chargerBibliotheque(true);
});

function dessinerListe() {
  if (!zoneListe || !bibliotheque) return;
  const q = (recherche?.value ?? "").trim().toLowerCase();
  const trouves = bibliotheque.filter(
    (m) => !q || m.nom.toLowerCase().includes(q) || libelleCategorie(m.cat).toLowerCase().includes(q),
  );
  zoneListe.replaceChildren();
  if (!trouves.length) {
    zoneListe.append(cree("p", "objets-note", q ? "Aucun objet ne correspond." : "Aucun objet dans les maquettes affichées."));
    return;
  }
  const parCat = new Map<string, Modele[]>();
  for (const m of trouves) {
    const l = libelleCategorie(m.cat);
    parCat.set(l, [...(parCat.get(l) ?? []), m]);
  }
  for (const [cat, liste] of [...parCat].sort((a, b) => b[1].length - a[1].length)) {
    const groupe = cree("div", "objets-groupe");
    groupe.append(cree("div", "objets-cat", `${cat} · ${liste.length}`));
    const tout = ouverts.has(cat) || !!q;
    for (const m of tout ? liste : liste.slice(0, 5)) {
      const b = bouton("objets-item", "", () => void choisirModele(m), `Poser « ${m.nom} »`);
      b.append(cree("span", "objets-item-nom", m.nom), cree("span", "objets-item-nb", `×${m.nombre}`));
      groupe.append(b);
    }
    if (!tout && liste.length > 5) {
      groupe.append(
        bouton("lien objets-tout", `Tout voir (${liste.length - 5} de plus)`, () => {
          ouverts.add(cat);
          dessinerListe();
        }),
      );
    }
    zoneListe.append(groupe);
  }
}

async function choisirModele(m: Modele) {
  const p = await source(m.m, m.id, m.nom, m.cat);
  if (p) await commencerPose(p);
}

function champCote(libelle: string, valeur: number, change: (v: number) => void) {
  const l = cree("label", "objets-cote");
  const i = cree("input");
  i.type = "number";
  i.step = "0.01";
  i.min = "0.01";
  i.value = valeur.toFixed(2);
  i.addEventListener("change", () => {
    const v = Number(i.value.replace(",", "."));
    if (v > 0) change(v);
  });
  i.setAttribute("aria-label", `${libelle} en mètres`);
  l.append(cree("span", "", libelle), i);
  return l;
}

function majPanneau() {
  if (!zoneMode || !zoneChoisi) return;
  zoneMode.replaceChildren();
  if (pose) {
    zoneMode.append(
      cree("p", "objets-consigne", `Touchez la maquette pour poser « ${pose.nom} ».`),
      bouton("visite-puce", "⟲ 15°", () => tourner(-15), "Tourner (Maj + R)"),
      bouton("visite-puce", "⟳ 15°", () => tourner(15), "Tourner (R)"),
      bouton("visite-puce", "Annuler", () => terminerModes()),
    );
  } else if (deplace) {
    zoneMode.append(cree("p", "objets-consigne", "Touchez le nouvel endroit."), bouton("visite-puce", "Annuler", () => terminerModes()));
  }
  zoneChoisi.replaceChildren();
  const a = choisi ? ajouts.get(choisi) : undefined;
  if (!a || pose) return;
  void gabaritDe(a.guid, a.maquette).then((g) => {
    if (!g || choisi !== a.id || !zoneChoisi) return;
    tailles.set(a.guid, g.taille);
    const cotes = [g.taille.x * a.echelle[0], g.taille.z * a.echelle[2], g.taille.y * a.echelle[1]];
    const garder = cree("label", "objets-garder");
    const caseGarder = cree("input");
    caseGarder.type = "checkbox";
    caseGarder.checked = false;
    garder.append(caseGarder, cree("span", "", "Garder les proportions"));
    const coter = (axe: 0 | 1 | 2, v: number) => {
      // axe : 0 largeur (x), 1 profondeur (z), 2 hauteur (y).
      const base = [g.taille.x, g.taille.z, g.taille.y][axe] || 1;
      const k = v / base;
      modifier(a.id, (d) => {
        if (caseGarder.checked) d.echelle = [k, k, k];
        else if (axe === 0) d.echelle[0] = k;
        else if (axe === 1) d.echelle[2] = k;
        else d.echelle[1] = k;
      }, "cotes d'un objet");
    };
    const ligneCotes = cree("div", "objets-cotes");
    ligneCotes.append(
      champCote("L", cotes[0], (v) => coter(0, v)),
      champCote("P", cotes[1], (v) => coter(1, v)),
      champCote("H", cotes[2], (v) => coter(2, v)),
    );
    const echelle = (k: number) =>
      modifier(a.id, (d) => (d.echelle = d.echelle.map((v) => v * k) as Donnees["echelle"]), "taille d'un objet", `e-${a.id}`);
    const actions = cree("div", "objets-actions");
    actions.append(
      bouton("visite-puce", "⟲ 15°", () => tourner(-15), "Tourner (Maj + R)"),
      bouton("visite-puce", "⟳ 15°", () => tourner(15), "Tourner (R)"),
      bouton("visite-puce", "↑ 5 cm", () => modifier(a.id, (d) => (d.p[1] += 0.05), "hauteur d'un objet", `h-${a.id}`)),
      bouton("visite-puce", "↓ 5 cm", () => modifier(a.id, (d) => (d.p[1] -= 0.05), "hauteur d'un objet", `h-${a.id}`)),
      bouton("visite-puce", "Déplacer", () => commencerDeplacement(a.id), "Touchez ensuite le nouvel endroit"),
      bouton("visite-puce", "Dupliquer", () => dupliquer(a.id)),
      bouton("visite-puce danger", "Supprimer", () => supprimer(a.id), "Supprimer (Suppr)"),
    );
    const tailleBtns = cree("div", "objets-actions");
    tailleBtns.append(
      cree("span", "objets-garder", "Cotes en m (largeur, profondeur, hauteur)"),
      bouton("visite-puce", "− 10 %", () => echelle(1 / 1.1), "Réduire l'objet"),
      bouton("visite-puce", "+ 10 %", () => echelle(1.1), "Agrandir l'objet"),
    );
    zoneChoisi.append(cree("div", "objets-choisi-nom", a.nom), ligneCotes, tailleBtns, garder, actions);
  });
}

// --- « Copier » dans la fiche d'un élément ---------------------------------------------------

const btnCopier = bouton("fiche-copier", "Copier", () => void copierCourant(), "Copier cet élément et le poser ailleurs (outil Objets)");
btnCopier.hidden = true;
el("fiche-entete").insertBefore(btnCopier, el("fiche-fermer"));
let courant: { modele: string; id: number } | null = null;
selectionChangee.on((c) => {
  courant = c;
  btnCopier.hidden = !c;
});
async function copierCourant() {
  const c = courant;
  const m = c && maquettes.get(c.modele);
  if (!c || !m) return;
  const { indexDe } = await import("./index-elements");
  const e = await indexDe(m)
    .then((ix) => ix.elements.get(c.id))
    .catch(() => undefined);
  const nom = nomPropre(e?.type || e?.nom || "Élément copié");
  const p = await source(m, c.id, nom, e?.cat ?? "");
  if (!p) return alerte("Cet élément ne peut pas être copié (pas d'identifiant IFC).", 3500);
  ouvrirOutil("objets");
  await commencerPose(p);
}
