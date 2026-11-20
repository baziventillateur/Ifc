// Invite une personne dans un projet (réservé au créateur du projet).
// - Elle a déjà un compte : elle est ajoutée tout de suite et reçoit un e-mail qui la prévient.
// - Pas encore de compte : invitation en attente et e-mail avec un lien personnel, valable
//   30 jours, pour créer son compte et entrer dans le projet (fonction « invitation »).
//   Inviter à nouveau la même adresse renvoie un nouveau lien.
// Les textes des e-mails sont dans ../_partage/courriels/textes.ts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { inviterParCourriel, prevenirAjout } from "../_partage/invitations.ts";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const ADMIN = "baziventillateur@gmail.com";
const PERSONNES_MAX = 20;
/** Invitations envoyées par compte et par 24 h (l'administrateur n'est pas limité). */
const ENVOIS_JOUR = 40;
/** Délai minimal avant de renvoyer la même invitation. */
const RENVOI_SECONDES = 60;

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  const jetonSession = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await service.auth.getUser(jetonSession);
  const moi = qui?.user;
  if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);
  const admin = (moi.email ?? "").toLowerCase() === ADMIN && !!moi.email_confirmed_at;

  let entree: { projet?: string; email?: string; langue?: string };
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

  const [{ data: profil }, { data: enAttente }, { data: monProfil }] = await Promise.all([
    service.from("profils").select("id").eq("email", email).maybeSingle(),
    service.from("invitations").select("envoye_le").eq("projet_id", projetId).eq("email", email).maybeSingle(),
    service.from("profils").select("prenom").eq("id", moi.id).maybeSingle(),
  ]);
  const inviteur = { id: moi.id, email: moi.email ?? "", prenom: monProfil?.prenom ?? "" };

  if (profil) {
    const { data: deja } = await service
      .from("membres")
      .select("projet_id")
      .eq("projet_id", projetId)
      .eq("utilisateur_id", profil.id)
      .maybeSingle();
    if (deja) return reponse({ etat: "deja" });
  }

  // Une invitation déjà en attente pour cette adresse ne compte pas deux fois.
  if (!enAttente) {
    const [{ count: nbMembres }, { count: nbInvites }] = await Promise.all([
      service.from("membres").select("*", { count: "exact", head: true }).eq("projet_id", projetId),
      service.from("invitations").select("*", { count: "exact", head: true }).eq("projet_id", projetId),
    ]);
    if ((nbMembres ?? 0) + (nbInvites ?? 0) >= PERSONNES_MAX) return reponse({ erreur: "LIMITE" }, 400);
  } else if (Date.now() - new Date(enAttente.envoye_le).getTime() < RENVOI_SECONDES * 1000) {
    return reponse({ erreur: "TROP_TOT" }, 429);
  }
  if (!admin) {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await service
      .from("invitations")
      .select("*", { count: "exact", head: true })
      .eq("invite_par", moi.id)
      .gte("envoye_le", depuis);
    if ((count ?? 0) >= ENVOIS_JOUR) return reponse({ erreur: "QUOTA" }, 429);
  }

  // --- Déjà inscrite : ajout direct, et un e-mail pour la prévenir.
  if (profil) {
    const { error } = await service
      .from("membres")
      .upsert({ projet_id: projetId, utilisateur_id: profil.id }, { ignoreDuplicates: true });
    if (error) return reponse({ erreur: "SERVEUR" }, 500);
    await service.from("invitations").delete().eq("projet_id", projetId).eq("email", email);
    const envoi = await prevenirAjout({ projetId, projetNom: projet.nom, email, inviteur, langue: entree.langue });
    return reponse({ etat: "ajoute", mail: envoi.ok });
  }

  // --- Pas encore de compte : invitation en attente avec un lien personnel.
  const { enregistre, envoi } = await inviterParCourriel(service, {
    projetId,
    projetNom: projet.nom,
    email,
    inviteur,
    langue: entree.langue,
  });
  if (!enregistre) return reponse({ erreur: "SERVEUR" }, 500);

  // Inscription survenue entre-temps : l'invitation devient un accès tout de suite.
  const { data: inscrit } = await service.from("profils").select("id").eq("email", email).maybeSingle();
  if (inscrit) {
    await service
      .from("membres")
      .upsert({ projet_id: projetId, utilisateur_id: inscrit.id }, { ignoreDuplicates: true });
    await service.from("invitations").delete().eq("projet_id", projetId).eq("email", email);
  }

  return reponse({ etat: enAttente ? "renvoye" : "invite", mail: envoi.ok });
});
