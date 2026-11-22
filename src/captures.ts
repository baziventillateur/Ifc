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
import {
  ajusterDecalage,
  alerte,
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
import { monPrenom, projetCharge } from "./nuage/projets";
import { quitterVisite, suspendreVisite, visiteActive } from "./visite";

type Statut = "a_traiter" | "traite";
/** Point de vue ; pour une photo, f35 = focale équivalente 24×36 (angle de prise de vue). */
type Vue = { p: number[]; c: number[]; ortho: boolean; fov: number; f35?: number };
type Capture = {
  id: string;
  genre: "capture" | "photo";
  auteur_nom: string;
  cree_le: string;
  message: string;
  statut: Statut;
  vue: Vue | null;
  largeur: number;
  hauteur: number;
  /** Sur cet écran seulement (maquette d'essai, ou envoi en échec). */
  locale?: boolean;
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

const chemin = (id: string, vignette = false) => `${projet}/${id}${vignette ? "_v" : ""}.jpg`;
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
    st.upload(chemin(cap.id, true), petite, { contentType: "image/jpeg", upsert: true }),
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
  fond?.remove();
  fond = boite = null;
  detail = null;
}

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !fond) return;
  if (detail) {
    detail = null;
    majGalerie();
  } else fermerGalerie();
});

function majGalerie(focus?: "message") {
  majCoin();
  if (!boite) return;
  const cap = detail ? captures.find((c) => c.id === detail) : undefined;
  if (detail && cap) return dessinerDetail(cap, focus);
  detail = null;
  const entete = cree("div", "captures-entete");
  const aTraiter = captures.filter((c) => c.statut === "a_traiter").length;
  entete.append(
    cree("strong", "", `Captures · ${captures.length}`),
    bouton("visite-puce" + (filtre === "a_traiter" ? " actif" : ""), `À traiter · ${aTraiter}`, () => {
      filtre = filtre === "a_traiter" ? "toutes" : "a_traiter";
      majGalerie();
    }),
    bouton("fermer", "✕", fermerGalerie, "Fermer"),
  );
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
  const liste = captures.filter((c) => filtre === "toutes" || c.statut === "a_traiter");
  if (!liste.length) {
    grille.append(cree("p", "captures-vide", captures.length ? "Tout est traité." : "Aucune capture pour l'instant."));
  }
  for (const c of liste) {
    const carte = cree("button", "capture-carte");
    carte.type = "button";
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
      detail = c.id;
      majGalerie();
    });
    grille.append(carte);
  }
  boite.replaceChildren(entete, ...(nbPhotos ? [options] : []), grille);
  if (projet === null && captures.length) {
    boite.append(cree("p", "captures-note", "Maquette d'essai : les captures restent sur cet écran."));
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

function dessinerDetail(c: Capture, focus?: "message") {
  if (!boite) return;
  const entete = cree("div", "captures-entete");
  entete.append(
    bouton("visite-puce", "‹ Captures", () => {
      detail = null;
      majGalerie();
    }),
    cree("span", "capture-carte-date", `${dateCourte(c.cree_le)} ${new Date(c.cree_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${c.auteur_nom ? " · " + c.auteur_nom : ""}`),
    bouton("fermer", "✕", fermerGalerie, "Fermer"),
  );
  const img = cree("img", "capture-grande");
  img.alt = "Capture";
  img.src = vignettes.get(c.id) ?? "";
  void imageDe(c).then((u) => u && (img.src = u));
  img.addEventListener("click", () => void (c.genre === "photo" ? voirPhoto(c) : annoter(c)));

  const statut = bouton("capture-statut grand " + c.statut, (c.statut === "traite" ? "✓ " : "") + libelleStatut(c.statut), async () => {
    const avant = c.statut;
    c.statut = c.statut === "traite" ? "a_traiter" : "traite";
    majGalerie();
    if (!(await enregistrer(c, { statut: c.statut }))) {
      c.statut = avant;
      majGalerie();
    }
  });
  statut.title = "Toucher pour changer le statut";

  const message = cree("textarea", "champ capture-message");
  message.rows = 3;
  message.maxLength = 2000;
  message.placeholder = "Votre message : ce qu'il faut voir, faire, corriger…";
  message.value = c.message;
  const enregistrerMsg = bouton("btn principal", "Enregistrer le message", async () => {
    const texte = message.value.trim();
    if (texte === c.message) return;
    const avant = c.message;
    c.message = texte;
    if (await enregistrer(c, { message: texte })) alerte("Message enregistré.", 1800);
    else c.message = avant;
  });
  enregistrerMsg.hidden = true;
  message.addEventListener("input", () => (enregistrerMsg.hidden = message.value.trim() === c.message));

  const actions = cree("div", "capture-actions");
  actions.append(
    bouton("visite-puce", "Annoter", () => void annoter(c)),
    bouton(
      "visite-puce",
      c.genre === "photo" ? "Voir au point de vue" : "Voir dans la maquette",
      () => void (c.genre === "photo" ? voirPhoto(c) : allerA(c)),
      "Remettre la caméra à cet endroit",
    ),
    bouton("visite-puce", "Télécharger", async () => {
      const u = await imageDe(c);
      if (!u) return;
      telecharger(`capture-${c.cree_le.slice(0, 16).replace(/[T:]/g, "-")}.jpg`, await (await fetch(u)).blob());
    }),
    bouton("visite-puce danger", "Supprimer", () => void supprimer(c)),
  );
  boite.replaceChildren(entete, img, statut, message, enregistrerMsg, actions);
  if (focus === "message") message.focus();
}

async function enregistrer(c: Capture, champs: Partial<Pick<Capture, "message" | "statut">>) {
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
    void nuage.storage.from(SEAU).remove([chemin(c.id), chemin(c.id, true)]);
  }
  captures = captures.filter((x) => x !== c);
  for (const m of [images, vignettes]) {
    const u = m.get(c.id);
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
    m.delete(c.id);
  }
  detail = null;
  majGalerie();
}

async function allerA(c: Capture) {
  if (!c.vue) return;
  fermerGalerie();
  if (visiteActive()) await quitterVisite();
  const v = c.vue;
  await definirProjection(v.ortho ? "Orthographic" : "Perspective");
  recentrerPivot();
  await monde.camera.controls.setLookAt(v.p[0], v.p[1], v.p[2], v.c[0], v.c[1], v.c[2], true);
}

// --- Annoter : dessiner au doigt sur la capture ---------------------------------------

const COULEURS = ["#ff3b30", "#ffd60a", "#ffffff"];

async function annoter(c: Capture) {
  const url = await imageDe(c);
  if (!url) return;
  const base = new Image();
  base.src = url;
  try {
    await base.decode();
  } catch {
    return alerte("Image indisponible.", 3000);
  }
  type Trait = { couleur: string; largeur: number; points: [number, number][] };
  const traits: Trait[] = [];
  let couleur = COULEURS[0];

  const ecran = cree("div", "annoter");
  const barre = cree("div", "annoter-barre");
  const zone = cree("div", "annoter-zone");
  const toile = cree("canvas", "annoter-toile");
  zone.append(toile);
  const choix = cree("div", "annoter-couleurs");
  const pastilles = COULEURS.map((col) => {
    const b = bouton("annoter-couleur" + (col === couleur ? " actif" : ""), "", () => {
      couleur = col;
      for (const p of pastilles) p.classList.toggle("actif", p === b);
    });
    b.style.background = col;
    b.setAttribute("aria-label", "Couleur");
    return b;
  });
  choix.append(...pastilles);
  const retour = bouton("visite-puce", "↶", () => {
    traits.pop();
    dessiner();
  }, "Annuler le dernier trait");
  const terminer = bouton("visite-puce actif", "Terminer", () => void finir(true));
  barre.append(bouton("visite-puce", "Abandonner", () => void finir(false)), choix, retour, terminer);
  ecran.append(zone, barre);
  document.body.append(ecran);

  // Toile à la taille de l'écran, image entière visible.
  const ajuster = () => {
    const r = zone.getBoundingClientRect();
    const k = Math.min(r.width / base.width, r.height / base.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    toile.style.width = `${Math.round(base.width * k)}px`;
    toile.style.height = `${Math.round(base.height * k)}px`;
    toile.width = Math.round(base.width * k * dpr);
    toile.height = Math.round(base.height * k * dpr);
    dessiner();
  };
  const ctx = toile.getContext("2d")!;
  function tracer(c2: CanvasRenderingContext2D, w: number, h: number, t: Trait) {
    if (!t.points.length) return;
    c2.strokeStyle = t.couleur;
    c2.lineWidth = t.largeur * w;
    c2.lineCap = "round";
    c2.lineJoin = "round";
    c2.beginPath();
    c2.moveTo(t.points[0][0] * w, t.points[0][1] * h);
    for (const [x, y] of t.points.slice(1)) c2.lineTo(x * w, y * h);
    if (t.points.length === 1) c2.lineTo(t.points[0][0] * w + 0.1, t.points[0][1] * h);
    c2.stroke();
  }
  function dessiner() {
    ctx.drawImage(base, 0, 0, toile.width, toile.height);
    for (const t of traits) tracer(ctx, toile.width, toile.height, t);
    retour.disabled = traits.length === 0;
  }
  ajuster();
  window.addEventListener("resize", ajuster);

  let enCours: Trait | null = null;
  const point = (e: PointerEvent): [number, number] => {
    const r = toile.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  toile.addEventListener("pointerdown", (e) => {
    if (enCours) return;
    toile.setPointerCapture(e.pointerId);
    enCours = { couleur, largeur: 0.006, points: [point(e)] };
    traits.push(enCours);
    dessiner();
  });
  toile.addEventListener("pointermove", (e) => {
    if (!enCours) return;
    enCours.points.push(point(e));
    dessiner();
  });
  const lacher = () => (enCours = null);
  toile.addEventListener("pointerup", lacher);
  toile.addEventListener("pointercancel", lacher);

  async function finir(garder: boolean) {
    window.removeEventListener("resize", ajuster);
    ecran.remove();
    if (!garder || !traits.length) return;
    // Image finale à pleine définition.
    const finale = cree("canvas");
    finale.width = base.width;
    finale.height = base.height;
    const f = finale.getContext("2d")!;
    f.drawImage(base, 0, 0);
    for (const t of traits) tracer(f, finale.width, finale.height, t);
    const [image, petite] = await Promise.all([versBlob(finale, 0.86), versBlob(reduire(finale, VIGNETTE), 0.8)]);
    for (const [m, b] of [[images, image], [vignettes, petite]] as const) {
      const ancien = m.get(c.id);
      if (ancien?.startsWith("blob:")) URL.revokeObjectURL(ancien);
      m.set(c.id, URL.createObjectURL(b));
    }
    majGalerie();
    if (c.locale || !projet) return;
    const st = nuage.storage.from(SEAU);
    const [a, b] = await Promise.all([
      st.upload(chemin(c.id), image, { contentType: "image/jpeg", upsert: true }),
      st.upload(chemin(c.id, true), petite, { contentType: "image/jpeg", upsert: true }),
    ]);
    if (a.error || b.error) {
      console.error("Annotation", a.error ?? b.error);
      return alerte("L'annotation n'a pas pu être enregistrée dans le projet.", 4500);
    }
    await enregistrer(c, {});
    alerte("Annotation enregistrée.", 1800);
  }
}

// --- Chargement avec le projet -------------------------------------------------------------

projetCharge.on((id) => void charger(id));
async function charger(id: string | null) {
  for (const m of [images, vignettes]) {
    for (const u of m.values()) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    m.clear();
  }
  projet = id;
  captures = [];
  fermerGalerie();
  if (id) {
    const { data, error } = await nuage
      .from("captures")
      .select("id, genre, auteur_nom, cree_le, message, statut, vue, largeur, hauteur")
      .eq("projet_id", id)
      .order("cree_le", { ascending: false })
      .limit(300);
    if (projet !== id) return;
    if (error) console.error("Captures", error);
    captures = (data ?? []) as Capture[];
    if (captures.length) {
      const { data: urls } = await nuage.storage
        .from(SEAU)
        .createSignedUrls(captures.map((c) => chemin(c.id, true)), 6 * 3600);
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
    declencheur.disabled = true;
    ecran.classList.add("eclair");
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
    await rangerPhoto(photo, vue).catch((e) => {
      console.error("Photo", e);
      alerte("La photo n'a pas pu être enregistrée.", 3500);
    });
  }
}

/** Secours (navigateur sans accès direct à la caméra) : l'appli photo du téléphone. */
let champPhoto: HTMLInputElement | null = null;
function photoParFichier() {
  const vue = vueActuelle();
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
    if (f) void rangerPhoto(f, vue).catch((e) => {
      console.error("Photo", e);
      alerte("La photo n'a pas pu être lue.", 3500);
    });
  };
  champ.click();
}

async function rangerPhoto(fichier: Blob, vue: Vue) {
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
  fermerGalerie();
  photoOuverte = true;
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
  ecran.append(img, etiquette, barre);
  document.body.append(ecran);
  void imageDe(c).then((u) => u && (img.src = u));

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
  window.addEventListener("resize", regler);
  const [px, py, pz] = c.vue.p;
  const [cx, cy, cz] = c.vue.c;
  recentrerPivot();
  await ctl.setLookAt(px, py, pz, cx, cy, cz, true);

  async function fermer() {
    if (!photoOuverte) return;
    photoOuverte = false;
    window.removeEventListener("resize", regler);
    ecran.remove();
    if (sonIcone) sonIcone.userData.masquee = false;
    suspendreEffets(false);
    persp.fov = avant.fov;
    persp.updateProjectionMatrix();
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
