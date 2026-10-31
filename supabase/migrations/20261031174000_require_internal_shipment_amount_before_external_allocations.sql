-- An outside allocation can only be valued safely when the internal shipment
-- values/currencies are known. Do not reserve money against an incomplete total.
create or replace function public.validate_registration_order_external_allocation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_order public.registration_orders%rowtype;
  v_missing_weight_count integer := 0;
  v_missing_value_count integer := 0;
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

  if v_order.net_weight_kg is null
     or v_order.value_amount is null
     or v_order.currency is null then
    raise exception using errcode='23514',
      message='برای کنترل سقف سهم واگذارشده، ابتدا وزن خالص، ارزش کل و ارز ثبت سفارش مادر را تکمیل کنید.';
  end if;

  if v_order.gross_weight_kg is not null and new.gross_weight_kg is null then
    raise exception using errcode='23514',
      message='وزن ناخالص در ثبت سفارش مادر مشخص است؛ وزن ناخالص سهم بیرونی را هم وارد کنید.';
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

  if new.currency is distinct from v_order.currency then
    raise exception using errcode='23514',
      message='ارز سهم واگذارشده باید با ارز ثبت سفارش مادر یکسان باشد.';
  end if;

  if new.status <> 'cancelled' then
    select
      count(*) filter (
        where coalesce(d.net_weight_kg,s.net_weight_kg) is null
          or (v_order.gross_weight_kg is not null and coalesce(d.gross_weight_kg,s.gross_weight_kg) is null)
      )::integer,
      count(*) filter (
        where d.invoice_amount is null or nullif(trim(d.invoice_currency),'') is null
      )::integer
    into v_missing_weight_count,v_missing_value_count
    from public.shipments s
    left join public.cases c
      on c.id=s.case_id and c.organization_id=s.organization_id
    left join public.shipment_customs_data d
      on d.shipment_id=s.id
    where s.organization_id=v_order.organization_id
      and (
        s.registration_order_id=new.registration_order_id
        or (
          s.registration_order_id is null
          and (
            s.case_id=v_order.case_id
            or c.registration_order_no=v_order.order_number
          )
        )
      );

    if v_missing_weight_count > 0 or v_missing_value_count > 0 then
      raise exception using errcode='23514',
        message='ابتدا وزن و مبلغ فاکتور و ارز همه محموله‌های داخلی این ثبت سفارش را تکمیل کنید؛ تا آن زمان کنترل کامل ارزش سهم بیرونی ممکن نیست.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
