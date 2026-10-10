begin;
create table if not exists public.messenger_connections (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 platform text not null check(platform in ('telegram','bale','rubika','whatsapp')), external_account_id text not null,
 display_name text not null, secret_ref text not null check(secret_ref ~ '^[A-Z][A-Z0-9_]{2,99}$'),
 webhook_secret_ref text not null check(webhook_secret_ref ~ '^[A-Z][A-Z0-9_]{2,99}$'),
 verify_token_ref text check(verify_token_ref is null or verify_token_ref ~ '^[A-Z][A-Z0-9_]{2,99}$'),
 app_secret_ref text check(app_secret_ref is null or app_secret_ref ~ '^[A-Z][A-Z0-9_]{2,99}$'),
 config jsonb not null default '{}'::jsonb, enabled boolean not null default false,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(organization_id,platform,external_account_id));
create index if not exists messenger_connections_org_platform_idx on public.messenger_connections(organization_id,platform,enabled);
create table if not exists public.messenger_chats (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.messenger_connections(id) on delete cascade, external_chat_id text not null,
 chat_type text not null default 'unknown' check(chat_type in ('private','group','channel','business','unknown')),
 purpose text not null default 'inbox' check(purpose in ('inbox','file_archive','daily_report','shipment_notifications','shipment')),
 display_name text, shipment_id uuid references public.shipments(id) on delete set null, enabled boolean not null default true,
 created_at timestamptz not null default now(), unique(connection_id,external_chat_id));
create index if not exists messenger_chats_org_purpose_idx on public.messenger_chats(organization_id,purpose,enabled);
create index if not exists messenger_chats_shipment_idx on public.messenger_chats(shipment_id) where shipment_id is not null;
create table if not exists public.messenger_user_mappings (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.messenger_connections(id) on delete cascade, auth_user_id uuid references auth.users(id) on delete cascade,
 external_user_id text not null, external_username text, status text not null default 'pending' check(status in ('pending','verified','disabled')),
 verified_at timestamptz, created_at timestamptz not null default now(), unique(connection_id,external_user_id));
create index if not exists messenger_user_mappings_user_idx on public.messenger_user_mappings(organization_id,auth_user_id) where auth_user_id is not null;
create table if not exists public.file_assets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 original_name text not null, mime_type text, size_bytes bigint check(size_bytes is null or size_bytes>=0),
 sha256 text check(sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
 source_platform text not null check(source_platform in ('website','telegram','bale','rubika','whatsapp')),
 created_by uuid references auth.users(id) on delete set null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists file_assets_org_created_idx on public.file_assets(organization_id,created_at desc);
create index if not exists file_assets_org_sha256_idx on public.file_assets(organization_id,sha256) where sha256 is not null;
create table if not exists public.file_locations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 file_asset_id uuid not null references public.file_assets(id) on delete cascade,
 connection_id uuid not null references public.messenger_connections(id) on delete restrict,
 external_file_id text not null, external_file_unique_id text, external_chat_id text, external_message_id text,
 availability_status text not null default 'available' check(availability_status in ('available','unavailable','unknown')),
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists file_locations_asset_idx on public.file_locations(file_asset_id,connection_id);
create index if not exists file_locations_external_file_idx on public.file_locations(connection_id,external_file_id);
create index if not exists file_locations_external_message_idx on public.file_locations(connection_id,external_chat_id,external_message_id) where external_message_id is not null;
create table if not exists public.shipment_files (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 shipment_id uuid not null references public.shipments(id) on delete cascade, file_asset_id uuid not null references public.file_assets(id) on delete cascade,
 document_type text not null default 'other', created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), unique(shipment_id,file_asset_id,document_type));
create index if not exists shipment_files_org_shipment_idx on public.shipment_files(organization_id,shipment_id);
create index if not exists shipment_files_asset_idx on public.shipment_files(file_asset_id);
create table if not exists public.webhook_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.messenger_connections(id) on delete cascade, external_event_id text not null,
 event_type text not null default 'update', status text not null default 'received' check(status in ('received','processing','processed','ignored','failed')),
 attempt_count integer not null default 0 check(attempt_count>=0), error_code text, received_at timestamptz not null default now(), processed_at timestamptz,
 unique(connection_id,external_event_id,event_type));
create index if not exists webhook_events_status_received_idx on public.webhook_events(status,received_at);
create index if not exists webhook_events_org_received_idx on public.webhook_events(organization_id,received_at desc);
create table if not exists public.file_transfer_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 file_asset_id uuid not null references public.file_assets(id) on delete restrict, source_location_id uuid not null references public.file_locations(id) on delete restrict,
 destination_connection_id uuid not null references public.messenger_connections(id) on delete restrict, destination_chat_id text not null,
 status text not null default 'pending' check(status in ('pending','processing','succeeded','retry','failed')),
 idempotency_key text not null, attempt_count integer not null default 0 check(attempt_count>=0), max_attempts integer not null default 5 check(max_attempts between 1 and 20),
 next_attempt_at timestamptz not null default now(), locked_until timestamptz, result_message_id text, last_error_code text,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(organization_id,idempotency_key));
create index if not exists file_transfer_jobs_dispatch_idx on public.file_transfer_jobs(status,next_attempt_at,created_at);
create index if not exists file_transfer_jobs_org_created_idx on public.file_transfer_jobs(organization_id,created_at desc);
create table if not exists public.extraction_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 file_asset_id uuid not null references public.file_assets(id) on delete restrict, source_location_id uuid not null references public.file_locations(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','processing','succeeded','retry','failed')), attempt_count integer not null default 0,
 extracted_fields jsonb, confidence jsonb, error_code text, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz);
create index if not exists extraction_jobs_dispatch_idx on public.extraction_jobs(status,created_at);
create index if not exists extraction_jobs_org_created_idx on public.extraction_jobs(organization_id,created_at desc);
create table if not exists public.report_schedules (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null,
 timezone text not null default 'Asia/Tehran', local_time time not null default '08:00', weekdays smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
 enabled boolean not null default false, report_config jsonb not null default '{}'::jsonb, next_run_at timestamptz,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name));
create index if not exists report_schedules_due_idx on public.report_schedules(enabled,next_run_at) where enabled=true;
create table if not exists public.report_schedule_targets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 schedule_id uuid not null references public.report_schedules(id) on delete cascade, connection_id uuid not null references public.messenger_connections(id) on delete cascade,
 external_chat_id text not null, enabled boolean not null default true, created_at timestamptz not null default now(), unique(schedule_id,connection_id,external_chat_id));
create index if not exists report_targets_schedule_idx on public.report_schedule_targets(schedule_id,enabled);
create table if not exists public.report_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 schedule_id uuid not null references public.report_schedules(id) on delete cascade, report_date date not null,
 status text not null default 'pending' check(status in ('pending','processing','succeeded','partial','retry','failed')),
 summary jsonb not null default '{}'::jsonb, error_code text, started_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), unique(schedule_id,report_date));
create index if not exists report_runs_org_created_idx on public.report_runs(organization_id,created_at desc);
create table if not exists public.message_logs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.messenger_connections(id) on delete cascade, direction text not null check(direction in ('inbound','outbound','system')),
 message_type text not null default 'text', external_event_id text, external_message_id text, external_chat_id text, file_asset_id uuid references public.file_assets(id) on delete set null,
 status text not null default 'queued' check(status in ('queued','sending','sent','delivered','read','failed','unknown','received')),
 payload_summary jsonb not null default '{}'::jsonb, error_code text, created_at timestamptz not null default now(), sent_at timestamptz);
create index if not exists message_logs_org_created_idx on public.message_logs(organization_id,created_at desc);
create index if not exists message_logs_external_message_idx on public.message_logs(connection_id,external_message_id) where external_message_id is not null;
create or replace function public.claim_messenger_transfer_jobs(p_limit integer default 10)
returns setof public.file_transfer_jobs language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 update public.file_transfer_jobs j set status='failed',last_error_code=coalesce(j.last_error_code,'MAX_ATTEMPTS_EXCEEDED'),locked_until=null,completed_at=now(),updated_at=now()
 where j.attempt_count>=j.max_attempts and (j.status in ('pending','retry') or (j.status='processing' and j.locked_until<now()));
 return query with candidates as (select j.id from public.file_transfer_jobs j where j.attempt_count<j.max_attempts and
 ((j.status in ('pending','retry') and j.next_attempt_at<=now()) or (j.status='processing' and j.locked_until<now()))
 order by j.next_attempt_at,j.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,10),50))),
 claimed as (update public.file_transfer_jobs j set status='processing',attempt_count=j.attempt_count+1,locked_until=now()+interval '10 minutes',updated_at=now()
 from candidates c where j.id=c.id returning j.*) select * from claimed;
end; $$;
revoke all on function public.claim_messenger_transfer_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_messenger_transfer_jobs(integer) to service_role;
do $$ declare t text; begin foreach t in array array['messenger_connections','messenger_chats','messenger_user_mappings','file_assets','file_locations','shipment_files','webhook_events','file_transfer_jobs','extraction_jobs','report_schedules','report_schedule_targets','report_runs','message_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated',t);
 execute format('grant all on table public.%I to service_role',t);
 end loop; end $$;
comment on table public.file_assets is 'Metadata only. No binary file content may be stored here.';
comment on table public.file_locations is 'External file identifiers only; never store temporary URLs or credentials.';
comment on table public.file_transfer_jobs is 'Transfer state only. File contents must be streamed and not persisted.';
comment on table public.webhook_events is 'Deduplication metadata only; raw webhook payloads and file bytes are not persisted.';
commit;