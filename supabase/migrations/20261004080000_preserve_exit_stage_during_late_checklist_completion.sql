create or replace function public.sync_declaration_workflow_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $function$
declare
  v_declaration_id uuid := coalesce(new.declaration_id,old.declaration_id);
  v_current_stage integer;
  total_count int;
  done_count int;
begin
  select workflow_stage into v_current_stage
  from public.customs_declarations
  where id=v_declaration_id;

  select count(*) into total_count
  from public.declaration_checklist_items
  where declaration_id=v_declaration_id
    and item_key in ('در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار','مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد');

  select count(*) into done_count
  from public.declaration_checklist_items
  where declaration_id=v_declaration_id
    and item_key in ('در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار','مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد')
    and completed=true;

  update public.customs_declarations
  set workflow_stage = case
    when v_current_stage=6 then 6
    when total_count=11 and done_count=11 then 6
    else 5
  end,
  updated_at=now()
  where id=v_declaration_id;

  return coalesce(new,old);
end;
$function$;
