// Détection des clashs entre deux maquettes.
// 1. Tri rapide par boîtes englobantes (recouvrement supérieur à la tolérance sur les 3 axes).
// 2. Contrôle précis sur la géométrie réelle : intersection des surfaces (arbre BVH),
//    ou élément entièrement noyé dans l'autre.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import { pause, type Modele } from "./noyau";
import type { Maquette } from "./registre";
import { indexDe, SANS_NIVEAU, type Element } from "./index-elements";

export type Statut = "nouveau" | "a-traiter" | "accepte" | "resolu";

export type Clash = {
  n: number;
  a: { m: Maquette; e: Element };
  b: { m: Maquette; e: Element };
  boite: THREE.Box3;
  penetration: number;
  niveau: string;
  statut: Statut;
};

export type OptionsClash = { tolerance: number; exclure: boolean };

const EXCLUES = /^IFC(SPACE|OPENINGELEMENT|SITE|GEOGRAPHICELEMENT|ANNOTATION|GRID|VIRTUALELEMENT|BUILDINGSTOREY)/;

type Boite = { e: Element; b: THREE.Box3 };

async function boites(m: Maquette, elements: Element[]): Promise<Boite[]> {
  const res: Boite[] = [];
  const PAQUET = 4000;
  for (let i = 0; i < elements.length; i += PAQUET) {
    const lot = elements.slice(i, i + PAQUET);
    const bs = await m.modele.getBoxes(lot.map((e) => e.id));
    lot.forEach((e, k) => {
      if (bs[k] && !bs[k].isEmpty()) res.push({ e, b: bs[k] });
    });
  }
  return res;
}

const recouvrement = (a: THREE.Box3, b: THREE.Box3, axe: "x" | "y" | "z") =>
  Math.min(a.max[axe], b.max[axe]) - Math.max(a.min[axe], b.min[axe]);

type Solide = { geo: THREE.BufferGeometry; bvh: MeshBVH; point: THREE.Vector3 } | null;

class Geometries {
  private cache = new Map<string, Solide>();
  constructor(private m: Maquette) {}

  async charger(ids: number[]) {
    const manquants = ids.filter((id) => !this.cache.has(String(id)));
    const modele: Modele = this.m.modele;
    modele.object.updateMatrixWorld(true);
    const monde = modele.object.matrixWorld;
    const PAQUET = 150;
    for (let i = 0; i < manquants.length; i += PAQUET) {
      const lot = manquants.slice(i, i + PAQUET);
      const donnees = await modele.getItemsGeometry(lot);
      lot.forEach((id, k) => {
        const morceaux: THREE.BufferGeometry[] = [];
        for (const md of donnees[k] ?? []) {
          if (!md.positions || !md.indices || md.positions.length < 9) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(md.positions), 3));
          g.setIndex(new THREE.BufferAttribute(Uint32Array.from(md.indices), 1));
          g.applyMatrix4(monde.clone().multiply(md.transform));
          morceaux.push(g);
        }
        if (!morceaux.length) {
          this.cache.set(String(id), null);
          return;
        }
        const geo = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false);
        const pos = geo.getAttribute("position");
        const bvh = new MeshBVH(geo);
        // Avec un arbre des deux côtés, le test d'intersection compare arbre contre arbre.
        (geo as any).boundsTree = bvh;
        this.cache.set(String(id), {
          geo,
          bvh,
          point: new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)),
        });
      });
      await pause();
    }
  }

  get(id: number) {
    return this.cache.get(String(id)) ?? null;
  }

  vider() {
    for (const s of this.cache.values()) s?.geo.dispose();
    this.cache.clear();
  }
}

const identite = new THREE.Matrix4();
const rayon = new THREE.Ray();
const DIRECTIONS = [new THREE.Vector3(1, 0.0013, 0.0007).normalize(), new THREE.Vector3(-0.0011, 1, 0.0017).normalize()];

/** Le point est-il à l'intérieur du solide ? (parité des traversées, sur deux directions) */
function dedans(s: NonNullable<Solide>, p: THREE.Vector3) {
  let votes = 0;
  for (const d of DIRECTIONS) {
    rayon.set(p, d);
    const touches = s.bvh.raycast(rayon, THREE.DoubleSide);
    const distances = [...new Set(touches.map((t) => Math.round(t.distance * 1e5)))];
    if (distances.length % 2 === 1) votes += 1;
  }
  return votes === DIRECTIONS.length;
}

function seCoupent(a: NonNullable<Solide>, b: NonNullable<Solide>) {
  if (a.bvh.intersectsGeometry(b.geo, identite)) return true;
  return dedans(a, b.point) || dedans(b, a.point);
}

export async function detecterClashs(
  ma: Maquette,
  mb: Maquette,
  options: OptionsClash,
  progression?: (texte: string, avancement: number) => void,
): Promise<Clash[]> {
  const memeMaquette = ma.id === mb.id;
  const chrono = import.meta.env.DEV ? performance.now() : 0;
  const etape = (nom: string) => {
    if (import.meta.env.DEV) console.log(`⏱ ${nom} ${Math.round(performance.now() - chrono)} ms`);
  };
  progression?.("Analyse des maquettes…", 0.02);
  const [ia, ib] = [await indexDe(ma), await indexDe(mb)];
  const garder = (e: Element) => !(options.exclure && EXCLUES.test(e.cat));
  progression?.("Boîtes englobantes…", 0.08);
  const A = (await boites(ma, [...ia.elements.values()].filter(garder))).sort((x, y) => x.b.min.x - y.b.min.x);
  const B = memeMaquette
    ? A
    : (await boites(mb, [...ib.elements.values()].filter(garder))).sort((x, y) => x.b.min.x - y.b.min.x);

  // Balayage selon X : on ne compare que les boîtes qui se chevauchent.
  const tol = options.tolerance;
  const candidats: [Boite, Boite][] = [];
  let actifs: Boite[] = [];
  let j = 0;
  for (const a of A) {
    while (j < B.length && B[j].b.min.x <= a.b.max.x) actifs.push(B[j++]);
    actifs = actifs.filter((b) => b.b.max.x >= a.b.min.x);
    for (const b of actifs) {
      if (memeMaquette && b.e.id <= a.e.id) continue;
      if (
        recouvrement(a.b, b.b, "x") > tol &&
        recouvrement(a.b, b.b, "y") > tol &&
        recouvrement(a.b, b.b, "z") > tol
      ) {
        candidats.push([a, b]);
      }
    }
  }

  etape(`balayage : ${A.length} × ${B.length} boîtes, ${candidats.length} candidats`);
  // Contrôle précis sur la géométrie.
  const ga = new Geometries(ma);
  const gb = memeMaquette ? ga : new Geometries(mb);
  const clashs: Clash[] = [];
  const PAQUET = 300;
  try {
    for (let i = 0; i < candidats.length; i += PAQUET) {
      const lot = candidats.slice(i, i + PAQUET);
      await ga.charger([...new Set(lot.map(([a]) => a.e.id))]);
      await gb.charger([...new Set(lot.map(([, b]) => b.e.id))]);
      for (const [a, b] of lot) {
        const sa = ga.get(a.e.id);
        const sb = gb.get(b.e.id);
        if (!sa || !sb || !seCoupent(sa, sb)) continue;
        const boite = a.b.clone().intersect(b.b);
        const penetration = Math.min(
          recouvrement(a.b, b.b, "x"),
          recouvrement(a.b, b.b, "y"),
          recouvrement(a.b, b.b, "z"),
        );
        clashs.push({
          n: 0,
          a: { m: ma, e: a.e },
          b: { m: mb, e: b.e },
          boite,
          penetration,
          niveau: a.e.niveau !== SANS_NIVEAU ? a.e.niveau : b.e.niveau,
          statut: "nouveau",
        });
      }
      progression?.(
        `Contrôle précis… ${Math.min(i + PAQUET, candidats.length)} / ${candidats.length}`,
        0.15 + 0.85 * Math.min(1, (i + PAQUET) / candidats.length),
      );
      await pause();
    }
    etape(`contrôle précis : ${clashs.length} conflits`);
  } finally {
    ga.vider();
    if (gb !== ga) gb.vider();
  }

  const alt = (n: string) => ia.niveaux.get(n) ?? ib.niveaux.get(n) ?? Number.POSITIVE_INFINITY;
  clashs.sort(
    (x, y) => alt(x.niveau) - alt(y.niveau) || x.a.e.nom.localeCompare(y.a.e.nom, "fr") || y.penetration - x.penetration,
  );
  clashs.forEach((c, k) => (c.n = k + 1));
  return clashs;
}
