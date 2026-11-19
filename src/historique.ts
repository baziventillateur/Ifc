// Historique commun des actions : Ctrl+Z annule la dernière, Ctrl+Y (ou Ctrl+Maj+Z)
// la refait. Chaque module y note ses actions avec de quoi les défaire et les refaire.
import { alerte, Signal } from "./noyau";

type Action = {
  libelle: string;
  annuler: () => Promise<unknown> | unknown;
  refaire: () => Promise<unknown> | unknown;
  /** Deux actions de même clé qui se suivent de près n'en font qu'une (curseur d'opacité…). */
  cle?: string;
  t?: number;
};

const faites: Action[] = [];
const defaites: Action[] = [];
let enCours: Promise<void> = Promise.resolve();
let rejoue = false;

/** Émis quand l'historique change (pour l'état des boutons). */
export const historiqueModifie = new Signal();

export const peutAnnuler = () => faites.length > 0;
export const peutRetablir = () => defaites.length > 0;
/** Vrai pendant qu'une action est annulée ou refaite : ne rien noter à ce moment-là. */
export const enRejeu = () => rejoue;

export function noter(action: Action) {
  if (rejoue) return;
  const t = performance.now();
  const derniere = faites[faites.length - 1];
  if (action.cle && derniere?.cle === action.cle && t - (derniere.t ?? 0) < 1500) {
    derniere.refaire = action.refaire;
    derniere.t = t;
  } else {
    faites.push({ ...action, t });
    if (faites.length > 100) faites.shift();
  }
  defaites.length = 0;
  historiqueModifie.emit();
}

export function viderHistorique() {
  faites.length = 0;
  defaites.length = 0;
  historiqueModifie.emit();
}

function jouer(de: Action[], vers: Action[], sens: "annuler" | "refaire", silencieux: boolean) {
  enCours = enCours.then(async () => {
    const action = de.pop();
    if (!action) {
      if (!silencieux) alerte(sens === "annuler" ? "Rien à annuler." : "Rien à rétablir.", 1800);
      return;
    }
    rejoue = true;
    try {
      const fait = Promise.resolve(action[sens]());
      vers.push(action);
      historiqueModifie.emit();
      if (!silencieux) alerte(`${sens === "annuler" ? "Annulé" : "Rétabli"} : ${action.libelle}`, 2200);
      // L'état change tout de suite ; on n'attend pas indéfiniment la fin du redessin
      // (elle peut tarder si l'onglet est en arrière-plan).
      await Promise.race([fait, new Promise((r) => setTimeout(r, 1200))]);
    } catch (e) {
      console.error(e);
      alerte("Action impossible à rejouer.");
    } finally {
      rejoue = false;
      historiqueModifie.emit();
    }
  });
  return enCours;
}

export const annuler = (silencieux = false) => jouer(faites, defaites, "annuler", silencieux);
export const retablir = (silencieux = false) => jouer(defaites, faites, "refaire", silencieux);

window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  const touche = e.key.toLowerCase();
  if (touche === "z" && !e.shiftKey) {
    e.preventDefault();
    void annuler();
  } else if (touche === "y" || (touche === "z" && e.shiftKey)) {
    e.preventDefault();
    void retablir();
  }
});
