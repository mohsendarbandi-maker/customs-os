#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_ID="00000000-0000-0000-0000-000000000030"

# Capture one shared snapshot before starting either independent database session.
BASE_B64="$(psql -X -v ON_ERROR_STOP=1 -Atq -c \
  "SELECT encode(convert_to(expertise_state::text, 'UTF8'), 'base64') FROM public.customs_declaration_workflow WHERE id = '${WORKFLOW_ID}'")"
STAGE="$(psql -X -v ON_ERROR_STOP=1 -Atq -c \
  "SELECT current_stage FROM public.customs_declaration_workflow WHERE id = '${WORKFLOW_ID}'")"

if [[ -z "$BASE_B64" || -z "$STAGE" ]]; then
  echo "Could not capture the customs workflow baseline."
  exit 1
fi

PATCH_A='{"standard":{"expert_review":"approved"}}'
PATCH_B='{"standard":{"inspection_paid":true}}'

psql -X -v ON_ERROR_STOP=1 -v base_b64="$BASE_B64" -v stage="$STAGE" -v patch="$PATCH_A" <<'SQL' &
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET LOCAL request.jwt.claim.org_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role = 'broker';
SET LOCAL ROLE authenticated;
SELECT pg_sleep(0.25);
SELECT public.patch_customs_declaration_workflow_activity(
  '00000000-0000-0000-0000-000000000030',
  'expertise',
  :'patch'::jsonb,
  convert_from(decode(:'base_b64', 'base64'), 'UTF8')::jsonb,
  :'stage'
);
COMMIT;
SQL
PID_A=$!

psql -X -v ON_ERROR_STOP=1 -v base_b64="$BASE_B64" -v stage="$STAGE" -v patch="$PATCH_B" <<'SQL' &
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
SET LOCAL request.jwt.claim.org_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role = 'broker';
SET LOCAL ROLE authenticated;
SELECT pg_sleep(0.25);
SELECT public.patch_customs_declaration_workflow_activity(
  '00000000-0000-0000-0000-000000000030',
  'expertise',
  :'patch'::jsonb,
  convert_from(decode(:'base_b64', 'base64'), 'UTF8')::jsonb,
  :'stage'
);
COMMIT;
SQL
PID_B=$!

wait "$PID_A"
wait "$PID_B"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
DECLARE
  v_state jsonb;
BEGIN
  SELECT expertise_state INTO v_state
  FROM public.customs_declaration_workflow
  WHERE id = '00000000-0000-0000-0000-000000000030';

  IF v_state #>> '{standard,expert_review}' <> 'approved'
     OR v_state #>> '{standard,inspection_paid}' <> 'true' THEN
    RAISE EXCEPTION 'Concurrent disjoint activity edits did not both survive';
  END IF;
END;
$test$;

SELECT 'two-session concurrent customs workflow edits passed' AS result;
SQL
