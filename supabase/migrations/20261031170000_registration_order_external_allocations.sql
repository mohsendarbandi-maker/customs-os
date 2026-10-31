-- Track portions of a registration order assigned to an outside customs broker/company.
-- These portions are not internal Customs OS shipments, but reserve the same order capacity.
create table if not exists public.registration_order_external_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.user_org_id()
    references public.organizations(id) on delete cascade,
  registration_order_id uuid not null,
  recipient_company text,
  destination_customs text,
  allocation_reference text,
  status text not null default 'allocated'
    check (status = any (array['allocated','dispatched','completed','cancelled'])),
  net_weight_kg numeric not null check (net_weight_kg > 0),
  gross_weight_kg numeric check (gross_weight_kg is null or gross_weight_kg >= net_weight_kg),
  value_amount numeric not null check (value_amount >= 0),
  currency public.currency_code not null,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_order_external_allocations_destination_check
    check (nullif(trim(coalesce(recipient_company,'')),'') is not null
        or nullif(trim(coalesce(destination_customs,'')),'') is not null),
  constraint registration_order_external_allocations_order_fk
    foreign key (registration_order_id,organization_id)
    references public.registration_orders(id,organization_id) on delete restrict
);

create index if not exists registration_order_external_allocations_order_idx
  on public.registration_order_external_allocations(organization_id,registration_order_id,status);

alter table public.registration_order_external_allocations enable row level security;

drop policy if exists registration_order_external_allocations_select
  on public.registration_order_external_allocations;
create policy registration_order_external_allocations_select
  on public.registration_order_external_allocations
  for select to authenticated
  using (
    organization_id = public.user_org_id()
    and (
      public.user_role()::text <> 'client'
      or exists (
        select 1 from public.registration_orders ro
        where ro.id = registration_order_external_allocations.registration_order_id
          and ro.organization_id = registration_order_external_allocations.organization_id
          and ro.client_id = public.user_client_id()
      )
    )
  );

drop policy if exists registration_order_external_allocations_insert
  on public.registration_order_external_allocations;
create policy registration_order_external_allocations_insert
  on public.registration_order_external_allocations
  for insert to authenticated
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text = any(array['owner','admin','broker'])
    and exists (
      select 1 from public.registration_orders ro
      where ro.id = registration_order_external_allocations.registration_order_id
        and ro.organization_id = registration_order_external_allocations.organization_id
        and not ro.is_closed
    )
  );

drop policy if exists registration_order_external_allocations_update
  on public.registration_order_external_allocations;
create policy registration_order_external_allocations_update
  on public.registration_order_external_allocations
  for update to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text = any(array['owner','admin','broker'])
  )
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text = any(array['owner','admin','broker'])
    and exists (
      select 1 from public.registration_orders ro
      where ro.id = registration_order_external_allocations.registration_order_id
        and ro.organization_id = registration_order_external_allocations.organization_id
        and not ro.is_closed
    )
  );

grant select,insert,update on public.registration_order_external_allocations to authenticated;

create or replace function public.validate_registration_order_external_allocation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_order public.registration_orders%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.registration_order_id is distinct from old.registration_order_id
       or new.organization_id is distinct from old.organization_id then
      raise exception using errcode='23514',
        message='انتقال سهم واگذارشده به ثبت سفارش یا سازمان دیگر مجاز نیست؛ سهم قبلی را لغو و سهم جدید را جداگانه ثبت کنید.';
    end if;
  end if;

  select * into v_order
    from public.registration_orders
   where id = new.registration_order_id
     and organization_id = new.organization_id
   for update;

  if not found then
    raise exception using errcode='23503',
      message='ثبت سفارش مادر پیدا نشد یا متعلق به این سازمان نیست.';
  end if;

  if v_order.is_closed then
    raise exception using errcode='23514',
      message='ثبت سفارش نهایی شده است؛ امکان ایجاد یا تغییر سهم واگذارشده وجود ندارد.';
  end if;

  if nullif(trim(coalesce(new.recipient_company,'')),'') is null
     and nullif(trim(coalesce(new.destination_customs,'')),'') is null then
    raise exception using errcode='23514',
      message='نام شرکت دریافت‌کننده یا گمرک مقصد را وارد کنید.';
  end if;

  if new.net_weight_kg is null or new.net_weight_kg <= 0 then
    raise exception using errcode='23514',
      message='وزن خالص سهم واگذارشده باید بیشتر از صفر باشد.';
  end if;

  if new.value_amount is null or new.value_amount < 0 then
    raise exception using errcode='23514',
      message='ارزش سهم واگذارشده را وارد کنید.';
  end if;

  if v_order.currency is null then
    raise exception using errcode='23514',
      message='ابتدا ارز ثبت سفارش مادر را مشخص کنید.';
  end if;

  if new.currency is distinct from v_order.currency then
    raise exception using errcode='23514',
      message='ارز سهم واگذارشده باید با ارز ثبت سفارش مادر یکسان باشد.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.check_registration_order_external_allocation_totals()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    v_order_id := old.registration_order_id;
    perform public.assert_registration_order_totals(v_order_id);
    return old;
  end if;

  v_order_id := new.registration_order_id;
  perform public.assert_registration_order_totals(v_order_id);
  return new;
end;
$$;

drop trigger if exists trg_validate_registration_order_external_allocation
  on public.registration_order_external_allocations;
create trigger trg_validate_registration_order_external_allocation
  before insert or update
  on public.registration_order_external_allocations
  for each row execute function public.validate_registration_order_external_allocation();

drop trigger if exists trg_check_registration_order_external_allocation_totals
  on public.registration_order_external_allocations;
create trigger trg_check_registration_order_external_allocation_totals
  after insert or update or delete
  on public.registration_order_external_allocations
  for each row execute function public.check_registration_order_external_allocation_totals();

-- The parent's locked row serializes competing internal shipment and external-allocation changes.
-- Every active external allocation counts against net/gross weight and order value.
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
        or nullif(trim(d.invoice_currency),'') is null
        or upper(trim(d.invoice_currency)) <> upper(v_order.currency::text)
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
          or c.registration_order_no = v_order.order_number
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
$$;

create or replace view public.registration_order_reconciliation
with (security_invoker=true) as
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
  select
    count(s.id)::integer as shipment_count,
    coalesce(sum(coalesce(d.net_weight_kg,s.net_weight_kg)),0) as shipped_net_weight_kg,
    coalesce(sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)),0) as shipped_gross_weight_kg,
    coalesce(sum(d.invoice_amount),0) as shipped_value_amount,
    count(s.id) filter (
      where s.id is not null and (
        d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null
      )
    )::integer as shipments_missing_invoice_value,
    count(s.id) filter (
      where d.invoice_amount is not null and (
        ro.currency is null or nullif(trim(d.invoice_currency),'') is null
        or upper(trim(d.invoice_currency)) <> upper(ro.currency::text)
      )
    )::integer as shipments_with_currency_mismatch
  from public.shipments s
  left join public.cases c
    on c.id=s.case_id and c.organization_id=s.organization_id
  left join public.shipment_customs_data d
    on d.shipment_id=s.id
  where s.organization_id=ro.organization_id
    and (
      s.registration_order_id=ro.id
      or (
        s.registration_order_id is null
        and (
          s.case_id=ro.case_id
          or c.registration_order_no=ro.order_number
        )
      )
    )
) sa on true
left join lateral (
  select
    count(*)::integer as external_allocation_count,
    coalesce(sum(a.net_weight_kg),0) as external_allocated_net_weight_kg,
    coalesce(sum(a.gross_weight_kg),0) as external_allocated_gross_weight_kg,
    coalesce(sum(a.value_amount),0) as external_allocated_value_amount,
    count(*) filter (
      where a.value_amount is null or a.currency is null
    )::integer as external_allocations_missing_value,
    count(*) filter (
      where a.value_amount is not null and (
        ro.currency is null or a.currency is distinct from ro.currency
      )
    )::integer as external_allocations_currency_mismatch
  from public.registration_order_external_allocations a
  where a.organization_id=ro.organization_id
    and a.registration_order_id=ro.id
    and a.status <> 'cancelled'
) ea on true;

grant select on public.registration_order_reconciliation to authenticated;
