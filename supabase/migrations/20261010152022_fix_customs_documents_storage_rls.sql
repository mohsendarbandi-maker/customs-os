-- Restore tenant-scoped Storage access for the private customs_documents bucket.
-- Paths are always rooted at the authenticated user's organization ID.
-- Client reads are limited to their own client, shipment, or case folders.

drop policy if exists customs_documents_storage_insert_org on storage.objects;
create policy customs_documents_storage_insert_org
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customs_documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (select public.user_role()) in ('owner','admin','broker','accountant','warehouse')
);

drop policy if exists customs_documents_storage_select_org on storage.objects;
create policy customs_documents_storage_select_org
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customs_documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) in ('owner','admin','broker','accountant','warehouse')
    or (
      (select public.user_role()) = 'client'
      and (
        (
          (storage.foldername(name))[2] = 'clients'
          and (storage.foldername(name))[3] = (select public.user_client_id())::text
        )
        or exists (
          select 1
          from public.shipments s
          where s.id::text = (storage.foldername(name))[2]
            and s.organization_id = (select public.user_org_id())
            and s.client_id = (select public.user_client_id())
        )
        or exists (
          select 1
          from public.cases c
          where c.id::text = (storage.foldername(name))[2]
            and c.organization_id = (select public.user_org_id())
            and c.client_id = (select public.user_client_id())
        )
      )
    )
  )
);

drop policy if exists customs_documents_storage_delete_org on storage.objects;
create policy customs_documents_storage_delete_org
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customs_documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (select public.user_role()) in ('owner','admin','broker','warehouse')
);
