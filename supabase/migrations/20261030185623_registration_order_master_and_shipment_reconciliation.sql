-- One master record per customs registration order; shipments are child records.
-- The order owns shared banking/payment data and cumulative weight/value limits.
alter table public.registration_orders
  add column if not exists net_weight_kg numeric,
  add column if not exists gross_weight_kg numeric,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_branch_code text,
  add column if not exists payment_instrument_code text,
  add column if not exists is_closed boolean not null default false,
  add column if not exists closed_at timestamptz;

alter table public.registration_orders
  drop constraint if exists registration_orders_net_weight_check;
alter table public.registration_orders
  add constraint registration_orders_net_weight_check check (net_weight_kg is null or net_weight_kg >= 0);
alter table public.registration_orders
  drop constraint if exists registration_orders_gross_weight_check;
alter table public.registration_orders
  add constraint registration_orders_gross_weight_check check (gross_weight_kg is null or gross_weight_kg >= 0);

alter table public.shipments add column if not exists registration_order_id uuid;
alter table public.shipment_customs_data add column if not exists sata_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.registration_orders'::regclass and conname='uq_registration_orders_tenant') then
    alter table public.registration_orders add constraint uq_registration_orders_tenant unique(id,organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.shipments'::regclass and conname='fk_shipments_registration_order_tenant') then
    alter table public.shipments add constraint fk_shipments_registration_order_tenant
      foreign key(registration_order_id,organization_id)
      references public.registration_orders(id,organization_id) on delete restrict;
  end if;
end $$;

create index if not exists shipments_registration_order_idx
  on public.shipments(organization_id,registration_order_id) where registration_order_id is not null;

create or replace function public.assert_registration_order_totals(p_registration_order_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare
  v_order public.registration_orders%rowtype;
  v_count integer; v_net numeric; v_gross numeric; v_value numeric;
  v_missing integer; v_currency_mismatch integer;
begin
  select * into v_order from public.registration_orders where id=p_registration_order_id for update;
  if not found then return; end if;

  select count(s.id)::integer,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0),
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0),
    coalesce(sum(d.invoice_amount),0),
    count(s.id) filter(where d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null)::integer,
    count(s.id) filter(where d.invoice_amount is not null and (
      v_order.currency is null or nullif(trim(d.invoice_currency),'') is null
      or upper(trim(d.invoice_currency))<>upper(v_order.currency::text)
    ))::integer
  into v_count,v_net,v_gross,v_value,v_missing,v_currency_mismatch
  from public.shipments s
  left join public.cases c on c.id=s.case_id and c.organization_id=s.organization_id
  left join public.shipment_customs_data d on d.shipment_id=s.id
  where s.organization_id=v_order.organization_id
    and (s.registration_order_id=p_registration_order_id or (
      s.registration_order_id is null and
      (s.case_id=v_order.case_id or c.registration_order_no=v_order.order_number)
    ));

  if v_currency_mismatch>0 then
    raise exception using errcode='23514',message='ارز فاکتور یکی از محموله‌ها با ارز ثبت سفارش یکسان نیست.';
  end if;
  if v_order.net_weight_kg is not null and v_net>v_order.net_weight_kg+0.001 then
    raise exception using errcode='23514',message='مجموع وزن خالص محموله‌ها از وزن ثبت سفارش بیشتر می‌شود.';
  end if;
  if v_order.gross_weight_kg is not null and v_gross>v_order.gross_weight_kg+0.001 then
    raise exception using errcode='23514',message='مجموع وزن ناخالص محموله‌ها از وزن ثبت سفارش بیشتر می‌شود.';
  end if;
  if v_order.value_amount is not null and v_value>v_order.value_amount+0.01 then
    raise exception using errcode='23514',message='مجموع ارزش فاکتور محموله‌ها از ارزش ثبت سفارش بیشتر می‌شود.';
  end if;

  if v_order.is_closed then
    if v_count=0 then
      raise exception using errcode='23514',message='برای نهایی‌سازی ثبت سفارش باید حداقل یک محموله به آن متصل باشد.';
    end if;
    if v_order.net_weight_kg is null or abs(v_net-v_order.net_weight_kg)>0.001 then
      raise exception using errcode='23514',message='برای نهایی‌سازی، جمع وزن خالص محموله‌ها باید دقیقاً با ثبت سفارش برابر باشد.';
    end if;
    if v_order.gross_weight_kg is not null and abs(v_gross-v_order.gross_weight_kg)>0.001 then
      raise exception using errcode='23514',message='برای نهایی‌سازی، جمع وزن ناخالص محموله‌ها باید با ثبت سفارش برابر باشد.';
    end if;
    if v_order.value_amount is null or v_order.currency is null then
      raise exception using errcode='23514',message='ارزش و ارز ثبت سفارش برای نهایی‌سازی باید تکمیل شود.';
    end if;
    if v_missing>0 then
      raise exception using errcode='23514',message='ارزش فاکتور و ارز همه محموله‌ها باید پیش از نهایی‌سازی ثبت شود.';
    end if;
    if abs(v_value-v_order.value_amount)>0.01 then
      raise exception using errcode='23514',message='برای نهایی‌سازی، جمع ارزش فاکتور محموله‌ها باید دقیقاً با ارزش ثبت سفارش برابر باشد.';
    end if;
  end if;
end $$;

create or replace function public.validate_shipment_registration_order()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_client uuid; v_closed boolean;
begin
  if new.registration_order_id is null then return new; end if;
  if tg_op='UPDATE' and new.registration_order_id is not distinct from old.registration_order_id
     and new.client_id is not distinct from old.client_id
     and new.net_weight_kg is not distinct from old.net_weight_kg
     and new.gross_weight_kg is not distinct from old.gross_weight_kg then return new; end if;
  select client_id,is_closed into v_client,v_closed from public.registration_orders
    where id=new.registration_order_id and organization_id=new.organization_id for update;
  if not found then raise exception using errcode='23503',message='ثبت سفارش انتخاب‌شده متعلق به این سازمان نیست یا وجود ندارد.'; end if;
  if v_closed then raise exception using errcode='23514',message='ثبت سفارش نهایی شده است و امکان افزودن یا تغییر محموله آن وجود ندارد.'; end if;
  if v_client is not null and new.client_id is distinct from v_client then
    raise exception using errcode='23514',message='صاحب کالای محموله باید با صاحب کالای ثبت سفارش یکسان باشد.';
  end if;
  return new;
end $$;

create or replace function public.sync_case_registration_order_number()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_number text;
begin
  if new.case_id is null or new.registration_order_id is null then return new; end if;
  select order_number into v_number from public.registration_orders
    where id=new.registration_order_id and organization_id=new.organization_id;
  if v_number is not null then
    update public.cases set registration_order_no=v_number
    where id=new.case_id and organization_id=new.organization_id
      and registration_order_no is distinct from v_number;
  end if;
  return new;
end $$;

create or replace function public.validate_registration_order_update()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='INSERT' then new.is_closed:=false; new.closed_at:=null; return new; end if;
  if new.client_id is distinct from old.client_id and exists(
    select 1 from public.shipments s where s.registration_order_id=new.id
      and s.organization_id=new.organization_id and s.client_id is distinct from new.client_id
  ) then
    raise exception using errcode='23514',message='صاحب کالا را نمی‌توان تغییر داد؛ ابتدا محموله‌های متصل به ثبت سفارش را بررسی کنید.';
  end if;
  if new.is_closed then new.closed_at:=coalesce(new.closed_at,now()); else new.closed_at:=null; end if;
  return new;
end $$;

create or replace function public.registration_order_id_for_shipment(p_shipment_id uuid)
returns uuid language sql security invoker set search_path=public as $$
  select coalesce(s.registration_order_id,ro_case.id,ro_number.id)
  from public.shipments s
  left join public.cases c on c.id=s.case_id and c.organization_id=s.organization_id
  left join public.registration_orders ro_case on ro_case.case_id=s.case_id and ro_case.organization_id=s.organization_id
  left join public.registration_orders ro_number on ro_number.organization_id=s.organization_id and ro_number.order_number=c.registration_order_no
  where s.id=p_shipment_id limit 1;
$$;

create or replace function public.check_registration_order_child_totals()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_order_id uuid;
begin
  if tg_table_name='shipments' then
    if tg_op='UPDATE' and old.registration_order_id is not null and old.registration_order_id is distinct from new.registration_order_id then
      perform public.assert_registration_order_totals(old.registration_order_id);
    end if;
    if tg_op='DELETE' then
      if old.registration_order_id is not null then perform public.assert_registration_order_totals(old.registration_order_id); end if;
      return old;
    end if;
    if new.registration_order_id is not null then
      perform public.assert_registration_order_totals(new.registration_order_id);
    elsif new.case_id is not null then
      v_order_id:=public.registration_order_id_for_shipment(new.id);
      if v_order_id is not null then perform public.assert_registration_order_totals(v_order_id); end if;
    end if;
    return new;
  end if;
  v_order_id:=public.registration_order_id_for_shipment(case when tg_op='DELETE' then old.shipment_id else new.shipment_id end);
  if v_order_id is not null then perform public.assert_registration_order_totals(v_order_id); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.check_registration_order_parent_totals()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  perform public.assert_registration_order_totals(new.id);
  return new;
end $$;

drop trigger if exists trg_validate_shipment_registration_order on public.shipments;
create trigger trg_validate_shipment_registration_order
before insert or update of registration_order_id,client_id,net_weight_kg,gross_weight_kg
on public.shipments for each row execute function public.validate_shipment_registration_order();

drop trigger if exists trg_check_shipment_registration_order_totals on public.shipments;
create trigger trg_check_shipment_registration_order_totals
after insert or update of registration_order_id,net_weight_kg,gross_weight_kg or delete
on public.shipments for each row execute function public.check_registration_order_child_totals();

drop trigger if exists trg_check_custom_data_registration_order_totals on public.shipment_customs_data;
create trigger trg_check_custom_data_registration_order_totals
after insert or update of net_weight_kg,gross_weight_kg,invoice_amount,invoice_currency or delete
on public.shipment_customs_data for each row execute function public.check_registration_order_child_totals();

drop trigger if exists trg_sync_case_registration_order_number on public.shipments;
create trigger trg_sync_case_registration_order_number
after insert or update of case_id,registration_order_id
on public.shipments for each row execute function public.sync_case_registration_order_number();

drop trigger if exists trg_validate_registration_order_update on public.registration_orders;
create trigger trg_validate_registration_order_update
before insert or update of client_id,is_closed
on public.registration_orders for each row execute function public.validate_registration_order_update();

drop trigger if exists trg_check_registration_order_parent_totals on public.registration_orders;
create trigger trg_check_registration_order_parent_totals
after update of net_weight_kg,gross_weight_kg,value_amount,currency,is_closed
on public.registration_orders for each row execute function public.check_registration_order_parent_totals();

create or replace view public.registration_order_reconciliation
with (security_invoker=true) as
select ro.id as registration_order_id,ro.organization_id,ro.order_number,ro.order_date,ro.status,ro.client_id,
 ro.tariff_code,ro.quantity,ro.quantity_unit,ro.net_weight_kg as registered_net_weight_kg,
 ro.gross_weight_kg as registered_gross_weight_kg,ro.value_amount as registered_value_amount,ro.currency,
 ro.is_closed,ro.closed_at,count(s.id)::integer as shipment_count,
 coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0) as shipped_net_weight_kg,
 coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0) as shipped_gross_weight_kg,
 coalesce(sum(d.invoice_amount),0) as shipped_value_amount,
 count(s.id) filter(where s.id is not null and (d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null))::integer as shipments_missing_invoice_value,
 count(s.id) filter(where d.invoice_amount is not null and (ro.currency is null or nullif(trim(d.invoice_currency),'') is null or upper(trim(d.invoice_currency))<>upper(ro.currency::text)))::integer as shipments_with_currency_mismatch
from public.registration_orders ro
left join public.shipments s on s.organization_id=ro.organization_id and (
 s.registration_order_id=ro.id or (s.registration_order_id is null and (
  s.case_id=ro.case_id or exists(select 1 from public.cases c where c.id=s.case_id and c.organization_id=s.organization_id and c.registration_order_no=ro.order_number)
 ))
)
left join public.shipment_customs_data d on d.shipment_id=s.id
group by ro.id,ro.organization_id,ro.order_number,ro.order_date,ro.status,ro.client_id,ro.tariff_code,
 ro.quantity,ro.quantity_unit,ro.net_weight_kg,ro.gross_weight_kg,ro.value_amount,ro.currency,ro.is_closed,ro.closed_at;

grant select on public.registration_order_reconciliation to authenticated;
