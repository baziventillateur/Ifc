// Point d'entrée : commandes de la barre du haut, outils, démarrage.
import { definirProjection, el, estOrtho, fragments, lanceur, monde, projectionModifiee } from "./noyau";
import { maquettes } from "./registre";
import { recadrer } from "./maquettes";
import { attendreSession } from "./nuage/compte";
import { demanderDepot, demarrerNuage, deposer } from "./nuage/projets";
import "./fiche";
import "./pivot";

// Outils, dans l'ordre de la barre.
import "./selection";
import "./menu-selection";
import "./outils/coupe";
import "./outils/mesure";
import "./outils/filtres";
import "./outils/recherche";
import "./outils/quantites";
import "./outils/clashs";
import "./outils/modifier";
import "./outils/remarques";
import "./outils/assistant";
import "./outils/styles";

const champFichier = el<HTMLInputElement>("fichier");
const depot = el("depot");
const aide = el("aide");

el("btn-ajouter").addEventListener("click", () => {
  if (demanderDepot()) champFichier.click();
});
el("btn-recadrer").addEventListener("click", () => void recadrer());

// Vue orthogonale (sans perspective) ou en perspective : un seul bouton, et la touche O.
const btnOrtho = el("btn-ortho");
const basculerProjection = () => void definirProjection(estOrtho() ? "Perspective" : "Orthographic");
btnOrtho.addEventListener("click", basculerProjection);
projectionModifiee.on(() => {
  btnOrtho.classList.toggle("actif", estOrtho());
  btnOrtho.setAttribute("aria-pressed", String(estOrtho()));
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "o" && e.key !== "O") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const cible = e.target as HTMLElement | null;
  if (cible?.closest("input, textarea, select, [contenteditable]")) return;
  basculerProjection();
});

champFichier.addEventListener("change", () => {
  const fichiers = [...(champFichier.files ?? [])];
  champFichier.value = "";
  if (fichiers.length > 0) void deposer(fichiers);
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
  const fichiers = [...(e.dataTransfer?.files ?? [])];
  if (fichiers.length > 0) void deposer(fichiers);
});

window.setTimeout(() => aide.classList.add("cache"), 9000);

async function demarrer() {
  await demarrerNuage(await attendreSession());
}
void demarrer();

if (import.meta.env.DEV) {
  (window as any).__visio = { fragments, monde, maquettes, lanceur };
  import("./apparence").then((a) => ((window as any).__visio.apparence = a));
}
