// Recherche d'éléments et calcul de quantités, partagés par la recherche, les
// quantitatifs et l'assistant.
import { normaliser, pause } from "./noyau";
import { visibles, type Maquette } from "./registre";
import { indexDeTout, type Element } from "./index-elements";
import { libelleCategorie } from "./libelles";
import type { Ids } from "./apparence";

export type Trouve = { m: Maquette; e: Element };
export type Filtre = {
  texte?: string;
  categorie?: string;
  niveau?: string;
  type?: string;
  maquette?: string;
};

/** Découpe « mur porteur:oui "R+1" » en termes, en respectant les guillemets. */
function termes(texte: string) {
  const res: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texte))) res.push(normaliser(m[1] ?? m[2]));
  return res.filter(Boolean);
}

const PSEUDO: Record<string, (t: Trouve) => string> = {
  nom: (t) => t.e.nom,
  type: (t) => t.e.type,
  niveau: (t) => t.e.niveau,
  categorie: (t) => `${t.e.cat} ${libelleCategorie(t.e.cat)}`,
  cat: (t) => `${t.e.cat} ${libelleCategorie(t.e.cat)}`,
  classe: (t) => t.e.cat,
  maquette: (t) => t.m.id,
};

function correspond(t: Trouve, terme: string) {
  const sep = terme.search(/[:=]/);
  if (sep <= 0) return t.e.texte.includes(terme) || normaliser(t.m.id).includes(terme);
  const cle = terme.slice(0, sep);
  const val = terme.slice(sep + 1);
  const pseudo = PSEUDO[cle];
  if (pseudo) return normaliser(pseudo(t)).includes(val);
  for (const [k, v] of Object.entries(t.e.props)) {
    if (normaliser(k).includes(cle) && normaliser(v).includes(val)) return true;
  }
  return false;
}

export function lister(filtre: Filtre, toutes: Trouve[]) {
  const ts = termes(filtre.texte ?? "");
  const cat = filtre.categorie ? normaliser(filtre.categorie) : null;
  const niv = filtre.niveau ? normaliser(filtre.niveau) : null;
  const typ = filtre.type ? normaliser(filtre.type) : null;
  const maq = filtre.maquette ? normaliser(filtre.maquette) : null;
  return toutes.filter((t) => {
    if (cat && !normaliser(`${t.e.cat} ${libelleCategorie(t.e.cat)}`).includes(cat)) return false;
    if (niv && normaliser(t.e.niveau) !== niv && !normaliser(t.e.niveau).includes(niv)) return false;
    if (typ && !normaliser(t.e.type).includes(typ)) return false;
    if (maq && !normaliser(t.m.id).includes(maq)) return false;
    return ts.every((terme) => correspond(t, terme));
  });
}

/** Tous les éléments des maquettes visibles (index construits si besoin). */
export async function tousLesElements(liste = visibles(), progression?: (a: number) => void) {
  const res = await indexDeTout(liste, progression);
  const tous: Trouve[] = [];
  for (const { m, idx } of res) for (const e of idx.elements.values()) tous.push({ m, e });
  return tous;
}

export async function chercher(filtre: Filtre, liste = visibles(), progression?: (a: number) => void) {
  return lister(filtre, await tousLesElements(liste, progression));
}

export function versIds(trouves: Trouve[]): Ids {
  const ids: Ids = new Map();
  for (const t of trouves) {
    if (!ids.has(t.m.id)) ids.set(t.m.id, new Set());
    ids.get(t.m.id)!.add(t.e.id);
  }
  return ids;
}

// --- Quantités -------------------------------------------------------------------

const SURFACES = [
  "NetSideArea",
  "NetArea",
  "NetFootprintArea",
  "NetSurfaceArea",
  "GrossSideArea",
  "GrossArea",
  "GrossFootprintArea",
  "GrossSurfaceArea",
  "OuterSurfaceArea",
  "Area",
  "Surface",
];
const LONGUEURS = ["Length", "NetLength", "GrossLength", "Longueur", "Longitud"];
const VOLUMES = ["NetVolume", "GrossVolume", "Volume", "Volumen"];

const premiere = (e: Element, noms: string[]) => {
  for (const n of noms) if (typeof e.qto[n] === "number") return e.qto[n];
  return 0;
};

export type Regroupement = "maquette" | "categorie" | "type" | "niveau";
export type LigneQ = {
  cle: string[];
  nb: number;
  volume: number;
  surface: number;
  longueur: number;
  ids: Ids;
};

const valeurCle: Record<Regroupement, (t: Trouve) => string> = {
  maquette: (t) => t.m.id,
  categorie: (t) => libelleCategorie(t.e.cat),
  type: (t) => t.e.type || "(sans type)",
  niveau: (t) => t.e.niveau,
};

/** Regroupe et totalise : nombre, volume mesuré sur la géométrie, surfaces et longueurs IFC. */
export async function quantifier(
  trouves: Trouve[],
  regroupement: Regroupement[],
  progression?: (a: number) => void,
): Promise<LigneQ[]> {
  const groupes = new Map<string, { cle: string[]; liste: Trouve[] }>();
  for (const t of trouves) {
    if (t.e.cat === "IFCOPENINGELEMENT") continue;
    const cle = regroupement.map((r) => valeurCle[r](t));
    const k = cle.join("\u0001");
    if (!groupes.has(k)) groupes.set(k, { cle, liste: [] });
    groupes.get(k)!.liste.push(t);
  }
  const lignes: LigneQ[] = [];
  let fait = 0;
  for (const { cle, liste } of groupes.values()) {
    const ids = versIds(liste);
    // Volume déclaré dans l'IFC quand il existe, sinon mesuré sur la géométrie.
    let volume = 0;
    const aMesurer: Trouve[] = [];
    for (const t of liste) {
      const v = premiere(t.e, VOLUMES);
      if (v > 0) volume += v;
      else aMesurer.push(t);
    }
    for (const [mid, set] of versIds(aMesurer)) {
      const m = aMesurer.find((t) => t.m.id === mid)!.m;
      try {
        const v = await m.modele.getItemsVolume([...set]);
        if (Number.isFinite(v)) volume += v;
      } catch {
        // Volume non mesurable pour ce groupe.
      }
    }
    lignes.push({
      cle,
      nb: liste.length,
      volume,
      surface: liste.reduce((s, t) => s + premiere(t.e, SURFACES), 0),
      longueur: liste.reduce((s, t) => s + premiere(t.e, LONGUEURS), 0),
      ids,
    });
    fait += 1;
    progression?.(fait / groupes.size);
    if (fait % 10 === 0) await pause();
  }
  return lignes.sort((a, b) => a.cle.join(" ").localeCompare(b.cle.join(" "), "fr"));
}
