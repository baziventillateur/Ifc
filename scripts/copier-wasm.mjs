// Copie le moteur de lecture IFC (web-ifc) dans public/wasm pour qu'il soit
// servi par le site lui-même, sans dépendre d'un serveur tiers.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(racine, "node_modules", "web-ifc");
const cible = join(racine, "public", "wasm");

mkdirSync(cible, { recursive: true });
for (const fichier of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  copyFileSync(join(source, fichier), join(cible, fichier));
}
console.log("Moteur IFC copié dans public/wasm");
