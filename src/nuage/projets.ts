// Projet dans le cloud : maquettes déposées, personnes invitées, compte, panneau admin.
import {
  deplacementsModifies,
  exporter as exporterDeplacements,
  importer as importerDeplacements,
  type Donnees,
} from "../deplacements";
import type { User } from "@supabase/supabase-js";
import { blocReglagesPas } from "../reglages-app";
import { alerte, attente, bouton, cree, el, icone, Signal } from "../noyau";
import { detecterLot, maquettes as affichees } from "../registre";
import {
  afficherMaquettes,
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
import { numeroVersion, ouvrirVersions } from "../mise-a-jour";
import { accueilSiNouveau, ouvrirAccueil } from "./accueil";
import {
  activerNotifications,
  appliInstallee,
  appareil,
  demarrerAppli,
  desactiverNotifications,
  etatNotifications,
  installer,
  lieuChange,
} from "./appli";
import { modeVisite } from "../navigation";

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
  moi: { id: "", email: "", prenom: "", taille: null as number | null },
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
  modale.className = large ? "modale large" : "modale";
  const entete = cree("div", "modale-entete");
  const x = bouton("fermer", "✕", fermer, "Fermer");
  entete.append(cree("span", "", titre), x);
  const corps = cree("div", "modale-corps");
  modale.replaceChildren(entete, corps);
  fond.hidden = false;
  return corps;
}

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
  lieuChange();
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
  projetCharge.emit(etat.courant && etat.fichiers.length > 0 ? etat.courant.id : null);
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

/** Émis quand un projet vient d'être ouvert : son identifiant, ou null (maquette d'essai). */
export const projetCharge = new Signal<string | null>();

/** Prénom de la personne connectée (sinon son e-mail), pour signer captures et remarques. */
export const monPrenom = () => etat.moi.prenom || etat.moi.email.split("@")[0] || "";
export const monId = () => etat.moi.id;
export const monEmail = () => etat.moi.email;
export const nomProjetCourant = () => etat.courant?.nom ?? "";

/** Administrateur connecté (fonctions en essai, réservées pour l'instant). */
export const estAdmin = () => etat.admin;

/**
 * Hauteur de la vue en visite à la première personne : celle du téléphone tenu en main,
 * vers les épaules (taille − 30 cm). Sans taille renseignée : 1,40 m.
 */
export const hauteurTelephone = () => (etat.moi.taille ? etat.moi.taille / 100 - 0.3 : 1.4);

export async function demarrerNuage(utilisateur: User) {
  etat.moi.id = utilisateur.id;
  etat.moi.email = utilisateur.email ?? "";
  const [{ data: profil }, { data: admin }] = await Promise.all([
    nuage.from("profils").select("prenom, taille_cm, version_app").eq("id", utilisateur.id).maybeSingle(),
    nuage.rpc("suis_je_admin"),
  ]);
  etat.moi.prenom = profil?.prenom ?? "";
  etat.moi.taille = typeof profil?.taille_cm === "number" ? profil.taille_cm : null;
  etat.admin = admin === true;
  // Version de l'appli utilisée (fenêtre des versions de l'administrateur).
  if (numeroVersion !== "locale" && profil?.version_app !== numeroVersion) {
    void nuage
      .from("profils")
      .update({ version_app: numeroVersion, version_le: new Date().toISOString() })
      .eq("id", utilisateur.id)
      .then(({ error }) => error && console.warn("version", error.message));
  }
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
  // Présence (panneau admin), propositions d'installer l'appli et d'activer les notifications,
  // et accueil animé pour un compte qui n'a encore jamais vu NexBim.
  demarrerAppli(() => [modeVisite() ? "visite" : etat.courant ? "maquette" : "projets", etat.courant?.nom ?? ""]);
  void accueilSiNouveau();
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

// Panneau en onglets, façon page de dépôt GitHub : en-tête du projet (sélecteur),
// onglets Maquettes / Personnes / Corbeille / Réglages, listes repliables.
type Onglet = "maquettes" | "personnes" | "corbeille" | "reglages";
const vuePanneau = {
  onglet: "maquettes" as Onglet,
  /** Menu de choix du projet déplié. */
  projetsOuverts: false,
  /** Liste des maquettes repliée (en-tête seul). */
  repliee: false,
  /** Listes affichées en entier au lieu des premières lignes. */
  toutesMaquettes: false,
  toutesPersonnes: false,
  filtre: "",
  /** Maquettes dont le détail est déplié. */
  details: new Set<string>(),
};
const PREMIERES_LIGNES = 5;

function ico(d: string, taille = 14) {
  return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}
const ICO = {
  dossier: ico('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>', 16),
  maquettes: ico('<path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>'),
  personnes: ico('<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.6c2.4.2 4.3 1.8 4.9 4.4"/>'),
  corbeille: ico('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="m6.5 7 .9 12.2a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>'),
  reglages: ico('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.2M17.6 15.3l2.2 1.2M4.2 16.5l2.2-1.2M17.6 8.7l2.2-1.2"/>'),
  chevron: ico('<path d="m9 6 6 6-6 6"/>', 12),
  bas: ico('<path d="m6 9 6 6 6-6"/>', 12),
  plus: ico('<path d="M12 5v14M5 12h14"/>', 13),
  coche: ico('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 13),
  loupe: ico('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>', 13),
  telecharger: ico('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>', 13),
};
const avecIcone = (classe: string, svg: string, texte?: string) => {
  const s = cree("span", classe);
  s.innerHTML = svg;
  if (texte !== undefined) s.append(cree("span", "", texte));
  return s;
};
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const sansAccents = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dateCourte = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

/** Réaffiche le panneau à la même hauteur de défilement (dépliage, œil, etc.). */
function redessiner(info = "") {
  const avant = modale.querySelector<HTMLElement>(".modale-corps")?.scrollTop ?? 0;
  ouvrirPanneau(info);
  const corps = modale.querySelector<HTMLElement>(".modale-corps");
  if (corps) corps.scrollTop = avant;
}

/** Ouvre le panneau avec le choix des projets déplié (menu du compte). */
function ouvrirMesProjets() {
  vuePanneau.projetsOuverts = true;
  ouvrirPanneau();
}

function changerDeProjet(p: Projet, message?: string) {
  vuePanneau.projetsOuverts = false;
  vuePanneau.filtre = "";
  vuePanneau.toutesMaquettes = false;
  vuePanneau.toutesPersonnes = false;
  vuePanneau.details.clear();
  vuePanneau.onglet = "maquettes";
  fermer();
  void ouvrirProjet(p).then(() => message && alerte(message, 4500));
}

function ouvrirPanneau(info = "", onglet?: Onglet) {
  if (onglet) vuePanneau.onglet = onglet;
  const corps = ouvrirFenetre("Projet");
  modale.classList.add("projet");
  if (info) corps.append(cree("p", "modale-info", info));
  const projet = etat.courant;
  corps.append(enteteProjet(projet));
  if (!projet || vuePanneau.projetsOuverts) corps.append(menuProjets());
  if (projet) {
    const avecCorbeille = createur() && etat.corbeille.length > 0;
    if (vuePanneau.onglet === "corbeille" && !avecCorbeille) vuePanneau.onglet = "maquettes";
    corps.append(barreOnglets(avecCorbeille));
    const zone = cree("div", "pj-zone");
    zone.setAttribute("role", "tabpanel");
    if (vuePanneau.onglet === "maquettes") ongletMaquettes(zone, projet);
    else if (vuePanneau.onglet === "personnes") ongletPersonnes(zone, projet);
    else if (vuePanneau.onglet === "corbeille") ongletCorbeille(zone, projet);
    else ongletReglages(zone, projet);
    corps.append(zone);
  } else if (!exempleAffiche()) {
    corps.append(bouton("lien pj-essai", "Voir la maquette d'essai", () => (fermer(), void chargerExemple())));
  }
  const signature = cree("a", "signature", "NexBim · une application PaceApp");
  signature.href = "https://paceapp.fr";
  signature.target = "_blank";
  signature.rel = "noopener";
  corps.append(signature);
}

// --- En-tête : nom du projet, rôle, chiffres ; un clic déplie le choix des projets ---

function roleDansProjet(p: Projet) {
  if (p.proprietaire === etat.moi.id) return { texte: "Créateur", classe: "createur" };
  if (etat.projets.some((x) => x.id === p.id)) return { texte: "Lecture seule", classe: "invite" };
  return { texte: "Admin · lecture", classe: "admin" };
}

function enteteProjet(projet: Projet | null) {
  const tete = cree("div", "pj-tete");
  const ouvert = !projet || vuePanneau.projetsOuverts;
  const sel = bouton(
    "pj-selecteur" + (ouvert ? " ouvert" : ""),
    "",
    () => {
      if (!projet) return;
      vuePanneau.projetsOuverts = !vuePanneau.projetsOuverts;
      redessiner();
    },
    projet ? "Changer de projet" : undefined,
  );
  sel.setAttribute("aria-expanded", String(ouvert));
  sel.append(avecIcone("pj-icone", ICO.dossier), cree("span", "pj-nom", projet ? projet.nom : "Choisir un projet"));
  if (projet) {
    const r = roleDansProjet(projet);
    sel.append(cree("span", `pj-badge ${r.classe}`, r.texte));
  }
  sel.append(avecIcone("pj-fleche", ICO.bas));
  tete.append(sel);
  if (projet) {
    const volume = etat.fichiers.reduce((s, f) => s + f.taille, 0);
    tete.append(
      cree(
        "div",
        "pj-stats",
        `${pluriel(etat.fichiers.length, "maquette")} · ${taille(volume)} · ${pluriel(etat.personnes.length, "personne")}`,
      ),
    );
  }
  return tete;
}

function menuProjets() {
  const menu = cree("div", "pj-menu");
  const miens = etat.projets.filter((p) => p.proprietaire === etat.moi.id);
  const partages = etat.projets.filter((p) => p.proprietaire !== etat.moi.id);
  const ligneProjet = (p: Projet, detail = "", autre = false, message?: string) => {
    const actif = p.id === etat.courant?.id;
    const l = bouton(
      "pj-projet" + (actif ? " actif" : "") + (autre ? " autre" : ""),
      "",
      () => (actif ? ((vuePanneau.projetsOuverts = false), redessiner()) : changerDeProjet(p, message)),
      actif ? "Projet affiché" : "Ouvrir ce projet",
    );
    l.append(avecIcone("pj-coche", actif ? ICO.coche : ""), cree("span", "pj-projet-nom", p.nom));
    if (detail) l.append(cree("span", "pj-projet-detail", detail));
    return l;
  };
  const titre = cree("div", "pj-menu-titre");
  titre.append(cree("span", "", etat.admin ? `Mes projets · ${miens.length}` : `Mes projets · ${miens.length}/${PROJETS_MAX}`));
  if (etat.admin) {
    titre.append(
      bouton(
        "lien pj-admin-tous",
        etat.autres ? "Masquer les autres comptes" : "Tous les comptes",
        () => void basculerTousProjets(),
        "Projets de tous les comptes (administrateur)",
      ),
    );
  }
  menu.append(titre);
  if (!etat.projets.length) {
    menu.append(cree("p", "modale-aide", `Un projet regroupe jusqu'à ${MAQUETTES_MAX} maquettes IFC et les personnes que vous invitez.`));
  }
  for (const p of miens) menu.append(ligneProjet(p));
  // Administrateur : projet d'un autre compte en cours de consultation.
  const courant = etat.courant;
  if (courant && !etat.projets.some((p) => p.id === courant.id) && !etat.autres?.some((p) => p.id === courant.id)) {
    menu.append(ligneProjet(courant, "admin", true));
  }
  if (partages.length) {
    menu.append(cree("div", "pj-menu-titre", `Partagés avec moi · ${partages.length}`));
    for (const p of partages) menu.append(ligneProjet(p, "lecture"));
  }
  if (etat.admin && etat.autres) {
    menu.append(cree("div", "pj-menu-titre", `Autres comptes · ${etat.autres.length}`));
    if (!etat.autres.length) menu.append(cree("p", "modale-aide", "Aucun autre projet pour l'instant."));
    for (const p of etat.autres) {
      menu.append(
        ligneProjet(p, `${p.titulaire} · ${p.maquettes} maq.`, true, `Projet de ${p.titulaire} ouvert en lecture seule (accès administrateur).`),
      );
    }
  }
  if (etat.admin || miens.length < PROJETS_MAX) {
    const f = formulaire("Nom du nouveau projet", "Créer", "text", async (nom) => {
      const { data, error } = await nuage.from("projets").insert({ nom }).select("id, nom, proprietaire").single();
      if (error || !data) return messageErreur(error);
      etat.projets.push(data as Projet);
      vuePanneau.projetsOuverts = false;
      vuePanneau.onglet = "maquettes";
      fermer();
      await ouvrirProjet(data as Projet);
      ouvrirPanneau("Projet créé. Déposez votre première maquette.");
    });
    f.classList.add("pj-creer");
    menu.append(f);
  } else {
    menu.append(cree("p", "modale-aide", `${PROJETS_MAX} projets au maximum par compte. Supprimez-en un pour en créer un autre.`));
  }
  return menu;
}

// --- Onglets ------------------------------------------------------------------------

function barreOnglets(avecCorbeille: boolean) {
  const nav = cree("div", "pj-onglets");
  nav.setAttribute("role", "tablist");
  const liste: [Onglet, string, string, number | null][] = [
    ["maquettes", "Maquettes", ICO.maquettes, etat.fichiers.length],
    ["personnes", "Personnes", ICO.personnes, etat.personnes.length],
  ];
  if (avecCorbeille) liste.push(["corbeille", "Corbeille", ICO.corbeille, etat.corbeille.length]);
  liste.push(["reglages", "Réglages", ICO.reglages, null]);
  for (const [id, texte, svg, n] of liste) {
    const actif = vuePanneau.onglet === id;
    const b = bouton("pj-onglet" + (actif ? " actif" : ""), "", () => {
      if (actif) return;
      vuePanneau.onglet = id;
      ouvrirPanneau();
    });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(actif));
    b.innerHTML = svg;
    b.append(cree("span", "", texte));
    if (n !== null) b.append(cree("span", "pj-compte", String(n)));
    nav.append(b);
  }
  return nav;
}

/** Boîte bordée avec en-tête (titre à gauche, actions à droite) et liste. */
function boite(titre: HTMLElement, actions: HTMLElement[] = []) {
  const b = cree("div", "pj-boite");
  const tete = cree("div", "pj-boite-tete");
  const a = cree("div", "pj-boite-actions");
  a.append(...actions);
  tete.append(titre, a);
  const liste = cree("div", "pj-liste");
  b.append(tete, liste);
  return { b, tete, liste };
}

function boutonToutVoir(total: number, tout: boolean, basculer: () => void) {
  return bouton("pj-tout-voir", tout ? "Réduire" : `Tout voir (${total})`, basculer);
}

// --- Onglet Maquettes ----------------------------------------------------------------

async function telechargerIfc(f: Fichier) {
  attente(`Préparation de « ${f.nom} »…`);
  try {
    const brut = await telechargerFichier(f.chemin);
    const ifc = f.chemin.endsWith(".gz") ? await decompresser(brut) : brut;
    const a = cree("a");
    a.href = URL.createObjectURL(new Blob([ifc], { type: "application/x-step" }));
    a.download = /\.ifc$/i.test(f.nom) ? f.nom : `${f.nom}.ifc`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  } catch (e) {
    console.error(e);
    alerte("Téléchargement impossible. Réessayez.");
  } finally {
    attente(null);
  }
}

async function mettreALaCorbeille(f: Fichier) {
  const oui = await confirmer(
    "Supprimer la maquette ?",
    `« ${f.nom} » quittera le projet, pour vous et pour les personnes invitées. ` +
      `Elle reste dans la corbeille pendant ${CORBEILLE_JOURS} jours : vous pourrez la restaurer d'ici là. ` +
      `Ensuite, elle sera effacée définitivement.`,
    "Mettre à la corbeille",
    true,
  );
  if (!oui) return redessiner();
  const { error } = await nuage.from("maquettes").update({ supprime_le: new Date().toISOString() }).eq("id", f.id);
  if (error) {
    alerte(messageErreur(error));
    return redessiner();
  }
  if (affichees.has(nomLocal(f.nom))) await retirer(nomLocal(f.nom));
  vuePanneau.details.delete(f.id);
  await chargerDetails();
  if (affichees.size === 0) await chargerExemple();
  majBandeau();
  ouvrirPanneau(`« ${f.nom} » est dans la corbeille (${CORBEILLE_JOURS} jours).`);
}

function ongletMaquettes(zone: HTMLElement, projet: Projet) {
  const n = etat.fichiers.length;
  const peutDeposer = createur() && n < MAQUETTES_MAX;
  const barre = cree("div", "pj-barre");
  let liste: HTMLElement;
  if (n > PREMIERES_LIGNES) {
    const recherche = cree("label", "pj-recherche");
    recherche.innerHTML = ICO.loupe;
    const saisie = cree("input");
    saisie.type = "search";
    saisie.placeholder = "Filtrer les maquettes…";
    saisie.value = vuePanneau.filtre;
    saisie.addEventListener("input", () => {
      vuePanneau.filtre = saisie.value;
      remplir();
    });
    recherche.append(saisie);
    barre.append(recherche);
  } else {
    barre.append(cree("span", "pj-barre-texte", createur() ? "Maquettes IFC du projet" : "Maquettes partagées avec vous"));
  }
  if (peutDeposer) {
    const dep = bouton("btn principal pj-deposer", "", () => (fermer(), btnAjouter.click()), "Déposer une maquette IFC");
    dep.innerHTML = ICO.plus;
    dep.append(cree("span", "", "Déposer"));
    barre.append(dep);
  }
  zone.append(barre);

  if (n === 0) {
    const vide = cree("div", "pj-vide");
    vide.innerHTML = ico('<path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>', 26);
    vide.append(
      cree("strong", "", "Aucune maquette"),
      cree("span", "", createur() ? `Déposez jusqu'à ${MAQUETTES_MAX} fichiers IFC.` : "Le créateur n'a encore rien déposé."),
    );
    zone.append(vide);
  } else {
    const chargees = etat.fichiers.map((f) => affichees.get(nomLocal(f.nom))).filter((m) => !!m);
    const toutesVisibles = chargees.length > 0 && chargees.every((m) => m!.modele.object.visible);
    const titre = bouton("pj-repli", "", () => {
      vuePanneau.repliee = !vuePanneau.repliee;
      redessiner();
    }, vuePanneau.repliee ? "Déplier la liste" : "Replier la liste");
    titre.setAttribute("aria-expanded", String(!vuePanneau.repliee));
    titre.append(
      avecIcone("pj-chevron" + (vuePanneau.repliee ? "" : " ouvert"), ICO.chevron),
      cree("span", "", etat.admin ? pluriel(n, "maquette") : `${n}/${MAQUETTES_MAX} maquettes`),
    );
    const actions: HTMLElement[] = [];
    if (chargees.length > 1 && !vuePanneau.repliee) {
      actions.push(
        bouton("lien", toutesVisibles ? "Tout masquer" : "Tout afficher", async () => {
          await afficherMaquettes(chargees.map((m) => m!.id), !toutesVisibles);
          redessiner();
        }),
      );
    }
    const { b, liste: l } = boite(titre, actions);
    liste = l;
    if (vuePanneau.repliee) b.classList.add("repliee");
    zone.append(b);
    remplir();
  }

  function remplir() {
    if (!liste) return;
    liste.replaceChildren();
    if (vuePanneau.repliee) return;
    const filtre = sansAccents(vuePanneau.filtre.trim());
    const trouves = filtre ? etat.fichiers.filter((f) => sansAccents(f.nom).includes(filtre)) : etat.fichiers;
    const montres = filtre || vuePanneau.toutesMaquettes ? trouves : trouves.slice(0, PREMIERES_LIGNES);
    for (const f of montres) liste.append(ligneMaquette(f, remplir));
    if (filtre && !trouves.length) liste.append(cree("p", "pj-aucun", "Aucune maquette ne correspond."));
    if (!filtre && trouves.length > PREMIERES_LIGNES) {
      liste.append(
        boutonToutVoir(trouves.length, vuePanneau.toutesMaquettes, () => {
          vuePanneau.toutesMaquettes = !vuePanneau.toutesMaquettes;
          remplir();
        }),
      );
    }
  }

  const pied = cree("div", "pj-pied");
  if (!exempleAffiche()) {
    pied.append(bouton("lien", "Voir la maquette d'essai", () => (fermer(), void chargerExemple())));
  } else if (n > 0) {
    pied.append(bouton("lien", "Revenir à mes maquettes", () => (fermer(), void ouvrirProjet(projet))));
  }
  if (pied.childElementCount) zone.append(pied);
}

function ligneMaquette(f: Fichier, remplir: () => void) {
  const m = affichees.get(nomLocal(f.nom));
  const ouverte = vuePanneau.details.has(f.id);
  const rang = cree("div", "pj-ligne pj-maq" + (ouverte ? " ouverte" : ""));
  const tete = cree("div", "pj-ligne-tete");
  const deplier = bouton("pj-deplier", "", () => {
    if (ouverte) vuePanneau.details.delete(f.id);
    else vuePanneau.details.add(f.id);
    remplir();
  }, ouverte ? "Replier" : "Détails et actions");
  deplier.setAttribute("aria-expanded", String(ouverte));
  const pastille = cree("span", "pj-pastille");
  pastille.style.background = m?.hex ?? detecterLot(f.nom).hex;
  const texte = cree("span", "pj-ligne-texte");
  texte.append(cree("span", "pj-ligne-nom", nomLocal(f.nom)), cree("small", "", `${taille(f.taille)} · ${dateCourte(f.cree_le)}`));
  deplier.append(avecIcone("pj-chevron" + (ouverte ? " ouvert" : ""), ICO.chevron), pastille, texte);
  tete.append(deplier);
  if (m) {
    const visible = m.modele.object.visible;
    const oeil = bouton("pj-oeil" + (visible ? " actif" : ""), "", async () => {
      await afficherMaquettes([m.id], !visible);
      remplir();
    }, visible ? "Masquer dans la vue" : "Afficher dans la vue");
    oeil.append(icone(visible ? "oeil" : "oeilBarre"));
    tete.append(oeil);
  }
  rang.append(tete);
  if (ouverte) {
    const det = cree("div", "pj-details");
    const infos = cree("dl", "pj-infos");
    const info = (k: string, v: string) => infos.append(cree("dt", "", k), cree("dd", "", v));
    info("Nom", f.nom);
    info("Déposée le", jour(f.cree_le));
    info("Fichier IFC", taille(f.taille));
    info("Version rapide", f.taille_frag ? taille(f.taille_frag) : "créée à la prochaine ouverture");
    info("Lot", m?.lot ?? detecterLot(f.nom).lot);
    info("Dans la vue", m ? (m.modele.object.visible ? "affichée" : "masquée") : "non chargée");
    const actions = cree("div", "pj-details-actions");
    const tel = bouton("lien", "", () => void telechargerIfc(f), "Télécharger le fichier IFC");
    tel.innerHTML = ICO.telecharger;
    tel.append(cree("span", "", "Télécharger l'IFC"));
    actions.append(tel);
    if (createur()) actions.append(bouton("lien danger", "Supprimer", () => void mettreALaCorbeille(f)));
    det.append(infos, actions);
    rang.append(det);
  }
  return rang;
}

// --- Onglet Personnes ----------------------------------------------------------------

const TEINTES_AVATAR = ["#e8833a", "#4f8ff7", "#3fb68b", "#b07ef0", "#e05d6f", "#d9a43c", "#38a8c9"];
function avatar(p: Personne) {
  const nom = p.prenom || p.email;
  const initiales = (p.prenom ? p.prenom.split(/\s+/).map((x) => x[0]).join("") : p.email[0]).slice(0, 2).toUpperCase();
  let h = 0;
  for (const c of p.email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = cree("span", "pj-avatar", initiales);
  a.style.background = TEINTES_AVATAR[h % TEINTES_AVATAR.length];
  a.title = nom;
  return a;
}

function ongletPersonnes(zone: HTMLElement, projet: Projet) {
  if (createur()) {
    const f = formulaire("E-mail de la personne à inviter", "Inviter", "email", inviter);
    f.classList.add("pj-inviter");
    zone.append(
      f,
      cree("p", "pj-aide", "Elle reçoit un e-mail et entre dans le projet en lecture seule, même sans compte (elle le crée depuis le lien)."),
    );
  }
  const titre = cree("span", "pj-boite-titre", pluriel(etat.personnes.length, "personne"));
  const { b, liste } = boite(titre);
  const ordre = { createur: 0, invite: 1 } as Record<string, number>;
  const personnes = [...etat.personnes].sort((a, c) => (ordre[a.role] ?? 2) - (ordre[c.role] ?? 2));
  const montres = vuePanneau.toutesPersonnes ? personnes : personnes.slice(0, PREMIERES_LIGNES);
  for (const p of montres) liste.append(lignePersonne(p, projet));
  if (personnes.length > PREMIERES_LIGNES) {
    liste.append(
      boutonToutVoir(personnes.length, vuePanneau.toutesPersonnes, () => {
        vuePanneau.toutesPersonnes = !vuePanneau.toutesPersonnes;
        redessiner();
      }),
    );
  }
  zone.append(b);
}

function lignePersonne(p: Personne, projet: Projet) {
  const rang = cree("div", "pj-ligne pj-personne");
  const role =
    p.role === "createur"
      ? { t: "Créateur", c: "createur" }
      : p.role === "invite"
        ? { t: "Lecture seule", c: "invite" }
        : { t: "En attente", c: "attente" };
  const texte = cree("span", "pj-ligne-texte");
  texte.append(cree("span", "pj-ligne-nom", p.prenom || p.email));
  if (p.prenom) texte.append(cree("small", "", p.email));
  rang.append(avatar(p), texte, cree("span", `pj-badge ${role.c}`, role.t));
  if (createur() && p.role !== "createur") {
    const actions = cree("div", "pj-ligne-actions");
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
        if (!oui) return redessiner();
        const requete =
          p.role === "invite"
            ? nuage.from("membres").delete().eq("projet_id", projet.id).eq("utilisateur_id", p.utilisateur_id)
            : nuage.from("invitations").delete().eq("projet_id", projet.id).eq("email", p.email);
        const { error } = await requete;
        if (error) {
          alerte(messageErreur(error));
          return redessiner();
        }
        await chargerDetails();
        ouvrirPanneau(p.role === "invite" ? `${qui} n'a plus accès au projet.` : `Invitation de ${p.email} annulée.`);
      }, p.role === "invite" ? "Retirer l'accès" : "Annuler l'invitation"),
    );
    rang.append(actions);
  }
  return rang;
}

// --- Onglet Corbeille ----------------------------------------------------------------

function ongletCorbeille(zone: HTMLElement, projet: Projet) {
  zone.append(cree("p", "pj-aide", `Les maquettes supprimées restent ici ${CORBEILLE_JOURS} jours, puis sont effacées.`));
  const { b, liste } = boite(cree("span", "pj-boite-titre", pluriel(etat.corbeille.length, "maquette")));
  for (const f of etat.corbeille) {
    const reste = jours(f.supprime_le!);
    const rang = cree("div", "pj-ligne");
    const texte = cree("span", "pj-ligne-texte");
    texte.append(
      cree("span", "pj-ligne-nom", nomLocal(f.nom)),
      cree("small", "", `${taille(f.taille)} · effacée dans ${pluriel(reste, "jour")}`),
    );
    const actions = cree("div", "pj-ligne-actions");
    actions.append(
      bouton("lien", "Restaurer", async () => {
        const { error } = await nuage.from("maquettes").update({ supprime_le: null }).eq("id", f.id);
        if (error) {
          alerte(error.code === "23505" ? "Une maquette du projet porte déjà ce nom : supprimez-la d'abord." : messageErreur(error));
          return;
        }
        await chargerDetails();
        majBandeau();
        await ouvrirProjet(projet);
        ouvrirPanneau(`« ${f.nom} » est de retour dans le projet.`, etat.corbeille.length ? "corbeille" : "maquettes");
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
        redessiner();
      }),
    );
    rang.append(texte, actions);
    liste.append(rang);
  }
  zone.append(b);
}

// --- Onglet Réglages -----------------------------------------------------------------

function ongletReglages(zone: HTMLElement, projet: Projet) {
  if (createur()) {
    zone.append(cree("div", "pj-section", "Nom du projet"));
    const f = cree("form", "modale-form pj-renommer");
    const saisie = cree("input");
    saisie.value = projet.nom;
    saisie.maxLength = 80;
    saisie.required = true;
    const ok = cree("button", "btn", "Renommer");
    ok.type = "submit";
    const retour = cree("p", "modale-retour");
    f.append(saisie, ok, retour);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nom = saisie.value.trim();
      if (!nom || nom === projet.nom) return;
      ok.disabled = true;
      const { error } = await nuage.from("projets").update({ nom }).eq("id", projet.id);
      ok.disabled = false;
      if (error) {
        retour.textContent = messageErreur(error);
        return;
      }
      projet.nom = nom;
      const p = etat.projets.find((x) => x.id === projet.id);
      if (p) p.nom = nom;
      majBandeau();
      redessiner("Projet renommé.");
    });
    zone.append(f);
  }

  zone.append(cree("div", "pj-section", "Accès"));
  const acces = cree("dl", "pj-infos pj-infos-large");
  const r = roleDansProjet(projet);
  acces.append(
    cree("dt", "", "Votre rôle"),
    cree("dd", "", r.texte),
    cree("dt", "", "Maquettes"),
    cree("dd", "", etat.admin ? String(etat.fichiers.length) : `${etat.fichiers.length} sur ${MAQUETTES_MAX}`),
    cree("dt", "", "Invités"),
    cree("dd", "", createur() ? "lecture seule, 20 au maximum" : "lecture seule"),
  );
  zone.append(acces);

  const danger = cree("div", "pj-danger");
  danger.append(cree("div", "pj-danger-titre", "Zone sensible"));
  const rang = cree("div", "pj-danger-ligne");
  const texte = cree("div", "pj-danger-texte");
  if (createur()) {
    texte.append(
      cree("strong", "", "Supprimer le projet"),
      cree("span", "", "Maquettes, corbeille et accès des invités effacés tout de suite, sans retour."),
    );
    rang.append(
      texte,
      bouton("btn pj-btn-danger", "Supprimer", async () => {
        const oui = await confirmer(
          "Supprimer le projet ?",
          `Le projet « ${projet.nom} », ses ${etat.fichiers.length + etat.corbeille.length} maquette(s), corbeille comprise, ` +
            `et les accès des personnes invitées seront effacés tout de suite, sans corbeille ni retour possible.`,
          "Supprimer le projet",
          true,
        );
        if (!oui) return redessiner();
        const chemins = [...etat.fichiers, ...etat.corbeille].flatMap(cheminsDe);
        if (chemins.length) await nuage.storage.from("maquettes").remove(chemins);
        const { error } = await nuage.from("projets").delete().eq("id", projet.id);
        if (error) return alerte(messageErreur(error));
        vuePanneau.onglet = "maquettes";
        fermer();
        await chargerProjets();
        await ouvrirProjet(etat.projets[0] ?? null);
      }),
    );
  } else if (!etat.projets.some((p) => p.id === projet.id)) {
    texte.append(cree("strong", "", "Accès administrateur"), cree("span", "", "Vous consultez ce projet en lecture seule."));
    rang.append(texte);
  } else {
    texte.append(cree("strong", "", "Quitter ce projet"), cree("span", "", "Le créateur pourra vous inviter à nouveau."));
    rang.append(
      texte,
      bouton("btn pj-btn-danger", "Quitter", async () => {
        const oui = await confirmer(
          "Quitter le projet ?",
          `Vous ne verrez plus les maquettes de « ${projet.nom} ». Le créateur pourra vous inviter à nouveau.`,
          "Quitter",
        );
        if (!oui) return redessiner();
        await nuage.from("membres").delete().eq("projet_id", projet.id).eq("utilisateur_id", etat.moi.id);
        vuePanneau.onglet = "maquettes";
        fermer();
        await chargerProjets();
        await ouvrirProjet(etat.projets[0] ?? null);
      }),
    );
  }
  danger.append(rang);
  zone.append(danger);
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
  decouvrir: SVG('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>'),
  installer: SVG('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/>'),
  notifications: SVG('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  admin: SVG('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z"/>'),
  projets: SVG('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>'),
  versions: SVG('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  taille: SVG('<circle cx="9" cy="4.5" r="2"/><path d="M9 8v6m0 0-2.5 6M9 14l2.5 6M5.5 10.5h7"/><path d="M18 3v18M16.5 4.5h3M16.5 19.5h3"/>'),
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
  item("", ICONES_MENU.projets, "Mes projets", ouvrirMesProjets);
  item("", ICONES_MENU.decouvrir, "Découvrir NexBim", ouvrirAccueil);
  if (!appliInstallee()) item("", ICONES_MENU.installer, "Installer l'appli", () => void installer());
  item("", ICONES_MENU.notifications, "Notifications", ouvrirNotifications);
  item("", ICONES_MENU.versions, "Versions et mises à jour", () => ouvrirVersions());
  item(
    "",
    ICONES_MENU.taille,
    etat.moi.taille ? `Ma taille · ${(etat.moi.taille / 100).toFixed(2).replace(".", ",")} m` : "Ma taille (visite)",
    ouvrirTaille,
  );
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

/** Notifications sur cet appareil : état, activer / désactiver, essai. */
async function ouvrirNotifications() {
  const corps = ouvrirFenetre("Notifications");
  const e = await etatNotifications();
  corps.append(
    cree(
      "p",
      "modale-aide",
      "Une notification sur cet appareil quand une maquette est déposée dans l'un de vos projets ou quand un invité rejoint votre projet. Jamais de publicité.",
    ),
  );
  if (e === "on") {
    corps.append(
      cree("p", "modale-info", "🔔 Activées sur cet appareil."),
      bouton("btn", "Envoyer une notification d'essai", () => {
        void appeler("notifications", { action: "tester" });
        alerte("Notification d'essai envoyée.");
      }),
      bouton("btn", "Désactiver sur cet appareil", async () => {
        await desactiverNotifications();
        fermer();
      }),
    );
  } else if (e === "nosup") {
    corps.append(
      cree(
        "p",
        "modale-info",
        appareil.ios()
          ? "Sur iPhone et iPad : installez d'abord NexBim sur l'écran d'accueil, ouvrez-le depuis son icône, puis revenez ici."
          : "Ce navigateur ne permet pas les notifications. Essayez Chrome, Edge ou Safari.",
      ),
    );
    if (appareil.ios() && !appliInstallee()) corps.append(bouton("btn principal", "Installer l'appli", () => (fermer(), void installer())));
  } else {
    corps.append(
      bouton("btn principal", e === "refuse" ? "Débloquer les notifications" : "Activer les notifications", async () => {
        fermer();
        await activerNotifications();
      }),
    );
  }
}

/** Taille de la personne : place la vue à hauteur du téléphone dans la visite. */
function ouvrirTaille() {
  const corps = ouvrirFenetre("Ma taille");
  corps.append(
    cree(
      "p",
      "modale-aide",
      "En visite à la première personne, la vue se place à la hauteur du téléphone tenu en main : votre taille moins 30 cm. Sans taille : 1,40 m.",
    ),
  );
  const f = formulaire("Taille en cm, ex. 175", "Enregistrer", "number", async (v) => {
    const cm = Math.round(Number(v));
    if (!(cm >= 100 && cm <= 230)) return "Indiquez une taille entre 100 et 230 cm.";
    const { error } = await nuage.from("profils").update({ taille_cm: cm }).eq("id", etat.moi.id);
    if (error) throw error;
    etat.moi.taille = cm;
    fermer();
    alerte(`Taille enregistrée : la vue de la visite sera à ${hauteurTelephone().toFixed(2).replace(".", ",")} m.`, 4000);
  });
  const champ = f.querySelector("input")!;
  champ.min = "100";
  champ.max = "230";
  champ.inputMode = "numeric";
  if (etat.moi.taille) champ.value = String(etat.moi.taille);
  corps.append(f);
  if (etat.moi.taille) {
    corps.append(
      bouton("lien", "Revenir à 1,40 m (sans taille)", async () => {
        const { error } = await nuage.from("profils").update({ taille_cm: null }).eq("id", etat.moi.id);
        if (error) return alerte("L'enregistrement a échoué. Réessayez.");
        etat.moi.taille = null;
        fermer();
      }),
    );
  }
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
  en_ligne_le: string | null;
  en_ligne_debut: string | null;
  en_ligne_lieu: string | null;
  en_ligne_detail: string | null;
  appareils: Record<string, string> | null;
  installe_le: string | null;
  push_etat: string | null;
  abonnements: number;
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
  const { data, error } = await nuage.rpc("admin_comptes_presence");
  if (error) {
    corps.replaceChildren(cree("p", "modale-aide", "Accès refusé."));
    return;
  }
  const comptes = (data ?? []) as Compte[];
  const demandes = comptes.filter((x) => x.ia_demande && !x.ia_actif).length;
  const somme = (c: (x: Compte) => number) => comptes.reduce((s, x) => s + Number(c(x)), 0);
  const enLigne = comptes.filter(estEnLigne);
  const chiffres = cree("div", "admin-chiffres");
  for (const [valeur, nom, classe] of [
    [String(enLigne.length), "en ligne", enLigne.length ? "vert" : ""],
    [String(comptes.length), "inscrits", ""],
    [String(comptes.filter((x) => x.installe_le).length), "appli installée", ""],
    [String(comptes.filter((x) => x.push_etat === "on").length), "notifications", ""],
    [String(somme((x) => x.projets)), "projets", ""],
    [String(somme((x) => x.maquettes)), "maquettes", ""],
    [taille(somme((x) => x.octets)), "stockage", ""],
    [String(demandes), "demandes IA", ""],
  ]) {
    const c = cree("div", "admin-chiffre" + (classe ? ` ${classe}` : ""));
    c.append(cree("strong", "", valeur), cree("span", "", nom));
    chiffres.append(c);
  }

  // Notifications de l'administrateur : être prévenu des arrivées, écrire à tous.
  const notifs = cree("div", "admin-notifs");
  const { data: reglage } = await nuage.from("reglages_app").select("valeur").eq("cle", "alertes_admin").maybeSingle();
  const alertes = { arrivee: false, ...((reglage?.valeur ?? {}) as { arrivee?: boolean }) };
  const caseArrivee = cree("label", "admin-case");
  const coche = cree("input");
  coche.type = "checkbox";
  coche.checked = alertes.arrivee === true;
  coche.addEventListener("change", async () => {
    const { error: e } = await nuage
      .from("reglages_app")
      .upsert({ cle: "alertes_admin", valeur: { ...alertes, arrivee: coche.checked }, maj_le: new Date().toISOString() });
    if (e) {
      coche.checked = !coche.checked;
      return alerte(messageErreur(e));
    }
    alertes.arrivee = coche.checked;
    if (coche.checked && (await etatNotifications()) !== "on") await activerNotifications();
  });
  caseArrivee.append(coche, document.createTextNode("Me notifier quand quelqu'un ouvre NexBim"));
  notifs.append(
    caseArrivee,
    bouton("btn", "Notifier tout le monde", () => ecrireNotification(null, comptes.filter((x) => x.abonnements > 0).length)),
  );

  const table = cree("table", "admin-table");
  const tete = cree("tr");
  for (const t of ["", "Prénom", "E-mail", "Inscrit", "Vu", "Appareils", "Appli", "Notif", "Projets", "Invité", "Maquettes", "Stockage", "IA"])
    tete.append(cree("th", "", t));
  table.append(tete);
  const lignes: HTMLTableRowElement[] = [];
  for (const c of comptes) {
    const tr = cree("tr");
    const point = cree("td", "admin-presence");
    point.append(cree("span", "admin-point" + (estEnLigne(c) ? " en-ligne" : "")));
    point.title = estEnLigne(c)
      ? `En ligne depuis ${depuis(c.en_ligne_debut)}${c.en_ligne_lieu ? ` · ${LIEUX[c.en_ligne_lieu] ?? c.en_ligne_lieu}` : ""}${c.en_ligne_detail ? ` · ${c.en_ligne_detail}` : ""}`
      : c.en_ligne_le
        ? `Vu ${depuis(c.en_ligne_le)}`
        : "Jamais vu depuis le suivi";
    tr.append(point);
    for (const v of [c.prenom || "—", c.email + (c.confirme ? "" : " (non confirmé)"), jour(c.inscrit_le)]) tr.append(cree("td", "", v));
    const vu = cree("td", "", estEnLigne(c) ? "maintenant" : c.en_ligne_le ? depuis(c.en_ligne_le) : jour(c.derniere_connexion));
    if (estEnLigne(c) && c.en_ligne_detail) vu.title = c.en_ligne_detail;
    tr.append(vu, cree("td", "admin-appareils", iconesAppareils(c.appareils)));
    tr.append(cree("td", "", c.installe_le ? "📲" : "—"));
    const notif = cree("td", "admin-notif");
    notif.append(
      cree("span", "", c.push_etat === "on" && c.abonnements ? "🔔" : c.push_etat === "refuse" ? "🔕" : "—"),
    );
    if (c.abonnements > 0)
      notif.append(bouton("lien", "Écrire", () => ecrireNotification(c, 1), `Envoyer une notification à ${c.prenom || c.email}`));
    tr.append(notif);
    for (const v of [String(c.projets), String(c.invitations_recues), String(c.maquettes), Number(c.octets) ? taille(Number(c.octets)) : "—"])
      tr.append(cree("td", "", v));
    tr.append(celluleIA(c));
    tr.classList.toggle("demande-ia", !!c.ia_demande && !c.ia_actif);
    tr.classList.toggle("en-ligne", estEnLigne(c));
    table.append(tr);
    lignes.push(tr);
  }
  // Premières lignes seulement (en ligne et demandes IA en tête), puis « Tout voir ».
  const PREMIERES = 8;
  let tout = false;
  const toutVoir = bouton("btn admin-tout-voir", "", () => {
    tout = !tout;
    majLignes();
  });
  const majLignes = () => {
    lignes.forEach((l, k) => (l.hidden = !tout && k >= PREMIERES));
    toutVoir.textContent = tout ? "Réduire" : `Tout voir (${lignes.length})`;
    toutVoir.hidden = lignes.length <= PREMIERES;
  };
  majLignes();
  const defile = cree("div", "admin-defile");
  defile.append(table);
  corps.replaceChildren(chiffres, notifs, defile, toutVoir, blocReglagesPas(), bouton("btn", "Retour", () => ouvrirPanneau()));
}

const LIEUX: Record<string, string> = { visite: "en visite", maquette: "sur la maquette", projets: "dans ses projets" };
/** En ligne : signalé il y a moins de 2 min 30. */
const estEnLigne = (c: Compte) => !!c.en_ligne_le && Date.now() - new Date(c.en_ligne_le).getTime() < 150_000;
function depuis(d: string | null) {
  if (!d) return "—";
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return new Date(d).toLocaleDateString("fr-FR");
}
const NOMS_APPAREILS: Record<string, string> = {
  "ios:tel": "📱 iPhone",
  "ios:tab": "📱 iPad",
  "android:tel": "📱 Android",
  "android:tab": "📱 Tablette Android",
  "mac:ordi": "💻 Mac",
  "windows:ordi": "💻 PC",
  "linux:ordi": "💻 Linux",
  "autre:ordi": "💻 Ordinateur",
};
function iconesAppareils(a: Record<string, string> | null) {
  const cles = Object.keys(a ?? {}).sort((x, y) => new Date(a![y]).getTime() - new Date(a![x]).getTime());
  return cles.length ? cles.map((k) => (NOMS_APPAREILS[k] ?? k).split(" ")[0]).join(" ") : "—";
}

/** Notification écrite par l'administrateur, à une personne ou à tous ceux qui les ont activées. */
function ecrireNotification(c: Compte | null, n: number) {
  const corps = ouvrirFenetre(c ? `Notifier ${c.prenom || c.email}` : "Notifier tout le monde");
  if (!n) {
    corps.append(cree("p", "modale-aide", "Personne n'a encore activé les notifications."));
    return;
  }
  corps.append(cree("p", "modale-aide", c ? "Sur tous ses appareils où les notifications sont activées." : `${n} personne${n > 1 ? "s" : ""} avec les notifications activées.`));
  const f = cree("form", "modale-form admin-notif-form");
  const titre = cree("input");
  titre.placeholder = "Titre (ex. Nouvelle version de NexBim)";
  titre.maxLength = 80;
  titre.required = true;
  const texte = cree("textarea");
  texte.placeholder = "Message (facultatif)";
  texte.maxLength = 240;
  texte.rows = 3;
  const ok = cree("button", "btn principal", "Envoyer");
  ok.type = "submit";
  const retour = cree("p", "modale-retour");
  f.append(titre, texte, ok, retour);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    ok.disabled = true;
    const { data: r, code } = await appeler<{ envoyes: number; echecs: number }>("notifications", {
      action: "envoyer",
      cible: c ? c.id : "tous",
      titre: titre.value,
      texte: texte.value,
    });
    ok.disabled = false;
    if (code) return void (retour.textContent = "Envoi impossible. Réessayez.");
    fermer();
    alerte(r?.envoyes ? `Notification envoyée sur ${r.envoyes} appareil${r.envoyes > 1 ? "s" : ""}.` : "Aucun appareil joignable.", 4000);
  });
  corps.append(f);
  titre.focus();
}
