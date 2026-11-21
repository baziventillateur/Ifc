// Avancement du chantier, pendant la visite à la première personne : en touchant un
// élément, un bouton discret dans sa fiche le marque « Réalisé ». Les éléments réalisés
// passent en vert doux pendant la visite. L'avancement est enregistré dans le projet
// (créateur et personnes invitées le voient et le modifient) ; un élément est repéré par
// son identifiant IFC, qui ne change pas d'une version de maquette à l'autre.
import { definirCouche, retirerCouche, selectionCourante, STYLES, type Ids } from "./apparence";
import { selectionChangee } from "./fiche";
import { alerte, bouton, el } from "./noyau";
import { nuage } from "./nuage/client";
import { projetCharge } from "./nuage/projets";
import { maquettes } from "./registre";

const COUCHE = "realise";
let projet: string | null = null;
/** Éléments réalisés : identifiant IFC → date. */
const realises = new Map<string, string>();
let actif = false;
let courant: { modele: string; id: number; guid: string } | null = null;
let tour = 0;

// --- Bouton dans la fiche de l'élément ------------------------------------------------

const btn = bouton("fiche-realise", "", () => void basculer());
btn.hidden = true;
el("fiche-entete").insertBefore(btn, el("fiche-fermer"));

const jour = (d: string) => new Date(d).toLocaleDateString("fr-FR");

function majBouton() {
  btn.hidden = !actif || !courant;
  if (!courant) return;
  const le = realises.get(courant.guid);
  btn.classList.toggle("fait", !!le);
  btn.innerHTML = `<span class="fiche-realise-case" aria-hidden="true">${le ? "✓" : ""}</span>Réalisé`;
  btn.setAttribute("aria-pressed", String(!!le));
  btn.title = le ? `Réalisé le ${jour(le)}. Toucher pour le remettre à faire.` : "Marquer cet élément comme réalisé";
}

selectionChangee.on((c) => void suivreSelection(c));
async function suivreSelection(c: { modele: string; id: number } | null) {
  const mien = ++tour;
  courant = null;
  majBouton();
  if (!actif || !c) return;
  const m = maquettes.get(c.modele);
  if (!m) return;
  const [guid] = await m.modele.getGuidsByLocalIds([c.id]).catch(() => [null]);
  if (mien !== tour || !guid) return;
  courant = { ...c, guid };
  majBouton();
}

async function basculer() {
  const c = courant;
  if (!c) return;
  const etait = realises.get(c.guid);
  // On montre tout de suite le nouvel état ; en cas d'échec, on revient en arrière.
  if (etait) realises.delete(c.guid);
  else realises.set(c.guid, new Date().toISOString());
  majBouton();
  colorer(c.modele, c.id, !etait);
  if (!projet) return; // maquette d'essai : rien n'est enregistré
  const { error } = etait
    ? await nuage.from("avancements").delete().eq("projet_id", projet).eq("guid", c.guid)
    : await nuage
        .from("avancements")
        .upsert({ projet_id: projet, guid: c.guid }, { onConflict: "projet_id,guid", ignoreDuplicates: true });
  if (!error) return;
  console.error("Avancement", error);
  if (etait) realises.set(c.guid, etait);
  else realises.delete(c.guid);
  majBouton();
  colorer(c.modele, c.id, !!etait);
  alerte("L'avancement n'a pas pu être enregistré. Vérifiez la connexion et réessayez.", 5000);
}

// --- Couleur des éléments réalisés ---------------------------------------------------------

const couche: Ids = new Map();

function colorer(modele: string, id: number, fait: boolean) {
  if (!couche.has(modele)) couche.set(modele, new Set());
  if (fait) couche.get(modele)!.add(id);
  else couche.get(modele)!.delete(id);
  if (actif) void definirCouche(COUCHE, STYLES.realise, couche);
}

/** Retrouve les éléments réalisés dans les maquettes affichées et les colore. */
async function toutColorer() {
  couche.clear();
  if (!actif) return retirerCouche(COUCHE);
  const guids = [...realises.keys()];
  if (guids.length) {
    for (const m of maquettes.values()) {
      const ids = await m.modele.getLocalIdsByGuids(guids).catch(() => [] as (number | null)[]);
      const trouves = new Set(ids.filter((x): x is number => x !== null));
      if (trouves.size) couche.set(m.id, trouves);
    }
  }
  return definirCouche(COUCHE, STYLES.realise, couche.size ? couche : null);
}

// --- Chargement avec le projet ----------------------------------------------------------

projetCharge.on((id) => void charger(id));
async function charger(id: string | null) {
  projet = id;
  realises.clear();
  courant = null;
  if (id) {
    // Lu par paquets de 1000 (limite d'une réponse).
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await nuage
        .from("avancements")
        .select("guid, realise_le")
        .eq("projet_id", id)
        .range(debut, debut + 999);
      if (error || projet !== id) {
        if (error) console.error("Avancement", error);
        break;
      }
      for (const r of data ?? []) realises.set(r.guid as string, r.realise_le as string);
      if (!data || data.length < 1000) break;
    }
  }
  majBouton();
  if (actif) await toutColorer();
}

/** Visite à la première personne : bouton « Réalisé » dans la fiche et éléments réalisés en vert. */
export function activerAvancement(oui: boolean) {
  if (actif === oui) return;
  actif = oui;
  if (!oui) courant = null;
  majBouton();
  // Un élément déjà sélectionné en entrant dans la visite a aussi son bouton.
  if (oui) void suivreSelection(selectionCourante());
  void toutColorer();
}
