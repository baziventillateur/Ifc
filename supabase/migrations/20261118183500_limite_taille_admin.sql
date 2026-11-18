-- Taille des maquettes : 500 Mo pour l'administrateur, 50 Mo pour les autres comptes.
alter table public.maquettes drop constraint if exists maquettes_taille_check;
alter table public.maquettes add constraint maquettes_taille_check check (taille > 0 and taille <= 524288000);

create or replace function prive.limite_taille() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 50 Mo pour tout le monde, 500 Mo pour l'administrateur.
  if new.taille > 52428800 and not prive.est_admin() then
    raise exception 'TAILLE_MAX' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists limite_taille on public.maquettes;
create trigger limite_taille before insert on public.maquettes
  for each row execute function prive.limite_taille();

update storage.buckets set file_size_limit = 524288000 where id = 'maquettes';
