-- Company-aware correspondence, e-registry and document assets.
-- All records remain inside the owning customs brokerage organization.
create table if not exists public.office_company_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  company_name text not null,
  national_id text,
  economic_code text,
  registration_number text,
  address text,
  phone text,
  email text,
  letterhead_storage_path text,
  stamp_storage_path text,
  signature_storage_path text,
  authorization_storage_path text,
  authorized_signer_name text,
  authority_reference text,
  authority_valid_until date,
  authority_status text not null default 'not_provided'
    check (authority_status in ('not_required','not_provided','pending','approved','expired','revoked')),
  authority_approved_by uuid references auth.users(id) on delete set null,
  authority_approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_company_profiles_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients(id, organization_id) on delete cascade,
  constraint office_company_profiles_id_org_uq unique (id, organization_id)
);

create unique index if not exists office_company_profiles_org_self_uq
  on public.office_company_profiles (organization_id) where client_id is null;
create unique index if not exists office_company_profiles_org_client_uq
  on public.office_company_profiles (organization_id, client_id) where client_id is not null;
create index if not exists office_company_profiles_org_idx
  on public.office_company_profiles (organization_id, client_id);

create table if not exists public.office_registry_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_profile_id uuid not null,
  year_key varchar(4) not null check (year_key ~ '^[0-9]{4}$'),
  direction text not null check (direction in ('incoming','outgoing','internal')),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  constraint office_registry_counters_profile_fk
    foreign key (company_profile_id, organization_id)
    references public.office_company_profiles(id, organization_id) on delete cascade,
  constraint office_registry_counters_scope_uq
    unique (organization_id, company_profile_id, year_key, direction)
);

create table if not exists public.office_correspondence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_profile_id uuid not null,
  direction text not null check (direction in ('incoming','outgoing','internal')),
  year_key varchar(4) not null check (year_key ~ '^[0-9]{4}$'),
  sequence_number bigint,
  registry_no text,
  external_reference text,
  letter_date date,
  received_at timestamptz,
  recipient_name text,
  recipient_organization text,
  sender_name text,
  sender_organization text,
  subject text not null,
  body text not null default '',
  notes text,
  response_due_date date,
  response_status text not null default 'not_required'
    check (response_status in ('not_required','pending','answered','overdue')),
  visible_to_client boolean not null default true,
  apply_stamp boolean not null default false,
  apply_signature boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','issued','sent','archived')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz,
  sent_at timestamptz,
  archived_at timestamptz,
  parent_correspondence_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_correspondence_profile_org_fk
    foreign key (company_profile_id, organization_id)
    references public.office_company_profiles(id, organization_id) on delete restrict,
  constraint office_correspondence_parent_org_fk
    foreign key (parent_correspondence_id, organization_id)
    references public.office_correspondence(id, organization_id) on delete set null,
  constraint office_correspondence_id_org_uq unique (id, organization_id),
  constraint office_correspondence_number_scope_uq
    unique (organization_id, company_profile_id, year_key, direction, sequence_number),
  constraint office_correspondence_registry_scope_uq
    unique (organization_id, company_profile_id, registry_no)
);

create index if not exists office_correspondence_company_date_idx
  on public.office_correspondence (organization_id, company_profile_id, created_at desc);
create index if not exists office_correspondence_register_idx
  on public.office_correspondence (organization_id, company_profile_id, year_key, direction, sequence_number desc);
create index if not exists office_correspondence_status_idx
  on public.office_correspondence (organization_id, status, response_due_date);

create table if not exists public.office_correspondence_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  correspondence_id uuid not null,
  storage_path text not null,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint office_correspondence_attachments_parent_fk
    foreign key (correspondence_id, organization_id)
    references public.office_correspondence(id, organization_id) on delete cascade
);
create index if not exists office_correspondence_attachments_parent_idx
  on public.office_correspondence_attachments (organization_id, correspondence_id);

create table if not exists public.office_correspondence_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  correspondence_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint office_correspondence_events_parent_fk
    foreign key (correspondence_id, organization_id)
    references public.office_correspondence(id, organization_id) on delete cascade
);
create index if not exists office_correspondence_events_parent_idx
  on public.office_correspondence_events (organization_id, correspondence_id, created_at desc);

alter table public.office_company_profiles enable row level security;
alter table public.office_registry_counters enable row level security;
alter table public.office_correspondence enable row level security;
alter table public.office_correspondence_attachments enable row level security;
alter table public.office_correspondence_events enable row level security;

grant select, insert, update, delete on public.office_company_profiles to authenticated;
grant select, insert, update, delete on public.office_registry_counters to authenticated;
grant select, insert, update, delete on public.office_correspondence to authenticated;
grant select, insert, update, delete on public.office_correspondence_attachments to authenticated;
grant select on public.office_correspondence_events to authenticated;
grant insert on public.office_correspondence_events to authenticated;

drop policy if exists office_company_profiles_staff_all on public.office_company_profiles;
create policy office_company_profiles_staff_all
on public.office_company_profiles for all to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
)
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
);

drop policy if exists office_company_profiles_client_select on public.office_company_profiles;
create policy office_company_profiles_client_select
on public.office_company_profiles for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and client_id = (select public.user_client_id())
  and (select public.user_role()) = 'client'::public.user_role
);

drop policy if exists office_company_profiles_client_insert on public.office_company_profiles;
create policy office_company_profiles_client_insert
on public.office_company_profiles for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and client_id = (select public.user_client_id())
  and (select public.user_role()) = 'client'::public.user_role
  and authority_status in ('not_provided','pending')
);

drop policy if exists office_company_profiles_client_update on public.office_company_profiles;
create policy office_company_profiles_client_update
on public.office_company_profiles for update to authenticated
using (
  organization_id = (select public.user_org_id())
  and client_id = (select public.user_client_id())
  and (select public.user_role()) = 'client'::public.user_role
)
with check (
  organization_id = (select public.user_org_id())
  and client_id = (select public.user_client_id())
  and (select public.user_role()) = 'client'::public.user_role
  and authority_status in ('not_provided','pending')
);

drop policy if exists office_registry_counters_staff_select on public.office_registry_counters;
create policy office_registry_counters_staff_select
on public.office_registry_counters for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role)
);
drop policy if exists office_registry_counters_staff_insert on public.office_registry_counters;
create policy office_registry_counters_staff_insert
on public.office_registry_counters for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role)
);
drop policy if exists office_registry_counters_staff_update on public.office_registry_counters;
create policy office_registry_counters_staff_update
on public.office_registry_counters for update to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role)
)
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role)
);

drop policy if exists office_correspondence_staff_select on public.office_correspondence;
create policy office_correspondence_staff_select
on public.office_correspondence for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role,'warehouse'::public.user_role)
);
drop policy if exists office_correspondence_client_select on public.office_correspondence;
create policy office_correspondence_client_select
on public.office_correspondence for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and visible_to_client
  and (select public.user_role()) = 'client'::public.user_role
  and exists (
    select 1 from public.office_company_profiles p
    where p.id = company_profile_id
      and p.organization_id = office_correspondence.organization_id
      and p.client_id = (select public.user_client_id())
  )
);
drop policy if exists office_correspondence_staff_insert on public.office_correspondence;
create policy office_correspondence_staff_insert
on public.office_correspondence for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role,'warehouse'::public.user_role)
  and created_by = auth.uid()
  and status = 'draft'
);
drop policy if exists office_correspondence_staff_update on public.office_correspondence;
create policy office_correspondence_staff_update
on public.office_correspondence for update to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role,'warehouse'::public.user_role)
)
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role,'warehouse'::public.user_role)
);
drop policy if exists office_correspondence_staff_delete_draft on public.office_correspondence;
create policy office_correspondence_staff_delete_draft
on public.office_correspondence for delete to authenticated
using (
  organization_id = (select public.user_org_id())
  and status = 'draft'
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
);

drop policy if exists office_correspondence_attachments_staff_select on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_select
on public.office_correspondence_attachments for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) <> 'client'::public.user_role
);
drop policy if exists office_correspondence_attachments_client_select on public.office_correspondence_attachments;
create policy office_correspondence_attachments_client_select
on public.office_correspondence_attachments for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and exists (
    select 1 from public.office_correspondence c
    join public.office_company_profiles p
      on p.id = c.company_profile_id and p.organization_id = c.organization_id
    where c.id = office_correspondence_attachments.correspondence_id
      and c.organization_id = office_correspondence_attachments.organization_id
      and c.visible_to_client
      and p.client_id = (select public.user_client_id())
  )
);
drop policy if exists office_correspondence_attachments_staff_insert on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_insert
on public.office_correspondence_attachments for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and created_by = auth.uid()
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'accountant'::public.user_role,'warehouse'::public.user_role)
);
drop policy if exists office_correspondence_attachments_staff_delete on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_delete
on public.office_correspondence_attachments for delete to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
);

drop policy if exists office_correspondence_events_staff_select on public.office_correspondence_events;
create policy office_correspondence_events_staff_select
on public.office_correspondence_events for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) <> 'client'::public.user_role
);
drop policy if exists office_correspondence_events_client_select on public.office_correspondence_events;
create policy office_correspondence_events_client_select
on public.office_correspondence_events for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and exists (
    select 1 from public.office_correspondence c
    join public.office_company_profiles p
      on p.id = c.company_profile_id and p.organization_id = c.organization_id
    where c.id = office_correspondence_events.correspondence_id
      and c.organization_id = office_correspondence_events.organization_id
      and c.visible_to_client
      and p.client_id = (select public.user_client_id())
  )
);
drop policy if exists office_correspondence_events_staff_insert on public.office_correspondence_events;
create policy office_correspondence_events_staff_insert
on public.office_correspondence_events for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) <> 'client'::public.user_role
  and actor_id = auth.uid()
);

create or replace function public.office_correspondence_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_client_id uuid;
  v_authority_status text;
  v_authority_valid_until date;
  v_stamp_path text;
  v_signature_path text;
  v_next bigint;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A new correspondence must start as a draft.';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  if old.status in ('issued','sent','archived') and (
    new.subject is distinct from old.subject
    or new.body is distinct from old.body
    or new.direction is distinct from old.direction
    or new.company_profile_id is distinct from old.company_profile_id
    or new.recipient_name is distinct from old.recipient_name
    or new.recipient_organization is distinct from old.recipient_organization
    or new.sender_name is distinct from old.sender_name
    or new.sender_organization is distinct from old.sender_organization
    or new.apply_stamp is distinct from old.apply_stamp
    or new.apply_signature is distinct from old.apply_signature
    or new.year_key is distinct from old.year_key
  ) then
    raise exception 'Issued correspondence is immutable. Create a correction letter instead.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status not in ('in_review') then
      raise exception 'Drafts must be submitted for review before approval.';
    elsif old.status = 'in_review' and new.status not in ('draft','approved') then
      raise exception 'Only a reviewed correspondence can be approved.';
    elsif old.status = 'approved' and new.status not in ('in_review','issued') then
      raise exception 'Only approved correspondence can be issued.';
    elsif old.status = 'issued' and new.status not in ('sent','archived') then
      raise exception 'Issued correspondence can only be marked sent or archived.';
    elsif old.status = 'sent' and new.status <> 'archived' then
      raise exception 'Sent correspondence can only be archived.';
    elsif old.status = 'archived' then
      raise exception 'Archived correspondence cannot be changed.';
    end if;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if (select public.user_role()) not in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role) then
      raise exception 'Only an authorized manager can approve correspondence.';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  if new.status = 'issued' and old.status is distinct from 'issued' then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'Correspondence needs recorded approval before issue.';
    end if;
    select p.client_id, p.authority_status, p.authority_valid_until,
           p.stamp_storage_path, p.signature_storage_path
      into v_client_id, v_authority_status, v_authority_valid_until,
           v_stamp_path, v_signature_path
      from public.office_company_profiles p
     where p.id = new.company_profile_id
       and p.organization_id = new.organization_id;

    if not found then
      raise exception 'Company document profile was not found.';
    end if;
    if v_client_id is not null and (
      v_authority_status <> 'approved'
      or (v_authority_valid_until is not null and v_authority_valid_until < current_date)
    ) then
      raise exception 'Current legal representation authorization is required before issuing a client-company letter.';
    end if;
    if new.apply_stamp and v_stamp_path is null then
      raise exception 'A company stamp has been selected but no stamp image is registered.';
    end if;
    if new.apply_signature and v_signature_path is null then
      raise exception 'A signature has been selected but no signature image is registered.';
    end if;
    if new.year_key !~ '^[0-9]{4}$' then
      raise exception 'Invalid registry year.';
    end if;

    insert into public.office_registry_counters
      (organization_id, company_profile_id, year_key, direction, last_value)
    values (new.organization_id, new.company_profile_id, new.year_key, new.direction, 1)
    on conflict (organization_id, company_profile_id, year_key, direction)
    do update set
      last_value = public.office_registry_counters.last_value + 1,
      updated_at = now()
    returning last_value into v_next;

    new.sequence_number := v_next;
    new.registry_no := new.year_key || '/' ||
      case new.direction when 'incoming' then 'IN' when 'outgoing' then 'OUT' else 'INT' end
      || '/' || lpad(v_next::text, 6, '0');
    new.issued_by := auth.uid();
    new.issued_at := now();
  end if;

  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  if new.status = 'archived' and old.status is distinct from 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.office_correspondence_audit()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.office_correspondence_events
      (organization_id, correspondence_id, event_type, to_status, actor_id, details)
    values (new.organization_id, new.id, 'created', new.status, auth.uid(), jsonb_build_object('direction',new.direction));
  elsif new.status is distinct from old.status then
    insert into public.office_correspondence_events
      (organization_id, correspondence_id, event_type, from_status, to_status, actor_id)
    values (new.organization_id, new.id, 'status_changed', old.status, new.status, auth.uid());
  elsif new.subject is distinct from old.subject or new.body is distinct from old.body then
    insert into public.office_correspondence_events
      (organization_id, correspondence_id, event_type, from_status, to_status, actor_id, details)
    values (new.organization_id, new.id, 'content_updated', old.status, new.status, auth.uid(), jsonb_build_object('subject_changed',new.subject is distinct from old.subject));
  end if;
  return new;
end;
$$;

drop trigger if exists office_correspondence_guard_trigger on public.office_correspondence;
create trigger office_correspondence_guard_trigger
before insert or update on public.office_correspondence
for each row execute function public.office_correspondence_guard();

drop trigger if exists office_correspondence_audit_trigger on public.office_correspondence;
create trigger office_correspondence_audit_trigger
after insert or update on public.office_correspondence
for each row execute function public.office_correspondence_audit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'office-documents',
  'office-documents',
  false,
  52428800,
  array['application/pdf','image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;

drop policy if exists office_documents_select on storage.objects;
create policy office_documents_select
on storage.objects for select to authenticated
using (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or (storage.foldername(name))[2] = (select public.user_client_id())::text
  )
);

drop policy if exists office_documents_insert on storage.objects;
create policy office_documents_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or (storage.foldername(name))[2] = (select public.user_client_id())::text
  )
);

drop policy if exists office_documents_update on storage.objects;
create policy office_documents_update
on storage.objects for update to authenticated
using (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or (storage.foldername(name))[2] = (select public.user_client_id())::text
  )
)
with check (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or (storage.foldername(name))[2] = (select public.user_client_id())::text
  )
);

drop policy if exists office_documents_delete on storage.objects;
create policy office_documents_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or (storage.foldername(name))[2] = (select public.user_client_id())::text
  )
);

comment on table public.office_company_profiles is
  'Per-organization and per-client letterhead, seal, signature and representation-authority profile.';
comment on table public.office_correspondence is
  'Incoming/outgoing/internal company correspondence with reviewed, immutable issue and registry numbering.';
comment on table public.office_correspondence_events is
  'Append-only status and content-change trail for office correspondence.';
