-- Phase 3.4: registration order is optional at case creation + restore maritime workflow data

create table if not exists public.registration_orders (
  id uuid primary key default extensions.uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid null,
  order_number text not null,
  order_date date null,
  status text not null default 'received' check (status in ('pending','received','verified','used','cancelled')),
  tariff_code text null,
  quantity numeric null check (quantity is null or quantity >= 0),
  quantity_unit text null,
  value_amount numeric null check (value_amount is null or value_amount >= 0),
  currency public.currency_code null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_orders_org_number_uk unique (organization_id, order_number),
  constraint registration_orders_case_fk foreign key (case_id, organization_id) references public.cases(id, organization_id) on delete set null
);

alter table public.registration_orders enable row level security;
drop policy if exists registration_orders_select on public.registration_orders;
drop policy if exists registration_orders_insert on public.registration_orders;
drop policy if exists registration_orders_update on public.registration_orders;
drop policy if exists registration_orders_delete on public.registration_orders;
create policy registration_orders_select on public.registration_orders for select to authenticated using (organization_id = public.user_org_id());
create policy registration_orders_insert on public.registration_orders for insert to authenticated with check (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
create policy registration_orders_update on public.registration_orders for update to authenticated using (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker')) with check (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
create policy registration_orders_delete on public.registration_orders for delete to authenticated using (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
grant select, insert, update, delete on public.registration_orders to authenticated;

alter table public.shipments
  add column if not exists voyage_no text,
  add column if not exists cargo_count numeric check (cargo_count is null or cargo_count >= 0),
  add column if not exists cargo_count_unit text,
  add column if not exists net_weight_kg numeric check (net_weight_kg is null or net_weight_kg >= 0),
  add column if not exists tally_no text,
  add column if not exists release_invoice_no text,
  add column if not exists release_invoice_date date,
  add column if not exists release_status text check (release_status is null or release_status in ('pending','invoice_received','paid','released')),
  add column if not exists electronic_release_no text;
grant select, insert, update, delete on public.shipments to authenticated;

drop function if exists public.create_case_workflow(text,text);
create or replace function public.create_case_workflow(p_client_name text, p_registration_order_no text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_org uuid; v_client uuid; v_case uuid; v_case_number text; v_reg text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_org := public.user_org_id();
  if v_org is null then raise exception 'organization not found'; end if;
  if public.user_role() not in ('owner','admin','broker') then raise exception 'insufficient role'; end if;
  if nullif(trim(p_client_name),'') is null then raise exception 'cargo owner is required'; end if;
  select id into v_client from public.clients where organization_id=v_org and lower(trim(name))=lower(trim(p_client_name)) limit 1;
  if v_client is null then insert into public.clients(organization_id,name) values(v_org,trim(p_client_name)) returning id into v_client; end if;
  v_reg := nullif(trim(p_registration_order_no),'');
  if v_reg is not null and exists(select 1 from public.registration_orders where organization_id=v_org and order_number=v_reg) then raise exception 'registration order already exists in this organization: %',v_reg; end if;
  v_case_number := 'CASE-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  insert into public.cases(organization_id,client_id,case_number,status,registration_order_no) values(v_org,v_client,v_case_number,'draft',v_reg) returning id into v_case;
  if v_reg is not null then
    insert into public.registration_orders(organization_id,case_id,order_number,status) values(v_org,v_case,v_reg,'received');
    update public.cases set status='registration_order' where id=v_case and organization_id=v_org;
  end if;
  return v_case;
end; $$;
revoke execute on function public.create_case_workflow(text,text) from public, anon;
grant execute on function public.create_case_workflow(text,text) to authenticated;

create or replace function public.attach_registration_order(
  p_case_id uuid, p_order_number text, p_order_date date default null, p_status text default 'received',
  p_tariff_code text default null, p_quantity numeric default null, p_quantity_unit text default null,
  p_value_amount numeric default null, p_currency public.currency_code default null, p_notes text default null
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_org uuid; v_reg_id uuid; v_case_org uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_org := public.user_org_id();
  if public.user_role() not in ('owner','admin','broker') then raise exception 'insufficient role'; end if;
  if nullif(trim(p_order_number),'') is null then raise exception 'registration order number is required'; end if;
  select organization_id into v_case_org from public.cases where id=p_case_id;
  if v_case_org is null or v_case_org<>v_org then raise exception 'case not found'; end if;
  if exists(select 1 from public.registration_orders where organization_id=v_org and order_number=trim(p_order_number) and (case_id is null or case_id<>p_case_id)) then raise exception 'registration order already exists in this organization: %',trim(p_order_number); end if;
  insert into public.registration_orders(organization_id,case_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,notes)
  values(v_org,p_case_id,trim(p_order_number),p_order_date,coalesce(p_status,'received'),nullif(trim(p_tariff_code),''),p_quantity,nullif(trim(p_quantity_unit),''),p_value_amount,p_currency,p_notes)
  on conflict (organization_id,order_number) do update set case_id=excluded.case_id,order_date=coalesce(excluded.order_date,registration_orders.order_date),status=excluded.status,tariff_code=coalesce(excluded.tariff_code,registration_orders.tariff_code),quantity=coalesce(excluded.quantity,registration_orders.quantity),quantity_unit=coalesce(excluded.quantity_unit,registration_orders.quantity_unit),value_amount=coalesce(excluded.value_amount,registration_orders.value_amount),currency=coalesce(excluded.currency,registration_orders.currency),notes=coalesce(excluded.notes,registration_orders.notes),updated_at=now()
  returning id into v_reg_id;
  update public.cases set registration_order_no=trim(p_order_number),updated_at=now() where id=p_case_id and organization_id=v_org;
  if (select status from public.cases where id=p_case_id)='draft' then update public.cases set status='registration_order' where id=p_case_id and organization_id=v_org; end if;
  return v_reg_id;
end; $$;
revoke execute on function public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,public.currency_code,text) from public, anon;
grant execute on function public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,public.currency_code,text) to authenticated;

create index if not exists idx_registration_orders_case on public.registration_orders(organization_id,case_id);
create index if not exists idx_shipments_bl on public.shipments(organization_id,bill_of_lading_no,bill_of_lading_year);
