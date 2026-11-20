-- Clé de la fonction « courriel-outil » (aperçu des e-mails, renvoi d'une invitation).
-- Elle ne quitte jamais la base : seule la base l'envoie (pg_net), et la fonction la vérifie
-- par verifier_cle_outil_courriel, réservée au rôle serveur.
create table if not exists prive.cle_outil_courriel (
  id boolean primary key default true check (id),
  cle text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into prive.cle_outil_courriel default values on conflict do nothing;
revoke all on prive.cle_outil_courriel from public, anon, authenticated;

create or replace function public.verifier_cle_outil_courriel(c text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from prive.cle_outil_courriel where cle = c and length(c) = 64);
$$;
revoke all on function public.verifier_cle_outil_courriel(text) from public, anon, authenticated;
grant execute on function public.verifier_cle_outil_courriel(text) to service_role;
