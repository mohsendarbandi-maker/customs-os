-- Add a safe review queue for legacy registration-order references.
-- A customs-data text number is a candidate, not an automatic ownership link.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_registration_order_number(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT nullif(
    pg_catalog.translate(
      pg_catalog.btrim(coalesce(p_value, '')),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
      '01234567890123456789'
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.registration_order_currency_code(p_value text)
RETURNS public.currency_code
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
    WHEN 'irr' THEN 'IRR'::public.currency_code
    WHEN 'ریال' THEN 'IRR'::public.currency_code
    WHEN 'usd' THEN 'USD'::public.currency_code
    WHEN 'دلار آمریکا' THEN 'USD'::public.currency_code
    WHEN 'دلار آمریکا (usd)' THEN 'USD'::public.currency_code
    WHEN 'aed' THEN 'AED'::public.currency_code
    WHEN 'aed درهم' THEN 'AED'::public.currency_code
    WHEN 'درهم امارات' THEN 'AED'::public.currency_code
    WHEN 'eur' THEN 'EUR'::public.currency_code
    WHEN 'eur یورو' THEN 'EUR'::public.currency_code
    WHEN 'یورو' THEN 'EUR'::public.currency_code
    WHEN 'cny' THEN 'CNY'::public.currency_code
    WHEN 'یوان' THEN 'CNY'::public.currency_code
    WHEN 'rub' THEN 'RUB'::public.currency_code
    WHEN 'روبل' THEN 'RUB'::public.currency_code
    WHEN 'gbp' THEN 'GBP'::public.currency_code
    WHEN 'پوند' THEN 'GBP'::public.currency_code
    WHEN 'chf' THEN 'CHF'::public.currency_code
    WHEN 'فرانک سوئیس' THEN 'CHF'::public.currency_code
    WHEN 'try' THEN 'TRY'::public.currency_code
    WHEN 'لیر ترکیه' THEN 'TRY'::public.currency_code
    ELSE NULL
  END;
$function$;

-- Keep the legacy case-number fallback, but normalize Persian/Arabic digits.
CREATE OR REPLACE FUNCTION public.registration_order_id_for_shipment(p_shipment_id uuid)
RETURNS uuid
LANGUAGE sql
SET search_path = ''
AS $function$
  SELECT coalesce(s.registration_order_id, ro_case.id, ro_number.id)
  FROM public.shipments s
  LEFT JOIN public.cases c
    ON c.id = s.case_id AND c.organization_id = s.organization_id
  LEFT JOIN public.registration_orders ro_case
    ON ro_case.case_id = s.case_id AND ro_case.organization_id = s.organization_id
  LEFT JOIN public.registration_orders ro_number
    ON ro_number.organization_id = s.organization_id
   AND public.normalize_registration_order_number(ro_number.order_number)
       = public.normalize_registration_order_number(c.registration_order_no)
  WHERE s.id = p_shipment_id
  LIMIT 1;
$function$;

-- Recognize valid textual labels for the same ISO currency code. Unknown labels
-- remain mismatches and are never guessed.
CREATE OR REPLACE FUNCTION public.assert_registration_order_totals(p_registration_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_order public.registration_orders%rowtype;
  v_shipment_count integer := 0;
  v_external_count integer := 0;
  v_net_weight numeric := 0;
  v_gross_weight numeric := 0;
  v_value numeric := 0;
  v_missing_value_count integer := 0;
  v_currency_mismatch_count integer := 0;
  v_external_net numeric := 0;
  v_external_gross numeric := 0;
  v_external_value numeric := 0;
  v_external_missing_value_count integer := 0;
  v_external_currency_mismatch_count integer := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.registration_orders
  WHERE id = p_registration_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    count(s.id)::integer,
    coalesce(sum(coalesce(d.net_weight_kg, s.net_weight_kg)), 0),
    coalesce(sum(coalesce(d.gross_weight_kg, s.gross_weight_kg)), 0),
    coalesce(sum(d.invoice_amount), 0),
    count(s.id) FILTER (
      WHERE d.invoice_amount IS NULL
         OR public.registration_order_currency_code(d.invoice_currency) IS NULL
    )::integer,
    count(s.id) FILTER (
      WHERE d.invoice_amount IS NOT NULL
        AND (
          v_order.currency IS NULL
          OR public.registration_order_currency_code(d.invoice_currency) IS DISTINCT FROM v_order.currency
        )
    )::integer
  INTO
    v_shipment_count, v_net_weight, v_gross_weight, v_value,
    v_missing_value_count, v_currency_mismatch_count
  FROM public.shipments s
  LEFT JOIN public.cases c
    ON c.id = s.case_id AND c.organization_id = s.organization_id
  LEFT JOIN public.shipment_customs_data d
    ON d.shipment_id = s.id AND d.organization_id = s.organization_id
  WHERE s.organization_id = v_order.organization_id
    AND (
      s.registration_order_id = p_registration_order_id
      OR (
        s.registration_order_id IS NULL
        AND (
          s.case_id = v_order.case_id
          OR public.normalize_registration_order_number(c.registration_order_no)
             = public.normalize_registration_order_number(v_order.order_number)
        )
      )
    );

  SELECT
    count(*)::integer,
    coalesce(sum(a.net_weight_kg), 0),
    coalesce(sum(a.gross_weight_kg), 0),
    coalesce(sum(a.value_amount), 0),
    count(*) FILTER (WHERE a.value_amount IS NULL OR a.currency IS NULL)::integer,
    count(*) FILTER (
      WHERE a.value_amount IS NOT NULL
        AND (v_order.currency IS NULL OR a.currency IS DISTINCT FROM v_order.currency)
    )::integer
  INTO
    v_external_count, v_external_net, v_external_gross, v_external_value,
    v_external_missing_value_count, v_external_currency_mismatch_count
  FROM public.registration_order_external_allocations a
  WHERE a.organization_id = v_order.organization_id
    AND a.registration_order_id = p_registration_order_id
    AND a.status <> 'cancelled';

  v_net_weight := v_net_weight + v_external_net;
  v_gross_weight := v_gross_weight + v_external_gross;
  v_value := v_value + v_external_value;

  IF v_currency_mismatch_count + v_external_currency_mismatch_count > 0 THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'ارز فاکتور یکی از محموله‌ها یا سهم‌های واگذارشده با ارز ثبت سفارش یکسان نیست.';
  END IF;

  IF v_order.net_weight_kg IS NOT NULL
     AND v_net_weight > v_order.net_weight_kg + 0.001 THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'مجموع وزن خالص محموله‌های داخلی و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  END IF;

  IF v_order.gross_weight_kg IS NOT NULL
     AND v_gross_weight > v_order.gross_weight_kg + 0.001 THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'مجموع وزن ناخالص محموله‌های داخلی و سهم‌های واگذارشده از وزن ثبت سفارش بیشتر می‌شود.';
  END IF;

  IF v_order.value_amount IS NOT NULL
     AND v_value > v_order.value_amount + 0.01 THEN
    RAISE EXCEPTION USING errcode = '23514',
      message = 'مجموع ارزش محموله‌های داخلی و سهم‌های واگذارشده از ارزش ثبت سفارش بیشتر می‌شود.';
  END IF;

  IF v_order.is_closed THEN
    IF v_shipment_count + v_external_count = 0 THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'برای نهایی‌سازی ثبت سفارش باید حداقل یک محموله یا سهم واگذارشده ثبت شده باشد.';
    END IF;

    IF v_order.net_weight_kg IS NULL
       OR abs(v_net_weight - v_order.net_weight_kg) > 0.001 THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'برای نهایی‌سازی، مجموع وزن خالص محموله‌های داخلی و سهم‌های واگذارشده باید دقیقاً با ثبت سفارش برابر باشد.';
    END IF;

    IF v_order.gross_weight_kg IS NOT NULL
       AND abs(v_gross_weight - v_order.gross_weight_kg) > 0.001 THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'برای نهایی‌سازی، مجموع وزن ناخالص باید با ثبت سفارش برابر باشد.';
    END IF;

    IF v_order.value_amount IS NULL OR v_order.currency IS NULL THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'ارزش و ارز ثبت سفارش برای نهایی‌سازی باید تکمیل شود.';
    END IF;

    IF v_missing_value_count + v_external_missing_value_count > 0 THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'ارزش فاکتور و ارز همه محموله‌ها و سهم‌های واگذارشده باید پیش از نهایی‌سازی ثبت شود.';
    END IF;

    IF abs(v_value - v_order.value_amount) > 0.01 THEN
      RAISE EXCEPTION USING errcode = '23514',
        message = 'برای نهایی‌سازی، مجموع ارزش محموله‌های داخلی و سهم‌های واگذارشده باید دقیقاً با ثبت سفارش برابر باشد.';
    END IF;
  END IF;
END;
$function$;

-- Keep the existing reconciliation view shape; normalize currency labels and
-- legacy case order numbers without silently promoting text candidates to links.
CREATE OR REPLACE VIEW public.registration_order_reconciliation
WITH (security_invoker = true)
AS
SELECT
  ro.id AS registration_order_id,
  ro.organization_id,
  ro.order_number,
  ro.order_date,
  ro.status,
  ro.client_id,
  ro.tariff_code,
  ro.quantity,
  ro.quantity_unit,
  ro.net_weight_kg AS registered_net_weight_kg,
  ro.gross_weight_kg AS registered_gross_weight_kg,
  ro.value_amount AS registered_value_amount,
  ro.currency,
  ro.is_closed,
  ro.closed_at,
  coalesce(sa.shipment_count, 0) AS shipment_count,
  coalesce(sa.shipped_net_weight_kg, 0::numeric) AS shipped_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg, 0::numeric) AS shipped_gross_weight_kg,
  coalesce(sa.shipped_value_amount, 0::numeric) AS shipped_value_amount,
  coalesce(sa.shipments_missing_invoice_value, 0) AS shipments_missing_invoice_value,
  coalesce(sa.shipments_with_currency_mismatch, 0) AS shipments_with_currency_mismatch,
  coalesce(ea.external_allocation_count, 0) AS external_allocation_count,
  coalesce(ea.external_allocated_net_weight_kg, 0::numeric) AS external_allocated_net_weight_kg,
  coalesce(ea.external_allocated_gross_weight_kg, 0::numeric) AS external_allocated_gross_weight_kg,
  coalesce(ea.external_allocated_value_amount, 0::numeric) AS external_allocated_value_amount,
  coalesce(ea.external_allocations_missing_value, 0) AS external_allocations_missing_value,
  coalesce(ea.external_allocations_currency_mismatch, 0) AS external_allocations_currency_mismatch,
  coalesce(sa.shipped_net_weight_kg, 0::numeric) + coalesce(ea.external_allocated_net_weight_kg, 0::numeric) AS total_allocated_net_weight_kg,
  coalesce(sa.shipped_gross_weight_kg, 0::numeric) + coalesce(ea.external_allocated_gross_weight_kg, 0::numeric) AS total_allocated_gross_weight_kg,
  coalesce(sa.shipped_value_amount, 0::numeric) + coalesce(ea.external_allocated_value_amount, 0::numeric) AS total_allocated_value_amount,
  coalesce(sa.shipment_count, 0) + coalesce(ea.external_allocation_count, 0) AS total_allocation_count
FROM public.registration_orders ro
LEFT JOIN LATERAL (
  SELECT
    count(s.id)::integer AS shipment_count,
    coalesce(sum(coalesce(d.net_weight_kg, s.net_weight_kg)), 0::numeric) AS shipped_net_weight_kg,
    coalesce(sum(coalesce(d.gross_weight_kg, s.gross_weight_kg)), 0::numeric) AS shipped_gross_weight_kg,
    coalesce(sum(d.invoice_amount), 0::numeric) AS shipped_value_amount,
    count(s.id) FILTER (
      WHERE s.id IS NOT NULL
        AND (
          d.invoice_amount IS NULL
          OR public.registration_order_currency_code(d.invoice_currency) IS NULL
        )
    )::integer AS shipments_missing_invoice_value,
    count(s.id) FILTER (
      WHERE d.invoice_amount IS NOT NULL
        AND (
          ro.currency IS NULL
          OR public.registration_order_currency_code(d.invoice_currency) IS DISTINCT FROM ro.currency
        )
    )::integer AS shipments_with_currency_mismatch
  FROM public.shipments s
  LEFT JOIN public.cases c
    ON c.id = s.case_id AND c.organization_id = s.organization_id
  LEFT JOIN public.shipment_customs_data d
    ON d.shipment_id = s.id AND d.organization_id = s.organization_id
  WHERE s.organization_id = ro.organization_id
    AND (
      s.registration_order_id = ro.id
      OR (
        s.registration_order_id IS NULL
        AND (
          s.case_id = ro.case_id
          OR public.normalize_registration_order_number(c.registration_order_no)
             = public.normalize_registration_order_number(ro.order_number)
        )
      )
    )
) sa ON true
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS external_allocation_count,
    coalesce(sum(a.net_weight_kg), 0::numeric) AS external_allocated_net_weight_kg,
    coalesce(sum(a.gross_weight_kg), 0::numeric) AS external_allocated_gross_weight_kg,
    coalesce(sum(a.value_amount), 0::numeric) AS external_allocated_value_amount,
    count(*) FILTER (WHERE a.value_amount IS NULL OR a.currency IS NULL)::integer AS external_allocations_missing_value,
    count(*) FILTER (
      WHERE a.value_amount IS NOT NULL
        AND (ro.currency IS NULL OR a.currency IS DISTINCT FROM ro.currency)
    )::integer AS external_allocations_currency_mismatch
  FROM public.registration_order_external_allocations a
  WHERE a.organization_id = ro.organization_id
    AND a.registration_order_id = ro.id
    AND a.status <> 'cancelled'
) ea ON true;

-- Text-only order numbers are exposed as review candidates, not counted as
-- allocations until a staff member explicitly links the shipment via its FK.
CREATE OR REPLACE VIEW public.registration_order_unlinked_candidates
WITH (security_invoker = true)
AS
WITH confirmed_internal AS (
  SELECT
    ro.id AS registration_order_id,
    coalesce(sum(coalesce(d.net_weight_kg, s.net_weight_kg)), 0::numeric) AS net_weight_kg,
    coalesce(sum(coalesce(d.gross_weight_kg, s.gross_weight_kg)), 0::numeric) AS gross_weight_kg,
    coalesce(sum(d.invoice_amount), 0::numeric) AS value_amount
  FROM public.registration_orders ro
  LEFT JOIN public.shipments s
    ON s.organization_id = ro.organization_id
   AND (
     s.registration_order_id = ro.id
     OR (
       s.registration_order_id IS NULL
       AND (
         s.case_id = ro.case_id
         OR EXISTS (
           SELECT 1
           FROM public.cases legacy_case
           WHERE legacy_case.id = s.case_id
             AND legacy_case.organization_id = s.organization_id
             AND public.normalize_registration_order_number(legacy_case.registration_order_no)
                 = public.normalize_registration_order_number(ro.order_number)
         )
       )
     )
   )
  LEFT JOIN public.shipment_customs_data d
    ON d.shipment_id = s.id AND d.organization_id = s.organization_id
  GROUP BY ro.id
),
confirmed_external AS (
  SELECT
    a.registration_order_id,
    coalesce(sum(a.net_weight_kg), 0::numeric) AS net_weight_kg,
    coalesce(sum(a.gross_weight_kg), 0::numeric) AS gross_weight_kg,
    coalesce(sum(a.value_amount), 0::numeric) AS value_amount
  FROM public.registration_order_external_allocations a
  WHERE a.status <> 'cancelled'
  GROUP BY a.registration_order_id
)
SELECT
  s.id AS shipment_id,
  s.organization_id,
  s.display_name AS shipment_display_name,
  s.case_id,
  c.registration_order_no AS case_registration_order_no,
  d.registration_order_no AS customs_registration_order_no,
  public.normalize_registration_order_number(d.registration_order_no) AS normalized_customs_order_number,
  ro.id AS registration_order_id,
  ro.order_number,
  s.client_id AS shipment_client_id,
  ro.client_id AS registration_order_client_id,
  (ro.client_id IS NOT NULL AND s.client_id IS DISTINCT FROM ro.client_id) AS owner_mismatch,
  coalesce(d.net_weight_kg, s.net_weight_kg) AS candidate_net_weight_kg,
  coalesce(d.gross_weight_kg, s.gross_weight_kg) AS candidate_gross_weight_kg,
  d.invoice_amount AS candidate_value_amount,
  d.invoice_currency,
  public.registration_order_currency_code(d.invoice_currency) AS invoice_currency_code,
  (d.invoice_amount IS NULL OR public.registration_order_currency_code(d.invoice_currency) IS NULL) AS invoice_missing_or_invalid,
  (d.invoice_amount IS NOT NULL AND public.registration_order_currency_code(d.invoice_currency) IS DISTINCT FROM ro.currency) AS currency_mismatch,
  (c.registration_order_no IS NOT NULL
    AND public.normalize_registration_order_number(c.registration_order_no)
        <> public.normalize_registration_order_number(ro.order_number)) AS case_order_conflict,
  d.bank_name AS shipment_bank_name,
  ro.bank_name AS registered_bank_name,
  (nullif(pg_catalog.btrim(d.bank_name), '') IS NOT NULL
    AND nullif(pg_catalog.btrim(ro.bank_name), '') IS NOT NULL
    AND pg_catalog.lower(pg_catalog.btrim(d.bank_name)) <> pg_catalog.lower(pg_catalog.btrim(ro.bank_name))) AS bank_name_mismatch,
  d.bank_branch AS shipment_bank_branch,
  ro.bank_branch AS registered_bank_branch,
  (nullif(pg_catalog.btrim(d.bank_branch), '') IS NOT NULL
    AND nullif(pg_catalog.btrim(ro.bank_branch), '') IS NOT NULL
    AND pg_catalog.lower(pg_catalog.btrim(d.bank_branch)) <> pg_catalog.lower(pg_catalog.btrim(ro.bank_branch))) AS bank_branch_mismatch,
  d.bank_branch_code AS shipment_bank_branch_code,
  ro.bank_branch_code AS registered_bank_branch_code,
  (nullif(pg_catalog.btrim(d.bank_branch_code), '') IS NOT NULL
    AND nullif(pg_catalog.btrim(ro.bank_branch_code), '') IS NOT NULL
    AND pg_catalog.btrim(d.bank_branch_code) <> pg_catalog.btrim(ro.bank_branch_code)) AS bank_branch_code_mismatch,
  d.lc_number AS shipment_payment_instrument_code,
  ro.payment_instrument_code AS registered_payment_instrument_code,
  (nullif(pg_catalog.btrim(d.lc_number), '') IS NOT NULL
    AND nullif(pg_catalog.btrim(ro.payment_instrument_code), '') IS NOT NULL
    AND pg_catalog.btrim(d.lc_number) <> pg_catalog.btrim(ro.payment_instrument_code)) AS payment_instrument_mismatch,
  ro.is_closed AS order_is_closed,
  (ro.net_weight_kg IS NOT NULL
    AND coalesce(ci.net_weight_kg, 0) + coalesce(d.net_weight_kg, s.net_weight_kg, 0) > ro.net_weight_kg + 0.001) AS would_exceed_net_weight,
  (ro.gross_weight_kg IS NOT NULL
    AND coalesce(ci.gross_weight_kg, 0) + coalesce(d.gross_weight_kg, s.gross_weight_kg, 0) > ro.gross_weight_kg + 0.001) AS would_exceed_gross_weight,
  (ro.value_amount IS NOT NULL
    AND coalesce(ci.value_amount, 0) + coalesce(d.invoice_amount, 0) > ro.value_amount + 0.01) AS would_exceed_value
FROM public.shipments s
JOIN public.shipment_customs_data d
  ON d.shipment_id = s.id AND d.organization_id = s.organization_id
JOIN public.registration_orders ro
  ON ro.organization_id = s.organization_id
 AND public.normalize_registration_order_number(d.registration_order_no)
     = public.normalize_registration_order_number(ro.order_number)
LEFT JOIN public.cases c
  ON c.id = s.case_id AND c.organization_id = s.organization_id
LEFT JOIN confirmed_internal ci
  ON ci.registration_order_id = ro.id
LEFT JOIN confirmed_external ce
  ON ce.registration_order_id = ro.id
WHERE s.registration_order_id IS NULL
  AND NOT (ro.case_id IS NOT NULL AND s.case_id = ro.case_id)
  AND NOT (
    public.normalize_registration_order_number(c.registration_order_no)
    = public.normalize_registration_order_number(ro.order_number)
  );

GRANT SELECT ON public.registration_order_unlinked_candidates TO authenticated;
COMMENT ON VIEW public.registration_order_unlinked_candidates IS
  'Text-only registration-order matches requiring staff review. These candidates are not treated as allocated shipments until registration_order_id is explicitly set.';

COMMIT;
