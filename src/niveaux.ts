// Niveaux des maquettes et hauteur de leur sol dans la scène : bas des murs et poteaux
// du niveau (sinon de tous ses éléments). Sert à la coupe par niveau et à la visite.
// Calcul léger (arborescence spatiale + boîtes, sans lire les propriétés de tous les
// éléments), fait en arrière-plan dès qu'une maquette est chargée et gardé en mémoire :
// le bouton manette affiche les niveaux tout de suite.
import * as THREE from "three";
import { boitesDe } from "./deplacements";
import { pause } from "./noyau";
import { changement, maquettes, visibles, type Maquette } from "./registre";

/** Sol d'un niveau : hauteur dans la scène et emprise de ses murs et poteaux. */
export type Sol = { nom: string; y: number; emprise: THREE.Box3 };

const ECHANTILLON = 150; // éléments par niveau pour trouver le sol
const calcules = new Map<string, Promise<Sol[]>>();

type Noeud = { localId?: number | null; category?: string | null; children?: Noeud[] };

/** Par niveau (nom) : murs et poteaux, et à défaut les autres éléments. */
function elementsParNiveau(arbre: Noeud) {
  const parNiveau = new Map<number, { porteurs: number[]; autres: number[] }>();
  const parcourir = (noeud: Noeud, catParent: string | null, niveau: number | null) => {
    const id = noeud.localId;
    if (id !== null && id !== undefined) {
      if (catParent === "IFCBUILDINGSTOREY") {
        niveau = id;
        if (!parNiveau.has(id)) parNiveau.set(id, { porteurs: [], autres: [] });
      } else if (niveau !== null && catParent) {
        const l = parNiveau.get(niveau)!;
        const liste = /^IFC(WALL|COLUMN)/.test(catParent) ? l.porteurs : l.autres;
        if (liste.length < ECHANTILLON) liste.push(id);
      }
      for (const enfant of noeud.children ?? []) parcourir(enfant, null, niveau);
    } else {
      for (const enfant of noeud.children ?? []) parcourir(enfant, noeud.category ?? null, niveau);
    }
  };
  parcourir(arbre, null, null);
  return parNiveau;
}

async function calculer(m: Maquette): Promise<Sol[]> {
  const modele = m.modele;
  const parNiveau = elementsParNiveau((await modele.getSpatialStructure()) as Noeud);
  if (!parNiveau.size) return [];
  const donnees = (await modele.getItemsData([...parNiveau.keys()], {
    attributesDefault: true,
    relationsDefault: { attributes: false, relations: false },
  })) as Record<string, any>[];
  const valeur = (c: any) => (c && typeof c === "object" && "value" in c ? c.value : undefined);
  const nomDe = new Map<number, string>();
  for (const d of donnees) nomDe.set(valeur(d._localId), String(valeur(d.Name) ?? valeur(d.LongName) ?? "Niveau"));
  // Une seule demande de boîtes pour tous les niveaux (chaque demande passe par le
  // calcul en tâche de fond : les regrouper évite autant d'allers-retours).
  const choisis: { nom: string; debut: number; fin: number }[] = [];
  const tous: number[] = [];
  for (const [idNiveau, { porteurs, autres }] of parNiveau) {
    const ids = porteurs.length ? porteurs : autres;
    if (!ids.length) continue;
    choisis.push({ nom: nomDe.get(idNiveau) ?? "Niveau", debut: tous.length, fin: tous.length + ids.length });
    tous.push(...ids);
  }
  if (!tous.length) return [];
  const boitesTout = await boitesDe(m, tous);
  await pause();
  const sols = new Map<string, Sol>();
  for (const { nom, debut, fin } of choisis) {
    const boites = boitesTout.slice(debut, fin).filter((b) => b && !b.isEmpty());
    if (!boites.length) continue;
    const bas = boites.map((b) => b.min.y).sort((a, b) => a - b);
    const y = bas[Math.floor(bas.length * 0.2)];
    const emprise = new THREE.Box3();
    for (const b of boites) emprise.union(b);
    const avant = sols.get(nom);
    if (!avant) sols.set(nom, { nom, y, emprise });
    else {
      avant.emprise.union(emprise);
      if (y < avant.y) avant.y = y;
    }
  }
  return [...sols.values()];
}

/** Sols d'une maquette (calculés une fois, gardés en mémoire). */
function solsDe(m: Maquette) {
  let p = calcules.get(m.id);
  if (!p) {
    p = calculer(m);
    calcules.set(m.id, p);
    p.catch(() => calcules.delete(m.id));
  }
  return p;
}

/** Sols des niveaux, du plus bas au plus haut (un même nom dans deux maquettes : le plus bas). */
export async function solsDesNiveaux(liste: Maquette[] = visibles()): Promise<Sol[]> {
  const sols = new Map<string, Sol>();
  for (const m of liste) {
    let res: Sol[] = [];
    try {
      res = await solsDe(m);
    } catch (e) {
      console.warn("Niveaux", m.id, e);
    }
    for (const s of res) {
      const avant = sols.get(s.nom);
      if (!avant) sols.set(s.nom, { nom: s.nom, y: s.y, emprise: s.emprise.clone() });
      else {
        avant.emprise.union(s.emprise);
        if (s.y < avant.y) avant.y = s.y;
      }
    }
  }
  return [...sols.values()].sort((a, b) => a.y - b.y);
}

// --- Calcul en arrière-plan ----------------------------------------------------------------
// Quelques secondes après l'arrivée d'une maquette, quand le téléphone est libre.

let attente = 0;
function prevoir() {
  window.clearTimeout(attente);
  attente = window.setTimeout(() => {
    const faire = async () => {
      for (const m of [...maquettes.values()]) {
        if (calcules.has(m.id)) continue;
        await solsDe(m).catch(() => undefined);
      }
    };
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (ric) ric(() => void faire(), { timeout: 4000 });
    else void faire();
  }, 2500);
}
changement.on(() => {
  // Maquettes retirées : on oublie leurs niveaux.
  for (const id of calcules.keys()) if (!maquettes.has(id)) calcules.delete(id);
  if ([...maquettes.keys()].some((id) => !calcules.has(id))) prevoir();
});
