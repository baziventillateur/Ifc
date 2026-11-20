-- Invitations par e-mail : la personne invitée reçoit un lien personnel (valable 30 jours)
-- qui lui permet de créer son compte et d'entrer directement dans le projet.
-- Seule l'empreinte du jeton est gardée : le lien lui-même n'existe que dans l'e-mail.
alter table public.invitations
  add column jeton_hash text,
  add column expire_le timestamptz not null default now() + interval '30 days',
  add column envoye_le timestamptz not null default now();

create unique index invitations_jeton on public.invitations (jeton_hash);
