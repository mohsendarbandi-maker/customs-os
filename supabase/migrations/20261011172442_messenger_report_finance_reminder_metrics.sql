begin;

create or replace function public.messenger_report_snapshot(
  p_organization_id uuid,
  p_timezone text default 'Asia/Tehran'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_report_date date;
  v_today date;
  v_start timestamptz;
  v_end timestamptz;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_total_shipments bigint;
  v_shipments_updated bigint;
  v_total_cases bigint;
  v_cases_created bigint;
  v_declarations_created bigint;
  v_ship_pass_pending bigint;
  v_invoices_issued bigint;
  v_open_invoices bigint;
  v_overdue_invoices bigint;
  v_received_count bigint;
  v_received_total_irr numeric;
  v_paid_count bigint;
  v_paid_total_irr numeric;
  v_open_reminders bigint;
  v_overdue_reminders bigint;
  v_reminders_due_today bigint;
  v_urgent_reminders bigint;
  v_latest_shipments jsonb;
begin
  if p_organization_id is null then
    raise exception 'REPORT_ORGANIZATION_REQUIRED';
  end if;
  if p_timezone <> 'Asia/Tehran' then
    raise exception 'REPORT_TIMEZONE_NOT_ALLOWED';
  end if;

  v_today := (now() at time zone p_timezone)::date;
  v_report_date := v_today - 1;
  v_start := v_report_date::timestamp at time zone p_timezone;
  v_end := (v_report_date + 1)::timestamp at time zone p_timezone;
  v_today_start := v_today::timestamp at time zone p_timezone;
  v_today_end := (v_today + 1)::timestamp at time zone p_timezone;

  select count(*) into v_total_shipments
  from public.shipments s
  where s.organization_id = p_organization_id;

  select count(*) into v_shipments_updated
  from public.shipments s
  where s.organization_id = p_organization_id
    and s.updated_at >= v_start and s.updated_at < v_end;

  select count(*) into v_total_cases
  from public.cases c
  where c.organization_id = p_organization_id;

  select count(*) into v_cases_created
  from public.cases c
  where c.organization_id = p_organization_id
    and c.created_at >= v_start and c.created_at < v_end;

  select count(*) into v_declarations_created
  from public.customs_declarations d
  where d.organization_id = p_organization_id
    and d.created_at >= v_start and d.created_at < v_end;

  select count(*) into v_ship_pass_pending
  from public.shipments s
  where s.organization_id = p_organization_id
    and s.ship_passed is distinct from true;

  select count(*) into v_invoices_issued
  from public.finance_invoices i
  where i.organization_id = p_organization_id
    and i.issued_at >= v_start and i.issued_at < v_end
    and i.voided_at is null;

  select count(*) into v_open_invoices
  from public.finance_invoices i
  where i.organization_id = p_organization_id
    and i.status in ('issued','partially_paid')
    and i.voided_at is null;

  select count(*) into v_overdue_invoices
  from public.finance_invoices i
  where i.organization_id = p_organization_id
    and i.status in ('issued','partially_paid')
    and i.voided_at is null
    and i.due_date < v_today;

  select count(*), coalesce(sum(p.amount_irr),0)
    into v_received_count,v_received_total_irr
  from public.finance_payments p
  where p.organization_id = p_organization_id
    and p.direction = 'received'
    and p.payment_date >= v_start and p.payment_date < v_end;

  select count(*), coalesce(sum(p.amount_irr),0)
    into v_paid_count,v_paid_total_irr
  from public.finance_payments p
  where p.organization_id = p_organization_id
    and p.direction = 'paid'
    and p.payment_date >= v_start and p.payment_date < v_end;

  select count(*) into v_open_reminders
  from public.operational_reminders r
  where r.organization_id = p_organization_id
    and r.status = 'open'
    and r.deleted_at is null;

  select count(*) into v_overdue_reminders
  from public.operational_reminders r
  where r.organization_id = p_organization_id
    and r.status = 'open'
    and r.deleted_at is null
    and r.due_at < now();

  select count(*) into v_reminders_due_today
  from public.operational_reminders r
  where r.organization_id = p_organization_id
    and r.status = 'open'
    and r.deleted_at is null
    and r.due_at >= v_today_start and r.due_at < v_today_end;

  select count(*) into v_urgent_reminders
  from public.operational_reminders r
  where r.organization_id = p_organization_id
    and r.status = 'open'
    and r.deleted_at is null
    and r.priority = 'urgent';

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_latest_shipments
  from (
    select
      coalesce(nullif(s.display_name,''),nullif(s.bill_of_lading_no,''),'محموله') as display_name,
      s.bill_of_lading_no,
      s.current_status::text as current_status,
      s.current_location,
      s.eta_destination,
      s.updated_at,
      c.case_number,
      c.cargo_description,
      cl.name as client_name
    from public.shipments s
    left join public.cases c
      on c.id = s.case_id and c.organization_id = s.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = s.organization_id
    where s.organization_id = p_organization_id
      and s.updated_at >= v_start and s.updated_at < v_end
    order by s.updated_at desc, s.id
    limit 8
  ) t;

  return jsonb_build_object(
    'report_date', v_report_date,
    'timezone', p_timezone,
    'total_shipments', v_total_shipments,
    'shipments_updated', v_shipments_updated,
    'total_cases', v_total_cases,
    'cases_created', v_cases_created,
    'declarations_created', v_declarations_created,
    'ship_pass_pending', v_ship_pass_pending,
    'invoices_issued', v_invoices_issued,
    'open_invoices', v_open_invoices,
    'overdue_invoices', v_overdue_invoices,
    'payments_received_count', v_received_count,
    'payments_received_total_irr', v_received_total_irr,
    'payments_paid_count', v_paid_count,
    'payments_paid_total_irr', v_paid_total_irr,
    'open_reminders', v_open_reminders,
    'overdue_reminders', v_overdue_reminders,
    'reminders_due_today', v_reminders_due_today,
    'urgent_reminders', v_urgent_reminders,
    'latest_shipments', v_latest_shipments
  );
end;
$$;

revoke all on function public.messenger_report_snapshot(uuid,text) from public, anon, authenticated;
grant execute on function public.messenger_report_snapshot(uuid,text) to service_role;

commit;