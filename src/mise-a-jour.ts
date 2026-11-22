// Version de l'appli : numéro discret en bas de l'écran, détail et dernières nouveautés
// au toucher, et avis quand une nouvelle version a été publiée (un téléphone garde
// souvent la page ouverte des heures et ne verrait pas les nouveautés sans recharger).
import { alerte, bouton, cree } from "./noyau";

declare const __VERSION__: {
  numero: string;
  date: string;
  historique: { numero: string; date: string; titre: string }[];
};
const VERSION = __VERSION__;

const actuel = [...document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
  .map((s) => s.getAttribute("src") ?? "")
  .find((src) => /assets\/index-/.test(src));
let annonce = false;
let dernier = 0;

function quand(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  return `${jour} à ${heure}`;
}

/** Vrai si une version plus récente que celle affichée est en ligne. */
async function nouvelleVersionEnLigne() {
  if (!actuel) return false;
  const page = await fetch(`./?v=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
  const publie = page.match(/assets\/index-[^"']+\.js/)?.[0];
  return !!publie && !actuel.endsWith(publie);
}

function annoncer() {
  if (annonce) return;
  annonce = true;
  etiquette.classList.add("perimee");
  const bandeau = cree("div", "maj-dispo");
  bandeau.append(
    cree("span", "", "Nouvelle version disponible"),
    bouton("btn principal", "Recharger", () => location.reload()),
  );
  document.body.append(bandeau);
}

async function verifier() {
  if (annonce || document.hidden) return;
  if (Date.now() - dernier < 60_000) return;
  dernier = Date.now();
  try {
    if (await nouvelleVersionEnLigne()) annoncer();
  } catch {
    // Hors ligne : on réessaiera.
  }
}

// --- Étiquette et fenêtre des versions ----------------------------------------------

const etiquette = bouton("version-etiquette", `v${VERSION.numero}`, ouvrir, "Version de NexBim");
document.body.append(etiquette);

/** Fenêtre des versions (aussi ouverte depuis le menu du compte). */
export function ouvrirVersions() {
  ouvrir();
}

/** Numéro de la version affichée (noté dans le profil à l'ouverture). */
export const numeroVersion = VERSION.numero;

const numeroDe = (v: string) => Number(v.split(".")[1] ?? 0);

/** Titre court, sans détail : le sujet, et pour un sujet d'un mot (« Visite : … ») sa
 * première idée ; coupé avant les parenthèses, virgules et points-virgules. */
function titreCourt(t: string) {
  const [sujet, ...reste] = t.split(" : ");
  let c = sujet.trim();
  if (reste.length && c.split(/\s+/).length <= 2) c = `${c} : ${reste.join(" : ")}`;
  c = c.split(/ ; | — | \(|, /)[0].trim();
  if (c.length > 48) c = `${c.slice(0, 48).replace(/\s+\S*$/, "")}…`;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function ouvrir() {
  const fond = cree("div", "dialogue-fond au-dessus");
  const boite = cree("div", "dialogue versions");
  boite.setAttribute("role", "dialog");
  const fermer = () => {
    fond.remove();
    window.removeEventListener("keydown", clavier, true);
  };
  const clavier = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      fermer();
    }
  };
  const etat = cree("p", "dialogue-texte", "");
  const corps = cree("div", "versions-corps");
  const verifierBtn = bouton("btn principal", "Vérifier les mises à jour", async () => {
    verifierBtn.disabled = true;
    verifierBtn.textContent = "Vérification…";
    try {
      if (await nouvelleVersionEnLigne()) {
        location.reload();
        return;
      }
      etat.dataset.ajour = "1";
      etat.textContent = texteEtat(admin);
    } catch {
      alerte("Vérification impossible : pas de connexion ?");
    }
    verifierBtn.disabled = false;
    verifierBtn.textContent = "Vérifier les mises à jour";
  });
  let admin = false;
  const texteEtat = (a: boolean) =>
    a
      ? `Version ${VERSION.numero} du ${quand(VERSION.date)}${etat.dataset.ajour ? " : vous êtes à jour." : ""}`
      : `Version ${VERSION.numero}${etat.dataset.ajour ? " : vous êtes à jour." : ""}`;
  const pied = cree("div", "dialogue-pied");
  pied.append(bouton("btn", "Fermer", fermer), verifierBtn);
  boite.append(cree("div", "dialogue-titre", "NexBim · versions"), etat, corps, pied);
  fond.append(boite);
  fond.addEventListener("pointerdown", (e) => {
    if (e.target === fond) fermer();
  });
  window.addEventListener("keydown", clavier, true);
  document.body.append(fond);
  etat.textContent = texteEtat(false);
  remplirPublic(corps);
  // L'administrateur voit tout le détail, et qui est sur quelle version.
  void import("./nuage/projets").then(({ estAdmin }) => {
    if (!estAdmin() || !fond.isConnected) return;
    admin = true;
    etat.textContent = texteEtat(true);
    void remplirAdmin(corps);
  });
}

// --- Public : la version actuelle, puis les grandes étapes de 10 en 10, sans date ---------

function remplirPublic(corps: HTMLElement) {
  corps.replaceChildren();
  const parDizaine = new Map<number, string[]>();
  for (const v of VERSION.historique) {
    const d = Math.floor(numeroDe(v.numero) / 10) * 10;
    const liste = parDizaine.get(d) ?? [];
    const t = titreCourt(v.titre);
    if (!liste.includes(t)) liste.push(t);
    parDizaine.set(d, liste);
  }
  if (!parDizaine.size) return;
  const liste = cree("div", "versions-liste");
  for (const [d, themes] of parDizaine) {
    const ligne = cree("div", "versions-ligne");
    ligne.append(cree("span", "versions-numero", `1.${d}`), cree("span", "versions-titre", themes.slice(0, 3).join(" · ")));
    liste.append(ligne);
  }
  corps.append(cree("div", "groupe-titre", "Grandes étapes"), liste);
}

// --- Administrateur : le détail, et les personnes restées sur chaque version ---------------

type Personne = {
  id: string;
  email: string;
  prenom: string;
  version_app: string | null;
  version_le: string | null;
  rappel_version_le: string | null;
  derniere_connexion: string | null;
};

function initiales(p: Personne) {
  const mots = p.prenom.trim().split(/\s+/).filter(Boolean);
  const local = p.email.split("@")[0].split(/[._-]+/).filter(Boolean);
  let i = "";
  if (mots.length >= 2) i = mots[0][0] + mots[1][0];
  else if (mots.length === 1) i = mots[0][0] + (local[1]?.[0] ?? mots[0][1] ?? "");
  else i = (local[0]?.[0] ?? "?") + (local[1]?.[0] ?? local[0]?.[1] ?? "");
  return i.toUpperCase();
}
function teinte(id: string) {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
  // Angle d'or : deux comptes voisins ont des couleurs bien différentes.
  return Math.round((h * 137.508) % 360);
}
function avatar(p: Personne, classe = "versions-avatar") {
  const a = cree("span", classe, initiales(p));
  a.style.background = `hsl(${teinte(p.id)}, 42%, 38%)`;
  a.title = p.prenom || p.email;
  return a;
}
const nomDe = (p: Personne) => p.prenom.trim() || p.email.split("@")[0];
const ilYa = (iso: string | null) => {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return "il y a moins d'1 h";
  if (h < 48) return `il y a ${Math.round(h)} h`;
  return `il y a ${Math.round(h / 24)} j`;
};

/** Pastilles en quinconce (4 au plus, puis « +N ») ; au toucher, la liste des personnes. */
function pastilles(gens: Personne[], ouvrirListe: () => void) {
  const b = cree("button", "versions-pastilles");
  b.type = "button";
  b.setAttribute("aria-label", `${gens.length} personne${gens.length > 1 ? "s" : ""} sur cette version`);
  gens.slice(0, 4).forEach((p, i) => {
    const a = avatar(p);
    if (i % 2) a.classList.add("bas");
    b.append(a);
  });
  if (gens.length > 4) b.append(cree("span", "versions-avatar plus", `+${gens.length - 4}`));
  b.addEventListener("click", ouvrirListe);
  return b;
}

function listePersonnes(gens: Personne[], aJour: boolean) {
  const bloc = cree("div", "versions-personnes");
  for (const p of gens) {
    const ligne = cree("div", "versions-personne");
    const texte = cree("div", "versions-personne-texte");
    texte.append(cree("strong", "", nomDe(p)), cree("span", "", p.email));
    const vu = cree("span", "versions-personne-vu", p.version_le ? ilYa(p.version_le) : "pas encore vu");
    ligne.append(avatar(p, "versions-avatar grand"), texte, vu);
    if (!aJour) {
      const recent = p.rappel_version_le && Date.now() - new Date(p.rappel_version_le).getTime() < 12 * 3600_000;
      const prevenir = bouton("versions-prevenir", recent ? `Prévenu ${ilYa(p.rappel_version_le)}` : "Prévenir", async () => {
        prevenir.disabled = true;
        prevenir.textContent = "Envoi…";
        const { appeler } = await import("./nuage/client");
        const { code } = await appeler<{ ok?: boolean }>("rappel-version", { utilisateur: p.id, version: VERSION.numero });
        prevenir.textContent = !code
          ? "Prévenu ✓"
          : code === "TROP_TOT"
            ? "Déjà prévenu (< 12 h)"
            : code === "A_JOUR"
              ? "Déjà à jour"
              : code === "ENVOI"
                ? "Envoi impossible"
                : "Erreur";
        if (code && code !== "TROP_TOT" && code !== "A_JOUR") prevenir.disabled = false;
      }, "Envoyer un e-mail : une nouvelle version est disponible");
      if (recent) prevenir.disabled = true;
      ligne.append(prevenir);
    }
    bloc.append(ligne);
  }
  return bloc;
}

async function remplirAdmin(corps: HTMLElement) {
  corps.replaceChildren();
  const resume = cree("p", "versions-resume", "Qui est sur quelle version…");
  const liste = cree("div", "versions-liste admin");
  corps.append(resume, cree("div", "groupe-titre", "Toutes les versions"), liste);

  let gens: Personne[] = [];
  try {
    const { nuage } = await import("./nuage/client");
    const { data, error } = await nuage.rpc("admin_versions");
    if (error) throw error;
    gens = (data ?? []) as Personne[];
  } catch (e) {
    console.warn("admin_versions", e);
    resume.textContent = "Impossible de lire les versions des comptes.";
  }
  const parVersion = new Map<string, Personne[]>();
  for (const p of gens) {
    const cle = p.version_app ?? "";
    parVersion.set(cle, [...(parVersion.get(cle) ?? []), p]);
  }
  if (gens.length) {
    const aJour = parVersion.get(VERSION.numero)?.length ?? 0;
    const inconnus = parVersion.get("")?.length ?? 0;
    resume.textContent = `${gens.length} compte${gens.length > 1 ? "s" : ""} · ${aJour} à jour · ${gens.length - aJour - inconnus} sur une version précédente${inconnus ? ` · ${inconnus} pas encore vu${inconnus > 1 ? "s" : ""}` : ""}`;
  }

  const lignes: HTMLElement[] = [];
  const LIMITE = 8;
  VERSION.historique.forEach((v, i) => {
    const ligne = cree("div", "versions-ligne");
    const titre = v.titre.length > 110 ? `${v.titre.slice(0, 108)}…` : v.titre;
    ligne.append(cree("span", "versions-numero", v.numero), cree("span", "versions-titre", titre), cree("span", "versions-date", quand(v.date)));
    const ici = parVersion.get(v.numero) ?? [];
    if (ici.length) {
      let ouverte: HTMLElement | null = null;
      ligne.append(
        pastilles(ici, () => {
          if (ouverte) {
            ouverte.remove();
            ouverte = null;
            return;
          }
          ouverte = listePersonnes(ici, v.numero === VERSION.numero);
          ligne.after(ouverte);
        }),
      );
      ligne.classList.add("avec-gens");
    }
    // Les 8 dernières, et toujours celles où quelqu'un est resté.
    if (i >= LIMITE && !ici.length) ligne.hidden = true;
    lignes.push(ligne);
    liste.append(ligne);
  });
  // Versions inconnues (pas encore vues depuis le suivi, ou trop anciennes).
  const autres = gens.filter((p) => !p.version_app || !VERSION.historique.some((v) => v.numero === p.version_app));
  if (autres.length) {
    const ligne = cree("div", "versions-ligne avec-gens");
    ligne.append(cree("span", "versions-numero", "?"), cree("span", "versions-titre", "Pas encore vus depuis le suivi des versions"));
    let ouverte: HTMLElement | null = null;
    ligne.append(
      pastilles(autres, () => {
        if (ouverte) {
          ouverte.remove();
          ouverte = null;
          return;
        }
        ouverte = listePersonnes(autres, false);
        ligne.after(ouverte);
      }),
    );
    liste.append(ligne);
  }
  const cachees = lignes.filter((l) => l.hidden).length;
  if (cachees) {
    const tout = bouton("lien versions-tout", `Tout voir (${cachees} de plus)`, () => {
      for (const l of lignes) l.hidden = false;
      tout.remove();
    });
    liste.after(tout);
  }
}

if (actuel) {
  document.addEventListener("visibilitychange", () => void verifier());
  window.addEventListener("focus", () => void verifier());
  window.setInterval(() => void verifier(), 5 * 60_000);
  // Au démarrage aussi : la page peut venir du cache du téléphone.
  window.setTimeout(() => void verifier(), 4000);
}
