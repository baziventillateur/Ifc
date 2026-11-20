// Connexion au cloud (Supabase, projet NexBim). La clé ci-dessous est publique :
// la protection des données repose sur les règles d'accès de la base.
import { createClient } from "@supabase/supabase-js";

// À lire avant la création du client, qui consomme puis efface ces paramètres.
const parametres = new URLSearchParams(window.location.hash.replace(/^#/, ""));
/** Type du lien e-mail qui a ouvert la page : invite, recovery, signup… */
export const typeLien = parametres.get("type");
export const erreurLien = parametres.get("error_description");

// Liens envoyés par e-mail : « ?invitation=… » (créer son compte depuis une invitation)
// et « ?projet=… » (ouvrir un projet partagé). On les lit puis on nettoie l'adresse.
const requete = new URLSearchParams(window.location.search);
/** Jeton personnel du lien d'invitation, s'il y en a un. */
export const jetonInvitation = requete.get("invitation");
let projetVoulu = requete.get("projet");
if (requete.has("invitation") || requete.has("projet")) {
  requete.delete("invitation");
  requete.delete("projet");
  const reste = requete.toString();
  history.replaceState(null, "", window.location.pathname + (reste ? `?${reste}` : "") + window.location.hash);
}
/** Projet à ouvrir en priorité à l'arrivée (lien reçu par e-mail). */
export function projetDemande() {
  return projetVoulu;
}
export function demanderProjet(id: string | null) {
  projetVoulu = id;
}

export const adresseSite = window.location.origin + window.location.pathname;

export const URL_NUAGE = "https://gmirbodifgxxnsfyfuyr.supabase.co";
export const CLE_PUBLIQUE = "sb_publishable_aoozWfzWkCfGCfqNpWzFlw_I0ACEzrB";

export const nuage = createClient(URL_NUAGE, CLE_PUBLIQUE);

/** Appelle une fonction du serveur ; « code » vaut le code d'erreur renvoyé, ou null. */
export async function appeler<T>(nom: string, corps: Record<string, unknown>): Promise<{ data: T | null; code: string | null }> {
  try {
    const { data, error } = await nuage.functions.invoke(nom, { body: corps });
    if (!error) return { data: data as T, code: null };
    let r: (T & { erreur?: string }) | null = null;
    try {
      r = await (error as { context?: Response }).context?.json();
    } catch {
      r = null;
    }
    return { data: r, code: r?.erreur ?? "RESEAU" };
  } catch (e) {
    console.error(nom, e);
    return { data: null, code: "RESEAU" };
  }
}

export const MAQUETTES_MAX = 10;
/** Projets par compte (l'admin n'est pas limité). */
export const PROJETS_MAX = 2;
export const OCTETS_MAX = 50 * 1024 * 1024;
/** Limite réservée au compte administrateur. */
export const OCTETS_MAX_ADMIN = 500 * 1024 * 1024;

export function taille(octets: number) {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
