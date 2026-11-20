// Registre des maquettes chargées et de leur couleur de lot.
import * as THREE from "three";
import { fragments, monde, normaliser, Signal, type Modele } from "./noyau";

export type Maquette = {
  id: string;
  modele: Modele;
  couleur: THREE.Color;
  hex: string;
  /** Couleur d'origine de la maquette (celle de son lot), avant tout choix à la main. */
  hexOrigine: string;
  lot: string;
  transparente: boolean;
  /** Opacité quand la maquette est transparente (0,05 à 1). */
  opacite: number;
  exemple: boolean;
};

export const maquettes = new Map<string, Maquette>();
export const reglages = { couleurs: false };

/** Émis quand la liste des maquettes ou leur affichage change. */
export const changement = new Signal();

export const visibles = () => [...maquettes.values()].filter((m) => m.modele.object.visible);

const LOTS: { lot: string; hex: string; mots: string[] }[] = [
  { lot: "Structure", hex: "#b9c0ca", mots: ["str", "structure", "struct", "go", "ba", "beton"] },
  { lot: "Architecture", hex: "#e3cfa9", mots: ["arc", "archi", "architecture", "arch"] },
  { lot: "CVC", hex: "#4f8ff7", mots: ["cvc", "hvac", "ventilation", "vmc", "clim", "chauffage", "cvd"] },
  { lot: "Plomberie", hex: "#34c472", mots: ["pb", "plb", "plomberie", "sanitaire", "plu", "ecs", "eu", "ev", "ef"] },
  { lot: "Électricité", hex: "#f5c518", mots: ["elec", "ele", "cfo", "cfa", "electricite", "courants"] },
  { lot: "Sécurité incendie", hex: "#ef5350", mots: ["spk", "sprinkler", "ssi", "incendie", "desenfumage", "ria"] },
  { lot: "VRD", hex: "#a1785c", mots: ["vrd", "terrassement", "reseaux"] },
  { lot: "Fluides", hex: "#22c1c3", mots: ["mep", "fluides", "flu", "fld"] },
];
const AUTRES = ["#c084fc", "#fb923c", "#f472b6", "#2dd4bf", "#a3e635", "#94a3b8"];

const CLE_LOTS = "visio-couleurs-lots";
const CLE_MAQUETTES = "visio-couleurs-maquettes";

function lisCouleursMaquettes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLE_MAQUETTES) ?? "{}");
  } catch {
    return {};
  }
}

/** Couleurs de lot personnalisées, gardées sur l'appareil. */
function lisCouleursLots(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLE_LOTS) || "{}");
  } catch {
    return {};
  }
}

/** Lot et couleur d'une maquette d'après son nom ; « origine » ignore les couleurs choisies. */
export function detecterLot(nom: string) {
  const mots = new Set(normaliser(nom).split(/[^a-z0-9]+/).filter(Boolean));
  let lot = "Autre";
  let hex = "";
  for (const l of LOTS) {
    if (l.mots.some((m) => mots.has(m))) {
      lot = l.lot;
      hex = l.hex;
      break;
    }
  }
  if (!hex) {
    const deja = [...maquettes.values()].filter((m) => m.lot === "Autre").length;
    hex = AUTRES[deja % AUTRES.length];
  }
  return { lot, hex: lisCouleursLots()[lot] ?? hex, origine: hex };
}

/** Couleur propre à une maquette, gardée sur l'appareil. */
export function definirCouleurMaquette(m: Maquette, hex: string) {
  const r = lisCouleursMaquettes();
  r[m.id] = hex;
  try {
    localStorage.setItem(CLE_MAQUETTES, JSON.stringify(r));
  } catch {
    // Mémoire locale indisponible : couleur gardée pour la session.
  }
  m.hex = hex;
  m.couleur = new THREE.Color(hex);
}

/** Change la couleur de tout un lot (toutes les maquettes de ce lot). */
export function definirCouleurLot(lot: string, hex: string) {
  const r = lisCouleursLots();
  r[lot] = hex;
  try {
    localStorage.setItem(CLE_LOTS, JSON.stringify(r));
  } catch {
    // Mémoire locale indisponible : couleur gardée pour la session.
  }
  for (const m of maquettes.values()) {
    if (m.lot === lot) {
      m.hex = hex;
      m.couleur = new THREE.Color(hex);
    }
  }
  changement.emit();
}

// --- État des couleurs (pour annuler / rétablir et réinitialiser) -------------------

export type EtatCouleurs = {
  /** Mode « Couleurs » allumé. */
  mode: boolean;
  /** Couleurs choisies à la main, par maquette et par lot. */
  maquettes: Record<string, string>;
  lots: Record<string, string>;
};

export const etatCouleurs = (): EtatCouleurs => ({
  mode: reglages.couleurs,
  maquettes: lisCouleursMaquettes(),
  lots: lisCouleursLots(),
});

/** Remet un état de couleurs (mode, choix par maquette et par lot) et recolore les maquettes. */
export function appliquerEtatCouleurs(e: EtatCouleurs) {
  reglages.couleurs = e.mode;
  try {
    localStorage.setItem("visio-couleurs", e.mode ? "1" : "0");
    localStorage.setItem(CLE_MAQUETTES, JSON.stringify(e.maquettes));
    localStorage.setItem(CLE_LOTS, JSON.stringify(e.lots));
  } catch {
    // Mémoire locale indisponible : état gardé pour la session.
  }
  for (const m of maquettes.values()) {
    const hex = e.maquettes[m.id] ?? e.lots[m.lot] ?? m.hexOrigine;
    m.hex = hex;
    m.couleur = new THREE.Color(hex);
  }
}

let exempleEnCours = false;
export function marquerExemple(actif: boolean) {
  exempleEnCours = actif;
}

fragments.list.onItemSet.add(({ key, value: modele }) => {
  modele.useCamera(monde.camera.three);
  monde.scene.three.add(modele.object);
  const { lot, hex: hexLot, origine } = detecterLot(key);
  const hex = lisCouleursMaquettes()[key] ?? hexLot;
  maquettes.set(key, {
    id: key,
    modele,
    couleur: new THREE.Color(hex),
    hex,
    hexOrigine: origine,
    lot,
    transparente: false,
    opacite: 0.2,
    exemple: exempleEnCours,
  });
  void fragments.core.update(true);
  changement.emit();
});

fragments.list.onItemDeleted.add(() => {
  for (const id of [...maquettes.keys()]) if (!fragments.list.has(id)) maquettes.delete(id);
  changement.emit();
});
