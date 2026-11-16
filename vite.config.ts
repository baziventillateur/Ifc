import { defineConfig } from "vite";

// Chemins relatifs : le site fonctionne tel quel sur GitHub Pages
// (https://<compte>.github.io/<depot>/) comme sur un domaine dédié.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
});
