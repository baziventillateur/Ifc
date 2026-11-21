// Projet dans le cloud : maquettes déposées, personnes invitées, compte, panneau admin.
import {
  deplacementsModifies,
  exporter as exporterDeplacements,
  importer as importerDeplacements,
  type Donnees,
} from "../deplacements";
import type { User } from "@supabase/supabase-js";
import { alerte, attente, bouton, cree, el, Signal } from "../noyau";
import { maquettes as affichees } from "../registre";
import {
  ajouterIfc,
  bufferDe,
  chargementOccupe,
  noterVersion,
  chargerExemple,
  exempleAffiche,
  ouvrirDepuisNuage,
  retirer,
} from "../maquettes";
import {
  appeler,
  demanderProjet,
  MAQUETTES_MAX,
  nuage,
  projetDemande,
  PROJETS_MAX,
  OCTETS_MAX,
  OCTETS_MAX_ADMIN,
  taille,
} from "./client";
import { compresser, decompresser, envoyerMaquette } from "./envoi";
import { seDeconnecter } from "./compte";
import { ouvrirVersions } from "../mise-a-jour";

type Projet = { id: string; nom: string; proprietaire: string };
type Fichier = {
  id: string;
  nom: string;
  chemin: string;
  taille: number;
  cree_le: string;
  supprime_le: string | null;
  chemin_frag: string | null;
  taille_frag: number | null;
};
/** Tous les fichiers d'une maquette dans le stockage (IFC et version convertie). */
const cheminsDe = (f: Fichier) => [f.chemin, f.chemin_frag].filter((c): c is string => !!c);
const CORBEILLE_JOURS = 60;
type Personne = { utilisateur_id: string | null; email: string; prenom: string; role: string };

type ProjetAutre = Projet & { titulaire: string; maquettes: number };

const etat = {
  moi: { id: "", email: "", prenom: "" },
  admin: false,
  projets: [] as Projet[],
  /** Administrateur : projets des autres comptes, chargés à la demande (« + »). */
  autres: null as ProjetAutre[] | null,
  courant: null as Projet | null,
  fichiers: [] as Fichier[],
  corbeille: [] as Fichier[],
  personnes: [] as Personne[],
};

const CLE_PROJET = "nexbim-projet";
const btnAjouter = el<HTMLButtonElement>("btn-ajouter");
const btnProjet = el<HTMLButtonElement>("btn-projet");
const btnCompte = el<HTMLButtonElement>("btn-compte");

const createur = () => !!etat.courant && etat.courant.proprietaire === etat.moi.id;
const nomLocal = (nom: string) => nom.replace(/\.ifc$/i, "");

// --- Fenêtres ---------------------------------------------------------------------

const fond = cree("div", "modale-fond");
fond.hidden = true;
const modale = cree("div", "modale");
fond.append(modale);
document.body.append(fond);
fond.addEventListener("click", (e) => {
  if (e.target === fond) fermer();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !fond.hidden) fermer();
});

function fermer() {
  fond.hidden = true;
  modale.replaceChildren();
}

function ouvrirFenetre(titre: string, large = false) {
  modale.classList.toggle("large", large);
  const entete = cree("div", "modale-entete");
  const x = bouton("fermer", "✕", fermer, "Fermer");
  entete.append(cree("span", "", titre), x);
  const corps = cree("div", "modale-corps");
  modale.replaceChildren(entete, corps);
  fond.hidden = false;
  return corps;
}

const section = (titre: string) => cree("div", "modale-titre", titre);

/** Fenêtre de confirmation : le bouton d'action est explicite, Annuler revient au panneau. */
function confirmer(titre: string, texte: string, action: string, danger = false): Promise<boolean> {
  return new Promise((ok) => {
    const corps = ouvrirFenetre(titre);
    const pied = cree("div", "modale-pied confirmer");
    pied.append(
      bouton("btn", "Annuler", () => ok(false)),
      bouton(danger ? "btn danger" : "btn principal", action, () => ok(true)),
    );
    corps.append(cree("p", "modale-texte", texte), pied);
  });
}

const jours = (iso: string) =>
  Math.max(0, CORBEILLE_JOURS - Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

// --- Bandeau « Commencer » ---------------------------------------------------------

const bandeau = cree("div", "bandeau");
bandeau.hidden = true;
document.body.append(bandeau);

function majBandeau() {
  btnAjouter.hidden = !!etat.courant && !createur();
  btnProjet.textContent = etat.courant ? etat.courant.nom : "Projet";
  bandeau.replaceChildren();
  if (!etat.courant) {
    bandeau.append(
      cree("span", "", "Maquette d'essai : explorez librement."),
      bouton("btn principal", "Commencer", () => ouvrirPanneau(), "Créer votre projet et déposer vos maquettes"),
    );
  } else if (etat.fichiers.length === 0) {
    bandeau.append(
      cree(
        "span",
        "",
        createur() ? "Projet vide : voici la maquette d'essai." : "Ce projet n'a pas encore de maquette.",
      ),
    );
    if (createur()) bandeau.append(bouton("btn principal", "Déposer une maquette", () => btnAjouter.click()));
  }
  bandeau.hidden = bandeau.childElementCount === 0;
}

// --- Données ----------------------------------------------------------------------

function messageErreur(e: { message?: string; code?: string; statut?: number } | null) {
  const m = e?.message ?? "";
  if (m.includes("LIMITE_PROJETS")) return `Vous avez déjà ${PROJETS_MAX} projets : c'est le maximum par compte.`;
  if (m.includes("LIMITE_MAQUETTES")) return `Le projet a déjà ${MAQUETTES_MAX} maquettes (maximum).`;
  if (e?.code === "23505") return "Une maquette porte déjà ce nom dans le projet.";
  if (e?.statut === 413 || /maximum allowed size|payload too large/i.test(m) || m.includes("TAILLE_MAX"))
    return etat.admin
      ? "refusé par le stockage : la limite d'envoi de Supabase (Storage → Settings → Upload file size limit) est plus basse que ce fichier."
      : `fichier trop lourd (${taille(OCTETS_MAX)} maximum).`;
  // L'administrateur voit le message exact, pour pouvoir diagnostiquer.
  if (etat.admin && m) return `échec (${e?.statut ?? e?.code ?? "?"}) : ${m.slice(0, 160)}`;
  return "L'opération a échoué. Réessayez.";
}

async function chargerProjets() {
  const [{ data: tous }, { data: liens }] = await Promise.all([
    nuage.from("projets").select("id, nom, proprietaire").order("cree_le"),
    nuage.from("membres").select("projet_id").eq("utilisateur_id", etat.moi.id),
  ]);
  const invite = new Set((liens ?? []).map((l) => l.projet_id as string));
  // L'admin peut lire tous les projets ; ici on ne montre que les siens.
  etat.projets = ((tous ?? []) as Projet[]).filter((p) => p.proprietaire === etat.moi.id || invite.has(p.id));
}

async function chargerDetails() {
  etat.fichiers = [];
  etat.corbeille = [];
  etat.personnes = [];
  if (!etat.courant) return;
  const [{ data: f }, { data: p }] = await Promise.all([
    nuage
      .from("maquettes")
      .select("id, nom, chemin, taille, cree_le, supprime_le, chemin_frag, taille_frag")
      .eq("projet_id", etat.courant.id)
      .order("cree_le"),
    nuage.rpc("personnes_du_projet", { p: etat.courant.id }),
  ]);
  const tous = (f ?? []) as Fichier[];
  etat.fichiers = tous.filter((x) => !x.supprime_le);
  etat.corbeille = tous.filter((x) => x.supprime_le);
  etat.personnes = (p ?? []) as Personne[];
}

// --- Modifications (éléments déplacés) enregistrées dans le projet -----------------

let modifsLues = "{}";
let modifsPretes = false;
let minuterieModifs = 0;
/** Émis quand l'état d'enregistrement des modifications change. */
export const enregistrementModifie = new Signal();
let etatModifs: "" | "enregistre" | "erreur" = "";

/** Où vont les modifications : dans le projet, ou seulement sur cet écran. */
export function enregistrementModifs(): { mode: "projet" | "invite" | "exemple"; etat: typeof etatModifs } {
  if (!etat.courant || etat.fichiers.length === 0) return { mode: "exemple", etat: "" };
  return { mode: createur() ? "projet" : "invite", etat: etatModifs };
}

async function chargerModifications() {
  modifsPretes = false;
  etatModifs = "";
  let donnees: Donnees | null = null;
  if (etat.courant && etat.fichiers.length > 0) {
    const { data } = await nuage
      .from("modifications")
      .select("deplacements")
      .eq("projet_id", etat.courant.id)
      .maybeSingle();
    donnees = (data?.deplacements as Donnees | undefined) ?? null;
  }
  await importerDeplacements(donnees);
  modifsLues = JSON.stringify(await exporterDeplacements());
  modifsPretes = true;
  enregistrementModifie.emit();
}

async function enregistrerModifications() {
  const projet = etat.courant;
  if (!modifsPretes || !projet || !createur() || etat.fichiers.length === 0) return;
  const donnees = await exporterDeplacements();
  const texte = JSON.stringify(donnees);
  if (texte === modifsLues) return;
  const { error } = await nuage
    .from("modifications")
    .upsert({ projet_id: projet.id, deplacements: donnees, maj_le: new Date().toISOString(), maj_par: etat.moi.id });
  if (etat.courant !== projet) return;
  if (error) {
    console.error("Enregistrement des modifications", error);
    etatModifs = "erreur";
  } else {
    modifsLues = texte;
    etatModifs = "enregistre";
  }
  enregistrementModifie.emit();
}

deplacementsModifies.on(() => {
  if (!modifsPretes) return;
  window.clearTimeout(minuterieModifs);
  minuterieModifs = window.setTimeout(() => void enregistrerModifications(), 900);
});

async function ouvrirProjet(projet: Projet | null) {
  modifsPretes = false;
  window.clearTimeout(minuterieModifs);
  await importerDeplacements(null);
  etat.courant = projet;
  try {
    if (projet) localStorage.setItem(CLE_PROJET, projet.id);
  } catch {
    // Mémoire locale indisponible.
  }
  await chargerDetails();
  if (etat.fichiers.length === 0) {
    await chargerExemple();
  } else {
    await ouvrirDepuisNuage(
      etat.fichiers.map((f) => ({
        nom: nomLocal(f.nom),
        version: f.id,
        date: f.cree_le,
        frag: f.chemin_frag
          ? async () => (await telechargerFichier(f.chemin_frag!)).arrayBuffer()
          : undefined,
        ifc: async () => {
          const brut = await telechargerFichier(f.chemin);
          return new File([f.chemin.endsWith(".gz") ? await decompresser(brut) : brut], f.nom);
        },
        sansFrag: createur() ? (ifc?: File) => mettreANiveau(f, ifc) : undefined,
      })),
    );
  }
  await chargerModifications().catch((e) => console.error("Modifications du projet", e));
  majBandeau();
}

async function telechargerFichier(chemin: string) {
  const { data, error } = await nuage.storage.from("maquettes").download(chemin);
  if (error || !data) throw error ?? new Error("Téléchargement impossible");
  return data;
}

/**
 * Ancienne maquette sans version convertie dans le cloud : le créateur l'y envoie (et
 * remplace l'IFC par sa version compressée), en arrière-plan. Les prochaines ouvertures,
 * sur tous les appareils, se font sans conversion.
 */
async function mettreANiveau(f: Fichier, ifc?: File) {
  if (!createur() || f.chemin_frag) return;
  const local = nomLocal(f.nom);
  const dossier = f.chemin.split("/")[0];
  const base = `${dossier}/${crypto.randomUUID()}`;
  const frag = await bufferDe(local);
  const cheminFrag = `${base}.frag`;
  if (await envoyerMaquette(cheminFrag, new Blob([frag]), () => {})) return;
  const maj: { chemin_frag: string; taille_frag: number; chemin?: string } = {
    chemin_frag: cheminFrag,
    taille_frag: frag.byteLength,
  };
  const nouveaux = [cheminFrag];
  if (ifc && !f.chemin.endsWith(".gz")) {
    const cheminGz = `${base}.ifc.gz`;
    if (!(await envoyerMaquette(cheminGz, await compresser(ifc), () => {}))) {
      maj.chemin = cheminGz;
      nouveaux.push(cheminGz);
    }
  }
  const { error } = await nuage.from("maquettes").update(maj).eq("id", f.id);
  if (error) {
    console.error("Mise à niveau", error);
    await nuage.storage.from("maquettes").remove(nouveaux);
    return;
  }
  if (maj.chemin) await nuage.storage.from("maquettes").remove([f.chemin]);
  Object.assign(f, maj);
  alerte(`« ${local} » optimisée : elle s'ouvrira vite sur tous vos appareils.`);
}

/** Administrateur connecté (fonctions en essai, réservées pour l'instant). */
export const estAdmin = () => etat.admin;

export async function demarrerNuage(utilisateur: User) {
  etat.moi.id = utilisateur.id;
  etat.moi.email = utilisateur.email ?? "";
  const [{ data: profil }, { data: admin }] = await Promise.all([
    nuage.from("profils").select("prenom").eq("id", utilisateur.id).maybeSingle(),
    nuage.rpc("suis_je_admin"),
  ]);
  etat.moi.prenom = profil?.prenom ?? "";
  etat.admin = admin === true;
  majCompte();
  await chargerProjets();
  let memorise: string | null = null;
  try {
    memorise = localStorage.getItem(CLE_PROJET);
  } catch {
    // Mémoire locale indisponible.
  }
  // Lien reçu par e-mail : ce projet passe avant le dernier ouvert.
  const voulu = projetDemande();
  demanderProjet(null);
  const parLien = voulu ? etat.projets.find((p) => p.id === voulu) : undefined;
  let cible = parLien ?? etat.projets.find((p) => p.id === memorise);
  if (!cible && etat.admin && memorise) {
    // L'administrateur retrouve le projet d'un autre compte qu'il consultait.
    const { data } = await nuage.from("projets").select("id, nom, proprietaire").eq("id", memorise).maybeSingle();
    if (data) cible = data as Projet;
  }
  await ouvrirProjet(cible ?? etat.projets[0] ?? null);
  if (voulu && !parLien) alerte("Ce projet n'est plus partagé avec vous.", 5000);
  else if (parLien && parLien.proprietaire !== etat.moi.id)
    alerte(`Projet « ${parLien.nom} » ouvert, en lecture seule.`, 4000);
}

// --- Dépôt de maquettes -----------------------------------------------------------

/** Vérifie qu'un dépôt est possible ; sinon explique pourquoi. */
export function demanderDepot() {
  if (!etat.courant) {
    ouvrirPanneau();
    return false;
  }
  if (!createur()) {
    alerte("Lecture seule : seul le créateur du projet peut déposer des maquettes.");
    return false;
  }
  if (etat.fichiers.length >= MAQUETTES_MAX) {
    alerte(`Le projet a déjà ${MAQUETTES_MAX} maquettes (maximum). Supprimez-en une dans « Projet ».`);
    return false;
  }
  return true;
}

let depotEnCours = false;

export async function deposer(fichiers: File[]) {
  if (depotEnCours) {
    alerte("Un envoi est déjà en cours : attendez la fin, puis redéposez le fichier.");
    return;
  }
  if (!demanderDepot() || !etat.courant) return;
  const projet = etat.courant;
  const ifc = fichiers.filter((f) => /\.ifc$/i.test(f.name));
  if (ifc.length === 0) {
    alerte("Ce fichier n'est pas un IFC. Depuis Revit : Fichier → Exporter → IFC.");
    return;
  }
  const refus: string[] = [];
  const retenus: File[] = [];
  const pris = new Set(etat.fichiers.map((f) => nomLocal(f.nom).toLowerCase()));
  for (const f of ifc) {
    const cle = nomLocal(f.name).toLowerCase();
    const plafond = etat.admin ? OCTETS_MAX_ADMIN : OCTETS_MAX;
    if (f.size > plafond) refus.push(`« ${f.name} » dépasse ${taille(plafond)} (${taille(f.size)})`);
    else if (f.size === 0) refus.push(`« ${f.name} » est vide`);
    else if (pris.has(cle)) refus.push(`« ${f.name} » existe déjà dans le projet`);
    else if (etat.fichiers.length + retenus.length >= MAQUETTES_MAX)
      refus.push(`« ${f.name} » : maximum de ${MAQUETTES_MAX} maquettes atteint`);
    else {
      pris.add(cle);
      retenus.push(f);
    }
  }
  if (retenus.length === 0) {
    alerte(refus.join(" · "), 9000);
    return;
  }

  if (chargementOccupe()) {
    alerte("Une maquette est en cours de chargement : attendez la fin, puis redéposez le fichier.");
    return;
  }
  depotEnCours = true;
  try {
    // Une copie affichée mais non enregistrée porterait le même nom : on la retire d'abord.
    for (const f of retenus) if (affichees.has(nomLocal(f.name))) await retirer(nomLocal(f.name));
    // Conversion d'abord : on n'envoie dans le cloud que des fichiers lisibles.
    const lus = new Set(await ajouterIfc(retenus));
    for (const [i, f] of retenus.entries()) {
      const local = nomLocal(f.name);
      if (!lus.has(local)) {
        refus.push(`« ${f.name} » n'a pas pu être lue (IFC illisible ou trop lourd pour ce navigateur)`);
        continue;
      }
      // On envoie l'IFC compressé et sa version convertie, qui s'ouvrira sans conversion.
      const base = `${projet.id}/${crypto.randomUUID()}`;
      const chemin = `${base}.ifc.gz`;
      const cheminFrag = `${base}.frag`;
      attente(`Compression de « ${local} » (${taille(f.size)})…`, i / retenus.length);
      const [gz, frag] = await Promise.all([compresser(f), bufferDe(local)]);
      const avance = (part: number) =>
        attente(
          `Envoi de « ${local} » : ${Math.round(part * 100)} % de ${taille(gz.size + frag.byteLength)} ` +
            `(${taille(f.size)} avant compression)… Ne fermez pas la page.`,
          (i + part) / retenus.length,
        );
      const partIfc = gz.size / (gz.size + frag.byteLength);
      avance(0);
      let erreur: { message?: string; code?: string; statut?: number } | null = await envoyerMaquette(
        chemin,
        gz,
        (p) => avance(p * partIfc),
      );
      if (!erreur) erreur = await envoyerMaquette(cheminFrag, new Blob([frag]), (p) => avance(partIfc + p * (1 - partIfc)));
      if (!erreur) {
        const ligne = await nuage
          .from("maquettes")
          .insert({
            projet_id: projet.id,
            nom: f.name,
            chemin,
            taille: f.size,
            chemin_frag: cheminFrag,
            taille_frag: frag.byteLength,
          })
          .select("id")
          .single();
        erreur = ligne.error;
        if (!erreur && ligne.data) await noterVersion(local, ligne.data.id);
      }
      if (erreur) await nuage.storage.from("maquettes").remove([chemin, cheminFrag]);
      if (erreur) {
        console.error(erreur);
        refus.push(`« ${f.name} » : ${messageErreur(erreur)}`);
        await retirer(local);
      }
    }
  } finally {
    attente(null);
    depotEnCours = false;
  }
  await chargerDetails();
  majBandeau();
  if (affichees.size === 0) await chargerExemple();
  if (refus.length > 0) alerte(`Non enregistré dans le projet — ${refus.join(" · ")}`, 15000);
}

// --- Panneau « Projet » -----------------------------------------------------------

function ligne(texte: string, detail: string, action?: HTMLElement) {
  const l = cree("div", "modale-ligne");
  const t = cree("div", "modale-ligne-texte");
  t.append(cree("span", "", texte));
  if (detail) t.append(cree("small", "", detail));
  l.append(t);
  if (action) l.append(action);
  return l;
}

function formulaire(indication: string, libelle: string, type: string, envoyer: (v: string) => Promise<string | void>) {
  const f = cree("form", "modale-form");
  const saisie = cree("input");
  saisie.type = type;
  saisie.placeholder = indication;
  saisie.required = true;
  saisie.maxLength = type === "email" ? 254 : 80;
  const ok = cree("button", "btn principal", libelle);
  ok.type = "submit";
  const retour = cree("p", "modale-retour");
  f.append(saisie, ok, retour);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    ok.disabled = true;
    retour.textContent = "…";
    try {
      retour.textContent = (await envoyer(saisie.value.trim())) ?? "";
    } catch (err) {
      console.error(err);
      retour.textContent = "L'opération a échoué. Réessayez.";
    } finally {
      ok.disabled = false;
    }
  });
  return f;
}

/** Invite (ou réinvite) une adresse dans le projet affiché ; renvoie le message d'erreur éventuel. */
async function inviter(email: string) {
  if (!etat.courant) return;
  const { data, code } = await appeler<{ etat?: string; mail?: boolean }>("inviter", {
    projet: etat.courant.id,
    email,
  });
  if (code === "EMAIL") return "Adresse e-mail incorrecte.";
  if (code === "SOI_MEME") return "C'est votre propre adresse.";
  if (code === "LIMITE") return "Maximum de 20 personnes par projet atteint.";
  if (code === "TROP_TOT") return "Invitation déjà envoyée il y a moins d'une minute.";
  if (code === "QUOTA") return "Trop d'invitations envoyées aujourd'hui. Réessayez demain.";
  if (code) return "L'invitation a échoué. Réessayez.";
  await chargerDetails();
  const mail = data?.mail;
  const messages: Record<string, string> = {
    deja: `${email} fait déjà partie du projet.`,
    ajoute: mail
      ? `${email} a déjà un compte NexBim : ajouté au projet et prévenu par e-mail.`
      : `${email} a déjà un compte NexBim : ajouté au projet (l'e-mail de notification n'a pas pu partir).`,
    invite: mail
      ? `Invitation envoyée à ${email}. Il entrera dans le projet en créant son compte depuis l'e-mail.`
      : `${email} est invité, mais l'e-mail n'a pas pu partir. Réessayez avec « Renvoyer ».`,
    renvoye: mail ? `Nouvelle invitation envoyée à ${email}.` : `L'e-mail n'a pas pu partir. Réessayez dans une minute.`,
  };
  ouvrirPanneau(messages[data?.etat ?? ""] ?? "Invitation enregistrée.");
}

function ouvrirPanneau(info = "") {
  const corps = ouvrirFenetre("Projet");
  if (info) corps.append(cree("p", "modale-info", info));

  // --- Mes projets : passer de l'un à l'autre, en créer un
  const miens = etat.projets.filter((p) => p.proprietaire === etat.moi.id).length;
  const peutCreer = etat.admin || miens < PROJETS_MAX;
  const titreProjets = cree("div", "modale-titre avec-action");
  titreProjets.append(cree("span", "", etat.admin ? "Mes projets" : `Mes projets · ${miens}/${PROJETS_MAX}`));
  if (etat.admin) {
    titreProjets.append(
      bouton(
        "btn-tous-projets",
        etat.autres ? "−" : "+",
        () => void basculerTousProjets(),
        etat.autres ? "Masquer les projets des autres comptes" : "Voir les projets de tous les comptes (administrateur)",
      ),
    );
  }
  corps.append(titreProjets);
  if (etat.projets.length === 0) {
    corps.append(cree("p", "modale-aide", `Un projet regroupe jusqu'à ${MAQUETTES_MAX} maquettes IFC et les personnes que vous invitez.`));
  }
  const listeProjets = cree("div", "projets-liste");
  for (const p of etat.projets) {
    const actif = p.id === etat.courant?.id;
    const ligne = bouton("projet-ligne" + (actif ? " actif" : ""), "", () => {
      if (actif) return;
      fermer();
      void ouvrirProjet(p);
    }, actif ? "Projet affiché" : "Ouvrir ce projet");
    ligne.append(
      cree("span", "projet-nom", p.nom),
      cree("span", "projet-role", p.proprietaire === etat.moi.id ? (actif ? "affiché" : "") : actif ? "invité · affiché" : "invité"),
    );
    listeProjets.append(ligne);
  }
  // Administrateur : projet d'un autre compte en cours de consultation.
  const courant = etat.courant;
  if (courant && !etat.projets.some((p) => p.id === courant.id)) {
    const l = bouton("projet-ligne actif autre", "", () => {}, "Projet affiché (accès administrateur)");
    l.append(cree("span", "projet-nom", courant.nom), cree("span", "projet-role", "admin · affiché"));
    listeProjets.prepend(l);
  }
  if (listeProjets.childElementCount) corps.append(listeProjets);
  if (etat.admin && etat.autres) {
    corps.append(section(`Tous les projets · ${etat.autres.length}`));
    const listeAutres = cree("div", "projets-liste");
    for (const p of etat.autres) {
      const actif = p.id === etat.courant?.id;
      const l = bouton("projet-ligne autre" + (actif ? " actif" : ""), "", () => {
        if (actif) return;
        fermer();
        void ouvrirProjet(p).then(() =>
          alerte(`Projet de ${p.titulaire} ouvert en lecture seule (accès administrateur).`, 4500),
        );
      }, `Ouvrir le projet de ${p.titulaire}`);
      l.append(
        cree("span", "projet-nom", p.nom),
        cree("span", "projet-role", `${p.titulaire} · ${p.maquettes} maq.`),
      );
      listeAutres.append(l);
    }
    if (!etat.autres.length) listeAutres.append(cree("p", "modale-aide", "Aucun autre projet pour l'instant."));
    corps.append(listeAutres);
  }
  if (peutCreer) {
    corps.append(
      formulaire("Nom du nouveau projet", "Créer", "text", async (nom) => {
        const { data, error } = await nuage.from("projets").insert({ nom }).select("id, nom, proprietaire").single();
        if (error || !data) return messageErreur(error);
        etat.projets.push(data as Projet);
        fermer();
        await ouvrirProjet(data as Projet);
        ouvrirPanneau("Projet créé. Déposez votre première maquette.");
      }),
    );
  } else {
    corps.append(cree("p", "modale-aide", `${PROJETS_MAX} projets au maximum par compte. Supprimez-en un pour en créer un autre.`));
  }

  const projet = etat.courant;
  if (projet) {
    corps.append(section(`${projet.nom} · maquettes ${etat.fichiers.length}/${MAQUETTES_MAX}`));
    if (etat.fichiers.length === 0) corps.append(cree("p", "modale-aide", "Aucune maquette déposée."));
    for (const f of etat.fichiers) {
      const suppr = createur()
        ? bouton("lien danger", "Supprimer", async () => {
            const oui = await confirmer(
              "Supprimer la maquette ?",
              `« ${f.nom} » quittera le projet, pour vous et pour les personnes invitées. ` +
                `Elle reste dans la corbeille pendant ${CORBEILLE_JOURS} jours : vous pourrez la restaurer d'ici là. ` +
                `Ensuite, elle sera effacée définitivement.`,
              "Mettre à la corbeille",
              true,
            );
            if (!oui) return ouvrirPanneau();
            const { error } = await nuage
              .from("maquettes")
              .update({ supprime_le: new Date().toISOString() })
              .eq("id", f.id);
            if (error) {
              alerte(messageErreur(error));
              return ouvrirPanneau();
            }
            if (affichees.has(nomLocal(f.nom))) await retirer(nomLocal(f.nom));
            await chargerDetails();
            if (affichees.size === 0) await chargerExemple();
            majBandeau();
            ouvrirPanneau(`« ${f.nom} » est dans la corbeille (${CORBEILLE_JOURS} jours).`);
          })
        : undefined;
      corps.append(ligne(f.nom, taille(f.taille), suppr));
    }
    if (createur() && etat.fichiers.length < MAQUETTES_MAX) {
      corps.append(
        bouton("btn principal", "Déposer une maquette", () => {
          fermer();
          btnAjouter.click();
        }),
      );
    }

    if (createur() && etat.corbeille.length) {
      corps.append(section(`Corbeille · ${etat.corbeille.length}`));
      for (const f of etat.corbeille) {
        const reste = jours(f.supprime_le!);
        const actions = cree("div", "modale-actions");
        actions.append(
          bouton("lien", "Restaurer", async () => {
            const { error } = await nuage.from("maquettes").update({ supprime_le: null }).eq("id", f.id);
            if (error) {
              alerte(
                error.code === "23505"
                  ? "Une maquette du projet porte déjà ce nom : supprimez-la d'abord."
                  : messageErreur(error),
              );
              return;
            }
            await chargerDetails();
            majBandeau();
            await ouvrirProjet(projet);
            ouvrirPanneau(`« ${f.nom} » est de retour dans le projet.`);
          }),
          bouton("lien danger", "Effacer", async () => {
            const oui = await confirmer(
              "Effacer définitivement ?",
              `« ${f.nom} » sera effacée tout de suite, sans retour possible.`,
              "Effacer définitivement",
              true,
            );
            if (oui) {
              await nuage.storage.from("maquettes").remove(cheminsDe(f));
              const { error } = await nuage.from("maquettes").delete().eq("id", f.id);
              if (error) alerte(messageErreur(error));
              await chargerDetails();
            }
            ouvrirPanneau();
          }),
        );
        corps.append(
          ligne(f.nom, `${taille(f.taille)} · effacée dans ${reste} jour${reste > 1 ? "s" : ""}`, actions),
        );
      }
    }

    corps.append(section(`Personnes · ${etat.personnes.length}`));
    for (const p of etat.personnes) {
      const role =
        p.role === "createur" ? "Créateur" : p.role === "invite" ? "Invité · lecture seule" : "Invitation envoyée · en attente";
      let actions: HTMLElement | undefined;
      if (createur() && p.role !== "createur") {
        actions = cree("div", "modale-actions");
        if (p.role !== "invite") {
          actions.append(
            bouton("lien", "Renvoyer", async () => {
              const erreur = await inviter(p.email);
              if (erreur) alerte(erreur);
            }, "Renvoyer l'e-mail d'invitation"),
          );
        }
        actions.append(
          bouton("lien danger", "Retirer", async () => {
            const qui = p.prenom || p.email;
            const oui = await confirmer(
              p.role === "invite" ? "Retirer cette personne ?" : "Annuler l'invitation ?",
              p.role === "invite"
                ? `${qui} n'aura plus accès au projet « ${projet.nom} ». Vous pourrez l'inviter à nouveau.`
                : `Le lien envoyé à ${p.email} ne fonctionnera plus.`,
              p.role === "invite" ? "Retirer" : "Annuler l'invitation",
              true,
            );
            if (!oui) return ouvrirPanneau();
            const requete =
              p.role === "invite"
                ? nuage.from("membres").delete().eq("projet_id", projet.id).eq("utilisateur_id", p.utilisateur_id)
                : nuage.from("invitations").delete().eq("projet_id", projet.id).eq("email", p.email);
            const { error } = await requete;
            if (error) return alerte(messageErreur(error));
            await chargerDetails();
            ouvrirPanneau(p.role === "invite" ? `${qui} n'a plus accès au projet.` : `Invitation de ${p.email} annulée.`);
          }, p.role === "invite" ? "Retirer l'accès" : "Annuler l'invitation"),
        );
      }
      corps.append(ligne(p.prenom || p.email, p.prenom ? `${p.email} · ${role}` : role, actions));
    }
    if (createur()) {
      corps.append(formulaire("E-mail de la personne à inviter", "Inviter", "email", inviter));
      corps.append(
        cree(
          "p",
          "modale-aide",
          "La personne reçoit un e-mail. Si elle n'a pas encore de compte, elle le crée depuis ce lien et entre directement dans le projet, en lecture seule.",
        ),
      );
    }

    corps.append(
      createur()
        ? bouton("lien danger", "Supprimer le projet", async () => {
            const oui = await confirmer(
              "Supprimer le projet ?",
              `Le projet « ${projet.nom} », ses ${etat.fichiers.length + etat.corbeille.length} maquette(s), corbeille comprise, ` +
                `et les accès des personnes invitées seront effacés tout de suite, sans corbeille ni retour possible.`,
              "Supprimer le projet",
              true,
            );
            if (!oui) return ouvrirPanneau();
            const chemins = [...etat.fichiers, ...etat.corbeille].flatMap(cheminsDe);
            if (chemins.length) await nuage.storage.from("maquettes").remove(chemins);
            const { error } = await nuage.from("projets").delete().eq("id", projet.id);
            if (error) return alerte(messageErreur(error));
            fermer();
            await chargerProjets();
            await ouvrirProjet(etat.projets[0] ?? null);
          })
        : !etat.projets.some((p) => p.id === projet.id)
          ? cree("span", "modale-aide", "Accès administrateur : lecture seule.")
          : bouton("lien danger", "Quitter ce projet", async () => {
            const oui = await confirmer(
              "Quitter le projet ?",
              `Vous ne verrez plus les maquettes de « ${projet.nom} ». Le créateur pourra vous inviter à nouveau.`,
              "Quitter",
            );
            if (!oui) return ouvrirPanneau();
            await nuage.from("membres").delete().eq("projet_id", projet.id).eq("utilisateur_id", etat.moi.id);
            fermer();
            await chargerProjets();
            await ouvrirProjet(etat.projets[0] ?? null);
          }),
    );
  }

  const pied = cree("div", "modale-pied");
  if (!exempleAffiche()) {
    pied.append(
      bouton("btn", "Voir la maquette d'essai", () => {
        fermer();
        void chargerExemple();
      }),
    );
  } else if (etat.fichiers.length > 0 && projet) {
    pied.append(
      bouton("btn", "Revenir à mes maquettes", () => {
        fermer();
        void ouvrirProjet(projet);
      }),
    );
  }
  const signature = cree("a", "signature", "NexBim · une application PaceApp");
  signature.href = "https://paceapp.fr";
  signature.target = "_blank";
  signature.rel = "noopener";
  corps.append(pied, signature);
}

btnProjet.addEventListener("click", () => ouvrirPanneau());

/** Administrateur : affiche ou masque les projets de tous les comptes. */
async function basculerTousProjets() {
  if (etat.autres) {
    etat.autres = null;
    return ouvrirPanneau();
  }
  const [{ data: tous, error }, { data: maq }] = await Promise.all([
    nuage.from("projets").select("id, nom, proprietaire, cree_le").order("cree_le", { ascending: false }),
    nuage.from("maquettes").select("projet_id").is("supprime_le", null),
  ]);
  if (error) return alerte(messageErreur(error));
  const autres = ((tous ?? []) as Projet[]).filter(
    (p) => p.proprietaire !== etat.moi.id && !etat.projets.some((x) => x.id === p.id),
  );
  const titulaires = [...new Set(autres.map((p) => p.proprietaire))];
  const { data: profils } = titulaires.length
    ? await nuage.from("profils").select("id, prenom, email").in("id", titulaires)
    : { data: [] };
  const noms = new Map(
    ((profils ?? []) as { id: string; prenom: string; email: string }[]).map((x) => [x.id, x.prenom || x.email]),
  );
  const compte = new Map<string, number>();
  for (const m of (maq ?? []) as { projet_id: string }[]) compte.set(m.projet_id, (compte.get(m.projet_id) ?? 0) + 1);
  etat.autres = autres.map((p) => ({ ...p, titulaire: noms.get(p.proprietaire) ?? "compte inconnu", maquettes: compte.get(p.id) ?? 0 }));
  ouvrirPanneau();
}

// --- Menu du compte (pastille en haut à droite, comme dans PaceApp) ------------------

const SVG = (d: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONES_MENU = {
  admin: SVG('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z"/>'),
  projets: SVG('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>'),
  versions: SVG('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  applis: SVG('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  sortie: SVG('<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>'),
};

const AUTRES_APPLIS = [
  { nom: "PaceApp", url: "https://paceapp.fr", texte: "Dossiers, notes et courriers" },
  { nom: "CovoitGo", url: "https://covoitgo.paceapp.fr", texte: "Covoiturage du quotidien" },
  { nom: "Bonplein", url: "https://bonplein.paceapp.fr", texte: "Prix des carburants en direct" },
  { nom: "Malino", url: "https://malino.paceapp.fr", texte: "Maths et lecture pour les enfants" },
];

function majCompte() {
  const nom = (etat.moi.prenom || etat.moi.email).trim();
  btnCompte.textContent = (nom[0] ?? "?").toUpperCase();
  btnCompte.title = `Mon compte · ${etat.moi.email}`;
  btnCompte.classList.toggle("admin", etat.admin);
  btnCompte.hidden = false;
}

let menuCompte: HTMLElement | null = null;

function fermerMenuCompte() {
  menuCompte?.remove();
  menuCompte = null;
  btnCompte.setAttribute("aria-expanded", "false");
  window.removeEventListener("pointerdown", dehorsMenuCompte, true);
  window.removeEventListener("keydown", toucheMenuCompte, true);
}
function dehorsMenuCompte(e: PointerEvent) {
  const cible = e.target as Node;
  if (menuCompte?.contains(cible) || btnCompte.contains(cible)) return;
  fermerMenuCompte();
}
function toucheMenuCompte(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.stopImmediatePropagation();
  fermerMenuCompte();
}

function ouvrirMenuCompte() {
  if (menuCompte) return fermerMenuCompte();
  const menu = cree("div", "menu-compte");
  menu.setAttribute("role", "menu");
  const entete = cree("div", "menu-compte-entete");
  entete.append(cree("strong", "", etat.moi.prenom || "Mon compte"), cree("span", "", etat.moi.email));
  menu.append(entete);
  const item = (classe: string, icone: string, texte: string, action: () => void) => {
    const b = bouton("menu-compte-item" + (classe ? ` ${classe}` : ""), "", () => {
      fermerMenuCompte();
      action();
    });
    b.setAttribute("role", "menuitem");
    b.innerHTML = icone;
    b.append(cree("span", "", texte));
    menu.append(b);
  };
  if (etat.admin) item("admin", ICONES_MENU.admin, "Panneau admin", () => void ouvrirAdmin());
  item("", ICONES_MENU.projets, "Mes projets", () => ouvrirPanneau());
  item("", ICONES_MENU.versions, "Versions et mises à jour", () => ouvrirVersions());
  item("", ICONES_MENU.applis, "Autres applications PaceApp", ouvrirAutresApplis);
  menu.append(cree("div", "menu-compte-sep"));
  item("danger", ICONES_MENU.sortie, "Se déconnecter", () => {
    void confirmer(
      "Se déconnecter ?",
      "Pour revenir, il faudra saisir à nouveau votre e-mail et votre mot de passe.",
      "Se déconnecter",
    ).then((oui) => (oui ? seDeconnecter() : fermer()));
  });
  document.body.append(menu);
  menuCompte = menu;
  btnCompte.setAttribute("aria-expanded", "true");
  window.addEventListener("pointerdown", dehorsMenuCompte, true);
  window.addEventListener("keydown", toucheMenuCompte, true);
}

function ouvrirAutresApplis() {
  const corps = ouvrirFenetre("Autres applications PaceApp");
  corps.append(cree("p", "modale-aide", "Les autres applications du groupe PaceApp, avec le même esprit."));
  const liste = cree("div", "projets-liste");
  for (const a of AUTRES_APPLIS) {
    const lien = cree("a", "projet-ligne");
    lien.href = a.url;
    lien.target = "_blank";
    lien.rel = "noopener";
    lien.append(cree("span", "projet-nom", a.nom), cree("span", "projet-role", a.texte));
    liste.append(lien);
  }
  corps.append(liste);
}

btnCompte.addEventListener("click", ouvrirMenuCompte);

// --- Panneau admin ----------------------------------------------------------------

type Compte = {
  id: string;
  email: string;
  prenom: string;
  inscrit_le: string;
  derniere_connexion: string | null;
  confirme: boolean;
  projets: number;
  invitations_recues: number;
  maquettes: number;
  octets: number;
  ia_questions: number;
  ia_actif: boolean;
  ia_demande: string | null;
};

const jour = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

/** État de l'assistant IA d'un compte, avec le bouton pour l'ouvrir ou le couper. */
function celluleIA(c: Compte) {
  const td = cree("td", "admin-ia");
  const libelle = c.ia_actif
    ? "Activée"
    : c.ia_demande
      ? `Demande · ${c.ia_questions}/3`
      : `Essai · ${c.ia_questions}/3`;
  const basculer = bouton(c.ia_actif ? "lien danger" : "puce allume", c.ia_actif ? "Couper" : "Activer", async () => {
    basculer.disabled = true;
    const { error } = await nuage.rpc("admin_ia", { p_uid: c.id, p_actif: !c.ia_actif });
    if (error) {
      basculer.disabled = false;
      alerte("Impossible de changer l'accès à l'IA.");
      return;
    }
    await ouvrirAdmin();
  });
  td.append(cree("span", "", libelle), basculer);
  return td;
}

async function ouvrirAdmin() {
  const corps = ouvrirFenetre("Panneau admin", true);
  corps.append(cree("p", "modale-aide", "Chargement…"));
  const { data, error } = await nuage.rpc("admin_comptes");
  if (error) {
    corps.replaceChildren(cree("p", "modale-aide", "Accès refusé."));
    return;
  }
  const comptes = (data ?? []) as Compte[];
  const demandes = comptes.filter((x) => x.ia_demande && !x.ia_actif).length;
  const somme = (c: (x: Compte) => number) => comptes.reduce((s, x) => s + Number(c(x)), 0);
  const chiffres = cree("div", "admin-chiffres");
  for (const [valeur, nom] of [
    [String(comptes.length), "inscrits"],
    [String(somme((x) => x.projets)), "projets"],
    [String(somme((x) => x.maquettes)), "maquettes"],
    [taille(somme((x) => x.octets)), "stockage"],
    [String(demandes), "demandes IA"],
  ]) {
    const c = cree("div", "admin-chiffre");
    c.append(cree("strong", "", valeur), cree("span", "", nom));
    chiffres.append(c);
  }
  const table = cree("table", "admin-table");
  const tete = cree("tr");
  for (const t of ["Prénom", "E-mail", "Inscrit", "Vu", "Projets", "Invité", "Maquettes", "Stockage", "IA"])
    tete.append(cree("th", "", t));
  table.append(tete);
  for (const c of comptes) {
    const tr = cree("tr");
    for (const v of [
      c.prenom || "—",
      c.email + (c.confirme ? "" : " (non confirmé)"),
      jour(c.inscrit_le),
      jour(c.derniere_connexion),
      String(c.projets),
      String(c.invitations_recues),
      String(c.maquettes),
      Number(c.octets) ? taille(Number(c.octets)) : "—",
    ])
      tr.append(cree("td", "", v));
    tr.append(celluleIA(c));
    tr.classList.toggle("demande-ia", !!c.ia_demande && !c.ia_actif);
    table.append(tr);
  }
  const defile = cree("div", "admin-defile");
  defile.append(table);
  corps.replaceChildren(chiffres, defile, bouton("btn", "Retour", () => ouvrirPanneau()));
}
