// Prévient quand une nouvelle version du site a été publiée : un téléphone garde
// souvent la page ouverte des heures, et ne verrait pas les nouveautés sans recharger.
import { bouton, cree } from "./noyau";

const actuel = [...document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
  .map((s) => s.getAttribute("src") ?? "")
  .find((src) => /assets\/index-/.test(src));
let annonce = false;
let dernier = 0;

async function verifier() {
  if (!actuel || annonce || document.hidden) return;
  if (Date.now() - dernier < 60_000) return;
  dernier = Date.now();
  try {
    const page = await fetch(`./?v=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
    const publie = page.match(/assets\/index-[^"']+\.js/)?.[0];
    if (!publie || actuel.endsWith(publie)) return;
    annonce = true;
    const bandeau = cree("div", "maj-dispo");
    bandeau.append(
      cree("span", "", "Nouvelle version disponible"),
      bouton("btn principal", "Recharger", () => location.reload()),
    );
    document.body.append(bandeau);
  } catch {
    // Hors ligne : on réessaiera.
  }
}

if (actuel) {
  document.addEventListener("visibilitychange", () => void verifier());
  window.addEventListener("focus", () => void verifier());
  window.setInterval(() => void verifier(), 5 * 60_000);
}
