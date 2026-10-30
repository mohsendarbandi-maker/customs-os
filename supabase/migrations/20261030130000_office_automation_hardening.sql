-- Post-creation hardening and backfill for the office-automation module.
-- This migration is additive and safe to re-run.

alter table public.office_correspondence
  drop constraint if exists office_correspondence_parent_org_fk;
alter table public.office_correspondence
  add constraint office_correspondence_parent_org_fk
  foreign key (parent_correspondence_id, organization_id)
  references public.office_correspondence(id, organization_id) on delete restrict;

drop policy if exists office_company_profiles_staff_select on public.office_company_profiles;
create policy office_company_profiles_staff_select
on public.office_company_profiles for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in (
    'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
    'accountant'::public.user_role,'warehouse'::public.user_role
  )
);

drop policy if exists office_company_profiles_client_insert on public.office_company_profiles;
create policy office_company_profiles_client_insert
on public.office_company_profiles for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and client_id = (select public.user_client_id())
  and (select public.user_role()) = 'client'::public.user_role
  and authority_status in ('not_provided','pending')
  and authority_approved_by is null
  and authority_approved_at is null
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
  and authority_approved_by is null
  and authority_approved_at is null
);

drop policy if exists office_correspondence_attachments_staff_insert on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_insert
on public.office_correspondence_attachments for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and created_by = auth.uid()
  and (select public.user_role()) in (
    'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
    'accountant'::public.user_role,'warehouse'::public.user_role
  )
  and exists (
    select 1 from public.office_correspondence c
    where c.id = correspondence_id
      and c.organization_id = office_correspondence_attachments.organization_id
      and c.status in ('draft','in_review')
  )
);

drop policy if exists office_correspondence_attachments_staff_delete on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_delete
on public.office_correspondence_attachments for delete to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
  and exists (
    select 1 from public.office_correspondence c
    where c.id = correspondence_id
      and c.organization_id = office_correspondence_attachments.organization_id
      and c.status in ('draft','in_review')
  )
);

drop policy if exists office_documents_update on storage.objects;
drop policy if exists office_documents_delete on storage.objects;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip'
]
where id = 'office-documents';

insert into public.office_company_profiles (organization_id, client_id, company_name, authority_status)
select o.id, null, o.name, 'approved'
from public.organizations o
on conflict (organization_id) where client_id is null do nothing;

insert into public.office_company_profiles (organization_id, client_id, company_name, national_id, authority_status)
select c.organization_id, c.id, c.name, c.national_id, 'not_provided'
from public.clients c
on conflict (organization_id, client_id) where client_id is not null do nothing;

create or replace function public.office_create_client_company_profile()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  insert into public.office_company_profiles
    (organization_id, client_id, company_name, national_id, authority_status)
  values
    (new.organization_id, new.id, new.name, new.national_id, 'not_provided')
  on conflict (organization_id, client_id) where client_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists office_create_client_company_profile_trigger on public.clients;
create trigger office_create_client_company_profile_trigger
after insert on public.clients
for each row execute function public.office_create_client_company_profile();

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

  new.created_by := old.created_by;

  if old.status in ('approved','issued','sent','archived') and (
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
    raise exception 'Approved or issued correspondence is immutable. Return it to review or create a correction letter.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status not in ('in_review') then
      raise exception 'Drafts must be submitted for review before approval.';
    elsif old.status = 'in_review' and new.status not in ('draft','approved') then
      raise exception 'Only correspondence in review can be approved.';
    elsif old.status = 'approved' and new.status not in ('in_review','issued') then
      raise exception 'Only approved correspondence can be issued or returned to review.';
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
    if v_client_id is not null and new.apply_signature and (
      v_signer is null or btrim(coalesce(new.sender_name,'')) is distinct from btrim(v_signer)
    ) then
      raise exception 'The signer name must match the signatory approved in the cargo-owner representation profile.';
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

comment on table public.office_company_profiles is
  'Separate letterhead, seal, signature and representation authorization for the brokerage and every registered cargo owner.';


-- The company identity and visual assets used for an issued letter must be frozen
-- on that letter. Later profile changes must never rewrite historical printouts.
alter table public.office_correspondence
  add column if not exists issued_company_name text,
  add column if not exists issued_company_national_id text,
  add column if not exists issued_company_economic_code text,
  add column if not exists issued_company_registration_number text,
  add column if not exists issued_company_address text,
  add column if not exists issued_company_phone text,
  add column if not exists issued_company_email text,
  add column if not exists issued_signer_name text,
  add column if not exists issued_letterhead_storage_path text,
  add column if not exists issued_stamp_storage_path text,
  add column if not exists issued_signature_storage_path text,
  add column if not exists issued_authorization_storage_path text,
  add column if not exists issued_authority_reference text,
  add column if not exists issued_authority_valid_until date,
  add column if not exists issued_authority_approved_by uuid,
  add column if not exists issued_authority_approved_at timestamptz;

-- Counter rows are managed only by a trusted trigger. Direct API writes would
-- let a staff member forge or skip official numbers.
revoke all on public.office_registry_counters from anon, authenticated;

-- The event table is read-only through the Data API. The audit trigger owns writes.
revoke insert, update, delete on public.office_correspondence_events from anon, authenticated;
grant select on public.office_correspondence_events to authenticated;
drop policy if exists office_correspondence_events_staff_insert on public.office_correspondence_events;

-- Profiles are not deletable through the application API. Historical correspondence
-- must remain attached to the correct cargo-owner/company profile.
drop policy if exists office_company_profiles_staff_all on public.office_company_profiles;
drop policy if exists office_company_profiles_staff_select on public.office_company_profiles;
create policy office_company_profiles_staff_select
on public.office_company_profiles for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in (
    'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
    'accountant'::public.user_role,'warehouse'::public.user_role
  )
);
create policy office_company_profiles_manager_insert
on public.office_company_profiles for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and created_by = auth.uid()
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
);
create policy office_company_profiles_manager_update
on public.office_company_profiles for update to authenticated
using (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
)
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
);

create or replace function public.office_company_profile_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_expected_folder text;
  v_path text;
  v_role public.user_role;
  v_authority_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.client_id is distinct from old.client_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Company profile identity and ownership cannot be changed.';
    end if;
  end if;

  if auth.uid() is not null then
    if new.organization_id is distinct from public.user_org_id() then
      raise exception 'Company profile organization does not match the authenticated user.';
    end if;
    v_role := public.user_role();

    if tg_op = 'INSERT' then
      if v_role = 'client'::public.user_role then
        if new.client_id is distinct from public.user_client_id()
          or new.authority_status not in ('not_provided','pending') then
          raise exception 'Clients can only create their own unapproved company profile.';
        end if;
      elsif v_role is null or v_role not in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role) then
        raise exception 'This role cannot create company document profiles.';
      end if;
      if new.client_id is not null and new.authority_status in ('approved','not_required') then
        raise exception 'A cargo-owner representation profile cannot be created as approved or exempt.';
      end if;
      new.created_by := auth.uid();
      new.authority_approved_by := null;
      new.authority_approved_at := null;
    else
      if v_role is null or v_role not in (
        'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'client'::public.user_role
      ) then
        raise exception 'This role cannot update company document profiles.';
      end if;
      if v_role = 'client'::public.user_role and (
        new.client_id is distinct from public.user_client_id()
        or new.authority_status not in ('not_provided','pending')
      ) then
        raise exception 'Clients can only update their own unapproved representation profile.';
      end if;
      if new.client_id is not null and new.authority_status = 'not_required' then
        raise exception 'Legal representation cannot be waived for a registered cargo-owner company.';
      end if;

      v_authority_changed :=
        new.company_name is distinct from old.company_name
        or new.national_id is distinct from old.national_id
        or new.economic_code is distinct from old.economic_code
        or new.registration_number is distinct from old.registration_number
        or new.address is distinct from old.address
        or new.phone is distinct from old.phone
        or new.email is distinct from old.email
        or new.authorized_signer_name is distinct from old.authorized_signer_name
        or new.authority_reference is distinct from old.authority_reference
        or new.authority_valid_until is distinct from old.authority_valid_until
        or new.letterhead_storage_path is distinct from old.letterhead_storage_path
        or new.stamp_storage_path is distinct from old.stamp_storage_path
        or new.signature_storage_path is distinct from old.signature_storage_path
        or new.authorization_storage_path is distinct from old.authorization_storage_path;

      if v_authority_changed then
        if new.authority_status = 'approved' then
          raise exception 'Save representation evidence first, then approve it in a separate step.';
        end if;
        new.authority_status := 'pending';
        new.authority_approved_by := null;
        new.authority_approved_at := null;
      elsif new.authority_status = 'approved' and old.authority_status is distinct from 'approved' then
        if v_role is null or v_role not in ('owner'::public.user_role,'admin'::public.user_role) then
          raise exception 'Only an organization owner or admin can approve legal representation.';
        end if;
        if new.client_id is not null and (
          new.authorization_storage_path is null
          or nullif(btrim(new.authority_reference), '') is null
          or nullif(btrim(new.authorized_signer_name), '') is null
          or (new.authority_valid_until is not null and new.authority_valid_until < current_date)
        ) then
          raise exception 'A current authorization document, reference and authorized signatory are required.';
        end if;
        new.authority_approved_by := auth.uid();
        new.authority_approved_at := now();
      elsif new.authority_status in ('revoked','not_required')
        and old.authority_status is distinct from new.authority_status
        and (v_role is null or v_role not in ('owner'::public.user_role,'admin'::public.user_role)) then
        raise exception 'Only an organization owner or admin can revoke or waive representation authorization.';
      elsif new.authority_status <> 'approved' then
        new.authority_approved_by := null;
        new.authority_approved_at := null;
      else
        new.authority_approved_by := old.authority_approved_by;
        new.authority_approved_at := old.authority_approved_at;
      end if;
    end if;
  end if;

  v_expected_folder := coalesce(new.client_id::text, 'organization');
  foreach v_path in array array[
    new.letterhead_storage_path,
    new.stamp_storage_path,
    new.signature_storage_path,
    new.authorization_storage_path
  ] loop
    if v_path is not null and (
      split_part(v_path, '/', 1) <> new.organization_id::text
      or split_part(v_path, '/', 2) <> v_expected_folder
      or split_part(v_path, '/', 3) <> 'assets'
    ) then
      raise exception 'Company asset path must remain inside this company profile folder.';
    end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists office_company_profile_guard_trigger on public.office_company_profiles;
create trigger office_company_profile_guard_trigger
before insert or update on public.office_company_profiles
for each row execute function public.office_company_profile_guard();

-- Keep SECURITY DEFINER functions out of exposed public schema. Fixed search_path
-- and explicit auth/tenant checks are used because these functions own counters
-- and append-only event writes that authenticated users must not mutate directly.
create schema if not exists office_private;
revoke all on schema office_private from public, anon, authenticated;

create or replace function office_private.office_correspondence_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid;
  v_authority_status text;
  v_authority_valid_until date;
  v_stamp_path text;
  v_signature_path text;
  v_next bigint;
  v_company_name text;
  v_national_id text;
  v_economic_code text;
  v_registration_number text;
  v_address text;
  v_phone text;
  v_email text;
  v_signer text;
  v_letterhead text;
  v_authority_path text;
  v_authority_reference text;
  v_authority_valid_until date;
  v_authority_approved_by uuid;
  v_authority_approved_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'An authenticated actor is required for correspondence changes.';
  end if;
  if new.organization_id is distinct from public.user_org_id() then
    raise exception 'Correspondence organization does not match the authenticated user.';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A new correspondence must start as a draft.';
    end if;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.approved_by := null;
    new.approved_at := null;
    new.issued_by := null;
    new.issued_at := null;
    new.sent_at := null;
    new.archived_at := null;
    new.sequence_number := null;
    new.registry_no := null;
    new.issued_company_name := null;
    new.issued_company_national_id := null;
    new.issued_company_economic_code := null;
    new.issued_company_registration_number := null;
    new.issued_company_address := null;
    new.issued_company_phone := null;
    new.issued_company_email := null;
    new.issued_signer_name := null;
    new.issued_letterhead_storage_path := null;
    new.issued_stamp_storage_path := null;
    new.issued_signature_storage_path := null;
    new.issued_authorization_storage_path := null;
    new.issued_authority_reference := null;
    new.issued_authority_valid_until := null;
    new.issued_authority_approved_by := null;
    new.issued_authority_approved_at := null;
    return new;
  end if;

  if old.organization_id is distinct from new.organization_id
    or old.company_profile_id is distinct from new.company_profile_id
    or old.id is distinct from new.id
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at then
    raise exception 'Correspondence identity, owner and company cannot be changed.';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  if old.status in ('approved','issued','sent','archived') and (
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
    raise exception 'Approved or issued correspondence is immutable. Return it to review or create a correction letter.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status <> 'in_review' then
      raise exception 'Drafts must be submitted for review before approval.';
    elsif old.status = 'in_review' and new.status not in ('draft','approved') then
      raise exception 'Only correspondence in review can be approved.';
    elsif old.status = 'approved' and new.status not in ('in_review','issued') then
      raise exception 'Only approved correspondence can be issued or returned to review.';
    elsif old.status = 'issued' and new.status not in ('sent','archived') then
      raise exception 'Issued correspondence can only be marked sent or archived.';
    elsif old.status = 'sent' and new.status <> 'archived' then
      raise exception 'Sent correspondence can only be archived.';
    elsif old.status = 'archived' then
      raise exception 'Archived correspondence cannot be changed.';
    end if;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role) then
      raise exception 'Only an authorized manager can approve correspondence.';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'in_review' and old.status = 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;

  if new.status = 'issued' and old.status is distinct from 'issued' then
    if old.status <> 'approved' or new.approved_by is null or new.approved_at is null then
      raise exception 'Correspondence needs recorded approval before issue.';
    end if;
    if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role) then
      raise exception 'Only an authorized manager can issue correspondence.';
    end if;

    select p.client_id, p.authority_status, p.authority_valid_until,
           p.stamp_storage_path, p.signature_storage_path,
           p.company_name, p.national_id, p.economic_code, p.registration_number,
           p.address, p.phone, p.email, p.authorized_signer_name, p.letterhead_storage_path,
           p.authorization_storage_path, p.authority_reference,
           p.authority_approved_by, p.authority_approved_at
      into v_client_id, v_authority_status, v_authority_valid_until,
           v_stamp_path, v_signature_path,
           v_company_name, v_national_id, v_economic_code, v_registration_number,
           v_address, v_phone, v_email, v_signer, v_letterhead,
           v_authority_path, v_authority_reference, v_authority_approved_by, v_authority_approved_at
      from public.office_company_profiles p
     where p.id = new.company_profile_id
       and p.organization_id = new.organization_id
     for share;

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
    do update set last_value = public.office_registry_counters.last_value + 1, updated_at = now()
    returning last_value into v_next;

    new.sequence_number := v_next;
    new.registry_no := new.year_key || '/' ||
      case new.direction when 'incoming' then 'IN' when 'outgoing' then 'OUT' else 'INT' end
      || '/' || lpad(v_next::text, 6, '0');
    new.issued_by := auth.uid();
    new.issued_at := now();

    new.issued_company_name := v_company_name;
    new.issued_company_national_id := v_national_id;
    new.issued_company_economic_code := v_economic_code;
    new.issued_company_registration_number := v_registration_number;
    new.issued_company_address := v_address;
    new.issued_company_phone := v_phone;
    new.issued_company_email := v_email;
    new.issued_signer_name := coalesce(new.sender_name, v_signer);
    new.issued_letterhead_storage_path := v_letterhead;
    new.issued_stamp_storage_path := case when new.apply_stamp then v_stamp_path else null end;
    new.issued_signature_storage_path := case when new.apply_signature then v_signature_path else null end;
    new.issued_authorization_storage_path := v_authority_path;
    new.issued_authority_reference := v_authority_reference;
    new.issued_authority_valid_until := v_authority_valid_until;
    new.issued_authority_approved_by := v_authority_approved_by;
    new.issued_authority_approved_at := v_authority_approved_at;
  else
    new.sequence_number := old.sequence_number;
    new.registry_no := old.registry_no;
    new.issued_by := old.issued_by;
    new.issued_at := old.issued_at;
    new.issued_company_name := old.issued_company_name;
    new.issued_company_national_id := old.issued_company_national_id;
    new.issued_company_economic_code := old.issued_company_economic_code;
    new.issued_company_registration_number := old.issued_company_registration_number;
    new.issued_company_address := old.issued_company_address;
    new.issued_company_phone := old.issued_company_phone;
    new.issued_company_email := old.issued_company_email;
    new.issued_signer_name := old.issued_signer_name;
    new.issued_letterhead_storage_path := old.issued_letterhead_storage_path;
    new.issued_stamp_storage_path := old.issued_stamp_storage_path;
    new.issued_signature_storage_path := old.issued_signature_storage_path;
    new.issued_authorization_storage_path := old.issued_authorization_storage_path;
    new.issued_authority_reference := old.issued_authority_reference;
    new.issued_authority_valid_until := old.issued_authority_valid_until;
    new.issued_authority_approved_by := old.issued_authority_approved_by;
    new.issued_authority_approved_at := old.issued_authority_approved_at;
  end if;

  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  else
    new.sent_at := old.sent_at;
  end if;
  if new.status = 'archived' and old.status is distinct from 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := old.archived_at;
  end if;
  return new;
end;
$$;

create or replace function office_private.office_correspondence_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
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
drop trigger if exists office_correspondence_audit_trigger on public.office_correspondence;
create trigger office_correspondence_guard_trigger
before insert or update on public.office_correspondence
for each row execute function office_private.office_correspondence_guard();
create trigger office_correspondence_audit_trigger
after insert or update on public.office_correspondence
for each row execute function office_private.office_correspondence_audit();

drop function if exists public.office_correspondence_guard();
drop function if exists public.office_correspondence_audit();

revoke all on public.office_registry_counters from anon, authenticated;
revoke insert, update, delete on public.office_correspondence_events from anon, authenticated;
grant select on public.office_correspondence_events to authenticated;


create or replace function public.office_correspondence_attachment_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_client_id uuid;
  v_expected_folder text;
begin
  if tg_op = 'INSERT' then
    select p.client_id into v_client_id
    from public.office_correspondence c
    join public.office_company_profiles p
      on p.id = c.company_profile_id and p.organization_id = c.organization_id
    where c.id = new.correspondence_id
      and c.organization_id = new.organization_id;
    if not found then
      raise exception 'Correspondence profile was not found for attachment.';
    end if;
  else
    raise exception 'Correspondence attachments are immutable; upload a new attachment instead.';
  end if;
  v_expected_folder := coalesce(v_client_id::text, 'organization');
  if split_part(new.storage_path, '/', 1) <> new.organization_id::text
    or split_part(new.storage_path, '/', 2) <> v_expected_folder
    or split_part(new.storage_path, '/', 3) <> 'letters'
    or split_part(new.storage_path, '/', 4) <> new.correspondence_id::text then
    raise exception 'Attachment path must belong to the selected company and correspondence.';
  end if;
  return new;
end;
$$;
drop trigger if exists office_correspondence_attachment_guard_trigger on public.office_correspondence_attachments;
create trigger office_correspondence_attachment_guard_trigger
before insert or update on public.office_correspondence_attachments
for each row execute function public.office_correspondence_attachment_guard();


-- Permit storage cleanup only while the associated letter is a deletable draft.
-- Company identity assets and issued / sent / archived attachments have no delete
-- policy and remain available to preserve historical snapshots.
drop policy if exists office_documents_delete_draft_attachments on storage.objects;
create policy office_documents_delete_draft_attachments
on storage.objects for delete to authenticated
using (
  bucket_id = 'office-documents'
  and (storage.foldername(name))[1] = (select public.user_org_id())::text
  and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
  and exists (
    select 1
    from public.office_correspondence_attachments a
    join public.office_correspondence c
      on c.id = a.correspondence_id
     and c.organization_id = a.organization_id
    where a.storage_path = name
      and a.organization_id = (select public.user_org_id())
      and c.status = 'draft'
  )
);
