// Réglages communs à tous les comptes, choisis par l'administrateur (panneau admin) et lus au
// démarrage : les bruitages (pas de la visite, saut, chute, maquettes) et leurs volumes.
import { bouton, cree } from "./noyau";
import { nuage } from "./nuage/client";
import { STYLES_PAS, choisirStylePas, definirVolumePas, ecouterPas, prechargerSonPas, styleDesPas, volumeDesPas, type StylePas } from "./effets";
import {
  BRUITAGES,
  choisirBruitage,
  choixBruitage,
  definirVolumeBruitages,
  jouerBruitage,
  prechargerBruitages,
  volumeBruitages,
  type Evenement,
} from "./sons";

type Pas = { style?: StylePas; volume?: number };
type Sons = { pas?: StylePas; volume_pas?: number; volume?: number } & Partial<Record<Evenement, string>>;

const EVENEMENTS = Object.keys(BRUITAGES) as Evenement[];

function appliquerPas(v: Pas | undefined) {
  if (!v) return;
  if (v.style) choisirStylePas(v.style);
  if (typeof v.volume === "number") definirVolumePas(v.volume);
}
function appliquerSons(v: Sons | undefined) {
  if (!v) return;
  appliquerPas({ style: v.pas, volume: v.volume_pas });
  if (typeof v.volume === "number") definirVolumeBruitages(v.volume);
  for (const e of EVENEMENTS) if (typeof v[e] === "string") choisirBruitage(e, v[e]);
}

export async function chargerReglagesApp() {
  const { data, error } = await nuage.from("reglages_app").select("cle, valeur");
  if (error) return console.warn("réglages", error.message);
  const lignes = (data ?? []) as { cle: string; valeur: unknown }[];
  // « pas » : ancien réglage (gardé pour les versions précédentes) ; « sons » le complète.
  appliquerPas(lignes.find((r) => r.cle === "pas")?.valeur as Pas | undefined);
  appliquerSons(lignes.find((r) => r.cle === "sons")?.valeur as Sons | undefined);
}
void chargerReglagesApp();

const VOLUME_PAS_MAX = 0.25;

/** Une ligne du panneau : un titre et des puces ; toucher une puce la fait entendre et la choisit. */
function ligneChoix(titre: string, choix: { cle: string; nom: string }[], actuel: string, choisir: (cle: string) => void) {
  const ligne = cree("div", "admin-son");
  const puces = cree("div", "admin-son-puces");
  for (const c of choix) {
    const b = bouton("visite-puce" + (c.cle === actuel ? " actif" : ""), c.nom, () => {
      puces.querySelectorAll(".visite-puce").forEach((x) => x.classList.toggle("actif", x === b));
      choisir(c.cle);
    }, c.cle === "aucun" ? "Pas de bruitage" : "Écouter et choisir");
    puces.append(b);
  }
  ligne.append(cree("span", "admin-son-titre", titre), puces);
  return ligne;
}

function curseurVolume(nom: string, valeur01: number, regler: (v: number) => void, ecouter: () => void) {
  const volume = cree("label", "admin-volume");
  const curseur = cree("input");
  curseur.type = "range";
  curseur.min = "0";
  curseur.max = "100";
  curseur.value = String(Math.round(valeur01 * 100));
  const texte = cree("span", "", `${curseur.value} %`);
  curseur.addEventListener("input", () => {
    texte.textContent = `${curseur.value} %`;
    regler(Number(curseur.value) / 100);
  });
  curseur.addEventListener("change", ecouter);
  volume.append(cree("span", "admin-son-titre", nom), curseur, texte);
  return volume;
}

/** Bloc du panneau admin : un bruitage par événement et les volumes, pour tout le monde. */
export function blocReglagesPas() {
  prechargerSonPas();
  prechargerBruitages();
  const bloc = cree("div", "admin-reglage");
  bloc.append(cree("div", "groupe-titre", "Bruitages (pour tous)"));
  // Les lignes, rangées par groupe ; au-delà des premières, « Tout voir ».
  const lignes: HTMLElement[] = [cree("div", "admin-son-groupe", "Visite")];
  lignes.push(
    ligneChoix("Pas", STYLES_PAS, styleDesPas(), (cle) => {
      choisirStylePas(cle as StylePas);
      ecouterPas();
    }),
  );
  let groupe = "Visite";
  for (const e of EVENEMENTS) {
    if (BRUITAGES[e].groupe !== groupe) {
      groupe = BRUITAGES[e].groupe;
      lignes.push(cree("div", "admin-son-groupe", groupe));
    }
    lignes.push(
      ligneChoix(BRUITAGES[e].titre, BRUITAGES[e].choix, choixBruitage(e), (cle) => {
        choisirBruitage(e, cle);
        jouerBruitage(e, { choix: cle, arrivee: e === "chute" ? 0.55 : e === "saut" ? 0.5 : 0 });
      }),
    );
  }
  const VISIBLES = 7;
  const cachees = lignes.slice(VISIBLES);
  for (const l of cachees) l.hidden = true;
  bloc.append(...lignes);
  if (cachees.length) {
    const nb = cachees.filter((l) => l.classList.contains("admin-son")).length;
    const tout = bouton("lien versions-tout", `Tout voir (${nb} de plus)`, () => {
      const ouvrir = cachees[0].hidden;
      for (const l of cachees) l.hidden = !ouvrir;
      tout.textContent = ouvrir ? "Réduire" : `Tout voir (${nb} de plus)`;
    });
    bloc.append(tout);
  }
  bloc.append(
    curseurVolume("Volume des pas", volumeDesPas() / VOLUME_PAS_MAX, (v) => definirVolumePas(v * VOLUME_PAS_MAX), ecouterPas),
    curseurVolume("Volume des bruitages", volumeBruitages(), definirVolumeBruitages, () =>
      jouerBruitage("affiche", { choix: choixBruitage("affiche") === "aucun" ? "tactique" : choixBruitage("affiche") }),
    ),
  );
  const etat = cree("span", "admin-reglage-etat", "");
  const enregistrer = bouton("btn principal", "Enregistrer pour tous", async () => {
    enregistrer.disabled = true;
    const maj_le = new Date().toISOString();
    const sons: Sons = { pas: styleDesPas(), volume_pas: volumeDesPas(), volume: volumeBruitages() };
    for (const e of EVENEMENTS) sons[e] = choixBruitage(e);
    const { error } = await nuage.from("reglages_app").upsert([
      { cle: "sons", valeur: sons, maj_le },
      // Ancienne clé, lue par les versions précédentes de l'appli.
      { cle: "pas", valeur: { style: sons.pas, volume: sons.volume_pas }, maj_le },
    ]);
    enregistrer.disabled = false;
    etat.textContent = error ? "Échec de l'enregistrement." : "Enregistré : tout le monde l'entendra à sa prochaine ouverture.";
  });
  const credits = cree("a", "admin-reglage-etat", "Crédits des sons");
  credits.href = "./sons/LISEZMOI.txt";
  credits.target = "_blank";
  credits.rel = "noopener";
  const pied = cree("div", "admin-reglage-pied");
  pied.append(enregistrer, etat, credits);
  bloc.append(pied);
  return bloc;
}
