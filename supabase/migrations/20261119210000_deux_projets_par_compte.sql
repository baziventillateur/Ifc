-- Deux projets par compte au lieu d'un (l'admin n'est pas limité).
create or replace function prive.limite_projets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not prive.est_admin()
     and (select count(*) from public.projets where proprietaire = new.proprietaire) >= 2 then
    raise exception 'LIMITE_PROJETS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
