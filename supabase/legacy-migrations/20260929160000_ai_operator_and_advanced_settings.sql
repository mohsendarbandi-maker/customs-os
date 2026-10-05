-- Customs OS AI Operator + Owner Advanced Settings
-- Applied to Supabase project on 2026-09-29

create extension if not exists pgcrypto;

create table if not exists public.ai_gateway_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  online_enabled boolean not null default true,
  preferred_provider text not null default 'gemini' check (preferred_provider in ('cloudflare','gemini','groq','openrouter','openai')),
  fallback_providers text[] not null default array['cloudflare','groq','openrouter','openai'],
  confidence_threshold numeric(4,3) not null default 0.75 check (confidence_threshold >= 0 and confidence_threshold <= 1),
  redaction_enabled boolean not null default true,
  max_commands_per_minute integer not null default 20 check (max_commands_per_minute between 1 and 120),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_requirement_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_name text not null,
  document_type text not null,
  condition_json jsonb not null default '{}'::jsonb,
  required boolean not null default true,
  priority integer not null default 100,
  note text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, rule_name)
);

create table if not exists public.print_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_key text not null,
  name text not null,
  document_type text not null,
  html_template text not null default '',
  css_text text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, template_key)
);

create table if not exists public.ai_operator_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  session_id text,
  natural_command text not null,
  page_context text,
  module text,
  action_code text,
  target jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  risk_level text not null default 'safe' check (risk_level in ('safe','requires_confirmation','destructive')),
  status text not null default 'proposed' check (status in ('proposed','awaiting_confirmation','executing','executed','failed','rejected','clarification_needed','cancelled')),
  confirmation_required boolean not null default false,
  confirmation_at timestamptz,
  final_confirmation_phrase text,
  final_confirmation_at timestamptz,
  matched_record_id uuid,
  before_data jsonb,
  after_data jsonb,
  result jsonb,
  error_message text,
  executed_by uuid references public.profiles(id) on delete set null,
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ai_operator_commands_user_created_idx on public.ai_operator_commands(user_id, created_at desc);
create index if not exists ai_operator_commands_org_status_idx on public.ai_operator_commands(organization_id, status, created_at desc);
create index if not exists document_requirement_rules_org_idx on public.document_requirement_rules(organization_id, is_active, priority);
create index if not exists print_templates_org_idx on public.print_templates(organization_id, is_active);
create index if not exists ai_gateway_settings_org_idx on public.ai_gateway_settings(organization_id);

alter table public.ai_gateway_settings enable row level security;
alter table public.document_requirement_rules enable row level security;
alter table public.print_templates enable row level security;
alter table public.ai_operator_commands enable row level security;

drop policy if exists ai_gateway_settings_select on public.ai_gateway_settings;
create policy ai_gateway_settings_select on public.ai_gateway_settings for select to authenticated using (organization_id=public.user_org_id());
drop policy if exists ai_gateway_settings_insert on public.ai_gateway_settings;
create policy ai_gateway_settings_insert on public.ai_gateway_settings for insert to authenticated with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists ai_gateway_settings_update on public.ai_gateway_settings;
create policy ai_gateway_settings_update on public.ai_gateway_settings for update to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role) with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists ai_gateway_settings_delete on public.ai_gateway_settings;
create policy ai_gateway_settings_delete on public.ai_gateway_settings for delete to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);

drop policy if exists document_requirement_rules_select on public.document_requirement_rules;
create policy document_requirement_rules_select on public.document_requirement_rules for select to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists document_requirement_rules_insert on public.document_requirement_rules;
create policy document_requirement_rules_insert on public.document_requirement_rules for insert to authenticated with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists document_requirement_rules_update on public.document_requirement_rules;
create policy document_requirement_rules_update on public.document_requirement_rules for update to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role) with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists document_requirement_rules_delete on public.document_requirement_rules;
create policy document_requirement_rules_delete on public.document_requirement_rules for delete to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);

drop policy if exists print_templates_select on public.print_templates;
create policy print_templates_select on public.print_templates for select to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists print_templates_insert on public.print_templates;
create policy print_templates_insert on public.print_templates for insert to authenticated with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists print_templates_update on public.print_templates;
create policy print_templates_update on public.print_templates for update to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role) with check (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);
drop policy if exists print_templates_delete on public.print_templates;
create policy print_templates_delete on public.print_templates for delete to authenticated using (organization_id=public.user_org_id() and public.user_role()='owner'::public.user_role);

drop policy if exists ai_operator_commands_select on public.ai_operator_commands;
create policy ai_operator_commands_select on public.ai_operator_commands for select to authenticated using (organization_id=public.user_org_id() and user_id=auth.uid());
drop policy if exists ai_operator_commands_insert on public.ai_operator_commands;
create policy ai_operator_commands_insert on public.ai_operator_commands for insert to authenticated with check (organization_id=public.user_org_id() and user_id=auth.uid());
drop policy if exists ai_operator_commands_update on public.ai_operator_commands;
create policy ai_operator_commands_update on public.ai_operator_commands for update to authenticated using (organization_id=public.user_org_id() and user_id=auth.uid()) with check (organization_id=public.user_org_id() and user_id=auth.uid());
revoke delete on public.ai_operator_commands from anon, authenticated;

create or replace function public.prevent_ai_operator_command_tampering()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id
     or new.session_id is distinct from old.session_id or new.natural_command is distinct from old.natural_command
     or new.page_context is distinct from old.page_context or new.module is distinct from old.module
     or new.action_code is distinct from old.action_code or new.target is distinct from old.target
     or new.plan is distinct from old.plan or new.confidence is distinct from old.confidence
     or new.risk_level is distinct from old.risk_level or new.created_at is distinct from old.created_at
     or new.final_confirmation_phrase is distinct from old.final_confirmation_phrase
  then raise exception 'AI Operator command plan is immutable after creation'; end if;
  if old.status='executed' and new.status <> 'executed' then raise exception 'Executed AI Operator command cannot move backward'; end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists tr_ai_operator_command_tamper on public.ai_operator_commands;
create trigger tr_ai_operator_command_tamper before update on public.ai_operator_commands for each row execute function public.prevent_ai_operator_command_tampering();
drop trigger if exists tr_audit_ai_operator_commands on public.ai_operator_commands;
create trigger tr_audit_ai_operator_commands after insert or update on public.ai_operator_commands for each row execute function public.record_audit_event();
drop trigger if exists tr_audit_ai_gateway_settings on public.ai_gateway_settings;
create trigger tr_audit_ai_gateway_settings after insert or update or delete on public.ai_gateway_settings for each row execute function public.record_audit_event();
drop trigger if exists tr_audit_document_requirement_rules on public.document_requirement_rules;
create trigger tr_audit_document_requirement_rules after insert or update or delete on public.document_requirement_rules for each row execute function public.record_audit_event();
drop trigger if exists tr_audit_print_templates on public.print_templates;
create trigger tr_audit_print_templates after insert or update or delete on public.print_templates for each row execute function public.record_audit_event();
drop trigger if exists tr_audit_profiles on public.profiles;
create trigger tr_audit_profiles after insert or update on public.profiles for each row execute function public.record_audit_event();

create or replace function public.owner_insert_profile(p_user_id uuid,p_role public.user_role,p_client_id uuid,p_full_name text,p_phone text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid:=public.user_org_id(); v_row public.profiles;
begin
  if auth.uid() is null or public.user_role() <> 'owner'::public.user_role then raise exception 'Only the organization owner can create user profiles'; end if;
  if p_user_id is null or v_org is null then raise exception 'User and organization are required'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then
    raise exception 'Client association does not belong to the organization';
  end if;
  insert into public.profiles(id,organization_id,role,client_id,full_name,phone,is_active,created_at,updated_at)
  values(p_user_id,v_org,p_role,p_client_id,nullif(trim(p_full_name),''),nullif(trim(p_phone),''),true,now(),now())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.owner_insert_profile(uuid,public.user_role,uuid,text,text) from public, anon, authenticated;
grant execute on function public.owner_insert_profile(uuid,public.user_role,uuid,text,text) to authenticated;
