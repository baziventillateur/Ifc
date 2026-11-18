// Projet dans le cloud : maquettes déposées, personnes invitées, compte, panneau admin.
import type { User } from "@supabase/supabase-js";
import { alerte, attente, bouton, cree, el } from "../noyau";
import { maquettes as affichees } from "../registre";
import { ajouterIfc, chargerExemple, exempleAffiche, ouvrirDepuisNuage, retirer } from "../maquettes";
import { adresseSite, MAQUETTES_MAX, nuage, OCTETS_MAX, OCTETS_MAX_ADMIN, taille } from "./client";
import { seDeconnecter } from "./compte";

type Projet = { id: string; nom: string; proprietaire: string };
type Fichier = { id: string; nom: string; chemin: string; taille: number; cree_le: string; supprime_le: string | null };
const CORBEILLE_JOURS = 60;
type Personne = { utilisateur_id: string | null; email: string; prenom: string; role: string };

const etat = {
  moi: { id: "", email: "", prenom: "" },
  admin: false,
  projets: [] as Projet[],
  courant: null as Projet | null,
  fichiers: [] as Fichier[],
  corbeille: [] as Fichier[],
  personnes: [] as Personne[],
};

const CLE_PROJET = "nexbim-projet";
const btnAjouter = el<HTMLButtonElement>("btn-ajouter");
const btnProjet = el<HTMLButtonElement>("btn-projet");

const createur = () => !!etat.courant && etat.courant.proprietaire === etat.moi.id;
const aSonProjet = () => etat.projets.some((p) => p.proprietaire === etat.moi.id);
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

function messageErreur(e: { message?: string; code?: string } | null) {
  const m = e?.message ?? "";
  if (m.includes("LIMITE_PROJETS")) return "Vous avez déjà un projet (un seul par compte).";
  if (m.includes("LIMITE_MAQUETTES")) return `Le projet a déjà ${MAQUETTES_MAX} maquettes (maximum).`;
  if (e?.code === "23505") return "Une maquette porte déjà ce nom dans le projet.";
  if (m.toLowerCase().includes("exceeded the maximum allowed size") || m.includes("TAILLE_MAX"))
    return etat.admin
      ? "refusé par le stockage : la limite d'envoi de Supabase (Storage → Settings) est plus basse que ce fichier."
      : `fichier trop lourd (${taille(OCTETS_MAX)} maximum).`;
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
      .select("id, nom, chemin, taille, cree_le, supprime_le")
      .eq("projet_id", etat.courant.id)
      .order("cree_le"),
    nuage.rpc("personnes_du_projet", { p: etat.courant.id }),
  ]);
  const tous = (f ?? []) as Fichier[];
  etat.fichiers = tous.filter((x) => !x.supprime_le);
  etat.corbeille = tous.filter((x) => x.supprime_le);
  etat.personnes = (p ?? []) as Personne[];
}

async function ouvrirProjet(projet: Projet | null) {
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
        date: f.cree_le,
        telecharger: async () => {
          const { data, error } = await nuage.storage.from("maquettes").download(f.chemin);
          if (error || !data) throw error ?? new Error("Téléchargement impossible");
          return new File([data], f.nom);
        },
      })),
    );
  }
  majBandeau();
}

export async function demarrerNuage(utilisateur: User) {
  etat.moi.id = utilisateur.id;
  etat.moi.email = utilisateur.email ?? "";
  const [{ data: profil }, { data: admin }] = await Promise.all([
    nuage.from("profils").select("prenom").eq("id", utilisateur.id).maybeSingle(),
    nuage.rpc("suis_je_admin"),
  ]);
  etat.moi.prenom = profil?.prenom ?? "";
  etat.admin = admin === true;
  await chargerProjets();
  let memorise: string | null = null;
  try {
    memorise = localStorage.getItem(CLE_PROJET);
  } catch {
    // Mémoire locale indisponible.
  }
  await ouvrirProjet(etat.projets.find((p) => p.id === memorise) ?? etat.projets[0] ?? null);
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
  if (depotEnCours || !demanderDepot() || !etat.courant) return;
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

  depotEnCours = true;
  try {
    // Conversion d'abord : on n'envoie dans le cloud que des fichiers lisibles.
    const lus = new Set(await ajouterIfc(retenus));
    for (const [i, f] of retenus.entries()) {
      const local = nomLocal(f.name);
      if (!lus.has(local)) continue;
      attente(`Envoi de « ${local} » (${taille(f.size)}) dans le cloud… Ne fermez pas la page.`, i / retenus.length);
      const chemin = `${projet.id}/${crypto.randomUUID()}.ifc`;
      const envoi = await nuage.storage
        .from("maquettes")
        .upload(chemin, f, { contentType: "application/octet-stream" });
      let erreur: { message?: string; code?: string } | null = envoi.error;
      if (!erreur) {
        const ligne = await nuage
          .from("maquettes")
          .insert({ projet_id: projet.id, nom: f.name, chemin, taille: f.size });
        erreur = ligne.error;
        if (erreur) await nuage.storage.from("maquettes").remove([chemin]);
      }
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

async function inviter(email: string) {
  if (!etat.courant) return;
  const { data, error } = await nuage.functions.invoke("inviter", {
    body: { projet: etat.courant.id, email, retour: adresseSite },
  });
  let resultat = data as { etat?: string; mail?: boolean; erreur?: string } | null;
  if (error) {
    try {
      resultat = await (error as { context?: Response }).context?.json();
    } catch {
      resultat = null;
    }
    const code = resultat?.erreur;
    if (code === "EMAIL") return "Adresse e-mail incorrecte.";
    if (code === "SOI_MEME") return "C'est votre propre adresse.";
    if (code === "LIMITE") return "Maximum de 20 personnes par projet atteint.";
    return "L'invitation a échoué. Réessayez.";
  }
  await chargerDetails();
  ouvrirPanneau(
    resultat?.etat === "ajoute"
      ? `${email} a déjà un compte : ajouté au projet.`
      : resultat?.mail
        ? `Invitation envoyée par e-mail à ${email}.`
        : `${email} est invité, mais l'e-mail n'a pas pu partir. Il entrera dans le projet en créant son compte.`,
  );
}

function ouvrirPanneau(info = "") {
  const corps = ouvrirFenetre("Projet");
  if (info) corps.append(cree("p", "modale-info", info));

  if (!etat.courant || !aSonProjet()) {
    corps.append(
      section("Créer mon projet"),
      cree("p", "modale-aide", `Un projet regroupe jusqu'à ${MAQUETTES_MAX} maquettes IFC (50 Mo chacune) et les personnes que vous invitez.`),
      formulaire("Nom du projet", "Créer", "text", async (nom) => {
        const { data, error } = await nuage.from("projets").insert({ nom }).select("id, nom, proprietaire").single();
        if (error || !data) return messageErreur(error);
        etat.projets.push(data as Projet);
        fermer();
        await ouvrirProjet(data as Projet);
        ouvrirPanneau("Projet créé. Déposez votre première maquette.");
      }),
    );
  }

  const projet = etat.courant;
  if (projet) {
    if (etat.projets.length > 1) {
      const choix = cree("select", "modale-choix");
      for (const p of etat.projets) {
        const o = cree("option", "", p.nom + (p.proprietaire === etat.moi.id ? "" : " (invité)"));
        o.value = p.id;
        o.selected = p.id === projet.id;
        choix.append(o);
      }
      choix.addEventListener("change", () => {
        const p = etat.projets.find((x) => x.id === choix.value);
        fermer();
        if (p) void ouvrirProjet(p);
      });
      corps.append(section("Projet affiché"), choix);
    }

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
              await nuage.storage.from("maquettes").remove([f.chemin]);
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

    corps.append(section("Personnes"));
    for (const p of etat.personnes) {
      const role = p.role === "createur" ? "Créateur" : p.role === "invite" ? "Invité · lecture seule" : "Invitation en attente";
      const retrait =
        createur() && p.role !== "createur"
          ? bouton("lien danger", "Retirer", async () => {
              const requete =
                p.role === "invite"
                  ? nuage.from("membres").delete().eq("projet_id", projet.id).eq("utilisateur_id", p.utilisateur_id)
                  : nuage.from("invitations").delete().eq("projet_id", projet.id).eq("email", p.email);
              const { error } = await requete;
              if (error) return alerte(messageErreur(error));
              await chargerDetails();
              ouvrirPanneau();
            })
          : undefined;
      corps.append(ligne(p.prenom || p.email, p.prenom ? `${p.email} · ${role}` : role, retrait));
    }
    if (createur()) {
      corps.append(formulaire("E-mail de la personne à inviter", "Inviter", "email", inviter));
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
            const chemins = [...etat.fichiers, ...etat.corbeille].map((f) => f.chemin);
            if (chemins.length) await nuage.storage.from("maquettes").remove(chemins);
            const { error } = await nuage.from("projets").delete().eq("id", projet.id);
            if (error) return alerte(messageErreur(error));
            fermer();
            await chargerProjets();
            await ouvrirProjet(etat.projets[0] ?? null);
          })
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

  corps.append(section("Compte"), ligne(etat.moi.prenom || etat.moi.email, etat.moi.prenom ? etat.moi.email : ""));
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
  if (etat.admin) pied.append(bouton("btn", "Panneau admin", () => void ouvrirAdmin()));
  pied.append(bouton("btn", "Se déconnecter", () => void seDeconnecter()));
  const signature = cree("a", "signature", "NexBim · une application PaceApp");
  signature.href = "https://paceapp.fr";
  signature.target = "_blank";
  signature.rel = "noopener";
  corps.append(pied, signature);
}

btnProjet.addEventListener("click", () => ouvrirPanneau());

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
