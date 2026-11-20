// Lien d'invitation reçu par e-mail (sans être connecté).
// - « lire » : à qui s'adresse l'invitation, pour quel projet, de la part de qui ;
// - « accepter » : crée le compte (adresse déjà prouvée par le lien) avec le prénom et le
//   mot de passe choisis ; à la création, la personne entre dans tous les projets où elle
//   était invitée.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function empreinte(jeton: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  let entree: { action?: string; jeton?: string; prenom?: string; motdepasse?: string };
  try {
    entree = await req.json();
  } catch {
    return reponse({ erreur: "DEMANDE" }, 400);
  }
  const jeton = String(entree.jeton ?? "");
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(jeton)) return reponse({ erreur: "INVALIDE" }, 404);

  const { data: invitation } = await service
    .from("invitations")
    .select("projet_id, email, expire_le, invite_par")
    .eq("jeton_hash", await empreinte(jeton))
    .maybeSingle();
  if (!invitation || new Date(invitation.expire_le).getTime() < Date.now()) {
    return reponse({ erreur: "INVALIDE" }, 404);
  }

  const [{ data: projet }, { data: inviteur }, { data: compte }] = await Promise.all([
    service.from("projets").select("nom").eq("id", invitation.projet_id).maybeSingle(),
    service.from("profils").select("prenom, email").eq("id", invitation.invite_par).maybeSingle(),
    service.from("profils").select("id").eq("email", invitation.email).maybeSingle(),
  ]);
  if (!projet) return reponse({ erreur: "INVALIDE" }, 404);

  if (entree.action === "lire") {
    return reponse({
      email: invitation.email,
      projet: projet.nom,
      projet_id: invitation.projet_id,
      invite_par: inviteur?.prenom || inviteur?.email || "",
      compte: !!compte,
    });
  }

  if (entree.action !== "accepter") return reponse({ erreur: "DEMANDE" }, 400);
  if (compte) return reponse({ erreur: "DEJA_INSCRIT", email: invitation.email }, 409);

  const prenom = String(entree.prenom ?? "").trim().slice(0, 60);
  const motdepasse = String(entree.motdepasse ?? "");
  if (!prenom) return reponse({ erreur: "PRENOM" }, 400);
  if (motdepasse.length < 8 || motdepasse.length > 72) return reponse({ erreur: "MOT_DE_PASSE" }, 400);

  const { error } = await service.auth.admin.createUser({
    email: invitation.email,
    password: motdepasse,
    email_confirm: true,
    user_metadata: { prenom },
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("already") || m.includes("exists")) return reponse({ erreur: "DEJA_INSCRIT", email: invitation.email }, 409);
    if (m.includes("password")) return reponse({ erreur: "MOT_DE_PASSE" }, 400);
    console.error("invitation : création du compte", error.message);
    return reponse({ erreur: "SERVEUR" }, 500);
  }
  return reponse({ ok: true, email: invitation.email, projet_id: invitation.projet_id });
});
