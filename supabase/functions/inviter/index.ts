// Invite une personne dans un projet. Si elle a déjà un compte, elle est ajoutée
// tout de suite ; sinon elle reçoit un e-mail d'invitation et entrera dans le projet
// en créant son compte.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const PERSONNES_MAX = 20;

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await service.auth.getUser(jeton);
  const moi = qui?.user;
  if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);

  let entree: { projet?: string; email?: string; retour?: string };
  try {
    entree = await req.json();
  } catch {
    return reponse({ erreur: "DEMANDE" }, 400);
  }
  const email = String(entree.email ?? "").trim().toLowerCase();
  const projetId = String(entree.projet ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return reponse({ erreur: "EMAIL" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(projetId)) return reponse({ erreur: "DEMANDE" }, 400);

  const { data: projet } = await service
    .from("projets")
    .select("id, nom, proprietaire")
    .eq("id", projetId)
    .maybeSingle();
  if (!projet || projet.proprietaire !== moi.id) return reponse({ erreur: "INTERDIT" }, 403);
  if (email === (moi.email ?? "").toLowerCase()) return reponse({ erreur: "SOI_MEME" }, 400);

  const [{ count: nbMembres }, { count: nbInvites }] = await Promise.all([
    service.from("membres").select("*", { count: "exact", head: true }).eq("projet_id", projetId),
    service.from("invitations").select("*", { count: "exact", head: true }).eq("projet_id", projetId),
  ]);
  if ((nbMembres ?? 0) + (nbInvites ?? 0) >= PERSONNES_MAX) return reponse({ erreur: "LIMITE" }, 400);

  // Déjà inscrite : ajout direct.
  const { data: profil } = await service.from("profils").select("id").eq("email", email).maybeSingle();
  if (profil) {
    const { error } = await service
      .from("membres")
      .upsert({ projet_id: projetId, utilisateur_id: profil.id }, { ignoreDuplicates: true });
    if (error) return reponse({ erreur: "SERVEUR" }, 500);
    return reponse({ etat: "ajoute" });
  }

  // Pas encore inscrite : invitation en attente + e-mail.
  const { error: errInvitation } = await service
    .from("invitations")
    .upsert({ projet_id: projetId, email, invite_par: moi.id }, { ignoreDuplicates: true });
  if (errInvitation) return reponse({ erreur: "SERVEUR" }, 500);

  const { data: inviteur } = await service.from("profils").select("prenom").eq("id", moi.id).maybeSingle();
  const { error: errMail } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: typeof entree.retour === "string" ? entree.retour : undefined,
    data: { invite_par: inviteur?.prenom || moi.email, projet: projet.nom },
  });
  if (errMail) {
    console.error("invitation", errMail.message);
    return reponse({ etat: "invite", mail: false });
  }
  return reponse({ etat: "invite", mail: true });
});
