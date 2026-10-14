CREATE OR REPLACE FUNCTION public.complete_operational_reminder(
  p_reminder_id uuid,
  p_next_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_row public.operational_reminders;
  v_next_id uuid;
  v_actual_next_due timestamptz;
  v_series_id uuid;
  v_occurrence_key text;
BEGIN
  IF v_actor IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'احراز هویت الزامی است';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor
      AND p.organization_id = v_org
      AND p.is_active = true
      AND p.role IN ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  ) THEN
    RAISE EXCEPTION 'این حساب اجازهٔ تکمیل یادآور داخلی را ندارد';
  END IF;

  SELECT r.*
    INTO v_row
  FROM public.operational_reminders r
  WHERE r.id = p_reminder_id
    AND r.organization_id = v_org
    AND r.deleted_at IS NULL
    AND (
      v_role IN ('owner', 'admin')
      OR r.created_by = v_actor
      OR r.assignee_id = v_actor
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'یادآور پیدا نشد یا دسترسی تغییر آن مجاز نیست';
  END IF;

  IF v_row.status = 'dismissed' THEN
    RAISE EXCEPTION 'یادآور پنهان شده است و قابل تکمیل نیست';
  END IF;
  IF v_row.status NOT IN ('open', 'done') THEN
    RAISE EXCEPTION 'وضعیت یادآور برای تکمیل معتبر نیست';
  END IF;

  IF v_row.status = 'open' THEN
    UPDATE public.operational_reminders
       SET status = 'done',
           completed_at = COALESCE(completed_at, now()),
           completed_by = v_actor
     WHERE id = v_row.id;
  END IF;

  IF v_row.recurrence_rule IS NULL OR v_row.due_at IS NULL THEN
    IF p_next_due_at IS NOT NULL THEN
      RAISE EXCEPTION 'این یادآور نوبت تکراری ندارد';
    END IF;
    RETURN jsonb_build_object(
      'completed', true,
      'next_id', NULL,
      'next_due_at', NULL,
      'next_exists', false
    );
  END IF;

  IF p_next_due_at IS NULL THEN
    IF v_row.recurrence_until IS NULL THEN
      RAISE EXCEPTION 'نوبت بعدی تکرار محاسبه نشد؛ تکمیل یادآور ذخیره نشد';
    END IF;
    RETURN jsonb_build_object(
      'completed', true,
      'next_id', NULL,
      'next_due_at', NULL,
      'next_exists', false
    );
  END IF;

  IF p_next_due_at <= v_row.due_at THEN
    RAISE EXCEPTION 'تاریخ نوبت بعدی باید پس از موعد فعلی باشد';
  END IF;
  IF v_row.recurrence_until IS NOT NULL AND p_next_due_at > v_row.recurrence_until THEN
    RAISE EXCEPTION 'نوبت بعدی از تاریخ پایان تکرار عبور می‌کند';
  END IF;

  v_series_id := COALESCE(v_row.series_id, v_row.id);
  v_occurrence_key := to_char(
    p_next_due_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- A retry or a second device reuses the same occurrence instead of duplicating it.
  SELECT r.id, r.due_at
    INTO v_next_id, v_actual_next_due
  FROM public.operational_reminders r
  WHERE r.series_id = v_series_id
    AND r.occurrence_key = v_occurrence_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'completed', true,
      'next_id', v_next_id,
      'next_due_at', v_actual_next_due,
      'next_exists', true
    );
  END IF;

  INSERT INTO public.operational_reminders (
    organization_id, case_id, shipment_id, title, description, due_at, priority, status,
    created_by, due_precision, source_key, is_system, kind, entity_type, entity_id, assignee_id,
    visibility, all_day, timezone, alarm_offsets_min, recurrence_rule, recurrence_until,
    series_id, occurrence_key, snoozed_until, snooze_count, tags, notes, client_uuid,
    deleted_at, completed_at, completed_by
  ) VALUES (
    v_org, v_row.case_id, v_row.shipment_id, v_row.title, v_row.description,
    p_next_due_at, v_row.priority, 'open',
    v_actor, v_row.due_precision, NULL, v_row.is_system, v_row.kind,
    v_row.entity_type, v_row.entity_id, v_row.assignee_id,
    v_row.visibility, v_row.all_day, v_row.timezone, v_row.alarm_offsets_min,
    v_row.recurrence_rule, v_row.recurrence_until,
    v_series_id, v_occurrence_key, NULL, 0, v_row.tags, v_row.notes, NULL,
    NULL, NULL, NULL
  )
  ON CONFLICT (series_id, occurrence_key)
    WHERE series_id IS NOT NULL AND occurrence_key IS NOT NULL
    DO NOTHING
  RETURNING id, due_at INTO v_next_id, v_actual_next_due;

  IF v_next_id IS NULL THEN
    SELECT r.id, r.due_at
      INTO v_next_id, v_actual_next_due
    FROM public.operational_reminders r
    WHERE r.series_id = v_series_id
      AND r.occurrence_key = v_occurrence_key;
  END IF;

  IF v_next_id IS NULL THEN
    RAISE EXCEPTION 'نوبت بعدی یادآور ساخته نشد';
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'next_id', v_next_id,
    'next_due_at', v_actual_next_due,
    'next_exists', true
  );
END;
$function$;
