-- Version déjà convertie (.frag) gardée à côté de l'IFC : ouverture sans conversion.
alter table public.maquettes add column chemin_frag text unique;
alter table public.maquettes add column taille_frag bigint check (taille_frag is null or taille_frag > 0);

-- Le créateur complète ces champs (mise à niveau des anciennes maquettes, IFC compressé).
grant update (chemin, chemin_frag, taille_frag) on public.maquettes to authenticated;

-- Les fichiers d'une maquette restent dans le dossier de son projet.
alter table public.maquettes add constraint maquettes_chemin_du_projet
  check (split_part(chemin, '/', 1) = projet_id::text);
alter table public.maquettes add constraint maquettes_frag_du_projet
  check (chemin_frag is null or split_part(chemin_frag, '/', 1) = projet_id::text);
