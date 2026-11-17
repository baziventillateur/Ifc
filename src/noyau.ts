// Noyau partagé : scène 3D, moteur de maquettes, petits utilitaires d'interface.
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type * as FRAGS from "@thatopen/fragments";
import urlOuvrier from "@thatopen/fragments/worker?url";

export type Modele = FRAGS.FragmentsModel;
export type MaterialDefinition = FRAGS.MaterialDefinition;

export const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/** Crée un élément HTML avec une classe et un texte. */
export function cree<K extends keyof HTMLElementTagNameMap>(
  balise: K,
  classe = "",
  texte?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(balise);
  if (classe) n.className = classe;
  if (texte !== undefined) n.textContent = texte;
  return n;
}

export function bouton(classe: string, texte: string, action: () => void, titre?: string) {
  const b = cree("button", classe, texte);
  b.type = "button";
  if (titre) {
    b.title = titre;
    b.setAttribute("aria-label", titre);
  }
  b.addEventListener("click", action);
  return b;
}

// --- Scène ---------------------------------------------------------------------

export const composants = new OBC.Components();
export const monde = composants
  .get(OBC.Worlds)
  .create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();

monde.scene = new OBC.SimpleScene(composants);
monde.scene.setup();
monde.scene.three.background = new THREE.Color("#0f1318");
monde.renderer = new OBC.SimpleRenderer(composants, el("scene"));
monde.camera = new OBC.OrthoPerspectiveCamera(composants);
composants.init();

export const grille = composants.get(OBC.Grids).create(monde);
grille.config.color = new THREE.Color("#2a323d");

export const fragments = composants.get(OBC.FragmentsManager);
fragments.init(urlOuvrier);
monde.camera.controls.addEventListener("update", () => fragments.core.update());

// Évite le scintillement entre faces superposées.
fragments.core.models.materials.list.onItemSet.add(({ value: materiau }) => {
  const m = materiau as any;
  if (!m.isLodMaterial) {
    m.polygonOffset = true;
    m.polygonOffsetUnits = 1;
    m.polygonOffsetFactor = Math.random();
  }
});

export const lanceur = composants.get(OBC.Raycasters).get(monde);

export function rafraichir() {
  return fragments.core.update(true);
}

/**
 * Sur téléphone, les panneaux du bas (outil, fiche) cachent une partie de la vue :
 * on décale le point visé pour qu'il reste au centre de la zone encore visible.
 */
export function ajusterDecalage(transition = true) {
  const canvas = monde.renderer!.three.domElement;
  const H = canvas.clientHeight || window.innerHeight;
  let bas = 0;
  if (window.innerWidth < 820) {
    const outil = document.getElementById("outil");
    if (outil && !outil.hidden) bas = Math.max(bas, outil.offsetHeight);
    const fiche = document.getElementById("fiche");
    if (fiche?.classList.contains("ouverte")) bas = Math.max(bas, fiche.offsetHeight);
  }
  const haut = (document.querySelector(".barre") as HTMLElement | null)?.offsetHeight ?? 0;
  const cam = monde.camera.three as THREE.PerspectiveCamera;
  const fov = THREE.MathUtils.degToRad(cam.fov ?? 60);
  const hauteurVue = 2 * monde.camera.controls.distance * Math.tan(fov / 2);
  const d = bas > 0 ? ((bas - haut) / 2 / H) * hauteurVue : 0;
  void monde.camera.controls.setFocalOffset(0, d, 0, transition);
}

/** Cadre la caméra sur une boîte (coordonnées de la scène). */
export async function cadrer(boite: THREE.Box3, marge = 1.15) {
  if (boite.isEmpty()) return;
  const sphere = boite.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius * marge, 1.5);
  await monde.camera.controls.fitToSphere(sphere, true);
  ajusterDecalage();
}

// --- Repère du projet (coordonnées IFC réelles) --------------------------------
// La scène est en Y vers le haut et recentrée près de l'origine ; l'IFC est en Z
// vers le haut, en coordonnées réelles (Lambert 93 par exemple).

export function versIfc(p: THREE.Vector3): [number, number, number] {
  const b = fragments.core.baseCoordinates ?? [0, 0, 0];
  return [p.x - b[0], b[2] - p.z, p.y - b[1]];
}

export function depuisIfc(x: number, y: number, z: number) {
  const b = fragments.core.baseCoordinates ?? [0, 0, 0];
  return new THREE.Vector3(x + b[0], z + b[1], b[2] - y);
}

export const directionVersIfc = (d: THREE.Vector3): [number, number, number] => [d.x, -d.z, d.y];
export const directionDepuisIfc = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

// --- Attente et messages -----------------------------------------------------------

const voile = el("voile");
const voileTexte = el("voile-texte");
const jauge = el("jauge");
const aide = el("aide");

export function attente(texte: string | null, avancement?: number) {
  if (texte === null) {
    voile.classList.add("cache");
    return;
  }
  voile.classList.remove("cache");
  voileTexte.textContent = texte;
  jauge.style.width = `${Math.round((avancement ?? 0) * 100)}%`;
}

let minuterieAlerte: number | undefined;
export function alerte(texte: string, duree = 6000) {
  aide.textContent = texte;
  aide.classList.remove("cache");
  window.clearTimeout(minuterieAlerte);
  minuterieAlerte = window.setTimeout(() => aide.classList.add("cache"), duree);
}

export const pause = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Petits signaux ----------------------------------------------------------------

export class Signal<T = void> {
  private ecouteurs = new Set<(v: T) => void>();
  on(f: (v: T) => void) {
    this.ecouteurs.add(f);
    return () => this.ecouteurs.delete(f);
  }
  emit(v: T) {
    for (const f of [...this.ecouteurs]) f(v);
  }
}

// --- Texte -------------------------------------------------------------------------

export const normaliser = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const nf = (max: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: max });
const f0 = nf(0);
const f1 = nf(1);
const f2 = nf(2);
export const nombre = (v: number, decimales = 2) =>
  (decimales === 0 ? f0 : decimales === 1 ? f1 : f2).format(v);

/** Échappe une valeur pour un fichier CSV (séparateur « ; », lisible par Excel en français). */
export function telechargerCsv(nom: string, lignes: (string | number)[][]) {
  const cellule = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texte = "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
  telecharger(nom, new Blob([texte], { type: "text/csv;charset=utf-8" }));
}

export function telecharger(nom: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = cree("a");
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const dateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

// --- Icônes (traits simples, 14 px) --------------------------------------------------

const ICONES: Record<string, string> = {
  transparence:
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  isoler: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
  retirer: '<path d="M4 4l8 8M12 4l-8 8"/>',
  precedent: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  suivant: '<path d="M6 3.5l4.5 4.5L6 12.5"/>',
};

export function icone(nom: keyof typeof ICONES | string) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", "14");
  s.setAttribute("height", "14");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.5");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONES[nom] ?? "";
  return s;
}

/** Bouton icône accessible. */
export function boutonIcone(nom: string, action: () => void, titre: string, classe = "icone") {
  const b = bouton(classe, "", action, titre);
  b.append(icone(nom));
  return b;
}
