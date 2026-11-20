// Textes de tous les e-mails NexBim, par langue.
//
// C'est le seul fichier à modifier pour changer une phrase. Pour ajouter une langue :
// copier le bloc « fr », le traduire, et ajouter son code dans `LANGUES`.
//
// Repères dans les textes :
//   {inviteur}  prénom (ou e-mail) de la personne qui invite
//   {projet}    nom du projet
//   {email}     adresse du destinataire
//   {nouvelle}  nouvelle adresse (changement d'e-mail)
//   {jours}     durée de validité d'une invitation
//   **texte**   mis en gras
// Les valeurs sont toujours échappées : on peut les écrire telles quelles.

export const LANGUES = ["fr", "en"] as const;
export type Langue = (typeof LANGUES)[number];
export const LANGUE_PAR_DEFAUT: Langue = "fr";

/** Langue reconnue, sinon le français. */
export const langue = (l: unknown): Langue =>
  (LANGUES as readonly string[]).includes(String(l)) ? (l as Langue) : LANGUE_PAR_DEFAUT;

export type TypeCourriel =
  | "invitation" // invitation dans un projet, sans compte
  | "ajout" // ajout dans un projet, compte existant
  | "confirmation" // création de compte : confirmer l'adresse
  | "recuperation" // mot de passe oublié
  | "changement_email" // changement d'adresse : lien envoyé à la nouvelle adresse
  | "changement_email_ancienne" // changement d'adresse : prévenir l'ancienne adresse
  | "lien_connexion" // connexion par lien
  | "code" // code de vérification
  | "invitation_compte"; // invitation créée depuis le tableau de bord Supabase

export interface TexteCourriel {
  /** Objet de l'e-mail. */
  sujet: string;
  /** Aperçu affiché sous l'objet dans la boîte de réception. */
  apercu: string;
  /** Petite étiquette au-dessus du titre. */
  badge: string;
  titre: string;
  intro: string;
  /** Texte du bouton (absent pour le code de vérification). */
  bouton?: string;
  /** Phrase sous le bouton. */
  sousBouton?: string;
  /** Pourquoi la personne reçoit cet e-mail (pied de page). */
  raison: string;
}

export interface TextesCommuns {
  slogan: string;
  secours: string;
  contact: string;
  application: string;
  lectureSeule: string;
  atouts: string;
  codeExpire: string;
  /** Carte de l'e-mail de confirmation d'inscription. */
  bienvenueCarte: string;
  bienvenueEtiquette: string;
}

export const COMMUN: Record<Langue, TextesCommuns> = {
  fr: {
    slogan: "Maquettes BIM en ligne",
    secours: "Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :",
    contact: "Contact",
    application: "NexBim est une application PaceApp.",
    lectureSeule: "Lecture seule",
    atouts: "Vue 3D · Mesures · Coupes · Quantités",
    codeExpire: "Ce code expire dans quelques minutes.",
    bienvenueCarte: "Vos maquettes IFC en 3D",
    bienvenueEtiquette: "Nouveau compte",
  },
  en: {
    slogan: "BIM models online",
    secours: "Button not working? Copy this link into your browser:",
    contact: "Contact",
    application: "NexBim is a PaceApp application.",
    lectureSeule: "Read only",
    atouts: "3D view · Measures · Sections · Quantities",
    codeExpire: "This code expires in a few minutes.",
    bienvenueCarte: "Your IFC models in 3D",
    bienvenueEtiquette: "New account",
  },
};

export const COURRIELS: Record<Langue, Record<TypeCourriel, TexteCourriel>> = {
  fr: {
    invitation: {
      sujet: "{inviteur} vous invite sur le projet « {projet} »",
      apercu: "Consultez les maquettes 3D du projet depuis votre navigateur, sans rien installer.",
      badge: "Invitation",
      titre: "Vous êtes invité sur un projet",
      intro:
        "**{inviteur}** vous invite à consulter le projet **« {projet} »** sur NexBim. Les maquettes BIM s'ouvrent dans le navigateur, sur ordinateur comme sur téléphone, sans rien installer.",
      bouton: "Accepter l'invitation",
      sousBouton:
        "Indiquez votre prénom et choisissez un mot de passe : le projet s'ouvre aussitôt. Ce lien est personnel et valable {jours} jours.",
      raison:
        "Vous recevez cet e-mail car {inviteur} a saisi votre adresse pour vous inviter sur NexBim. Si vous ne connaissez pas cette personne, ignorez simplement ce message : aucun compte n'a été créé.",
    },
    ajout: {
      sujet: "{inviteur} a partagé le projet « {projet} » avec vous",
      apercu: "Le projet apparaît maintenant dans votre liste de projets NexBim.",
      badge: "Projet partagé",
      titre: "Un projet a été partagé avec vous",
      intro:
        "**{inviteur}** vous a ajouté au projet **« {projet} »**. Il apparaît maintenant dans votre liste de projets NexBim.",
      bouton: "Ouvrir le projet",
      sousBouton: "Connectez-vous avec votre compte habituel pour consulter ses maquettes.",
      raison: "Vous recevez cet e-mail car vous avez un compte NexBim et qu'un projet vient d'être partagé avec vous.",
    },
    confirmation: {
      sujet: "Confirmez votre adresse e-mail",
      apercu: "Un clic pour activer votre compte NexBim.",
      badge: "Inscription",
      titre: "Confirmez votre adresse e-mail",
      intro:
        "Bienvenue sur NexBim. Un clic suffit pour activer votre compte et ouvrir vos maquettes IFC en 3D, seul ou à plusieurs.",
      bouton: "Confirmer mon adresse",
      sousBouton: "Ce lien est à usage unique.",
      raison:
        "Vous recevez cet e-mail car un compte NexBim vient d'être créé avec cette adresse. Si ce n'est pas vous, ignorez simplement ce message.",
    },
    recuperation: {
      sujet: "Choisissez un nouveau mot de passe",
      apercu: "Un clic pour choisir un nouveau mot de passe NexBim.",
      badge: "Mot de passe",
      titre: "Nouveau mot de passe",
      intro: "Vous avez demandé à changer le mot de passe de votre compte NexBim. Choisissez-en un nouveau en un clic.",
      bouton: "Choisir un mot de passe",
      sousBouton: "Ce lien est à usage unique et expire rapidement.",
      raison:
        "Vous recevez cet e-mail car une demande de nouveau mot de passe a été faite pour votre compte NexBim. Si ce n'est pas vous, ignorez ce message : votre mot de passe reste inchangé.",
    },
    changement_email: {
      sujet: "Confirmez votre nouvelle adresse e-mail",
      apercu: "Confirmez le changement d'adresse de votre compte NexBim.",
      badge: "Adresse e-mail",
      titre: "Confirmez votre nouvelle adresse",
      intro: "Vous avez demandé à utiliser **{nouvelle}** pour votre compte NexBim. Confirmez ce changement en un clic.",
      bouton: "Confirmer la nouvelle adresse",
      raison:
        "Vous recevez cet e-mail car cette adresse a été indiquée pour un compte NexBim. Si ce n'est pas vous, ignorez ce message.",
    },
    changement_email_ancienne: {
      sujet: "Changement d'adresse de votre compte",
      apercu: "Une nouvelle adresse a été demandée pour votre compte NexBim.",
      badge: "Sécurité",
      titre: "Changement d'adresse demandé",
      intro:
        "Une demande a été faite pour remplacer **{email}** par **{nouvelle}** sur votre compte NexBim. Confirmez si c'est bien vous.",
      bouton: "Confirmer le changement",
      raison:
        "Vous recevez cet e-mail pour protéger votre compte NexBim. Si vous n'avez rien demandé, ne cliquez pas et changez votre mot de passe.",
    },
    lien_connexion: {
      sujet: "Votre lien de connexion",
      apercu: "Connectez-vous à NexBim en un clic.",
      badge: "Connexion",
      titre: "Votre lien de connexion",
      intro: "Connectez-vous à NexBim en un clic, sans mot de passe.",
      bouton: "Me connecter",
      sousBouton: "Ce lien est à usage unique et expire rapidement.",
      raison: "Vous recevez cet e-mail car une connexion à NexBim a été demandée avec cette adresse. Si ce n'est pas vous, ignorez ce message.",
    },
    code: {
      sujet: "Votre code de vérification",
      apercu: "Votre code de vérification NexBim.",
      badge: "Vérification",
      titre: "Votre code de vérification",
      intro: "Saisissez ce code dans NexBim pour confirmer qu'il s'agit bien de vous.",
      raison: "Vous recevez cet e-mail car un code a été demandé pour votre compte NexBim. Si ce n'est pas vous, ignorez ce message.",
    },
    invitation_compte: {
      sujet: "Vous êtes invité sur NexBim",
      apercu: "Acceptez l'invitation pour rejoindre NexBim.",
      badge: "Invitation",
      titre: "Vous êtes invité sur NexBim",
      intro: "Un compte NexBim a été préparé pour vous. Acceptez l'invitation pour choisir votre mot de passe.",
      bouton: "Accepter l'invitation",
      raison: "Vous recevez cet e-mail car un administrateur de NexBim vous a invité. Si vous n'attendiez rien, ignorez ce message.",
    },
  },

  en: {
    invitation: {
      sujet: "{inviteur} invited you to the project “{projet}”",
      apercu: "View the project's 3D models in your browser, nothing to install.",
      badge: "Invitation",
      titre: "You're invited to a project",
      intro:
        "**{inviteur}** invited you to view the project **“{projet}”** on NexBim. BIM models open in the browser, on computer or phone, nothing to install.",
      bouton: "Accept the invitation",
      sousBouton: "Enter your first name and choose a password: the project opens right away. This link is personal and valid for {jours} days.",
      raison:
        "You are receiving this email because {inviteur} entered your address to invite you to NexBim. If you don't know this person, simply ignore this message: no account has been created.",
    },
    ajout: {
      sujet: "{inviteur} shared the project “{projet}” with you",
      apercu: "The project now appears in your NexBim project list.",
      badge: "Shared project",
      titre: "A project was shared with you",
      intro: "**{inviteur}** added you to the project **“{projet}”**. It now appears in your NexBim project list.",
      bouton: "Open the project",
      sousBouton: "Sign in with your usual account to view its models.",
      raison: "You are receiving this email because you have a NexBim account and a project was just shared with you.",
    },
    confirmation: {
      sujet: "Confirm your email address",
      apercu: "One click to activate your NexBim account.",
      badge: "Sign-up",
      titre: "Confirm your email address",
      intro: "Welcome to NexBim. One click activates your account so you can open your IFC models in 3D, alone or with others.",
      bouton: "Confirm my address",
      sousBouton: "This link can be used only once.",
      raison: "You are receiving this email because a NexBim account was just created with this address. If it wasn't you, simply ignore this message.",
    },
    recuperation: {
      sujet: "Choose a new password",
      apercu: "One click to choose a new NexBim password.",
      badge: "Password",
      titre: "New password",
      intro: "You asked to change the password of your NexBim account. Choose a new one in one click.",
      bouton: "Choose a password",
      sousBouton: "This link can be used only once and expires soon.",
      raison: "You are receiving this email because a new password was requested for your NexBim account. If it wasn't you, ignore this message: your password stays the same.",
    },
    changement_email: {
      sujet: "Confirm your new email address",
      apercu: "Confirm the address change of your NexBim account.",
      badge: "Email address",
      titre: "Confirm your new address",
      intro: "You asked to use **{nouvelle}** for your NexBim account. Confirm this change in one click.",
      bouton: "Confirm the new address",
      raison: "You are receiving this email because this address was entered for a NexBim account. If it wasn't you, ignore this message.",
    },
    changement_email_ancienne: {
      sujet: "Address change on your account",
      apercu: "A new address was requested for your NexBim account.",
      badge: "Security",
      titre: "Address change requested",
      intro: "A request was made to replace **{email}** with **{nouvelle}** on your NexBim account. Confirm if it was you.",
      bouton: "Confirm the change",
      raison: "You are receiving this email to protect your NexBim account. If you didn't ask for anything, don't click and change your password.",
    },
    lien_connexion: {
      sujet: "Your sign-in link",
      apercu: "Sign in to NexBim in one click.",
      badge: "Sign-in",
      titre: "Your sign-in link",
      intro: "Sign in to NexBim in one click, without a password.",
      bouton: "Sign in",
      sousBouton: "This link can be used only once and expires soon.",
      raison: "You are receiving this email because a sign-in to NexBim was requested with this address. If it wasn't you, ignore this message.",
    },
    code: {
      sujet: "Your verification code",
      apercu: "Your NexBim verification code.",
      badge: "Verification",
      titre: "Your verification code",
      intro: "Enter this code in NexBim to confirm it's you.",
      raison: "You are receiving this email because a code was requested for your NexBim account. If it wasn't you, ignore this message.",
    },
    invitation_compte: {
      sujet: "You're invited to NexBim",
      apercu: "Accept the invitation to join NexBim.",
      badge: "Invitation",
      titre: "You're invited to NexBim",
      intro: "A NexBim account was prepared for you. Accept the invitation to choose your password.",
      bouton: "Accept the invitation",
      raison: "You are receiving this email because a NexBim administrator invited you. If you weren't expecting anything, ignore this message.",
    },
  },
};
