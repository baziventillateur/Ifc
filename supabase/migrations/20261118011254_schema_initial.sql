-- NexBim : comptes, projet partagé, maquettes IFC dans le cloud, panneau admin.

create schema if not exists prive;
grant usage on schema prive to authenticated;

-- --- Tables ---------------------------------------------------------------------

create table public.profils (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  prenom text not null default '',
  cree_le timestamptz not null default now()
);

create table public.projets (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 1 and 80),
  proprietaire uuid not null default auth.uid() references public.profils (id) on delete cascade,
  cree_le timestamptz not null default now()
);
create index projets_proprietaire on public.projets (proprietaire);

create table public.membres (
  projet_id uuid not null references public.projets (id) on delete cascade,
  utilisateur_id uuid not null references public.profils (id) on delete cascade,
  ajoute_le timestamptz not null default now(),
  primary key (projet_id, utilisateur_id)
);
create index membres_utilisateur on public.membres (utilisateur_id);

create table public.invitations (
  projet_id uuid not null references public.projets (id) on delete cascade,
  email text not null,
  invite_par uuid not null references public.profils (id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (projet_id, email)
);
create index invitations_email on public.invitations (email);
create index invitations_invite_par on public.invitations (invite_par);

create table public.maquettes (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references public.projets (id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 200),
  chemin text not null unique,
  taille bigint not null check (taille > 0 and taille <= 52428800),
  depose_par uuid not null default auth.uid() references public.profils (id) on delete cascade,
  cree_le timestamptz not null default now(),
  unique (projet_id, nom)
);
create index maquettes_depose_par on public.maquettes (depose_par);

-- --- Fonctions internes (non exposées par l'API) --------------------------------

create function prive.est_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid())
      and lower(email) = 'baziventillateur@gmail.com'
      and email_confirmed_at is not null
  );
$$;

create function prive.est_proprietaire(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projets where id = p and proprietaire = (select auth.uid()));
$$;

create function prive.acces_projet(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projets where id = p and proprietaire = (select auth.uid()))
      or exists (select 1 from public.membres where projet_id = p and utilisateur_id = (select auth.uid()));
$$;

-- Le premier dossier du chemin d'un fichier est l'identifiant du projet.
create function prive.projet_du_chemin(chemin text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(chemin, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

revoke all on all functions in schema prive from public, anon;
grant execute on all functions in schema prive to authenticated;

-- --- Garde-fous -----------------------------------------------------------------

-- Un seul projet par compte (l'admin n'est pas limité).
create function prive.limite_projets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not prive.est_admin()
     and exists (select 1 from public.projets where proprietaire = new.proprietaire) then
    raise exception 'LIMITE_PROJETS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger limite_projets before insert on public.projets
  for each row execute function prive.limite_projets();

-- Dix maquettes au plus par projet.
create function prive.limite_maquettes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projets where id = new.projet_id for update;
  if (select count(*) from public.maquettes where projet_id = new.projet_id) >= 10 then
    raise exception 'LIMITE_MAQUETTES' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger limite_maquettes before insert on public.maquettes
  for each row execute function prive.limite_maquettes();

-- À l'inscription : fiche de profil, et entrée dans les projets où la personne était invitée.
create function prive.nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profils (id, email, prenom)
  values (new.id, lower(new.email), left(coalesce(new.raw_user_meta_data ->> 'prenom', ''), 60));

  insert into public.membres (projet_id, utilisateur_id)
  select projet_id, new.id from public.invitations where email = lower(new.email)
  on conflict do nothing;

  delete from public.invitations where email = lower(new.email);
  return new;
end;
$$;
create trigger nouvel_utilisateur after insert on auth.users
  for each row execute function prive.nouvel_utilisateur();

revoke all on all functions in schema prive from public, anon;
grant execute on all functions in schema prive to authenticated;

-- --- Règles d'accès (RLS) -------------------------------------------------------

alter table public.profils enable row level security;
alter table public.projets enable row level security;
alter table public.membres enable row level security;
alter table public.invitations enable row level security;
alter table public.maquettes enable row level security;

create policy profils_lecture on public.profils for select to authenticated
  using (id = (select auth.uid()) or (select prive.est_admin()));
create policy profils_maj on public.profils for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Seul le prénom est modifiable par son titulaire.
revoke update on public.profils from authenticated;
grant update (prenom) on public.profils to authenticated;

create policy projets_lecture on public.projets for select to authenticated
  using (proprietaire = (select auth.uid()) or prive.acces_projet(id) or (select prive.est_admin()));
create policy projets_creation on public.projets for insert to authenticated
  with check (proprietaire = (select auth.uid()));
create policy projets_maj on public.projets for update to authenticated
  using (proprietaire = (select auth.uid())) with check (proprietaire = (select auth.uid()));
create policy projets_suppression on public.projets for delete to authenticated
  using (proprietaire = (select auth.uid()));

-- Les membres sont ajoutés par la fonction d'invitation, jamais directement.
create policy membres_lecture on public.membres for select to authenticated
  using (utilisateur_id = (select auth.uid()) or prive.est_proprietaire(projet_id) or (select prive.est_admin()));
create policy membres_retrait on public.membres for delete to authenticated
  using (utilisateur_id = (select auth.uid()) or prive.est_proprietaire(projet_id));

create policy invitations_lecture on public.invitations for select to authenticated
  using (prive.est_proprietaire(projet_id) or (select prive.est_admin()));
create policy invitations_retrait on public.invitations for delete to authenticated
  using (prive.est_proprietaire(projet_id));

-- Les invités consultent ; seul le créateur du projet dépose et supprime.
create policy maquettes_lecture on public.maquettes for select to authenticated
  using (prive.acces_projet(projet_id) or (select prive.est_admin()));
create policy maquettes_depot on public.maquettes for insert to authenticated
  with check (depose_par = (select auth.uid()) and prive.est_proprietaire(projet_id)
              and prive.projet_du_chemin(chemin) = projet_id);
create policy maquettes_suppression on public.maquettes for delete to authenticated
  using (prive.est_proprietaire(projet_id));

revoke all on public.profils, public.projets, public.membres, public.invitations, public.maquettes from anon;

-- --- Stockage des fichiers IFC --------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('maquettes', 'maquettes', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create policy maquettes_fichiers_lecture on storage.objects for select to authenticated
  using (bucket_id = 'maquettes' and prive.acces_projet(prive.projet_du_chemin(name)));
create policy maquettes_fichiers_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'maquettes' and prive.est_proprietaire(prive.projet_du_chemin(name)));
create policy maquettes_fichiers_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'maquettes' and prive.est_proprietaire(prive.projet_du_chemin(name)));

-- --- Fonctions appelées par l'appli ---------------------------------------------

-- Personnes d'un projet : créateur, invités, invitations en attente (visibles du créateur).
create function public.personnes_du_projet(p uuid)
returns table (utilisateur_id uuid, email text, prenom text, role text)
language sql stable security definer set search_path = '' as $$
  select pr.id, pr.email, pr.prenom, 'createur'
    from public.projets pj join public.profils pr on pr.id = pj.proprietaire
   where pj.id = p and prive.acces_projet(p)
  union all
  select pr.id, pr.email, pr.prenom, 'invite'
    from public.membres m join public.profils pr on pr.id = m.utilisateur_id
   where m.projet_id = p and prive.acces_projet(p)
  union all
  select null, i.email, '', 'en_attente'
    from public.invitations i
   where i.projet_id = p and prive.est_proprietaire(p);
$$;

create function public.suis_je_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select prive.est_admin();
$$;

-- Panneau admin : une ligne par compte.
create function public.admin_comptes()
returns table (
  id uuid, email text, prenom text, inscrit_le timestamptz, derniere_connexion timestamptz,
  confirme boolean, projets bigint, invitations_recues bigint, maquettes bigint, octets bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not prive.est_admin() then
    raise exception 'INTERDIT' using errcode = '42501';
  end if;
  return query
    select pr.id, pr.email, pr.prenom, pr.cree_le, u.last_sign_in_at,
           u.email_confirmed_at is not null,
           (select count(*) from public.projets pj where pj.proprietaire = pr.id),
           (select count(*) from public.membres m where m.utilisateur_id = pr.id),
           (select count(*) from public.maquettes q where q.depose_par = pr.id),
           (select coalesce(sum(q.taille), 0)::bigint from public.maquettes q where q.depose_par = pr.id)
      from public.profils pr join auth.users u on u.id = pr.id
     order by pr.cree_le desc;
end;
$$;

revoke all on function public.personnes_du_projet(uuid), public.suis_je_admin(), public.admin_comptes() from public, anon;
grant execute on function public.personnes_du_projet(uuid), public.suis_je_admin(), public.admin_comptes() to authenticated;

-- Comptes créés avant cette migration.
insert into public.profils (id, email, prenom)
select id, lower(email), left(coalesce(raw_user_meta_data ->> 'prenom', ''), 60)
  from auth.users where email is not null
on conflict do nothing;
