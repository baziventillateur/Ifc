// Toucher un élément : sélection, fiche d'informations et actions rapides.
import * as THREE from "three";
import type * as FRAGS from "@thatopen/fragments";
import { ajusterDecalage, bouton, cadrer, cree, el, lanceur, monde, nombre, Signal } from "./noyau";
import { maquettes } from "./registre";
import {
  basculerSelection,
  definirIsolement,
  idsDe,
  isolementActif,
  masquer,
  nombreSelection,
  selectionner,
} from "./apparence";
import { libelleAttribut, libelleCategorie, formaterValeur } from "./libelles";
import { AVEC_PROPRIETES, lireJeux } from "./index-elements";
import { demandeRemarque } from "./evenements";

type Donnees = Record<string, any>;
export type Visee = { modele: string; id: number; point: THREE.Vector3 } | null;

const fiche = el("fiche");
const ficheCategorie = el("fiche-categorie");
const ficheNom = el("fiche-nom");
const ficheCorps = el("fiche-corps");
const aide = el("aide");

export const selectionChangee = new Signal<{ modele: string; id: number } | null>();

const valeur = (champ: any) =>
  champ && typeof champ === "object" && "value" in champ ? champ.value : undefined;

// --- Visée -------------------------------------------------------------------------

const canvas = monde.renderer!.three.domElement;

function ndc(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

/**
 * Lance un rayon sous le doigt. Les maquettes rendues transparentes sont
 * traversées, pour pouvoir toucher ce qui est derrière.
 */
export async function viser(
  e: { clientX: number; clientY: number },
  accrochage?: FRAGS.SnappingClass[],
): Promise<Visee> {
  const traversees = [...maquettes.values()].filter((m) => m.transparente && m.modele.object.visible);
  for (const m of traversees) m.modele.object.visible = false;
  try {
    const hit: any = await lanceur.castRay({ position: ndc(e), items: [], snappingClasses: accrochage });
    if (!hit || hit.localId === undefined || !hit.fragments) return null;
    return { modele: hit.fragments.modelId, id: hit.localId, point: hit.point.clone() };
  } finally {
    for (const m of traversees) m.modele.object.visible = true;
  }
}

type ModeClic = (e: PointerEvent) => void | Promise<void>;
let modeClic: ModeClic | null = null;
/** Un outil (mesure…) peut prendre la main sur les touchers. */
export function definirModeClic(f: ModeClic | null) {
  modeClic = f;
  canvas.style.cursor = f ? "crosshair" : "";
}

let depart: { x: number; y: number; n: number } | null = null;
let doigts = 0;
canvas.addEventListener("pointerdown", (e) => {
  doigts += 1;
  depart = { x: e.clientX, y: e.clientY, n: doigts };
});
canvas.addEventListener("pointercancel", () => {
  doigts = Math.max(0, doigts - 1);
  depart = null;
});
canvas.addEventListener("pointerup", (e) => {
  doigts = Math.max(0, doigts - 1);
  const d = depart;
  depart = null;
  if (!d || d.n > 1 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  if (modeClic) {
    void modeClic(e);
    return;
  }
  void toucher(e);
});

let multiple = false;
/** Mode « sélection multiple » : chaque toucher ajoute ou retire un élément. */
export function definirSelectionMultiple(actif: boolean) {
  multiple = actif;
}
export const selectionMultiple = () => multiple;

async function toucher(e: PointerEvent) {
  const v = await viser(e);
  if (multiple || e.ctrlKey || e.metaKey) {
    if (!v) return;
    await fermerFiche(true);
    await basculerSelection(v.modele, v.id);
    return;
  }
  if (!v) {
    await fermerFiche();
    return;
  }
  await montrerElement(v.modele, v.id, false);
}

// --- Fiche ---------------------------------------------------------------------------

let courant: { modele: string; id: number } | null = null;

el("fiche-fermer").addEventListener("click", () => void fermerFiche());

export async function fermerFiche(garderSelection = false) {
  const etaitOuverte = fiche.classList.contains("ouverte");
  fiche.classList.remove("ouverte");
  if (etaitOuverte) ajusterDecalage();
  const avait = courant !== null;
  courant = null;
  if (!garderSelection && (avait || nombreSelection() > 0)) await selectionner(null);
  if (avait) selectionChangee.emit(null);
}

function ligne(cle: string, contenu: string) {
  const div = cree("div", "ligne");
  div.append(cree("span", "cle", cle), cree("span", "valeur", contenu));
  return div;
}

function groupe(titre: string, lignes: HTMLElement[]) {
  const bloc = cree("div", "groupe");
  bloc.append(cree("div", "groupe-titre", titre), ...lignes);
  return bloc;
}

/** Sélectionne un élément, ouvre sa fiche et, si demandé, cadre la vue dessus. */
export async function montrerElement(idModele: string, idLocal: number, centrer = true) {
  const m = maquettes.get(idModele);
  if (!m) return;
  courant = { modele: idModele, id: idLocal };
  await selectionner(courant);
  selectionChangee.emit(courant);

  const [donnees] = (await m.modele.getItemsData([idLocal], {
    ...AVEC_PROPRIETES,
    relations: { ...AVEC_PROPRIETES.relations, ContainedInStructure: { attributes: true, relations: false } },
  })) as Donnees[];
  if (!donnees || courant?.id !== idLocal || courant.modele !== idModele) return;

  const categorie = String(valeur(donnees._category) ?? "");
  const nom = String(valeur(donnees.Name) ?? "Élément sans nom");
  ficheCategorie.textContent = libelleCategorie(categorie);
  ficheNom.textContent = nom;
  ficheCorps.replaceChildren();
  aide.classList.add("cache");

  const actions = cree("div", "fiche-actions");
  actions.append(
    bouton("puce", "Centrer", async () => cadrer(await m.modele.getMergedBox([idLocal]), 2.2)),
    bouton("puce", isolementActif() ? "Tout réafficher" : "Isoler", async () => {
      await definirIsolement(isolementActif() ? null : idsDe(idModele, idLocal));
      if (courant) await montrerElement(courant.modele, courant.id, false);
    }),
    bouton("puce", "Masquer", async () => {
      await fermerFiche();
      await masquer(idsDe(idModele, idLocal));
    }),
    bouton("puce", "+ Remarque", () =>
      demandeRemarque.emit({ titre: nom, elements: [{ modele: idModele, id: idLocal }] }),
    ),
  );
  ficheCorps.append(actions);

  const identite: HTMLElement[] = [];
  if (maquettes.size > 1) identite.push(ligne("Maquette", idModele));
  identite.push(ligne("Classe IFC", categorie || "—"));
  for (const [cle, champ] of Object.entries(donnees)) {
    if (cle.startsWith("_") || cle === "Name" || Array.isArray(champ)) continue;
    const v = valeur(champ);
    if (v === undefined || v === null || v === "") continue;
    identite.push(ligne(libelleAttribut(cle), formaterValeur(v)));
  }
  const conteneur = Array.isArray(donnees.ContainedInStructure) ? donnees.ContainedInStructure[0] : null;
  if (conteneur) identite.push(ligne("Niveau", String(valeur(conteneur.Name) ?? "—")));
  const guid = valeur(donnees._guid);
  if (guid) identite.push(ligne("Identifiant (GUID)", String(guid)));
  ficheCorps.append(groupe("Identité", identite));

  try {
    const volume = await m.modele.getItemsVolume([idLocal]);
    if (Number.isFinite(volume) && volume > 0) {
      ficheCorps.append(groupe("Mesure sur la maquette", [ligne("Volume", `${nombre(volume, 3)} m³`)]));
    }
  } catch {
    // Certains éléments n'ont pas de volume mesurable.
  }

  const jeux = lireJeux(donnees);
  for (const jeu of jeux) {
    ficheCorps.append(groupe(jeu.nom, jeu.lignes.map(([k, v]) => ligne(k, formaterValeur(v)))));
  }
  if (jeux.length === 0) {
    ficheCorps.append(cree("div", "vide", "Aucun jeu de propriétés renseigné pour cet élément."));
  }

  ficheCorps.scrollTop = 0;
  fiche.classList.add("ouverte");
  if (centrer) await cadrer(await m.modele.getMergedBox([idLocal]), 2.2);
}

export const elementCourant = () => courant;
