-- Captures : état complet de la maquette au moment de la prise (maquettes affichées,
-- transparences, éléments masqués ou isolés, filtres, coupes, cotes) et annotations
-- rééditables (dessin de l'éditeur, posé sur l'image d'origine gardée à part).
alter table public.captures
  add column if not exists etat jsonb,
  add column if not exists annotations jsonb;

alter table public.captures
  add constraint captures_etat_taille check (etat is null or pg_column_size(etat) <= 400000),
  add constraint captures_annotations_taille check (annotations is null or pg_column_size(annotations) <= 400000);

grant select (etat, annotations) on public.captures to authenticated;
grant insert (etat) on public.captures to authenticated;
grant update (annotations) on public.captures to authenticated;
