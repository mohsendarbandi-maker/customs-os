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
