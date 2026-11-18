export type ExtractedDocumentIdentityField = {
  key: "proformaNumber" | "proformaDate" | "invoiceNumber" | "invoiceDate";
  label: string;
  value: string;
  page: number;
  source: string;
  sourceText: string;
  confidence: number;
};

const DATE_VALUE = "(?:\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})";
const NUMBER_VALUE = "([A-Z0-9۰-۹][A-Z0-9۰-۹./_-]{1,39})";

export function normalizeDocumentExtractionDigits(value: string): string {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function firstMatch(text: string, patterns: RegExp[], rejectProforma = false) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (rejectProforma && /pro[\\s-]?forma|پروفرما|پروفورما/i.test(text.slice(Math.max(0, match.index - 45), match.index))) {
      continue;
    }
    return match;
  }
  return null;
}

/**
 * Extracts document identity as four independent values. Dates are returned as
 * the source date string with digits normalized only; no calendar conversion
 * or write to authoritative master data is performed here.
 */
export function extractProformaInvoiceIdentity(
  pageText: string,
  page: number,
  source: string,
  confidence: number,
): ExtractedDocumentIdentityField[] {
  const text = String(pageText ?? "").replace(/\\s+/g, " ").trim();
  if (!text) return [];

  const proformaNumber = firstMatch(text, [
    new RegExp("(?:pro[\\s-]?forma(?:\\s+invoice)?|پروفرما|پروفورما)\\s*(?:no\\.?|number|#|شماره)\\s*[:：#-]?\\s*" + NUMBER_VALUE, "i"),
    new RegExp("(?:شماره\\s*(?:pro[\\s-]?forma|پروفرما|پروفورما))\\s*[:：#-]?\\s*" + NUMBER_VALUE, "i"),
  ]);
  const proformaDate = firstMatch(text, [
    new RegExp("(?:pro[\\s-]?forma(?:\\s+invoice)?|پروفرما|پروفورما)[^\\n]{0,70}?(?:date|تاریخ)\\s*[:：#-]?\\s*(" + DATE_VALUE + ")", "i"),
    new RegExp("(?:date|تاریخ)\\s*(?:of\\s*)?(?:pro[\\s-]?forma|پروفرما|پروفورما)[^\\n]{0,35}?(" + DATE_VALUE + ")", "i"),
  ]);

  const invoiceNumber = firstMatch(text, [
    new RegExp("(?:commercial\\s+invoice|invoice)\\s*(?:no\\.?|number|#)\\s*[:：#-]?\\s*" + NUMBER_VALUE, "ig"),
    new RegExp("(?:شماره\\s*(?:فاکتور|اینویس)|(?:کامرشال\\s+اینویس|فاکتور|اینویس)\\s*(?:شماره|no\\.?|number|#))\\s*[:：#-]?\\s*" + NUMBER_VALUE, "ig"),
  ], true);
  const invoiceDate = firstMatch(text, [
    new RegExp("(?:commercial\\s+invoice|invoice|کامرشال\\s+اینویس|فاکتور|اینویس)[^\\n]{0,70}?(?:date|تاریخ)\\s*[:：#-]?\\s*(" + DATE_VALUE + ")", "ig"),
    new RegExp("(?:date|تاریخ)\\s*(?:of\\s*)?(?:commercial\\s+invoice|invoice|کامرشال\\s+اینویس|فاکتور|اینویس)[^\\n]{0,35}?(" + DATE_VALUE + ")", "ig"),
  ], true);

  const fields: ExtractedDocumentIdentityField[] = [];
  const add = (match: RegExpExecArray | null, key: ExtractedDocumentIdentityField["key"], label: string) => {
    const raw = match?.[1]?.trim();
    if (!raw) return;
    fields.push({
      key, label, value: normalizeDocumentExtractionDigits(raw),
      page, source, sourceText: match[0].trim(), confidence,
    });
  };
  add(proformaNumber, "proformaNumber", "شماره پروفرما");
  add(proformaDate, "proformaDate", "تاریخ پروفرما");
  add(invoiceNumber, "invoiceNumber", "شماره کامرشال اینویس");
  add(invoiceDate, "invoiceDate", "تاریخ کامرشال اینویس");
  return fields;
}
