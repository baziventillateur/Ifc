// Réglages communs à tous les comptes, choisis par l'administrateur (panneau admin) et
// lus au démarrage : pour l'instant, le son des pas de la visite et son volume.
import { bouton, cree } from "./noyau";
import { nuage } from "./nuage/client";
import { STYLES_PAS, choisirStylePas, definirVolumePas, ecouterPas, prechargerSonPas, styleDesPas, volumeDesPas, type StylePas } from "./effets";

type Pas = { style?: StylePas; volume?: number };

function appliquerPas(v: Pas | undefined) {
  if (!v) return;
  if (v.style) choisirStylePas(v.style);
  if (typeof v.volume === "number") definirVolumePas(v.volume);
}

export async function chargerReglagesApp() {
  const { data, error } = await nuage.from("reglages_app").select("cle, valeur");
  if (error) return console.warn("réglages", error.message);
  for (const r of (data ?? []) as { cle: string; valeur: unknown }[]) {
    if (r.cle === "pas") appliquerPas(r.valeur as Pas);
  }
}
void chargerReglagesApp();

const VOLUME_MAX = 0.25;

/** Bloc du panneau admin : son des pas (5 choix à écouter) et volume, pour tout le monde. */
export function blocReglagesPas() {
  prechargerSonPas();
  const bloc = cree("div", "admin-reglage");
  bloc.append(cree("div", "groupe-titre", "Visite · bruit de pas (pour tous)"));
  let style = styleDesPas();
  const choix = cree("div", "visite-angles");
  for (const st of STYLES_PAS) {
    const b = bouton("visite-puce" + (st.cle === style ? " actif" : ""), st.nom, () => {
      style = st.cle;
      choix.querySelectorAll(".visite-puce").forEach((x) => x.classList.toggle("actif", x === b));
      choisirStylePas(style);
      ecouterPas();
    }, "Écouter et choisir");
    choix.append(b);
  }
  const volume = cree("label", "admin-volume");
  const curseur = cree("input");
  curseur.type = "range";
  curseur.min = "0";
  curseur.max = "100";
  curseur.value = String(Math.round((volumeDesPas() / VOLUME_MAX) * 100));
  const valeur = cree("span", "", `${curseur.value} %`);
  curseur.addEventListener("input", () => {
    valeur.textContent = `${curseur.value} %`;
    definirVolumePas((Number(curseur.value) / 100) * VOLUME_MAX);
  });
  curseur.addEventListener("change", () => ecouterPas());
  volume.append(cree("span", "", "Volume"), curseur, valeur);
  const etat = cree("span", "admin-reglage-etat", "");
  const enregistrer = bouton("btn principal", "Enregistrer pour tous", async () => {
    enregistrer.disabled = true;
    const { error } = await nuage
      .from("reglages_app")
      .upsert({ cle: "pas", valeur: { style, volume: (Number(curseur.value) / 100) * VOLUME_MAX }, maj_le: new Date().toISOString() });
    enregistrer.disabled = false;
    etat.textContent = error ? "Échec de l'enregistrement." : "Enregistré : tout le monde l'entendra à sa prochaine ouverture.";
  });
  const pied = cree("div", "admin-reglage-pied");
  pied.append(enregistrer, etat);
  bloc.append(choix, volume, pied);
  return bloc;
}
