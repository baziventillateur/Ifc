-- Objets ajoutés dans un projet (outil « Objets ») : copie d'un élément d'une maquette
-- (repéré par son identifiant IFC), posée ailleurs, tournée et redimensionnée. Les
-- maquettes d'origine ne sont jamais modifiées. Le créateur du projet et les personnes
-- invitées voient et modifient les ajouts.
create table if not exists public.ajouts (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets(id) on delete cascade,
  donnees jsonb not null check (octet_length(donnees::text) < 8000),
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists ajouts_projet on public.ajouts (projet_id);

alter table public.ajouts enable row level security;

create policy ajouts_lecture on public.ajouts
  for select to authenticated
  using (prive.acces_projet(projet_id) or (select prive.est_admin()));
create policy ajouts_creation on public.ajouts
  for insert to authenticated
  with check (prive.acces_projet(projet_id) and cree_par = (select auth.uid()));
create policy ajouts_modification on public.ajouts
  for update to authenticated
  using (prive.acces_projet(projet_id)) with check (prive.acces_projet(projet_id));
create policy ajouts_suppression on public.ajouts
  for delete to authenticated
  using (prive.acces_projet(projet_id));

revoke all on public.ajouts from anon;
grant select, insert, update, delete on public.ajouts to authenticated;

-- Pas plus de 2000 objets ajoutés par projet.
create or replace function prive.limite_ajouts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.ajouts where projet_id = new.projet_id) >= 2000 then
    raise exception 'LIMITE_AJOUTS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger limite_ajouts before insert on public.ajouts
  for each row execute function prive.limite_ajouts();
