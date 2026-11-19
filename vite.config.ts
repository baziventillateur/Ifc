import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Numéro de version : 1.<nombre de publications>, avec la date et les dernières
// nouveautés (titres des publications), lus dans l'historique git au moment du build.
function version() {
  const git = (commande: string) => execSync(`git ${commande}`, { encoding: "utf-8" }).trim();
  try {
    const total = Number(git("rev-list --count HEAD"));
    const lignes = git('log -15 --date=iso-strict --pretty=format:%cd%x09%s').split("\n");
    return {
      numero: `1.${total}`,
      date: new Date().toISOString(),
      historique: lignes.map((ligne, i) => {
        const [date, ...titre] = ligne.split("\t");
        return { numero: `1.${total - i}`, date, titre: titre.join(" ") };
      }),
    };
  } catch {
    return { numero: "locale", date: new Date().toISOString(), historique: [] };
  }
}

// Chemins relatifs : le site fonctionne tel quel sur GitHub Pages
// (https://<compte>.github.io/<depot>/) comme sur un domaine dédié.
export default defineConfig({
  base: "./",
  define: { __VERSION__: JSON.stringify(version()) },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
});
