// État complet d'une vue, pour y revenir à l'identique (capture, photo, remarque) :
// maquettes affichées ou masquées et leur transparence, éléments masqués, isolés ou
// recolorés, filtres, coupes et cotes. Chaque outil déclare ici ce qu'il sait lire et
// remettre ; ce module ne dépend d'aucun outil (l'ordre de la barre d'outils suit
// l'ordre des imports, il ne doit pas bouger).

type Contributeur = { lire: () => unknown; ecrire: (v: unknown) => unknown; ordre: number };
const contributeurs = new Map<string, Contributeur>();

/** Un outil déclare la partie de l'état qu'il garde ; « ordre » : rang de remise (petit d'abord). */
export function enregistrerEtat<T>(cle: string, lire: () => T, ecrire: (v: T) => unknown, ordre = 0) {
  contributeurs.set(cle, { lire, ecrire: ecrire as (v: unknown) => unknown, ordre });
}

export type EtatVue = { v: 1 } & Record<string, unknown>;

/** Ce qu'on voit maintenant (hors caméra, gardée à part par chaque outil). */
export function etatActuel(): EtatVue {
  const e: EtatVue = { v: 1 };
  for (const [cle, c] of contributeurs) {
    try {
      e[cle] = c.lire();
    } catch (err) {
      console.warn("État", cle, err);
    }
  }
  return e;
}

/** Remet un état enregistré ; une partie absente (ancienne capture) laisse l'outil tel quel. */
export async function restaurerEtat(e: EtatVue | null | undefined) {
  if (!e || e.v !== 1) return;
  const liste = [...contributeurs.entries()].sort((a, b) => a[1].ordre - b[1].ordre);
  for (const [cle, c] of liste) {
    if (!(cle in e)) continue;
    try {
      await c.ecrire(e[cle]);
    } catch (err) {
      console.warn("État", cle, err);
    }
  }
}

// --- Dessins par-dessus la vue (cotes…) à reporter dans les images -----------------------

type Dessin = (g: CanvasRenderingContext2D, largeur: number, hauteur: number, echelle: number) => void;
const dessins: Dessin[] = [];

/** Un outil qui dessine par-dessus la 3D (en SVG ou HTML) se déclare pour figurer dans les captures. */
export function enregistrerDessin(d: Dessin) {
  dessins.push(d);
}

/** Reporte ces dessins dans une image de la vue actuelle ; échelle : taille des traits (1 = écran). */
export function dessinerSurImage(g: CanvasRenderingContext2D, largeur: number, hauteur: number, echelle = 1) {
  for (const d of dessins) {
    try {
      d(g, largeur, hauteur, echelle);
    } catch (err) {
      console.warn("Dessin", err);
    }
  }
}

// --- Listes d'identifiants compactes : « 3-40,52,60-61 » ---------------------------------
// Les identifiants d'éléments se suivent souvent : en plages, un état de milliers d'éléments
// isolés tient en quelques centaines d'octets.

export function plages(ids: Iterable<number>): string {
  const t = [...new Set(ids)].sort((a, b) => a - b);
  const morceaux: string[] = [];
  for (let i = 0; i < t.length; ) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
    morceaux.push(j > i ? `${t[i]}-${t[j]}` : String(t[i]));
    i = j + 1;
  }
  return morceaux.join(",");
}

export function depuisPlages(texte: string): number[] {
  const ids: number[] = [];
  for (const m of (texte || "").split(",")) {
    if (!m) continue;
    const [a, b] = m.split("-").map(Number);
    if (!Number.isFinite(a)) continue;
    if (Number.isFinite(b) && b >= a && b - a < 5_000_000) for (let x = a; x <= b; x++) ids.push(x);
    else ids.push(a);
  }
  return ids;
}
