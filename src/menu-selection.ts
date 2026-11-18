// Menu d'apparence sur la sélection : clic droit sur la maquette (ou bouton « Couleur »
// sur téléphone). Couleur et opacité des seuls éléments choisis, et actions rapides.
import { bouton, cadrer, cree, monde } from "./noyau";
import {
  boiteDe,
  definirIsolement,
  definirSelection,
  definirTeinte,
  idsDe,
  isolementActif,
  masquer,
  nombreSelection,
  selectionIds,
  teinteDe,
  type Ids,
} from "./apparence";
import { fermerFiche, viser } from "./fiche";
import { demandeMenu } from "./evenements";

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
