// Bouton plein écran (à côté des boutons ronds de la vue). Mis en avant à l'entrée de la
// visite à la première personne. Caché quand le navigateur ne le permet pas (iPhone).
// En plein écran, les deux barres du haut disparaissent : il reste « NexBim ▾ » en blanc
// discret, qui les fait réapparaître ; les panneaux se replient pour dégager la vue.
import { alerte, bouton, el, Signal } from "./noyau";
import { replierCalques } from "./maquettes";

/** Émis à l'entrée (true) et à la sortie (false) du plein écran. */
export const pleinEcranModifie = new Signal<boolean>();

const poignee = bouton("poignee-menu", "", () => {
  document.body.classList.toggle("menu-visible");
  majPoignee();
});
document.body.append(poignee);
function majPoignee() {
  const visible = document.body.classList.contains("menu-visible");
  poignee.innerHTML = visible ? "<span>▴</span>" : 'NexBim <span>▾</span>';
  poignee.setAttribute("aria-label", visible ? "Masquer le menu" : "Afficher le menu");
  poignee.title = visible ? "Masquer le menu" : "Afficher le menu";
}

const btn = el<HTMLButtonElement>("btn-plein-ecran");
const doc = document as Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
const possible = !!(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
const enPleinEcran = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);

const AGRANDIR =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const REDUIRE =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

let etaitPlein = false;
function maj() {
  const plein = enPleinEcran();
  document.body.classList.toggle("plein-ecran", plein);
  if (plein !== etaitPlein) {
    etaitPlein = plein;
    document.body.classList.remove("menu-visible");
    majPoignee();
    if (plein) replierCalques(true);
    pleinEcranModifie.emit(plein);
  }
  btn.innerHTML = plein ? REDUIRE : AGRANDIR;
  btn.classList.toggle("actif", plein);
  btn.setAttribute("aria-pressed", String(plein));
  btn.setAttribute("aria-label", plein ? "Quitter le plein écran" : "Plein écran");
  btn.title = plein ? "Quitter le plein écran" : "Plein écran";
  if (plein) btn.classList.remove("invite");
}

btn.hidden = !possible;
btn.addEventListener("click", async () => {
  btn.classList.remove("invite");
  pleinAuto = false;
  try {
    if (enPleinEcran()) await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    else {
      const racine = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      await (racine.requestFullscreen?.({ navigationUI: "hide" }) ?? racine.webkitRequestFullscreen?.());
    }
  } catch {
    alerte("Le plein écran n'est pas disponible ici.", 3000);
  }
});
document.addEventListener("fullscreenchange", maj);
document.addEventListener("webkitfullscreenchange", maj);
maj();

// --- Téléphone tourné à l'horizontale : mode immersif automatique ------------------------
// Rien en haut (les barres se cachent, voir style.css), panneaux repliés ; le vrai plein
// écran (sans barres du navigateur) se lance au premier toucher, le navigateur l'exige.
const paysage = window.matchMedia("(orientation: landscape) and (max-height: 520px)");
let pleinAuto = false;
async function pleinAuToucher() {
  window.removeEventListener("pointerup", pleinAuToucher, true);
  if (!paysage.matches || enPleinEcran() || !possible) return;
  try {
    const racine = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    await (racine.requestFullscreen?.({ navigationUI: "hide" }) ?? racine.webkitRequestFullscreen?.());
    pleinAuto = true;
  } catch {
    // Refusé : la mise en page immersive reste.
  }
}
function suivreOrientation() {
  document.body.classList.toggle("paysage", paysage.matches);
  if (paysage.matches) {
    document.body.classList.remove("menu-visible");
    majPoignee();
    replierCalques(true);
    pleinEcranModifie.emit(true);
    window.addEventListener("pointerup", pleinAuToucher, true);
  } else {
    window.removeEventListener("pointerup", pleinAuToucher, true);
    // Plein écran lancé par la rotation : on en sort en revenant à la verticale.
    if (pleinAuto && enPleinEcran()) void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    pleinAuto = false;
  }
}
paysage.addEventListener("change", suivreOrientation);
if (paysage.matches) suivreOrientation();

/** Visite à la première personne : le bouton clignote doucement tant qu'on n'est pas en plein écran. */
export function inviterPleinEcran(oui: boolean) {
  btn.classList.toggle("invite", oui && possible && !enPleinEcran());
}
