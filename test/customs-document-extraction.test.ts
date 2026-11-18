import { describe, expect, it } from "vitest";
import {
  extractProformaInvoiceIdentity,
  normalizeDocumentExtractionDigits,
} from "../src/lib/customsDocumentExtraction";

describe("independent proforma and commercial invoice extraction", () => {
  it("keeps proforma number/date separate from commercial invoice number/date", () => {
    const fields = extractProformaInvoiceIdentity(
      "Proforma Invoice No: PI-1405/08 Date: ۱۴۰۵/۰۸/۲۱. Commercial Invoice No: CI-778 Date: 2026-11-18",
      2,
      "PDF text",
      0.9,
    );
    expect(fields.map((field) => [field.key, field.value])).toEqual([
      ["proformaNumber", "PI-1405/08"],
      ["proformaDate", "1405/08/21"],
      ["invoiceNumber", "CI-778"],
      ["invoiceDate", "2026-11-18"],
    ]);
  });

  it("supports Persian labels and Arabic-Indic numerals without calendar conversion", () => {
    const fields = extractProformaInvoiceIdentity(
      "شماره پروفرما: پ-۱۲۳ تاریخ پروفرما: ١٤٠٥/٠٩/٠١ شماره فاکتور: ف-۹۸۷ تاریخ فاکتور: ۱۴۰۵/۰۹/۰۳",
      1,
      "Tesseract OCR",
      0.82,
    );
    expect(fields.map((field) => [field.key, field.value])).toEqual([
      ["proformaNumber", "پ-123"],
      ["proformaDate", "1405/09/01"],
      ["invoiceNumber", "ف-987"],
      ["invoiceDate", "1405/09/03"],
    ]);
    expect(fields.find((field) => field.key === "proformaDate")?.value).toBe("1405/09/01");
  });

  it("returns partial results when only one field is present", () => {
    const fields = extractProformaInvoiceIdentity("COMMERCIAL INVOICE NO: INV-55", 4, "PDF text", 0.9);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "invoiceNumber", value: "INV-55", page: 4 });
  });

  it("normalizes digits while preserving date separators and sequence", () => {
    expect(normalizeDocumentExtractionDigits("۱۴۰۵/۰۸/۲۱")).toBe("1405/08/21");
    expect(normalizeDocumentExtractionDigits("٢٠٢٦-١١-١٨")).toBe("2026-11-18");
  });
});
