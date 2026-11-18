// Menu d'apparence sur la sélection : clic droit sur la maquette (ou bouton « Couleur »
// sur téléphone). Couleur et opacité des seuls éléments choisis, et actions rapides.
import { alerte, attente, bouton, cadrer, cree, monde, nombre } from "./noyau";
import { maquettes } from "./registre";
import { indexDeTout, type Element } from "./index-elements";
import { libelleCategorie } from "./libelles";
import {
  affichesDe,
  boiteDe,
  definirIsolement,
  definirSelection,
  definirTeinte,
  idsDe,
  isolementActif,
  masquer,
  nombreSelection,
  selectionIds,
  selectionModifiee,
  teinteDe,
  type Ids,
} from "./apparence";
import { fermerFiche, viser } from "./fiche";
import { demandeMenu, demandeSimilaires } from "./evenements";

const TEINTES = ["#ef4444", "#ff8a1f", "#facc15", "#22c55e", "#22d3ee", "#3b82f6", "#a78bfa", "#6b7280"];
const pluriel = (n: number) => `${n} élément${n > 1 ? "s" : ""}`;

const menu = cree("div", "menu-teinte");
menu.hidden = true;
menu.setAttribute("role", "menu");
document.body.append(menu);

let cible: Ids = new Map();
let selectionLevee = false;

const compter = (ids: Ids) => [...ids.values()].reduce((n, s) => n + s.size, 0);

/** La sélection orange cache la couleur : on la lève dès le premier changement. */
async function leverSelection() {
  if (selectionLevee) return;
  selectionLevee = true;
  if (nombreSelection() > 0) await fermerFiche();
}

async function teinter(changement: { hex?: string; opacite?: number } | null) {
  await leverSelection();
  await definirTeinte(cible, changement);
}

// --- Sélection similaire ------------------------------------------------------------

export type Critere = "categorie" | "type" | "niveau";
const NOMS_CRITERE: Record<Critere, string> = { categorie: "même catégorie", type: "même type", niveau: "même niveau" };
const cleDe = (e: Element, c: Critere) =>
  c === "categorie" ? libelleCategorie(e.cat) : c === "type" ? e.type : e.niveau;

/**
 * Sélectionne, parmi les éléments affichés de toutes les maquettes, ceux qui partagent
 * la catégorie (mur, poteau…), le type Revit (famille et type) ou le niveau des éléments donnés.
 */
export async function selectionnerSimilaires(source: Ids, critere: Critere) {
  attente("Recherche des éléments similaires…", 0.2);
  try {
    const res = await indexDeTout([...maquettes.values()]);
    const cles = new Set<string>();
    for (const { m, idx } of res) {
      for (const id of source.get(m.id) ?? []) {
        const e = idx.elements.get(id);
        const k = e ? cleDe(e, critere) : "";
        if (k) cles.add(k);
      }
    }
    if (!cles.size) {
      alerte(critere === "type" ? "Ces éléments n'ont pas de type renseigné dans l'IFC." : "Aucun critère commun trouvé.");
      return null;
    }
    const suivante: Ids = new Map();
    for (const { m, idx } of res) {
      if (!m.modele.object.visible) continue;
      const affiches = new Set(await affichesDe(m));
      const pris = new Set<number>();
      for (const e of idx.elements.values()) if (affiches.has(e.id) && cles.has(cleDe(e, critere))) pris.add(e.id);
      if (pris.size) suivante.set(m.id, pris);
    }
    await fermerFiche(true);
    await definirSelection(suivante);
    // Même sélection qu'avant (élément seul de son espèce) : la barre doit quand même apparaître.
    selectionModifiee.emit();
    const n = compter(suivante);
    const quoi = [...cles].slice(0, 2).join(", ") + (cles.size > 2 ? "…" : "");
    alerte(`${nombre(n, 0)} élément${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""} (${NOMS_CRITERE[critere]} : ${quoi}).`);
    return suivante;
  } finally {
    attente(null);
  }
}

demandeSimilaires.on(({ ids, critere }) => void selectionnerSimilaires(ids, critere));

export function fermerMenu() {
  menu.hidden = true;
  menu.replaceChildren();
}

export function ouvrirMenu(ids: Ids, x: number, y: number) {
  cible = new Map([...ids].map(([k, v]) => [k, new Set(v)]));
  selectionLevee = false;
  const n = compter(cible);
  if (n === 0) return;
  const actuelle = teinteDe(cible);

  const entete = cree("div", "menu-teinte-entete");
  entete.append(cree("span", "", pluriel(n)), bouton("icone-texte", "✕", fermerMenu, "Fermer (Échap)"));

  const pastilles = cree("div", "menu-teinte-pastilles");
  for (const hex of TEINTES) {
    const b = bouton("menu-pastille", "", () => void teinter({ hex }), `Couleur ${hex}`);
    b.style.background = hex;
    pastilles.append(b);
  }
  const libre = cree("input", "menu-pastille libre");
  libre.type = "color";
  libre.value = actuelle?.hex ?? "#ff8a1f";
  libre.title = "Autre couleur";
  libre.setAttribute("aria-label", "Autre couleur");
  libre.addEventListener("change", () => void teinter({ hex: libre.value }));
  pastilles.append(libre);

  const opacite = cree("input", "curseur");
  opacite.type = "range";
  opacite.min = "5";
  opacite.max = "100";
  opacite.step = "5";
  opacite.value = String(Math.round((actuelle?.opacite ?? 1) * 100));
  const sortie = cree("span", "valeur-curseur", `${opacite.value} %`);
  let attente: number | undefined;
  opacite.addEventListener("input", () => {
    sortie.textContent = `${opacite.value} %`;
    window.clearTimeout(attente);
    attente = window.setTimeout(() => void teinter({ opacite: Number(opacite.value) / 100 }), 90);
  });
  const rangOpacite = cree("label", "menu-teinte-rang");
  rangOpacite.append(cree("span", "menu-teinte-libelle", "Opacité"), opacite, sortie);

  const similaires = cree("div", "menu-teinte-similaires");
  for (const [c, libelle, titre] of [
    ["categorie", "Catégorie", "Tous les éléments affichés de la même catégorie (mur, poteau, dalle…)"],
    ["type", "Type", "Même famille et type Revit (ex. « Voile BA 20 »)"],
    ["niveau", "Niveau", "Tous les éléments affichés du même niveau"],
  ] as [Critere, string, string][]) {
    similaires.append(
      bouton("puce", libelle, async () => {
        const ids = await selectionnerSimilaires(cible, c);
        if (ids && compter(ids)) ouvrirMenu(ids, x, y);
      }, titre),
    );
  }

  const actions = cree("div", "menu-teinte-actions");
  actions.append(
    bouton("puce", "Centrer", async () => cadrer(await boiteDe(cible), 1.4)),
    bouton("puce", isolementActif() ? "Tout voir" : "Isoler", async () => {
      fermerMenu();
      await definirIsolement(isolementActif() ? null : cible);
    }),
    bouton("puce", "Masquer", async () => {
      fermerMenu();
      await fermerFiche();
      await masquer(cible);
    }),
    bouton("puce", "Rétablir", async () => {
      opacite.value = "100";
      sortie.textContent = "100 %";
      await teinter(null);
    }, "Rendre leur apparence d'origine à ces éléments"),
  );

  menu.replaceChildren(
    entete,
    cree("div", "menu-teinte-libelle", "Sélectionner les similaires"),
    similaires,
    cree("div", "menu-teinte-libelle", "Couleur"),
    pastilles,
    rangOpacite,
    actions,
  );
  menu.hidden = false;
  // Placé au pointeur, sans sortir de l'écran.
  const l = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - l - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
}

demandeMenu.on(({ ids, x, y }) => ouvrirMenu(ids, x, y));

// Fermer : clic ailleurs, Échap.
window.addEventListener(
  "pointerdown",
  (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) fermerMenu();
  },
  true,
);
window.addEventListener(
  "keydown",
  (e) => {
    if (menu.hidden || e.key !== "Escape") return;
    fermerMenu();
    e.stopImmediatePropagation();
    e.preventDefault();
  },
  true,
);

// --- Clic droit sur la maquette ----------------------------------------------------

const canvas = monde.renderer!.three.domElement;
let droit: { x: number; y: number } | null = null;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  droit = e.pointerType === "mouse" && e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
});
window.addEventListener("pointerup", (e) => {
  if (e.button !== 2 || !droit) return;
  const d = droit;
  droit = null;
  // Un clic droit glissé déplace la vue : pas de menu.
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  void surClicDroit(e);
});

async function surClicDroit(e: PointerEvent) {
  const v = await viser(e);
  if (v && !selectionIds().get(v.modele)?.has(v.id)) {
    await fermerFiche(true);
    await definirSelection(idsDe(v.modele, v.id));
  }
  if (nombreSelection() === 0) return;
  ouvrirMenu(selectionIds(), e.clientX, e.clientY);
}
