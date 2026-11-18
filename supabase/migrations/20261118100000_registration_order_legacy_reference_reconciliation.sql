-- Safe, read-time reconciliation of legacy customs registration references.
-- Direct shipment FK wins. Otherwise, only a unique same-tenant AND same-owner reference is inferred.
-- No existing Production records are rewritten by this migration.

create or replace function public.normalize_registration_order_currency(p_currency text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare v text := lower(trim(coalesce(p_currency,'')));
begin
  if v = '' then return null; end if;
  if position('usd' in v)>0 or position('دلار' in v)>0 then return 'USD'; end if;
  if position('aed' in v)>0 or position('درهم' in v)>0 then return 'AED'; end if;
  if position('eur' in v)>0 or position('یورو' in v)>0 then return 'EUR'; end if;
  if position('irr' in v)>0 or position('ریال' in v)>0 then return 'IRR'; end if;
  if position('cny' in v)>0 or position('rmb' in v)>0 or position('یوان' in v)>0 then return 'CNY'; end if;
  if position('rub' in v)>0 or position('روبل' in v)>0 then return 'RUB'; end if;
  if position('gbp' in v)>0 or position('پوند' in v)>0 then return 'GBP'; end if;
  if position('chf' in v)>0 or position('فرانک' in v)>0 then return 'CHF'; end if;
  if position('try' in v)>0 or position('لیر' in v)>0 then return 'TRY'; end if;
  return upper(regexp_replace(v,'\s+','','g'));
end;
$$;

create or replace function public.registration_order_id_for_shipment(
  p_shipment_id uuid,
  p_customs_order_number text
)
returns uuid
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_case_id uuid;
  v_client_id uuid;
  v_direct_order_id uuid;
  v_case_order_number text;
  v_matches uuid[];
  v_customs_key text;
  v_case_key text;
begin
  select s.organization_id,s.case_id,s.client_id,s.registration_order_id,c.registration_order_no
    into v_org,v_case_id,v_client_id,v_direct_order_id,v_case_order_number
  from public.shipments s
  left join public.cases c on c.id=s.case_id and c.organization_id=s.organization_id
  where s.id=p_shipment_id;

  if not found then return null; end if;
  if v_direct_order_id is not null then return v_direct_order_id; end if;

  v_customs_key := nullif(regexp_replace(
    translate(upper(trim(coalesce(p_customs_order_number,''))),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),
    '\s+','','g'),'');
  v_case_key := nullif(regexp_replace(
    translate(upper(trim(coalesce(v_case_order_number,''))),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),
    '\s+','','g'),'');

  select array_agg(distinct ro.id)
    into v_matches
  from public.registration_orders ro
  where ro.organization_id=v_org
    and ro.client_id is not distinct from v_client_id
    and (
      (v_case_id is not null and ro.case_id=v_case_id)
      or (v_case_key is not null and regexp_replace(
        translate(upper(trim(ro.order_number)),
          '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),
        '\s+','','g')=v_case_key)
      or (v_customs_key is not null and regexp_replace(
        translate(upper(trim(ro.order_number)),
          '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),
        '\s+','','g')=v_customs_key)
    );

  if coalesce(cardinality(v_matches),0)<>1 then return null; end if;
  return v_matches[1];
end;
$$;

-- Keep the original one-argument function used by the app and older triggers.
create or replace function public.registration_order_id_for_shipment(p_shipment_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select public.registration_order_id_for_shipment(p_shipment_id,d.registration_order_no)
  from public.shipments s
  left join public.shipment_customs_data d on d.shipment_id=s.id
  where s.id=p_shipment_id
  limit 1;
$$;

create or replace function public.assert_registration_order_totals(p_registration_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_order public.registration_orders%rowtype;
  v_shipment_count integer := 0;
  v_external_count integer := 0;
  v_net numeric := 0;
  v_gross numeric := 0;
  v_value numeric := 0;
  v_missing integer := 0;
  v_currency_mismatch integer := 0;
  v_external_net numeric := 0;
  v_external_gross numeric := 0;
  v_external_value numeric := 0;
  v_external_missing integer := 0;
  v_external_currency_mismatch integer := 0;
begin
  select * into v_order
  from public.registration_orders
  where id=p_registration_order_id
  for update;
  if not found then return; end if;

  select count(s.id)::integer,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0),
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0),
    coalesce(sum(d.invoice_amount),0),
    count(s.id) filter(where d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null)::integer,
    count(s.id) filter(where d.invoice_amount is not null
      and public.normalize_registration_order_currency(d.invoice_currency)
        is distinct from public.normalize_registration_order_currency(v_order.currency::text))::integer
  into v_shipment_count,v_net,v_gross,v_value,v_missing,v_currency_mismatch
  from public.shipments s
  left join public.shipment_customs_data d on d.shipment_id=s.id
  where s.organization_id=v_order.organization_id
    and public.registration_order_id_for_shipment(s.id)=p_registration_order_id;

  select count(*)::integer,
    coalesce(sum(a.net_weight_kg),0),
    coalesce(sum(a.gross_weight_kg),0),
    coalesce(sum(a.value_amount),0),
    count(*) filter(where a.value_amount is null or a.currency is null)::integer,
    count(*) filter(where a.value_amount is not null and a.currency is distinct from v_order.currency)::integer
  into v_external_count,v_external_net,v_external_gross,v_external_value,
       v_external_missing,v_external_currency_mismatch
  from public.registration_order_external_allocations a
  where a.organization_id=v_order.organization_id
    and a.registration_order_id=p_registration_order_id
    and a.status<>'cancelled';

  v_net:=v_net+v_external_net;
  v_gross:=v_gross+v_external_gross;
  v_value:=v_value+v_external_value;

  if v_currency_mismatch+v_external_currency_mismatch>0 then
    raise exception using errcode='23514',message='ارز فاکتور یکی از محموله‌ها یا سهم‌های واگذارشده با ارز ثبت سفارش یکسان نیست.';
  end if;
  if v_order.net_weight_kg is not null and v_net>v_order.net_weight_kg+0.001 then
    raise exception using errcode='23514',message='مجموع وزن خالص محموله‌ها و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  end if;
  if v_order.gross_weight_kg is not null and v_gross>v_order.gross_weight_kg+0.001 then
    raise exception using errcode='23514',message='مجموع وزن ناخالص محموله‌ها و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  end if;
  if v_order.value_amount is not null and v_value>v_order.value_amount+0.01 then
    raise exception using errcode='23514',message='مجموع ارزش محموله‌ها و سهم‌های واگذارشده از ارزش ثبت سفارش بیشتر می‌شود.';
  end if;

  if v_order.is_closed then
    if v_shipment_count+v_external_count=0 then
      raise exception using errcode='23514',message='برای نهایی‌سازی ثبت سفارش حداقل یک محموله یا سهم واگذارشده لازم است.';
    end if;
    if v_order.net_weight_kg is null or abs(v_net-v_order.net_weight_kg)>0.001 then
      raise exception using errcode='23514',message='مجموع وزن خالص تخصیص‌ها با ثبت سفارش برابر نیست.';
    end if;
    if v_order.gross_weight_kg is not null and abs(v_gross-v_order.gross_weight_kg)>0.001 then
      raise exception using errcode='23514',message='مجموع وزن ناخالص تخصیص‌ها با ثبت سفارش برابر نیست.';
    end if;
    if v_order.value_amount is null or v_order.currency is null or v_missing+v_external_missing>0 then
      raise exception using errcode='23514',message='ارزش و ارز همه محموله‌ها و سهم‌های واگذارشده باید تکمیل شود.';
    end if;
    if abs(v_value-v_order.value_amount)>0.01 then
      raise exception using errcode='23514',message='مجموع ارزش تخصیص‌ها با ارزش ثبت سفارش برابر نیست.';
    end if;
  end if;
end;
$$;

-- Validate the old and new parent when a legacy customs registration number changes.
create or replace function public.check_registration_order_child_totals()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_old_order_id uuid;
  v_new_order_id uuid;
begin
  if tg_table_name='shipments' then
    if tg_op='DELETE' then
      if old.registration_order_id is not null then
        perform public.assert_registration_order_totals(old.registration_order_id);
      end if;
      return old;
    end if;
    v_new_order_id:=public.registration_order_id_for_shipment(new.id);
    if v_new_order_id is not null then
      perform public.assert_registration_order_totals(v_new_order_id);
    end if;
    return new;
  end if;

  if tg_op='DELETE' then
    v_old_order_id:=public.registration_order_id_for_shipment(old.shipment_id,old.registration_order_no);
    if v_old_order_id is not null then perform public.assert_registration_order_totals(v_old_order_id); end if;
    return old;
  end if;

  if tg_op='UPDATE' then
    v_old_order_id:=public.registration_order_id_for_shipment(old.shipment_id,old.registration_order_no);
    if v_old_order_id is not null then perform public.assert_registration_order_totals(v_old_order_id); end if;
  end if;

  v_new_order_id:=public.registration_order_id_for_shipment(new.shipment_id,new.registration_order_no);
  if v_new_order_id is not null and v_new_order_id is distinct from v_old_order_id then
    perform public.assert_registration_order_totals(v_new_order_id);
  elsif v_new_order_id is not null and tg_op='INSERT' then
    perform public.assert_registration_order_totals(v_new_order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_custom_data_registration_order_totals on public.shipment_customs_data;
create trigger trg_check_custom_data_registration_order_totals
after insert or delete or update of net_weight_kg,gross_weight_kg,invoice_amount,invoice_currency,registration_order_no
on public.shipment_customs_data
for each row execute function public.check_registration_order_child_totals();

create or replace view public.registration_order_reconciliation
with (security_invoker=true) as
select
  ro.id as registration_order_id,ro.organization_id,ro.order_number,ro.order_date,ro.status,ro.client_id,
  ro.tariff_code,ro.quantity,ro.quantity_unit,
  ro.net_weight_kg as registered_net_weight_kg,ro.gross_weight_kg as registered_gross_weight_kg,
  ro.value_amount as registered_value_amount,ro.currency,ro.is_closed,ro.closed_at,
  coalesce(sa.shipment_count,0)::integer as shipment_count,
  coalesce(sa.shipped_net_weight_kg,0) as shipped_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg,0) as shipped_gross_weight_kg,
  coalesce(sa.shipped_value_amount,0) as shipped_value_amount,
  coalesce(sa.shipments_missing_invoice_value,0)::integer as shipments_missing_invoice_value,
  coalesce(sa.shipments_with_currency_mismatch,0)::integer as shipments_with_currency_mismatch,
  coalesce(ea.external_allocation_count,0)::integer as external_allocation_count,
  coalesce(ea.external_allocated_net_weight_kg,0) as external_allocated_net_weight_kg,
  coalesce(ea.external_allocated_gross_weight_kg,0) as external_allocated_gross_weight_kg,
  coalesce(ea.external_allocated_value_amount,0) as external_allocated_value_amount,
  coalesce(ea.external_allocations_missing_value,0)::integer as external_allocations_missing_value,
  coalesce(ea.external_allocations_currency_mismatch,0)::integer as external_allocations_currency_mismatch,
  coalesce(sa.shipped_net_weight_kg,0)+coalesce(ea.external_allocated_net_weight_kg,0) as total_allocated_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg,0)+coalesce(ea.external_allocated_gross_weight_kg,0) as total_allocated_gross_weight_kg,
  coalesce(sa.shipped_value_amount,0)+coalesce(ea.external_allocated_value_amount,0) as total_allocated_value_amount,
  coalesce(sa.shipment_count,0)+coalesce(ea.external_allocation_count,0) as total_allocation_count
from public.registration_orders ro
left join lateral (
  select count(s.id)::integer as shipment_count,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0) as shipped_net_weight_kg,
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0) as shipped_gross_weight_kg,
    coalesce(sum(d.invoice_amount),0) as shipped_value_amount,
    count(s.id) filter(where d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null)::integer as shipments_missing_invoice_value,
    count(s.id) filter(where d.invoice_amount is not null
      and public.normalize_registration_order_currency(d.invoice_currency)
        is distinct from public.normalize_registration_order_currency(ro.currency::text))::integer as shipments_with_currency_mismatch
  from public.shipments s
  left join public.shipment_customs_data d on d.shipment_id=s.id
  where s.organization_id=ro.organization_id
    and public.registration_order_id_for_shipment(s.id)=ro.id
) sa on true
left join lateral (
  select count(*)::integer as external_allocation_count,
    coalesce(sum(a.net_weight_kg),0) as external_allocated_net_weight_kg,
    coalesce(sum(a.gross_weight_kg),0) as external_allocated_gross_weight_kg,
    coalesce(sum(a.value_amount),0) as external_allocated_value_amount,
    count(*) filter(where a.value_amount is null or a.currency is null)::integer as external_allocations_missing_value,
    count(*) filter(where a.value_amount is not null and a.currency is distinct from ro.currency)::integer as external_allocations_currency_mismatch
  from public.registration_order_external_allocations a
  where a.organization_id=ro.organization_id and a.registration_order_id=ro.id and a.status<>'cancelled'
) ea on true;

grant select on public.registration_order_reconciliation to authenticated;
