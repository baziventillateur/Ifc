// Registre des maquettes chargées et de leur couleur de lot.
import * as THREE from "three";
import { fragments, monde, normaliser, Signal, type Modele } from "./noyau";

export type Maquette = {
  id: string;
  modele: Modele;
  couleur: THREE.Color;
  hex: string;
  lot: string;
  transparente: boolean;
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

export function detecterLot(nom: string) {
  const mots = new Set(normaliser(nom).split(/[^a-z0-9]+/).filter(Boolean));
  for (const l of LOTS) if (l.mots.some((m) => mots.has(m))) return { lot: l.lot, hex: l.hex };
  const deja = [...maquettes.values()].filter((m) => m.lot === "Autre").length;
  return { lot: "Autre", hex: AUTRES[deja % AUTRES.length] };
}

let exempleEnCours = false;
export function marquerExemple(actif: boolean) {
  exempleEnCours = actif;
}

fragments.list.onItemSet.add(({ key, value: modele }) => {
  modele.useCamera(monde.camera.three);
  monde.scene.three.add(modele.object);
  const { lot, hex } = detecterLot(key);
  maquettes.set(key, {
    id: key,
    modele,
    couleur: new THREE.Color(hex),
    hex,
    lot,
    transparente: false,
    exemple: exempleEnCours,
  });
  void fragments.core.update(true);
  changement.emit();
});

fragments.list.onItemDeleted.add(() => {
  for (const id of [...maquettes.keys()]) if (!fragments.list.has(id)) maquettes.delete(id);
  changement.emit();
});
