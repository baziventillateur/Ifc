// Connexion au cloud (Supabase, projet NexBim). La clé ci-dessous est publique :
// la protection des données repose sur les règles d'accès de la base.
import { createClient } from "@supabase/supabase-js";

// À lire avant la création du client, qui consomme puis efface ces paramètres.
const parametres = new URLSearchParams(window.location.hash.replace(/^#/, ""));
/** Type du lien e-mail qui a ouvert la page : invite, recovery, signup… */
export const typeLien = parametres.get("type");
export const erreurLien = parametres.get("error_description");

export const adresseSite = window.location.origin + window.location.pathname;

export const URL_NUAGE = "https://gmirbodifgxxnsfyfuyr.supabase.co";
export const CLE_PUBLIQUE = "sb_publishable_aoozWfzWkCfGCfqNpWzFlw_I0ACEzrB";

export const nuage = createClient(URL_NUAGE, CLE_PUBLIQUE);

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
