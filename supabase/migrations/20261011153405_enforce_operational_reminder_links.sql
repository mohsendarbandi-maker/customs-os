create or replace function public.validate_operational_reminder_links()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_shipment_case uuid;
begin
  if new.case_id is not null and not exists (
    select 1 from public.cases c
    where c.id = new.case_id
      and c.organization_id = new.organization_id
  ) then
    raise exception 'پرونده یادآور باید متعلق به همان سازمان باشد';
  end if;

  if new.shipment_id is not null then
    select s.case_id into v_shipment_case
    from public.shipments s
    where s.id = new.shipment_id
      and s.organization_id = new.organization_id;

    if not found then
      raise exception 'محموله یادآور باید متعلق به همان سازمان باشد';
    end if;

    if new.case_id is not null and v_shipment_case is not null and new.case_id <> v_shipment_case then
      raise exception 'پرونده یادآور با محموله مرتبط مطابقت ندارد';
    end if;
    new.case_id := coalesce(new.case_id, v_shipment_case);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_operational_reminder_links on public.operational_reminders;
create trigger trg_validate_operational_reminder_links
before insert or update of organization_id, case_id, shipment_id
on public.operational_reminders
for each row
execute function public.validate_operational_reminder_links();
