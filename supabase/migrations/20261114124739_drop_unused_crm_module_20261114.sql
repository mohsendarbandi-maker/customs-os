-- Remove the unused CRM feature from the application schema.
-- Confirmed empty: CRM contacts, leads, deals, quotes, activities,
-- imports, saved views, deduplication and automation records.
-- Keep audit_logs and all core Customs OS entities/history untouched.
begin;

-- Stop creating CRM sales pipelines when a new organization is registered.
drop trigger if exists trg_organizations_crm_defaults on public.organizations;
drop function if exists public.trg_ensure_crm_default_pipeline();
drop function if exists public.ensure_crm_default_pipeline(uuid);

-- Remove CRM-owned data structures. No live business records exist in these tables.
drop table if exists
  public.crm_activities,
  public.crm_automation_runs,
  public.crm_automation_rules,
  public.crm_quote_items,
  public.crm_quotes,
  public.crm_entity_tags,
  public.crm_dedupe_clusters,
  public.crm_import_jobs,
  public.crm_saved_views,
  public.crm_custom_field_values,
  public.crm_custom_fields,
  public.crm_deals,
  public.crm_leads,
  public.crm_contacts,
  public.crm_pipeline_stages,
  public.crm_pipelines,
  public.crm_tags
cascade;

-- Remove CRM-only RPCs after dependent CRM tables and policies are gone.
drop function if exists public.crm_convert_quote_to_case_and_invoice(uuid);
drop function if exists public.crm_deal_age(uuid);
drop function if exists public.crm_merge_contacts(uuid, uuid, text);
drop function if exists public.crm_monthly_forecast(uuid);
drop function if exists public.crm_org_accessible(uuid);
drop function if exists public.crm_sales_funnel(uuid);
drop function if exists public.crm_undo_merge(uuid);
drop function if exists public.crm_user_performance(uuid);
drop function if exists public.crm_win_rate(uuid);

commit;
