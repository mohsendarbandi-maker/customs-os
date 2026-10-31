-- Registration-order master-first workflow.
-- Reuse one master registration order across multiple cases and shipments.
-- Historical bank fields are backfilled through the authenticated Registration Orders UI;
-- this migration deliberately does not rewrite or attach historical shipment rows.

create or replace function public.normalize_registration_order_number(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  select upper(
    translate(
      regexp_replace(
        translate(
          coalesce(p_value, ''),
          '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
          '01234567890123456789'
        ),
        '[[:space:]]',
        '',
        'g'
      ),
      chr(8204) || chr(8206) || chr(8207) || '‐‑‒–—-',
      ''
    )
  );
$$;

grant execute on function public.normalize_registration_order_number(text) to authenticated;

create or replace function public.normalize_currency_code(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  select case
    when upper(coalesce(p_value, '')) like '%USD%' or coalesce(p_value, '') like '%دلار%' then 'USD'
    when upper(coalesce(p_value, '')) like '%EUR%' or coalesce(p_value, '') like '%یورو%' then 'EUR'
    when upper(coalesce(p_value, '')) like '%AED%' or coalesce(p_value, '') like '%درهم%' then 'AED'
    when upper(coalesce(p_value, '')) like '%CNY%' or upper(coalesce(p_value, '')) like '%RMB%' or coalesce(p_value, '') like '%یوان%' then 'CNY'
    when upper(coalesce(p_value, '')) like '%RUB%' or coalesce(p_value, '') like '%روبل%' then 'RUB'
    when upper(coalesce(p_value, '')) like '%GBP%' or coalesce(p_value, '') like '%پوند%' then 'GBP'
    when upper(coalesce(p_value, '')) like '%CHF%' or coalesce(p_value, '') like '%فرانک%' then 'CHF'
    when upper(coalesce(p_value, '')) like '%TRY%' or coalesce(p_value, '') like '%لیر%' then 'TRY'
    when upper(coalesce(p_value, '')) like '%IRR%' or coalesce(p_value, '') like '%ریال%' then 'IRR'
    else null
  end;
$$;

grant execute on function public.normalize_currency_code(text) to authenticated;

create or replace function public.assert_registration_order_totals(p_registration_order_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_order public.registration_orders%rowtype;
  v_shipment_count integer := 0;
  v_external_count integer := 0;
  v_net_weight numeric := 0;
  v_gross_weight numeric := 0;
  v_value numeric := 0;
  v_missing_value_count integer := 0;
  v_currency_mismatch_count integer := 0;
  v_external_net numeric := 0;
  v_external_gross numeric := 0;
  v_external_value numeric := 0;
  v_external_missing_value_count integer := 0;
  v_external_currency_mismatch_count integer := 0;
begin
  select * into v_order
    from public.registration_orders
   where id = p_registration_order_id
   for update;

  if not found then return; end if;

  select
    count(s.id)::integer,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0),
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0),
    coalesce(sum(d.invoice_amount),0),
    count(s.id) filter (
      where d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null
    )::integer,
    count(s.id) filter (
      where d.invoice_amount is not null and (
        v_order.currency is null
        or public.normalize_currency_code(d.invoice_currency) is null
        or public.normalize_currency_code(d.invoice_currency)
             <> public.normalize_currency_code(v_order.currency::text)
      )
    )::integer
  into
    v_shipment_count,v_net_weight,v_gross_weight,v_value,
    v_missing_value_count,v_currency_mismatch_count
  from public.shipments s
  left join public.cases c
    on c.id = s.case_id and c.organization_id = s.organization_id
  left join public.shipment_customs_data d
    on d.shipment_id = s.id
  where s.organization_id = v_order.organization_id
    and (
      s.registration_order_id = p_registration_order_id
      or (
        s.registration_order_id is null
        and (
          s.case_id = v_order.case_id
          or (
            c.client_id = v_order.client_id
            and public.normalize_registration_order_number(c.registration_order_no::text)
                = public.normalize_registration_order_number(v_order.order_number)
          )
        )
      )
    );

  select
    count(*)::integer,
    coalesce(sum(a.net_weight_kg),0),
    coalesce(sum(a.gross_weight_kg),0),
    coalesce(sum(a.value_amount),0),
    count(*) filter (
      where a.value_amount is null or a.currency is null
    )::integer,
    count(*) filter (
      where a.value_amount is not null and (
        v_order.currency is null or a.currency is distinct from v_order.currency
      )
    )::integer
  into
    v_external_count,v_external_net,v_external_gross,v_external_value,
    v_external_missing_value_count,v_external_currency_mismatch_count
  from public.registration_order_external_allocations a
  where a.organization_id = v_order.organization_id
    and a.registration_order_id = p_registration_order_id
    and a.status <> 'cancelled';

  v_net_weight := v_net_weight + v_external_net;
  v_gross_weight := v_gross_weight + v_external_gross;
  v_value := v_value + v_external_value;

  if v_currency_mismatch_count + v_external_currency_mismatch_count > 0 then
    raise exception using errcode='23514',
      message='ارز فاکتور یکی از محموله‌ها یا سهم‌های واگذارشده با ارز ثبت سفارش یکسان نیست.';
  end if;

  if v_order.net_weight_kg is not null
     and v_net_weight > v_order.net_weight_kg + 0.001 then
    raise exception using errcode='23514',
      message='مجموع وزن خالص محموله‌های داخلی و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  end if;

  if v_order.gross_weight_kg is not null
     and v_gross_weight > v_order.gross_weight_kg + 0.001 then
    raise exception using errcode='23514',
      message='مجموع وزن ناخالص محموله‌های داخلی و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  end if;

  if v_order.value_amount is not null
     and v_value > v_order.value_amount + 0.01 then
    raise exception using errcode='23514',
      message='مجموع ارزش محموله‌های داخلی و سهم‌های واگذارشده از ارزش ثبت سفارش بیشتر می‌شود.';
  end if;

  if v_order.is_closed then
    if v_shipment_count + v_external_count = 0 then
      raise exception using errcode='23514',
        message='برای نهایی‌سازی ثبت سفارش باید حداقل یک محموله یا سهم واگذارشده ثبت شده باشد.';
    end if;

    if v_order.net_weight_kg is null
       or abs(v_net_weight - v_order.net_weight_kg) > 0.001 then
      raise exception using errcode='23514',
        message='برای نهایی‌سازی، مجموع وزن خالص محموله‌های داخلی و سهم‌های واگذارشده باید دقیقاً با ثبت سفارش برابر باشد.';
    end if;

    if v_order.gross_weight_kg is not null
       and abs(v_gross_weight - v_order.gross_weight_kg) > 0.001 then
      raise exception using errcode='23514',
        message='برای نهایی‌سازی، مجموع وزن ناخالص باید با ثبت سفارش برابر باشد.';
    end if;

    if v_order.value_amount is null or v_order.currency is null then
      raise exception using errcode='23514',
        message='ارزش و ارز ثبت سفارش برای نهایی‌سازی باید تکمیل شود.';
    end if;

    if v_missing_value_count + v_external_missing_value_count > 0 then
      raise exception using errcode='23514',
        message='ارزش فاکتور و ارز همه محموله‌ها و سهم‌های واگذارشده باید پیش از نهایی‌سازی ثبت شود.';
    end if;

    if abs(v_value - v_order.value_amount) > 0.01 then
      raise exception using errcode='23514',
        message='برای نهایی‌سازی، مجموع ارزش محموله‌های داخلی و سهم‌های واگذارشده باید دقیقاً با ثبت سفارش برابر باشد.';
    end if;
  end if;
end;
$function$;

create or replace view public.registration_order_reconciliation as
select
  ro.id as registration_order_id,
  ro.organization_id,
  ro.order_number,
  ro.order_date,
  ro.status,
  ro.client_id,
  ro.tariff_code,
  ro.quantity,
  ro.quantity_unit,
  ro.net_weight_kg as registered_net_weight_kg,
  ro.gross_weight_kg as registered_gross_weight_kg,
  ro.value_amount as registered_value_amount,
  ro.currency,
  ro.is_closed,
  ro.closed_at,
  coalesce(sa.shipment_count,0) as shipment_count,
  coalesce(sa.shipped_net_weight_kg,0::numeric) as shipped_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg,0::numeric) as shipped_gross_weight_kg,
  coalesce(sa.shipped_value_amount,0::numeric) as shipped_value_amount,
  coalesce(sa.shipments_missing_invoice_value,0) as shipments_missing_invoice_value,
  coalesce(sa.shipments_with_currency_mismatch,0) as shipments_with_currency_mismatch,
  coalesce(ea.external_allocation_count,0) as external_allocation_count,
  coalesce(ea.external_allocated_net_weight_kg,0::numeric) as external_allocated_net_weight_kg,
  coalesce(ea.external_allocated_gross_weight_kg,0::numeric) as external_allocated_gross_weight_kg,
  coalesce(ea.external_allocated_value_amount,0::numeric) as external_allocated_value_amount,
  coalesce(ea.external_allocations_missing_value,0) as external_allocations_missing_value,
  coalesce(ea.external_allocations_currency_mismatch,0) as external_allocations_currency_mismatch,
  coalesce(sa.shipped_net_weight_kg,0::numeric)+coalesce(ea.external_allocated_net_weight_kg,0::numeric) as total_allocated_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg,0::numeric)+coalesce(ea.external_allocated_gross_weight_kg,0::numeric) as total_allocated_gross_weight_kg,
  coalesce(sa.shipped_value_amount,0::numeric)+coalesce(ea.external_allocated_value_amount,0::numeric) as total_allocated_value_amount,
  coalesce(sa.shipment_count,0)+coalesce(ea.external_allocation_count,0) as total_allocation_count
from public.registration_orders ro
left join lateral (
  select
    count(s.id)::integer as shipment_count,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0::numeric) as shipped_net_weight_kg,
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0::numeric) as shipped_gross_weight_kg,
    coalesce(sum(d.invoice_amount),0::numeric) as shipped_value_amount,
    count(s.id) filter (
      where s.id is not null and (d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null)
    )::integer as shipments_missing_invoice_value,
    count(s.id) filter (
      where d.invoice_amount is not null and (
        ro.currency is null
        or public.normalize_currency_code(d.invoice_currency) is null
        or public.normalize_currency_code(d.invoice_currency)
             <> public.normalize_currency_code(ro.currency::text)
      )
    )::integer as shipments_with_currency_mismatch
  from public.shipments s
  left join public.cases c on c.id=s.case_id and c.organization_id=s.organization_id
  left join public.shipment_customs_data d on d.shipment_id=s.id
  where s.organization_id=ro.organization_id
    and (
      s.registration_order_id=ro.id
      or (
        s.registration_order_id is null
        and (
          s.case_id=ro.case_id
          or (
            c.client_id=ro.client_id
            and public.normalize_registration_order_number(c.registration_order_no::text)
                = public.normalize_registration_order_number(ro.order_number)
          )
        )
      )
    )
) sa on true
left join lateral (
  select
    count(*)::integer as external_allocation_count,
    coalesce(sum(a.net_weight_kg),0::numeric) as external_allocated_net_weight_kg,
    coalesce(sum(a.gross_weight_kg),0::numeric) as external_allocated_gross_weight_kg,
    coalesce(sum(a.value_amount),0::numeric) as external_allocated_value_amount,
    count(*) filter (where a.value_amount is null or a.currency is null)::integer as external_allocations_missing_value,
    count(*) filter (
      where a.value_amount is not null and (ro.currency is null or a.currency is distinct from ro.currency)
    )::integer as external_allocations_currency_mismatch
  from public.registration_order_external_allocations a
  where a.organization_id=ro.organization_id
    and a.registration_order_id=ro.id
    and a.status<>'cancelled'
) ea on true;

create or replace function public.attach_registration_order(
  p_case_id uuid,
  p_order_number text,
  p_order_date date default null,
  p_status text default 'received',
  p_tariff_code text default null,
  p_quantity numeric default null,
  p_quantity_unit text default null,
  p_value_amount numeric default null,
  p_currency currency_code default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_case_org uuid;
  v_case_client uuid;
  v_case_status public.case_status;
  v_reg_id uuid;
  v_reg_client uuid;
  v_reg_number text;
  v_reg_closed boolean;
  v_match_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_org := public.user_org_id();
  if public.user_role() not in ('owner','admin','broker') then raise exception 'insufficient role'; end if;
  if nullif(trim(p_order_number),'') is null then raise exception 'registration order number is required'; end if;

  select organization_id,client_id,status
    into v_case_org,v_case_client,v_case_status
    from public.cases
   where id=p_case_id;

  if v_case_org is null or v_case_org<>v_org then
    raise exception 'case not found';
  end if;

  select count(*) into v_match_count
    from public.registration_orders ro
   where ro.organization_id=v_org
     and public.normalize_registration_order_number(ro.order_number)
         = public.normalize_registration_order_number(p_order_number);

  if v_match_count=0 then
    raise exception 'ابتدا ثبت سفارش مادر را در بخش مدیریت ثبت سفارش‌ها ایجاد کنید.';
  elsif v_match_count>1 then
    raise exception 'چند ثبت سفارش با شماره مشابه پیدا شد؛ ابتدا موارد تکراری را بررسی کنید.';
  end if;

  select id,client_id,order_number,is_closed
    into v_reg_id,v_reg_client,v_reg_number,v_reg_closed
    from public.registration_orders ro
   where ro.organization_id=v_org
     and public.normalize_registration_order_number(ro.order_number)
         = public.normalize_registration_order_number(p_order_number)
   limit 1
   for update;

  if v_reg_closed then
    raise exception 'ثبت سفارش مادر نهایی شده است و امکان اتصال محموله جدید ندارد.';
  end if;

  if v_reg_client is not null and v_reg_client is distinct from v_case_client then
    raise exception 'صاحب کالای پرونده با صاحب کالای ثبت سفارش مادر یکسان نیست.';
  end if;

  if v_reg_client is null and v_case_client is not null then
    update public.registration_orders
       set client_id=v_case_client,updated_at=now()
     where id=v_reg_id and organization_id=v_org;
  end if;

  if exists (
    select 1 from public.shipments s
     where s.organization_id=v_org
       and s.case_id=p_case_id
       and s.registration_order_id is not null
       and s.registration_order_id<>v_reg_id
  ) then
    raise exception 'یکی از محموله‌های پرونده قبلاً به ثبت سفارش دیگری متصل شده است.';
  end if;

  update public.cases
     set registration_order_no=v_reg_number,
         status=case when v_case_status='draft' then 'registration_order'::public.case_status else v_case_status end,
         updated_at=now()
   where id=p_case_id and organization_id=v_org;

  -- Link only shipments inside the explicitly selected case. No historical
  -- shipment is auto-attached just because its stored order number matches.
  update public.shipments
     set registration_order_id=v_reg_id
   where organization_id=v_org
     and case_id=p_case_id
     and registration_order_id is null;

  return v_reg_id;
end;
$function$;

grant execute on function public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,currency_code,text) to authenticated;

create or replace function public.create_case_workflow(
  p_client_name text,
  p_registration_order_no text default null
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_client uuid;
  v_case uuid;
  v_case_number text;
  v_reg text;
  v_reg_id uuid;
  v_reg_client uuid;
  v_reg_number text;
  v_reg_closed boolean;
  v_match_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_org := public.user_org_id();
  if v_org is null then raise exception 'organization not found'; end if;
  if public.user_role() not in ('owner','admin','broker') then raise exception 'insufficient role'; end if;
  if nullif(trim(p_client_name),'') is null then raise exception 'cargo owner is required'; end if;

  select id into v_client from public.clients
   where organization_id=v_org and lower(trim(name))=lower(trim(p_client_name))
   limit 1;

  if v_client is null then
    insert into public.clients(organization_id,name)
    values(v_org,trim(p_client_name))
    returning id into v_client;
  end if;

  v_reg := nullif(trim(p_registration_order_no),'');
  if v_reg is not null then
    select count(*) into v_match_count
      from public.registration_orders ro
     where ro.organization_id=v_org
       and public.normalize_registration_order_number(ro.order_number)
           = public.normalize_registration_order_number(v_reg);

    if v_match_count=0 then
      raise exception 'ابتدا ثبت سفارش مادر را در بخش مدیریت ثبت سفارش‌ها ایجاد کنید.';
    elsif v_match_count>1 then
      raise exception 'چند ثبت سفارش با شماره مشابه پیدا شد؛ ابتدا موارد تکراری را بررسی کنید.';
    end if;

    select id,client_id,order_number,is_closed
      into v_reg_id,v_reg_client,v_reg_number,v_reg_closed
      from public.registration_orders ro
     where ro.organization_id=v_org
       and public.normalize_registration_order_number(ro.order_number)
           = public.normalize_registration_order_number(v_reg)
     limit 1
     for update;

    if v_reg_closed then
      raise exception 'ثبت سفارش مادر نهایی شده است و امکان شروع محموله جدید ندارد.';
    end if;
    if v_reg_client is not null and v_reg_client is distinct from v_client then
      raise exception 'صاحب کالای انتخاب‌شده با صاحب کالای ثبت سفارش مادر یکسان نیست.';
    end if;
    if v_reg_client is null then
      update public.registration_orders
         set client_id=v_client,updated_at=now()
       where id=v_reg_id and organization_id=v_org;
    end if;
    v_reg := v_reg_number;
  end if;

  v_case_number := 'CASE-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  insert into public.cases(organization_id,client_id,case_number,status,registration_order_no)
  values(v_org,v_client,v_case_number,'draft',v_reg)
  returning id into v_case;

  if v_reg is not null then
    update public.cases
       set status='registration_order'
     where id=v_case and organization_id=v_org;
  end if;

  return v_case;
end;
$function$;

grant execute on function public.create_case_workflow(text,text) to authenticated;
