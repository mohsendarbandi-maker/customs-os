import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/CustomsDocumentManagerPage.tsx"), "utf8");
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261118113000_shipment_document_independent_invoice_metadata.sql"), "utf8");

describe("independent shipment document metadata workflow", () => {
  it("stores the document type, number, dates, amount and currency on the canonical document row", () => {
    expect(migration).toContain("add column if not exists document_type text");
    expect(migration).toContain("add column if not exists document_number text");
    expect(migration).toContain("add column if not exists issue_date date");
    expect(migration).toContain("add column if not exists issue_date_shamsi text");
    expect(migration).toContain("add column if not exists invoice_amount numeric");
    expect(migration).toContain("add column if not exists invoice_currency text");
  });

  it("keeps Gregorian and Jalali date entry independent and does not auto-convert", () => {
    expect(page).toContain("issue_date: metadataForm.issue_date || null");
    expect(page).toContain("issue_date_shamsi: metadataForm.issue_date_shamsi.trim() || null");
    expect(page).toContain("type=\"date\"");
    expect(page).toContain("بدون تبدیل خودکار تقویم");
  });

  it("writes extracted suggestions only to the canonical document extraction table", () => {
    expect(page).toContain("if (canonicalDocument && user && out.length)");
    expect(page).toContain("source_text: x.sourceText || null");
    expect(page).toContain("field_label: x.label || x.key");
  });

  it("synchronizes File Manager's inferred type even if the user did not enter optional tags", () => {
    expect(page).toContain("const fileMetadataPatch: Record<string, unknown>");
    expect(page).toContain("document_type: inferType(file.name) || 'other'");
    expect(page).toContain("this is intentionally outside the uploadTags condition");
  });
});
