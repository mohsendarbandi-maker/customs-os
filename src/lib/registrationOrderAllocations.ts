export type ExternalRegistrationOrderAllocationForm = {
  recipient_company: string;
  destination_customs: string;
  allocation_reference: string;
  net_weight_kg: string;
  gross_weight_kg: string;
  value_amount: string;
  currency: string;
  status: string;
  notes: string;
};

export type ExternalRegistrationOrderAllocationPayload = {
  recipient_company: string | null;
  destination_customs: string | null;
  allocation_reference: string | null;
  net_weight_kg: number;
  gross_weight_kg: number | null;
  value_amount: number;
  currency: string;
  status: "allocated" | "dispatched" | "completed" | "cancelled";
  notes: string | null;
};

export type RegistrationOrderCapacity = {
  registered: number | null;
  internal: number;
  external: number;
  allocated: number;
  remaining: number | null;
  exceeded: boolean;
};

const latinDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

export const parseAllocationNumber = (value: string): number | null => {
  const normalized = latinDigits(String(value ?? "")).replace(/[٬,\s]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const calculateRegistrationOrderCapacity = (
  registered: number | null | undefined,
  internal: number | null | undefined,
  external: number | null | undefined,
): RegistrationOrderCapacity => {
  const registeredValue = registered == null ? null : Number(registered);
  const internalValue = Number(internal ?? 0);
  const externalValue = Number(external ?? 0);
  const allocated = internalValue + externalValue;
  const remaining = registeredValue == null ? null : registeredValue - allocated;
  return {
    registered: registeredValue,
    internal: internalValue,
    external: externalValue,
    allocated,
    remaining,
    exceeded: remaining != null && remaining < -0.000001,
  };
};

export const buildExternalRegistrationOrderAllocationPayload = (
  form: ExternalRegistrationOrderAllocationForm,
  orderCurrency: string | null | undefined,
):
  | { ok: true; payload: ExternalRegistrationOrderAllocationPayload }
  | { ok: false; error: string } => {
  const recipientCompany = form.recipient_company.trim();
  const destinationCustoms = form.destination_customs.trim();
  if (!recipientCompany && !destinationCustoms) {
    return { ok: false, error: "نام شرکت دریافت‌کننده یا گمرک مقصد را وارد کنید." };
  }

  const netWeight = parseAllocationNumber(form.net_weight_kg);
  if (netWeight == null || netWeight <= 0) {
    return { ok: false, error: "وزن خالص سهم واگذارشده باید بیشتر از صفر باشد." };
  }

  const grossWeight = parseAllocationNumber(form.gross_weight_kg);
  if (form.gross_weight_kg.trim() && (grossWeight == null || grossWeight < netWeight)) {
    return { ok: false, error: "وزن ناخالص نمی‌تواند از وزن خالص کمتر باشد." };
  }

  const valueAmount = parseAllocationNumber(form.value_amount);
  if (valueAmount == null || valueAmount < 0) {
    return { ok: false, error: "ارزش سهم واگذارشده را وارد کنید." };
  }

  if (!orderCurrency) {
    return { ok: false, error: "ابتدا ارز ثبت سفارش مادر را مشخص کنید." };
  }
  if (form.currency !== orderCurrency) {
    return { ok: false, error: "ارز سهم واگذارشده باید با ارز ثبت سفارش مادر یکسان باشد." };
  }

  const allowedStatuses = ["allocated", "dispatched", "completed", "cancelled"] as const;
  const status = allowedStatuses.find((value) => value === form.status);
  if (!status) return { ok: false, error: "وضعیت سهم واگذارشده معتبر نیست." };

  return {
    ok: true,
    payload: {
      recipient_company: recipientCompany || null,
      destination_customs: destinationCustoms || null,
      allocation_reference: form.allocation_reference.trim() || null,
      net_weight_kg: netWeight,
      gross_weight_kg: grossWeight,
      value_amount: valueAmount,
      currency: form.currency,
      status,
      notes: form.notes.trim() || null,
    },
  };
};
