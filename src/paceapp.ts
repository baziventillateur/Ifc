// Lien avec PaceApp (l'appli de notes du groupe) : connexion au compte PaceApp de la personne
// et création d'une note avec des images (export des captures).
//
// Connexion : NexBim est une appli autorisée de PaceApp (client OAuth « NexBim », enregistré
// dans l'authentification de PaceApp). Une fenêtre PaceApp s'ouvre : la personne s'y connecte
// (mot de passe ou Google, ou crée son compte) puis autorise NexBim. NexBim reçoit sa propre
// session PaceApp, distincte de celle de l'appli PaceApp (rien n'est partagé avec NexBim).
// Ensuite, tout passe par les mêmes accès que l'appli PaceApp (droits de la personne, quotas).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PACE_URL = "https://qgviauvqgomzssuipqpl.supabase.co";
// Clé publique de PaceApp (la même que dans son appli web).
const PACE_CLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFndmlhdXZxZ29tenNzdWlwcXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MzgzNzAsImV4cCI6MjA4OTExNDM3MH0.GM4GKYpOwP0MtTdup82LzahKXS2bOHqkOOJZbv-OM_k";
const CLIENT_ID = "9576e25c-9b42-43b1-a1b2-93009d5e0b25";
export const PACE_SITE = "https://paceapp.fr";
export const INSCRIPTION_PACE = `${PACE_SITE}/auth?mode=signup`;
const RETOUR = () => new URL("paceapp-retour.html", location.href).href.replace(/\?.*$/, "");

type Session = { acces: string; renouvellement: string; expire: number; email: string; id: string };
const CLE = "nexbim-paceapp";
const CLE_RETOUR = "nexbim-paceapp-retour";

function lire(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLE) ?? "null") as Session | null;
    return s?.acces && s.renouvellement ? s : null;
  } catch {
    return null;
  }
}
function garder(s: Session | null) {
  try {
    if (s) localStorage.setItem(CLE, JSON.stringify(s));
    else localStorage.removeItem(CLE);
  } catch {
    // Gardée pour la session seulement.
  }
  courante = s;
}
let courante = lire();

export const comptePace = () => (courante ? { email: courante.email, id: courante.id } : null);
export function deconnecterPace() {
  garder(null);
}

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
function aleatoire(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
function charge(jwt: string): { sub?: string; email?: string; exp?: number } {
  try {
    return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

async function jetons(corps: Record<string, string>) {
  const r = await fetch(`${PACE_URL}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: PACE_CLE },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...corps }),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || `HTTP ${r.status}`);
  const c = charge(d.access_token);
  const s: Session = {
    acces: d.access_token,
    renouvellement: d.refresh_token ?? courante?.renouvellement ?? "",
    expire: Date.now() + (d.expires_in ?? 3600) * 1000,
    email: c.email ?? courante?.email ?? "",
    id: c.sub ?? courante?.id ?? "",
  };
  garder(s);
  return s;
}

/** Jeton d'accès valable (renouvelé s'il expire bientôt), ou null s'il faut se reconnecter. */
async function jeton(): Promise<string | null> {
  const s = courante;
  if (!s) return null;
  if (s.expire - Date.now() > 60_000) return s.acces;
  try {
    return (await jetons({ grant_type: "refresh_token", refresh_token: s.renouvellement })).acces;
  } catch {
    garder(null);
    return null;
  }
}

/**
 * Ouvre la fenêtre de connexion PaceApp et attend l'autorisation. À appeler dans un geste
 * (toucher, clic) : sinon le navigateur bloque la fenêtre.
 */
export async function connecterPace(): Promise<{ email: string }> {
  const verif = aleatoire(48);
  const etat = aleatoire(16);
  const defi = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verif)));
  const url = new URL(`${PACE_URL}/auth/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: RETOUR(),
    code_challenge: defi,
    code_challenge_method: "S256",
    state: etat,
    scope: "openid email profile",
  }).toString();
  try {
    localStorage.removeItem(CLE_RETOUR);
  } catch {
    // Sans stockage : la réponse arrivera par message.
  }
  const fenetre = window.open(url.href, "nexbim-paceapp", "popup,width=480,height=760");
  if (!fenetre) throw new Error("FENETRE_BLOQUEE");

  const code = await new Promise<string>((ok, ko) => {
    let fini = false;
    const canal = "BroadcastChannel" in window ? new BroadcastChannel("nexbim-paceapp") : null;
    const conclure = (d: unknown) => {
      const r = d as { type?: string; code?: string; state?: string; error?: string } | null;
      if (fini || !r || r.type !== "nexbim-paceapp" || r.state !== etat) return;
      fini = true;
      nettoyer();
      if (r.code) ok(r.code);
      else ko(new Error(r.error === "access_denied" ? "REFUS" : r.error || "ECHEC"));
    };
    const surMessage = (e: MessageEvent) => e.origin === location.origin && conclure(e.data);
    const surStockage = (e: StorageEvent) => e.key === CLE_RETOUR && e.newValue && conclure(JSON.parse(e.newValue));
    const surRetour = () => {
      try {
        const v = localStorage.getItem(CLE_RETOUR);
        if (v) conclure(JSON.parse(v));
      } catch {
        // Rien à lire.
      }
    };
    // Fenêtre fermée sans réponse : on abandonne (après un dernier coup d'œil au stockage).
    const veille = window.setInterval(() => {
      if (!fenetre.closed) return;
      surRetour();
      if (!fini) {
        fini = true;
        nettoyer();
        ko(new Error("FERMEE"));
      }
    }, 800);
    const nettoyer = () => {
      window.clearInterval(veille);
      window.removeEventListener("message", surMessage);
      window.removeEventListener("storage", surStockage);
      document.removeEventListener("visibilitychange", surRetour);
      canal?.close();
    };
    window.addEventListener("message", surMessage);
    window.addEventListener("storage", surStockage);
    document.addEventListener("visibilitychange", surRetour);
    if (canal) canal.onmessage = (e) => conclure(e.data);
  });
  const s = await jetons({ grant_type: "authorization_code", code, redirect_uri: RETOUR(), code_verifier: verif });
  return { email: s.email };
}

// --- Données PaceApp (mêmes accès que l'appli : droits et quotas de la personne) ------------

let client: SupabaseClient | null = null;
function pace() {
  client ??= createClient(PACE_URL, PACE_CLE, {
    accessToken: async () => (await jeton()) ?? "",
    global: { headers: { "x-client-info": "nexbim" } },
  });
  return client;
}
function moiPace() {
  if (!courante?.id) throw new Error("NON_CONNECTE");
  return courante.id;
}

export type DossierPace = { id: string; name: string; kind: "notebook" | "section" | "group"; parent_id: string | null; system_role: string | null; position: number | null };

/** Blocs-notes, groupes et sections de la personne. */
export async function dossiersPace(): Promise<DossierPace[]> {
  const { data, error } = await pace()
    .from("note_folders")
    .select("id, name, kind, parent_id, system_role, position")
    .eq("user_id", moiPace())
    .is("deleted_at", null)
    .order("position", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DossierPace[];
}

/** Section « Notes rapides » du bloc-notes par défaut (créée par PaceApp si besoin). */
export async function sectionParDefaut(): Promise<string> {
  const { data, error } = await pace().rpc("ensure_quick_notes", { _uid: moiPace() });
  if (error || !data) throw new Error(error?.message ?? "SECTION_INTROUVABLE");
  return String(data);
}

export async function creerBlocNotes(nom: string): Promise<string> {
  const { data, error } = await pace().from("note_folders").insert({ user_id: moiPace(), name: nom, kind: "notebook" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "CREATION_IMPOSSIBLE");
  return String(data.id);
}

export async function creerSection(blocNotes: string, nom: string, position: number): Promise<string> {
  const { data, error } = await pace()
    .from("note_folders")
    .insert({ user_id: moiPace(), name: nom, kind: "section", parent_id: blocNotes, position })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "CREATION_IMPOSSIBLE");
  return String(data.id);
}

/**
 * Dépose une image dans les images de notes PaceApp (même passage que l'appli : quota de
 * stockage, limite d'envois). Rend son adresse, à mettre dans la note.
 */
export async function envoyerImagePace(image: Blob, nom = "image.jpg"): Promise<string> {
  const chemin = `${moiPace()}/${crypto.randomUUID()}.jpg`;
  for (let essai = 0; ; essai++) {
    const acces = await jeton();
    if (!acces) throw new Error("NON_CONNECTE");
    const r = await fetch(`${PACE_URL}/functions/v1/note-files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${acces}`,
        apikey: PACE_CLE,
        "Content-Type": "application/octet-stream",
        "x-storage-bucket": "note-images",
        "x-storage-path": chemin,
        "x-storage-upsert": "false",
        "x-file-name": encodeURIComponent(nom),
        "x-file-mime": image.type || "image/jpeg",
      },
      body: image,
    });
    if (r.ok) return `${PACE_URL}/storage/v1/object/public/note-images/${chemin}`;
    const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`;
    // Trop d'envois d'un coup : PaceApp demande d'attendre un peu (au plus une minute ici).
    const attente = Number(r.headers.get("Retry-After") ?? 0);
    if (r.status === 429 && attente <= 60 && essai < 2) {
      await new Promise((ok) => setTimeout(ok, (attente || 5) * 1000));
      continue;
    }
    if ((code === "UPLOAD_BUSY" || r.status >= 500) && essai < 2) {
      await new Promise((ok) => setTimeout(ok, 1500 * (essai + 1)));
      continue;
    }
    throw new Error(r.status === 429 ? "TROP_D_ENVOIS" : code);
  }
}

/** Crée la note (titre + contenu HTML) dans une section ; rend son identifiant. */
export async function creerNotePace(section: string, titre: string, html: string): Promise<string> {
  const moi = moiPace();
  const { data, error } = await pace()
    .from("notes")
    .insert({ user_id: moi, created_by: moi, folder_id: section, title: titre.slice(0, 300), content: html })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "NOTE_IMPOSSIBLE");
  return String(data.id);
}

export const lienNotePace = (id: string) => `${PACE_SITE}/notes?note=${encodeURIComponent(id)}`;

/** Message lisible pour une erreur PaceApp. */
export function messagePace(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (m === "FENETRE_BLOQUEE") return "La fenêtre PaceApp a été bloquée : autorisez les fenêtres surgissantes pour NexBim, puis réessayez.";
  if (m === "FERMEE") return "Fenêtre PaceApp fermée avant la fin de la connexion.";
  if (m === "REFUS") return "Autorisation refusée dans PaceApp.";
  if (m === "NON_CONNECTE") return "Connexion PaceApp expirée : reconnectez-vous.";
  if (m === "TROP_D_ENVOIS") return "PaceApp limite les envois (30 images par 10 minutes) : réessayez dans quelques minutes.";
  if (/STORAGE_QUOTA_EXCEEDED/.test(m)) return "Espace de stockage PaceApp plein : libérez de la place ou passez en Pro.";
  if (/limit|quota|plan/i.test(m)) return "Limite de votre formule PaceApp atteinte (nombre de notes ou de blocs-notes).";
  return "PaceApp n'a pas pu terminer : " + m;
}
