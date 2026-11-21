// Envoi d'un e-mail NexBim par Resend (secret RESEND_API_KEY dans Supabase → Edge Functions → Secrets).
import type { Courriel } from "./modeles.ts";

/** Adresse d'envoi et de réponse de tous les e-mails NexBim. */
export const ADRESSE = "nexbim@paceapp.fr";
export const EXPEDITEUR = `NexBim <${ADRESSE}>`;
export const REPONSE_PAR_DEFAUT = ADRESSE;

export type ResultatEnvoi = { ok: true; id: string } | { ok: false; raison: string };

export async function envoyer(
  a: string,
  courriel: Courriel,
  o: { repondreA?: string; etiquette?: string } = {},
): Promise<ResultatEnvoi> {
  const cle = Deno.env.get("RESEND_API_KEY");
  if (!cle) {
    console.error("courriel : secret RESEND_API_KEY absent, e-mail non envoyé");
    return { ok: false, raison: "SANS_CLE" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EXPEDITEUR,
        to: [a],
        subject: courriel.sujet,
        html: courriel.html,
        text: courriel.texte,
        reply_to: o.repondreA || REPONSE_PAR_DEFAUT,
        // Identifiant unique : Gmail ne regroupe pas deux e-mails différents dans un même fil.
        headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
        ...(o.etiquette ? { tags: [{ name: "type", value: o.etiquette }] } : {}),
      }),
    });
    const corps = await r.text();
    if (!r.ok) {
      console.error("courriel : Resend", r.status, corps.slice(0, 300));
      return { ok: false, raison: `RESEND_${r.status}` };
    }
    return { ok: true, id: (JSON.parse(corps) as { id?: string }).id ?? "" };
  } catch (e) {
    console.error("courriel : envoi", e);
    return { ok: false, raison: "RESEAU" };
  }
}
