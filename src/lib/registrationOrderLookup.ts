export type RegistrationOrderHistoryRow = {
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_branch_code?: string | null;
  lc_number?: string | null;
  updated_at?: string | null;
};

export type LegacyRegistrationBankDetails = {
  bank_name: string | null;
  bank_branch: string | null;
  bank_branch_code: string | null;
  payment_instrument_code: string | null;
  source_count: number;
  conflicts: string[];
};

const englishDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

const toDigitAlphabet = (value: string, alphabet: string) =>
  value.replace(/\d/g, (digit) => alphabet[Number(digit)]);

export const normalizeRegistrationOrderNumber = (value: unknown): string =>
  englishDigits(String(value ?? ""))
    .trim()
    .replace(/[\s\u200c\u200f\u200e]/g, "")
    .replace(/[‐‑‒–—-]/g, "")
    .toUpperCase();

export const registrationOrderNumberVariants = (value: unknown): string[] => {
  const normalized = normalizeRegistrationOrderNumber(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    toDigitAlphabet(normalized, "۰۱۲۳۴۵۶۷۸۹"),
    toDigitAlphabet(normalized, "٠١٢٣٤٥٦٧٨٩"),
  ])];
};

const normalizeText = (value: string, field: "bank" | "text" | "digits") => {
  let result = englishDigits(value)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\s\u200c]+/g, " ")
    .trim()
    .toLocaleLowerCase("fa");
  if (field === "bank") result = result.replace(/^بانک\s+/u, "");
  if (field === "digits") result = result.replace(/\D/g, "");
  return result;
};

const pickMostFrequent = (
  rows: RegistrationOrderHistoryRow[],
  field: "bank_name" | "bank_branch" | "bank_branch_code" | "lc_number",
  normalization: "bank" | "text" | "digits",
) => {
  const groups = new Map<string, { count: number; value: string; latest: number }>();
  for (const row of rows) {
    const value = String(row[field] ?? "").trim();
    if (!value) continue;
    const key = normalizeText(value, normalization);
    if (!key) continue;
    const timestamp = row.updated_at ? Date.parse(row.updated_at) || 0 : 0;
    const previous = groups.get(key);
    if (!previous) groups.set(key, { count: 1, value: normalization === 'digits' ? key : value, latest: timestamp });
    else {
      previous.count += 1;
      if (timestamp >= previous.latest) {
        previous.value = normalization === 'digits' ? key : value;
        previous.latest = timestamp;
      }
    }
  }
  const ranked = [...groups.entries()].sort((a, b) =>
    b[1].count - a[1].count || b[1].latest - a[1].latest || a[0].localeCompare(b[0]),
  );
  return {
    value: ranked[0]?.[1].value ?? null,
    hasConflict: ranked.length > 1,
  };
};

export const resolveLegacyRegistrationBankDetails = (
  rows: RegistrationOrderHistoryRow[],
): LegacyRegistrationBankDetails => {
  const bank = pickMostFrequent(rows, "bank_name", "bank");
  const branch = pickMostFrequent(rows, "bank_branch", "text");
  const branchCode = pickMostFrequent(rows, "bank_branch_code", "digits");
  const payment = pickMostFrequent(rows, "lc_number", "text");
  const conflicts = [
    bank.hasConflict ? "نام بانک" : null,
    branch.hasConflict ? "نام شعبه" : null,
    branchCode.hasConflict ? "کد شعبه" : null,
    payment.hasConflict ? "شماره اعتبار اسنادی" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    bank_name: bank.value,
    bank_branch: branch.value,
    bank_branch_code: branchCode.value,
    payment_instrument_code: payment.value,
    source_count: rows.length,
    conflicts,
  };
};


export type RegistrationOrderBackfillHistoryRow = RegistrationOrderHistoryRow & {
  registration_order_no?: string | null;
  shipment_id?: string | null;
  invoice_currency?: string | null;
  invoice_amount?: number | string | null;
};

export type RegistrationOrderBackfillItem = {
  order_number: string;
  client_id: string;
  bank_name: string | null;
  bank_branch: string | null;
  bank_branch_code: string | null;
  payment_instrument_code: string | null;
  currency: string | null;
  source_count: number;
  conflicts: string[];
};

export type RegistrationOrderBackfillPlan = {
  items: RegistrationOrderBackfillItem[];
  ambiguous_order_numbers: string[];
  missing_owner_order_numbers: string[];
};

/**
 * Build a conservative backfill plan from historical shipment customs data.
 * A registration-order number is only eligible when every source row can be
 * tied to one and the same cargo owner. Historical shipments are never linked
 * or modified by this planner.
 */

export const normalizeLegacyInvoiceCurrency = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes("USD") || /دلار/.test(raw)) return "USD";
  if (upper.includes("EUR") || /یورو/.test(raw)) return "EUR";
  if (upper.includes("AED") || /درهم/.test(raw)) return "AED";
  if (upper.includes("CNY") || /یوان/.test(raw)) return "CNY";
  if (upper.includes("RUB") || /روبل/.test(raw)) return "RUB";
  if (upper.includes("GBP") || /پوند/.test(raw)) return "GBP";
  if (upper.includes("CHF") || /فرانک/.test(raw)) return "CHF";
  if (upper.includes("TRY") || /لیر/.test(raw)) return "TRY";
  if (upper.includes("IRR") || /ریال/.test(raw)) return "IRR";
  return null;
};

export const buildLegacyRegistrationOrderBackfillPlan = (
  rows: RegistrationOrderBackfillHistoryRow[],
  clientByShipment: ReadonlyMap<string, string | null>,
): RegistrationOrderBackfillPlan => {
  const grouped = new Map<
    string,
    {
      originalOrderNumber: string;
      rows: RegistrationOrderHistoryRow[];
      clientIds: Set<string>;
      missingOwner: boolean;
    }
  >();

  for (const row of rows) {
    const orderNumber = normalizeRegistrationOrderNumber(row.registration_order_no);
    const shipmentId = String(row.shipment_id ?? "").trim();
    if (!orderNumber || !shipmentId) continue;

    let group = grouped.get(orderNumber);
    if (!group) {
      group = {
        originalOrderNumber: orderNumber,
        rows: [],
        clientIds: new Set<string>(),
        missingOwner: false,
      };
      grouped.set(orderNumber, group);
    }

    group.rows.push(row);
    const clientId = clientByShipment.get(shipmentId) ?? null;
    if (clientId) group.clientIds.add(clientId);
    else group.missingOwner = true;
  }

  const plan: RegistrationOrderBackfillPlan = {
    items: [],
    ambiguous_order_numbers: [],
    missing_owner_order_numbers: [],
  };

  for (const [orderNumber, group] of grouped) {
    if (group.clientIds.size > 1) {
      plan.ambiguous_order_numbers.push(orderNumber);
      continue;
    }
    if (group.missingOwner || group.clientIds.size !== 1) {
      plan.missing_owner_order_numbers.push(orderNumber);
      continue;
    }

    const details = resolveLegacyRegistrationBankDetails(group.rows);
    if (
      !details.bank_name &&
      !details.bank_branch &&
      !details.bank_branch_code &&
      !details.payment_instrument_code
    ) {
      continue;
    }

    const currencyValues = new Set(
      group.rows
        .map((row: any) => normalizeLegacyInvoiceCurrency(row.invoice_currency))
        .filter((currency): currency is string => Boolean(currency)),
    );
    const hasUnresolvedInvoiceCurrency = group.rows.some(
      (row: any) => row.invoice_amount !== null && row.invoice_amount !== undefined &&
        String(row.invoice_amount).trim() !== "" && !normalizeLegacyInvoiceCurrency(row.invoice_currency),
    );
    const conflicts = [...details.conflicts];
    if (currencyValues.size > 1 || hasUnresolvedInvoiceCurrency) conflicts.push("ارز فاکتور");
    plan.items.push({
      order_number: group.originalOrderNumber,
      client_id: [...group.clientIds][0],
      bank_name: details.bank_name,
      bank_branch: details.bank_branch,
      bank_branch_code: details.bank_branch_code,
      payment_instrument_code: details.payment_instrument_code,
      currency: currencyValues.size === 1 && !hasUnresolvedInvoiceCurrency ? [...currencyValues][0] : null,
      source_count: details.source_count,
      conflicts,
    });
  }

  return plan;
};
