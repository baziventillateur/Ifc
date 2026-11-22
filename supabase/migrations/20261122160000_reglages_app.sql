-- Réglages de l'appli, communs à tous les comptes et modifiés par l'administrateur
-- (panneau admin). Ex. « pas » : son des pas de la visite et volume.
create table if not exists public.reglages_app (
  cle text primary key check (cle ~ '^[a-z_]{1,40}$'),
  valeur jsonb not null check (octet_length(valeur::text) < 4000),
  maj_le timestamptz not null default now()
);

alter table public.reglages_app enable row level security;

create policy reglages_lecture on public.reglages_app
  for select to anon, authenticated using (true);
create policy reglages_admin on public.reglages_app
  for all to authenticated
  using ((select prive.est_admin())) with check ((select prive.est_admin()));

grant select on public.reglages_app to anon, authenticated;
grant insert, update, delete on public.reglages_app to authenticated;

insert into public.reglages_app (cle, valeur)
values ('pas', '{"style": "beton", "volume": 0.11}')
on conflict (cle) do nothing;
