-- Do not allow an outside allocation unless the master order has measurable capacity.
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

  new.updated_at := now();
  return new;
end;
$$;
