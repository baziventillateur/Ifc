// Bouton plein écran (à côté des boutons ronds de la vue). Mis en avant à l'entrée de la
// visite à la première personne. Caché quand le navigateur ne le permet pas (iPhone).
import { alerte, el } from "./noyau";

const btn = el<HTMLButtonElement>("btn-plein-ecran");
const doc = document as Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
const possible = !!(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
const enPleinEcran = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);

const AGRANDIR =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const REDUIRE =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

function maj() {
  const plein = enPleinEcran();
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

/** Visite à la première personne : le bouton clignote doucement tant qu'on n'est pas en plein écran. */
export function inviterPleinEcran(oui: boolean) {
  btn.classList.toggle("invite", oui && possible && !enPleinEcran());
}
