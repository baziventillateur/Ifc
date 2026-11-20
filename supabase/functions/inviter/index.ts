// Invite une personne dans un projet (réservé au créateur du projet).
// - Elle a déjà un compte : elle est ajoutée tout de suite et reçoit un e-mail qui
//   la prévient, avec un bouton pour ouvrir le projet.
// - Pas encore de compte : invitation en attente et e-mail avec un lien personnel,
//   valable 30 jours, pour créer son compte et entrer dans le projet (fonction
//   « invitation »). Inviter à nouveau la même adresse renvoie un nouveau lien.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const SITE = "https://nexbim.paceapp.fr/";
const ADMIN = "baziventillateur@gmail.com";
const PERSONNES_MAX = 20;
const VALIDITE_JOURS = 30;
/** Invitations envoyées par compte et par 24 h (l'administrateur n'est pas limité). */
const ENVOIS_JOUR = 40;
/** Délai minimal avant de renvoyer la même invitation. */
const RENVOI_SECONDES = 60;

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const echapper = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function nouveauJeton() {
  const octets = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function empreinte(jeton: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** E-mail aux couleurs de NexBim : titre, texte, un bouton, puis le lien en clair. */
function gabarit(o: { titre: string; paragraphes: string[]; bouton: string; lien: string; note: string }) {
  const p = o.paragraphes
    .map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3d4957;">${t}</p>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${o.titre}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#1d2530;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#0f1318;padding:18px 26px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="${SITE}logo/nexbim-transparent-64.png" width="32" height="32" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;color:#e6ebf1;font-size:18px;font-weight:700;">NexBim<div style="font-size:9px;letter-spacing:2px;color:#8f9aa8;font-weight:500;margin-top:2px;">BY PACEAPP</div></td>
</tr></table></td></tr>
<tr><td style="padding:26px;">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#0f1318;">${o.titre}</h1>
${p}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr>
<td style="border-radius:8px;background:#ff8a1f;"><a href="${o.lien}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#1a1206;text-decoration:none;border-radius:8px;">${o.bouton}</a></td>
</tr></table>
<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6b7785;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${o.lien}" style="color:#b85f12;">${o.lien}</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7785;">${o.note}</p>
</td></tr>
<tr><td style="padding:14px 26px;background:#f6f8fa;border-top:1px solid #e3e8ef;font-size:12px;line-height:1.5;color:#6b7785;">
NexBim · visionneuse de maquettes IFC en ligne · une application PaceApp<br><a href="https://paceapp.fr" style="color:#6b7785;">paceapp.fr</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

async function envoyerCourriel(a: string, sujet: string, html: string, texte: string, repondreA?: string) {
  const cle = Deno.env.get("RESEND_API_KEY");
  if (!cle) {
    console.error("invitation : secret RESEND_API_KEY absent, e-mail non envoyé");
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "NexBim <nextbeam@paceapp.fr>",
        to: [a],
        subject: sujet,
        html,
        text: texte,
        ...(repondreA ? { reply_to: repondreA } : {}),
      }),
    });
    if (!r.ok) {
      console.error("invitation : Resend", r.status, (await r.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("invitation : envoi", e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  const jetonSession = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await service.auth.getUser(jetonSession);
  const moi = qui?.user;
  if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);
  const admin = (moi.email ?? "").toLowerCase() === ADMIN && !!moi.email_confirmed_at;

  let entree: { projet?: string; email?: string };
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

  const [{ data: profil }, { data: enAttente }, { data: inviteur }] = await Promise.all([
    service.from("profils").select("id").eq("email", email).maybeSingle(),
    service.from("invitations").select("envoye_le").eq("projet_id", projetId).eq("email", email).maybeSingle(),
    service.from("profils").select("prenom").eq("id", moi.id).maybeSingle(),
  ]);

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

  const prenomInviteur = (inviteur?.prenom ?? "").trim();
  const nomInviteur = prenomInviteur || moi.email || "Un utilisateur";
  const signature = prenomInviteur && moi.email ? `${echapper(prenomInviteur)} (${echapper(moi.email)})` : echapper(nomInviteur);
  const nomProjet = echapper(projet.nom);

  // --- Déjà inscrite : ajout direct, et un e-mail pour la prévenir.
  if (profil) {
    const { error } = await service
      .from("membres")
      .upsert({ projet_id: projetId, utilisateur_id: profil.id }, { ignoreDuplicates: true });
    if (error) return reponse({ erreur: "SERVEUR" }, 500);
    await service.from("invitations").delete().eq("projet_id", projetId).eq("email", email);
    const lien = `${SITE}?projet=${projetId}`;
    const mail = await envoyerCourriel(
      email,
      `${nomInviteur} vous a ajouté au projet « ${projet.nom} » sur NexBim`,
      gabarit({
        titre: "Un projet a été partagé avec vous",
        paragraphes: [
          `<strong>${signature}</strong> vous a ajouté au projet <strong>« ${nomProjet} »</strong> sur NexBim, en lecture seule.`,
          "Le projet apparaît maintenant dans votre liste de projets. Connectez-vous avec votre compte habituel pour consulter ses maquettes.",
        ],
        bouton: "Ouvrir le projet",
        lien,
        note: "Vous recevez cet e-mail parce que vous avez un compte NexBim avec cette adresse.",
      }),
      `${nomInviteur} vous a ajouté au projet « ${projet.nom} » sur NexBim, en lecture seule.\n\n` +
        `Ouvrir le projet : ${lien}\n\nNexBim · une application PaceApp`,
      moi.email ?? undefined,
    );
    return reponse({ etat: "ajoute", mail });
  }

  // --- Pas encore de compte : invitation en attente avec un lien personnel.
  const jeton = nouveauJeton();
  const maintenant = new Date();
  const { error: errInvitation } = await service.from("invitations").upsert(
    {
      projet_id: projetId,
      email,
      invite_par: moi.id,
      jeton_hash: await empreinte(jeton),
      envoye_le: maintenant.toISOString(),
      expire_le: new Date(maintenant.getTime() + VALIDITE_JOURS * 24 * 3600 * 1000).toISOString(),
    },
    { onConflict: "projet_id,email" },
  );
  if (errInvitation) {
    console.error("invitation : enregistrement", errInvitation.message);
    return reponse({ erreur: "SERVEUR" }, 500);
  }

  const lien = `${SITE}?invitation=${jeton}`;
  const mail = await envoyerCourriel(
    email,
    `${nomInviteur} vous invite sur le projet « ${projet.nom} » · NexBim`,
    gabarit({
      titre: "Vous êtes invité à rejoindre un projet",
      paragraphes: [
        `<strong>${signature}</strong> vous invite à consulter le projet <strong>« ${nomProjet} »</strong> sur NexBim, en lecture seule.`,
        "NexBim affiche les maquettes BIM (IFC) directement dans le navigateur, sur ordinateur comme sur téléphone, sans rien installer : vue 3D, mesures, coupes et quantités.",
        "Pour accepter, il vous suffit d'indiquer votre prénom et de choisir un mot de passe.",
      ],
      bouton: "Accepter l'invitation",
      lien,
      note:
        `Ce lien est personnel et valable ${VALIDITE_JOURS} jours. ` +
        "Si vous ne connaissez pas la personne qui vous invite, ignorez simplement ce message.",
    }),
    `${nomInviteur} vous invite à consulter le projet « ${projet.nom} » sur NexBim, en lecture seule.\n\n` +
      `Accepter l'invitation : ${lien}\n\n` +
      `Ce lien est personnel et valable ${VALIDITE_JOURS} jours.\n\nNexBim · une application PaceApp`,
    moi.email ?? undefined,
  );

  // Inscription survenue entre-temps : l'invitation devient un accès tout de suite.
  const { data: inscrit } = await service.from("profils").select("id").eq("email", email).maybeSingle();
  if (inscrit) {
    await service
      .from("membres")
      .upsert({ projet_id: projetId, utilisateur_id: inscrit.id }, { ignoreDuplicates: true });
    await service.from("invitations").delete().eq("projet_id", projetId).eq("email", email);
  }

  return reponse({ etat: enAttente ? "renvoye" : "invite", mail });
});
