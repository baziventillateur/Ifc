// Index des éléments de chaque maquette : catégorie, niveau, type, propriétés et
// quantités. Construit une fois à la demande, puis réutilisé par la recherche,
// les filtres, les quantitatifs, les clashs et l'assistant.
import { normaliser, pause } from "./noyau";
import { formaterValeur, libelleCategorie } from "./libelles";
import type { Maquette } from "./registre";

export type Element = {
  id: number;
  cat: string;
  nom: string;
  type: string;
  niveau: string;
  guid: string;
  props: Record<string, string>;
  qto: Record<string, number>;
  texte: string;
};

export type IndexMaquette = {
  elements: Map<number, Element>;
  /** Nom de niveau → altitude IFC (pour les trier). */
  niveaux: Map<string, number>;
};

export const SANS_NIVEAU = "Sans niveau";

type Donnees = Record<string, any>;
const valeur = (champ: any) =>
  champ && typeof champ === "object" && "value" in champ ? champ.value : undefined;

const index = new Map<string, Promise<IndexMaquette>>();

const AUCUNE = { attributes: false, relations: false };
/** Lecture des jeux de propriétés et de quantités, sans remonter vers les autres éléments. */
export const AVEC_PROPRIETES = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
    HasProperties: { attributes: true, relations: false },
    Quantities: { attributes: true, relations: false },
    DefinesOcurrence: AUCUNE,
    DefinesOccurrence: AUCUNE,
  },
  relationsDefault: AUCUNE,
};

export function oublierIndex(id: string) {
  index.delete(id);
}

export function indexPret(id: string) {
  return index.has(id);
}

export function indexDe(
  m: Maquette,
  progression?: (avancement: number) => void,
): Promise<IndexMaquette> {
  let p = index.get(m.id);
  if (!p) {
    p = construire(m, progression);
    index.set(m.id, p);
    p.catch(() => index.delete(m.id));
  }
  return p;
}

/** Lit les jeux de propriétés et de quantités d'un élément (relation IsDefinedBy). */
export function lireJeux(donnees: Donnees) {
  const jeux: { nom: string; lignes: [string, unknown][] }[] = [];
  const definitions = Array.isArray(donnees.IsDefinedBy) ? (donnees.IsDefinedBy as Donnees[]) : [];
  for (const jeu of definitions) {
    const contenu = [jeu.HasProperties, jeu.Quantities].find(Array.isArray) as Donnees[] | undefined;
    if (!contenu) continue;
    const lignes: [string, unknown][] = [];
    for (const p of contenu) {
      const nom = valeur(p.Name);
      if (nom === undefined) continue;
      const cle = Object.keys(p).find((k) => !k.startsWith("_") && k !== "Name" && /Value$/.test(k));
      const v = cle ? valeur(p[cle]) : undefined;
      if (v === undefined || v === null || v === "") continue;
      lignes.push([String(nom), v]);
    }
    if (lignes.length) jeux.push({ nom: String(valeur(jeu.Name) ?? "Propriétés"), lignes });
  }
  return jeux;
}

async function construire(m: Maquette, progression?: (a: number) => void): Promise<IndexMaquette> {
  const modele = m.modele;
  const ids = await modele.getItemsIdsWithGeometry();

  // Niveau de chaque élément, d'après l'arborescence spatiale.
  const niveauDe = new Map<number, number>();
  const niveauxIds = new Set<number>();
  const arbre = await modele.getSpatialStructure();
  const parcourir = (noeud: any, catParent: string | null, niveau: number | null) => {
    if (noeud.localId !== null && noeud.localId !== undefined) {
      if (catParent === "IFCBUILDINGSTOREY") {
        niveau = noeud.localId;
        niveauxIds.add(noeud.localId);
      } else if (niveau !== null) {
        niveauDe.set(noeud.localId, niveau);
      }
      for (const enfant of noeud.children ?? []) parcourir(enfant, null, niveau);
    } else {
      for (const enfant of noeud.children ?? []) parcourir(enfant, noeud.category, niveau);
    }
  };
  parcourir(arbre, null, null);

  const niveaux = new Map<string, number>();
  const nomNiveau = new Map<number, string>();
  if (niveauxIds.size) {
    const donnees = (await modele.getItemsData([...niveauxIds], {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
    })) as Donnees[];
    for (const d of donnees) {
      const id = valeur(d._localId);
      const nom = String(valeur(d.Name) ?? valeur(d.LongName) ?? "Niveau");
      nomNiveau.set(id, nom);
      const alt = Number(valeur(d.Elevation));
      if (!niveaux.has(nom) || Number.isFinite(alt)) niveaux.set(nom, Number.isFinite(alt) ? alt : 0);
    }
  }

  const elements = new Map<number, Element>();
  const PAQUET = 2000;
  for (let i = 0; i < ids.length; i += PAQUET) {
    const paquet = ids.slice(i, i + PAQUET);
    const donnees = (await modele.getItemsData(paquet, AVEC_PROPRIETES)) as Donnees[];
    donnees.forEach((d, k) => {
      const id = valeur(d._localId) ?? paquet[k];
      const cat = String(valeur(d._category) ?? "");
      const nom = String(valeur(d.Name) ?? "");
      const type = String(valeur(d.ObjectType) ?? "");
      const niv = niveauDe.get(id);
      const niveau = niv !== undefined ? (nomNiveau.get(niv) ?? SANS_NIVEAU) : SANS_NIVEAU;
      const props: Record<string, string> = {};
      const qto: Record<string, number> = {};
      for (const attr of ["Tag", "Description", "PredefinedType"]) {
        const v = valeur(d[attr]);
        if (v !== undefined && v !== null && v !== "") props[attr] = formaterValeur(v);
      }
      for (const jeu of lireJeux(d)) {
        for (const [nomProp, v] of jeu.lignes) {
          props[`${jeu.nom}.${nomProp}`] = formaterValeur(v);
          if (typeof v === "number" && !(nomProp in qto)) qto[nomProp] = v;
        }
      }
      const texte = normaliser(
        [nom, cat, libelleCategorie(cat), type, niveau, ...Object.entries(props).map(([k, v]) => `${k}=${v}`)].join(
          "|",
        ),
      );
      elements.set(id, {
        id,
        cat,
        nom,
        type,
        niveau,
        guid: String(valeur(d._guid) ?? ""),
        props,
        qto,
        texte,
      });
    });
    progression?.(Math.min(1, (i + PAQUET) / ids.length));
    await pause();
  }

  if ([...elements.values()].some((e) => e.niveau === SANS_NIVEAU)) {
    niveaux.set(SANS_NIVEAU, Number.POSITIVE_INFINITY);
  }
  return { elements, niveaux };
}

/** Index de plusieurs maquettes, avec une progression globale. */
export async function indexDeTout(liste: Maquette[], progression?: (a: number, nom: string) => void) {
  const res: { m: Maquette; idx: IndexMaquette }[] = [];
  for (const [i, m] of liste.entries()) {
    const idx = await indexDe(m, (a) => progression?.((i + a) / liste.length, m.id));
    res.push({ m, idx });
  }
  return res;
}
