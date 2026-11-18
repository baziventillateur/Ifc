-- Corbeille des maquettes : une maquette supprimée est gardée 60 jours, restaurable par
-- le créateur du projet, puis effacée définitivement chaque nuit (fonction « purger »).

alter table public.maquettes add column supprime_le timestamptz;

-- Le même nom peut revenir dans le projet si l'ancienne maquette est à la corbeille.
alter table public.maquettes drop constraint maquettes_projet_id_nom_key;
create unique index maquettes_nom_actif on public.maquettes (projet_id, nom) where supprime_le is null;
create index maquettes_corbeille on public.maquettes (supprime_le) where supprime_le is not null;

-- Seul le créateur met à la corbeille ou restaure.
grant update (supprime_le) on public.maquettes to authenticated;
create policy maquettes_corbeille on public.maquettes for update to authenticated
  using (prive.est_proprietaire(projet_id)) with check (prive.est_proprietaire(projet_id));

-- Les invités ne voient pas la corbeille.
drop policy maquettes_lecture on public.maquettes;
create policy maquettes_lecture on public.maquettes for select to authenticated
  using ((supprime_le is null and prive.acces_projet(projet_id))
         or prive.est_proprietaire(projet_id)
         or (select prive.est_admin()));

-- Dix maquettes actives au plus, y compris quand on en restaure une.
create or replace function prive.limite_maquettes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and not (old.supprime_le is not null and new.supprime_le is null) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.supprime_le is not null then
    return new;
  end if;
  perform 1 from public.projets where id = new.projet_id for update;
  if (select count(*) from public.maquettes
       where projet_id = new.projet_id and supprime_le is null and id <> new.id) >= 10 then
    raise exception 'LIMITE_MAQUETTES' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger limite_maquettes_restauration before update of supprime_le on public.maquettes
  for each row execute function prive.limite_maquettes();

-- Panneau admin : seules les maquettes actives sont comptées (le stockage compte tout).
create or replace function public.admin_comptes()
returns table (
  id uuid, email text, prenom text, inscrit_le timestamptz, derniere_connexion timestamptz,
  confirme boolean, projets bigint, invitations_recues bigint, maquettes bigint, octets bigint,
  ia_questions integer, ia_actif boolean, ia_demande timestamptz
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
           (select count(*) from public.maquettes q where q.depose_par = pr.id and q.supprime_le is null),
           (select coalesce(sum(q.taille), 0)::bigint from public.maquettes q where q.depose_par = pr.id),
           coalesce(ia.questions, 0), coalesce(ia.actif, false), ia.demande_le
      from public.profils pr
      join auth.users u on u.id = pr.id
      left join public.ia_acces ia on ia.utilisateur_id = pr.id
     order by ia.demande_le desc nulls last, pr.cree_le desc;
end;
$$;

-- Purge quotidienne (3 h 17 UTC) : appelle la fonction « purger », qui efface les
-- fichiers et les lignes à la corbeille depuis plus de 60 jours.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nexbim-corbeille',
  '17 3 * * *',
  $$select net.http_post(
      url := 'https://gmirbodifgxxnsfyfuyr.supabase.co/functions/v1/purger',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );$$
);
