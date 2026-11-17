// Petits composants d'interface communs aux outils.
import { cree } from "../noyau";

export function interrupteur(libelle: string, coche: boolean, change: (v: boolean) => void) {
  const racine = cree("label", "interrupteur");
  const input = cree("input");
  input.type = "checkbox";
  input.checked = coche;
  input.addEventListener("change", () => change(input.checked));
  racine.append(input, cree("span", "", libelle));
  return { racine, input };
}

export function puces<T extends string>(
  options: { valeur: T; libelle: string }[],
  actuel: T | null,
  change: (v: T) => void,
) {
  const racine = cree("div", "puces");
  const boutons = new Map<T, HTMLButtonElement>();
  const choisir = (v: T | null) => {
    for (const [k, b] of boutons) b.classList.toggle("allume", k === v);
  };
  for (const o of options) {
    const b = cree("button", "puce", o.libelle);
    b.type = "button";
    b.addEventListener("click", () => {
      choisir(o.valeur);
      change(o.valeur);
    });
    boutons.set(o.valeur, b);
    racine.append(b);
  }
  choisir(actuel);
  return { racine, choisir };
}

export function curseur(min: number, max: number, pas: number, valeur: number, change: (v: number) => void) {
  const racine = cree("div", "rangee");
  const input = cree("input");
  input.type = "range";
  input.className = "curseur";
  const sortie = cree("span", "valeur-curseur");
  const regler = (mi: number, ma: number, v: number) => {
    input.min = String(mi);
    input.max = String(ma);
    input.step = String(pas);
    input.value = String(v);
  };
  regler(min, max, valeur);
  input.addEventListener("input", () => change(Number(input.value)));
  racine.append(input, sortie);
  return { racine, input, sortie, regler };
}

export function selecteur(options: { valeur: string; libelle: string }[], valeur: string, change: (v: string) => void) {
  const s = cree("select", "selecteur");
  for (const o of options) {
    const opt = cree("option", "", o.libelle);
    opt.value = o.valeur;
    s.append(opt);
  }
  s.value = valeur;
  s.addEventListener("change", () => change(s.value));
  return s;
}

export function note(texte: string) {
  return cree("p", "note", texte);
}

export function titreSection(texte: string) {
  return cree("div", "section-titre", texte);
}
