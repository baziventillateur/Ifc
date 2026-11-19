-- Mode Modifier : déplacements d'éléments enregistrés dans le projet, à part des
-- maquettes (qui ne sont jamais modifiées). Une ligne par projet :
-- { "<maquette>": { "<identifiant IFC>": [x, y, z] en mètres } }.
create table public.modifications (
  projet_id uuid primary key references public.projets (id) on delete cascade,
  deplacements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(deplacements) = 'object' and pg_column_size(deplacements) < 2000000),
  maj_le timestamptz not null default now(),
  maj_par uuid not null default auth.uid() references auth.users (id) on delete cascade
);

alter table public.modifications enable row level security;

-- Les invités voient les modifications ; seul le créateur du projet les enregistre.
create policy modifications_lecture on public.modifications for select to authenticated
  using (prive.acces_projet(projet_id) or (select prive.est_admin()));
create policy modifications_creation on public.modifications for insert to authenticated
  with check (prive.est_proprietaire(projet_id) and maj_par = (select auth.uid()));
create policy modifications_maj on public.modifications for update to authenticated
  using (prive.est_proprietaire(projet_id))
  with check (prive.est_proprietaire(projet_id) and maj_par = (select auth.uid()));

revoke all on public.modifications from anon, authenticated;
grant select, insert on public.modifications to authenticated;
grant update (deplacements, maj_le, maj_par) on public.modifications to authenticated;
grant select, insert, update, delete on public.modifications to service_role;
