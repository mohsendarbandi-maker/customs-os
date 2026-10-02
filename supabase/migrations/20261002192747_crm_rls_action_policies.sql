do $$ declare t text;begin
 for t in select unnest(array['crm_tags','crm_entity_tags','crm_custom_fields','crm_custom_field_values','crm_saved_views','crm_import_jobs','crm_dedupe_clusters','crm_automation_rules','crm_automation_runs']) loop
  execute format('drop policy if exists crm_org_write on public.%I',t);
  execute format('drop policy if exists crm_org_delete on public.%I',t);
  execute format('drop policy if exists crm_org_insert on public.%I',t);
  execute format('drop policy if exists crm_org_update on public.%I',t);
  execute format('create policy crm_org_insert on public.%I for insert to authenticated with check (organization_id=(select public.user_org_id()) and (select public.user_role()) in (''owner''::user_role,''admin''::user_role,''broker''::user_role))',t);
  execute format('create policy crm_org_update on public.%I for update to authenticated using (organization_id=(select public.user_org_id()) and (select public.user_role()) in (''owner''::user_role,''admin''::user_role,''broker''::user_role)) with check (organization_id=(select public.user_org_id()) and (select public.user_role()) in (''owner''::user_role,''admin''::user_role,''broker''::user_role))',t);
  execute format('create policy crm_org_delete on public.%I for delete to authenticated using (organization_id=(select public.user_org_id()) and (select public.user_role()) in (''owner''::user_role,''admin''::user_role))',t);
 end loop;
end $$;