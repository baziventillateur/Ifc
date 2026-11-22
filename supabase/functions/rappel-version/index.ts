// Prévient une personne qu'une nouvelle version de NexBim est en ligne (réservé à
// l'administrateur, depuis la fenêtre des versions). Un e-mail au plus toutes les 12 h
// par personne. Texte : ../_partage/courriels/textes.ts (« mise_a_jour »).
import { createClient } from "npm:@supabase/supabase-js@2";
import { rediger } from "../_partage/courriels/modeles.ts";
import { envoyer } from "../_partage/courriels/envoi.ts";
import { SITE } from "../_partage/courriels/mise-en-page.ts";

const ENTETES = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const ADMIN = "baziventillateur@gmail.com";
const DELAI_HEURES = 12;

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return reponse({ erreur: "METHODE" }, 405);

  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await service.auth.getUser(jeton);
  const moi = qui?.user;
  if (!moi) return reponse({ erreur: "NON_CONNECTE" }, 401);
  if ((moi.email ?? "").toLowerCase() !== ADMIN || !moi.email_confirmed_at) return reponse({ erreur: "INTERDIT" }, 403);

  let entree: { utilisateur?: string; version?: string; langue?: string };
  try {
    entree = await req.json();
  } catch {
    return reponse({ erreur: "DEMANDE" }, 400);
  }
  const id = String(entree.utilisateur ?? "");
  const version = String(entree.version ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{1,3}\.\d{1,6}$/.test(version)) return reponse({ erreur: "DEMANDE" }, 400);

  const { data: profil } = await service
    .from("profils")
    .select("email, version_app, rappel_version_le")
    .eq("id", id)
    .maybeSingle();
  if (!profil) return reponse({ erreur: "INCONNU" }, 404);
  if (profil.version_app === version) return reponse({ erreur: "A_JOUR" }, 400);
  if (profil.rappel_version_le && Date.now() - new Date(profil.rappel_version_le).getTime() < DELAI_HEURES * 3600_000) {
    return reponse({ erreur: "TROP_TOT", le: profil.rappel_version_le }, 429);
  }

  const courriel = rediger("mise_a_jour", entree.langue, { version, lien: `${SITE}?maj=${encodeURIComponent(version)}` });
  const envoi = await envoyer(profil.email, courriel, { etiquette: "mise_a_jour" });
  if (!envoi.ok) return reponse({ erreur: "ENVOI", raison: envoi.raison }, 502);
  const maintenant = new Date().toISOString();
  await service.from("profils").update({ rappel_version_le: maintenant }).eq("id", id);
  return reponse({ ok: true, le: maintenant });
});
