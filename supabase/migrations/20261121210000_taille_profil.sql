-- Taille de la personne (cm) : sert à placer la vue à hauteur du téléphone en visite
-- à la première personne (taille − 30 cm). Vide : 1,40 m par défaut.
alter table public.profils
  add column if not exists taille_cm smallint
  check (taille_cm is null or taille_cm between 100 and 230);

grant select (taille_cm), update (taille_cm) on public.profils to authenticated;
