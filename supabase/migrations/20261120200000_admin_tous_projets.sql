-- L'administrateur peut ouvrir n'importe quel projet (lecture seule) : lecture des fichiers
-- de maquettes et de la liste des personnes du projet.
drop policy if exists maquettes_fichiers_lecture on storage.objects;
create policy maquettes_fichiers_lecture on storage.objects
  for select to authenticated
  using (
    bucket_id = 'maquettes'
    and (prive.acces_projet(prive.projet_du_chemin(name)) or (select prive.est_admin()))
  );

create or replace function public.personnes_du_projet(p uuid)
returns table(utilisateur_id uuid, email text, prenom text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.email, pr.prenom, 'createur'
    from public.projets pj join public.profils pr on pr.id = pj.proprietaire
   where pj.id = p and (prive.acces_projet(p) or prive.est_admin())
  union all
  select pr.id, pr.email, pr.prenom, 'invite'
    from public.membres m join public.profils pr on pr.id = m.utilisateur_id
   where m.projet_id = p and (prive.acces_projet(p) or prive.est_admin())
  union all
  select null, i.email, '', 'en_attente'
    from public.invitations i
   where i.projet_id = p and (prive.est_proprietaire(p) or prive.est_admin());
$$;
