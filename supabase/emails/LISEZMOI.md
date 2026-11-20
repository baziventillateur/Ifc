# E-mails NexBim (Supabase)

Ces modèles HTML remplacent les e-mails en anglais envoyés par Supabase. Supabase ne les lit pas depuis le dépôt : il faut les coller à la main dans le tableau de bord.

## Où les coller

Supabase → **Authentication** → **Email Templates**. Pour chaque modèle : renseigne l'objet, colle le HTML dans le corps, puis **Save**.

| Modèle Supabase | Fichier | Objet proposé |
|---|---|---|
| Confirm signup | `confirmation.html` | Confirmez votre adresse NexBim |
| Invite user | `invitation.html` | Invitation à rejoindre un projet NexBim (ancien circuit, plus utilisé) |
| Reset password | `recuperation.html` | Réinitialiser votre mot de passe NexBim |
| Change email address | `changement-email.html` | Confirmez votre nouvelle adresse NexBim |

## Variables utilisées

- `{{ .ConfirmationURL }}` : lien de validation (fourni par Supabase).
- `{{ .NewEmail }}` : nouvelle adresse (changement d'e-mail uniquement).
- `{{ .Data.invite_par }}` et `{{ .Data.projet }}` : prénom de la personne qui invite et nom du projet. Elles sont envoyées par la fonction `inviter`.

## Réglage à vérifier avant

Supabase → **Authentication** → **URL Configuration** :
- **Site URL** : `https://nexbim.paceapp.fr/`
- **Redirect URLs** : `https://nexbim.paceapp.fr/**` et `https://baziventillateur.github.io/Ifc/**`

Sans cela, le lien de confirmation renvoie vers une adresse inexistante (erreur 404 constatée sur `baziventillateur.github.io`).

Le logo des e-mails est lu depuis `https://nexbim.paceapp.fr/logo/nexbim-transparent-64.png`. Il s'affiche une fois la publication du site à jour.

## Invitations dans un projet (envoyées par NexBim, pas par Supabase)

Depuis la version 1.50, les e-mails d'invitation sont envoyés par la fonction `inviter` via Resend, avec l'expéditeur `nextbeam@paceapp.fr` :
- personne sans compte : e-mail « Accepter l'invitation » avec un lien personnel valable 30 jours (`?invitation=…`), qui ouvre l'écran prénom + mot de passe puis le projet (fonction `invitation`) ;
- personne déjà inscrite : ajout immédiat et e-mail « Ouvrir le projet » (`?projet=…`).

Prérequis : le secret `RESEND_API_KEY` (clé Resend « Sending access » sur paceapp.fr) dans Supabase → Edge Functions → Secrets. Sans lui, l'invitation est enregistrée mais l'e-mail ne part pas.
