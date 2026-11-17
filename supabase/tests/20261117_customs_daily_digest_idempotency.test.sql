-- Run after the daily digest idempotency migration on the ephemeral test database.
DO $privileges$
BEGIN
  IF pg_catalog.has_table_privilege('authenticated', 'public.customs_daily_digest_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users must not read daily digest delivery records';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.claim_customs_daily_digest(uuid,uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users must not claim daily digests';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.finish_customs_daily_digest(uuid,uuid,date,integer,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not finish daily digests';
  END IF;
END;
$privileges$;

SET ROLE service_role;
DO $test$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_user uuid := '00000000-0000-0000-0000-000000000101';
  v_claimed boolean;
  v_finished boolean;
  v_status text;
BEGIN
  SELECT public.claim_customs_daily_digest(v_org, v_user, DATE '2026-11-17') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'First daily digest claim must succeed'; END IF;
  SELECT public.claim_customs_daily_digest(v_org, v_user, DATE '2026-11-17') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Repeated daily digest claim must be rejected'; END IF;

  SELECT public.finish_customs_daily_digest(v_org, v_user, DATE '2026-11-17', 2, 1, NULL) INTO v_finished;
  IF v_finished IS DISTINCT FROM true THEN RAISE EXCEPTION 'Claimed digest must finish once'; END IF;
  SELECT public.claim_customs_daily_digest(v_org, v_user, DATE '2026-11-17') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM false THEN RAISE EXCEPTION 'A sent daily digest must never be sent twice'; END IF;

  SELECT public.claim_customs_daily_digest(v_org, v_user, DATE '2026-11-18') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Next local day must permit a new digest'; END IF;
  SELECT public.finish_customs_daily_digest(v_org, v_user, DATE '2026-11-18', 0, 2, 'all_push_devices_failed') INTO v_finished;
  IF v_finished IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed delivery outcome must be recorded'; END IF;
  SELECT status INTO v_status
  FROM public.customs_daily_digest_deliveries
  WHERE user_id = v_user AND local_date = DATE '2026-11-18';
  IF v_status <> 'failed' THEN RAISE EXCEPTION 'All-failed push outcome must be persisted as failed'; END IF;
  SELECT public.claim_customs_daily_digest(v_org, v_user, DATE '2026-11-18') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Failed but attempted digest must not create duplicate retries'; END IF;

  SELECT public.claim_customs_daily_digest(v_org, '00000000-0000-0000-0000-000000000102', DATE '2026-11-17') INTO v_claimed;
  IF v_claimed IS DISTINCT FROM true THEN RAISE EXCEPTION 'A different user must have an independent daily claim'; END IF;
END;
$test$;
RESET ROLE;
