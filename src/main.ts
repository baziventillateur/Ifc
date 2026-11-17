// Point d'entrée : commandes de la barre du haut, outils, démarrage.
import { el, fragments, monde } from "./noyau";
import { maquettes } from "./registre";
import { ajouterIfc, chargerExemple, exempleAffiche, recadrer, rouvrirMemorisees } from "./maquettes";
import "./fiche";

// Outils, dans l'ordre de la barre.
import "./outils/coupe";
import "./outils/mesure";
import "./outils/filtres";
import "./outils/recherche";
import "./outils/quantites";
import "./outils/clashs";
import "./outils/remarques";
import "./outils/assistant";

const champFichier = el<HTMLInputElement>("fichier");
const depot = el("depot");
const aide = el("aide");

el("btn-ajouter").addEventListener("click", () => champFichier.click());
el("btn-exemple").addEventListener("click", () => {
  if (
    !exempleAffiche() &&
    maquettes.size > 0 &&
    !window.confirm("Retirer vos maquettes (aussi de la mémoire de l'appareil) et afficher l'exemple ?")
  )
    return;
  void chargerExemple();
});
el("btn-recadrer").addEventListener("click", () => void recadrer());

champFichier.addEventListener("change", () => {
  const fichiers = [...(champFichier.files ?? [])];
  champFichier.value = "";
  if (fichiers.length > 0) void ajouterIfc(fichiers);
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
  if (fichiers.length > 0) void ajouterIfc(fichiers);
});

window.setTimeout(() => aide.classList.add("cache"), 9000);

async function demarrer() {
  if (!(await rouvrirMemorisees())) await chargerExemple();
}
void demarrer();

if (import.meta.env.DEV) {
  (window as any).__visio = { fragments, monde, maquettes };
  import("./apparence").then((a) => ((window as any).__visio.apparence = a));
}
