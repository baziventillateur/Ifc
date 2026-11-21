// Barre d'outils et panneau d'outil (à gauche sur ordinateur, en bas sur téléphone).
import { ajusterDecalage, bouton, cree, el } from "../noyau";
import { pleinEcranModifie } from "../plein-ecran";

type Crochets = { ouvrir?: () => void; fermer?: () => void };
type Outil = { id: string; titre: string; bouton: HTMLButtonElement; section: HTMLElement; crochets: Crochets };

const barre = el("outils");
const panneau = el("outil");
const titre = el("outil-titre");
const corps = el("outil-corps");
const outils = new Map<string, Outil>();
let actif: string | null = null;

el("outil-fermer").addEventListener("click", () => fermerOutil());

// Replier le panneau : il ne reste que sa barre de titre, la vue est dégagée.
const btnReplier = el("outil-replier");
function replier(oui: boolean) {
  panneau.classList.toggle("replie", oui);
  btnReplier.setAttribute("aria-expanded", String(!oui));
  btnReplier.setAttribute("aria-label", oui ? "Déplier le panneau" : "Replier le panneau");
  requestAnimationFrame(() => ajusterDecalage());
}
btnReplier.addEventListener("click", () => replier(!panneau.classList.contains("replie")));
// En passant en plein écran, le panneau ouvert se replie.
pleinEcranModifie.on((plein) => plein && actif && replier(true));
titre.addEventListener("click", () => replier(!panneau.classList.contains("replie")));

// Fondu à droite quand la barre d'outils déborde (téléphone).
const majDebord = () =>
  barre.classList.toggle("deborde", barre.scrollLeft + barre.clientWidth < barre.scrollWidth - 4);
barre.addEventListener("scroll", majDebord, { passive: true });
window.addEventListener("resize", majDebord);
setTimeout(majDebord, 0);

export function enregistrerOutil(
  id: string,
  libelle: string,
  titreOutil: string,
  construire: (section: HTMLElement) => Crochets | void,
  icone?: string,
) {
  const section = cree("section", "outil-section");
  section.hidden = true;
  corps.append(section);
  const b = bouton("outil-btn", libelle, () => basculerOutil(id), titreOutil);
  b.dataset.outil = id;
  if (icone) {
    b.innerHTML = icone;
    b.classList.add("outil-icone");
    b.setAttribute("aria-label", libelle);
  }
  barre.append(b);
  const o: Outil = { id, titre: titreOutil, bouton: b, section, crochets: {} };
  outils.set(id, o);
  o.crochets = construire(section) ?? {};
}

export function ouvrirOutil(id: string) {
  if (actif === id) {
    outils.get(id)?.crochets.ouvrir?.();
    return;
  }
  fermerOutil();
  const o = outils.get(id);
  if (!o) return;
  actif = id;
  titre.textContent = o.titre;
  replier(false);
  o.section.hidden = false;
  o.bouton.classList.add("actif");
  o.bouton.scrollIntoView({ inline: "nearest", block: "nearest" });
  panneau.hidden = false;
  document.body.classList.add("outil-ouvert");
  o.crochets.ouvrir?.();
  requestAnimationFrame(() => ajusterDecalage());
}

export function fermerOutil() {
  if (!actif) return;
  const o = outils.get(actif)!;
  actif = null;
  o.section.hidden = true;
  o.bouton.classList.remove("actif");
  panneau.hidden = true;
  document.body.classList.remove("outil-ouvert");
  o.crochets.fermer?.();
  ajusterDecalage();
}

export function basculerOutil(id: string) {
  if (actif === id) fermerOutil();
  else ouvrirOutil(id);
}

export const outilActif = () => actif;

/** Pastille sur le bouton d'un outil : true = point, texte = compteur, false = rien. */
export function marquerOutil(id: string, marque: boolean | string) {
  const b = outils.get(id)?.bouton;
  if (!b) return;
  b.querySelector(".marque-outil")?.remove();
  if (marque === false || marque === "") return;
  b.append(cree("span", "marque-outil", marque === true ? "" : marque));
}
