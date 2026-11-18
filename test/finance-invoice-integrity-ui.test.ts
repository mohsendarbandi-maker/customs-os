import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/FinancePage.tsx"), "utf8");

describe("finance invoice integrity warning", () => {
  it("queries the read-only integrity view only for organization-finance roles", () => {
    expect(page).toContain("const canSeeInvoiceIntegrity=isOwner||isAdmin||profile?.role==='accountant'||!!currentPermission?.view_org_financials");
    expect(page).toContain("supabase.from('finance_cost_invoice_integrity')");
    expect(page).toContain("setInvoiceIntegrity(integrity.data||[])");
    expect(page).toContain("else setInvoiceIntegrity([])");
  });

  it("keeps the finance page usable before the additive view migration is released", () => {
    expect(page).toContain("schema cache|could not find the table|does not exist");
    expect(page).toContain("if(/schema cache|could not find the table|does not exist/i.test(message))setInvoiceIntegrity([])");
  });

  it("warns instead of silently releasing or re-invoicing orphan costs", () => {
    expect(page).toContain("هزینه‌های نیازمند تطبیق صورتحساب");
    expect(page).toContain("دوباره صورتحساب نسازید");
    expect(page).toContain("MISSING_ACTIVE_INVOICE");
    expect(page).toContain("MULTIPLE_ACTIVE_INVOICES");
    expect(page).toContain("INVOICE_LINK_STATUS_MISMATCH");
    expect(page).not.toContain("setCosts(" + "previous");
  });
});
