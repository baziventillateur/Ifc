// Assistant IA de NexBim : relaie les questions vers Claude avec la clé du propriétaire
// (secret ANTHROPIC_API_KEY), après contrôle du quota de la personne connectée.
// Essai : 3 questions par compte. Ensuite, l'administrateur ouvre l'accès depuis le
// panneau admin ; il reçoit une alerte par e-mail (secret RESEND_API_KEY) au blocage.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const ADMIN = "baziventillateur@gmail.com";
const ESSAI = 3;
const MODELES = new Set(["claude-sonnet-5-5", "claude-haiku-5-5"]);
const TAILLE_MAX = 600_000;
const CADRE =
  "Tu es l'assistant de NexBim, visionneuse de maquettes IFC. Tu ne traites que les maquettes chargées, le BIM et la construction ; pour tout autre sujet, réponds poliment que ce n'est pas ton rôle.";

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function alerter(email: string, prenom: string) {
  const cle = Deno.env.get("RESEND_API_KEY");
  if (!cle) return;
  const qui = prenom ? `${prenom} (${email})` : email;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "NexBim <nexbim@paceapp.fr>",
        to: [ADMIN],
        subject: `NexBim · ${qui} a terminé son essai de l'IA`,
        text:
          `${qui} a utilisé ses ${ESSAI} questions d'essai de l'assistant IA et demande l'accès.\n\n` +
          `Pour l'activer : https://nexbim.paceapp.fr/ → Projet → Panneau admin → « Activer l'IA ».`,
      }),
    });
  } catch (e) {
    console.error("alerte", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await service.auth.getUser(jeton);
  const moi = qui?.user;
  if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);
  const admin = (moi.email ?? "").toLowerCase() === ADMIN && !!moi.email_confirmed_at;

  const brut = await req.text();
  if (brut.length > TAILLE_MAX) return reponse({ erreur: "TROP_LONG" }, 413);
  let entree: { action?: string; model?: string; system?: string; tools?: unknown[]; messages?: any[] };
  try {
    entree = JSON.parse(brut);
  } catch {
    return reponse({ erreur: "DEMANDE" }, 400);
  }

  // État du quota, pour l'affichage.
  if (entree.action === "etat") {
    const { data } = await service
      .from("ia_acces")
      .select("questions, actif, demande_le")
      .eq("utilisateur_id", moi.id)
      .maybeSingle();
    return reponse({
      admin,
      actif: admin || !!data?.actif,
      questions: data?.questions ?? 0,
      essai: ESSAI,
      demande: !!data?.demande_le,
    });
  }

  const messages = Array.isArray(entree.messages) ? entree.messages : [];
  const derniere = messages[messages.length - 1];
  if (!derniere || derniere.role !== "user" || messages.length > 80) return reponse({ erreur: "DEMANDE" }, 400);
  // Une nouvelle question (et non un retour d'outil) compte dans l'essai.
  const question =
    typeof derniere.content === "string" ||
    (Array.isArray(derniere.content) && !derniere.content.some((c: any) => c?.type === "tool_result"));

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return reponse({ erreur: "CLE_ABSENTE" }, 503);

  const { data: quota, error } = await service.rpc("ia_consommer", {
    p_uid: moi.id,
    p_question: question,
    p_admin: admin,
  });
  if (error || !quota) {
    console.error("quota", error);
    return reponse({ erreur: "QUOTA_INDISPONIBLE" }, 500);
  }
  if (quota.alerter) {
    const { data: profil } = await service.from("profils").select("prenom").eq("id", moi.id).maybeSingle();
    await alerter(moi.email ?? "", profil?.prenom ?? "");
  }
  if (!quota.autorise) return reponse({ erreur: quota.raison, essai: ESSAI }, 402);

  const modele = MODELES.has(String(entree.model)) ? String(entree.model) : "claude-sonnet-5-5";
  const contexte = typeof entree.system === "string" ? entree.system.slice(0, 8000) : "";
  const rep = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: modele,
      max_tokens: 4096,
      system: `${CADRE}\n\n${contexte}`,
      tools: Array.isArray(entree.tools) ? entree.tools.slice(0, 20) : undefined,
      messages,
    }),
  });
  const donnees = await rep.json().catch(() => null);
  if (!rep.ok) {
    console.error("anthropic", rep.status, donnees?.error?.message);
    return reponse({ erreur: "ANTHROPIC", statut: rep.status }, 502);
  }
  return reponse({ ...donnees, nexbim: { questions: quota.questions, actif: quota.actif, essai: ESSAI } });
});
