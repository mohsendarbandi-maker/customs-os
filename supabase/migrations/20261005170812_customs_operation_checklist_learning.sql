begin;

alter table public.shipments
  add column if not exists ship_passed boolean not null default false,
  add column if not exists ship_passed_at timestamptz,
  add column if not exists ship_passed_by uuid references auth.users(id);

alter table public.declaration_checklist_items
  add column if not exists item_label text,
  add column if not exists note text,
  add column if not exists note_updated_at timestamptz,
  add column if not exists note_updated_by uuid references auth.users(id),
  add column if not exists sort_order integer not null default 100,
  add column if not exists source text not null default 'legacy',
  add column if not exists is_active boolean not null default true;

update public.declaration_checklist_items
set item_label=coalesce(nullif(item_label,''),item_key)
where item_label is null or item_label='';

update public.declaration_checklist_items
set is_active=false
where item_key in ('در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار');

alter table public.declaration_checklist_items alter column item_label set not null;

update public.declaration_checklist_items
set sort_order=case item_key
  when 'مالیات علی الحساب' then 40
  when 'درخواست ضمانتنامه حقوق ورودی و ارزش افزوده' then 50
  when 'ارزیابی' then 60
  when 'آزمایشگاه' then 70
  when 'مجوز استاندارد' then 80
  when 'نوبت کارشناسی' then 90
  when 'کد ساتا' then 100
  when 'تبصره دو منطقه آزاد' then 110
  else sort_order
end;

create index if not exists declaration_checklist_items_declaration_active_idx
on public.declaration_checklist_items(declaration_id,is_active,sort_order);

create table if not exists public.customs_operation_rules(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_name text not null,
  hs_code_prefix text not null,
  customs_path text not null default '',
  transport_mode text not null default '',
  checklist_counts jsonb not null default '{}'::jsonb,
  field_counts jsonb not null default '{}'::jsonb,
  workflow_stages integer[] not null default array[4,6],
  evidence_count integer not null default 0 check(evidence_count>=0),
  confidence numeric(5,4) not null default 0 check(confidence between 0 and 1),
  source text not null default 'manual' check(source in ('manual','learned')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,hs_code_prefix,customs_path,transport_mode)
);

create index if not exists customs_operation_rules_match_idx
on public.customs_operation_rules(organization_id,hs_code_prefix,customs_path,transport_mode,is_active);

create table if not exists public.customs_operation_learning_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  declaration_id uuid not null references public.customs_declarations(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  hs_code text not null,
  customs_path text not null default '',
  checklist_snapshot jsonb not null default '[]'::jsonb,
  field_snapshot jsonb not null default '{}'::jsonb,
  workflow_stages integer[] not null default array[4,6],
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(declaration_id)
);

create index if not exists customs_operation_learning_events_match_idx
on public.customs_operation_learning_events(organization_id,hs_code,customs_path,created_at desc);

alter table public.customs_operation_rules enable row level security;
alter table public.customs_operation_learning_events enable row level security;

grant select,insert,update,delete on public.customs_operation_rules to authenticated;
grant select on public.customs_operation_learning_events to authenticated;

drop policy if exists customs_operation_rules_select on public.customs_operation_rules;
create policy customs_operation_rules_select on public.customs_operation_rules
for select to authenticated
using(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker','warehouse']::public.user_role[]));

drop policy if exists customs_operation_rules_insert on public.customs_operation_rules;
create policy customs_operation_rules_insert on public.customs_operation_rules
for insert to authenticated
with check(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker']::public.user_role[]));

drop policy if exists customs_operation_rules_update on public.customs_operation_rules;
create policy customs_operation_rules_update on public.customs_operation_rules
for update to authenticated
using(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker']::public.user_role[]))
with check(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker']::public.user_role[]));

drop policy if exists customs_operation_rules_delete on public.customs_operation_rules;
create policy customs_operation_rules_delete on public.customs_operation_rules
for delete to authenticated
using(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker']::public.user_role[]));

drop policy if exists customs_operation_learning_events_select on public.customs_operation_learning_events;
create policy customs_operation_learning_events_select on public.customs_operation_learning_events
for select to authenticated
using(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker']::public.user_role[]));

create or replace function public.guard_ship_pass_update()
returns trigger language plpgsql security invoker
set search_path=public,pg_temp
as $$
begin
  if new.ship_passed is distinct from old.ship_passed
     and current_setting('customs.allow_ship_pass',true)<>'1' then
    raise exception 'پاس کشتی فقط از طریق عملیات ثبت پاس کشتی مجاز است';
  end if;
  if new.ship_passed and new.transport_documents_status<>'ready' then
    raise exception 'ابتدا باید اسناد حمل و کشتیرانی تحویل و وضعیت آن‌ها آماده شود';
  end if;
  if new.ship_passed and new.ship_passed_at is null then
    new.ship_passed_at:=now();
  elsif not new.ship_passed then
    new.ship_passed_at:=null;
    new.ship_passed_by:=null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_ship_pass_update on public.shipments;
create trigger trg_guard_ship_pass_update before update on public.shipments
for each row execute function public.guard_ship_pass_update();

create or replace function public.set_shipment_ship_pass(p_shipment_id uuid,p_passed boolean)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;v_ready text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_org is null or v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed'; end if;
  select transport_documents_status into v_ready from public.shipments where id=p_shipment_id and organization_id=v_org for update;
  if not found then raise exception 'محموله پیدا نشد یا دسترسی ندارید'; end if;
  if p_passed and v_ready<>'ready' then raise exception 'پس از تحویل اسناد حمل و کشتیرانی باید وضعیت اسناد «آماده است» باشد'; end if;
  perform set_config('customs.allow_ship_pass','1',true);
  update public.shipments set ship_passed=p_passed,ship_passed_at=case when p_passed then now() else null end,
    ship_passed_by=case when p_passed then auth.uid() else null end,updated_at=now()
  where id=p_shipment_id and organization_id=v_org;
end; $$;

revoke execute on function public.set_shipment_ship_pass(uuid,boolean) from public,anon;
grant execute on function public.set_shipment_ship_pass(uuid,boolean) to authenticated;

create or replace function public.add_declaration_checklist_item(p_declaration_id uuid,p_item_label text,p_sort_order integer default 1000)
returns uuid language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;v_id uuid;v_label text:=btrim(coalesce(p_item_label,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed'; end if;
  if char_length(v_label)<2 then raise exception 'عنوان مورد جدید را وارد کنید'; end if;
  insert into public.declaration_checklist_items(organization_id,declaration_id,item_key,item_label,completed,sort_order,source,is_active)
  select v_org,d.id,gen_random_uuid()::text,v_label,false,greatest(coalesce(p_sort_order,1000),1),'manual',true
  from public.customs_declarations d
  where d.id=p_declaration_id and d.organization_id=v_org
  returning id into v_id;
  if v_id is null then raise exception 'اظهارنامه پیدا نشد یا دسترسی ندارید'; end if;
  return v_id;
end; $$;
revoke execute on function public.add_declaration_checklist_item(uuid,text,integer) from public,anon;
grant execute on function public.add_declaration_checklist_item(uuid,text,integer) to authenticated;

create or replace function public.set_declaration_checklist_note(p_item_id uuid,p_note text)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed'; end if;
  update public.declaration_checklist_items set note=v_note,
    note_updated_at=case when v_note is null then null else now() end,
    note_updated_by=case when v_note is null then null else auth.uid() end,updated_at=now()
  where id=p_item_id and organization_id=v_org;
  if not found then raise exception 'Checklist item not found or access denied'; end if;
end; $$;
revoke execute on function public.set_declaration_checklist_note(uuid,text) from public,anon;
grant execute on function public.set_declaration_checklist_note(uuid,text) to authenticated;

create or replace function public.set_declaration_checklist_item_active(p_item_id uuid,p_active boolean)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed'; end if;
  update public.declaration_checklist_items set is_active=p_active,updated_at=now()
  where id=p_item_id and organization_id=v_org;
  if not found then raise exception 'Checklist item not found or access denied'; end if;
end; $$;
revoke execute on function public.set_declaration_checklist_item_active(uuid,boolean) from public,anon;
grant execute on function public.set_declaration_checklist_item_active(uuid,boolean) to authenticated;

commit;