BEGIN;

-- Until item-level shares exist, "team" must not grant every organization member
-- read/update/delete access. Existing production data had zero active team reminders.
DROP POLICY IF EXISTS operational_reminders_select ON public.operational_reminders;
CREATE POLICY operational_reminders_select
ON public.operational_reminders
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT public.user_org_id())
  AND (
    (SELECT public.user_role()) = ANY (ARRAY['owner'::user_role, 'admin'::user_role])
    OR created_by = (SELECT auth.uid())
    OR assignee_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS operational_reminders_update ON public.operational_reminders;
CREATE POLICY operational_reminders_update
ON public.operational_reminders
FOR UPDATE TO authenticated
USING (
  organization_id = (SELECT public.user_org_id())
  AND (
    (SELECT public.user_role()) = ANY (ARRAY['owner'::user_role, 'admin'::user_role])
    OR created_by = (SELECT auth.uid())
    OR assignee_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  organization_id = (SELECT public.user_org_id())
  AND (
    (SELECT public.user_role()) = ANY (ARRAY['owner'::user_role, 'admin'::user_role])
    OR created_by = (SELECT auth.uid())
    OR assignee_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS operational_reminders_delete ON public.operational_reminders;
CREATE POLICY operational_reminders_delete
ON public.operational_reminders
FOR DELETE TO authenticated
USING (
  organization_id = (SELECT public.user_org_id())
  AND (
    (SELECT public.user_role()) = ANY (ARRAY['owner'::user_role, 'admin'::user_role])
    OR created_by = (SELECT auth.uid())
    OR assignee_id = (SELECT auth.uid())
  )
);

-- Avoid sending reminder titles/deadlines to every active staff member merely
-- because visibility='team'. Until explicit item-level shares are shipped,
-- delivery is limited to the single responsible assignee.
CREATE OR REPLACE FUNCTION public.sync_operational_reminder_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_user uuid;
  v_fire timestamptz;
  v_offset integer;
  v_nag integer;
  v_recipients uuid[];
BEGIN
  IF NEW.status <> 'open' OR NEW.deleted_at IS NOT NULL THEN
    UPDATE public.reminder_deliveries
       SET status = 'skipped'
     WHERE reminder_id = NEW.id AND status = 'pending';
    RETURN NEW;
  END IF;

  IF NEW.due_at IS NULL THEN
    UPDATE public.reminder_deliveries
       SET status = 'skipped'
     WHERE reminder_id = NEW.id AND status = 'pending';
    RETURN NEW;
  END IF;

  IF NEW.snoozed_until IS NOT NULL AND NEW.snoozed_until > now() THEN
    UPDATE public.reminder_deliveries
       SET status = 'skipped'
     WHERE reminder_id = NEW.id AND status = 'pending';
    v_recipients := ARRAY[NEW.assignee_id];
    FOREACH v_user IN ARRAY v_recipients LOOP
      IF v_user IS NOT NULL THEN
        INSERT INTO public.reminder_deliveries(reminder_id,user_id,fire_at,status)
        VALUES(NEW.id,v_user,NEW.snoozed_until,'pending')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  v_recipients := ARRAY[NEW.assignee_id];
  FOREACH v_user IN ARRAY v_recipients LOOP
    IF v_user IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH v_offset IN ARRAY COALESCE(NEW.alarm_offsets_min, ARRAY[0]::integer[]) LOOP
      v_fire := NEW.due_at - make_interval(mins => v_offset);
      INSERT INTO public.reminder_deliveries(reminder_id,user_id,fire_at,status)
      VALUES(NEW.id,v_user,v_fire,'pending')
      ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COALESCE(overdue_nag_minutes,120)
      INTO v_nag
      FROM public.notification_preferences
     WHERE user_id = v_user;
    v_nag := COALESCE(v_nag,120);

    FOR i IN 1..3 LOOP
      INSERT INTO public.reminder_deliveries(reminder_id,user_id,fire_at,status)
      VALUES(NEW.id,v_user,NEW.due_at + make_interval(mins => v_nag * i),'pending')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMIT;
