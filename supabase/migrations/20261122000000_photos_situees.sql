-- Photos de chantier situées dans la maquette (visite à la première personne) : rangées
-- avec les captures, repérées par leur point de vue (position, direction, focale).
alter table public.captures
  add column if not exists genre text not null default 'capture' check (genre in ('capture', 'photo'));
