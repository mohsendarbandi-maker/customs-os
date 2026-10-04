create policy "ai_operator_commands_insert"
on public.ai_operator_commands
for insert
to authenticated
with check (
  organization_id = (select public.user_org_id())
  and user_id = (select auth.uid())
);

create policy "ai_operator_commands_update"
on public.ai_operator_commands
for update
to authenticated
using (
  organization_id = (select public.user_org_id())
  and user_id = (select auth.uid())
)
with check (
  organization_id = (select public.user_org_id())
  and user_id = (select auth.uid())
);
