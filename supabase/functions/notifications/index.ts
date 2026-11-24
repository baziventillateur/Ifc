// Notifications sur l'appareil (Web Push) de NexBim.
// 1. Depuis la base (pg_net, en-tête x-cle-outil, voir prive.notifier) :
//    - « arrivee »  : quelqu'un ouvre NexBim → l'administrateur est prévenu (s'il l'a demandé) ;
//    - « maquette » : nouvelle maquette dans un projet → les autres personnes du projet ;
//    - « membre »   : invité arrivé → le créateur du projet ; projet partagé → la personne ajoutée.
// 2. Depuis l'appli (personne connectée) :
//    - « preparer » : crée les clés VAPID au tout premier usage et renvoie la clé publique ;
//    - « tester »   : une notification d'essai sur ses propres appareils ;
//    - « envoyer »  : administrateur seulement, un message à une personne ou à tous.
// Les clés : publique dans prive.vapid, privée dans le coffre (vault), lue ici seulement.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const ADMIN = "baziventillateur@gmail.com";
const reponse = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Message {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Clés VAPID : créées une seule fois, au premier besoin. */
let cles: { publique: string; privee: string } | null = null;
async function clesVapid() {
  if (cles) return cles;
  let { data: publique } = await service.rpc("vapid_publique");
  if (!publique) {
    const k = webpush.generateVAPIDKeys();
    await service.rpc("notif_vapid_enregistrer", { p_publique: k.publicKey, p_privee: k.privateKey });
    ({ data: publique } = await service.rpc("vapid_publique"));
  }
  const { data: privee } = await service.rpc("notif_vapid_privee");
  if (!publique || !privee) throw new Error("VAPID");
  cles = { publique: publique as string, privee: privee as string };
  webpush.setVapidDetails(`mailto:${ADMIN}`, cles.publique, cles.privee);
  return cles;
}

/** Envoie à tous les appareils des comptes donnés ; retire les abonnements expirés. */
async function envoyerA(utilisateurs: string[], m: Message) {
  const ids = [...new Set(utilisateurs.filter(Boolean))];
  if (!ids.length) return { envoyes: 0, echecs: 0 };
  const { data: abonnements } = await service
    .from("push_abonnements")
    .select("endpoint, p256dh, auth")
    .in("utilisateur_id", ids);
  if (!abonnements?.length) return { envoyes: 0, echecs: 0 };
  await clesVapid();
  const charge = JSON.stringify({ title: m.title, body: m.body, url: m.url ?? "./", tag: m.tag ?? "nexbim" });
  const perimes: string[] = [];
  let envoyes = 0;
  let echecs = 0;
  await Promise.all(
    abonnements.map(async (a) => {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, charge, {
          TTL: 6 * 3600,
          urgency: "normal",
        });
        envoyes++;
      } catch (e) {
        echecs++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) perimes.push(a.endpoint);
        else console.error("notification", code ?? String(e).slice(0, 160));
      }
    }),
  );
  if (perimes.length) await service.from("push_abonnements").delete().in("endpoint", perimes);
  return { envoyes, echecs };
}

const nomDe = (p: { prenom?: string | null; email?: string | null } | null) =>
  (p?.prenom ?? "").trim() || (p?.email ?? "").split("@")[0] || "Quelqu'un";

async function reglage(cle: string) {
  const { data } = await service.from("reglages_app").select("valeur").eq("cle", cle).maybeSingle();
  return (data?.valeur ?? {}) as Record<string, unknown>;
}

// --- Événements venus de la base ------------------------------------------------------------
async function evenement(e: Record<string, unknown>) {
  if (e.evenement === "arrivee") {
    const alertes = await reglage("alertes_admin");
    if (alertes.arrivee !== true) return { ignore: "alertes desactivees" };
    const [{ data: qui }, { data: admin }] = await Promise.all([
      service.from("profils").select("prenom, email, en_ligne_lieu").eq("id", String(e.utilisateur)).maybeSingle(),
      service.from("profils").select("id").eq("email", ADMIN).maybeSingle(),
    ]);
    if (!qui || !admin) return { ignore: "inconnu" };
    return envoyerA([admin.id], {
      title: `🟢 ${nomDe(qui)} est sur NexBim`,
      body: qui.email ?? "",
      tag: `arrivee-${e.utilisateur}`,
    });
  }

  if (e.evenement === "maquette") {
    const projetId = String(e.projet);
    const [{ data: projet }, { data: membres }, { data: auteur }] = await Promise.all([
      service.from("projets").select("nom, proprietaire").eq("id", projetId).maybeSingle(),
      service.from("membres").select("utilisateur_id").eq("projet_id", projetId),
      service.from("profils").select("prenom, email").eq("id", String(e.par)).maybeSingle(),
    ]);
    if (!projet) return { ignore: "projet" };
    const cibles = [projet.proprietaire, ...(membres ?? []).map((m) => m.utilisateur_id)].filter((id) => id !== e.par);
    return envoyerA(cibles, {
      title: `Nouvelle maquette · ${projet.nom}`,
      body: `${nomDe(auteur)} a déposé « ${String(e.nom ?? "").replace(/\.ifc$/i, "")} ».`,
      url: `./?projet=${projetId}`,
      tag: `maquette-${projetId}`,
    });
  }

  if (e.evenement === "membre") {
    const projetId = String(e.projet);
    const [{ data: projet }, { data: qui }] = await Promise.all([
      service.from("projets").select("nom, proprietaire").eq("id", projetId).maybeSingle(),
      service.from("profils").select("prenom, email, cree_le").eq("id", String(e.utilisateur)).maybeSingle(),
    ]);
    if (!projet || !qui) return { ignore: "inconnu" };
    // Compte tout juste créé depuis le lien : c'est l'invité qui arrive, on prévient le créateur.
    const nouveau = Date.now() - new Date(qui.cree_le).getTime() < 15 * 60 * 1000;
    if (nouveau) {
      return envoyerA([projet.proprietaire], {
        title: `🎉 ${nomDe(qui)} a rejoint « ${projet.nom} »`,
        body: "Votre invitation a été acceptée : il peut consulter les maquettes du projet.",
        url: `./?projet=${projetId}`,
        tag: `membre-${projetId}`,
      });
    }
    const { data: createur } = await service.from("profils").select("prenom, email").eq("id", projet.proprietaire).maybeSingle();
    return envoyerA([String(e.utilisateur)], {
      title: `Projet partagé · ${projet.nom}`,
      body: `${nomDe(createur)} a partagé ce projet avec vous.`,
      url: `./?projet=${projetId}`,
      tag: `membre-${projetId}`,
    });
  }
  return { ignore: "evenement" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);
  let corps: Record<string, unknown> = {};
  try {
    corps = await req.json();
  } catch {
    return reponse({ erreur: "DEMANDE" }, 400);
  }

  try {
    // Appel de la base.
    const cleOutil = req.headers.get("x-cle-outil");
    if (cleOutil) {
      const { data: valide } = await service.rpc("verifier_cle_outil_courriel", { c: cleOutil });
      if (valide !== true) return reponse({ erreur: "INTERDIT" }, 403);
      return reponse(await evenement(corps));
    }

    // Appel de l'appli : personne connectée.
    const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: qui } = await service.auth.getUser(jeton);
    const moi = qui?.user;
    if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);
    const admin = (moi.email ?? "").toLowerCase() === ADMIN && !!moi.email_confirmed_at;

    if (corps.action === "preparer") return reponse({ cle: (await clesVapid()).publique });

    if (corps.action === "tester") {
      const r = await envoyerA([moi.id], {
        title: "🔔 Notifications activées",
        body: "Vous serez prévenu ici des nouvelles maquettes et des invités qui rejoignent vos projets.",
        tag: "nexbim-essai",
      });
      return reponse(r);
    }

    if (corps.action === "envoyer") {
      if (!admin) return reponse({ erreur: "INTERDIT" }, 403);
      const titre = String(corps.titre ?? "").trim().slice(0, 80);
      const texte = String(corps.texte ?? "").trim().slice(0, 240);
      if (!titre) return reponse({ erreur: "TITRE" }, 400);
      let cibles: string[];
      if (corps.cible === "tous") {
        const { data } = await service.from("push_abonnements").select("utilisateur_id");
        cibles = (data ?? []).map((x) => x.utilisateur_id);
      } else {
        cibles = [String(corps.cible ?? "")].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      }
      return reponse(await envoyerA(cibles, { title: titre, body: texte, tag: `admin-${Date.now()}` }));
    }
    return reponse({ erreur: "DEMANDE" }, 400);
  } catch (e) {
    console.error("notifications", e);
    return reponse({ erreur: "SERVEUR" }, 500);
  }
});
