// Thème de l'appli : sombre (par défaut) ou clair, comme les visionneuses BIM habituelles
// (fond clair, panneaux blancs). Il change l'interface et le fond de la scène 3D ; le choix
// est gardé sur l'appareil. Le thème est posé dès le chargement de la page (index.html).
import * as THREE from "three";
import { monde, rafraichir, Signal } from "./noyau";
import { couleurSelection } from "./apparence";

export type Theme = "sombre" | "clair";
const CLE = "nexbim-theme";

export const themeModifie = new Signal<Theme>();
let theme: Theme = document.documentElement.dataset.theme === "clair" ? "clair" : "sombre";
export const themeActuel = () => theme;

// Fond sombre : gris anthracite uni. Fond clair : dégradé gris-bleu très léger vers le blanc.
const FOND_SOMBRE = new THREE.Color("#262b32");
let fondClair: THREE.Texture | null = null;
function degradeClair() {
  if (fondClair) return fondClair;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const g = c.getContext("2d")!;
  const d = g.createLinearGradient(0, 0, 0, c.height);
  d.addColorStop(0, "#d9e1e8");
  d.addColorStop(0.55, "#eaeef2");
  d.addColorStop(1, "#f7f8fa");
  g.fillStyle = d;
  g.fillRect(0, 0, c.width, c.height);
  fondClair = new THREE.CanvasTexture(c);
  fondClair.colorSpace = THREE.SRGBColorSpace;
  return fondClair;
}

function appliquer() {
  if (theme === "clair") document.documentElement.dataset.theme = "clair";
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "clair" ? "#ffffff" : "#0f1318");
  monde.scene.three.background = theme === "clair" ? degradeClair() : FOND_SOMBRE;
  // Jaune néon sur fond sombre ; orange vif sur fond clair, où le jaune ne se verrait pas.
  couleurSelection(theme === "clair" ? 0xff5a00 : 0xe8ff1a);
  void rafraichir();
}

export function definirTheme(t: Theme) {
  if (t === theme) return;
  theme = t;
  try {
    localStorage.setItem(CLE, t);
  } catch {
    // Gardé pour la session seulement.
  }
  appliquer();
  themeModifie.emit(t);
}

export const basculerTheme = () => definirTheme(theme === "clair" ? "sombre" : "clair");

appliquer();
