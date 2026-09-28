-- Fix declaration checklist RLS.
-- The initializer is intentionally security-invoker and therefore needs
-- tenant-scoped INSERT access. The frontend also needs tenant-scoped SELECT.
drop policy if exists "declaration_checklist_items_select_org" on public.declaration_checklist_items;
drop policy if exists "declaration_checklist_items_insert_org" on public.declaration_checklist_items;
drop policy if exists "declaration_checklist_items_update_org" on public.declaration_checklist_items;

create policy "declaration_checklist_items_select_org"
on public.declaration_checklist_items
for select
to authenticated
using (organization_id = (select public.user_org_id()));

create policy "declaration_checklist_items_insert_org"
on public.declaration_checklist_items
for insert
to authenticated
with check (organization_id = (select public.user_org_id()));

create policy "declaration_checklist_items_update_org"
on public.declaration_checklist_items
for update
to authenticated
using (organization_id = (select public.user_org_id()))
with check (organization_id = (select public.user_org_id()));
