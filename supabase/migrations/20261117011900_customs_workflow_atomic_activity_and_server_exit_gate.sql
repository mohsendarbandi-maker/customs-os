-- Atomic, field-level customs workflow updates and a database-enforced exit gate.
-- SECURITY INVOKER keeps organization and role enforcement inside the existing RLS policies.

CREATE OR REPLACE FUNCTION public.customs_workflow_jsonb_merge(
  p_current jsonb,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_current) = 'object' THEN p_current
    ELSE '{}'::jsonb
  END;
  v_pair record;
  v_existing jsonb;
  v_next jsonb;
BEGIN
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'A JSON object patch is required';
  END IF;

  FOR v_pair IN
    SELECT e.key, e.value
    FROM pg_catalog.jsonb_each(p_patch) AS e(key, value)
  LOOP
    v_existing := v_result -> v_pair.key;

    IF pg_catalog.jsonb_typeof(v_pair.value) = 'object'
       AND pg_catalog.jsonb_typeof(v_existing) = 'object' THEN
      v_next := public.customs_workflow_jsonb_merge(v_existing, v_pair.value);
    ELSE
      v_next := v_pair.value;
    END IF;

    v_result := pg_catalog.jsonb_set(v_result, ARRAY[v_pair.key], v_next, true);
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customs_workflow_jsonb_conflicts(
  p_current jsonb,
  p_base jsonb,
  p_patch jsonb,
  p_prefix text DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_pair record;
  v_current_value jsonb;
  v_base_value jsonb;
  v_patch_value jsonb;
  v_path text;
  v_conflicts text[] := '{}'::text[];
  v_nested text[];
  v_current_has boolean;
  v_base_has boolean;
BEGIN
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RETURN ARRAY[COALESCE(p_prefix, '$')];
  END IF;

  FOR v_pair IN
    SELECT e.key, e.value
    FROM pg_catalog.jsonb_each(p_patch) AS e(key, value)
  LOOP
    v_path := CASE
      WHEN COALESCE(p_prefix, '') = '' THEN v_pair.key
      ELSE p_prefix || '.' || v_pair.key
    END;

    v_current_value := COALESCE(p_current, '{}'::jsonb) -> v_pair.key;
    v_base_value := COALESCE(p_base, '{}'::jsonb) -> v_pair.key;
    v_patch_value := v_pair.value;
    v_current_has := COALESCE(p_current, '{}'::jsonb) ? v_pair.key;
    v_base_has := COALESCE(p_base, '{}'::jsonb) ? v_pair.key;

    IF pg_catalog.jsonb_typeof(v_patch_value) = 'object'
       AND pg_catalog.jsonb_typeof(v_base_value) = 'object'
       AND pg_catalog.jsonb_typeof(v_current_value) = 'object' THEN
      v_nested := public.customs_workflow_jsonb_conflicts(
        v_current_value, v_base_value, v_patch_value, v_path
      );
      v_conflicts := v_conflicts || v_nested;
    ELSE
      IF v_current_has IS DISTINCT FROM v_base_has
         AND NOT (v_current_has AND v_current_value IS NOT DISTINCT FROM v_patch_value) THEN
        v_conflicts := pg_catalog.array_append(v_conflicts, v_path);
      ELSIF v_current_value IS DISTINCT FROM v_base_value
         AND v_current_value IS DISTINCT FROM v_patch_value THEN
        v_conflicts := pg_catalog.array_append(v_conflicts, v_path);
      END IF;
    END IF;
  END LOOP;

  RETURN v_conflicts;
END;
$function$;

-- Compare-and-swap undo: restore only leaves changed by the selected event,
-- and only while those leaves still contain that event's after-value.
CREATE OR REPLACE FUNCTION public.customs_workflow_jsonb_undo(
  p_current jsonb,
  p_before jsonb,
  p_after jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb := p_current;
  v_key text;
  v_before_value jsonb;
  v_after_value jsonb;
  v_current_value jsonb;
  v_before_has boolean;
  v_after_has boolean;
  v_current_has boolean;
  v_nested jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_before) <> 'object'
     OR pg_catalog.jsonb_typeof(p_after) <> 'object'
     OR pg_catalog.jsonb_typeof(p_current) <> 'object' THEN
    IF p_current IS NOT DISTINCT FROM p_after THEN
      RETURN p_before;
    END IF;
    RETURN p_current;
  END IF;

  FOR v_key IN
    SELECT keys.key
    FROM (
      SELECT e.key FROM pg_catalog.jsonb_each(p_before) AS e(key, value)
      UNION
      SELECT e.key FROM pg_catalog.jsonb_each(p_after) AS e(key, value)
    ) AS keys
    ORDER BY keys.key
  LOOP
    v_before_has := p_before ? v_key;
    v_after_has := p_after ? v_key;
    v_current_has := COALESCE(v_result, '{}'::jsonb) ? v_key;
    v_before_value := p_before -> v_key;
    v_after_value := p_after -> v_key;
    v_current_value := v_result -> v_key;

    IF v_before_has AND v_after_has
       AND pg_catalog.jsonb_typeof(v_before_value) = 'object'
       AND pg_catalog.jsonb_typeof(v_after_value) = 'object'
       AND v_current_has
       AND pg_catalog.jsonb_typeof(v_current_value) = 'object' THEN
      v_nested := public.customs_workflow_jsonb_undo(
        v_current_value, v_before_value, v_after_value
      );
      v_result := pg_catalog.jsonb_set(v_result, ARRAY[v_key], v_nested, true);
    ELSIF v_current_has IS NOT DISTINCT FROM v_after_has
       AND (NOT v_after_has OR v_current_value IS NOT DISTINCT FROM v_after_value) THEN
      IF v_before_has THEN
        v_result := pg_catalog.jsonb_set(v_result, ARRAY[v_key], v_before_value, true);
      ELSE
        v_result := v_result - v_key;
      END IF;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customs_workflow_has_amount(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_raw text;
BEGIN
  v_raw := pg_catalog.translate(
    pg_catalog.regexp_replace(COALESCE(p_value, ''), '[[:space:],٬،，]', '', 'g'),
    '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
    '01234567890123456789'
  );
  IF v_raw = '' OR v_raw !~ '^[0-9]+([.][0-9]*)?$' THEN
    RETURN false;
  END IF;
  RETURN v_raw::numeric >= 0;
END;
$function$;

-- Persian leap-year calculation matching the well-known Jalaali calendar
-- break-point algorithm for the application's supported years (1200..1600).
CREATE OR REPLACE FUNCTION public.customs_workflow_jalali_leap_code(p_year integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_breaks integer[] := ARRAY[-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635];
  v_jp integer := -61;
  v_jm integer;
  v_jump integer := 0;
  v_n integer;
  v_leap_j integer := -14;
  v_gy integer;
  v_leap_g integer;
  v_march integer;
  v_leap_code integer;
BEGIN
  IF p_year < 1200 OR p_year >= 1635 THEN
    RAISE EXCEPTION 'Jalali year is outside the supported calendar range';
  END IF;

  FOREACH v_jm IN ARRAY v_breaks[2:array_length(v_breaks, 1)] LOOP
    v_jump := v_jm - v_jp;
    EXIT WHEN p_year < v_jm;
    v_leap_j := v_leap_j + (v_jump / 33) * 8 + ((pg_catalog.mod(v_jump, 33)) / 4);
    v_jp := v_jm;
  END LOOP;

  v_n := p_year - v_jp;
  v_leap_j := v_leap_j + (v_n / 33) * 8 + ((pg_catalog.mod(v_n, 33) + 3) / 4);
  IF pg_catalog.mod(v_jump, 33) = 4 AND v_jump - v_n = 4 THEN
    v_leap_j := v_leap_j + 1;
  END IF;

  v_gy := p_year + 621;
  v_leap_g := (v_gy / 4) - ((((v_gy / 100) + 1) * 3) / 4) - 150;
  v_march := 20 + v_leap_j - v_leap_g;
  IF v_jump - v_n < 6 THEN
    v_n := v_n - v_jump + ((v_jump + 4) / 33) * 33;
  END IF;

  v_leap_code := pg_catalog.mod(pg_catalog.mod(v_n + 1, 33) - 1, 4);
  IF v_leap_code = -1 THEN
    v_leap_code := 4;
  END IF;

  RETURN v_leap_code;
END;
$function$;

-- Returns a sortable key or NULL when the Persian date is invalid.
CREATE OR REPLACE FUNCTION public.customs_workflow_jalali_date_key(p_value text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_normalized text;
  v_parts text[];
  v_year integer;
  v_month integer;
  v_day integer;
  v_max_day integer;
  v_leap boolean;
BEGIN
  v_normalized := pg_catalog.translate(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.btrim(COALESCE(p_value, '')), '.', '/'),
      '-', '/'
    ),
    '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
    '01234567890123456789'
  );
  v_parts := pg_catalog.regexp_match(
    v_normalized,
    '^([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})$'
  );
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;

  v_year := v_parts[1]::integer;
  v_month := v_parts[2]::integer;
  v_day := v_parts[3]::integer;
  IF v_year < 1200 OR v_year > 1600 OR v_month < 1 OR v_month > 12 OR v_day < 1 THEN
    RETURN NULL;
  END IF;

  v_leap := public.customs_workflow_jalali_leap_code(v_year) = 0;
  v_max_day := CASE
    WHEN v_month <= 6 THEN 31
    WHEN v_month <= 11 THEN 30
    WHEN v_leap THEN 30
    ELSE 29
  END;
  IF v_day > v_max_day THEN
    RETURN NULL;
  END IF;

  RETURN v_year::bigint * 10000 + v_month::bigint * 100 + v_day::bigint;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customs_workflow_readiness_issues(
  p_customs_path text,
  p_evaluation jsonb,
  p_expertise jsonb,
  p_cashier jsonb,
  p_loading_permit jsonb,
  p_exit jsonb,
  p_port jsonb
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_issues text[] := '{}'::text[];
  v_evaluation jsonb := COALESCE(p_evaluation, '{}'::jsonb);
  v_expertise jsonb := COALESCE(p_expertise, '{}'::jsonb);
  v_standard jsonb := COALESCE(p_expertise -> 'standard', '{}'::jsonb);
  v_cashier jsonb := COALESCE(p_cashier, '{}'::jsonb);
  v_permit jsonb := COALESCE(p_loading_permit, '{}'::jsonb);
  v_exit jsonb := COALESCE(p_exit, '{}'::jsonb);
  v_port jsonb := COALESCE(p_port, '{}'::jsonb);
  v_status text;
  v_required boolean;
  v_inspection_required boolean;
  v_sample_required boolean;
  v_ninety_percent_ready boolean;
  v_central_bank_ready boolean;
  v_sata_not_required boolean;
  v_has_cash_amount boolean;
  v_has_guarantee boolean;
  v_has_guarantee_reference boolean;
  v_invoice_status text;
  v_insurance_key bigint;
  v_receipt_key bigint;
BEGIN
  IF lower(COALESCE(p_customs_path, '')) NOT IN ('green', 'yellow', 'red') THEN
    v_issues := pg_catalog.array_append(v_issues, 'مسیر گمرکی اظهارنامه مشخص نیست؛ مسیر سبز، زرد یا قرمز را تعیین کنید.');
  END IF;

  v_status := COALESCE(v_evaluation ->> 'status', '');
  v_required := lower(COALESCE(p_customs_path, '')) = 'red'
    OR COALESCE(v_evaluation ->> 'expert_requested', 'false') = 'true'
    OR v_status IN ('required', 'in_progress');
  IF v_required AND v_status <> 'completed' THEN
    v_issues := pg_catalog.array_append(v_issues, 'ارزیابی الزامی است؛ نتیجه ارزیابی را تکمیل کنید.');
  END IF;
  IF v_required AND v_status = 'completed'
     AND COALESCE(pg_catalog.btrim(v_evaluation ->> 'evaluator_number'), '') = '' THEN
    v_issues := pg_catalog.array_append(v_issues, 'شماره ارزیاب را ثبت کنید.');
  END IF;

  IF COALESCE(v_expertise ->> 'appointment_status', '') NOT IN ('scheduled', 'completed', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'نوبت کارشناسی باید دریافت یا کارشناسی تکمیل شود.');
  END IF;
  IF COALESCE(v_expertise ->> 'road_authority_status', '') NOT IN ('approved', 'not_required', 'completed') THEN
    v_issues := pg_catalog.array_append(v_issues, 'وضعیت مجوز راهداری باید تعیین تکلیف شود.');
  END IF;
  IF COALESCE(v_expertise ->> 'plant_quarantine_status', '') NOT IN ('approved', 'not_required', 'completed') THEN
    v_issues := pg_catalog.array_append(v_issues, 'وضعیت حفظ نباتات/قرنطینه باید تعیین تکلیف شود.');
  END IF;

  IF COALESCE(v_standard ->> 'expert_review', '') NOT IN ('approved', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'بررسی کارشناس استاندارد هنوز تأیید یا از شمول خارج نشده است.');
  END IF;
  IF COALESCE(v_standard ->> 'expert_review', '') <> 'not_required' THEN
    v_inspection_required := COALESCE(v_standard ->> 'inspection_status', '') <> 'not_required';
    IF v_inspection_required
       AND COALESCE(v_standard ->> 'inspection_status', '') NOT IN ('sampled', 'completed') THEN
      v_issues := pg_catalog.array_append(v_issues, 'بازدید یا نمونه‌گیری شرکت بازرسی باید تکمیل یا غیرلازم ثبت شود.');
    END IF;
    IF v_inspection_required
       AND NOT public.customs_workflow_has_amount(v_standard ->> 'inspection_fee') THEN
      v_issues := pg_catalog.array_append(v_issues, 'مبلغ هزینه بازرسی را ثبت کنید؛ در صورت رایگان بودن، صفر وارد کنید.');
    END IF;
    IF v_inspection_required AND COALESCE(v_standard ->> 'inspection_paid', 'false') <> 'true' THEN
      v_issues := pg_catalog.array_append(v_issues, 'هزینه بازرسی باید پرداخت شود.');
    END IF;
    IF v_inspection_required THEN
      v_invoice_status := COALESCE(
        NULLIF(v_standard ->> 'inspection_invoice_status', ''),
        CASE WHEN COALESCE(v_standard ->> 'inspection_invoice_received', 'false') = 'true'
          THEN 'received' ELSE 'pending' END
      );
      IF v_invoice_status NOT IN ('received', 'not_issued', 'not_required') THEN
        v_issues := pg_catalog.array_append(v_issues, 'وضعیت دریافت یا صادرنشدن فاکتور بازرسی را مشخص کنید.');
      END IF;
    END IF;

    v_sample_required := COALESCE(v_standard ->> 'sample_status', '') <> 'not_required';
    IF v_sample_required AND COALESCE(v_standard ->> 'sample_status', '') <> 'received' THEN
      v_issues := pg_catalog.array_append(v_issues, 'نتیجه آزمایش نمونه باید دریافت شود یا صریحاً غیرلازم ثبت شود.');
    END IF;
    IF v_sample_required AND COALESCE(v_standard ->> 'results_uploaded', 'false') <> 'true' THEN
      v_issues := pg_catalog.array_append(v_issues, 'نتایج آزمایش باید در سامانه استاندارد بارگذاری شود.');
    END IF;
    IF NOT public.customs_workflow_has_amount(v_standard ->> 'standard_fee') THEN
      v_issues := pg_catalog.array_append(v_issues, 'مبلغ کارمزد استاندارد را ثبت کنید؛ اگر مبلغ صفر است، صفر وارد کنید.');
    END IF;
    IF COALESCE(v_standard ->> 'standard_fee_paid', 'false') <> 'true' THEN
      v_issues := pg_catalog.array_append(v_issues, 'پرداخت کارمزد استاندارد باید ثبت شود.');
    END IF;
    IF COALESCE(v_standard ->> 'standard_notified', 'false') <> 'true' THEN
      v_issues := pg_catalog.array_append(v_issues, 'اطلاع‌رسانی پرداخت به استاندارد باید ثبت شود.');
    END IF;
  END IF;

  v_status := COALESCE(v_cashier ->> 'method', '');
  v_has_cash_amount := public.customs_workflow_has_amount(v_cashier ->> 'cash_paid_irr');
  v_has_guarantee := COALESCE(v_cashier ->> 'guarantee_duties', 'false') = 'true'
    OR COALESCE(v_cashier ->> 'guarantee_vat', 'false') = 'true';
  v_has_guarantee_reference := COALESCE(pg_catalog.btrim(v_cashier ->> 'guarantee_reference'), '') <> '';
  IF v_status = 'cash' AND NOT v_has_cash_amount THEN
    v_issues := pg_catalog.array_append(v_issues, 'مبلغ پرداخت نقدی صندوق را ثبت کنید.');
  ELSIF v_status = 'bank_guarantee' AND (NOT v_has_guarantee OR NOT v_has_guarantee_reference) THEN
    v_issues := pg_catalog.array_append(v_issues, 'نوع ضمانت‌نامه (حقوق ورودی/ارزش افزوده) و شماره مرجع آن را ثبت کنید.');
  ELSIF v_status = 'mixed' AND (NOT v_has_cash_amount OR NOT v_has_guarantee OR NOT v_has_guarantee_reference) THEN
    v_issues := pg_catalog.array_append(v_issues, 'برای تسویه ترکیبی، مبلغ نقدی، نوع ضمانت‌نامه و شماره مرجع آن را ثبت کنید.');
  ELSIF v_status NOT IN ('cash', 'bank_guarantee', 'mixed') THEN
    v_issues := pg_catalog.array_append(v_issues, 'روش تسویه صندوق را انتخاب کنید.');
  END IF;

  v_ninety_percent_ready :=
    COALESCE(v_permit ->> 'clearance_90_percent_requested', 'false') = 'true'
    AND COALESCE(pg_catalog.btrim(v_permit ->> 'sata_code'), '') = ''
    AND COALESCE(pg_catalog.btrim(v_permit ->> 'comment'), '') <> '';
  v_central_bank_ready := COALESCE(v_permit ->> 'central_bank_status', '') IN ('approved', 'not_required')
    OR v_ninety_percent_ready;
  IF COALESCE(v_permit ->> 'clause2_request_status', '') NOT IN ('approved', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'درخواست تبصره ۲ منطقه آزاد باید تأیید یا صریحاً غیرلازم ثبت شود.');
  END IF;
  IF COALESCE(v_permit ->> 'tax_permission_status', '') NOT IN ('approved', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'مجوز سازمان امور مالیاتی باید صادر یا غیرلازم ثبت شود.');
  END IF;
  IF NOT v_central_bank_ready THEN
    v_issues := pg_catalog.array_append(v_issues, 'وضعیت منشأ ارز/بانک مرکزی را تأیید کنید؛ در نبود ساتا، درخواست ترخیص ۹۰ درصدی و توضیح آن را ثبت کنید.');
  END IF;

  v_sata_not_required := COALESCE(v_permit ->> 'central_bank_status', '') = 'not_required'
    OR (
      COALESCE(v_permit ->> 'clearance_90_percent_requested', 'false') = 'true'
      AND COALESCE(pg_catalog.btrim(v_permit ->> 'comment'), '') <> ''
    );
  IF COALESCE(pg_catalog.btrim(v_permit ->> 'sata_code'), '') = '' AND NOT v_sata_not_required THEN
    v_issues := pg_catalog.array_append(v_issues, 'کد ساتا را برای خروج نهایی ثبت کنید؛ در صورت عدم نیاز به ساتا، وضعیت بانک مرکزی را «نیازی نیست» انتخاب کنید.');
  END IF;
  IF COALESCE(v_exit ->> 'loading_permission_status', '') <> 'approved' THEN
    v_issues := pg_catalog.array_append(v_issues, 'اجازه بارگیری در درب خروج هنوز صادر نشده است.');
  END IF;
  IF COALESCE(v_exit ->> 'financial_registration_status', '') <> 'registered' THEN
    v_issues := pg_catalog.array_append(v_issues, 'ثبت مالی در درب خروج تکمیل نشده است.');
  END IF;
  IF COALESCE(v_exit ->> 'weighbridge_required', 'false') = 'true'
     AND COALESCE(pg_catalog.btrim(v_exit ->> 'loading_completed_at'), '') <> ''
     AND COALESCE(v_exit ->> 'weighbridge_paid', 'false') <> 'true' THEN
    v_issues := pg_catalog.array_append(v_issues, 'دیماند باسکول پس از اتمام بارگیری باید پرداخت و ثبت شود.');
  END IF;

  v_receipt_key := public.customs_workflow_jalali_date_key(v_port ->> 'warehouse_receipt_date');
  v_insurance_key := public.customs_workflow_jalali_date_key(v_port ->> 'insurance_issue_date');
  IF v_receipt_key IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'تاریخ معتبر قبض انبار را ثبت کنید.');
  END IF;
  IF v_insurance_key IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'تاریخ معتبر بیمه‌نامه را ثبت کنید.');
  END IF;
  IF v_insurance_key IS NOT NULL AND v_receipt_key IS NOT NULL
     AND v_insurance_key >= v_receipt_key
     AND COALESCE(v_port ->> 'insurance_followup_status', '') NOT IN ('completed', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'بیمه‌نامه قبل از قبض انبار نیست؛ پیگیری بیمه/پوشش تکمیلی را تکمیل کنید.');
  END IF;
  IF COALESCE(v_port ->> 'initial_invoice_status', '') NOT IN ('received', 'paid', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'وضعیت صورتحساب اولیه باید دریافت، پرداخت یا عدم نیاز ثبت شود.');
  END IF;
  IF COALESCE(v_port ->> 'transport_power_of_attorney_status', '') NOT IN ('received', 'approved', 'not_required') THEN
    v_issues := pg_catalog.array_append(v_issues, 'وکالت حمل باید دریافت/تأیید یا عدم نیاز آن ثبت شود.');
  END IF;
  IF public.customs_workflow_jalali_date_key(v_port ->> 'loading_form_received_at') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'تاریخ دریافت فرم بارگیری را ثبت کنید.');
  END IF;
  IF public.customs_workflow_jalali_date_key(v_exit ->> 'loading_completed_at') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'تاریخ اتمام بارگیری را در مرحله درب خروج ثبت کنید.');
  END IF;
  IF COALESCE(pg_catalog.btrim(v_port ->> 'last_truck_loaded_at'), '') <> ''
     AND COALESCE(v_port ->> 'supplemental_invoice_status', '') NOT IN ('received', 'paid') THEN
    v_issues := pg_catalog.array_append(v_issues, 'با ثبت بارگیری کامیون آخر، دریافت یا پرداخت صورتحساب متمم را ثبت کنید.');
  END IF;

  RETURN v_issues;
END;
$function$;

CREATE OR REPLACE FUNCTION public.patch_customs_declaration_workflow_activity(
  p_workflow_id uuid,
  p_activity text,
  p_patch jsonb,
  p_base_state jsonb,
  p_expected_current_stage text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := COALESCE(public.user_role()::text, '');
  v_workflow public.customs_declaration_workflow%ROWTYPE;
  v_declaration_shipment_id uuid;
  v_current_state jsonb;
  v_conflicts text[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_org_id IS NULL OR v_role NOT IN ('owner', 'admin', 'broker', 'warehouse') THEN
    RAISE EXCEPTION 'User is not allowed to edit customs workflow';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'A non-empty workflow patch is required';
  END IF;

  SELECT * INTO v_workflow
  FROM public.customs_declaration_workflow
  WHERE id = p_workflow_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found or access denied';
  END IF;

  IF p_activity = 'abandoned' THEN
    IF NOT (p_patch ? 'notes') OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key) WHERE k.key <> 'notes'
    ) THEN
      RAISE EXCEPTION 'Only notes may be changed in the abandoned activity';
    END IF;
    v_current_state := pg_catalog.jsonb_build_object('notes', v_workflow.notes);
    v_conflicts := public.customs_workflow_jsonb_conflicts(v_current_state, p_base_state, p_patch);
    IF COALESCE(pg_catalog.array_length(v_conflicts, 1), 0) > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'CUSTOMS_WORKFLOW_CONFLICT',
        DETAIL = pg_catalog.array_to_string(v_conflicts, ', ');
    END IF;

    UPDATE public.customs_declaration_workflow
    SET notes = NULLIF(pg_catalog.btrim(p_patch ->> 'notes'), ''),
        current_stage = CASE
          WHEN current_stage IS NOT DISTINCT FROM p_expected_current_stage THEN p_activity
          ELSE current_stage
        END,
        updated_by = v_user_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_workflow_id AND organization_id = v_org_id
    RETURNING * INTO v_workflow;

    RETURN pg_catalog.to_jsonb(v_workflow);
  END IF;

  IF pg_catalog.jsonb_typeof(p_base_state) <> 'object' THEN
    RAISE EXCEPTION 'The original activity snapshot is required';
  END IF;

  CASE p_activity
    WHEN 'evaluation' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY['status','evaluator_number','expert_requested','expert_request_note'])
      ) THEN RAISE EXCEPTION 'Invalid evaluation patch fields'; END IF;
      v_current_state := v_workflow.evaluation_state;
    WHEN 'expertise' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY['appointment_status','appointment_number','road_authority_status','plant_quarantine_status','standard'])
      ) THEN RAISE EXCEPTION 'Invalid expertise patch fields'; END IF;
      IF p_patch ? 'standard' THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'standard') <> 'object' OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch -> 'standard') AS k(key)
          WHERE k.key <> ALL (ARRAY[
            'expert_review','inspection_status','inspection_company','inspection_fee','inspection_paid',
            'inspection_invoice_received','inspection_invoice_status','sample_status','laboratory',
            'results_uploaded','standard_fee','standard_fee_paid','standard_notified'
          ])
        ) THEN RAISE EXCEPTION 'Invalid standards patch fields'; END IF;
      END IF;
      v_current_state := v_workflow.expertise_state;
    WHEN 'cashier' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY['method','cash_paid_irr','guarantee_duties','guarantee_vat','guarantee_reference'])
      ) THEN RAISE EXCEPTION 'Invalid cashier patch fields'; END IF;
      v_current_state := v_workflow.cashier_state;
    WHEN 'loading_permit' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY[
          'clause2_request_status','tax_permission_status','central_bank_status','sata_code',
          'clearance_90_percent_requested','comment'
        ])
      ) THEN RAISE EXCEPTION 'Invalid loading permit patch fields'; END IF;
      v_current_state := v_workflow.loading_permit_state;
    WHEN 'exit' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY[
          'loading_permission_status','financial_registration_status','weighbridge_required',
          'weighbridge_demand_irr','weighbridge_paid','loading_completed_at'
        ])
      ) THEN RAISE EXCEPTION 'Invalid exit patch fields'; END IF;
      v_current_state := v_workflow.exit_state;
    WHEN 'port_charges' THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(key)
        WHERE k.key <> ALL (ARRAY[
          'insurance_policy_no','insurance_issue_date','insurance_followup_status','warehouse_receipt_date',
          'initial_invoice_status','transport_power_of_attorney_status','loading_form_received_at',
          'loading_started_at','supplemental_invoice_status','last_truck_loaded_at'
        ])
      ) THEN RAISE EXCEPTION 'Invalid port charges patch fields'; END IF;
      v_current_state := v_workflow.port_charges_state;
    ELSE
      RAISE EXCEPTION 'Unsupported customs workflow activity';
  END CASE;

  v_conflicts := public.customs_workflow_jsonb_conflicts(
    v_current_state, p_base_state, p_patch
  );
  IF COALESCE(pg_catalog.array_length(v_conflicts, 1), 0) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'CUSTOMS_WORKFLOW_CONFLICT',
      DETAIL = pg_catalog.array_to_string(v_conflicts, ', ');
  END IF;

  UPDATE public.customs_declaration_workflow
  SET evaluation_state = CASE WHEN p_activity = 'evaluation'
        THEN public.customs_workflow_jsonb_merge(evaluation_state, p_patch) ELSE evaluation_state END,
      expertise_state = CASE WHEN p_activity = 'expertise'
        THEN public.customs_workflow_jsonb_merge(expertise_state, p_patch) ELSE expertise_state END,
      cashier_state = CASE WHEN p_activity = 'cashier'
        THEN public.customs_workflow_jsonb_merge(cashier_state, p_patch) ELSE cashier_state END,
      loading_permit_state = CASE WHEN p_activity = 'loading_permit'
        THEN public.customs_workflow_jsonb_merge(loading_permit_state, p_patch) ELSE loading_permit_state END,
      exit_state = CASE WHEN p_activity = 'exit'
        THEN public.customs_workflow_jsonb_merge(exit_state, p_patch) ELSE exit_state END,
      port_charges_state = CASE WHEN p_activity = 'port_charges'
        THEN public.customs_workflow_jsonb_merge(port_charges_state, p_patch) ELSE port_charges_state END,
      current_stage = CASE
        WHEN current_stage IS NOT DISTINCT FROM p_expected_current_stage THEN p_activity
        ELSE current_stage
      END,
      updated_by = v_user_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_workflow_id AND organization_id = v_org_id
  RETURNING * INTO v_workflow;

  -- Keep the legacy shipment-level SATA field in the same transaction as the
  -- canonical workflow patch. A failed mirror write rolls the workflow patch back.
  IF p_activity = 'loading_permit' AND p_patch ? 'sata_code' THEN
    SELECT d.shipment_id INTO v_declaration_shipment_id
    FROM public.customs_declarations AS d
    WHERE d.id = v_workflow.declaration_id AND d.organization_id = v_org_id;

    IF v_declaration_shipment_id IS NOT NULL THEN
      INSERT INTO public.shipment_customs_data (
        shipment_id, organization_id, sata_code
      )
      VALUES (
        v_declaration_shipment_id, v_org_id,
        NULLIF(pg_catalog.btrim(p_patch ->> 'sata_code'), '')
      )
      ON CONFLICT (shipment_id) DO UPDATE
      SET sata_code = EXCLUDED.sata_code,
          organization_id = EXCLUDED.organization_id;
    END IF;
  END IF;

  RETURN pg_catalog.to_jsonb(v_workflow);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_customs_declaration_workflow(
  p_workflow_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := COALESCE(public.user_role()::text, '');
  v_workflow public.customs_declaration_workflow%ROWTYPE;
  v_customs_path text;
  v_issues text[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_org_id IS NULL OR v_role NOT IN ('owner', 'admin', 'broker', 'warehouse') THEN
    RAISE EXCEPTION 'User is not allowed to complete customs workflow';
  END IF;

  SELECT * INTO v_workflow
  FROM public.customs_declaration_workflow
  WHERE id = p_workflow_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found or access denied';
  END IF;

  SELECT d.customs_path INTO v_customs_path
  FROM public.customs_declarations AS d
  WHERE d.id = v_workflow.declaration_id AND d.organization_id = v_org_id;

  v_issues := public.customs_workflow_readiness_issues(
    v_customs_path, v_workflow.evaluation_state, v_workflow.expertise_state,
    v_workflow.cashier_state, v_workflow.loading_permit_state,
    v_workflow.exit_state, v_workflow.port_charges_state
  );
  IF COALESCE(pg_catalog.array_length(v_issues, 1), 0) > 0 THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'issues', v_issues);
  END IF;

  UPDATE public.customs_declaration_workflow
  SET current_stage = 'completed',
      notes = NULLIF(pg_catalog.btrim(p_notes), ''),
      updated_by = v_user_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_workflow_id AND organization_id = v_org_id
  RETURNING * INTO v_workflow;

  RETURN pg_catalog.jsonb_build_object('ready', true, 'workflow', pg_catalog.to_jsonb(v_workflow));
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_customs_declaration_exit(
  p_declaration_id uuid,
  p_sata_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := COALESCE(public.user_role()::text, '');
  v_declaration public.customs_declarations%ROWTYPE;
  v_workflow public.customs_declaration_workflow%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_sata text := NULLIF(pg_catalog.btrim(p_sata_code), '');
  v_issues text[] := '{}'::text[];
  v_missing_exit_items integer := 0;
  v_permit jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_org_id IS NULL OR v_role NOT IN ('owner', 'admin', 'broker', 'warehouse') THEN
    RAISE EXCEPTION 'User is not allowed to complete customs exit';
  END IF;

  SELECT * INTO v_declaration
  FROM public.customs_declarations
  WHERE id = p_declaration_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'اظهارنامه پیدا نشد یا دسترسی سازمانی مجاز نیست';
  END IF;
  IF v_declaration.customs_regime IS DISTINCT FROM 'import_definitive' THEN
    RAISE EXCEPTION 'این کنترل نهایی فقط برای رویه واردات قطعی فعال است';
  END IF;
  IF v_declaration.shipment_id IS NULL THEN
    RAISE EXCEPTION 'محموله مرتبط با اظهارنامه مشخص نیست';
  END IF;
  IF v_declaration.workflow_stage IS NULL OR v_declaration.workflow_stage NOT IN (4, 5, 6) THEN
    v_issues := pg_catalog.array_append(v_issues, 'اظهارنامه هنوز به مرحله قابل کنترل درب خروج منتقل نشده است.');
  END IF;

  SELECT * INTO v_workflow
  FROM public.customs_declaration_workflow
  WHERE declaration_id = p_declaration_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'گردش‌کار عملیات گمرکی اظهارنامه پیدا نشد';
  END IF;

  SELECT * INTO v_shipment
  FROM public.shipments
  WHERE id = v_declaration.shipment_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'محموله مرتبط پیدا نشد یا دسترسی به آن مجاز نیست';
  END IF;

  IF v_sata IS NOT NULL THEN
    v_workflow.loading_permit_state := public.customs_workflow_jsonb_merge(
      v_workflow.loading_permit_state,
      pg_catalog.jsonb_build_object('sata_code', v_sata)
    );
  END IF;

  v_issues := v_issues || public.customs_workflow_readiness_issues(
    v_declaration.customs_path, v_workflow.evaluation_state, v_workflow.expertise_state,
    v_workflow.cashier_state, v_workflow.loading_permit_state,
    v_workflow.exit_state, v_workflow.port_charges_state
  );

  -- The three mandatory exit checklist rows are checked again under row locks;
  -- a browser-side checkbox alone can never move the shipment to finance-ready.
  PERFORM 1
  FROM public.declaration_exit_checklist_items
  WHERE organization_id = v_org_id
    AND declaration_id = p_declaration_id
    AND item_key IN (
      'warehouse_invoice_initial',
      'warehouse_invoice_supplement',
      'transport_power_of_attorney'
    )
  ORDER BY item_key
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer INTO v_missing_exit_items
  FROM (
    VALUES
      ('warehouse_invoice_initial'),
      ('warehouse_invoice_supplement'),
      ('transport_power_of_attorney')
  ) AS required(item_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.declaration_exit_checklist_items AS item
    WHERE item.organization_id = v_org_id
      AND item.declaration_id = p_declaration_id
      AND item.item_key = required.item_key
      AND item.completed = true
  );

  IF v_missing_exit_items > 0 THEN
    v_issues := pg_catalog.array_append(v_issues, 'هر سه مورد اجباری چک‌لیست درب خروج باید تکمیل شوند.');
  END IF;

  IF COALESCE(pg_catalog.array_length(v_issues, 1), 0) > 0 THEN
    RETURN pg_catalog.jsonb_build_object('ready', false, 'issues', v_issues);
  END IF;

  -- Persist an explicitly entered SATA code only after all readiness checks pass.
  IF v_sata IS NOT NULL THEN
    UPDATE public.customs_declaration_workflow
    SET loading_permit_state = v_workflow.loading_permit_state,
        updated_by = v_user_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_workflow.id AND organization_id = v_org_id;

    INSERT INTO public.shipment_customs_data (shipment_id, organization_id, sata_code)
    VALUES (v_declaration.shipment_id, v_org_id, v_sata)
    ON CONFLICT (shipment_id) DO UPDATE
    SET sata_code = EXCLUDED.sata_code,
        organization_id = EXCLUDED.organization_id;
  END IF;

  UPDATE public.customs_declarations
  SET workflow_stage = 6,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_declaration_id AND organization_id = v_org_id;

  UPDATE public.shipments
  SET finance_status = 'ready',
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_declaration.shipment_id
    AND organization_id = v_org_id
  RETURNING * INTO v_shipment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تغییر وضعیت محموله به آماده مالی انجام نشد؛ تراکنش خروج لغو شد';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ready', true,
    'declaration_id', p_declaration_id,
    'shipment_id', v_declaration.shipment_id,
    'workflow_stage', 6,
    'finance_status', v_shipment.finance_status
  );
END;
$function$;

-- Roll back only fields changed by the selected event, preserving later parallel edits.
CREATE OR REPLACE FUNCTION public.rollback_customs_declaration_workflow(p_workflow_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := COALESCE(public.user_role()::text, '');
  v_workflow public.customs_declaration_workflow%ROWTYPE;
  v_event public.customs_declaration_workflow_events%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_org_id IS NULL OR v_role NOT IN ('owner', 'admin', 'broker', 'warehouse') THEN
    RAISE EXCEPTION 'مجوز بازگردانی گردش‌کار را ندارید';
  END IF;

  SELECT * INTO v_workflow
  FROM public.customs_declaration_workflow
  WHERE id = p_workflow_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'گردش‌کار پیدا نشد یا به سازمان شما تعلق ندارد';
  END IF;

  SELECT * INTO v_event
  FROM public.customs_declaration_workflow_events
  WHERE workflow_id = p_workflow_id AND organization_id = v_org_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_event.id IS NULL
     OR v_event.event_type IN ('created', 'rollback')
     OR v_event.previous_snapshot IS NULL
     OR v_event.snapshot IS NULL THEN
    RAISE EXCEPTION 'بازگردانی در دسترس نیست؛ هیچ تغییر ذخیره‌شده‌ای برای بازگردانی وجود ندارد';
  END IF;

  PERFORM pg_catalog.set_config('app.customs_workflow_rollback', 'true', true);

  UPDATE public.customs_declaration_workflow
  SET current_stage = CASE
        WHEN 'current_stage' = ANY(v_event.changed_fields)
         AND current_stage IS NOT DISTINCT FROM v_event.current_stage
          THEN COALESCE(v_event.previous_stage, current_stage)
        ELSE current_stage
      END,
      evaluation_state = CASE
        WHEN 'evaluation_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.evaluation_state,
            v_event.previous_snapshot -> 'evaluation_state',
            v_event.snapshot -> 'evaluation_state'
          )
        ELSE evaluation_state
      END,
      expertise_state = CASE
        WHEN 'expertise_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.expertise_state,
            v_event.previous_snapshot -> 'expertise_state',
            v_event.snapshot -> 'expertise_state'
          )
        ELSE expertise_state
      END,
      cashier_state = CASE
        WHEN 'cashier_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.cashier_state,
            v_event.previous_snapshot -> 'cashier_state',
            v_event.snapshot -> 'cashier_state'
          )
        ELSE cashier_state
      END,
      loading_permit_state = CASE
        WHEN 'loading_permit_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.loading_permit_state,
            v_event.previous_snapshot -> 'loading_permit_state',
            v_event.snapshot -> 'loading_permit_state'
          )
        ELSE loading_permit_state
      END,
      exit_state = CASE
        WHEN 'exit_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.exit_state,
            v_event.previous_snapshot -> 'exit_state',
            v_event.snapshot -> 'exit_state'
          )
        ELSE exit_state
      END,
      port_charges_state = CASE
        WHEN 'port_charges_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.port_charges_state,
            v_event.previous_snapshot -> 'port_charges_state',
            v_event.snapshot -> 'port_charges_state'
          )
        ELSE port_charges_state
      END,
      procedure_state = CASE
        WHEN 'procedure_state' = ANY(v_event.changed_fields)
          THEN public.customs_workflow_jsonb_undo(
            v_workflow.procedure_state,
            v_event.previous_snapshot -> 'procedure_state',
            v_event.snapshot -> 'procedure_state'
          )
        ELSE procedure_state
      END,
      notes = CASE
        WHEN 'notes' = ANY(v_event.changed_fields)
         AND COALESCE(pg_catalog.to_jsonb(v_workflow.notes), 'null'::jsonb)
             IS NOT DISTINCT FROM (v_event.snapshot -> 'notes')
          THEN v_event.previous_snapshot ->> 'notes'
        ELSE notes
      END,
      updated_by = v_user_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_workflow_id AND organization_id = v_org_id;

  PERFORM pg_catalog.set_config('app.customs_workflow_rollback', 'false', true);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.customs_workflow_rollback', 'false', true);
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.customs_workflow_jsonb_merge(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_jsonb_conflicts(jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_has_amount(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_jalali_leap_code(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_jalali_date_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_readiness_issues(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customs_workflow_jsonb_undo(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patch_customs_declaration_workflow_activity(uuid, text, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_customs_declaration_workflow(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_customs_declaration_exit(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollback_customs_declaration_workflow(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.customs_workflow_jsonb_merge(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_jsonb_conflicts(jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_jsonb_undo(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_has_amount(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_jalali_leap_code(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_jalali_date_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_workflow_readiness_issues(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_customs_declaration_workflow_activity(uuid, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_customs_declaration_workflow(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_customs_declaration_exit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_customs_declaration_workflow(uuid) TO authenticated;

COMMENT ON FUNCTION public.patch_customs_declaration_workflow_activity(uuid, text, jsonb, jsonb, text)
IS 'Applies a whitelist-validated nested JSONB patch with leaf-level stale-edit detection under a row lock; invoker RLS remains active.';
COMMENT ON FUNCTION public.complete_customs_declaration_exit(uuid, text)
IS 'Atomically validates definitive-import workflow readiness and exit checklist items before setting declaration stage and shipment finance status to ready.';
COMMENT ON FUNCTION public.rollback_customs_declaration_workflow(uuid)
IS 'Restores only the latest event changed leaves when they have not since been changed again, preserving unrelated parallel work.';
