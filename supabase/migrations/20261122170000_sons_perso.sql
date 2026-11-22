-- Sons importés par l'administrateur pour les bruitages (panneau admin) : lecture publique,
-- dépôt et suppression réservés à l'administrateur. Fichiers audio de 512 Ko au plus.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sons', 'sons', true, 524288, array['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy sons_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'sons' and (select prive.est_admin()));
create policy sons_lecture_admin on storage.objects for select to authenticated
  using (bucket_id = 'sons' and (select prive.est_admin()));
create policy sons_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'sons' and (select prive.est_admin()));
