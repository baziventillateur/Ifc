// Captures d'écran annotées, rangées dans le projet.
// - Le bouton appareil photo prend la vue telle qu'elle est (arêtes, couleurs, coupe).
// - Une petite notification propose d'ajouter un message ou d'annoter ; sans réponse,
//   elle s'efface et la capture file dans l'onglet « Captures » (bord gauche).
// - Chaque capture a un message, un statut (à traiter / traité) et son point de vue :
//   « Voir dans la maquette » y ramène la caméra.
// - Photos de chantier (visite à la première personne, puce « Photo ») : une vraie photo,
//   rangée à l'endroit où l'on est avec la direction du regard et la focale. Une petite
//   icône d'appareil photo, orientée comme la prise de vue, la retrouve dans la maquette :
//   un toucher remet la caméra au même point de vue, photo superposée à la maquette.
// Enregistrées dans le projet (seau « captures » + table captures) : le créateur et les
// personnes invitées les retrouvent sur tous leurs appareils. Maquette d'essai : sur cet
// écran seulement.
import * as THREE from "three";
import { jouerBruitage } from "./sons";
import {
  ajusterDecalage,
  alerte,
  attente,
  bloquerDecalage,
  bouton,
  cree,
  dateCourte,
  definirProjection,
  demanderConfirmation,
  el,
  estOrtho,
  monde,
  rafraichir,
  recentrerPivot,
  telecharger,
} from "./noyau";
import { modeClicActif, viser } from "./fiche";
import { suspendreEffets } from "./effets";
import { definirPhotosDuPlan } from "./plan";
import { nuage } from "./nuage/client";
import { monEmail, monId, monPrenom, nomProjetCourant, projetCharge } from "./nuage/projets";
import {
  INSCRIPTION_PACE,
  comptePace,
  connecterPace,
  creerBlocNotes,
  creerNotePace,
  creerSection,
  deconnecterPace,
  dossiersPace,
  envoyerImagePace,
  lienNotePace,
  messagePace,
  sectionParDefaut,
  type DossierPace,
} from "./paceapp";
import { quitterVisite, suspendreVisite, visiteActive } from "./visite";
import { dessinerSurImage, etatActuel, restaurerEtat, type EtatVue } from "./etat-vue";
import type { Annotations } from "./annoter";

type Statut = "a_traiter" | "traite";
/** Point de vue ; pour une photo, f35 = focale équivalente 24×36 (angle de prise de vue). */
type Vue = { p: number[]; c: number[]; ortho: boolean; fov: number; f35?: number };
type Capture = {
  id: string;
  genre: "capture" | "photo";
  /** Compte de l'auteur (absent sur la maquette d'essai). */
  auteur?: string | null;
  auteur_nom: string;
  cree_le: string;
  message: string;
  statut: Statut;
  vue: Vue | null;
  largeur: number;
  hauteur: number;
  /** Sur cet écran seulement (maquette d'essai, ou envoi en échec). */
  locale?: boolean;
  /**
   * État de la maquette à la prise (maquettes affichées, transparences, masquage, coupes,
   * cotes…), lu à la demande : undefined = pas encore lu, null = aucun (ancienne capture).
   */
  etat?: EtatVue | null;
  /** Annotations rééditables (éditeur), lues à la demande comme l'état. */
  annotations?: Annotations | null;
};

const IMAGE_MAX = 1600; // px, côté le plus long
const PHOTO_MAX = 2048; // px, photos du chantier
const FOCALE_DEFAUT = 24; // mm équivalent 24×36 : objectif principal d'un téléphone
const VIGNETTE = 360;
const SEAU = "captures";

let projet: string | null = null;
let captures: Capture[] = [];
/** Images déjà chargées (adresses blob:) et vignettes (adresses signées ou blob:). */
const images = new Map<string, string>();
const vignettes = new Map<string, string>();

/** Fichiers d'une capture : image (annotée), vignette « v », image d'origine sans annotations « o ». */
const chemin = (id: string, variante: "" | "v" | "o" = "") => `${projet}/${id}${variante ? "_" + variante : ""}.jpg`;
const libelleStatut = (s: Statut) => (s === "traite" ? "Traité" : "À traiter");

// --- Prise de vue ------------------------------------------------------------------------

function vueActuelle(): Vue {
  const c = monde.camera.controls;
  const p = c.getPosition(new THREE.Vector3());
  const t = c.getTarget(new THREE.Vector3());
  return { p: p.toArray(), c: t.toArray(), ortho: estOrtho(), fov: monde.camera.threePersp.fov };
}

const versBlob = (c: HTMLCanvasElement, qualite: number) =>
  new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("image"))), "image/jpeg", qualite));

function reduire(source: CanvasImageSource & { width: number; height: number }, max: number) {
  const k = Math.min(1, max / Math.max(source.width, source.height));
  const c = cree("canvas");
  c.width = Math.max(1, Math.round(source.width * k));
  c.height = Math.max(1, Math.round(source.height * k));
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

async function capturer() {
  const toile = monde.renderer!.three.domElement;
  // État de la maquette à cet instant : « Voir dans la maquette » le remettra à l'identique.
  const etat = etatActuel();
  // On redessine la vue et on la copie aussitôt (le dessin WebGL n'est pas gardé ensuite).
  // Sans les effets de visite (flou des bords, balancement) : l'image doit être fidèle.
  suspendreEffets(true);
  let grande: HTMLCanvasElement;
  try {
    monde.renderer!.update();
    grande = reduire(toile, IMAGE_MAX);
  } finally {
    suspendreEffets(false);
  }
  // Les cotes (dessinées par-dessus la 3D à l'écran) sont reportées dans l'image.
  const largeurEcran = toile.getBoundingClientRect().width || grande.width;
  dessinerSurImage(grande.getContext("2d")!, grande.width, grande.height, grande.width / largeurEcran);
  flash();
  const [image, petite] = await Promise.all([versBlob(grande, 0.86), versBlob(reduire(grande, VIGNETTE), 0.8)]);
  const cap: Capture = {
    id: crypto.randomUUID(),
    genre: "capture",
    auteur_nom: monPrenom(),
    cree_le: new Date().toISOString(),
    message: "",
    statut: "a_traiter",
    vue: vueActuelle(),
    largeur: grande.width,
    hauteur: grande.height,
    locale: !projet,
    etat,
    annotations: null,
  };
  images.set(cap.id, URL.createObjectURL(image));
  vignettes.set(cap.id, URL.createObjectURL(petite));
  captures.unshift(cap);
  majCoin();
  notifier(cap);
  if (projet) void envoyer(cap, image, petite);
}

async function envoyer(cap: Capture, image: Blob, petite: Blob) {
  const p = projet;
  const st = nuage.storage.from(SEAU);
  const [a, b] = await Promise.all([
    st.upload(chemin(cap.id), image, { contentType: "image/jpeg", upsert: true }),
    st.upload(chemin(cap.id, "v"), petite, { contentType: "image/jpeg", upsert: true }),
  ]);
  let erreur: unknown = a.error ?? b.error;
  if (!erreur) {
    const { error } = await nuage.from("captures").insert({
      id: cap.id,
      genre: cap.genre,
      projet_id: p,
      auteur_nom: cap.auteur_nom.slice(0, 80),
      vue: cap.vue,
      largeur: cap.largeur,
      hauteur: cap.hauteur,
      etat: cap.etat ?? null,
    });
    erreur = error;
  }
  if (!erreur) return;
  console.error(cap.genre === "photo" ? "Photo" : "Capture", erreur);
  cap.locale = true;
  alerte("La capture n'a pas pu être enregistrée dans le projet : elle reste sur cet écran.", 5000);
  majGalerie();
}

function flash() {
  jouerBruitage("photo");
  const f = cree("div", "capture-flash");
  document.body.append(f);
  f.addEventListener("animationend", () => f.remove());
  navigator.vibrate?.(20);
}

// --- Notification après la prise ---------------------------------------------------------

let notif: { el: HTMLElement; minuterie: number } | null = null;

function notifier(cap: Capture) {
  fermerNotif(false);
  const n = cree("div", "capture-notif");
  const img = cree("img", "capture-notif-img");
  img.src = vignettes.get(cap.id) ?? "";
  img.alt = "";
  const texte = cree("div", "capture-notif-texte");
  texte.append(
    cree("strong", "", cap.genre === "photo" ? "Photo rangée ici" : "Capture prise"),
    cree("span", "", cap.locale ? "Sur cet écran seulement" : "Ajouter un message ?"),
  );
  const actions = cree("div", "capture-notif-actions");
  actions.append(
    bouton("capture-notif-btn principal", "Message", () => {
      fermerNotif(false);
      ouvrirGalerie(cap.id, "message");
    }),
    bouton("capture-notif-btn", "Annoter", () => {
      fermerNotif(false);
      void annoter(cap);
    }),
  );
  const croix = bouton("capture-notif-fermer", "✕", () => fermerNotif(true), "Fermer");
  croix.setAttribute("aria-label", "Fermer la notification");
  n.append(img, texte, actions, croix);
  document.body.append(n);
  requestAnimationFrame(() => n.classList.add("visible"));
  notif = { el: n, minuterie: window.setTimeout(() => fermerNotif(true), 6000) };
  // Un toucher ailleurs que sur ses boutons la range tout de suite.
  let glisse = false;
  n.addEventListener("click", (e) => {
    if (glisse) return;
    if (!(e.target as HTMLElement).closest("button")) fermerNotif(true);
  });
  // Glisser sur le côté ou vers le haut : elle s'en va (la capture reste rangée).
  let depart: { id: number; x: number; y: number } | null = null;
  n.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    depart = { id: e.pointerId, x: e.clientX, y: e.clientY };
    glisse = false;
    if (notif?.el === n) window.clearTimeout(notif.minuterie);
    n.setPointerCapture(e.pointerId);
    n.style.transition = "none";
  });
  n.addEventListener("pointermove", (e) => {
    if (!depart || e.pointerId !== depart.id) return;
    const dx = e.clientX - depart.x;
    const dy = Math.min(0, e.clientY - depart.y);
    if (Math.hypot(dx, dy) > 6) glisse = true;
    n.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px)`;
    n.style.opacity = String(Math.max(0.15, 1 - Math.max(Math.abs(dx) / 220, -dy / 90)));
  });
  const lacher = (e: PointerEvent) => {
    if (!depart || e.pointerId !== depart.id) return;
    const dx = e.clientX - depart.x;
    const dy = e.clientY - depart.y;
    depart = null;
    n.style.transition = "";
    if (Math.abs(dx) > 70 || dy < -40) {
      // Partie dans le sens du geste.
      n.style.transform = Math.abs(dx) > 70 ? `translate(calc(-50% + ${Math.sign(dx) * 480}px), 0)` : "translate(-50%, -120px)";
      n.style.opacity = "0";
      if (notif?.el === n) notif = null;
      window.setTimeout(() => n.remove(), 220);
    } else {
      n.style.transform = "";
      n.style.opacity = "";
      if (notif?.el === n) notif.minuterie = window.setTimeout(() => fermerNotif(true), 4000);
    }
    window.setTimeout(() => (glisse = false), 0);
  };
  n.addEventListener("pointerup", lacher);
  n.addEventListener("pointercancel", lacher);
}

/** Ferme la notification ; « ranger » : sa vignette file vers l'onglet Captures. */
function fermerNotif(ranger: boolean) {
  if (!notif) return;
  const { el: n, minuterie } = notif;
  notif = null;
  window.clearTimeout(minuterie);
  const img = n.querySelector("img");
  if (ranger && img && !coin.hidden) {
    const de = img.getBoundingClientRect();
    const vers = coin.getBoundingClientRect();
    const vol = img.cloneNode() as HTMLImageElement;
    vol.className = "capture-vol";
    Object.assign(vol.style, { left: `${de.left}px`, top: `${de.top}px`, width: `${de.width}px`, height: `${de.height}px` });
    document.body.append(vol);
    requestAnimationFrame(() => {
      vol.style.transform = `translate(${vers.left + 6 - de.left}px, ${vers.top + 4 - de.top}px) scale(${22 / de.width})`;
      vol.style.opacity = "0.4";
    });
    vol.addEventListener("transitionend", () => {
      vol.remove();
      coin.classList.add("rebond");
      window.setTimeout(() => coin.classList.remove("rebond"), 400);
    });
  }
  n.classList.remove("visible");
  window.setTimeout(() => n.remove(), 250);
}

// --- Onglet « Captures » (bord gauche, sous la liste des maquettes) --------------------

const coin = cree("button", "captures-coin");
coin.type = "button";
coin.hidden = true;
coin.title = "Captures d'écran du projet";
coin.addEventListener("click", () => ouvrirGalerie());
document.getElementById("calques")?.after(coin);

function majCoin() {
  coin.hidden = captures.length === 0;
  const aTraiter = captures.filter((c) => c.statut === "a_traiter").length;
  const v = captures[0] ? vignettes.get(captures[0].id) : undefined;
  coin.innerHTML = "";
  if (v) {
    const img = cree("img", "captures-coin-img");
    img.src = v;
    img.alt = "";
    coin.append(img);
  } else {
    coin.innerHTML = ICONE;
  }
  coin.append(cree("span", "captures-coin-nombre", String(aTraiter || captures.length)));
  coin.classList.toggle("a-traiter", aTraiter > 0);
  coin.setAttribute("aria-label", `Captures : ${captures.length}, dont ${aTraiter} à traiter`);
  majIcones();
}

// --- Galerie ----------------------------------------------------------------------------

let fond: HTMLElement | null = null;
let boite: HTMLElement | null = null;
let filtre: "a_traiter" | "toutes" = "toutes";
let detail: string | null = null;
/** Filtres de la galerie : période (aujourd'hui, 7 jours, ce mois, ou un mois « AAAA-MM »), auteur, type. */
let periode = "tout";
let auteurFiltre = "tous";
let genreFiltre: "tout" | "photo" | "capture" = "tout";
/** Sélection en cours (mode « Sélectionner »), pour l'export vers PaceApp. */
let choix: Set<string> | null = null;
/** Étape de l'export vers PaceApp, affichée à la place de la galerie. */
let exportPace: null | { etape: "compte" | "destination" | "envoi" | "fin"; texte?: string; note?: string; ou?: string; erreur?: string } = null;

const moisDe = (iso: string) => iso.slice(0, 7);
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libelleMois = (m: string) => `${NOMS_MOIS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const estDeMoi = (c: Capture) => (c.auteur ? c.auteur === monId() : !!c.locale || c.auteur_nom === monPrenom());

/** Captures visibles avec les filtres choisis. */
function capturesFiltrees() {
  const maintenant = new Date();
  const debutJour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).getTime();
  return captures.filter((c) => {
    if (filtre === "a_traiter" && c.statut !== "a_traiter") return false;
    if (genreFiltre !== "tout" && c.genre !== genreFiltre) return false;
    if (auteurFiltre === "moi" && !estDeMoi(c)) return false;
    if (auteurFiltre.startsWith("a:") && (c.auteur ?? "nom:" + c.auteur_nom) !== auteurFiltre.slice(2)) return false;
    const t = new Date(c.cree_le).getTime();
    if (periode === "jour" && t < debutJour) return false;
    if (periode === "semaine" && t < debutJour - 6 * 86400e3) return false;
    if (periode === "mois" && moisDe(c.cree_le) !== moisDe(maintenant.toISOString())) return false;
    if (/^\d{4}-\d{2}$/.test(periode) && moisDe(c.cree_le) !== periode) return false;
    return true;
  });
}

function menuFiltre(libelle: string, valeur: string, options: [string, string][], changer: (v: string) => void) {
  const m = cree("select", "captures-filtre" + (valeur !== options[0][0] ? " actif" : ""));
  m.setAttribute("aria-label", libelle);
  m.title = libelle;
  for (const [v, t] of options) {
    const o = cree("option", "", t);
    o.value = v;
    o.selected = v === valeur;
    m.append(o);
  }
  m.addEventListener("change", () => {
    changer(m.value);
    majGalerie();
  });
  return m;
}

function barreFiltres() {
  const barre = cree("div", "captures-filtres");
  const mois = [...new Set(captures.map((c) => moisDe(c.cree_le)))].sort().reverse();
  const auteurs = new Map<string, string>();
  for (const c of captures) if (!estDeMoi(c)) auteurs.set(c.auteur ?? "nom:" + c.auteur_nom, c.auteur_nom || "Sans nom");
  barre.append(
    menuFiltre("Période", periode, [["tout", "Toutes dates"], ["jour", "Aujourd'hui"], ["semaine", "7 derniers jours"], ["mois", "Ce mois-ci"], ...mois.map((m): [string, string] => [m, libelleMois(m)])], (v) => (periode = v)),
    menuFiltre("Auteur", auteurFiltre, [["tous", "Tous les auteurs"], ["moi", "Moi"], ...[...auteurs].map(([k, n]): [string, string] => ["a:" + k, n])], (v) => (auteurFiltre = v)),
    menuFiltre("Type", genreFiltre, [["tout", "Photos et captures"], ["photo", "Photos"], ["capture", "Captures"]], (v) => (genreFiltre = v as typeof genreFiltre)),
  );
  return barre;
}

function ouvrirGalerie(id?: string, focus?: "message") {
  if (!fond) {
    fond = cree("div", "captures-fond");
    boite = cree("div", "captures-boite");
    boite.setAttribute("role", "dialog");
    boite.setAttribute("aria-label", "Captures");
    fond.append(boite);
    fond.addEventListener("click", (e) => {
      if (e.target === fond) fermerGalerie();
    });
    document.body.append(fond);
  }
  detail = id ?? null;
  majGalerie(focus);
}

function fermerGalerie() {
  viderMessage();
  naviguer = null;
  fond?.remove();
  fond = boite = null;
  detail = null;
  // Un envoi en cours continue : son résultat s'affichera à la prochaine ouverture.
  if (exportPace?.etape !== "envoi") {
    exportPace = null;
    choix = null;
  }
}

window.addEventListener("keydown", (e) => {
  if (!fond) return;
  // Visionneuse : flèches du clavier pour passer d'une capture à l'autre.
  const sens = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
  if (sens && detail && naviguer && !exportPace && !choix) {
    const cible = e.target as HTMLElement | null;
    if (cible?.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    naviguer(sens);
    return;
  }
  if (e.key !== "Escape") return;
  if (exportPace) {
    if (exportPace.etape !== "envoi") quitterExport(exportPace.etape !== "fin");
  } else if (choix) {
    choix = null;
    majGalerie();
  } else if (detail) {
    viderMessage();
    detail = null;
    majGalerie();
  } else fermerGalerie();
});

function majGalerie(focus?: "message") {
  majCoin();
  if (!boite) return;
  if (exportPace) {
    boite.classList.remove("visionneuse");
    return dessinerExport();
  }
  const cap = detail ? captures.find((c) => c.id === detail) : undefined;
  boite.classList.toggle("visionneuse", !!cap);
  if (detail && cap) return dessinerDetail(cap, focus);
  detail = null;
  naviguer = null;
  const entete = cree("div", "captures-entete");
  const aTraiter = captures.filter((c) => c.statut === "a_traiter").length;
  const liste = capturesFiltrees();
  if (choix) {
    for (const id of choix) if (!captures.some((c) => c.id === id)) choix.delete(id);
    const tous = liste.length > 0 && liste.every((c) => choix!.has(c.id));
    entete.append(
      cree("strong", "", `${choix.size} sélectionnée${choix.size > 1 ? "s" : ""}`),
      bouton("visite-puce", tous ? "Aucune" : `Tout (${liste.length})`, () => {
        for (const c of liste) {
          if (tous) choix!.delete(c.id);
          else choix!.add(c.id);
        }
        majGalerie();
      }, tous ? "Tout désélectionner" : "Sélectionner toutes les captures affichées"),
      bouton("visite-puce", "Annuler", () => {
        choix = null;
        majGalerie();
      }),
    );
  } else {
    entete.append(
      cree("strong", "", `Captures · ${captures.length}`),
      bouton("visite-puce" + (filtre === "a_traiter" ? " actif" : ""), `À traiter · ${aTraiter}`, () => {
        filtre = filtre === "a_traiter" ? "toutes" : "a_traiter";
        majGalerie();
      }),
      ...(captures.length
        ? [bouton("visite-puce", "Sélectionner", () => ((choix = new Set()), majGalerie()), "Choisir des captures, par exemple pour les exporter vers PaceApp")]
        : []),
      bouton("fermer", "✕", fermerGalerie, "Fermer"),
    );
  }
  const nbPhotos = captures.filter((c) => c.genre === "photo").length;
  const options = cree("div", "captures-options");
  if (nbPhotos) {
    options.append(
      bouton(
        "visite-puce" + (iconesVisibles ? " actif" : ""),
        iconesVisibles ? "📷 Icônes des photos affichées" : "📷 Icônes des photos masquées",
        () => {
          iconesVisibles = !iconesVisibles;
          try {
            localStorage.setItem(CLE_ICONES, iconesVisibles ? "1" : "0");
          } catch {
            // Gardé pour la session.
          }
          majIcones();
          majGalerie();
        },
        "Afficher ou masquer les icônes des photos dans la maquette",
      ),
    );
  }
  const grille = cree("div", "captures-grille");
  if (!liste.length) {
    grille.append(
      cree(
        "p",
        "captures-vide",
        !captures.length ? "Aucune capture pour l'instant." : filtre === "a_traiter" && periode === "tout" && auteurFiltre === "tous" && genreFiltre === "tout" ? "Tout est traité." : "Aucune capture avec ces filtres.",
      ),
    );
  }
  for (const c of liste) {
    const pris = choix?.has(c.id) ?? false;
    const carte = cree("button", "capture-carte" + (choix ? " a-choisir" : "") + (pris ? " choisie" : ""));
    carte.type = "button";
    if (choix) {
      carte.setAttribute("aria-pressed", String(pris));
      carte.append(cree("span", "capture-coche", pris ? "✓" : ""));
    }
    const img = cree("img");
    img.alt = "";
    img.loading = "lazy";
    const v = vignettes.get(c.id);
    if (v) img.src = v;
    const info = cree("div", "capture-carte-info");
    if (c.genre === "photo") carte.append(cree("span", "capture-genre", "📷 Photo"));
    info.append(
      cree("span", "capture-statut " + c.statut, libelleStatut(c.statut)),
      cree("span", "capture-carte-date", `${dateCourte(c.cree_le)}${c.auteur_nom ? " · " + c.auteur_nom : ""}`),
    );
    carte.append(img, info);
    if (c.message) carte.append(cree("span", "capture-carte-message", c.message));
    carte.addEventListener("click", () => {
      if (choix) {
        if (choix.has(c.id)) choix.delete(c.id);
        else choix.add(c.id);
      } else detail = c.id;
      majGalerie();
    });
    grille.append(carte);
  }
  const pied: HTMLElement[] = [];
  if (choix) {
    const barre = cree("div", "captures-pied");
    const n = choix.size ? ` (${choix.size})` : "";
    const enregistrer = bouton("btn", `Télécharger${n}`, () => void telechargerChoix(), "Enregistrer les images choisies sur cet appareil (plusieurs : un fichier .zip)");
    const exporter = bouton("btn principal", `Exporter vers PaceApp${n}`, () => commencerExport());
    enregistrer.disabled = exporter.disabled = !choix.size;
    barre.append(cree("span", "captures-pied-aide", "Touchez les captures à télécharger ou exporter"), enregistrer, exporter);
    pied.push(barre);
  }
  const note = projet === null && captures.length ? [cree("p", "captures-note", "Maquette d'essai : les captures restent sur cet écran.")] : [];
  boite.replaceChildren(entete, ...(captures.length ? [barreFiltres()] : []), ...(nbPhotos && !choix ? [options] : []), grille, ...note, ...pied);
}

// --- Export vers PaceApp ---------------------------------------------------------------------
// Les captures choisies partent dans une nouvelle note PaceApp (images en pleine définition,
// annotations comprises, avec leur message, leur statut, la date et l'auteur).

const MAX_EXPORT = 30; // PaceApp accepte 30 images par 10 minutes et par compte.
const CLE_DESTINATION = "nexbim-paceapp-destination";
let dossiers: DossierPace[] | null = null;

function commencerExport() {
  if (!choix?.size) return;
  if (choix.size > MAX_EXPORT) return alerte(`${MAX_EXPORT} captures au plus par export (limite de PaceApp) : exportez en plusieurs fois.`, 4500);
  exportPace = { etape: comptePace() ? "destination" : "compte" };
  dossiers = null;
  majGalerie();
}

function quitterExport(garderChoix = true) {
  exportPace = null;
  if (!garderChoix) choix = null;
  majGalerie();
}

const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function dessinerExport() {
  if (!boite || !exportPace) return;
  const n = choix?.size ?? 0;
  const entete = cree("div", "captures-entete");
  entete.append(
    exportPace.etape === "envoi" ? cree("span") : bouton("visite-puce", "‹ Retour", () => quitterExport(exportPace?.etape !== "fin")),
    cree("strong", "", "Exporter vers PaceApp"),
    bouton("fermer", "✕", () => (exportPace?.etape === "envoi" ? undefined : quitterExport(exportPace?.etape !== "fin")), "Fermer"),
  );
  const corps = cree("div", "pace-export");
  const e = exportPace;
  if (e.etape === "compte") {
    corps.append(
      cree("p", "", `Les ${n} image${n > 1 ? "s" : ""} choisie${n > 1 ? "s" : ""} seront ajoutées dans une nouvelle note de votre compte PaceApp, l'appli de notes du groupe.`),
      cree("p", "pace-export-doux", "Une fenêtre PaceApp s'ouvre : connectez-vous (de préférence avec le même e-mail que NexBim), puis touchez « Autoriser »."),
    );
    const connexion = bouton("btn principal", "Se connecter à PaceApp", async () => {
      connexion.disabled = true;
      connexion.textContent = "En attente de PaceApp…";
      try {
        await connecterPace();
        exportPace = { etape: "destination" };
      } catch (err) {
        exportPace = { etape: "compte", erreur: messagePace(err) };
      }
      majGalerie();
    });
    const inscription = cree("a", "btn", "Créer un compte PaceApp");
    inscription.href = INSCRIPTION_PACE;
    inscription.target = "_blank";
    inscription.rel = "noopener";
    const actions = cree("div", "pace-export-actions");
    actions.append(connexion, inscription);
    corps.append(actions, cree("p", "pace-export-doux", "Pas encore de compte ? Créez-le (gratuit), confirmez votre e-mail, puis revenez ici pour vous connecter."));
  } else if (e.etape === "destination") {
    dessinerDestination(corps, n);
  } else if (e.etape === "envoi") {
    const barre = cree("div", "pace-export-barre");
    barre.append(cree("span"));
    corps.append(cree("p", "", e.texte ?? "Envoi…"), barre);
  } else {
    const lien = cree("a", "btn principal", "Ouvrir dans PaceApp");
    lien.href = lienNotePace(e.note ?? "");
    lien.target = "_blank";
    lien.rel = "noopener";
    const actions = cree("div", "pace-export-actions");
    actions.append(lien, bouton("btn", "Terminé", () => quitterExport(false)));
    corps.append(cree("p", "pace-export-ok", `✓ Note créée${e.ou ? ` dans ${e.ou}` : ""}.`), actions);
  }
  if (e.erreur) corps.append(cree("p", "pace-export-erreur", e.erreur));
  boite.replaceChildren(entete, corps);
}

function dessinerDestination(corps: HTMLElement, n: number) {
  const compte = comptePace();
  const ligneCompte = cree("p", "pace-export-doux");
  ligneCompte.append(`Compte PaceApp : ${compte?.email ?? "?"}`);
  if (compte?.email && monEmail() && compte.email.toLowerCase() !== monEmail().toLowerCase()) ligneCompte.append(" (autre e-mail que NexBim)");
  ligneCompte.append(" · ");
  const changer = cree("button", "lien", "Changer de compte");
  changer.type = "button";
  changer.addEventListener("click", () => {
    deconnecterPace();
    exportPace = { etape: "compte" };
    majGalerie();
  });
  ligneCompte.append(changer);
  corps.append(ligneCompte);
  if (!dossiers) {
    corps.append(cree("p", "pace-export-doux", "Lecture de vos blocs-notes…"));
    void dossiersPace()
      .then((d) => {
        dossiers = d;
        if (exportPace?.etape === "destination") majGalerie();
      })
      .catch((err) => {
        if (/JWT|jwt|NON_CONNECTE|401/.test(String(err))) deconnecterPace();
        exportPace = { etape: comptePace() ? "destination" : "compte", erreur: messagePace(err) };
        dossiers = [];
        majGalerie();
      });
    return;
  }
  const blocs = dossiers.filter((d) => d.kind === "notebook");
  let memo: { bloc?: string; section?: string } = {};
  try {
    memo = JSON.parse(localStorage.getItem(CLE_DESTINATION) ?? "{}");
  } catch {
    // Pas de mémoire.
  }
  const projetNom = nomProjetCourant() || "Maquette d'essai";
  const titre = cree("input", "champ");
  titre.maxLength = 300;
  titre.value = `NexBim · ${projetNom} · ${new Date().toLocaleDateString("fr-FR")}`;

  const choixBloc = cree("select", "champ");
  const choixSection = cree("select", "champ");
  const nouveauBloc = cree("input", "champ");
  nouveauBloc.placeholder = "Nom du nouveau bloc-notes";
  nouveauBloc.value = "NexBim";
  const nouvelleSection = cree("input", "champ");
  nouvelleSection.placeholder = "Nom de la nouvelle section";
  nouvelleSection.value = projetNom;
  const option = (v: string, t: string) => {
    const o = cree("option", "", t);
    o.value = v;
    return o;
  };
  choixBloc.append(option("", "Par défaut (Notes rapides)"), ...blocs.map((b) => option(b.id, b.name || "Sans nom")), option("+", "+ Nouveau bloc-notes…"));
  choixBloc.value = memo.bloc && (memo.bloc === "" || blocs.some((b) => b.id === memo.bloc)) ? memo.bloc : "";
  const majSections = () => {
    const bloc = choixBloc.value;
    nouveauBloc.hidden = bloc !== "+";
    choixSection.replaceChildren();
    if (bloc === "" ) {
      choixSection.append(option("", "Notes rapides"));
      choixSection.disabled = true;
    } else {
      choixSection.disabled = false;
      // Sections du bloc-notes, y compris celles rangées dans un groupe.
      const groupes = new Set(dossiers!.filter((d) => d.kind === "group" && d.parent_id === bloc).map((d) => d.id));
      const sections = bloc === "+" ? [] : dossiers!.filter((d) => d.kind === "section" && (d.parent_id === bloc || groupes.has(d.parent_id ?? "")));
      choixSection.append(...sections.map((s) => option(s.id, s.name || "Sans nom")), option("+", "+ Nouvelle section…"));
      choixSection.value = memo.section && sections.some((s) => s.id === memo.section) ? memo.section : sections[0]?.id ?? "+";
    }
    nouvelleSection.hidden = choixSection.value !== "+";
  };
  choixBloc.addEventListener("change", majSections);
  choixSection.addEventListener("change", () => (nouvelleSection.hidden = choixSection.value !== "+"));
  majSections();

  const champ = (libelle: string, ...el: HTMLElement[]) => {
    const l = cree("label", "pace-export-champ");
    l.append(cree("span", "", libelle), ...el);
    return l;
  };
  const exporter = bouton("btn principal", `Exporter ${n} image${n > 1 ? "s" : ""}`, () =>
    void envoyerVersPace({
      titre: titre.value.trim() || "NexBim",
      bloc: choixBloc.value,
      section: choixSection.value,
      nouveauBloc: nouveauBloc.value.trim() || "NexBim",
      nouvelleSection: nouvelleSection.value.trim() || projetNom,
    }),
  );
  const actions = cree("div", "pace-export-actions");
  actions.append(exporter, bouton("btn", "Annuler", () => quitterExport()));
  corps.append(champ("Titre de la note", titre), champ("Bloc-notes", choixBloc, nouveauBloc), champ("Section", choixSection, nouvelleSection), actions);
}

async function envoyerVersPace(o: { titre: string; bloc: string; section: string; nouveauBloc: string; nouvelleSection: string }) {
  const liste = captures.filter((c) => choix?.has(c.id));
  if (!liste.length) return;
  const etape = (texte: string) => {
    exportPace = { etape: "envoi", texte };
    majGalerie();
  };
  try {
    // 1. Où ranger la note.
    etape("Préparation de la destination…");
    let section = o.section;
    let ou = "";
    const nom = (id: string) => dossiers?.find((d) => d.id === id)?.name ?? "";
    if (o.bloc === "") {
      section = await sectionParDefaut();
      ou = "Notes rapides";
    } else {
      let bloc = o.bloc;
      if (bloc === "+") bloc = await creerBlocNotes(o.nouveauBloc);
      if (section === "+" || o.bloc === "+") {
        const freres = (dossiers ?? []).filter((d) => d.parent_id === bloc);
        const position = Math.max(0, ...freres.map((d) => d.position ?? 0)) + 1024;
        section = await creerSection(bloc, o.nouvelleSection, position);
        ou = `${o.bloc === "+" ? o.nouveauBloc : nom(bloc)} › ${o.nouvelleSection}`;
      } else ou = `${nom(bloc)} › ${nom(section)}`;
    }
    try {
      localStorage.setItem(CLE_DESTINATION, JSON.stringify({ bloc: o.bloc === "+" ? "" : o.bloc, section: o.section === "+" ? "" : o.section }));
    } catch {
      // Sans mémoire.
    }
    // 2. Les images, une à une (pleine définition, annotations comprises).
    const blocs: string[] = [];
    for (const [i, c] of liste.entries()) {
      etape(`Envoi des images ${i + 1} / ${liste.length}…`);
      const u = await imageDe(c);
      if (!u) throw new Error(`image introuvable (${dateCourte(c.cree_le)})`);
      const image = await (await fetch(u)).blob();
      const adresse = await envoyerImagePace(image, `nexbim-${c.cree_le.slice(0, 10)}.jpg`);
      const quand = `${dateCourte(c.cree_le)} ${new Date(c.cree_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
      const dims = c.largeur && c.hauteur ? ` data-width="${c.largeur}" data-height="${c.hauteur}"` : "";
      blocs.push(
        `<h3>${c.genre === "photo" ? "📷 Photo" : "Capture"} · ${echapper(quand)}${c.auteur_nom ? " · " + echapper(c.auteur_nom) : ""}</h3>` +
          `<p><img src="${adresse}"${dims} alt=""></p>` +
          `<p><strong>Statut :</strong> ${libelleStatut(c.statut)}</p>` +
          (c.message ? c.message.split(/\n+/).map((l) => `<p>${echapper(l)}</p>`).join("") : ""),
      );
    }
    // 3. La note.
    etape("Création de la note…");
    const projetNom = nomProjetCourant() || "Maquette d'essai";
    const html =
      `<p>Exporté depuis <a href="https://nexbim.paceapp.fr">NexBim</a> · projet « ${echapper(projetNom)} » · ${liste.length} image${liste.length > 1 ? "s" : ""} · ${echapper(new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}</p>` +
      blocs.join("");
    const note = await creerNotePace(section, o.titre, html);
    exportPace = { etape: "fin", note, ou };
    jouerBruitage("cote");
  } catch (err) {
    if (/JWT|jwt|NON_CONNECTE/.test(String(err))) deconnecterPace();
    exportPace = { etape: comptePace() ? "destination" : "compte", erreur: messagePace(err) };
  }
  majGalerie();
}

// --- Téléchargement sur l'appareil ----------------------------------------------------------
// Nom : projet, date (2026.11.23) et heure à la seconde (12.01.37) de la capture : pas de doublon.
const z2 = (n: number) => String(n).padStart(2, "0");
const sansInterdits = (t: string) => t.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
function jourPoints(d: Date) {
  return `${d.getFullYear()}.${z2(d.getMonth() + 1)}.${z2(d.getDate())}`;
}
function nomFichier(c: Capture, type: string, pris?: Set<string>) {
  const d = new Date(c.cree_le);
  const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
  const base = `${sansInterdits(nomProjetCourant() || "Maquette d'essai")}_${jourPoints(d)}_${z2(d.getHours())}.${z2(d.getMinutes())}.${z2(d.getSeconds())}`;
  let nom = `${base}.${ext}`;
  for (let k = 2; pris?.has(nom); k++) nom = `${base} (${k}).${ext}`;
  pris?.add(nom);
  return nom;
}

async function blobDe(c: Capture) {
  const u = await imageDe(c);
  return u ? (await fetch(u)).blob() : null;
}

/** Les captures choisies : une seule, l'image ; plusieurs, un .zip (un seul enregistrement). */
async function telechargerChoix() {
  if (!choix?.size) return;
  const liste = captures.filter((c) => choix!.has(c.id));
  try {
    if (liste.length === 1) {
      attente("Préparation de l'image…");
      const b = await blobDe(liste[0]);
      if (!b) throw new Error("image introuvable");
      telecharger(nomFichier(liste[0], b.type), b);
      return;
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const pris = new Set<string>();
    let manquantes = 0;
    for (const [i, c] of liste.entries()) {
      attente(`Préparation des images ${i + 1} / ${liste.length}…`);
      const b = await blobDe(c);
      if (b) zip.file(nomFichier(c, b.type, pris), b, { date: new Date(c.cree_le) });
      else manquantes++;
    }
    attente("Création du fichier .zip…");
    // Les images sont déjà compressées : on les range telles quelles (plus rapide).
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const projetNom = sansInterdits(nomProjetCourant() || "Maquette d'essai");
    telecharger(`${projetNom}_${jourPoints(new Date())}_captures (${liste.length - manquantes}).zip`, archive);
    if (manquantes) alerte(`${manquantes} image${manquantes > 1 ? "s" : ""} introuvable${manquantes > 1 ? "s" : ""}, non incluse${manquantes > 1 ? "s" : ""}.`, 4000);
  } catch (e) {
    console.error(e);
    alerte("Téléchargement impossible. Réessayez.");
  } finally {
    attente(null);
  }
}

async function imageDe(c: Capture) {
  let url = images.get(c.id);
  if (url || c.locale || !projet) return url ?? vignettes.get(c.id) ?? "";
  const { data } = await nuage.storage.from(SEAU).download(chemin(c.id));
  if (!data) return vignettes.get(c.id) ?? "";
  url = URL.createObjectURL(data);
  images.set(c.id, url);
  return url;
}

/** Images d'origine (sans annotations), pour reprendre les annotations dans l'éditeur. */
const originaux = new Map<string, string>();

async function originalDe(c: Capture) {
  if (!c.annotations) return imageDe(c);
  const url = originaux.get(c.id);
  if (url || c.locale || !projet) return url ?? imageDe(c);
  const { data } = await nuage.storage.from(SEAU).download(chemin(c.id, "o"));
  if (!data) return imageDe(c);
  const u = URL.createObjectURL(data);
  originaux.set(c.id, u);
  return u;
}

/** Lit à la demande l'état et / ou les annotations d'une capture (absents de la liste). */
async function completer(c: Capture, ...champs: ("etat" | "annotations")[]) {
  const manquants = champs.filter((k) => c[k] === undefined);
  if (!manquants.length) return true;
  if (c.locale || !projet) {
    for (const k of manquants) c[k] = null;
    return true;
  }
  const { data, error } = await nuage.from("captures").select(manquants.join(", ")).eq("id", c.id).maybeSingle();
  if (error) {
    console.error("Capture", error);
    return false;
  }
  const ligne = (data ?? {}) as Partial<Record<"etat" | "annotations", unknown>>;
  if (manquants.includes("etat")) c.etat = (ligne.etat as EtatVue | null) ?? null;
  if (manquants.includes("annotations")) c.annotations = (ligne.annotations as Annotations | null) ?? null;
  return true;
}

// --- Visionneuse : une capture en grand, et on passe à la suivante sans fermer ----------------

/** Message en cours de saisie dans la visionneuse : enregistré avant de changer de capture. */
let messageEnAttente: (() => Promise<void>) | null = null;
/** Capture précédente (-1) ou suivante (+1), depuis le clavier. */
let naviguer: ((sens: number) => void) | null = null;

function viderMessage() {
  const f = messageEnAttente;
  messageEnAttente = null;
  if (f) void f();
}

function dessinerDetail(c: Capture, focus?: "message") {
  if (!boite) return;
  let liste = capturesFiltrees();
  if (!liste.includes(c)) liste = captures;
  const rang = liste.indexOf(c);
  const aller = (sens: number) => {
    if (liste.length < 2) return;
    const suivante = liste[(rang + sens + liste.length) % liste.length];
    viderMessage();
    detail = suivante.id;
    majGalerie();
    boite?.querySelector<HTMLElement>(".capture-vignette.actuelle")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  naviguer = aller;

  const entete = cree("div", "captures-entete");
  entete.append(
    bouton("visite-puce", "‹ Captures", () => {
      viderMessage();
      detail = null;
      majGalerie();
    }),
    cree("span", "capture-carte-date", `${dateCourte(c.cree_le)} ${new Date(c.cree_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${c.auteur_nom ? " · " + c.auteur_nom : ""}`),
    cree("span", "capture-rang", liste.length > 1 ? `${rang + 1} / ${liste.length}` : ""),
    bouton("fermer", "✕", fermerGalerie, "Fermer"),
  );

  // Image en grand, flèches de part et d'autre ; glisser du doigt pour changer de capture.
  const scene = cree("div", "capture-scene");
  const img = cree("img", "capture-grande");
  img.alt = c.genre === "photo" ? "Photo du chantier" : "Capture";
  img.src = vignettes.get(c.id) ?? "";
  img.title = c.genre === "photo" ? "Voir la photo au point de vue" : "Annoter la capture";
  img.draggable = false;
  void imageDe(c).then((u) => u && detail === c.id && (img.src = u));
  let glisse: { x: number; y: number; id: number } | null = null;
  let aGlisse = false;
  img.addEventListener("pointerdown", (e) => {
    glisse = { x: e.clientX, y: e.clientY, id: e.pointerId };
    aGlisse = false;
  });
  img.addEventListener("pointerup", (e) => {
    if (!glisse || glisse.id !== e.pointerId) return;
    const dx = e.clientX - glisse.x;
    const dy = e.clientY - glisse.y;
    glisse = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      aGlisse = true;
      aller(dx < 0 ? 1 : -1);
    }
  });
  img.addEventListener("click", () => {
    if (aGlisse) return;
    void (c.genre === "photo" ? voirPhoto(c) : annoter(c));
  });
  scene.append(img);
  if (c.genre === "photo") scene.append(cree("span", "capture-genre", "📷 Photo"));
  if (liste.length > 1) {
    const prec = bouton("capture-fleche gauche", "‹", () => aller(-1), "Capture précédente (←)");
    const suiv = bouton("capture-fleche droite", "›", () => aller(1), "Capture suivante (→)");
    prec.setAttribute("aria-label", "Capture précédente");
    suiv.setAttribute("aria-label", "Capture suivante");
    scene.append(prec, suiv);
  }

  // Bande des vignettes : un toucher ouvre la capture.
  const bande = cree("div", "capture-bande");
  bande.setAttribute("role", "listbox");
  bande.setAttribute("aria-label", "Captures");
  for (const x of liste) {
    const b = cree("button", "capture-vignette" + (x === c ? " actuelle" : "") + (x.statut === "a_traiter" ? " a-traiter" : ""));
    b.type = "button";
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(x === c));
    b.title = `${dateCourte(x.cree_le)}${x.message ? " · " + x.message : ""}`;
    const v = cree("img");
    v.alt = "";
    v.loading = "lazy";
    const u = vignettes.get(x.id);
    if (u) v.src = u;
    b.append(v);
    if (x.genre === "photo") b.append(cree("span", "capture-vignette-genre", "📷"));
    b.addEventListener("click", () => {
      if (x === c) return;
      viderMessage();
      detail = x.id;
      majGalerie();
    });
    bande.append(b);
  }

  const statut = bouton("capture-statut grand " + c.statut, (c.statut === "traite" ? "✓ " : "") + libelleStatut(c.statut), async () => {
    const avant = c.statut;
    c.statut = c.statut === "traite" ? "a_traiter" : "traite";
    viderMessage();
    majGalerie();
    if (!(await enregistrer(c, { statut: c.statut }))) {
      c.statut = avant;
      majGalerie();
    }
  });
  statut.title = "Toucher pour changer le statut";

  // Message : enregistré tout seul pendant la frappe (et en quittant la capture).
  const message = cree("textarea", "champ capture-message");
  message.rows = 3;
  message.maxLength = 2000;
  message.placeholder = "Votre message : ce qu'il faut voir, faire, corriger…";
  message.value = c.message;
  const etatMessage = cree("span", "capture-message-etat", "");
  let minuterie = 0;
  const sauver = async () => {
    window.clearTimeout(minuterie);
    if (messageEnAttente === sauver) messageEnAttente = null;
    const texte = message.value.trim();
    if (texte === c.message) return;
    const avant = c.message;
    c.message = texte;
    etatMessage.textContent = "Enregistrement…";
    if (await enregistrer(c, { message: texte })) etatMessage.textContent = "✓ Enregistré";
    else {
      c.message = avant;
      etatMessage.textContent = "Échec de l'enregistrement";
    }
  };
  message.addEventListener("input", () => {
    etatMessage.textContent = "";
    messageEnAttente = sauver;
    window.clearTimeout(minuterie);
    minuterie = window.setTimeout(() => void sauver(), 900);
  });
  message.addEventListener("blur", () => void sauver());
  const ligneMessage = cree("div", "capture-message-ligne");
  ligneMessage.append(statut, etatMessage);

  const actions = cree("div", "capture-actions");
  actions.append(
    bouton("visite-puce", "✏️ Annoter", () => void annoter(c), "Flèches, texte, cadres, traits… (modifiables ensuite)"),
    bouton(
      "visite-puce",
      c.genre === "photo" ? "Voir au point de vue" : "Voir dans la maquette",
      () => void (c.genre === "photo" ? voirPhoto(c) : allerA(c)),
      "Remet la caméra et la maquette comme à la prise : maquettes affichées, transparences, éléments masqués, coupes et cotes",
    ),
    bouton("visite-puce", "Télécharger", async () => {
      const b = await blobDe(c);
      if (b) telecharger(nomFichier(c, b.type), b);
    }),
    bouton("visite-puce danger", "Supprimer", () => void supprimer(c)),
  );

  const infos = cree("div", "capture-infos");
  infos.append(ligneMessage, message, actions);
  const colonne = cree("div", "capture-colonne");
  colonne.append(scene, infos);
  const corps = cree("div", "capture-visionneuse" + (liste.length > 1 ? "" : " seule"));
  corps.append(...(liste.length > 1 ? [bande] : []), colonne);
  boite.replaceChildren(entete, corps);
  if (focus === "message") message.focus();
}

async function enregistrer(c: Capture, champs: Partial<Pick<Capture, "message" | "statut" | "annotations">>) {
  if (c.locale || !projet) return true;
  const { error } = await nuage
    .from("captures")
    .update({ ...champs, maj_le: new Date().toISOString() })
    .eq("id", c.id);
  if (!error) return true;
  console.error("Capture", error);
  alerte("L'enregistrement a échoué. Vérifiez la connexion et réessayez.", 4000);
  return false;
}

async function supprimer(c: Capture) {
  const oui = await demanderConfirmation("Supprimer la capture ?", "Elle sera effacée du projet pour tout le monde.", "Supprimer", true);
  if (!oui) return;
  if (!c.locale && projet) {
    const { error } = await nuage.from("captures").delete().eq("id", c.id);
    if (error) {
      console.error("Capture", error);
      return alerte("Suppression impossible : seuls l'auteur et le créateur du projet peuvent la supprimer.", 4500);
    }
    void nuage.storage.from(SEAU).remove([chemin(c.id), chemin(c.id, "v"), chemin(c.id, "o")]);
  }
  // On reste dans la visionneuse : la capture suivante prend sa place.
  const liste = capturesFiltrees();
  const rang = liste.indexOf(c);
  const suivante = liste[rang + 1] ?? liste[rang - 1];
  captures = captures.filter((x) => x !== c);
  for (const m of [images, vignettes, originaux]) {
    const u = m.get(c.id);
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
    m.delete(c.id);
  }
  detail = suivante && suivante !== c ? suivante.id : null;
  majGalerie();
}

/** « Voir dans la maquette » : la caméra, et la maquette exactement comme à la prise. */
async function allerA(c: Capture) {
  if (!c.vue) return;
  viderMessage();
  const lu = await completer(c, "etat");
  fermerGalerie();
  if (visiteActive()) await quitterVisite();
  if (c.etat) await restaurerEtat(c.etat);
  else if (lu) alerte("Capture ancienne : seule la caméra est remise (l'affichage n'était pas encore enregistré).", 3500);
  const v = c.vue;
  await definirProjection(v.ortho ? "Orthographic" : "Perspective");
  recentrerPivot();
  await monde.camera.controls.setLookAt(v.p[0], v.p[1], v.p[2], v.c[0], v.c[1], v.c[2], true);
}

// --- Annoter : éditeur d'annotation (flèches, texte, cadres…), annotations modifiables -----

async function annoter(c: Capture) {
  viderMessage();
  if (!(await completer(c, "annotations"))) return alerte("Annotations illisibles : vérifiez la connexion.", 3500);
  const avaitAnnotations = !!c.annotations;
  const source = await originalDe(c);
  if (!source) return alerte("Image indisponible.", 3000);
  let r: Awaited<ReturnType<typeof import("./annoter").annoterImage>>;
  try {
    const { annoterImage } = await import("./annoter");
    r = await annoterImage(source, c.annotations);
  } catch (e) {
    console.error("Annotation", e);
    return alerte("L'éditeur d'annotation n'a pas pu s'ouvrir. Vérifiez la connexion et réessayez.", 4500);
  }
  if (!r) return;
  // L'image d'origine est gardée à part la première fois : les annotations restent modifiables.
  let origine: Blob | null = null;
  if (!avaitAnnotations && r.annotations) {
    origine = await fetch(source).then((x) => x.blob()).catch(() => null);
    if (origine && (c.locale || !projet)) originaux.set(c.id, URL.createObjectURL(origine));
  }
  const [image, petite] = await Promise.all([versBlob(r.image, 0.86), versBlob(reduire(r.image, VIGNETTE), 0.8)]);
  for (const [m, b] of [[images, image], [vignettes, petite]] as const) {
    const ancien = m.get(c.id);
    if (ancien?.startsWith("blob:")) URL.revokeObjectURL(ancien);
    m.set(c.id, URL.createObjectURL(b));
  }
  c.annotations = r.annotations;
  majGalerie();
  if (c.locale || !projet) return alerte("Annotation enregistrée.", 1800);
  const st = nuage.storage.from(SEAU);
  if (origine) {
    const { error } = await st.upload(chemin(c.id, "o"), origine, { contentType: "image/jpeg", upsert: true });
    if (error) console.error("Image d'origine", error);
    else originaux.set(c.id, URL.createObjectURL(origine));
  }
  const [a, b] = await Promise.all([
    st.upload(chemin(c.id), image, { contentType: "image/jpeg", upsert: true }),
    st.upload(chemin(c.id, "v"), petite, { contentType: "image/jpeg", upsert: true }),
  ]);
  if (a.error || b.error) {
    console.error("Annotation", a.error ?? b.error);
    return alerte("L'annotation n'a pas pu être enregistrée dans le projet.", 4500);
  }
  if (await enregistrer(c, { annotations: c.annotations })) alerte("Annotation enregistrée.", 1800);
}

// --- Chargement avec le projet -------------------------------------------------------------

projetCharge.on((id) => void charger(id));
async function charger(id: string | null) {
  for (const m of [images, vignettes, originaux]) {
    for (const u of m.values()) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    m.clear();
  }
  projet = id;
  captures = [];
  fermerGalerie();
  if (id) {
    const { data, error } = await nuage
      .from("captures")
      .select("id, genre, auteur, auteur_nom, cree_le, message, statut, vue, largeur, hauteur")
      .eq("projet_id", id)
      .order("cree_le", { ascending: false })
      .limit(300);
    if (projet !== id) return;
    if (error) console.error("Captures", error);
    captures = (data ?? []) as Capture[];
    if (captures.length) {
      const { data: urls } = await nuage.storage
        .from(SEAU)
        .createSignedUrls(captures.map((c) => chemin(c.id, "v")), 6 * 3600);
      if (projet !== id) return;
      urls?.forEach((u, i) => u.signedUrl && vignettes.set(captures[i].id, u.signedUrl));
    }
  }
  majCoin();
}

// --- Photos de chantier, situées dans la maquette -------------------------------------------

/** Focale équivalente 24×36 lue dans les données EXIF de la photo (si le téléphone la donne). */
function focale35(buf: ArrayBuffer): number | null {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 10 < v.byteLength) {
      const marque = v.getUint16(o);
      const taille = v.getUint16(o + 2);
      if (marque === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10;
        const le = v.getUint16(t) === 0x4949;
        const u16 = (p: number) => v.getUint16(p, le);
        const u32 = (p: number) => v.getUint32(p, le);
        const entree = (debut: number, tag: number) => {
          const n = u16(debut);
          for (let i = 0; i < n; i++) if (u16(debut + 2 + i * 12) === tag) return debut + 2 + i * 12;
          return -1;
        };
        const pointeur = entree(t + u32(t + 4), 0x8769);
        if (pointeur < 0) return null;
        const e = entree(t + u32(pointeur + 8), 0xa405);
        if (e < 0) return null;
        const f = u16(e + 8);
        return f >= 10 && f <= 300 ? f : null;
      }
      if ((marque & 0xff00) !== 0xff00) return null;
      o += 2 + taille;
    }
  } catch {
    // EXIF illisible : focale par défaut.
  }
  return null;
}

// Appareil photo intégré : la caméra du téléphone s'affiche dans NexBim. On ne passe pas
// par l'appli photo du téléphone : Android fermait alors NexBim en arrière-plan (mémoire)
// et la page se rechargeait au retour, photo perdue et visite interrompue.
let flux: MediaStream | null = null;

function arreterFlux() {
  for (const t of flux?.getTracks() ?? []) t.stop();
  flux = null;
}

/** Visite : prend une photo du chantier, rangée au point de vue du déclenchement. */
export async function prendrePhoto() {
  if (flux) return;
  if (!navigator.mediaDevices?.getUserMedia) return photoParFichier();
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } },
    });
  } catch (e) {
    arreterFlux();
    const refus = (e as Error)?.name === "NotAllowedError";
    alerte(
      refus
        ? "Accès à la caméra refusé : autorisez-le pour nexbim.paceapp.fr dans les réglages du navigateur."
        : "Caméra indisponible ici.",
      5000,
    );
    return;
  }
  const ecran = cree("div", "appareil");
  const video = cree("video", "appareil-video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = flux;
  const aide = cree("div", "appareil-aide", "Visez dans la direction de la vue, puis déclenchez.");
  const barre = cree("div", "appareil-barre");
  const declencheur = bouton("appareil-declencheur", "", () => void declencher(), "Prendre la photo");
  barre.append(bouton("visite-puce", "Annuler", fermer), declencheur, cree("span", "appareil-vide"));
  ecran.append(video, aide, barre);
  document.body.append(ecran);
  void video.play().catch(() => undefined);

  function fermer() {
    arreterFlux();
    ecran.remove();
  }

  async function declencher() {
    if (!flux) return;
    // Le point de vue est celui du déclenchement (au gyroscope, la vue suit le téléphone).
    const vue = vueActuelle();
    const etat = etatActuel();
    declencheur.disabled = true;
    ecran.classList.add("eclair");
    jouerBruitage("photo");
    let photo: Blob | null = null;
    const piste = flux.getVideoTracks()[0];
    const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } })
      .ImageCapture;
    if (Capture && piste) {
      try {
        // Pleine définition du capteur (et souvent les données EXIF avec la focale).
        photo = await new Capture(piste).takePhoto();
      } catch {
        photo = null;
      }
    }
    if (!photo && video.videoWidth) {
      const c = cree("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d")!.drawImage(video, 0, 0);
      photo = await versBlob(c, 0.9);
    }
    fermer();
    if (!photo) return alerte("La photo n'a pas pu être prise.", 3500);
    await rangerPhoto(photo, vue, etat).catch((e) => {
      console.error("Photo", e);
      alerte("La photo n'a pas pu être enregistrée.", 3500);
    });
  }
}

/** Secours (navigateur sans accès direct à la caméra) : l'appli photo du téléphone. */
let champPhoto: HTMLInputElement | null = null;
function photoParFichier() {
  const vue = vueActuelle();
  const etat = etatActuel();
  if (!champPhoto) {
    champPhoto = cree("input");
    champPhoto.type = "file";
    champPhoto.accept = "image/*";
    champPhoto.setAttribute("capture", "environment");
    champPhoto.hidden = true;
    document.body.append(champPhoto);
  }
  const champ = champPhoto;
  champ.value = "";
  champ.onchange = () => {
    const f = champ.files?.[0];
    champ.value = "";
    if (f) void rangerPhoto(f, vue, etat).catch((e) => {
      console.error("Photo", e);
      alerte("La photo n'a pas pu être lue.", 3500);
    });
  };
  champ.click();
}

async function rangerPhoto(fichier: Blob, vue: Vue, etat: EtatVue) {
  const exif = focale35(await fichier.slice(0, 256 * 1024).arrayBuffer());
  // L'orientation EXIF est appliquée au décodage (photo prise en portrait ou en paysage).
  const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" } as ImageBitmapOptions);
  // Sans EXIF : objectif principal (24 mm) ; une image 16:9 est recadrée en hauteur (≈ 26 mm).
  const allonge = Math.max(bitmap.width, bitmap.height) / Math.min(bitmap.width, bitmap.height);
  vue.f35 = exif ?? (allonge > 1.6 ? 26 : FOCALE_DEFAUT);
  const grande = reduire(bitmap, PHOTO_MAX);
  bitmap.close();
  const [image, petite] = await Promise.all([versBlob(grande, 0.85), versBlob(reduire(grande, VIGNETTE), 0.8)]);
  const cap: Capture = {
    id: crypto.randomUUID(),
    genre: "photo",
    auteur_nom: monPrenom(),
    cree_le: new Date().toISOString(),
    message: "",
    statut: "a_traiter",
    vue,
    largeur: grande.width,
    hauteur: grande.height,
    locale: !projet,
    etat,
    annotations: null,
  };
  images.set(cap.id, URL.createObjectURL(image));
  vignettes.set(cap.id, URL.createObjectURL(petite));
  captures.unshift(cap);
  majCoin();
  notifier(cap);
  if (projet) void envoyer(cap, image, petite);
}

// Icônes dans la maquette : un petit appareil (pyramide du champ de vision) qui pointe
// dans la direction de la prise de vue, avec un pictogramme photo sur sa face avant.
// C'est un objet comme les autres : taille fixe, caché par les murs.
const CLE_ICONES = "nexbim-icones-photos";
let iconesVisibles = true;
try {
  iconesVisibles = localStorage.getItem(CLE_ICONES) !== "0";
} catch {
  // Affichées par défaut.
}
const groupeIcones = new THREE.Group();
groupeIcones.name = "photos-situees";
monde.scene.three.add(groupeIcones);
const ICONE_L = 0.15; // demi-largeur de la face avant (30 cm)
const ICONE_H = 0.1125; // demi-hauteur (22,5 cm)
const ICONE_P = 0.25; // profondeur, du point de prise de vue à la face avant
const matTrait = new THREE.LineBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.75 });
const matCible = new THREE.MeshBasicMaterial({ visible: false });
/** Pictogramme « photo » : cadre, ciel, soleil et montagnes. */
const matImage = (() => {
  const W = 256;
  const H = 192;
  const toile = document.createElement("canvas");
  toile.width = W;
  toile.height = H;
  const g = toile.getContext("2d")!;
  const arrondi = (x: number, y: number, l: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + l, y, x + l, y + h, r);
    g.arcTo(x + l, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + l, y, r);
    g.closePath();
  };
  g.fillStyle = "#ff8a1f";
  g.fillRect(0, 0, W, H);
  arrondi(10, 10, W - 20, H - 20, 14);
  g.fillStyle = "#ffffff";
  g.fill();
  g.save();
  arrondi(22, 22, W - 44, H - 44, 8);
  g.clip();
  const ciel = g.createLinearGradient(0, 22, 0, H - 22);
  ciel.addColorStop(0, "#8ec9ff");
  ciel.addColorStop(1, "#d8eeff");
  g.fillStyle = ciel;
  g.fillRect(22, 22, W - 44, H - 44);
  g.fillStyle = "#ffc53d";
  g.beginPath();
  g.arc(W - 70, 62, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5b8f5a";
  g.beginPath();
  g.moveTo(14, H - 22);
  g.lineTo(92, 78);
  g.lineTo(170, H - 22);
  g.fill();
  g.fillStyle = "#3f6e46";
  g.beginPath();
  g.moveTo(104, H - 22);
  g.lineTo(168, 104);
  g.lineTo(W - 6, H - 22);
  g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(toile);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
})();
const geoTraits = (() => {
  // Sommet à l'origine (point de prise de vue), face avant vers +Z (lookAt oriente +Z
  // vers la cible).
  const coins = [
    [-ICONE_L, -ICONE_H, ICONE_P],
    [ICONE_L, -ICONE_H, ICONE_P],
    [ICONE_L, ICONE_H, ICONE_P],
    [-ICONE_L, ICONE_H, ICONE_P],
  ];
  const pts: number[] = [];
  for (const c of coins) pts.push(0, 0, 0, ...c);
  for (let i = 0; i < 4; i++) pts.push(...coins[i], ...coins[(i + 1) % 4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
})();
// L'image se lit à l'endroit vue de derrière l'appareil, comme l'écran d'un téléphone.
const geoImage = new THREE.PlaneGeometry(ICONE_L * 2, ICONE_H * 2).rotateY(Math.PI).translate(0, 0, ICONE_P);
const geoCible = new THREE.SphereGeometry(0.22, 8, 6).translate(0, 0, ICONE_P * 0.6);
/** Centre de l'icône dans la maquette (pour savoir si un mur la cache). */
const centreIcone = (o: THREE.Object3D) => o.localToWorld(new THREE.Vector3(0, 0, ICONE_P * 0.6));

function majIcones() {
  for (const o of [...groupeIcones.children]) groupeIcones.remove(o);
  if (!iconesVisibles) return void rafraichir();
  for (const c of captures) {
    if (c.genre !== "photo" || !c.vue) continue;
    const icone = new THREE.Group();
    icone.add(
      new THREE.LineSegments(geoTraits, matTrait),
      new THREE.Mesh(geoImage, matImage),
      new THREE.Mesh(geoCible, matCible),
    );
    icone.position.fromArray(c.vue.p);
    icone.lookAt(new THREE.Vector3().fromArray(c.vue.c));
    icone.userData.capture = c.id;
    groupeIcones.add(icone);
  }
  groupeIcones.updateMatrixWorld(true);
  planifierCachees();
  void rafraichir();
}

// Une icône derrière un mur ne se voit pas : elle ne doit pas non plus se toucher à
// travers. On le vérifie une fois la caméra immobile (tir dans la maquette vers chaque
// icône à l'écran), pour décider tout de suite au moment du toucher.
let minuterieCachees = 0;
let verificationEnCours = false;
function planifierCachees() {
  clearTimeout(minuterieCachees);
  minuterieCachees = window.setTimeout(() => void verifierCachees(), 300);
}
async function verifierCachees() {
  if (verificationEnCours) return planifierCachees();
  verificationEnCours = true;
  try {
    const cam = monde.camera.three;
    cam.updateMatrixWorld();
    groupeIcones.updateMatrixWorld(true);
    const r = monde.renderer!.three.domElement.getBoundingClientRect();
    const oeil = cam.position.clone();
    const proches = groupeIcones.children
      .filter((o) => o.visible)
      .sort((a, b) => a.position.distanceToSquared(oeil) - b.position.distanceToSquared(oeil))
      .slice(0, 12);
    for (const o of proches) {
      const centre = centreIcone(o);
      const ecran = centre.clone().project(cam);
      if (Math.abs(ecran.x) > 1 || Math.abs(ecran.y) > 1 || ecran.z > 1) continue;
      const v = await viser({
        clientX: r.left + ((ecran.x + 1) / 2) * r.width,
        clientY: r.top + ((1 - ecran.y) / 2) * r.height,
      });
      o.userData.cachee = !!v && oeil.distanceTo(v.point) < oeil.distanceTo(centre) - 0.1;
    }
  } catch {
    // Sans réponse de la maquette, les icônes restent touchables.
  } finally {
    verificationEnCours = false;
  }
}

const derniereVue = new THREE.Matrix4();
monde.renderer!.onBeforeUpdate.add(() => {
  if (!groupeIcones.children.length) return;
  const cam = monde.camera.three;
  for (const o of groupeIcones.children) {
    // On ne voit pas une icône de l'intérieur : en se tenant au point de prise de vue,
    // elle couvrirait l'écran.
    o.visible = !o.userData.masquee && cam.position.distanceTo(o.position) > 0.6;
  }
  if (!cam.matrixWorld.equals(derniereVue)) {
    derniereVue.copy(cam.matrixWorld);
    planifierCachees();
  }
});

// Toucher une icône : la photo s'ouvre à son point de vue (avant la fiche des éléments).
{
  const toile = monde.renderer!.three.domElement;
  let depart: { x: number; y: number; id: number } | null = null;
  const iconeSous = (x: number, y: number) => {
    if (!groupeIcones.children.length || !iconesVisibles || modeClicActif() || photoOuverte) return null;
    const r = toile.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const rayon = new THREE.Raycaster();
    rayon.params.Line = { threshold: 0.05 };
    monde.camera.three.updateMatrixWorld();
    rayon.setFromCamera(ndc, monde.camera.three);
    groupeIcones.updateMatrixWorld(true);
    const visibles = groupeIcones.children.filter((o) => o.visible && !o.userData.cachee);
    const touche = rayon.intersectObjects(visibles, true)[0];
    let o: THREE.Object3D | null = touche?.object ?? null;
    while (o && !o.userData.capture) o = o.parent;
    return o ? captures.find((c) => c.id === o!.userData.capture) ?? null : null;
  };
  // Le doigt posé sur une icône ne va ni à la caméra ni à la fiche : sinon la caméra
  // choisissait ce point comme pivot (après coup) et dérangeait le déplacement vers la photo.
  let touchee: Capture | null = null;
  toile.addEventListener(
    "pointerdown",
    (e) => {
      touchee = null;
      const c = iconeSous(e.clientX, e.clientY);
      if (!c) return;
      touchee = c;
      depart = { x: e.clientX, y: e.clientY, id: e.pointerId };
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    { capture: true },
  );
  toile.addEventListener(
    "pointerup",
    (e) => {
      const d = depart;
      const c = touchee;
      depart = null;
      touchee = null;
      if (!c || !d || d.id !== e.pointerId) return;
      e.stopImmediatePropagation();
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      // Dernière vérification : un mur entre l'œil et l'icône l'emporte.
      const icone = groupeIcones.children.find((o) => o.userData.capture === c.id);
      const pos = { clientX: e.clientX, clientY: e.clientY };
      void viser(pos)
        .catch(() => null)
        .then((v) => {
          if (icone && v) {
            const oeil = monde.camera.three.position;
            if (oeil.distanceTo(v.point) < oeil.distanceTo(centreIcone(icone)) - 0.25) {
              icone.userData.cachee = true;
              return;
            }
          }
          void voirPhoto(c);
        });
    },
    { capture: true },
  );
}

// Les photos situées sur le plan de localisation de la visite (points orange).
definirPhotosDuPlan(
  () => captures.filter((c) => c.genre === "photo" && c.vue).map((c) => ({ id: c.id, p: c.vue!.p as [number, number, number] })),
  (id) => {
    const c = captures.find((x) => x.id === id);
    if (c) void voirPhoto(c);
  },
);

// Visionneuse : caméra au point de vue de la photo, angle de vue de l'appareil, photo
// par-dessus la maquette avec un curseur pour passer de l'une à l'autre.
let photoOuverte = false;

async function voirPhoto(c: Capture) {
  if (!c.vue || photoOuverte) return;
  viderMessage();
  photoOuverte = true;
  await completer(c, "etat");
  fermerGalerie();
  const ctl = monde.camera.controls;
  const persp = monde.camera.threePersp;
  const avant = {
    p: ctl.getPosition(new THREE.Vector3()),
    t: ctl.getTarget(new THREE.Vector3()),
    fov: persp.fov,
    ortho: estOrtho(),
  };
  const enVisite = visiteActive();
  // Son icône, vue de l'intérieur, rayerait l'image.
  const sonIcone = groupeIcones.children.find((o) => o.userData.capture === c.id);
  if (sonIcone) sonIcone.userData.masquee = true;
  suspendreVisite(true);
  suspendreEffets(true);
  bloquerDecalage(true);
  if (avant.ortho) await definirProjection("Perspective");
  // La maquette comme à la prise de la photo (maquettes affichées, transparences…) ;
  // l'affichage d'avant revient à la fermeture, avec la caméra.
  const etatAvant = c.etat ? etatActuel() : null;
  if (c.etat) await restaurerEtat(c.etat);

  const ecran = cree("div", "photo-vue");
  const img = cree("img", "photo-vue-img");
  img.alt = "Photo du chantier";
  img.src = vignettes.get(c.id) ?? "";
  const barre = cree("div", "photo-vue-barre");
  const curseur = cree("input", "photo-vue-curseur");
  curseur.type = "range";
  curseur.min = "0";
  curseur.max = "100";
  curseur.value = "85";
  curseur.setAttribute("aria-label", "Photo ou maquette");
  const appliquerOpacite = () => (img.style.opacity = String(Number(curseur.value) / 100));
  curseur.addEventListener("input", appliquerOpacite);
  appliquerOpacite();
  const etiquette = cree("span", "photo-vue-legende", `${dateCourte(c.cree_le)}${c.auteur_nom ? " · " + c.auteur_nom : ""}${c.message ? " · " + c.message : ""}`);
  const curseurBloc = cree("label", "photo-vue-mixage");
  curseurBloc.append(cree("span", "", "Maquette"), curseur, cree("span", "", "Photo"));
  barre.append(
    bouton("visite-puce", "✕ Fermer", () => void fermer()),
    curseurBloc,
    bouton("visite-puce", "Détails", () => {
      void fermer().then(() => ouvrirGalerie(c.id));
    }),
  );
  // Zone des gestes (par-dessus l'image) : zoom à deux doigts, à la molette ou par double
  // toucher, et déplacement d'un doigt une fois zoomé. La maquette suit exactement le zoom
  // (même partie de la vue), la photo reste donc calée dessus.
  const zone = cree("div", "photo-vue-zone");
  const croix = bouton("photo-vue-croix", "✕", () => void fermer(), "Fermer la photo");
  croix.setAttribute("aria-label", "Fermer la photo");
  const retour = bouton("photo-vue-retour", "1×", () => zoomer(1, 0, 0), "Revenir à la photo entière");
  retour.hidden = true;
  // Cadre de la photo affichée en entier : zoomée, elle reste dans ce cadre (elle ne passe
  // pas sur les barres du haut) ; la maquette, elle, est zoomée sur tout l'écran.
  const cadre = cree("div", "photo-vue-cadre");
  cadre.append(img);
  ecran.append(cadre, zone, croix, retour, etiquette, barre);
  document.body.append(ecran);
  void imageDe(c).then((u) => u && (img.src = u));

  const vue = { z: 1, tx: 0, ty: 0 };
  const appliquerZoom = () => {
    const taille = monde.renderer!.getSize();
    const W = taille.x;
    const H = taille.y;
    vue.z = THREE.MathUtils.clamp(vue.z, 1, 6);
    vue.tx = THREE.MathUtils.clamp(vue.tx, W - vue.z * W, 0);
    vue.ty = THREE.MathUtils.clamp(vue.ty, H - vue.z * H, 0);
    img.style.transformOrigin = "0 0";
    img.style.transform = vue.z > 1.001 ? `translate(${vue.tx}px, ${vue.ty}px) scale(${vue.z})` : "";
    if (vue.z > 1.001) persp.setViewOffset(W, H, -vue.tx / vue.z, -vue.ty / vue.z, W / vue.z, H / vue.z);
    else persp.clearViewOffset();
    retour.hidden = vue.z <= 1.001;
    void rafraichir();
  };
  /** Zoom vers z en gardant le point (x, y) de l'écran sous le doigt. */
  function zoomer(z: number, x: number, y: number) {
    const k = THREE.MathUtils.clamp(z, 1, 6) / vue.z;
    vue.tx = x - (x - vue.tx) * k;
    vue.ty = y - (y - vue.ty) * k;
    vue.z *= k;
    appliquerZoom();
  }
  // Croix en haut à droite de la photo (là où elle s'affiche en entier).
  const placerCroix = () => {
    const taille = monde.renderer!.getSize();
    const pw = c.largeur || 4;
    const ph = c.hauteur || 3;
    const k = Math.min(taille.x / pw, taille.y / ph);
    const haut = Math.max(0, (taille.y - ph * k) / 2);
    const droite = Math.max(0, (taille.x - pw * k) / 2);
    Object.assign(cadre.style, { left: `${droite}px`, top: `${haut}px`, width: `${taille.x - 2 * droite}px`, height: `${taille.y - 2 * haut}px` });
    Object.assign(img.style, { left: `${-droite}px`, top: `${-haut}px`, width: `${taille.x}px`, height: `${taille.y}px` });
    croix.style.top = `${haut + 8}px`;
    croix.style.right = `${droite + 8}px`;
    retour.style.top = `${haut + 8}px`;
    retour.style.right = `${droite + 50}px`;
  };
  placerCroix();
  const doigts = new Map<number, { x: number; y: number }>();
  let dernierToucher = { t: 0, x: 0, y: 0 };
  let pince: { d: number; mx: number; my: number } | null = null;
  const milieu = () => {
    const [a, b] = [...doigts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  zone.addEventListener("pointerdown", (e) => {
    zone.setPointerCapture(e.pointerId);
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pince = doigts.size === 2 ? milieu() : null;
    if (doigts.size === 1) {
      // Double toucher : zoom × 2,5 à cet endroit, ou retour à la photo entière.
      const t = performance.now();
      if (t - dernierToucher.t < 320 && Math.hypot(e.clientX - dernierToucher.x, e.clientY - dernierToucher.y) < 30) {
        if (vue.z > 1.05) zoomer(1, e.clientX, e.clientY);
        else zoomer(2.5, e.clientX, e.clientY);
        dernierToucher.t = 0;
      } else dernierToucher = { t, x: e.clientX, y: e.clientY };
    }
  });
  zone.addEventListener("pointermove", (e) => {
    const avant = doigts.get(e.pointerId);
    if (!avant) return;
    const apres = { x: e.clientX, y: e.clientY };
    doigts.set(e.pointerId, apres);
    if (doigts.size >= 2 && pince) {
      const m = milieu();
      vue.tx += m.mx - pince.mx;
      vue.ty += m.my - pince.my;
      zoomer(vue.z * (m.d / Math.max(1, pince.d)), m.mx, m.my);
      pince = m;
    } else if (doigts.size === 1 && vue.z > 1.001) {
      vue.tx += apres.x - avant.x;
      vue.ty += apres.y - avant.y;
      appliquerZoom();
    }
  });
  const leverDoigt = (e: PointerEvent) => {
    doigts.delete(e.pointerId);
    pince = doigts.size === 2 ? milieu() : null;
  };
  zone.addEventListener("pointerup", leverDoigt);
  zone.addEventListener("pointercancel", leverDoigt);
  zone.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomer(vue.z * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // Angle de vue : celui de l'appareil, ajusté pour que la photo (affichée en entier)
  // recouvre exactement la maquette.
  const regler = () => {
    const taille = monde.renderer!.getSize();
    const pw = c.largeur || 4;
    const ph = c.hauteur || 3;
    const tanDiag = 43.27 / (2 * (c.vue!.f35 ?? FOCALE_DEFAUT));
    const tanV = (tanDiag * ph) / Math.hypot(pw, ph);
    const echelle = Math.min(taille.x / pw, taille.y / ph);
    const tanEcran = tanV * (taille.y / (ph * echelle));
    persp.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanEcran));
    persp.updateProjectionMatrix();
    void rafraichir();
  };
  regler();
  const surRedimension = () => {
    regler();
    placerCroix();
    appliquerZoom();
  };
  window.addEventListener("resize", surRedimension);
  const [px, py, pz] = c.vue.p;
  const [cx, cy, cz] = c.vue.c;
  recentrerPivot();
  await ctl.setLookAt(px, py, pz, cx, cy, cz, true);

  async function fermer() {
    if (!photoOuverte) return;
    photoOuverte = false;
    window.removeEventListener("resize", surRedimension);
    persp.clearViewOffset();
    ecran.remove();
    if (sonIcone) sonIcone.userData.masquee = false;
    suspendreEffets(false);
    persp.fov = avant.fov;
    persp.updateProjectionMatrix();
    if (etatAvant) await restaurerEtat(etatAvant);
    if (enVisite && visiteActive()) {
      // En visite, on reste au point de vue de la photo et la marche reprend de là.
      ctl.update(0);
      suspendreVisite(false);
    } else {
      if (avant.ortho) await definirProjection("Orthographic");
      await ctl.setLookAt(avant.p.x, avant.p.y, avant.p.z, avant.t.x, avant.t.y, avant.t.z, true);
      bloquerDecalage(false);
      ajusterDecalage(false);
    }
    void rafraichir();
  }
}

// --- Bouton -------------------------------------------------------------------------------

// Capture d'écran : un cadre avec ses coins et une petite image (l'appareil photo est
// réservé aux photos du chantier, en visite).
const ICONE =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="m7.5 16 3-3.5 2.2 2.3 1.6-1.6 2.2 2.8"/><circle cx="14.5" cy="9" r="1.2"/></svg>';
const btn = el<HTMLButtonElement>("btn-capture");
btn.innerHTML = ICONE;
let occupe = false;
btn.addEventListener("click", async () => {
  if (occupe) return;
  occupe = true;
  try {
    await capturer();
  } catch (e) {
    console.error("Capture", e);
    alerte("La capture n'a pas pu être prise.", 3000);
  } finally {
    occupe = false;
  }
});
