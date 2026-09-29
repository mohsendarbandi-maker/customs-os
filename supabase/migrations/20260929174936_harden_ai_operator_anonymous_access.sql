drop policy if exists ai_action_proposals_org on public.ai_action_proposals;
create policy ai_action_proposals_org on public.ai_action_proposals
for all to authenticated
using (organization_id = public.user_org_id())
with check (organization_id = public.user_org_id());

drop policy if exists ai_evidence_org on public.ai_evidence;
create policy ai_evidence_org on public.ai_evidence
for all to authenticated
using (organization_id = public.user_org_id())
with check (organization_id = public.user_org_id());

drop policy if exists ai_interactions_org on public.ai_interactions;
create policy ai_interactions_org on public.ai_interactions
for all to authenticated
using (organization_id = public.user_org_id())
with check (organization_id = public.user_org_id());

drop policy if exists ai_risk_findings_org on public.ai_risk_findings;
create policy ai_risk_findings_org on public.ai_risk_findings
for all to authenticated
using (organization_id = public.user_org_id())
with check (organization_id = public.user_org_id());

revoke execute on function public.owner_insert_profile(uuid,public.user_role,uuid,text,text) from anon;
revoke execute on function public.owner_update_profile(uuid,public.user_role,uuid,text,text,boolean) from anon;
revoke execute on function public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz) from anon;
