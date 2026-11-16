export type CustomsChecklistWorkflow = {
  evaluation_state?: unknown;
  expertise_state?: unknown;
  cashier_state?: unknown;
  loading_permit_state?: unknown;
};

export type CustomsChecklistCandidate = {
  item_key?: string | null;
  item_label?: string | null;
  source?: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const text = (value: unknown) => String(value ?? "").trim();
const oneOf = (value: unknown, values: string[]) => values.includes(text(value));
const hasAmount = (value: unknown) => {
  const raw = text(value).replace(/[\s,٬，]/g, "");
  if (!raw) return false;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0;
};

const normalizedKey = (item: CustomsChecklistCandidate) =>
  text(item.item_key || item.item_label).replace(/\s+/g, " ").trim();

/**
 * Returns an authoritative completion value for a legacy/system checklist item
 * when its source status now belongs to Customs OS operational workflow state.
 *
 * null means that the checklist item is not a known workflow mirror and its
 * existing checklist record remains authoritative (e.g. manually-added items).
 */
export function deriveCustomsChecklistCompletion(
  item: CustomsChecklistCandidate,
  workflow: CustomsChecklistWorkflow | null | undefined,
  customsPath: string | null | undefined,
): boolean | null {
  if (!workflow || item.source === "manual") return null;

  const key = normalizedKey(item);
  const evaluation = asRecord(workflow.evaluation_state);
  const expertise = asRecord(workflow.expertise_state);
  const standard = asRecord(expertise.standard);
  const cashier = asRecord(workflow.cashier_state);
  const permit = asRecord(workflow.loading_permit_state);

  switch (key) {
    case "ارزیابی": {
      const requested = evaluation.expert_requested === true || evaluation.expert_requested === "true";
      const status = text(evaluation.status);
      if (status === "completed") return true;
      if (status === "not_required" && text(customsPath).toLowerCase() === "green" && !requested) return true;
      return false;
    }
    case "نوبت کارشناسی":
      return oneOf(expertise.appointment_status, ["scheduled", "completed", "not_required"]);
    case "مجوز استاندارد":
      return oneOf(standard.expert_review, ["approved", "not_required"]);
    case "آزمایشگاه": {
      const sampleStatus = text(standard.sample_status);
      if (sampleStatus === "not_required") return true;
      return sampleStatus === "received" &&
        (standard.results_uploaded === true || standard.results_uploaded === "true");
    }
    case "مالیات علی الحساب":
      return oneOf(permit.tax_permission_status, ["approved", "not_required"]);
    case "تبصره دو منطقه آزاد":
      return oneOf(permit.clause2_request_status, ["approved", "not_required"]);
    case "کد ساتا": {
      if (text(permit.sata_code)) return true;
      if (oneOf(permit.central_bank_status, ["not_required"])) return true;
      return (permit.clearance_90_percent_requested === true || permit.clearance_90_percent_requested === "true") &&
        text(permit.comment) !== "";
    }
    case "درخواست ضمانتنامه حقوق ورودی و ارزش افزوده": {
      const method = text(cashier.method);
      const cashValid = hasAmount(cashier.cash_paid_irr);
      const hasGuarantee = cashier.guarantee_duties === true || cashier.guarantee_duties === "true" ||
        cashier.guarantee_vat === true || cashier.guarantee_vat === "true";
      const guaranteeReference = text(cashier.guarantee_reference) !== "";
      if (method === "cash") return cashValid;
      if (method === "bank_guarantee") return hasGuarantee && guaranteeReference;
      if (method === "mixed") return cashValid && hasGuarantee && guaranteeReference;
      return false;
    }
    default:
      return null;
  }
}

export function isWorkflowManagedChecklistItem(item: CustomsChecklistCandidate): boolean {
  return [
    "ارزیابی",
    "نوبت کارشناسی",
    "مجوز استاندارد",
    "آزمایشگاه",
    "مالیات علی الحساب",
    "تبصره دو منطقه آزاد",
    "کد ساتا",
    "درخواست ضمانتنامه حقوق ورودی و ارزش افزوده",
  ].includes(normalizedKey(item));
}
