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
  const etat = cree("p", "dialogue-texte", `Version ${VERSION.numero} du ${quand(VERSION.date)}`);
  const liste = cree("div", "versions-liste");
  for (const v of VERSION.historique) {
    const ligne = cree("div", "versions-ligne");
    const titre = v.titre.length > 110 ? `${v.titre.slice(0, 108)}…` : v.titre;
    ligne.append(cree("span", "versions-numero", v.numero), cree("span", "versions-titre", titre), cree("span", "versions-date", quand(v.date)));
    liste.append(ligne);
  }
  const verifierBtn = bouton("btn principal", "Vérifier les mises à jour", async () => {
    verifierBtn.disabled = true;
    verifierBtn.textContent = "Vérification…";
    try {
      if (await nouvelleVersionEnLigne()) {
        location.reload();
        return;
      }
      etat.textContent = `Version ${VERSION.numero} du ${quand(VERSION.date)} : vous êtes à jour.`;
    } catch {
      alerte("Vérification impossible : pas de connexion ?");
    }
    verifierBtn.disabled = false;
    verifierBtn.textContent = "Vérifier les mises à jour";
  });
  const pied = cree("div", "dialogue-pied");
  pied.append(bouton("btn", "Fermer", fermer), verifierBtn);
  boite.append(cree("div", "dialogue-titre", "NexBim · versions"), etat);
  if (VERSION.historique.length) boite.append(cree("div", "groupe-titre", "Dernières nouveautés"), liste);
  boite.append(pied);
  fond.append(boite);
  fond.addEventListener("pointerdown", (e) => {
    if (e.target === fond) fermer();
  });
  window.addEventListener("keydown", clavier, true);
  document.body.append(fond);
}

if (actuel) {
  document.addEventListener("visibilitychange", () => void verifier());
  window.addEventListener("focus", () => void verifier());
  window.setInterval(() => void verifier(), 5 * 60_000);
  // Au démarrage aussi : la page peut venir du cache du téléphone.
  window.setTimeout(() => void verifier(), 4000);
}
