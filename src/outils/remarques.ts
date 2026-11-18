// Remarques posées sur la maquette, au format BCF 2.1 (lu par Revit, BIMcollab,
// Navisworks, Solibri…). Gardées sur l'appareil ; partagées par fichier .bcf.
import * as THREE from "three";
import JSZip from "jszip";
import {
  alerte,
  bouton,
  cree,
  dateCourte,
  depuisIfc,
  directionDepuisIfc,
  directionVersIfc,
  monde,
  recentrerPivot,
  telecharger,
  versIfc,
} from "../noyau";
import { maquettes } from "../registre";
import { boiteDe, definirCouche, retirerCouche, STYLES, type Ids } from "../apparence";
import { demandeRemarque, type DemandeRemarque } from "../evenements";
import { effacer, ecrire, lireTout } from "../stockage";
import { enregistrerOutil, marquerOutil, ouvrirOutil } from "./panneau";
import { note, puces } from "./ui";

type Type = "Remarque" | "Clash" | "Question";
type Statut = "Ouverte" | "Résolue";
type Vec = [number, number, number];

export type Remarque = {
  guid: string;
  titre: string;
  description: string;
  type: Type;
  statut: Statut;
  auteur: string;
  date: string;
  elements: { ifcGuid: string; modele?: string }[];
  /** Point de vue en coordonnées IFC (Z vers le haut). */
  vue: { position: Vec; direction: Vec; haut: Vec; distance?: number; fov: number } | null;
  vignette?: string;
};

const remarques = new Map<string, Remarque>();

const guid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

// --- Point de vue -----------------------------------------------------------------

function vueActuelle(): Remarque["vue"] {
  if (!maquettes.size) return null;
  const cam = monde.camera.three as THREE.PerspectiveCamera;
  const position = cam.position.clone();
  const cible = monde.camera.controls.getTarget(new THREE.Vector3());
  const dir = cible.clone().sub(position);
  const distance = dir.length();
  return {
    position: versIfc(position),
    direction: directionVersIfc(dir.normalize()),
    haut: [0, 0, 1],
    distance,
    fov: cam.fov ?? 60,
  };
}

function vignette(): string | undefined {
  try {
    const rendu = monde.renderer!.three;
    rendu.render(monde.scene.three, monde.camera.three);
    const source = rendu.domElement;
    const largeur = 480;
    const c = cree("canvas");
    c.width = largeur;
    c.height = Math.round((source.height / source.width) * largeur);
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

async function guidsVersIds(elements: Remarque["elements"]): Promise<Ids> {
  const ids: Ids = new Map();
  const guids = elements.map((e) => e.ifcGuid);
  if (!guids.length) return ids;
  for (const m of maquettes.values()) {
    const locaux = await m.modele.getLocalIdsByGuids(guids);
    const s = new Set(locaux.filter((x): x is number => x !== null));
    if (s.size) ids.set(m.id, s);
  }
  return ids;
}

async function allerA(r: Remarque) {
  const ids = await guidsVersIds(r.elements);
  await definirCouche("remarque", STYLES.remarque, ids.size ? ids : null);
  if (r.vue) {
    const p = depuisIfc(...r.vue.position);
    const d = directionDepuisIfc(...r.vue.direction).normalize();
    let distance = r.vue.distance ?? 15;
    if (!r.vue.distance && ids.size) {
      const b = await boiteDe(ids);
      if (!b.isEmpty()) distance = Math.max(2, p.distanceTo(b.getCenter(new THREE.Vector3())));
    }
    const c = p.clone().addScaledVector(d, distance);
    recentrerPivot();
    await monde.camera.controls.setLookAt(p.x, p.y, p.z, c.x, c.y, c.z, true);
  } else if (ids.size) {
    const b = await boiteDe(ids);
    if (!b.isEmpty()) {
      const s = b.getBoundingSphere(new THREE.Sphere());
      recentrerPivot();
      await monde.camera.controls.fitToSphere(s, true);
    }
  }
}

// --- BCF ---------------------------------------------------------------------------

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xyz = (nom: string, v: Vec) =>
  `<${nom}><X>${v[0]}</X><Y>${v[1]}</Y><Z>${v[2]}</Z></${nom}>`;

async function exporterBcf(liste: Remarque[]) {
  const zip = new JSZip();
  zip.file(
    "bcf.version",
    `<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>`,
  );
  for (const r of liste) {
    const dossier = zip.folder(r.guid)!;
    const vp = guid();
    const aVignette = !!r.vignette;
    dossier.file(
      "markup.bcf",
      `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="${r.guid}" TopicType="${xml(r.type)}" TopicStatus="${r.statut === "Résolue" ? "Closed" : "Open"}">
    <Title>${xml(r.titre)}</Title>
    <CreationDate>${r.date}</CreationDate>
    <CreationAuthor>${xml(r.auteur || "Visionneuse IFC")}</CreationAuthor>
    <Description>${xml(r.description)}</Description>
  </Topic>
  <Viewpoints Guid="${vp}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>${aVignette ? "\n    <Snapshot>snapshot.png</Snapshot>" : ""}
  </Viewpoints>
</Markup>`,
    );
    const selection = r.elements.map((e) => `<Component IfcGuid="${xml(e.ifcGuid)}"/>`).join("");
    const camera = r.vue
      ? `<PerspectiveCamera>${xyz("CameraViewPoint", r.vue.position)}${xyz("CameraDirection", r.vue.direction)}${xyz(
          "CameraUpVector",
          r.vue.haut,
        )}<FieldOfView>${r.vue.fov}</FieldOfView></PerspectiveCamera>`
      : "";
    dossier.file(
      "viewpoint.bcfv",
      `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${vp}"><Components>${selection ? `<Selection>${selection}</Selection>` : ""}<Visibility DefaultVisibility="true"/></Components>${camera}</VisualizationInfo>`,
    );
    if (r.vignette) dossier.file("snapshot.png", r.vignette.split(",")[1], { base64: true });
  }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/octet-stream" });
  telecharger(`remarques-${new Date().toISOString().slice(0, 10)}.bcf`, blob);
}

const texte = (n: Element | null | undefined, sel: string) => n?.querySelector(sel)?.textContent?.trim() ?? "";
const vecteur = (n: Element | null): Vec | null => {
  if (!n) return null;
  const v = ["X", "Y", "Z"].map((k) => Number(texte(n, k)));
  return v.every(Number.isFinite) ? (v as Vec) : null;
};

async function importerBcf(fichier: File) {
  const zip = await JSZip.loadAsync(await fichier.arrayBuffer());
  const lecteur = new DOMParser();
  let n = 0;
  for (const chemin of Object.keys(zip.files).filter((c) => /(^|\/)markup\.bcf$/i.test(c))) {
    const dossier = chemin.replace(/markup\.bcf$/i, "");
    const markup = lecteur.parseFromString(await zip.file(chemin)!.async("string"), "application/xml");
    const topic = markup.querySelector("Topic");
    if (!topic) continue;
    const vpNoeud = markup.querySelector("Viewpoints");
    const vpFichier = texte(vpNoeud, "Viewpoint") || "viewpoint.bcfv";
    const snapFichier = texte(vpNoeud, "Snapshot");
    let vue: Remarque["vue"] = null;
    let elements: Remarque["elements"] = [];
    const vpZip = zip.file(dossier + vpFichier);
    if (vpZip) {
      const vp = lecteur.parseFromString(await vpZip.async("string"), "application/xml");
      elements = [...vp.querySelectorAll("Selection Component")]
        .map((c) => c.getAttribute("IfcGuid") ?? "")
        .filter(Boolean)
        .map((g) => ({ ifcGuid: g }));
      const cam = vp.querySelector("PerspectiveCamera") ?? vp.querySelector("OrthogonalCamera");
      const position = vecteur(cam?.querySelector("CameraViewPoint") ?? null);
      const direction = vecteur(cam?.querySelector("CameraDirection") ?? null);
      const haut = vecteur(cam?.querySelector("CameraUpVector") ?? null) ?? [0, 0, 1];
      if (position && direction) vue = { position, direction, haut, fov: Number(texte(cam, "FieldOfView")) || 60 };
    }
    let image: string | undefined;
    const snapZip = snapFichier ? zip.file(dossier + snapFichier) : null;
    if (snapZip) image = `data:image/png;base64,${await snapZip.async("base64")}`;
    const statutBcf = (topic.getAttribute("TopicStatus") ?? "").toLowerCase();
    const typeBcf = (topic.getAttribute("TopicType") ?? "").toLowerCase();
    const r: Remarque = {
      guid: topic.getAttribute("Guid") ?? guid(),
      titre: texte(topic, "Title") || "Remarque importée",
      description: texte(topic, "Description"),
      type: typeBcf.includes("clash") ? "Clash" : typeBcf.includes("quest") ? "Question" : "Remarque",
      statut: /clos|closed|resol|résol|done|fermé/.test(statutBcf) ? "Résolue" : "Ouverte",
      auteur: texte(topic, "CreationAuthor"),
      date: texte(topic, "CreationDate") || new Date().toISOString(),
      elements,
      vue,
      vignette: image,
    };
    remarques.set(r.guid, r);
    await ecrire("remarques", r.guid, r);
    n += 1;
  }
  return n;
}

// --- Outil -------------------------------------------------------------------------

enregistrerOutil("remarques", "Remarques", "Remarques (BCF)", (section) => {
  let auteur = "";
  try {
    auteur = localStorage.getItem("visio-auteur") ?? "";
  } catch {
    auteur = "";
  }
  let filtre: "ouvertes" | "toutes" = "ouvertes";
  let enCours: { demande: DemandeRemarque; vue: Remarque["vue"]; vignette?: string; guids: Remarque["elements"] } | null =
    null;
  let ouverte: string | null = null;

  const ligneAuteur = cree("label", "rangee petit");
  const champAuteur = cree("input", "champ");
  champAuteur.placeholder = "Votre nom";
  champAuteur.value = auteur;
  champAuteur.addEventListener("change", () => {
    auteur = champAuteur.value.trim();
    try {
      localStorage.setItem("visio-auteur", auteur);
    } catch {
      // Pas de mémoire locale : le nom vaut pour la session.
    }
  });
  ligneAuteur.append(cree("span", "", "Auteur"), champAuteur);

  const nouvelle = bouton("btn principal large", "+ Nouvelle remarque sur cette vue", () =>
    void preparer({ elements: [] }),
  );
  const formulaire = cree("form", "formulaire");
  formulaire.hidden = true;

  const filtres = puces(
    [
      { valeur: "ouvertes", libelle: "Ouvertes" },
      { valeur: "toutes", libelle: "Toutes" },
    ],
    filtre,
    (v) => {
      filtre = v as typeof filtre;
      dessiner();
    },
  );
  const liste = cree("div", "liste");
  const champFichier = cree("input");
  champFichier.type = "file";
  champFichier.accept = ".bcf,.bcfzip";
  champFichier.hidden = true;
  champFichier.addEventListener("change", async () => {
    const f = champFichier.files?.[0];
    champFichier.value = "";
    if (!f) return;
    try {
      const n = await importerBcf(f);
      alerte(n ? `${n} remarque${n > 1 ? "s" : ""} importée${n > 1 ? "s" : ""}.` : "Aucune remarque dans ce fichier.");
    } catch (e) {
      console.error(e);
      alerte("Ce fichier BCF n'a pas pu être lu.");
    }
    dessiner();
  });
  const pied = cree("div", "puces");
  pied.append(
    bouton("puce", "Exporter BCF", () => {
      const l = [...remarques.values()].filter((r) => filtre === "toutes" || r.statut === "Ouverte");
      if (!l.length) return alerte("Aucune remarque à exporter.");
      void exporterBcf(l);
    }),
    bouton("puce", "Importer BCF", () => champFichier.click()),
    champFichier,
  );

  section.append(
    ligneAuteur,
    nouvelle,
    formulaire,
    filtres.racine,
    liste,
    pied,
    note("Le fichier .bcf s'ouvre dans Revit (BCF Manager), BIMcollab, Navisworks ou Solibri."),
  );

  async function preparer(d: DemandeRemarque) {
    ouvrirOutil("remarques");
    const guids: Remarque["elements"] = [];
    for (const e of d.elements) {
      const m = maquettes.get(e.modele);
      const [g] = (await m?.modele.getGuidsByLocalIds([e.id])) ?? [];
      if (g) guids.push({ ifcGuid: g, modele: e.modele });
    }
    enCours = { demande: d, vue: vueActuelle(), vignette: vignette(), guids };
    dessinerFormulaire();
  }

  function dessinerFormulaire() {
    formulaire.hidden = !enCours;
    nouvelle.hidden = !!enCours;
    if (!enCours) return;
    const d = enCours.demande;
    let type: Type = d.type ?? "Remarque";
    const titre = cree("input", "champ");
    titre.required = true;
    titre.placeholder = "Titre";
    titre.value = d.titre ?? "";
    const desc = cree("textarea", "champ");
    desc.rows = 3;
    desc.placeholder = "Description, solution proposée…";
    desc.value = d.description ?? "";
    const types = puces(
      (["Remarque", "Question", "Clash"] as Type[]).map((t) => ({ valeur: t, libelle: t })),
      type,
      (v) => (type = v as Type),
    );
    const apercu = cree("div", "apercu");
    if (enCours.vignette) {
      const img = cree("img");
      img.src = enCours.vignette;
      img.alt = "Vue enregistrée";
      apercu.append(img);
    }
    apercu.append(
      cree(
        "span",
        "petit",
        enCours.guids.length
          ? `${enCours.guids.length} élément${enCours.guids.length > 1 ? "s" : ""} lié${enCours.guids.length > 1 ? "s" : ""} · vue enregistrée`
          : "Vue enregistrée",
      ),
    );
    const enregistrer = cree("button", "btn principal", "Enregistrer");
    enregistrer.type = "submit";
    const actions = cree("div", "rangee");
    actions.append(
      enregistrer,
      bouton("btn", "Annuler", () => {
        enCours = null;
        dessinerFormulaire();
      }),
    );
    formulaire.replaceChildren(titre, desc, types.racine, apercu, actions);
    formulaire.onsubmit = async (e) => {
      e.preventDefault();
      if (!enCours || !titre.value.trim()) return;
      const r: Remarque = {
        guid: guid(),
        titre: titre.value.trim(),
        description: desc.value.trim(),
        type,
        statut: "Ouverte",
        auteur: champAuteur.value.trim(),
        date: new Date().toISOString(),
        elements: enCours.guids,
        vue: enCours.vue,
        vignette: enCours.vignette,
      };
      remarques.set(r.guid, r);
      await ecrire("remarques", r.guid, r);
      enCours = null;
      dessinerFormulaire();
      dessiner();
    };
    titre.focus();
  }

  function dessiner() {
    const toutes = [...remarques.values()].sort((a, b) => b.date.localeCompare(a.date));
    const ouvertes = toutes.filter((r) => r.statut === "Ouverte").length;
    marquerOutil("remarques", ouvertes ? String(ouvertes) : false);
    const l = toutes.filter((r) => filtre === "toutes" || r.statut === "Ouverte");
    if (!l.length) {
      liste.replaceChildren(note(filtre === "ouvertes" && toutes.length ? "Aucune remarque ouverte." : "Aucune remarque pour l'instant."));
      return;
    }
    liste.replaceChildren(
      ...l.map((r) => {
        const bloc = cree("div", "remarque" + (r.guid === ouverte ? " ouverte" : ""));
        const tete = cree("button", "resultat");
        tete.type = "button";
        if (r.vignette) {
          const img = cree("img", "vignette");
          img.src = r.vignette;
          img.alt = "";
          tete.append(img);
        }
        const t = cree("div", "resultat-texte");
        t.append(
          cree("strong", "", r.titre),
          cree("span", "petit", [r.type, r.auteur, dateCourte(r.date)].filter(Boolean).join(" · ")),
        );
        tete.append(t, cree("span", "statut " + (r.statut === "Ouverte" ? "a-traiter" : "resolu"), r.statut));
        tete.addEventListener("click", () => {
          ouverte = ouverte === r.guid ? null : r.guid;
          if (ouverte) void allerA(r);
          else void retirerCouche("remarque");
          dessiner();
        });
        bloc.append(tete);
        if (r.guid === ouverte) {
          if (r.description) bloc.append(cree("p", "description", r.description));
          const actions = cree("div", "puces");
          actions.append(
            bouton("puce", r.statut === "Ouverte" ? "Marquer résolue" : "Rouvrir", async () => {
              r.statut = r.statut === "Ouverte" ? "Résolue" : "Ouverte";
              await ecrire("remarques", r.guid, r);
              dessiner();
            }),
            bouton("puce", "Revoir la vue", () => void allerA(r)),
            bouton("puce danger", "Supprimer", async () => {
              if (!window.confirm(`Supprimer la remarque « ${r.titre} » ?`)) return;
              remarques.delete(r.guid);
              await effacer("remarques", r.guid);
              ouverte = null;
              void retirerCouche("remarque");
              dessiner();
            }),
          );
          bloc.append(actions);
        }
        return bloc;
      }),
    );
  }

  demandeRemarque.on((d) => void preparer(d));

  void lireTout<Remarque>("remarques").then((l) => {
    for (const r of l) remarques.set(r.guid, r);
    dessiner();
  });

  return {
    ouvrir: () => dessiner(),
    fermer: () => {
      ouverte = null;
      void retirerCouche("remarque");
    },
  };
});
