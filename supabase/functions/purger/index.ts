// Purge de la corbeille, appelée chaque nuit par pg_cron : efface définitivement les
// maquettes mises à la corbeille depuis plus de 60 jours (fichier puis ligne).
// Elle ne fait rien d'autre : l'appeler en dehors de la planification est sans risque.
import { createClient } from "npm:@supabase/supabase-js@2";

const JOURS = 60;
const PAQUET = 200;

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async () => {
  const limite = new Date(Date.now() - JOURS * 86_400_000).toISOString();
  const { data, error } = await service
    .from("maquettes")
    .select("id, chemin")
    .not("supprime_le", "is", null)
    .lt("supprime_le", limite)
    .limit(PAQUET);
  if (error) {
    console.error("lecture", error);
    return new Response(JSON.stringify({ erreur: "LECTURE" }), { status: 500 });
  }
  const liste = data ?? [];
  if (liste.length) {
    const { error: errFichiers } = await service.storage.from("maquettes").remove(liste.map((m) => m.chemin));
    if (errFichiers) {
      console.error("fichiers", errFichiers);
      return new Response(JSON.stringify({ erreur: "FICHIERS" }), { status: 500 });
    }
    const { error: errLignes } = await service.from("maquettes").delete().in("id", liste.map((m) => m.id));
    if (errLignes) console.error("lignes", errLignes);
  }
  return new Response(JSON.stringify({ purgees: liste.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
