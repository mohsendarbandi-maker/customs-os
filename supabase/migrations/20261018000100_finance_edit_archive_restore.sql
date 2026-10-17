-- Finance amendment, reversible archive, and restore.
-- Historical/issued accounting rows are preserved; this is not a hard-delete migration.

ALTER TABLE public.finance_cost_items
  ADD COLUMN IF NOT EXISTS deleted_previous_status text,
  ADD COLUMN IF NOT EXISTS deleted_previous_approval_status text,
  ADD COLUMN IF NOT EXISTS deleted_previous_workflow_status text;

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS deleted_previous_status text;

CREATE INDEX IF NOT EXISTS finance_cost_items_deleted_org_idx
  ON public.finance_cost_items (organization_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_invoices_deleted_org_idx
  ON public.finance_invoices (organization_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- Recycle metadata can only be written by the guarded RPCs below.
CREATE OR REPLACE FUNCTION public.guard_finance_recycle_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_change boolean := false;
BEGIN
  IF current_setting('app.finance_recycle_write', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_each(to_jsonb(NEW)) AS item(key, value)
      WHERE (item.key = 'deleted_at' OR left(item.key, 8) = 'deleted_')
        AND item.value <> 'null'::jsonb
    ) INTO v_has_change;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_each(to_jsonb(NEW)) AS item(key, value)
      WHERE (item.key = 'deleted_at' OR left(item.key, 8) = 'deleted_')
        AND (to_jsonb(OLD) -> item.key) IS DISTINCT FROM item.value
    ) INTO v_has_change;
  END IF;

  IF v_has_change THEN
    RAISE EXCEPTION 'Recycle metadata can only be changed through the finance archive/restore actions';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finance_recycle_metadata_costs
  ON public.finance_cost_items;
CREATE TRIGGER trg_guard_finance_recycle_metadata_costs
  BEFORE INSERT OR UPDATE ON public.finance_cost_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_finance_recycle_metadata();

DROP TRIGGER IF EXISTS trg_guard_finance_recycle_metadata_invoices
  ON public.finance_invoices;
CREATE TRIGGER trg_guard_finance_recycle_metadata_invoices
  BEFORE INSERT OR UPDATE ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_finance_recycle_metadata();

REVOKE ALL ON FUNCTION public.guard_finance_recycle_metadata() FROM PUBLIC, anon, authenticated;

-- Keep archived expenses visible only to their creator and finance administrators,
-- without weakening the existing active-expense visibility policy.
DROP POLICY IF EXISTS finance_cost_items_recycle_select ON public.finance_cost_items;
CREATE POLICY finance_cost_items_recycle_select
  ON public.finance_cost_items FOR SELECT TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND deleted_at IS NOT NULL
    AND (
      public.user_role() IN ('owner'::public.user_role, 'admin'::public.user_role)
      OR created_by = auth.uid()
    )
  );

-- A draft invoice can be edited, but its child rows become immutable after issue/void/archive.
CREATE OR REPLACE FUNCTION public.guard_finance_invoice_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id uuid;
  v_org_id uuid;
  v_status text;
  v_deleted_at timestamptz;
  v_issued_at timestamptz;
  v_role text := COALESCE(public.user_role()::text, '');
BEGIN
  IF v_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'دسترسی تغییر ردیف صورتحساب نیازمند نقش مالی است';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
    v_org_id := OLD.organization_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
    v_org_id := NEW.organization_id;
    IF TG_OP = 'UPDATE'
       AND (NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
      RAISE EXCEPTION 'انتقال ردیف صورتحساب به سند یا سازمان دیگر مجاز نیست';
    END IF;
  END IF;

  IF v_org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'صورتحساب به سازمان جاری تعلق ندارد';
  END IF;

  SELECT i.status, i.deleted_at, i.issued_at
    INTO v_status, v_deleted_at, v_issued_at
  FROM public.finance_invoices i
  WHERE i.id = v_invoice_id AND i.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'صورتحساب مرتبط پیدا نشد';
  END IF;
  IF v_status <> 'draft' OR v_deleted_at IS NOT NULL OR v_issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'ردیف‌های صورتحساب صادرشده، بایگانی‌شده یا غیرپیش‌نویس قابل تغییر مستقیم نیستند';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finance_invoice_lines
  ON public.finance_invoice_lines;
CREATE TRIGGER trg_guard_finance_invoice_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_finance_invoice_child_mutation();

DROP TRIGGER IF EXISTS trg_guard_finance_invoice_shipments
  ON public.finance_invoice_shipments;
CREATE TRIGGER trg_guard_finance_invoice_shipments
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_invoice_shipments
  FOR EACH ROW EXECUTE FUNCTION public.guard_finance_invoice_child_mutation();

REVOKE ALL ON FUNCTION public.guard_finance_invoice_child_mutation() FROM PUBLIC, anon, authenticated;

-- Never physically delete an invoice through the client Data API.
DROP POLICY IF EXISTS finance_invoices_delete ON public.finance_invoices;
CREATE POLICY finance_invoices_delete
  ON public.finance_invoices FOR DELETE TO authenticated
  USING (false);

CREATE OR REPLACE FUNCTION public.update_finance_expense(
  p_cost_id uuid,
  p_category_id uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_exchange_rate numeric,
  p_paid_by text,
  p_notes text DEFAULT NULL
)
RETURNS public.finance_cost_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_cost_items;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
  v_category_name text;
  v_vat_rate numeric := 0;
  v_receipt_threshold numeric := 0;
  v_amount_irr numeric;
  v_vat_amount numeric;
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'accountant')
     AND NOT EXISTS (
       SELECT 1 FROM public.finance_cost_items e
       WHERE e.id = p_cost_id
         AND e.organization_id = v_org
         AND e.created_by = v_user
     ) THEN
    RAISE EXCEPTION 'ویرایش این هزینه مجاز نیست';
  END IF;

  SELECT * INTO v
  FROM public.finance_cost_items
  WHERE id = p_cost_id AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'هزینه پیدا نشد یا در بایگانی است';
  END IF;
  IF v.workflow_status NOT IN ('DRAFT', 'SUBMITTED', 'REJECTED')
     OR v.approval_status NOT IN ('pending', 'rejected')
     OR v.status IN ('invoiced', 'paid') THEN
    RAISE EXCEPTION 'هزینه تأییدشده یا متصل به صورتحساب قابل ویرایش مستقیم نیست';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_invoice_lines l
    JOIN public.finance_invoices i
      ON i.id = l.invoice_id AND i.organization_id = l.organization_id
    WHERE l.cost_item_id = p_cost_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('void', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'ابتدا صورتحساب پیش‌نویس متصل را بایگانی کنید';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ باید بیشتر از صفر باشد';
  END IF;
  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'نرخ تبدیل باید بیشتر از صفر باشد';
  END IF;
  IF p_currency NOT IN ('IRR','USD','EUR','AED','CNY','RUB','GBP','CHF','TRY') THEN
    RAISE EXCEPTION 'ارز انتخاب‌شده معتبر نیست';
  END IF;
  IF p_paid_by NOT IN ('our_company','client_direct') THEN
    RAISE EXCEPTION 'منبع پرداخت معتبر نیست';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_description, '')), '') IS NULL THEN
    RAISE EXCEPTION 'شرح هزینه الزامی است';
  END IF;

  SELECT c.name_fa INTO v_category_name
  FROM public.finance_cost_categories c
  WHERE c.id = p_category_id
    AND c.organization_id = v_org
    AND c.is_active = true;

  IF v_category_name IS NULL THEN
    RAISE EXCEPTION 'دسته هزینه معتبر یا فعال نیست';
  END IF;

  SELECT COALESCE(s.default_vat_rate, 0), COALESCE(s.receipt_mandatory_threshold_irr, 0)
    INTO v_vat_rate, v_receipt_threshold
  FROM public.finance_org_settings s
  WHERE s.organization_id = v_org;

  v_vat_rate := COALESCE(v_vat_rate, 0);
  v_receipt_threshold := COALESCE(v_receipt_threshold, 0);
  v_amount_irr := ROUND(p_amount * p_exchange_rate, 2);
  v_vat_amount := ROUND(v_amount_irr * v_vat_rate / 100, 2);

  IF v_amount_irr > v_receipt_threshold
     AND v.receipt_file_url IS NULL
     AND COALESCE(jsonb_array_length(v.receipt_files), 0) = 0 THEN
    RAISE EXCEPTION 'برای این مبلغ، فیش پرداختی الزامی است';
  END IF;

  UPDATE public.finance_cost_items
  SET category_id = p_category_id,
      cost_category = v_category_name,
      description = BTRIM(p_description),
      amount = p_amount,
      unit_price = p_amount / GREATEST(COALESCE(v.quantity, 1), 1),
      currency = p_currency::public.currency_code,
      exchange_rate = p_exchange_rate,
      amount_irr = v_amount_irr,
      vat_rate = v_vat_rate,
      vat_amount = v_vat_amount,
      paid_by = p_paid_by,
      billable = (p_paid_by = 'our_company'),
      notes = NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
      status = 'draft',
      approval_status = 'pending',
      approved_by = NULL,
      approved_at = NULL,
      rejection_reason = NULL,
      workflow_status = 'SUBMITTED',
      submitted_by = v_user,
      submitted_at = now(),
      updated_by = v_user,
      updated_at = now()
  WHERE id = p_cost_id AND organization_id = v_org
  RETURNING * INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.update_finance_expense(uuid, uuid, text, numeric, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_finance_expense(uuid, uuid, text, numeric, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_finance_shipment_cost(
  p_cost_id uuid,
  p_reason text
)
RETURNS public.finance_cost_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_cost_items;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'علت بایگانی الزامی است';
  END IF;

  SELECT * INTO v
  FROM public.finance_cost_items
  WHERE id = p_cost_id AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'هزینه پیدا نشد یا قبلاً بایگانی شده است';
  END IF;
  IF v_role NOT IN ('owner', 'admin') AND v.created_by IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'بایگانی این هزینه مجاز نیست';
  END IF;
  IF v.approval_status = 'approved'
     OR v.workflow_status = 'APPROVED'
     OR v.status IN ('invoiced', 'paid') THEN
    RAISE EXCEPTION 'هزینه تأییدشده یا صورتحساب‌شده را نمی‌توان حذف کرد؛ ابتدا گردش اصلاحی مالی را انجام دهید';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_invoice_lines l
    JOIN public.finance_invoices i
      ON i.id = l.invoice_id AND i.organization_id = l.organization_id
    WHERE l.cost_item_id = p_cost_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('void', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'ابتدا صورتحساب متصل را بایگانی کنید';
  END IF;

  PERFORM set_config('app.finance_recycle_write', 'true', true);
  UPDATE public.finance_cost_items
  SET deleted_previous_status = status,
      deleted_previous_approval_status = approval_status,
      deleted_previous_workflow_status = workflow_status,
      deleted_at = now(),
      deleted_by = v_user,
      deleted_reason = BTRIM(p_reason),
      updated_by = v_user,
      updated_at = now(),
      status = 'cancelled'
  WHERE id = p_cost_id AND organization_id = v_org
  RETURNING * INTO v;
  PERFORM set_config('app.finance_recycle_write', 'false', true);

  RETURN v;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.finance_recycle_write', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_finance_shipment_cost(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_finance_shipment_cost(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_finance_shipment_cost(p_cost_id uuid)
RETURNS public.finance_cost_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_cost_items;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v
  FROM public.finance_cost_items
  WHERE id = p_cost_id AND organization_id = v_org AND deleted_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'هزینه بایگانی‌شده پیدا نشد';
  END IF;
  IF v_role NOT IN ('owner', 'admin') AND v.created_by IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'بازیابی این هزینه مجاز نیست';
  END IF;
  IF v.deleted_previous_approval_status = 'approved'
     OR v.deleted_previous_workflow_status = 'APPROVED'
     OR (v.deleted_previous_approval_status IS NULL AND v.approval_status = 'approved')
     OR (v.deleted_previous_workflow_status IS NULL AND v.workflow_status = 'APPROVED') THEN
    RAISE EXCEPTION 'هزینه تأییدشده باید از مسیر اصلاح مالی بازیابی شود';
  END IF;

  PERFORM set_config('app.finance_recycle_write', 'true', true);
  UPDATE public.finance_cost_items
  SET status = COALESCE(deleted_previous_status,
                        CASE WHEN workflow_status = 'REJECTED' OR approval_status = 'rejected'
                             THEN status ELSE 'draft' END),
      approval_status = COALESCE(deleted_previous_approval_status, approval_status),
      workflow_status = COALESCE(deleted_previous_workflow_status, workflow_status),
      deleted_at = NULL,
      deleted_by = NULL,
      deleted_reason = NULL,
      deleted_previous_status = NULL,
      deleted_previous_approval_status = NULL,
      deleted_previous_workflow_status = NULL,
      updated_by = v_user,
      updated_at = now()
  WHERE id = p_cost_id AND organization_id = v_org
  RETURNING * INTO v;
  PERFORM set_config('app.finance_recycle_write', 'false', true);
  RETURN v;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.finance_recycle_write', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_finance_shipment_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_finance_shipment_cost(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_finance_draft_invoice(
  p_invoice_id uuid,
  p_due_date date,
  p_discount_amount numeric,
  p_payment_terms text DEFAULT NULL,
  p_public_note text DEFAULT NULL,
  p_internal_note text DEFAULT NULL
)
RETURNS public.finance_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_invoices;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
  v_discount numeric := COALESCE(p_discount_amount, 0);
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'ویرایش صورتحساب نیازمند دسترسی مالی است';
  END IF;

  SELECT * INTO v FROM public.finance_invoices
  WHERE id = p_invoice_id AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR v.deleted_at IS NOT NULL OR v.status <> 'draft' OR v.issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'فقط پیش‌نویس صورتحساب صادرنشده قابل ویرایش است';
  END IF;
  IF v_discount < 0 OR v_discount > v.subtotal THEN
    RAISE EXCEPTION 'تخفیف باید بین صفر و مبلغ پایه صورتحساب باشد';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_payment_requests r
    WHERE r.invoice_id = p_invoice_id
      AND r.organization_id = v_org
      AND r.status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'صورتحساب دارای درخواست وجه فعال است و فعلاً قابل ویرایش نیست';
  END IF;

  UPDATE public.finance_invoices
  SET due_date = p_due_date,
      discount_amount = v_discount,
      total_amount = v.subtotal - v_discount + v.vat_amount,
      payment_terms = NULLIF(BTRIM(COALESCE(p_payment_terms, '')), ''),
      public_note = NULLIF(BTRIM(COALESCE(p_public_note, '')), ''),
      internal_note = NULLIF(BTRIM(COALESCE(p_internal_note, '')), ''),
      updated_by = v_user,
      updated_at = now()
  WHERE id = p_invoice_id AND organization_id = v_org
  RETURNING * INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.update_finance_draft_invoice(uuid, date, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_finance_draft_invoice(uuid, date, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_finance_invoice(
  p_invoice_id uuid,
  p_reason text
)
RETURNS public.finance_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_invoices;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'بایگانی صورتحساب نیازمند دسترسی مالی است';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'علت بایگانی الزامی است';
  END IF;

  SELECT * INTO v FROM public.finance_invoices
  WHERE id = p_invoice_id AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'صورتحساب پیدا نشد یا قبلاً بایگانی شده است';
  END IF;
  IF v.status <> 'draft' OR v.issued_at IS NOT NULL OR v.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'فقط پیش‌نویس صادرنشده قابل بایگانی است';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_payment_requests r
    WHERE r.invoice_id = p_invoice_id
      AND r.organization_id = v_org
      AND r.status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'صورتحساب دارای درخواست وجه فعال است؛ ابتدا آن را تعیین تکلیف کنید';
  END IF;

  PERFORM set_config('app.finance_recycle_write', 'true', true);
  UPDATE public.finance_invoices
  SET deleted_at = now(),
      deleted_by = v_user,
      deleted_reason = BTRIM(p_reason),
      deleted_previous_status = status,
      updated_by = v_user,
      updated_at = now()
  WHERE id = p_invoice_id AND organization_id = v_org
  RETURNING * INTO v;
  PERFORM set_config('app.finance_recycle_write', 'false', true);

  -- Unreserve source approved costs while this invoice draft is archived.
  UPDATE public.finance_cost_items c
  SET status = 'confirmed', updated_by = v_user, updated_at = now()
  WHERE c.organization_id = v_org
    AND c.deleted_at IS NULL
    AND c.status = 'invoiced'
    AND EXISTS (
      SELECT 1 FROM public.finance_invoice_lines l
      WHERE l.invoice_id = p_invoice_id
        AND l.organization_id = v_org
        AND l.cost_item_id = c.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.finance_invoice_lines l2
      JOIN public.finance_invoices i2
        ON i2.id = l2.invoice_id AND i2.organization_id = l2.organization_id
      WHERE l2.cost_item_id = c.id
        AND l2.organization_id = v_org
        AND l2.invoice_id <> p_invoice_id
        AND i2.deleted_at IS NULL
        AND i2.status NOT IN ('void', 'cancelled')
    );

  RETURN v;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.finance_recycle_write', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_finance_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_finance_invoice(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_finance_invoice(p_invoice_id uuid)
RETURNS public.finance_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.finance_invoices;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_role text := COALESCE(public.user_role()::text, '');
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'بازیابی صورتحساب نیازمند دسترسی مالی است';
  END IF;

  SELECT * INTO v FROM public.finance_invoices
  WHERE id = p_invoice_id AND organization_id = v_org AND deleted_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'صورتحساب بایگانی‌شده پیدا نشد';
  END IF;
  IF COALESCE(v.deleted_previous_status, v.status) <> 'draft'
     OR v.issued_at IS NOT NULL OR v.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'این سند قابل بازیابی به‌عنوان پیش‌نویس نیست';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_payment_requests r
    WHERE r.invoice_id = p_invoice_id
      AND r.organization_id = v_org
      AND r.status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'صورتحساب دارای درخواست وجه فعال است؛ بازیابی متوقف شد';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_invoice_lines l
    JOIN public.finance_invoice_lines l2
      ON l2.cost_item_id = l.cost_item_id
     AND l2.organization_id = l.organization_id
     AND l2.invoice_id <> l.invoice_id
    JOIN public.finance_invoices i2
      ON i2.id = l2.invoice_id AND i2.organization_id = l2.organization_id
    WHERE l.invoice_id = p_invoice_id
      AND l.organization_id = v_org
      AND l.cost_item_id IS NOT NULL
      AND i2.deleted_at IS NULL
      AND i2.status NOT IN ('void', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'هزینه‌ای از این صورتحساب به صورتحساب فعال دیگری متصل شده است؛ برای جلوگیری از مطالبهٔ تکراری بازیابی نشد';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_invoice_lines l
    LEFT JOIN public.finance_cost_items c
      ON c.id = l.cost_item_id AND c.organization_id = l.organization_id
    WHERE l.invoice_id = p_invoice_id
      AND l.organization_id = v_org
      AND l.cost_item_id IS NOT NULL
      AND (c.id IS NULL OR c.deleted_at IS NOT NULL OR c.approval_status <> 'approved')
  ) THEN
    RAISE EXCEPTION 'هزینهٔ منبع صورتحساب دیگر فعال/تأییدشده نیست؛ ابتدا وضعیت هزینه را بررسی کنید';
  END IF;

  PERFORM set_config('app.finance_recycle_write', 'true', true);
  UPDATE public.finance_invoices
  SET deleted_at = NULL,
      deleted_by = NULL,
      deleted_reason = NULL,
      status = COALESCE(deleted_previous_status, 'draft'),
      deleted_previous_status = NULL,
      updated_by = v_user,
      updated_at = now()
  WHERE id = p_invoice_id AND organization_id = v_org
  RETURNING * INTO v;
  PERFORM set_config('app.finance_recycle_write', 'false', true);

  UPDATE public.finance_cost_items c
  SET status = 'invoiced', updated_by = v_user, updated_at = now()
  WHERE c.organization_id = v_org
    AND c.deleted_at IS NULL
    AND c.approval_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.finance_invoice_lines l
      WHERE l.invoice_id = p_invoice_id
        AND l.organization_id = v_org
        AND l.cost_item_id = c.id
    );

  RETURN v;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.finance_recycle_write', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_finance_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_finance_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.update_finance_expense(uuid, uuid, text, numeric, text, numeric, text, text)
  IS 'Allows edits only to unapproved, unbilled finance expense entries and resubmits them for approval.';
COMMENT ON FUNCTION public.archive_finance_shipment_cost(uuid, text)
  IS 'Soft-archives an unapproved unbilled finance expense; retains a snapshot of restorable workflow status.';
COMMENT ON FUNCTION public.restore_finance_shipment_cost(uuid)
  IS 'Restores a soft-archived unapproved unbilled finance expense within the same organization.';
COMMENT ON FUNCTION public.update_finance_draft_invoice(uuid, date, numeric, text, text, text)
  IS 'Edits metadata and discount only on an unissued draft invoice; recalculates total server-side.';
COMMENT ON FUNCTION public.archive_finance_invoice(uuid, text)
  IS 'Soft-archives only an unissued draft invoice, retaining lines and unreserving its linked costs.';
COMMENT ON FUNCTION public.restore_finance_invoice(uuid)
  IS 'Restores an archived draft invoice only when it will not duplicate an active invoice or claim.';
