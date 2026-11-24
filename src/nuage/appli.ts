// L'appli sur l'appareil : installation (écran d'accueil), notifications (Web Push) et présence.
// Inspiré de Malino :
// - l'appli signale toutes les minutes qu'elle est ouverte (et où : projets, maquette, visite),
//   si elle est installée et si les notifications sont activées : l'administrateur le voit ;
// - au bout de quelques minutes d'utilisation, elle propose d'installer l'appli, puis
//   d'activer les notifications (une fois tous les 5 jours au plus si on répond « Plus tard »).
import { alerte, bouton, cree } from "../noyau";
import { appeler, nuage } from "./client";

const ua = navigator.userAgent || "";
export const appareil = {
  ios: () => /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  android: () => /android/i.test(ua),
  /** Navigateur intégré d'une appli (Facebook, Instagram…) : on ne peut rien y installer. */
  integre: () => /FBAN|FBAV|FB_IAB|FBIOS|Instagram|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest/i.test(ua),
  safari: () => appareil.ios() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua),
  /** Type d'appareil, pour le panneau admin. */
  type() {
    const tp = navigator.maxTouchPoints || 0;
    if (/iPhone|iPod/i.test(ua)) return "ios:tel";
    if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && tp > 1)) return "ios:tab";
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "android:tel" : "android:tab";
    if (/Macintosh|Mac OS X/i.test(ua)) return "mac:ordi";
    if (/Windows/i.test(ua)) return "windows:ordi";
    if (/CrOS|Linux/i.test(ua)) return "linux:ordi";
    return "autre:ordi";
  },
};

const memoire = {
  lire: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  ecrire: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Mémoire locale indisponible : tant pis.
    }
  },
};

// --- Installation ---------------------------------------------------------------------------

type Demande = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const demandeInstallation = () => (window as unknown as { __installation: Demande | null }).__installation;

/** Ouverte depuis l'icône de l'écran d'accueil (appli installée). */
export function autonome() {
  try {
    return (
      matchMedia("(display-mode: standalone)").matches ||
      matchMedia("(display-mode: fullscreen)").matches ||
      matchMedia("(display-mode: minimal-ui)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
export const appliInstallee = () => autonome() || memoire.lire("nexbim-installe") === "1";

/** Installe en un clic quand le navigateur le permet, sinon explique la marche à suivre. */
export async function installer() {
  const d = demandeInstallation();
  if (d) {
    (window as unknown as { __installation: Demande | null }).__installation = null;
    try {
      await d.prompt();
      const r = await d.userChoice;
      if (r?.outcome === "accepted") {
        memoire.ecrire("nexbim-installe", "1");
        alerte("NexBim s'installe sur cet appareil.", 3500);
        void signaler(true);
        majApres?.();
        return;
      }
    } catch {
      // Le navigateur a refusé : on montre la marche à suivre.
    }
  }
  aideInstallation();
}

const PARTAGER =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#3d8bfd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';

function aideInstallation() {
  const ios = appareil.ios();
  let titre: string;
  let etapes: string[];
  let note = "";
  if (appareil.integre()) {
    titre = `Ouvrez NexBim dans ${ios ? "Safari" : "votre navigateur"}`;
    etapes = [
      "Touchez <b>⋯</b> en haut ou en bas à droite",
      `Choisissez <b>« Ouvrir dans ${ios ? "Safari" : "le navigateur"} »</b>`,
      "Touchez à nouveau <b>Installer</b>",
    ];
  } else if (ios) {
    titre = `Installer NexBim sur ${/ipad/i.test(ua) || navigator.maxTouchPoints > 1 ? "l'iPad" : "l'iPhone"}`;
    etapes = [
      `Touchez le bouton <b>Partager</b> ${PARTAGER} ${appareil.safari() ? "en bas de Safari" : "dans la barre d'adresse"}`,
      "Choisissez <b>« Sur l'écran d'accueil »</b> ➕",
      "Touchez <b>Ajouter</b>",
    ];
    note = appareil.safari() ? "" : "Vous ne le voyez pas ? Ouvrez nexbim.paceapp.fr dans Safari et recommencez.";
  } else if (appareil.android()) {
    titre = "Installer NexBim";
    etapes = [
      "Touchez le menu <b>⋮</b> en haut à droite du navigateur",
      "Choisissez <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>",
      "Confirmez avec <b>Installer</b>",
    ];
  } else {
    titre = "Installer NexBim sur l'ordinateur";
    etapes = [
      "Dans <b>Chrome</b> ou <b>Edge</b> : cliquez sur l'icône <b>Installer</b> ⊕ à droite de la barre d'adresse",
      "Puis sur <b>Installer</b>",
    ];
    note = "Firefox ne sait pas installer d'applications web : NexBim reste utilisable dans un onglet. Sur Safari (Mac) : menu Fichier › Ajouter au Dock.";
  }
  const liste = cree("ol", "nb-etapes");
  for (const e of etapes) {
    const li = cree("li");
    li.innerHTML = e;
    liste.append(li);
  }
  const corps: HTMLElement[] = [liste];
  if (note) corps.push(cree("p", "nb-feuille-note", note));
  if (appareil.integre()) {
    corps.push(
      bouton("btn", "Copier le lien", () => {
        void navigator.clipboard?.writeText(location.origin + location.pathname).then(
          () => alerte("Lien copié : collez-le dans votre navigateur."),
          () => alerte(location.origin + location.pathname),
        );
      }),
    );
  }
  feuille("📲", titre, corps);
}

// --- Notifications ----------------------------------------------------------------------------

export type EtatNotifications = "on" | "off" | "refuse" | "nosup";
let etatPush: EtatNotifications | null = null;
const pushPossible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** Service worker prêt (au plus 4 s d'attente : sans lui, pas de notifications). */
function travailleur(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, non) => window.setTimeout(() => non(new Error("service worker absent")), 4000)),
  ]);
}

export async function etatNotifications(): Promise<EtatNotifications> {
  let e: EtatNotifications = "off";
  try {
    if (!pushPossible()) e = "nosup";
    else if (Notification.permission === "denied") e = "refuse";
    else {
      const r = await travailleur();
      const s = await r.pushManager.getSubscription();
      e = s && Notification.permission === "granted" ? "on" : "off";
    }
  } catch {
    e = "nosup";
  }
  etatPush = e;
  return e;
}

function octets(base64: string) {
  const b = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

/** Demande l'autorisation, abonne l'appareil et envoie une notification d'essai. */
export async function activerNotifications(): Promise<boolean> {
  if (!pushPossible()) {
    if (appareil.ios() && !autonome()) {
      feuille("🔔", "D'abord installer l'appli", [
        cree(
          "p",
          "nb-feuille-texte",
          "Sur iPhone et iPad, les notifications ne marchent qu'avec l'appli installée : ajoutez NexBim à l'écran d'accueil, ouvrez-le depuis son icône, puis activez les notifications.",
        ),
        bouton("btn principal", "Installer l'appli", () => {
          fermerFeuille();
          void installer();
        }),
      ]);
    } else alerte("Ce navigateur ne permet pas les notifications. Essayez Chrome, Edge ou Safari.", 4500);
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      if (permission === "denied") aideDeblocage();
      else alerte("Notifications non activées.");
      await etatNotifications();
      void signaler(true);
      return false;
    }
    let { data: cle } = await nuage.rpc("vapid_publique");
    if (!cle) cle = (await appeler<{ cle: string }>("notifications", { action: "preparer" })).data?.cle ?? null;
    if (!cle) throw new Error("clé publique indisponible");
    const r = await travailleur();
    let s = await r.pushManager.getSubscription();
    if (!s) s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets(String(cle)) });
    const j = s.toJSON();
    const { data: ok, error } = await nuage.rpc("push_abonner", {
      p_endpoint: j.endpoint,
      p_p256dh: j.keys?.p256dh,
      p_auth: j.keys?.auth,
      p_ua: ua.slice(0, 200),
    });
    if (error || ok !== true) throw new Error(error?.message ?? "abonnement refusé");
    etatPush = "on";
    alerte("🔔 Notifications activées.", 3000);
    void appeler("notifications", { action: "tester" });
    void signaler(true);
    majApres?.();
    return true;
  } catch (e) {
    console.warn("notifications", e);
    alerte("Activation impossible pour l'instant. Réessayez.");
    await etatNotifications();
    return false;
  }
}

export async function desactiverNotifications() {
  try {
    const r = await travailleur();
    const s = await r.pushManager.getSubscription();
    if (s) {
      await nuage.rpc("push_desabonner", { p_endpoint: s.endpoint });
      await s.unsubscribe();
    }
  } catch {
    // Déjà désabonné.
  }
  etatPush = "off";
  alerte("Notifications désactivées sur cet appareil.");
  void signaler(true);
  majApres?.();
}

function aideDeblocage() {
  const liste = cree("ol", "nb-etapes");
  liste.innerHTML =
    "<li>Touchez le <b>cadenas 🔒</b> (ou ⓘ) à gauche de l'adresse, ou ouvrez les <b>réglages</b> de l'appli NexBim</li><li>Choisissez <b>Notifications</b> → <b>Autoriser</b></li><li>Revenez ici et activez les notifications</li>";
  feuille("🔕", "Notifications bloquées", [
    cree("p", "nb-feuille-texte", "Elles ont été refusées pour NexBim sur cet appareil. Pour les autoriser :"),
    liste,
  ]);
}

// Notification reçue alors que NexBim est à l'écran : on l'affiche dans l'appli.
navigator.serviceWorker?.addEventListener("message", (e) => {
  const d = (e.data ?? {}) as { nexbimNotif?: boolean; titre?: string; texte?: string };
  if (d.nexbimNotif && d.titre) alerte(d.texte ? `${d.titre} · ${d.texte}` : d.titre, 5000);
});

// --- Présence ---------------------------------------------------------------------------------

let lieuActuel: () => [string, string] = () => ["projets", ""];
let dernierSignal = "";
let dernierEnvoi = 0;
let attenteSignal = 0;

async function signaler(force = false) {
  if (document.visibilityState !== "visible") return;
  const [lieu, detail] = lieuActuel();
  const installe = appliInstallee();
  if (etatPush === null) await etatNotifications();
  const cle = [lieu, detail, installe, etatPush].join("|");
  const maintenant = Date.now();
  if (!force && cle === dernierSignal && maintenant - dernierEnvoi < 45_000) return;
  dernierSignal = cle;
  dernierEnvoi = maintenant;
  const { error } = await nuage.rpc("nexbim_ping", {
    p_lieu: lieu,
    p_detail: detail,
    p_installe: installe,
    p_push: etatPush,
    p_app: appareil.type(),
  });
  if (error) console.warn("présence", error.message);
}

/** Le lieu a changé (projet ouvert, visite…) : signalé dans la seconde et demie. */
export function lieuChange() {
  window.clearTimeout(attenteSignal);
  attenteSignal = window.setTimeout(() => void signaler(), 1500);
}

let majApres: (() => void) | null = null;

/** Après la connexion : présence, puis propositions d'installer l'appli et d'activer les notifications. */
export function demarrerAppli(lieu: () => [string, string], apresChangement?: () => void) {
  lieuActuel = lieu;
  majApres = apresChangement ?? null;
  void signaler(true);
  window.setInterval(() => void signaler(), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void signaler();
  });
  window.addEventListener("nexbim-installable", () => {
    void signaler(true);
    majApres?.();
  });
  planifierPropositions();
}

// --- Propositions (installer, puis notifications) ---------------------------------------------

const DELAI_PROPOSITION = 2 * 60_000; // d'utilisation, onglet visible
const REPORT = 5 * 24 * 3600_000; // « Plus tard » : on ne redemande pas avant 5 jours
let utilise = 0;
let carte: HTMLElement | null = null;

function reporte(cle: string) {
  return Date.now() < Number(memoire.lire(cle) ?? 0);
}

function planifierPropositions() {
  let avant = Date.now();
  const tic = window.setInterval(() => {
    const t = Date.now();
    if (document.visibilityState === "visible") utilise += t - avant;
    avant = t;
    if (utilise < DELAI_PROPOSITION || carte || document.querySelector(".nb-accueil")) return;
    void proposer().then((fait) => fait && window.clearInterval(tic));
  }, 5000);
}

/** Propose la prochaine étape utile ; renvoie vrai quand il n'y a plus rien à proposer. */
async function proposer(): Promise<boolean> {
  if (!appliInstallee() && !reporte("nexbim-proposer-installation")) {
    if (!appareil.integre() || appareil.ios() || appareil.android()) {
      afficherCarte(
        "📲",
        "Installer NexBim",
        demandeInstallation() ? "En un clic, comme une vraie appli" : "Sur l'écran d'accueil, en plein écran",
        "Installer",
        () => void installer(),
        "nexbim-proposer-installation",
      );
      return false;
    }
  }
  const e = await etatNotifications();
  if (e === "off" && !reporte("nexbim-proposer-notifications") && !(appareil.ios() && !autonome())) {
    afficherCarte(
      "🔔",
      "Activer les notifications",
      "Nouvelle maquette, invité qui rejoint votre projet…",
      "Activer",
      () => void activerNotifications(),
      "nexbim-proposer-notifications",
    );
    return false;
  }
  return true;
}

function afficherCarte(icone: string, titre: string, texte: string, action: string, faire: () => void, cleReport: string) {
  carte?.remove();
  const c = cree("div", "nb-proposition");
  c.setAttribute("role", "dialog");
  const ic = cree("span", "nb-proposition-icone", icone);
  const t = cree("div", "nb-proposition-texte");
  t.append(cree("strong", "", titre), cree("small", "", texte));
  const fermerCarte = () => {
    c.classList.add("sortie");
    window.setTimeout(() => c.remove(), 250);
    carte = null;
  };
  c.append(
    ic,
    t,
    bouton("btn principal", action, () => {
      fermerCarte();
      faire();
      // La suivante (notifications) viendra un peu plus tard.
      utilise = DELAI_PROPOSITION - 60_000;
    }),
    bouton("nb-proposition-fermer", "✕", () => {
      memoire.ecrire(cleReport, String(Date.now() + REPORT));
      fermerCarte();
      utilise = 0;
    }, "Plus tard"),
  );
  document.body.append(c);
  carte = c;
}

// --- Petite feuille d'explications --------------------------------------------------------------

let feuilleOuverte: HTMLElement | null = null;
export function fermerFeuille() {
  feuilleOuverte?.remove();
  feuilleOuverte = null;
}
export function feuille(icone: string, titre: string, contenu: HTMLElement[]) {
  fermerFeuille();
  const fond = cree("div", "nb-feuille-fond");
  const f = cree("div", "nb-feuille");
  f.setAttribute("role", "dialog");
  f.append(cree("div", "nb-feuille-icone", icone), cree("h2", "nb-feuille-titre", titre), ...contenu);
  f.append(bouton("btn nb-feuille-ok", "J'ai compris", fermerFeuille));
  fond.append(f);
  fond.addEventListener("pointerdown", (e) => e.target === fond && fermerFeuille());
  document.body.append(fond);
  feuilleOuverte = fond;
}
