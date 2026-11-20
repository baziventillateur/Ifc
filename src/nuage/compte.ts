// Écran de connexion : connexion, création de compte, mot de passe oublié,
// choix du mot de passe après un lien reçu par e-mail.
import type { User } from "@supabase/supabase-js";
import { cree } from "../noyau";
import { adresseSite, appeler, demanderProjet, erreurLien, jetonInvitation, nuage, typeLien } from "./client";

type Mode = "connexion" | "inscription" | "oubli" | "motdepasse";

const porte = cree("div", "porte");
porte.hidden = true;
document.body.append(porte);

let resoudre: (u: User) => void = () => {};
let connecte = false;
/** Écran d'invitation affiché : la session éventuelle ne fait pas entrer d'elle-même. */
let enInvitation = !!jetonInvitation;

type InfosInvitation = { email: string; projet: string; projet_id: string; invite_par: string; compte: boolean };

const SVG_MAQUETTE = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aperçu d'une maquette 3D" font-family="system-ui, sans-serif">
<defs>
<pattern id="grille" width="20" height="20" patternUnits="userSpaceOnUse">
<path d="M20 0H0V20" fill="none" stroke="#2c3747" stroke-width="1"/>
</pattern>
</defs>
<rect width="400" height="280" fill="url(#grille)"/>
<ellipse cx="200" cy="262" rx="132" ry="20" fill="#000" opacity=".35"/>
<path d="M200 50 L290 95 L200 140 L110 95 Z" fill="#4a5566"/>
<path d="M110 95 L200 140 L200 260 L110 215 Z" fill="#363f4e"/>
<path d="M200 140 L290 95 L290 215 L200 260 Z" fill="#2a3240"/>
<g fill="#131a24">
<g transform="matrix(90 -45 0 1 200 140)">
<rect x=".15" y="8" width=".25" height="22"/><rect x=".55" y="8" width=".25" height="22"/>
<rect x=".15" y="48" width=".25" height="22"/><rect x=".55" y="48" width=".25" height="22"/>
<rect x=".15" y="88" width=".25" height="22"/><rect x=".55" y="88" width=".25" height="22"/>
</g>
<g transform="matrix(90 45 0 1 110 95)">
<rect x=".15" y="8" width=".25" height="22"/><rect x=".55" y="8" width=".25" height="22"/>
<rect x=".15" y="48" width=".25" height="22"/><rect x=".55" y="48" width=".25" height="22"/>
<rect x=".15" y="88" width=".25" height="22"/><rect x=".55" y="88" width=".25" height="22"/>
</g>
</g>
<g fill="none" stroke="#ff8a1f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
<path d="M200 50 L290 95 L200 140 L110 95 Z"/>
<path d="M110 95 V215 L200 260 V140"/>
<path d="M290 95 V215 L200 260"/>
</g>
<g fill="none" stroke="#ff8a1f" stroke-width="1" opacity=".55">
<path d="M110 135 L200 180 L290 135"/>
<path d="M110 175 L200 220 L290 175"/>
</g>
<path d="M83 54 L110 95" stroke="#ff8a1f" stroke-width="1" stroke-dasharray="3 3"/>
<rect x="24" y="28" width="118" height="26" rx="13" fill="#ff8a1f"/>
<text x="83" y="45" text-anchor="middle" font-size="11" font-weight="600" fill="#1a1206">Mesure 12,40 m</text>
<rect x="262" y="236" width="112" height="24" rx="12" fill="#2a3240" stroke="#ff8a1f" stroke-width="1"/>
<text x="318" y="252" text-anchor="middle" font-size="11" fill="#e6ebf1">Clash détecté</text>
</svg>`;

/** Marque NexBim avec la mention « by PaceApp » dessous. */
function marqueNexBim() {
  const marque = cree("div", "porte-marque");
  const logo = cree("img", "logo");
  logo.src = "logo.svg";
  logo.alt = "";
  const nom = cree("div", "marque-texte");
  nom.append(cree("span", "marque-nom", "NexBim"), cree("span", "marque-par", "by PaceApp"));
  marque.append(logo, nom);
  return marque;
}

/** Page d'accueil : présentation de l'application, avec accès à la connexion. */
function accueil() {
  porte.hidden = false;
  porte.classList.add("porte-accueil");

  const page = cree("div", "accueil");

  const haut = cree("header", "accueil-haut");
  const marque = marqueNexBim();
  marque.classList.add("accueil-marque");
  const connexion = cree("button", "btn accueil-connexion", "Se connecter");
  connexion.type = "button";
  connexion.addEventListener("click", () => afficher("connexion"));
  haut.append(marque, connexion);

  const hero = cree("section", "accueil-hero");
  const texte = cree("div", "accueil-texte");
  const demarrer = cree("button", "btn principal accueil-demarrer", "Démarrer tout de suite");
  demarrer.type = "button";
  demarrer.addEventListener("click", () => afficher("connexion"));
  texte.append(
    cree("p", "accueil-etiquette", "Visionneuse IFC en ligne"),
    cree("h1", "accueil-titre", "Vos maquettes BIM, ouvertes et partagées en un clic"),
    cree(
      "p",
      "accueil-sous",
      "Consultez vos fichiers IFC dans le navigateur, sans logiciel à installer. Mesurez, coupez, comptez les quantités et invitez vos équipes en lecture seule.",
    ),
    demarrer,
  );
  const image = cree("div", "accueil-image");
  image.innerHTML = SVG_MAQUETTE;
  hero.append(texte, image);

  const atouts = cree("ul", "accueil-atouts");
  const items: [string, string][] = [
    ["Ouvrir", "Déposez plusieurs maquettes et affichez-les superposées, jusqu'à 50 Mo chacune."],
    ["Analyser", "Mesures, coupes, quantités, détection des clashs et arêtes colorées pour lire les volumes."],
    ["Partager", "Invitez vos équipes par e-mail, en lecture seule, sur un projet commun."],
  ];
  for (const [titre, description] of items) {
    const li = cree("li", "accueil-atout");
    li.append(cree("h2", "", titre), cree("p", "", description));
    atouts.append(li);
  }

  const pied = cree("footer", "accueil-pied");
  const paceapp = cree("a", "", "Une application PaceApp");
  paceapp.href = "https://paceapp.fr";
  paceapp.target = "_blank";
  paceapp.rel = "noopener";
  pied.append(cree("span", "", "NexBim · by PaceApp"), paceapp);

  page.append(haut, hero, atouts, pied);
  porte.replaceChildren(page);
}

function champ(libelle: string, type: string, nom: string, auto: string) {
  const bloc = cree("label", "porte-champ");
  const saisie = cree("input");
  saisie.type = type;
  saisie.name = nom;
  saisie.autocomplete = auto as AutoFill;
  saisie.required = true;
  if (type === "password") saisie.minLength = 8;
  if (nom === "prenom") saisie.maxLength = 60;
  bloc.append(cree("span", "", libelle), saisie);
  return { bloc, saisie };
}

function traduire(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect.";
  if (m.includes("not confirmed")) return "Adresse non confirmée : cliquez sur le lien reçu par e-mail.";
  if (m.includes("rate limit") || m.includes("security purposes"))
    return "Trop de demandes. Réessayez dans une minute.";
  if (m.includes("already registered")) return "Un compte existe déjà avec cet e-mail.";
  if (m.includes("password")) return "Mot de passe refusé : 8 caractères au minimum.";
  if (m.includes("failed to fetch")) return "Connexion au serveur impossible.";
  return "Une erreur est survenue. Réessayez.";
}

function afficher(mode: Mode, info = "", avecPrenom = false, emailInitial = "") {
  porte.hidden = false;
  porte.classList.remove("porte-accueil");
  const boite = cree("form", "porte-boite");
  const marque = marqueNexBim();
  if (mode === "connexion") {
    const retour = cree("button", "lien accueil-retour", "← Accueil");
    retour.type = "button";
    retour.addEventListener("click", accueil);
    marque.append(retour);
  }
  const titres: Record<Mode, string> = {
    connexion: "Connexion",
    inscription: "Créer un compte",
    oubli: "Mot de passe oublié",
    motdepasse: "Choisissez votre mot de passe",
  };
  boite.append(marque, cree("h1", "porte-titre", titres[mode]));

  const message = cree("p", "porte-message", info);
  const prenom = champ("Prénom", "text", "prenom", "given-name");
  const email = champ("E-mail", "email", "email", "email");
  email.saisie.value = emailInitial;
  const passe = champ(
    mode === "connexion" ? "Mot de passe" : "Mot de passe (8 caractères min.)",
    "password",
    "password",
    mode === "connexion" ? "current-password" : "new-password",
  );
  if (mode === "inscription" || (mode === "motdepasse" && avecPrenom)) boite.append(prenom.bloc);
  if (mode !== "motdepasse") boite.append(email.bloc);
  if (mode !== "oubli") boite.append(passe.bloc);

  const libelles: Record<Mode, string> = {
    connexion: "Se connecter",
    inscription: "Créer mon compte",
    oubli: "Recevoir le lien",
    motdepasse: "Valider",
  };
  const valider = cree("button", "btn principal porte-valider", libelles[mode]);
  valider.type = "submit";
  boite.append(message, valider);

  const liens = cree("div", "porte-liens");
  const lien = (texte: string, vers: Mode) => {
    const b = cree("button", "lien", texte);
    b.type = "button";
    b.addEventListener("click", () => afficher(vers));
    liens.append(b);
  };
  if (mode === "connexion") {
    lien("Créer un compte", "inscription");
    lien("Mot de passe oublié", "oubli");
  } else if (mode !== "motdepasse") {
    lien("J'ai déjà un compte", "connexion");
  }
  boite.append(liens);
  const signature = cree("a", "signature", "Une application PaceApp");
  signature.href = "https://paceapp.fr";
  signature.target = "_blank";
  signature.rel = "noopener";
  boite.append(signature);

  boite.addEventListener("submit", async (e) => {
    e.preventDefault();
    valider.disabled = true;
    message.classList.remove("ok");
    message.textContent = "…";
    const dire = (texte: string, ok = false) => {
      message.textContent = texte;
      message.classList.toggle("ok", ok);
    };
    try {
      if (mode === "connexion") {
        const { error } = await nuage.auth.signInWithPassword({
          email: email.saisie.value.trim(),
          password: passe.saisie.value,
        });
        if (error) dire(traduire(error.message));
      } else if (mode === "inscription") {
        const { data, error } = await nuage.auth.signUp({
          email: email.saisie.value.trim(),
          password: passe.saisie.value,
          options: { data: { prenom: prenom.saisie.value.trim() }, emailRedirectTo: adresseSite },
        });
        if (error) dire(traduire(error.message));
        else if (data.user && data.user.identities?.length === 0)
          dire("Un compte existe déjà avec cet e-mail.");
        else if (!data.session)
          dire("Un e-mail vient de vous être envoyé : cliquez sur le lien pour activer votre compte.", true);
      } else if (mode === "oubli") {
        const { error } = await nuage.auth.resetPasswordForEmail(email.saisie.value.trim(), {
          redirectTo: adresseSite,
        });
        if (error) dire(traduire(error.message));
        else dire("Si un compte existe, un e-mail vient d'être envoyé.", true);
      } else {
        const p = prenom.saisie.value.trim();
        const { data, error } = await nuage.auth.updateUser({
          password: passe.saisie.value,
          ...(avecPrenom ? { data: { prenom: p } } : {}),
        });
        if (error) dire(traduire(error.message));
        else if (data.user) {
          if (avecPrenom) await nuage.from("profils").update({ prenom: p }).eq("id", data.user.id);
          entrer(data.user);
        }
      }
    } catch (err) {
      console.error(err);
      dire("Connexion au serveur impossible.");
    } finally {
      valider.disabled = false;
    }
  });

  porte.replaceChildren(boite);
  (emailInitial ? passe.saisie : boite.querySelector("input"))?.focus();
}

/** Arrivée par le lien d'invitation reçu par e-mail : prénom et mot de passe, puis le projet. */
function ecranInvitation(infos: InfosInvitation, jeton: string, autreSession: boolean) {
  porte.hidden = false;
  porte.classList.remove("porte-accueil");
  const boite = cree("form", "porte-boite");
  boite.append(marqueNexBim(), cree("h1", "porte-titre", "Vous êtes invité"));

  const intro = cree("p", "porte-intro");
  if (infos.invite_par) intro.append(cree("strong", "", infos.invite_par), " vous invite sur le projet ");
  else intro.append("Vous êtes invité sur le projet ");
  intro.append(cree("strong", "", `« ${infos.projet} »`), ", en lecture seule.");
  boite.append(intro);

  const adresse = cree("p", "porte-adresse");
  adresse.append(cree("span", "", "Votre adresse"), cree("strong", "", infos.email));
  boite.append(adresse);

  const message = cree("p", "porte-message");
  const verConnexion = (info: string) => {
    enInvitation = false;
    demanderProjet(infos.projet_id);
    afficher("connexion", info, false, infos.email);
  };

  if (infos.compte) {
    const ok = cree("button", "btn principal porte-valider", "Se connecter pour ouvrir le projet");
    ok.type = "button";
    ok.addEventListener("click", () => verConnexion("Vous avez déjà un compte : connectez-vous pour ouvrir le projet."));
    boite.append(message, ok);
  } else {
    boite.append(cree("p", "porte-aide", "Indiquez votre prénom et choisissez un mot de passe pour créer votre compte."));
    const prenom = champ("Prénom", "text", "prenom", "given-name");
    const passe = champ("Mot de passe (8 caractères min.)", "password", "password", "new-password");
    const valider = cree("button", "btn principal porte-valider", "Accepter et ouvrir le projet");
    valider.type = "submit";
    boite.append(prenom.bloc, passe.bloc, message, valider);
    const liens = cree("div", "porte-liens");
    const deja = cree("button", "lien", "J'ai déjà un compte");
    deja.type = "button";
    deja.addEventListener("click", () => verConnexion(""));
    liens.append(deja);
    boite.append(liens);

    boite.addEventListener("submit", async (e) => {
      e.preventDefault();
      valider.disabled = true;
      message.classList.remove("ok");
      message.textContent = "…";
      try {
        const motdepasse = passe.saisie.value;
        const { code } = await appeler<{ ok: boolean }>("invitation", {
          action: "accepter",
          jeton,
          prenom: prenom.saisie.value.trim(),
          motdepasse,
        });
        if (code === "DEJA_INSCRIT") return verConnexion("Vous avez déjà un compte : connectez-vous pour ouvrir le projet.");
        if (code === "INVALIDE")
          return verConnexion("Cette invitation n'est plus valable. Demandez à la personne qui vous a invité de vous la renvoyer.");
        if (code === "MOT_DE_PASSE") return void (message.textContent = "Mot de passe refusé : 8 caractères au minimum.");
        if (code === "PRENOM") return void (message.textContent = "Indiquez votre prénom.");
        if (code) return void (message.textContent = "La création du compte a échoué. Réessayez.");
        // Compte créé : on entre directement dans le projet.
        demanderProjet(infos.projet_id);
        if (autreSession) await nuage.auth.signOut({ scope: "local" });
        enInvitation = false;
        const { error } = await nuage.auth.signInWithPassword({ email: infos.email, password: motdepasse });
        if (error) verConnexion("Compte créé. Connectez-vous avec votre mot de passe.");
      } catch (err) {
        console.error(err);
        message.textContent = "Connexion au serveur impossible.";
      } finally {
        valider.disabled = false;
      }
    });
  }

  const signature = cree("a", "signature", "Une application PaceApp");
  signature.href = "https://paceapp.fr";
  signature.target = "_blank";
  signature.rel = "noopener";
  boite.append(signature);
  porte.replaceChildren(boite);
  boite.querySelector<HTMLInputElement>("input")?.focus();
}

function entrer(u: User) {
  if (connecte) return;
  connecte = true;
  porte.hidden = true;
  porte.replaceChildren();
  resoudre(u);
}

/** Rend la main une fois la personne connectée. */
export function attendreSession(): Promise<User> {
  return new Promise((ok) => {
    resoudre = ok;
    // Arrivée par un lien d'invitation ou de réinitialisation : le mot de passe d'abord.
    let choixMotDePasse = typeLien === "invite" || typeLien === "recovery";

    nuage.auth.onAuthStateChange((evenement, session) => {
      if (evenement === "SIGNED_OUT") {
        if (connecte) window.location.reload();
        return;
      }
      if (evenement === "PASSWORD_RECOVERY") {
        choixMotDePasse = true;
        afficher("motdepasse");
        return;
      }
      if (evenement === "SIGNED_IN" && session && !choixMotDePasse && !enInvitation) entrer(session.user);
    });

    void nuage.auth.getSession().then(async ({ data }) => {
      if (window.location.hash.includes("access_token") || window.location.hash.includes("error"))
        history.replaceState(null, "", window.location.pathname + window.location.search);
      const session = data.session;
      if (jetonInvitation) {
        const { data: infos, code } = await appeler<InfosInvitation>("invitation", {
          action: "lire",
          jeton: jetonInvitation,
        });
        if (!code && infos?.email) {
          if (session && (session.user.email ?? "").toLowerCase() === infos.email) {
            // Déjà connecté avec la bonne adresse : on ouvre le projet.
            enInvitation = false;
            demanderProjet(infos.projet_id);
            entrer(session.user);
          } else {
            ecranInvitation(infos, jetonInvitation, !!session);
          }
          return;
        }
        enInvitation = false;
        if (session) entrer(session.user);
        else
          afficher(
            "connexion",
            code === "INVALIDE"
              ? "Cette invitation a déjà servi ou n'est plus valable. Si vous avez créé votre compte, connectez-vous ; sinon, demandez qu'on vous la renvoie."
              : "Connexion au serveur impossible. Réessayez.",
          );
        return;
      }
      if (session && (typeLien === "invite" || typeLien === "recovery")) {
        choixMotDePasse = true;
        afficher("motdepasse", "", typeLien === "invite");
      } else if (session) {
        entrer(session.user);
      } else {
        choixMotDePasse = false;
        if (erreurLien) afficher("connexion", "Ce lien n'est plus valable. Demandez-en un nouveau.");
        else accueil();
      }
    });
  });
}

export async function seDeconnecter() {
  await nuage.auth.signOut();
}
