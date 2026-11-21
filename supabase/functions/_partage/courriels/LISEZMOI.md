# E-mails NexBim

Tous les e-mails de NexBim sont écrits dans ce dossier, versionnés dans GitHub, et envoyés par Resend
avec l'expéditeur `NexBim <nexbim@paceapp.fr>`, réponses vers `nexbim@paceapp.fr`. Rien n'est à coller dans le tableau de bord Supabase.

| Fichier | Rôle |
|---|---|
| `textes.ts` | **Toutes les phrases**, par langue (objet, aperçu, titre, texte, bouton, pied de page). C'est le seul fichier à modifier pour changer un texte. |
| `mise-en-page.ts` | La présentation commune (en-tête NexBim, bloc sombre, bouton orange, pied de page anti-spam). |
| `modeles.ts` | Assemble un e-mail à partir des deux fichiers précédents. |
| `envoi.ts` | Envoi par Resend (secret `RESEND_API_KEY`). |
| `../invitations.ts` | Lien personnel d'invitation et e-mails d'invitation. |

## Quels e-mails

| E-mail | Envoyé par | Quand |
|---|---|---|
| Invitation dans un projet | fonction `inviter` | la personne n'a pas encore de compte |
| Projet partagé avec vous | fonction `inviter` | la personne a déjà un compte |
| Confirmation d'inscription, mot de passe oublié, changement d'adresse, lien de connexion, code | fonction `courriels` | Supabase l'appelle (hook « Send Email ») |

## Modifier un texte

1. Changer la phrase dans `textes.ts` (les repères `{inviteur}`, `{projet}`… sont remplacés automatiquement ; `**texte**` met en gras).
2. Redéployer les fonctions `inviter` et `courriels` : automatique si le secret GitHub `SUPABASE_ACCESS_TOKEN` existe (voir `.github/workflows/fonctions.yml`), sinon demander à Claude.

## Ajouter une langue

Copier le bloc `fr` de `COMMUN` et de `COURRIELS` dans `textes.ts`, le traduire, puis ajouter le code de langue dans `LANGUES`.
La langue d'un compte est lue dans `user_metadata.langue` (français par défaut).

## Réglages côté Supabase (une seule fois)

- **Edge Functions → Secrets** : `RESEND_API_KEY` (clé Resend « Sending access » sur paceapp.fr) et `SEND_EMAIL_HOOK_SECRET`.
- **Authentication → Hooks → Send Email** : type HTTPS, adresse `https://gmirbodifgxxnsfyfuyr.supabase.co/functions/v1/courriels`, puis « Generate secret » : ce secret va dans `SEND_EMAIL_HOOK_SECRET`.
- **Authentication → URL Configuration** : Site URL `https://nexbim.paceapp.fr/`, Redirect URLs `https://nexbim.paceapp.fr/**`.

## Recevoir un exemplaire de chaque e-mail

Depuis l'éditeur SQL de Supabase (l'exemplaire part uniquement vers le compte administrateur) :

```sql
select net.http_post(
  url := 'https://gmirbodifgxxnsfyfuyr.supabase.co/functions/v1/courriels',
  body := jsonb_build_object('action', 'apercu'),
  headers := jsonb_build_object('Content-Type', 'application/json',
                                'x-cle-outil', (select cle from prive.cle_outil_courriel))
);
```
