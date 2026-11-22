// Assemble un e-mail NexBim : textes (textes.ts) + mise en page (mise-en-page.ts).
// TypeScript pur, utilisé par les fonctions « inviter » et « courriels ».
import { COMMUN, COURRIELS, langue as choisirLangue, type TypeCourriel } from "./textes.ts";
import { blocCode, carteProjet, miseEnPage, remplir, remplirTexte } from "./mise-en-page.ts";

export interface Valeurs {
  inviteur?: string;
  projet?: string;
  email?: string;
  nouvelle?: string;
  jours?: number;
  /** Lien du bouton. */
  lien?: string;
  /** Code de vérification. */
  code?: string;
  /** Numéro de version (e-mail « mise_a_jour »). */
  version?: string;
}

export interface Courriel {
  sujet: string;
  html: string;
  texte: string;
}

export function rediger(type: TypeCourriel, langueVoulue: unknown, v: Valeurs): Courriel {
  const l = choisirLangue(langueVoulue);
  const t = COURRIELS[l][type];
  const c = COMMUN[l];
  const valeurs = {
    inviteur: v.inviteur ?? "",
    projet: v.projet ?? "",
    email: v.email ?? "",
    nouvelle: v.nouvelle ?? "",
    jours: v.jours ?? 30,
    version: v.version ?? "",
  };

  let visuel: string | undefined;
  let visuelTexte: string | undefined;
  if (type === "invitation" || type === "ajout") {
    visuel = carteProjet({ projet: valeurs.projet, atouts: c.atouts, etiquette: c.lectureSeule });
    visuelTexte = `${valeurs.projet} — ${c.atouts} — ${c.lectureSeule}`;
  } else if (type === "confirmation") {
    visuel = carteProjet({ projet: c.bienvenueCarte, atouts: c.atouts, etiquette: c.bienvenueEtiquette });
  } else if (type === "code") {
    visuel = blocCode(v.code ?? "");
    visuelTexte = `${v.code ?? ""}\n${c.codeExpire}`;
  }

  const avecBouton = !!t.bouton && !!v.lien;
  const { html, texte } = miseEnPage({
    langue: l,
    apercu: remplirTexte(t.apercu, valeurs),
    badge: t.badge,
    titre: remplirTexte(t.titre, valeurs),
    introHtml: remplir(t.intro, valeurs),
    introTexte: remplirTexte(t.intro, valeurs),
    bouton: avecBouton ? { libelle: t.bouton!, lien: v.lien! } : undefined,
    sousBouton: type === "code" ? c.codeExpire : t.sousBouton ? remplirTexte(t.sousBouton, valeurs) : undefined,
    visuel,
    visuelTexte,
    secours: avecBouton ? c.secours : undefined,
    raison: remplirTexte(t.raison, valeurs),
    application: c.application,
    contact: c.contact,
    slogan: c.slogan,
  });

  return { sujet: remplirTexte(t.sujet, valeurs), html, texte };
}
