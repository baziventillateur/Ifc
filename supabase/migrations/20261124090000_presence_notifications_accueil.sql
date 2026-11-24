-- Présence, appli installée, notifications sur l'appareil (Web Push) et accueil des nouveaux venus.
-- Inspiré de Malino : l'appli signale régulièrement qui est en ligne (et où), si elle est installée
-- et si les notifications sont activées ; l'administrateur le voit dans son panneau et peut être
-- prévenu quand quelqu'un arrive. Les envois passent par la fonction « notifications ».

-- 1. Profil : présence, appareils, appli installée, notifications, accueil vu.
alter table public.profils
  add column if not exists en_ligne_le timestamptz,
  add column if not exists en_ligne_debut timestamptz,
  add column if not exists en_ligne_lieu text,
  add column if not exists en_ligne_detail text,
  add column if not exists appareils jsonb not null default '{}'::jsonb,
  add column if not exists installe_le timestamptz,
  add column if not exists push_etat text,
  add column if not exists accueil_vu_le timestamptz;

-- 2. Abonnements aux notifications : aucun accès direct, tout passe par les fonctions ci-dessous.
create table if not exists public.push_abonnements (
  id bigint generated always as identity primary key,
  utilisateur_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  cree_le timestamptz not null default now(),
  vu_le timestamptz not null default now()
);
create index if not exists push_abonnements_utilisateur on public.push_abonnements (utilisateur_id);
alter table public.push_abonnements enable row level security;
revoke all on public.push_abonnements from anon, authenticated;

-- 3. Clés VAPID : la publique est lisible par tous, la privée reste dans le coffre (vault) et
--    n'est lue que par la fonction « notifications » (rôle service). Elles sont créées par la
--    fonction elle-même au premier envoi : la clé privée ne circule nulle part ailleurs.
create table if not exists prive.vapid (
  id smallint primary key default 1 check (id = 1),
  publique text not null
);

create or replace function public.vapid_publique()
returns text language sql stable security definer set search_path = '' as $$
  select publique from prive.vapid where id = 1;
$$;
grant execute on function public.vapid_publique() to anon, authenticated;

create or replace function public.notif_vapid_enregistrer(p_publique text, p_privee text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from prive.vapid) then return false; end if;
  insert into prive.vapid (id, publique) values (1, p_publique);
  perform vault.create_secret(p_privee, 'nexbim_vapid_privee', 'Clé privée VAPID des notifications NexBim');
  return true;
end;
$$;

create or replace function public.notif_vapid_privee()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'nexbim_vapid_privee' limit 1;
$$;

revoke all on function public.notif_vapid_enregistrer(text, text) from public, anon, authenticated;
revoke all on function public.notif_vapid_privee() from public, anon, authenticated;
grant execute on function public.notif_vapid_enregistrer(text, text) to service_role;
grant execute on function public.notif_vapid_privee() to service_role;

-- 4. Appel de la fonction « notifications » depuis la base (même clé d'outil que les e-mails).
create or replace function prive.notifier(p_evenement text, p_donnees jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://gmirbodifgxxnsfyfuyr.supabase.co/functions/v1/notifications',
    body := jsonb_build_object('evenement', p_evenement) || coalesce(p_donnees, '{}'::jsonb),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cle-outil', (select cle from prive.cle_outil_courriel limit 1)
    ),
    timeout_milliseconds := 15000
  );
exception when others then
  -- Une notification qui ne part pas ne bloque jamais l'action de la personne.
  null;
end;
$$;
revoke all on function prive.notifier(text, jsonb) from public, anon, authenticated;

-- 5. Présence : appelée par l'appli toutes les minutes (et quand le lieu change).
create or replace function public.nexbim_ping(
  p_lieu text default null,
  p_detail text default null,
  p_installe boolean default null,
  p_push text default null,
  p_app text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_prev timestamptz;
  nouvelle boolean;
begin
  if uid is null then return; end if;
  if p_installe then
    update public.profils set installe_le = now() where id = uid and installe_le is null;
  end if;
  if p_push in ('on', 'off', 'refuse', 'nosup') then
    update public.profils set push_etat = p_push where id = uid and push_etat is distinct from p_push;
  end if;
  if p_app ~ '^(ios|android|mac|windows|linux|autre):(tel|tab|ordi)$' then
    update public.profils set appareils = appareils || jsonb_build_object(p_app, now())
     where id = uid and (appareils ->> p_app is null or (appareils ->> p_app)::timestamptz < now() - interval '5 minutes');
  end if;
  select en_ligne_le into v_prev from public.profils where id = uid;
  if not found then return; end if;
  nouvelle := v_prev is null or v_prev < now() - interval '150 seconds';
  update public.profils
     set en_ligne_le = now(),
         en_ligne_debut = case when nouvelle then now() else coalesce(en_ligne_debut, now()) end,
         en_ligne_lieu = case when p_lieu in ('maquette', 'visite', 'projets') then p_lieu
                              when nouvelle then null else en_ligne_lieu end,
         en_ligne_detail = case when p_lieu is not null then left(nullif(trim(coalesce(p_detail, '')), ''), 80)
                                when nouvelle then null else en_ligne_detail end
   where id = uid;
  -- Arrivée (après 30 min d'absence) : l'administrateur est prévenu, s'il l'a demandé.
  if (v_prev is null or v_prev < now() - interval '30 minutes') and not prive.est_admin() then
    perform prive.notifier('arrivee', jsonb_build_object('utilisateur', uid));
  end if;
end;
$$;
revoke all on function public.nexbim_ping(text, text, boolean, text, text) from public, anon;
grant execute on function public.nexbim_ping(text, text, boolean, text, text) to authenticated;

-- 6. S'abonner / se désabonner (au plus 10 appareils par compte).
create or replace function public.push_abonner(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if p_endpoint is null or length(p_endpoint) > 1000 or p_endpoint !~ '^https://'
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return false;
  end if;
  if (select count(*) from public.push_abonnements where utilisateur_id = uid) >= 10
     and not exists (select 1 from public.push_abonnements where endpoint = p_endpoint) then
    delete from public.push_abonnements
     where id = (select id from public.push_abonnements where utilisateur_id = uid order by vu_le asc limit 1);
  end if;
  insert into public.push_abonnements (utilisateur_id, endpoint, p256dh, auth, ua)
  values (uid, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_ua, 200))
  on conflict (endpoint) do update
    set utilisateur_id = excluded.utilisateur_id, p256dh = excluded.p256dh, auth = excluded.auth,
        ua = coalesce(excluded.ua, public.push_abonnements.ua), vu_le = now();
  update public.profils set push_etat = 'on' where id = uid;
  return true;
end;
$$;

create or replace function public.push_desabonner(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_abonnements where endpoint = p_endpoint and utilisateur_id = auth.uid();
  update public.profils set push_etat = 'off'
   where id = auth.uid() and not exists (select 1 from public.push_abonnements where utilisateur_id = auth.uid());
end;
$$;
revoke all on function public.push_abonner(text, text, text, text) from public, anon;
revoke all on function public.push_desabonner(text) from public, anon;
grant execute on function public.push_abonner(text, text, text, text) to authenticated;
grant execute on function public.push_desabonner(text) to authenticated;

-- 7. Accueil des nouveaux venus : vu une fois par compte (sur tous ses appareils).
-- Seuls les comptes créés à partir de maintenant le voient d'eux-mêmes (les autres peuvent
-- l'ouvrir depuis le menu du compte).
create or replace function public.accueil_a_voir()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select accueil_vu_le is null and cree_le >= timestamptz '2026-11-24 09:00:00+01'
                     from public.profils where id = auth.uid()), false);
$$;
create or replace function public.accueil_vu()
returns void language sql security definer set search_path = '' as $$
  update public.profils set accueil_vu_le = coalesce(accueil_vu_le, now()) where id = auth.uid();
$$;
revoke all on function public.accueil_a_voir() from public, anon;
revoke all on function public.accueil_vu() from public, anon;
grant execute on function public.accueil_a_voir() to authenticated;
grant execute on function public.accueil_vu() to authenticated;

-- 8. Événements qui méritent une notification.
-- Nouvelle maquette dans un projet : les autres membres du projet sont prévenus.
create or replace function prive.notifier_maquette()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform prive.notifier('maquette', jsonb_build_object('projet', new.projet_id, 'nom', new.nom, 'par', new.depose_par));
  return new;
end;
$$;
create trigger notifier_maquette after insert on public.maquettes
  for each row execute function prive.notifier_maquette();

-- Nouvelle personne dans un projet : elle-même (projet partagé) ou le créateur (invité arrivé).
create or replace function prive.notifier_membre()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform prive.notifier('membre', jsonb_build_object('projet', new.projet_id, 'utilisateur', new.utilisateur_id));
  return new;
end;
$$;
create trigger notifier_membre after insert on public.membres
  for each row execute function prive.notifier_membre();

-- 9. Panneau admin : présence, appareils, appli installée, notifications (nouvelle fonction,
--    l'ancienne admin_comptes reste en place).
create or replace function public.admin_comptes_presence()
returns table (
  id uuid, email text, prenom text, inscrit_le timestamptz, derniere_connexion timestamptz, confirme boolean,
  projets bigint, invitations_recues bigint, maquettes bigint, octets bigint,
  ia_questions integer, ia_actif boolean, ia_demande timestamptz,
  en_ligne_le timestamptz, en_ligne_debut timestamptz, en_ligne_lieu text, en_ligne_detail text,
  appareils jsonb, installe_le timestamptz, push_etat text, abonnements bigint
) language plpgsql stable security definer set search_path = '' as $$
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
           coalesce(ia.questions, 0), coalesce(ia.actif, false), ia.demande_le,
           pr.en_ligne_le, pr.en_ligne_debut, pr.en_ligne_lieu, pr.en_ligne_detail,
           pr.appareils, pr.installe_le, pr.push_etat,
           (select count(*) from public.push_abonnements a where a.utilisateur_id = pr.id)
      from public.profils pr
      join auth.users u on u.id = pr.id
      left join public.ia_acces ia on ia.utilisateur_id = pr.id
     order by ia.demande_le desc nulls last, pr.en_ligne_le desc nulls last, pr.cree_le desc;
end;
$$;
revoke all on function public.admin_comptes_presence() from public, anon;
grant execute on function public.admin_comptes_presence() to authenticated;
