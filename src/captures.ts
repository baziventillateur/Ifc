// Captures d'écran annotées, rangées dans le projet.
// - Le bouton appareil photo prend la vue telle qu'elle est (arêtes, couleurs, coupe).
// - Une petite notification propose d'ajouter un message ou d'annoter ; sans réponse,
//   elle s'efface et la capture file dans l'onglet « Captures » (bord gauche).
// - Chaque capture a un message, un statut (à traiter / traité) et son point de vue :
//   « Voir dans la maquette » y ramène la caméra.
// Enregistrées dans le projet (seau « captures » + table captures) : le créateur et les
// personnes invitées les retrouvent sur tous leurs appareils. Maquette d'essai : sur cet
// écran seulement.
import * as THREE from "three";
import { alerte, bouton, cree, dateCourte, definirProjection, demanderConfirmation, el, estOrtho, monde, recentrerPivot, telecharger } from "./noyau";
import { nuage } from "./nuage/client";
import { monPrenom, projetCharge } from "./nuage/projets";
import { quitterVisite, visiteActive } from "./visite";

type Statut = "a_traiter" | "traite";
type Vue = { p: number[]; c: number[]; ortho: boolean; fov: number };
type Capture = {
  id: string;
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
  monde.renderer!.update();
  const grande = reduire(toile, IMAGE_MAX);
  flash();
  const [image, petite] = await Promise.all([versBlob(grande, 0.86), versBlob(reduire(grande, VIGNETTE), 0.8)]);
  const cap: Capture = {
    id: crypto.randomUUID(),
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
      projet_id: p,
      auteur_nom: cap.auteur_nom.slice(0, 80),
      vue: cap.vue,
      largeur: cap.largeur,
      hauteur: cap.hauteur,
    });
    erreur = error;
  }
  if (!erreur) return;
  console.error("Capture", erreur);
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
  texte.append(cree("strong", "", "Capture prise"), cree("span", "", cap.locale ? "Sur cet écran seulement" : "Ajouter un message ?"));
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
  n.append(img, texte, actions);
  document.body.append(n);
  requestAnimationFrame(() => n.classList.add("visible"));
  notif = { el: n, minuterie: window.setTimeout(() => fermerNotif(true), 6000) };
  // Un toucher ailleurs que sur ses boutons la range tout de suite.
  n.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("button")) fermerNotif(true);
  });
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
  boite.replaceChildren(entete, grille);
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
  img.addEventListener("click", () => void annoter(c));

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
    bouton("visite-puce", "Voir dans la maquette", () => void allerA(c), "Remettre la caméra à cet endroit"),
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
      .select("id, auteur_nom, cree_le, message, statut, vue, largeur, hauteur")
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

// --- Bouton -------------------------------------------------------------------------------

const ICONE =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/><circle cx="12" cy="12.8" r="3.4"/></svg>';
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
