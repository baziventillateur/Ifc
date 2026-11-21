-- Avancement du chantier : éléments marqués « réalisé » dans la visite à la première
-- personne. Un élément est repéré par son identifiant IFC (GlobalId), qui ne change pas
-- d'une version de maquette à l'autre. Le créateur du projet et les personnes invitées
-- voient et marquent l'avancement.
create table if not exists public.avancements (
  projet_id uuid not null references public.projets(id) on delete cascade,
  guid text not null check (length(guid) between 1 and 64),
  realise_par uuid default auth.uid(),
  realise_le timestamptz not null default now(),
  primary key (projet_id, guid)
);

alter table public.avancements enable row level security;

create policy avancements_lecture on public.avancements
  for select to authenticated
  using (prive.acces_projet(projet_id) or (select prive.est_admin()));

create policy avancements_marquer on public.avancements
  for insert to authenticated
  with check (prive.acces_projet(projet_id) and realise_par = (select auth.uid()));

create policy avancements_retirer on public.avancements
  for delete to authenticated
  using (prive.acces_projet(projet_id));

revoke all on public.avancements from anon;
grant select, insert, delete on public.avancements to authenticated;
