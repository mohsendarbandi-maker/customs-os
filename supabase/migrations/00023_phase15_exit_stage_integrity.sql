-- 00023: Keep case stages monotonic during cargo-exit updates and record exit-driven stage changes.

CREATE OR REPLACE FUNCTION public.upsert_case_exit_operation(
  p_case_id uuid,p_exit_status text,p_exit_permit_no text DEFAULT NULL,p_exit_permit_date date DEFAULT NULL,
  p_exit_authorized_at timestamptz DEFAULT NULL,p_exit_at timestamptz DEFAULT NULL,p_vehicle_plate text DEFAULT NULL,
  p_driver_name text DEFAULT NULL,p_driver_national_id text DEFAULT NULL,p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_org uuid; v_current public.case_status; v_next public.case_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker','warehouse') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_current FROM public.cases WHERE id=p_case_id AND organization_id=v_org;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF p_exit_status NOT IN ('pending','authorized','released','exited','cancelled') THEN RAISE EXCEPTION 'Invalid exit status'; END IF;
  IF v_current='archived' THEN RAISE EXCEPTION 'Archived case cannot change exit status'; END IF;
  IF p_exit_status='exited' AND v_current NOT IN ('exit_permit','completed') THEN RAISE EXCEPTION 'Final cargo exit requires exit-permit stage'; END IF;
  IF p_exit_status IN ('authorized','released') AND v_current NOT IN ('duties_calculation','exit_permit') THEN RAISE EXCEPTION 'Exit authorization requires duties-calculation stage'; END IF;

  INSERT INTO public.case_exit_operations(organization_id,case_id,exit_status,exit_permit_no,exit_permit_date,exit_authorized_at,exit_at,vehicle_plate,driver_name,driver_national_id,notes,created_by)
  VALUES(v_org,p_case_id,p_exit_status,p_exit_permit_no,p_exit_permit_date,p_exit_authorized_at,p_exit_at,p_vehicle_plate,p_driver_name,p_driver_national_id,p_notes,auth.uid())
  ON CONFLICT(case_id) DO UPDATE SET
    exit_status=excluded.exit_status,exit_permit_no=excluded.exit_permit_no,exit_permit_date=excluded.exit_permit_date,
    exit_authorized_at=excluded.exit_authorized_at,exit_at=excluded.exit_at,vehicle_plate=excluded.vehicle_plate,
    driver_name=excluded.driver_name,driver_national_id=excluded.driver_national_id,notes=excluded.notes
  RETURNING id INTO v_id;

  v_next:=CASE
    WHEN p_exit_status='exited' THEN 'completed'::public.case_status
    WHEN p_exit_status IN ('authorized','released') THEN 'exit_permit'::public.case_status
    WHEN p_exit_status='pending' THEN CASE WHEN v_current='exit_permit' THEN v_current ELSE 'duties_calculation'::public.case_status END
    ELSE v_current
  END;

  IF v_next<>v_current THEN
    UPDATE public.cases SET status=v_next,updated_at=now() WHERE id=p_case_id AND organization_id=v_org;
    INSERT INTO public.case_status_history(organization_id,case_id,previous_status,new_status,notes,changed_by)
    VALUES(v_org,p_case_id,v_current,v_next,format('Cargo exit status: %s',p_exit_status),auth.uid());
  END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.upsert_case_exit_operation(uuid,text,text,date,timestamptz,timestamptz,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upsert_case_exit_operation(uuid,text,text,date,timestamptz,timestamptz,text,text,text,text) TO authenticated;
