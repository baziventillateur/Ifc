-- Assistant IA avec la clé du propriétaire de NexBim : essai de 3 questions par compte,
-- puis accès ouvert par l'administrateur depuis le panneau admin.

create table public.ia_acces (
  utilisateur_id uuid primary key references public.profils (id) on delete cascade,
  questions integer not null default 0,
  appels integer not null default 0,
  actif boolean not null default false,
  demande_le timestamptz,
  active_le timestamptz,
  jour date not null default current_date,
  appels_jour integer not null default 0
);

alter table public.ia_acces enable row level security;

create policy ia_acces_lecture on public.ia_acces for select to authenticated
  using (utilisateur_id = (select auth.uid()) or (select prive.est_admin()));

revoke all on public.ia_acces from anon, authenticated;
grant select on public.ia_acces to authenticated;
grant select, insert, update, delete on public.ia_acces to service_role;

-- Appelée par la fonction « ia » (rôle de service) avant chaque appel à Claude.
-- Essai : 3 questions et 40 appels au total. Accès ouvert : 300 appels par jour.
create function public.ia_consommer(p_uid uuid, p_question boolean, p_admin boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.ia_acces;
  premiere_demande boolean := false;
begin
  insert into public.ia_acces (utilisateur_id) values (p_uid) on conflict do nothing;
  select * into a from public.ia_acces where utilisateur_id = p_uid for update;

  if a.jour <> current_date then
    a.jour := current_date;
    a.appels_jour := 0;
  end if;

  if not p_admin then
    if a.actif then
      if a.appels_jour >= 300 then
        return jsonb_build_object('autorise', false, 'raison', 'JOUR');
      end if;
    elsif (p_question and a.questions >= 3) or a.appels >= 40 then
      premiere_demande := a.demande_le is null;
      update public.ia_acces set demande_le = coalesce(demande_le, now()) where utilisateur_id = p_uid;
      return jsonb_build_object('autorise', false, 'raison', 'ESSAI', 'alerter', premiere_demande);
    end if;
  end if;

  update public.ia_acces
     set questions = questions + case when p_question then 1 else 0 end,
         appels = appels + 1,
         jour = a.jour,
         appels_jour = a.appels_jour + 1
   where utilisateur_id = p_uid
  returning * into a;

  -- Dernière question d'essai consommée : la demande d'accès part tout de suite.
  if not p_admin and not a.actif and a.questions >= 3 and a.demande_le is null then
    update public.ia_acces set demande_le = now() where utilisateur_id = p_uid;
    premiere_demande := true;
  end if;

  return jsonb_build_object('autorise', true, 'questions', a.questions, 'actif', a.actif or p_admin, 'alerter', premiere_demande);
end;
$$;

revoke all on function public.ia_consommer(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.ia_consommer(uuid, boolean, boolean) to service_role;

-- Panneau admin : ouvrir ou fermer l'IA pour un compte.
create function public.admin_ia(p_uid uuid, p_actif boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not prive.est_admin() then
    raise exception 'INTERDIT' using errcode = '42501';
  end if;
  insert into public.ia_acces (utilisateur_id, actif, active_le)
  values (p_uid, p_actif, case when p_actif then now() end)
  on conflict (utilisateur_id) do update
    set actif = excluded.actif,
        active_le = excluded.active_le,
        demande_le = case when excluded.actif then null else public.ia_acces.demande_le end;
end;
$$;

revoke all on function public.admin_ia(uuid, boolean) from public, anon;
grant execute on function public.admin_ia(uuid, boolean) to authenticated;

-- Panneau admin : une ligne par compte, avec l'état de l'IA.
drop function public.admin_comptes();
create function public.admin_comptes()
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
           (select count(*) from public.maquettes q where q.depose_par = pr.id),
           (select coalesce(sum(q.taille), 0)::bigint from public.maquettes q where q.depose_par = pr.id),
           coalesce(ia.questions, 0), coalesce(ia.actif, false), ia.demande_le
      from public.profils pr
      join auth.users u on u.id = pr.id
      left join public.ia_acces ia on ia.utilisateur_id = pr.id
     order by ia.demande_le desc nulls last, pr.cree_le desc;
end;
$$;

revoke all on function public.admin_comptes() from public, anon;
grant execute on function public.admin_comptes() to authenticated;
