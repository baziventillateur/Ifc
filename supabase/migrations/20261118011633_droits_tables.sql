-- Droits précis sur les tables : rien pour les visiteurs, le strict nécessaire pour les
-- personnes connectées (les règles RLS filtrent ensuite ligne par ligne).
revoke all on public.profils, public.projets, public.membres, public.invitations, public.maquettes
  from anon, authenticated, service_role;

grant select on public.profils to authenticated;
grant update (prenom) on public.profils to authenticated;
grant select, insert, delete on public.projets to authenticated;
grant update (nom) on public.projets to authenticated;
grant select, delete on public.membres to authenticated;
grant select, delete on public.invitations to authenticated;
grant select, insert, delete on public.maquettes to authenticated;

-- La fonction d'invitation (côté serveur) lit et écrit avec le rôle de service.
grant select, insert, update, delete on public.profils, public.projets, public.membres,
  public.invitations, public.maquettes to service_role;
