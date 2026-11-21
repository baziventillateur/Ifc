// Invitations dans un projet : lien personnel et e-mails (utilisé par « inviter » et « courriels »).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { rediger } from "./courriels/modeles.ts";
import { envoyer, type ResultatEnvoi } from "./courriels/envoi.ts";
import { SITE } from "./courriels/mise-en-page.ts";

export const VALIDITE_JOURS = 30;

export interface Inviteur {
  id: string;
  email: string;
  prenom: string;
}

function nouveauJeton() {
  const octets = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function empreinte(jeton: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const nomAffiche = (i: Inviteur) => i.prenom.trim() || i.email;

/**
 * Personne sans compte : enregistre (ou renouvelle) l'invitation avec un nouveau lien personnel,
 * puis envoie l'e-mail. Un ancien lien cesse de fonctionner.
 */
export async function inviterParCourriel(
  service: SupabaseClient,
  o: { projetId: string; projetNom: string; email: string; inviteur: Inviteur; langue?: string },
): Promise<{ enregistre: boolean; envoi: ResultatEnvoi }> {
  const jeton = nouveauJeton();
  const maintenant = new Date();
  const { error } = await service.from("invitations").upsert(
    {
      projet_id: o.projetId,
      email: o.email,
      invite_par: o.inviteur.id,
      jeton_hash: await empreinte(jeton),
      envoye_le: maintenant.toISOString(),
      expire_le: new Date(maintenant.getTime() + VALIDITE_JOURS * 24 * 3600 * 1000).toISOString(),
    },
    { onConflict: "projet_id,email" },
  );
  if (error) {
    console.error("invitation : enregistrement", error.message);
    return { enregistre: false, envoi: { ok: false, raison: "SERVEUR" } };
  }
  const courriel = rediger("invitation", o.langue, {
    inviteur: nomAffiche(o.inviteur),
    projet: o.projetNom,
    email: o.email,
    jours: VALIDITE_JOURS,
    lien: `${SITE}?invitation=${jeton}`,
  });
  const envoi = await envoyer(o.email, courriel, { etiquette: "invitation" });
  return { enregistre: true, envoi };
}

/** Personne déjà inscrite et ajoutée au projet : e-mail pour la prévenir. */
export function prevenirAjout(o: { projetId: string; projetNom: string; email: string; inviteur: Inviteur; langue?: string }) {
  const courriel = rediger("ajout", o.langue, {
    inviteur: nomAffiche(o.inviteur),
    projet: o.projetNom,
    email: o.email,
    lien: `${SITE}?projet=${o.projetId}`,
  });
  return envoyer(o.email, courriel, { etiquette: "ajout" });
}
