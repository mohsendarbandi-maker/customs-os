create table if not exists public.pdf_document_recognition_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check (length(trim(document_type)) between 2 and 100),
  sample_name text not null check (length(trim(sample_name)) between 1 and 140),
  source_filename text not null,
  source_mime_type text not null default 'application/pdf',
  sample_hash text not null check (sample_hash ~ '^[0-9a-f]{64}$'),
  page_count integer not null default 1 check (page_count > 0),
  features jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists pdf_recognition_samples_org_type_created_idx
  on public.pdf_document_recognition_samples (organization_id, document_type, created_at desc);

create index if not exists pdf_recognition_samples_features_gin_idx
  on public.pdf_document_recognition_samples using gin (features);

create unique index if not exists pdf_recognition_samples_org_hash_type_uq
  on public.pdf_document_recognition_samples (organization_id, sample_hash, document_type);

alter table public.pdf_document_recognition_samples enable row level security;

drop policy if exists pdf_recognition_samples_org_read on public.pdf_document_recognition_samples;
create policy pdf_recognition_samples_org_read
  on public.pdf_document_recognition_samples for select to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

drop policy if exists pdf_recognition_samples_org_insert on public.pdf_document_recognition_samples;
create policy pdf_recognition_samples_org_insert
  on public.pdf_document_recognition_samples for insert to authenticated
  with check (
    organization_id = public.user_org_id()
    and created_by = auth.uid()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

drop policy if exists pdf_recognition_samples_org_delete on public.pdf_document_recognition_samples;
create policy pdf_recognition_samples_org_delete
  on public.pdf_document_recognition_samples for delete to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

revoke all on table public.pdf_document_recognition_samples from public, anon, authenticated;
grant select, insert, delete on table public.pdf_document_recognition_samples to authenticated;
grant all on table public.pdf_document_recognition_samples to service_role;

comment on table public.pdf_document_recognition_samples is
  'Organization-scoped PDF recognition examples. Stores extracted page-layout/text features only; original sample files are never uploaded here.';

notify pgrst, 'reload schema';
