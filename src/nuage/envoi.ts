// Envoi des maquettes dans le stockage. Les gros fichiers partent par morceaux de 6 Mo
// (protocole TUS de Supabase) : progression visible, et reprise automatique si le réseau
// coupe. En cas d'échec sans rapport avec la taille, on retente en envoi simple.
import * as tus from "tus-js-client";
import { CLE_PUBLIQUE, nuage, URL_NUAGE } from "./client";

const MORCEAU = 6 * 1024 * 1024;
export type ErreurEnvoi = { message: string; statut?: number };

function envoiParMorceaux(chemin: string, f: File, jeton: string, progression: (part: number) => void) {
  return new Promise<void>((ok, echec) => {
    const envoi = new tus.Upload(f, {
      endpoint: `${URL_NUAGE}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${jeton}`, apikey: CLE_PUBLIQUE, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      metadata: {
        bucketName: "maquettes",
        objectName: chemin,
        contentType: "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: MORCEAU,
      onProgress: (envoye, total) => progression(total ? envoye / total : 0),
      onSuccess: () => ok(),
      onError: (e) => {
        const reponse = (e as tus.DetailedError).originalResponse;
        echec({
          message: `${reponse?.getBody() || e.message || "Échec de l'envoi"}`,
          statut: reponse?.getStatus(),
        } satisfies ErreurEnvoi);
      },
    });
    envoi.start();
  });
}

const tropLourd = (e: ErreurEnvoi) =>
  e.statut === 413 || /maximum allowed size|payload too large|too large/i.test(e.message);

/** Envoie le fichier au chemin donné ; renvoie null si tout va bien, sinon l'erreur. */
export async function envoyerMaquette(
  chemin: string,
  f: File,
  progression: (part: number) => void,
): Promise<ErreurEnvoi | null> {
  if (f.size > MORCEAU) {
    const { data } = await nuage.auth.getSession();
    const jeton = data.session?.access_token;
    if (jeton) {
      try {
        await envoiParMorceaux(chemin, f, jeton, progression);
        return null;
      } catch (e) {
        const erreur = e as ErreurEnvoi;
        console.error("envoi par morceaux", erreur);
        if (tropLourd(erreur) || erreur.statut === 403) return erreur;
        // Autre souci (réseau, serveur) : on retente en envoi simple.
      }
    }
  }
  progression(0.05);
  const { error } = await nuage.storage.from("maquettes").upload(chemin, f, { contentType: "application/octet-stream" });
  progression(1);
  return error ? { message: error.message, statut: Number((error as { statusCode?: string }).statusCode) || undefined } : null;
}
