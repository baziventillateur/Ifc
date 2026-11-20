// Boutons ↶ ↷ : annuler / rétablir la dernière action (masquage, couleurs, déplacement…),
// comme Ctrl+Z et Ctrl+Y. Ils n'apparaissent qu'une fois une action faite ; les mouvements
// de caméra (zoom, rotation) ne sont pas des actions.
import { aAnnuler, annuler, aRetablir, historiqueModifie, peutAnnuler, peutRetablir, retablir } from "./historique";
import { el } from "./noyau";

const zone = el("annuler-refaire");
const btnAnnuler = el<HTMLButtonElement>("btn-annuler");
const btnRetablir = el<HTMLButtonElement>("btn-retablir");

function maj() {
  const a = peutAnnuler();
  const r = peutRetablir();
  zone.hidden = !a && !r;
  btnAnnuler.disabled = !a;
  btnRetablir.disabled = !r;
  btnAnnuler.title = a ? `Annuler : ${aAnnuler()} (Ctrl+Z)` : "Rien à annuler";
  btnRetablir.title = r ? `Rétablir : ${aRetablir()} (Ctrl+Y)` : "Rien à rétablir";
}

btnAnnuler.addEventListener("click", () => void annuler());
btnRetablir.addEventListener("click", () => void retablir());
historiqueModifie.on(maj);
maj();
