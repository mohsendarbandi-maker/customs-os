CREATE OR REPLACE FUNCTION public.messenger_report_snapshot(p_organization_id uuid, p_timezone text DEFAULT 'Asia/Tehran'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
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
  v_shipment_statuses jsonb;
  v_completed_work jsonb;
  v_pending_work jsonb;
  v_pending_ship_passes jsonb;
  v_recent_changes jsonb;
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


  -- Human-readable daily report data: current shipment state, completed tasks, outstanding tasks, and tracked changes.
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_shipment_statuses
  from (
    select
      coalesce(nullif(btrim(s.display_name),''),nullif(btrim(s.bill_of_lading_no),''),'محموله') as display_name,
      s.bill_of_lading_no,
      s.current_status::text as current_status,
      s.current_location,
      s.eta_destination,
      s.updated_at,
      c.case_number,
      c.cargo_description,
      cl.name as client_name,
      s.ship_passed,
      s.transport_documents_status,
      s.release_status
    from public.shipments s
    left join public.cases c
      on c.id = s.case_id and c.organization_id = s.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = s.organization_id
    where s.organization_id = p_organization_id
    order by
      case when coalesce(s.current_status::text,'') not in ('completed','cancelled') then 0 else 1 end,
      s.updated_at desc, s.id
    limit 10
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.completed_at desc), '[]'::jsonb)
    into v_completed_work
  from (
    select
      r.title,
      r.description,
      r.completed_at,
      r.priority,
      coalesce(
        nullif(btrim(s.display_name),''),
        nullif(btrim(s.bill_of_lading_no),''),
        nullif(btrim(c.display_name),''),
        nullif(btrim(c.case_number),'')
      ) as related_name,
      cl.name as client_name
    from public.operational_reminders r
    left join public.shipments s
      on s.id = r.shipment_id and s.organization_id = r.organization_id
    left join public.cases c
      on c.id = coalesce(r.case_id,s.case_id) and c.organization_id = r.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = r.organization_id
    where r.organization_id = p_organization_id
      and r.deleted_at is null
      and r.status in ('done','completed')
      and r.completed_at >= v_start and r.completed_at < v_end
    order by r.completed_at desc
    limit 8
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by
    case when t.due_at is not null and t.due_at < now() then 0 else 1 end,
    case t.priority when 'urgent' then 0 when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    t.due_at asc nulls last), '[]'::jsonb)
    into v_pending_work
  from (
    select
      r.title,
      r.description,
      r.due_at,
      r.priority,
      r.status,
      coalesce(
        nullif(btrim(s.display_name),''),
        nullif(btrim(s.bill_of_lading_no),''),
        nullif(btrim(c.display_name),''),
        nullif(btrim(c.case_number),'')
      ) as related_name,
      cl.name as client_name
    from public.operational_reminders r
    left join public.shipments s
      on s.id = r.shipment_id and s.organization_id = r.organization_id
    left join public.cases c
      on c.id = coalesce(r.case_id,s.case_id) and c.organization_id = r.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = r.organization_id
    where r.organization_id = p_organization_id
      and r.deleted_at is null
      and r.status not in ('done','completed','cancelled','dismissed')
    order by
      case when r.due_at is not null and r.due_at < now() then 0 else 1 end,
      case r.priority when 'urgent' then 0 when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
      r.due_at asc nulls last, r.created_at asc
    limit 8
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
    into v_pending_ship_passes
  from (
    select
      coalesce(nullif(btrim(s.display_name),''),nullif(btrim(s.bill_of_lading_no),''),'محموله') as display_name,
      s.bill_of_lading_no,
      s.current_status::text as current_status,
      s.updated_at,
      c.case_number,
      cl.name as client_name
    from public.shipments s
    left join public.cases c
      on c.id = s.case_id and c.organization_id = s.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = s.organization_id
    where s.organization_id = p_organization_id
      and s.ship_passed is distinct from true
      and coalesce(s.current_status::text,'') <> 'cancelled'
    order by s.updated_at desc, s.id
    limit 8
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by case when t.change_type in ('tracking','workflow') then 0 else 1 end, t.occurred_at desc), '[]'::jsonb)
    into v_recent_changes
  from (
    select * from (
    select
      e.created_at as occurred_at,
      'tracking'::text as change_type,
      coalesce(nullif(btrim(s.display_name),''),nullif(btrim(s.bill_of_lading_no),''),'محموله') as shipment_name,
      cl.name as client_name,
      s.bill_of_lading_no::text as bill_of_lading_no,
      coalesce(nullif(btrim(e.notes),''),nullif(replace(e.event_code,'_',' '),''))::text as description,
      e.location::text as current_location,
      s.current_status::text as current_status,
      null::text as previous_stage,
      null::text as current_stage,
      e.event_code::text as event_code
    from public.shipment_tracking_events e
    join public.shipments s
      on s.id = e.shipment_id and s.organization_id = e.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,(select c.client_id from public.cases c where c.id=s.case_id and c.organization_id=s.organization_id))
      and cl.organization_id = e.organization_id
    where e.organization_id = p_organization_id
      and e.created_at >= v_start and e.created_at < v_end

    union all

    select
      w.created_at as occurred_at,
      'workflow'::text as change_type,
      coalesce(nullif(btrim(s.display_name),''),nullif(btrim(s.bill_of_lading_no),''),nullif(btrim(c.display_name),''),nullif(btrim(c.case_number),''),'اظهار گمرکی') as shipment_name,
      cl.name as client_name,
      s.bill_of_lading_no::text as bill_of_lading_no,
      null::text as description,
      null::text as current_location,
      null::text as current_status,
      w.previous_stage::text as previous_stage,
      w.current_stage::text as current_stage,
      w.event_type::text as event_code
    from public.customs_declaration_workflow_events w
    left join public.customs_declarations d
      on d.id = w.declaration_id and d.organization_id = w.organization_id
    left join public.shipments s
      on s.id = d.shipment_id and s.organization_id = d.organization_id
    left join public.cases c
      on c.id = coalesce(d.case_id,s.case_id) and c.organization_id = w.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = w.organization_id
    where w.organization_id = p_organization_id
      and w.created_at >= v_start and w.created_at < v_end

    union all

    select
      s.updated_at as occurred_at,
      'shipment'::text as change_type,
      coalesce(nullif(btrim(s.display_name),''),nullif(btrim(s.bill_of_lading_no),''),'محموله') as shipment_name,
      cl.name as client_name,
      s.bill_of_lading_no::text as bill_of_lading_no,
      'اطلاعات محموله به‌روزرسانی شد'::text as description,
      s.current_location::text as current_location,
      s.current_status::text as current_status,
      null::text as previous_stage,
      null::text as current_stage,
      'shipment_updated'::text as event_code
    from public.shipments s
    left join public.cases c
      on c.id = s.case_id and c.organization_id = s.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = s.organization_id
    where s.organization_id = p_organization_id
      and s.updated_at >= v_start and s.updated_at < v_end
      and not exists (
        select 1 from public.shipment_tracking_events e
        where e.organization_id = s.organization_id and e.shipment_id = s.id
          and e.created_at >= v_start and e.created_at < v_end
      )
      and not exists (
        select 1
        from public.customs_declarations d
        join public.customs_declaration_workflow_events w
          on w.declaration_id = d.id and w.organization_id = d.organization_id
        where d.organization_id = s.organization_id and d.shipment_id = s.id
          and w.created_at >= v_start and w.created_at < v_end
      )
    ) changes
    order by case when changes.change_type in ('tracking','workflow') then 0 else 1 end, changes.occurred_at desc
    limit 10
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
    'latest_shipments', v_latest_shipments,
    'shipment_statuses', v_shipment_statuses,
    'completed_work', v_completed_work,
    'pending_work', v_pending_work,
    'pending_ship_passes', v_pending_ship_passes,
    'recent_changes', v_recent_changes
  );
end;
$function$

