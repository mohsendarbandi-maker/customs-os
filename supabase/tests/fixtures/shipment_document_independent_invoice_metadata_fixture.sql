create table public.shipment_documents (
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
