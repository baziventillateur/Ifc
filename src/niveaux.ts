// Niveaux des maquettes et hauteur de leur sol dans la scène : bas des murs et poteaux
// du niveau (sinon de tous ses éléments). Sert à la coupe par niveau et à la visite.
import * as THREE from "three";
import { boitesDe } from "./deplacements";
import { indexDeTout, SANS_NIVEAU } from "./index-elements";
import { visibles, type Maquette } from "./registre";

/** Sol d'un niveau : hauteur dans la scène et emprise de ses murs et poteaux. */
export type Sol = { nom: string; y: number; emprise: THREE.Box3 };

/** Sols des niveaux, du plus bas au plus haut (un même nom dans deux maquettes : le plus bas). */
export async function solsDesNiveaux(liste: Maquette[] = visibles()): Promise<Sol[]> {
  const res = await indexDeTout(liste);
  const sols = new Map<string, Sol>();
  for (const { m, idx } of res) {
    const parNiveau = new Map<string, number[]>();
    for (const e of idx.elements.values()) {
      if (e.niveau === SANS_NIVEAU) continue;
      const porteur = /^IFC(WALL|COLUMN)/.test(e.cat);
      const cle = e.niveau + (porteur ? "|p" : "|a");
      if (!parNiveau.has(cle)) parNiveau.set(cle, []);
      parNiveau.get(cle)!.push(e.id);
    }
    for (const [nom, alt] of idx.niveaux) {
      if (!Number.isFinite(alt)) continue;
      const ids = (parNiveau.get(nom + "|p") ?? parNiveau.get(nom + "|a") ?? []).slice(0, 300);
      if (!ids.length) continue;
      const boites = await boitesDe(m, ids);
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
  }
  return [...sols.values()].sort((a, b) => a.y - b.y);
}
