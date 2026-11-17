-- One at-most-once daily digest claim per user and local calendar date.
-- The service-role edge function is the only writer; authenticated clients cannot inspect this ledger.
CREATE TABLE public.customs_daily_digest_deliveries (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'sent', 'failed')),
  sent_devices integer NOT NULL DEFAULT 0 CHECK (sent_devices >= 0),
  failed_devices integer NOT NULL DEFAULT 0 CHECK (failed_devices >= 0),
  last_error text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, local_date)
);

CREATE INDEX customs_daily_digest_deliveries_org_date_idx
  ON public.customs_daily_digest_deliveries (organization_id, local_date DESC);

ALTER TABLE public.customs_daily_digest_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customs_daily_digest_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customs_daily_digest_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_customs_daily_digest(
  p_organization_id uuid,
  p_user_id uuid,
  p_local_date date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_organization_id IS NULL OR p_user_id IS NULL OR p_local_date IS NULL THEN
    RAISE EXCEPTION 'Organization, user and local date are required';
  END IF;

  INSERT INTO public.customs_daily_digest_deliveries (
    organization_id, user_id, local_date, status
  ) VALUES (
    p_organization_id, p_user_id, p_local_date, 'processing'
  )
  ON CONFLICT (user_id, local_date) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_customs_daily_digest(
  p_organization_id uuid,
  p_user_id uuid,
  p_local_date date,
  p_sent_devices integer,
  p_failed_devices integer,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_sent_devices IS NULL OR p_sent_devices < 0
     OR p_failed_devices IS NULL OR p_failed_devices < 0 THEN
    RAISE EXCEPTION 'Delivery counts must be non-negative';
  END IF;

  UPDATE public.customs_daily_digest_deliveries
  SET status = CASE WHEN p_sent_devices > 0 THEN 'sent' ELSE 'failed' END,
      sent_devices = p_sent_devices,
      failed_devices = p_failed_devices,
      last_error = NULLIF(pg_catalog.left(COALESCE(p_error, ''), 1000), ''),
      finished_at = pg_catalog.clock_timestamp()
  WHERE organization_id = p_organization_id
    AND user_id = p_user_id
    AND local_date = p_local_date
    AND status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_customs_daily_digest(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_customs_daily_digest(uuid, uuid, date, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_customs_daily_digest(uuid, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_customs_daily_digest(uuid, uuid, date, integer, integer, text) TO service_role;
