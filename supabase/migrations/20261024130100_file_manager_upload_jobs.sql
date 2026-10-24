-- Durable idempotency ledger for Telegram-backed file-manager uploads.
-- A browser retry must not send a duplicate Telegram message if the prior upload
-- was accepted but the response or metadata write was interrupted.

create table if not exists public.file_manager_upload_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null,
  folder_id uuid not null,
  shipment_id uuid null,
  created_by uuid null references auth.users(id) on delete set null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null default 'uploading'
    check (status in ('uploading','stored','failed','reconcile_required')),
  file_asset_id uuid null references public.file_assets(id) on delete set null,
  external_message_id text null,
  error_code text null,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint file_manager_upload_jobs_idempotency_uq unique (organization_id, idempotency_key),
  constraint file_manager_upload_jobs_folder_org_fk
    foreign key (folder_id, organization_id)
    references public.file_manager_folders(id, organization_id) on delete restrict,
  constraint file_manager_upload_jobs_shipment_org_fk
    foreign key (shipment_id, organization_id)
    references public.shipments(id, organization_id) on delete cascade
);

alter table public.file_manager_upload_jobs enable row level security;
create index if not exists file_manager_upload_jobs_pending_idx
  on public.file_manager_upload_jobs (status, updated_at)
  where status in ('uploading','reconcile_required');

grant all on public.file_manager_upload_jobs to service_role;
