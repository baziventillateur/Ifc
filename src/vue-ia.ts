// Ce que l'utilisateur regarde, décrit pour l'assistant IA (envoyé avec chaque question) :
// mode de vue, position et direction du regard, niveau, pièce (IfcSpace) où il se trouve,
// maquettes affichées, éléments au centre de l'écran et élément sélectionné.
// Rien n'est envoyé d'autre que ce texte (pas d'image ni de fichier IFC).
import * as THREE from "three";
import { el, estOrtho, monde } from "./noyau";
import { maquettes, type Maquette } from "./registre";
import { selectionIds } from "./apparence";
import { viser } from "./fiche";
import { libelleCategorie } from "./libelles";
import { modeOeil, modeVisite, volLibre } from "./navigation";
import { solsDesNiveaux } from "./niveaux";
import { boitesDe } from "./deplacements";

const POINTS = [
  "nord",
  "nord-est",
  "est",
  "sud-est",
  "sud",
  "sud-ouest",
  "ouest",
  "nord-ouest",
];
const m2 = (n: number) => n.toFixed(1).replace(".", ",");

const maquetteDe = (id: string) =>
  [...maquettes.values()].find(
    (m) => m.id === id || (m.modele as { modelId?: string }).modelId === id,
  );

/** Nom lisible et catégorie de quelques éléments d'une maquette. */
async function noms(m: Maquette, ids: number[]) {
  const res = new Map<number, string>();
  if (!ids.length) return res;
  try {
    const donnees = (await m.modele.getItemsData(ids, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
    })) as Record<string, any>[];
    const v = (c: any) =>
      c && typeof c === "object" && "value" in c ? c.value : undefined;
    donnees.forEach((d, k) => {
      const cat = String(v(d._category) ?? "");
      const nom = String(v(d.Name) ?? v(d.LongName) ?? "").trim();
      res.set(
        ids[k],
        `${libelleCategorie(cat)}${nom ? ` « ${nom.slice(0, 60)} »` : ""}`,
      );
    });
  } catch {
    // Noms indisponibles : on s'en passe.
  }
  return res;
}

// Pièces (IfcSpace) de chaque maquette, avec leurs boîtes : lues une fois.
const espaces = new Map<
  string,
  Promise<{ ids: number[]; boites: (THREE.Box3 | null)[] }>
>();
function espacesDe(m: Maquette) {
  let p = espaces.get(m.id);
  if (!p) {
    p = (async () => {
      const ids = Object.values(
        await m.modele.getItemsOfCategories([/^IFCSPACE$/]),
      ).flat();
      return { ids, boites: ids.length ? await boitesDe(m, ids) : [] };
    })();
    espaces.set(m.id, p);
    p.catch(() => espaces.delete(m.id));
  }
  return p;
}
async function pieceAutourDe(p: THREE.Vector3) {
  let meilleure: { m: Maquette; id: number; volume: number } | null = null;
  for (const m of maquettes.values()) {
    if (!m.modele.object.visible) continue;
    try {
      const { ids, boites } = await espacesDe(m);
      ids.forEach((id, i) => {
        const b = boites[i];
        if (!b || !b.containsPoint(p)) return;
        const s = b.getSize(new THREE.Vector3());
        const volume = s.x * s.y * s.z;
        if (!meilleure || volume < meilleure.volume)
          meilleure = { m, id, volume };
      });
    } catch {
      // Pas de pièces dans cette maquette.
    }
  }
  if (!meilleure) return null;
  const { m, id } = meilleure as { m: Maquette; id: number };
  return (await noms(m, [id])).get(id) ?? null;
}

/** Description de la vue actuelle, en quelques lignes. */
export async function decrireVue(): Promise<string> {
  const ctl = monde.camera.controls;
  const p = ctl.getPosition(new THREE.Vector3());
  const d = ctl.getTarget(new THREE.Vector3()).sub(p).normalize();
  const lignes: string[] = [];

  const visite = modeVisite();
  const mode = visite
    ? `visite à la première personne${volLibre() ? " (anti-gravité : il vole librement)" : ", à hauteur d'yeux"}`
    : modeOeil()
      ? "mode regard (tourne la tête sur place)"
      : "vue extérieure (tourne autour de la maquette)";
  lignes.push(
    `Mode : ${mode}, vue ${estOrtho() ? "orthogonale" : `en perspective (${Math.round(monde.camera.threePersp.fov)}° vertical)`}.`,
  );

  // Repère IFC : x vers l'est, y vers le nord, z vers le haut (nord du projet).
  const cap = (THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)) + 360) % 360;
  const tangage = THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
  );
  const vers =
    Math.abs(tangage) > 60
      ? tangage > 0
        ? "vers le haut"
        : "vers le bas"
      : `vers le ${POINTS[Math.round(cap / 45) % 8]} du projet (${Math.round(cap)}°)${Math.abs(tangage) > 12 ? `, ${tangage > 0 ? "un peu vers le haut" : "un peu vers le bas"}` : ""}`;
  lignes.push(
    `Position de l'œil (repère IFC, m) : x ${m2(p.x)}, y ${m2(-p.z)}, z ${m2(p.y)} ; regarde ${vers}.`,
  );

  const visibles = [...maquettes.values()].filter(
    (m) => m.modele.object.visible,
  );
  const cachees = [...maquettes.values()].filter(
    (m) => !m.modele.object.visible,
  );
  const emprise = new THREE.Box3();
  for (const m of visibles) emprise.union(m.modele.box);
  const dedans = !emprise.isEmpty() && emprise.containsPoint(p);
  // Le niveau n'a de sens qu'à l'intérieur (ou en visite).
  if (visite || dedans)
    try {
      const sols = await solsDesNiveaux();
      let ici: (typeof sols)[number] | null = null;
      for (const s of sols) if (s.y <= p.y - 0.4) ici = s;
      if (ici)
        lignes.push(
          `Niveau sous l'œil : ${ici.nom} (œil ${m2(p.y - ici.y)} m au-dessus de son sol).`,
        );
    } catch {
      // Niveaux pas encore calculés.
    }

  if (!emprise.isEmpty())
    lignes.push(
      dedans
        ? "L'œil est à l'intérieur de l'emprise du bâtiment."
        : "L'œil est à l'extérieur du bâtiment.",
    );
  lignes.push(
    `Maquettes affichées : ${visibles.map((m) => `« ${m.id} » (${m.lot}${m.transparente ? ", transparente" : ""})`).join(", ") || "aucune"}.` +
      (cachees.length
        ? ` Masquées : ${cachees.map((m) => `« ${m.id} »`).join(", ")}.`
        : ""),
  );

  const piece = await pieceAutourDe(p).catch(() => null);
  if (piece) lignes.push(`Pièce où se trouve l'œil : ${piece}.`);

  // Ce qu'il y a au centre de l'écran et autour (5 visées).
  const toile = monde.renderer!.three.domElement.getBoundingClientRect();
  const visees = [
    [0.5, 0.5, "au centre"],
    [0.3, 0.5, "à gauche"],
    [0.7, 0.5, "à droite"],
    [0.5, 0.3, "en haut"],
    [0.5, 0.72, "en bas"],
  ] as const;
  const vus: { m: Maquette; id: number; ou: string; dist: number }[] = [];
  for (const [fx, fy, ou] of visees) {
    try {
      const v = await viser({
        clientX: toile.left + toile.width * fx,
        clientY: toile.top + toile.height * fy,
      });
      const m = v && maquetteDe(v.modele);
      if (!v || !m || vus.some((x) => x.m === m && x.id === v.id)) continue;
      vus.push({ m, id: v.id, ou, dist: v.point.distanceTo(p) });
    } catch {
      // Visée impossible.
    }
  }
  if (vus.length) {
    const textes: string[] = [];
    for (const x of vus) {
      const nom = (await noms(x.m, [x.id])).get(x.id) ?? "élément";
      textes.push(
        `${x.ou} : ${nom} (maquette « ${x.m.id} », à ${m2(x.dist)} m)`,
      );
    }
    lignes.push(`Éléments visibles : ${textes.join(" ; ")}.`);
  } else lignes.push("Aucun élément au centre de l'écran (vue dans le vide).");

  // Élément sélectionné (fiche ouverte).
  const choisis: string[] = [];
  for (const [mid, ids] of selectionIds()) {
    const m = maquetteDe(mid);
    if (!m) continue;
    const liste = [...ids].slice(0, 5);
    const n = await noms(m, liste);
    for (const id of liste) choisis.push(n.get(id) ?? "élément");
    if (ids.size > 5) choisis.push(`et ${ids.size - 5} autres`);
  }
  if (choisis.length)
    lignes.push(`Sélection en cours : ${choisis.join(", ")}.`);
  if (el("fiche").classList.contains("ouverte"))
    lignes.push("La fiche de l'élément sélectionné est ouverte.");
  return lignes.join("\n");
}
