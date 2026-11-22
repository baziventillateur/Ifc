-- Version de NexBim utilisée par chaque compte (notée à l'ouverture de l'appli) et date
-- du dernier e-mail « nouvelle version » envoyé par l'administrateur.
alter table public.profils
  add column if not exists version_app text check (version_app is null or char_length(version_app) <= 20),
  add column if not exists version_le timestamptz,
  add column if not exists rappel_version_le timestamptz;

grant select (version_app), update (version_app, version_le) on public.profils to authenticated;

-- Fenêtre des versions, côté administrateur : qui est sur quelle version.
create or replace function public.admin_versions()
returns table (
  id uuid, email text, prenom text, version_app text, version_le timestamptz,
  rappel_version_le timestamptz, derniere_connexion timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not prive.est_admin() then
    raise exception 'INTERDIT' using errcode = '42501';
  end if;
  return query
    select pr.id, pr.email, pr.prenom, pr.version_app, pr.version_le, pr.rappel_version_le, u.last_sign_in_at
      from public.profils pr
      join auth.users u on u.id = pr.id
     order by pr.version_le desc nulls last;
end;
$$;

revoke all on function public.admin_versions() from public, anon;
grant execute on function public.admin_versions() to authenticated;
