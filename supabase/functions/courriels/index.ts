// Tous les e-mails de NexBim passent par ici (textes dans ../_partage/courriels/textes.ts).
//
// 1. E-mails de compte (inscription, mot de passe oublié, changement d'adresse, lien de connexion,
//    code de vérification) : Supabase appelle cette fonction au lieu d'envoyer ses propres e-mails
//    (Authentication → Hooks → « Send Email », type HTTPS). Requête signée (en-tête webhook-signature)
//    avec le secret SEND_EMAIL_HOOK_SECRET. La langue vient de user_metadata.langue.
// 2. Outil d'administration, appelé uniquement depuis la base (pg_net) avec la clé rangée dans
//    prive.cle_outil_courriel (en-tête x-cle-outil) :
//    - « apercu » : un exemplaire de chaque e-mail, envoyé à l'administrateur et à lui seul ;
//    - « renvoyer » : renvoie une invitation déjà en attente (nouveau lien, ancien lien annulé).
// Les invitations dans un projet sont envoyées par la fonction « inviter ».
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { rediger } from "../_partage/courriels/modeles.ts";
import { envoyer } from "../_partage/courriels/envoi.ts";
import { SITE } from "../_partage/courriels/mise-en-page.ts";
import type { TypeCourriel } from "../_partage/courriels/textes.ts";
import { inviterParCourriel, VALIDITE_JOURS } from "../_partage/invitations.ts";

const URL_PROJET = Deno.env.get("SUPABASE_URL")!;

interface Donnees {
  user: { email: string; new_email?: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
  };
}

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });

const echec = (message: string, statut = 500) => json({ error: { http_code: statut, message } }, statut);

/** Lien de validation Supabase, qui ramène ensuite sur le site. */
function lienValidation(jetonHash: string, type: string, retour: string) {
  const p = new URLSearchParams({ token: jetonHash, type, redirect_to: retour || SITE });
  return `${URL_PROJET}/auth/v1/verify?${p.toString()}`;
}

const MODELES: Record<string, TypeCourriel> = {
  signup: "confirmation",
  recovery: "recuperation",
  magiclink: "lien_connexion",
  email: "lien_connexion",
  invite: "invitation_compte",
  reauthentication: "code",
};

/* ---------- 1. E-mails de compte ---------- */

async function emailDeCompte(req: Request): Promise<Response> {
  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!secret) return echec("SEND_EMAIL_HOOK_SECRET absent");

  const charge = await req.text();
  let d: Donnees;
  try {
    d = new Webhook(secret.replace(/^v1,whsec_/, "")).verify(charge, Object.fromEntries(req.headers)) as Donnees;
  } catch {
    return echec("Signature invalide", 401);
  }

  const { user, email_data: e } = d;
  const langue = user.user_metadata?.langue;
  const retour = e.redirect_to || e.site_url || SITE;
  const type = e.email_action_type;

  const envois: { a: string; modele: TypeCourriel; lien?: string; code?: string }[] = [];
  if (type === "email_change") {
    // Attention : noms inversés côté Supabase. token_hash_new va à l'adresse actuelle,
    // token_hash à la nouvelle adresse.
    const nouvelle = user.new_email ?? "";
    if (e.token_hash_new && user.email) {
      envois.push({ a: user.email, modele: "changement_email_ancienne", lien: lienValidation(e.token_hash_new, "email_change", retour) });
    }
    if (e.token_hash && nouvelle) {
      envois.push({ a: nouvelle, modele: "changement_email", lien: lienValidation(e.token_hash, "email_change", retour) });
    }
  } else if (MODELES[type]) {
    const modele = MODELES[type];
    envois.push({
      a: user.email,
      modele,
      code: modele === "code" ? e.token : undefined,
      lien: modele === "code" ? undefined : lienValidation(e.token_hash, type === "email" ? "magiclink" : type, retour),
    });
  } else {
    console.error("courriel-auth : type inconnu", type);
    return echec(`Type d'e-mail inconnu : ${type}`, 400);
  }

  for (const envoi of envois) {
    const courriel = rediger(envoi.modele, langue, {
      email: user.email,
      nouvelle: user.new_email ?? "",
      lien: envoi.lien,
      code: envoi.code,
    });
    const r = await envoyer(envoi.a, courriel, { etiquette: envoi.modele });
    if (!r.ok) return echec(`Envoi impossible (${r.raison})`);
  }
  return json({});
}

/* ---------- 2. Outil d'administration ---------- */

const ADMIN = "baziventillateur@gmail.com";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXEMPLES: Record<TypeCourriel, Parameters<typeof rediger>[2]> = {
  invitation: { inviteur: "Émir", projet: "Chantier IDF", jours: VALIDITE_JOURS, lien: `${SITE}?invitation=exemple` },
  ajout: { inviteur: "Émir", projet: "Chantier IDF", lien: SITE },
  confirmation: { lien: SITE },
  recuperation: { lien: SITE },
  changement_email: { email: ADMIN, nouvelle: "nouvelle.adresse@exemple.fr", lien: SITE },
  changement_email_ancienne: { email: ADMIN, nouvelle: "nouvelle.adresse@exemple.fr", lien: SITE },
  lien_connexion: { lien: SITE },
  code: { code: "482913" },
  invitation_compte: { lien: SITE },
};

async function outil(req: Request): Promise<Response> {
  const cle = req.headers.get("x-cle-outil") ?? "";
  const { data: valide } = await service.rpc("verifier_cle_outil_courriel", { c: cle });
  if (valide !== true) return json({ erreur: "INTERDIT" }, 403);

  let entree: { action?: string; types?: TypeCourriel[]; langue?: string; projet?: string; email?: string };
  try {
    entree = await req.json();
  } catch {
    return json({ erreur: "DEMANDE" }, 400);
  }

  if (entree.action === "apercu") {
    const types = (entree.types?.length ? entree.types : (Object.keys(EXEMPLES) as TypeCourriel[])).filter(
      (t) => t in EXEMPLES,
    );
    const resultats: Record<string, string> = {};
    for (const t of types) {
      const courriel = rediger(t, entree.langue, EXEMPLES[t]);
      courriel.sujet = `[Essai] ${courriel.sujet}`;
      const r = await envoyer(ADMIN, courriel, { etiquette: `apercu_${t}` });
      resultats[t] = r.ok ? r.id : r.raison;
    }
    return json({ ok: true, resultats });
  }

  if (entree.action === "renvoyer") {
    const email = String(entree.email ?? "").trim().toLowerCase();
    const { data: invitation } = await service
      .from("invitations")
      .select("projet_id, email, invite_par")
      .eq("projet_id", String(entree.projet ?? ""))
      .eq("email", email)
      .maybeSingle();
    if (!invitation) return json({ erreur: "AUCUNE_INVITATION" }, 404);
    const [{ data: projet }, { data: profil }, { data: compte }] = await Promise.all([
      service.from("projets").select("nom").eq("id", invitation.projet_id).single(),
      service.from("profils").select("prenom").eq("id", invitation.invite_par).maybeSingle(),
      service.auth.admin.getUserById(invitation.invite_par),
    ]);
    const { enregistre, envoi } = await inviterParCourriel(service, {
      projetId: invitation.projet_id,
      projetNom: projet?.nom ?? "",
      email,
      inviteur: { id: invitation.invite_par, email: compte?.user?.email ?? "", prenom: profil?.prenom ?? "" },
      langue: entree.langue,
    });
    return json({ ok: enregistre && envoi.ok, envoi });
  }

  return json({ erreur: "ACTION" }, 400);
}

Deno.serve((req: Request) => {
  if (req.method !== "POST") return Promise.resolve(echec("Méthode non permise", 405));
  if (req.headers.has("x-cle-outil")) return outil(req);
  return emailDeCompte(req);
});
