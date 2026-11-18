// Écran de connexion : connexion, création de compte, mot de passe oublié,
// choix du mot de passe après un lien reçu par e-mail.
import type { User } from "@supabase/supabase-js";
import { cree } from "../noyau";
import { adresseSite, erreurLien, nuage, typeLien } from "./client";

type Mode = "connexion" | "inscription" | "oubli" | "motdepasse";

const porte = cree("div", "porte");
porte.hidden = true;
document.body.append(porte);

let resoudre: (u: User) => void = () => {};
let connecte = false;

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

function afficher(mode: Mode, info = "", avecPrenom = false) {
  porte.hidden = false;
  const boite = cree("form", "porte-boite");
  const marque = cree("div", "porte-marque");
  const logo = cree("img", "logo");
  logo.src = "logo.svg";
  logo.alt = "";
  marque.append(logo, cree("span", "", "NexBim"));
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
  boite.querySelector("input")?.focus();
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
      if (evenement === "SIGNED_IN" && session && !choixMotDePasse) entrer(session.user);
    });

    void nuage.auth.getSession().then(({ data }) => {
      if (window.location.hash.includes("access_token") || window.location.hash.includes("error"))
        history.replaceState(null, "", window.location.pathname + window.location.search);
      const session = data.session;
      if (session && (typeLien === "invite" || typeLien === "recovery")) {
        choixMotDePasse = true;
        afficher("motdepasse", "", typeLien === "invite");
      } else if (session) {
        entrer(session.user);
      } else {
        choixMotDePasse = false;
        afficher("connexion", erreurLien ? "Ce lien n'est plus valable. Demandez-en un nouveau." : "");
      }
    });
  });
}

export async function seDeconnecter() {
  await nuage.auth.signOut();
}
