-- Minimal platform objects required to exercise the customs extraction migration in isolated PostgreSQL CI.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.user_role as enum ('owner','admin','broker','warehouse','accountant','client');
exception when duplicate_object then null;
end;
$$;

create or replace function public.user_org_id()
returns uuid language sql stable
as $$ select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid; $$;

create or replace function public.user_role()
returns public.user_role language sql stable
as $$ select 'owner'::public.user_role; $$;

create table if not exists public.organizations (id uuid primary key);
create table if not exists public.shipments (id uuid primary key);
create table if not exists public.customs_declarations (
  id uuid primary key,
  organization_id uuid not null,
  shipment_id uuid
);
create table if not exists public.file_manager_files (
  id uuid primary key,
  organization_id uuid not null,
  operation_sections text[] not null default '{}'
);
create table if not exists public.customs_documents (id uuid primary key);
create table if not exists public.file_assets (id uuid primary key);

create table if not exists public.shipment_documents (
 id uuid primary key, organization_id uuid not null, shipment_id uuid not null, uploaded_by uuid,
 document_name text not null, original_file_name text not null, storage_path text not null,
 mime_type text not null, file_size_bytes bigint not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 extraction_status text not null default 'pending', extraction_error text,
 extraction_started_at timestamptz, extraction_completed_at timestamptz,
 is_archived boolean not null default false, archived_at timestamptz, archived_by uuid,
 archive_reason text, storage_backend text not null default 'supabase', file_asset_id uuid,
 folder_id uuid, telegram_message_id text, file_manager_search_text text not null default '',
 telegram_archive_requested boolean not null default false
);
