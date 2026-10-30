-- Consolidate tenant and role policies to avoid redundant permissive-policy evaluation,
-- make auth.uid() initplan-stable, and cover office-module foreign keys.

drop policy if exists office_company_profiles_client_select on public.office_company_profiles;
drop policy if exists office_company_profiles_staff_select on public.office_company_profiles;
create policy office_company_profiles_select
on public.office_company_profiles for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (
    ((select public.user_role()) = 'client'::public.user_role
      and client_id = (select public.user_client_id()))
    or (select public.user_role()) in (
      'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
      'accountant'::public.user_role,'warehouse'::public.user_role
    )
  )
);

drop policy if exists office_company_profiles_client_insert on public.office_company_profiles;
drop policy if exists office_company_profiles_manager_insert on public.office_company_profiles;
create policy office_company_profiles_insert
on public.office_company_profiles for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (
    ((select public.user_role()) = 'client'::public.user_role
      and client_id = (select public.user_client_id())
      and authority_status in ('not_provided','pending')
      and authority_approved_by is null and authority_approved_at is null)
    or (
      (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
      and created_by = (select auth.uid())
    )
  )
);

drop policy if exists office_company_profiles_client_update on public.office_company_profiles;
drop policy if exists office_company_profiles_manager_update on public.office_company_profiles;
create policy office_company_profiles_update
on public.office_company_profiles for update to authenticated
using (
  organization_id = (select public.user_org_id())
  and (
    ((select public.user_role()) = 'client'::public.user_role
      and client_id = (select public.user_client_id()))
    or (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
  )
)
with check (
  organization_id = (select public.user_org_id())
  and (
    ((select public.user_role()) = 'client'::public.user_role
      and client_id = (select public.user_client_id())
      and authority_status in ('not_provided','pending')
      and authority_approved_by is null and authority_approved_at is null)
    or (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)
  )
);

drop policy if exists office_correspondence_client_select on public.office_correspondence;
drop policy if exists office_correspondence_staff_select on public.office_correspondence;
create policy office_correspondence_select
on public.office_correspondence for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (
    (select public.user_role()) in (
      'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
      'accountant'::public.user_role,'warehouse'::public.user_role
    )
    or (
      (select public.user_role()) = 'client'::public.user_role
      and visible_to_client
      and exists (
        select 1 from public.office_company_profiles p
        where p.id = office_correspondence.company_profile_id
          and p.organization_id = office_correspondence.organization_id
          and p.client_id = (select public.user_client_id())
      )
    )
  )
);

drop policy if exists office_correspondence_attachments_client_select on public.office_correspondence_attachments;
drop policy if exists office_correspondence_attachments_staff_select on public.office_correspondence_attachments;
create policy office_correspondence_attachments_select
on public.office_correspondence_attachments for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or exists (
      select 1
      from public.office_correspondence c
      join public.office_company_profiles p
        on p.id = c.company_profile_id and p.organization_id = c.organization_id
      where c.id = office_correspondence_attachments.correspondence_id
        and c.organization_id = office_correspondence_attachments.organization_id
        and c.visible_to_client
        and p.client_id = (select public.user_client_id())
    )
  )
);

drop policy if exists office_correspondence_events_client_select on public.office_correspondence_events;
drop policy if exists office_correspondence_events_staff_select on public.office_correspondence_events;
create policy office_correspondence_events_select
on public.office_correspondence_events for select to authenticated
using (
  organization_id = (select public.user_org_id())
  and (
    (select public.user_role()) <> 'client'::public.user_role
    or exists (
      select 1
      from public.office_correspondence c
      join public.office_company_profiles p
        on p.id = c.company_profile_id and p.organization_id = c.organization_id
      where c.id = office_correspondence_events.correspondence_id
        and c.organization_id = office_correspondence_events.organization_id
        and c.visible_to_client
        and p.client_id = (select public.user_client_id())
    )
  )
);

drop policy if exists office_correspondence_staff_insert on public.office_correspondence;
create policy office_correspondence_staff_insert
on public.office_correspondence for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) in (
    'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
    'accountant'::public.user_role,'warehouse'::public.user_role
  )
  and created_by = (select auth.uid())
  and status = 'draft'
);

drop policy if exists office_correspondence_attachments_staff_insert on public.office_correspondence_attachments;
create policy office_correspondence_attachments_staff_insert
on public.office_correspondence_attachments for insert to authenticated
with check (
  organization_id = (select public.user_org_id())
  and created_by = (select auth.uid())
  and (select public.user_role()) in (
    'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,
    'accountant'::public.user_role,'warehouse'::public.user_role
  )
  and exists (
    select 1 from public.office_correspondence c
    where c.id = office_correspondence_attachments.correspondence_id
      and c.organization_id = office_correspondence_attachments.organization_id
      and c.status in ('draft','in_review')
  )
);

create index if not exists office_company_profiles_authority_approved_by_idx
  on public.office_company_profiles (authority_approved_by);
create index if not exists office_company_profiles_client_org_fk_idx
  on public.office_company_profiles (client_id, organization_id);
create index if not exists office_company_profiles_created_by_idx
  on public.office_company_profiles (created_by);
create index if not exists office_correspondence_approved_by_idx
  on public.office_correspondence (approved_by);
create index if not exists office_correspondence_created_by_idx
  on public.office_correspondence (created_by);
create index if not exists office_correspondence_issued_by_idx
  on public.office_correspondence (issued_by);
create index if not exists office_correspondence_parent_org_fk_idx
  on public.office_correspondence (parent_id, organization_id);
create index if not exists office_correspondence_profile_org_fk_idx
  on public.office_correspondence (company_profile_id, organization_id);
create index if not exists office_correspondence_updated_by_idx
  on public.office_correspondence (updated_by);
create index if not exists office_correspondence_attachments_created_by_idx
  on public.office_correspondence_attachments (created_by);
create index if not exists office_correspondence_attachments_parent_org_fk_idx
  on public.office_correspondence_attachments (correspondence_id, organization_id);
create index if not exists office_correspondence_events_actor_id_idx
  on public.office_correspondence_events (actor_id);
create index if not exists office_correspondence_events_parent_org_fk_idx
  on public.office_correspondence_events (correspondence_id, organization_id);
create index if not exists office_registry_counters_profile_org_fk_idx
  on public.office_registry_counters (company_profile_id, organization_id);
