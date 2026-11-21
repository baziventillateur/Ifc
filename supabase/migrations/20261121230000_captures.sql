-- Captures d'écran annotées, rangées dans le projet : message, statut « à traiter » /
-- « traité », point de vue pour y revenir. Image et vignette dans le seau « captures »
-- (chemin : <projet>/<capture>.jpg et <projet>/<capture>_v.jpg). Le créateur du projet et
-- les personnes invitées les voient, les annotent et changent leur statut.
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  auteur uuid default auth.uid(),
  auteur_nom text not null default '' check (length(auteur_nom) <= 80),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  message text not null default '' check (length(message) <= 2000),
  statut text not null default 'a_traiter' check (statut in ('a_traiter', 'traite')),
  vue jsonb,
  largeur int,
  hauteur int
);
create index if not exists captures_projet on public.captures (projet_id, cree_le desc);

alter table public.captures enable row level security;

create policy captures_lecture on public.captures
  for select to authenticated
  using (prive.acces_projet(projet_id) or (select prive.est_admin()));

create policy captures_creation on public.captures
  for insert to authenticated
  with check (prive.acces_projet(projet_id) and auteur = (select auth.uid()));

create policy captures_maj on public.captures
  for update to authenticated
  using (prive.acces_projet(projet_id))
  with check (prive.acces_projet(projet_id));

-- Supprimer : l'auteur de la capture ou le créateur du projet.
create policy captures_suppression on public.captures
  for delete to authenticated
  using (auteur = (select auth.uid()) or prive.est_proprietaire(projet_id));

revoke all on public.captures from anon;
grant select, insert, delete on public.captures to authenticated;
grant update (message, statut, maj_le, largeur, hauteur) on public.captures to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy captures_fichiers_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (prive.acces_projet(prive.projet_du_chemin(name)) or (select prive.est_admin())));

create policy captures_fichiers_depot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and prive.acces_projet(prive.projet_du_chemin(name)));

create policy captures_fichiers_maj on storage.objects
  for update to authenticated
  using (bucket_id = 'captures' and prive.acces_projet(prive.projet_du_chemin(name)))
  with check (bucket_id = 'captures' and prive.acces_projet(prive.projet_du_chemin(name)));

create policy captures_fichiers_suppression on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and prive.acces_projet(prive.projet_du_chemin(name)));
