import { describe, expect, it } from "vitest";
import {
  normalizeRegistrationOrderNumber,
  registrationOrderNumberVariants,
  resolveLegacyRegistrationBankDetails,
  buildLegacyRegistrationOrderBackfillPlan,
} from "../src/lib/registrationOrderLookup";

describe("registration order lookup", () => {
  it("normalizes Persian and Arabic digits and generates searchable variants", () => {
    expect(normalizeRegistrationOrderNumber("۹۲۷۳۳۰۷۴")).toBe("92733074");
    expect(normalizeRegistrationOrderNumber("٩٢٧٣٣٠٧٤")).toBe("92733074");
    expect(registrationOrderNumberVariants("۹۲۷۳۳۰۷۴")).toEqual([
      "92733074",
      "۹۲۷۳۳۰۷۴",
      "٩٢٧٣٣٠٧٤",
    ]);
  });

  it("recovers shared bank details from matching historical shipment documents", () => {
    const result = resolveLegacyRegistrationBankDetails([
      { bank_name: "ملت", bank_branch: "تبریز", bank_branch_code: "۱۲۱۳۴۲۵", lc_number: "2610129121", updated_at: "2026-10-24T10:00:00Z" },
      { bank_name: "بانک ملت", bank_branch: "تبریز", bank_branch_code: "1213425", lc_number: "2610129121", updated_at: "2026-10-14T10:00:00Z" },
      { bank_name: "ملت", bank_branch: "تبریز", bank_branch_code: "1213425", lc_number: "2610129121", updated_at: "2026-10-03T10:00:00Z" },
    ]);

    expect(result.bank_name).toBe("ملت");
    expect(result.bank_branch).toBe("تبریز");
    expect(result.bank_branch_code).toBe("1213425");
    expect(result.payment_instrument_code).toBe("2610129121");
    expect(result.source_count).toBe(3);
    expect(result.conflicts).toEqual([]);
  });

  it("chooses the most frequent historical value and flags conflicting branch data", () => {
    const result = resolveLegacyRegistrationBankDetails([
      { bank_name: "سامان", bank_branch: "جام جم", bank_branch_code: "5606117", lc_number: "26188567", updated_at: "2026-10-23T15:00:00Z" },
      { bank_name: "سامان", bank_branch: "جام جم", bank_branch_code: "5606117", lc_number: "26188567", updated_at: "2026-10-23T14:00:00Z" },
      { bank_name: "سامان", bank_branch: "جام جم", bank_branch_code: "5606117", lc_number: null, updated_at: "2026-10-23T13:00:00Z" },
      { bank_name: null, bank_branch: null, bank_branch_code: "5606117", lc_number: null, updated_at: "2026-10-31T14:00:00Z" },
      { bank_name: "سامان", bank_branch: "مشهد", bank_branch_code: "611", lc_number: "26188567", updated_at: "2026-10-05T13:00:00Z" },
    ]);

    expect(result.bank_name).toBe("سامان");
    expect(result.bank_branch).toBe("جام جم");
    expect(result.bank_branch_code).toBe("5606117");
    expect(result.payment_instrument_code).toBe("26188567");
    expect(result.conflicts).toContain("نام شعبه");
    expect(result.conflicts).toContain("کد شعبه");
  });

  it("returns empty details when no historical bank data exists", () => {
    expect(resolveLegacyRegistrationBankDetails([])).toEqual({
      bank_name: null,
      bank_branch: null,
      bank_branch_code: null,
      payment_instrument_code: null,
      source_count: 0,
      conflicts: [],
    });
  });

  it("builds a bank backfill plan only for one unambiguous cargo owner", () => {
    const plan = buildLegacyRegistrationOrderBackfillPlan(
      [
        { shipment_id: "s1", registration_order_no: "۹۱۹۰۰۰۲۷", bank_name: "سامان", bank_branch: "جام جم", bank_branch_code: "5606117", lc_number: "26188567" },
        { shipment_id: "s2", registration_order_no: "91900027", bank_name: "سامان", bank_branch: "جام جم", bank_branch_code: "5606117", lc_number: null },
        { shipment_id: "s3", registration_order_no: "91900027", bank_name: "سامان", bank_branch: "مشهد", bank_branch_code: "611", lc_number: "26188567" },
      ],
      new Map([["s1", "client-1"], ["s2", "client-1"], ["s3", "client-1"]]),
    );

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      order_number: "91900027",
      client_id: "client-1",
      bank_name: "سامان",
      bank_branch: "جام جم",
      bank_branch_code: "5606117",
      payment_instrument_code: "26188567",
      source_count: 3,
    });
    expect(plan.items[0].conflicts).toContain("نام شعبه");
    expect(plan.items[0].conflicts).toContain("کد شعبه");
    expect(plan.ambiguous_order_numbers).toEqual([]);
  });

  it("does not mix one registration number across different cargo owners", () => {
    const plan = buildLegacyRegistrationOrderBackfillPlan(
      [
        { shipment_id: "s1", registration_order_no: "12345678", bank_name: "ملت", lc_number: "LC-1" },
        { shipment_id: "s2", registration_order_no: "12345678", bank_name: "ملت", lc_number: "LC-1" },
      ],
      new Map([["s1", "client-1"], ["s2", "client-2"]]),
    );

    expect(plan.items).toEqual([]);
    expect(plan.ambiguous_order_numbers).toEqual(["12345678"]);
  });

  it("skips history rows without a resolvable cargo owner", () => {
    const plan = buildLegacyRegistrationOrderBackfillPlan(
      [{ shipment_id: "s1", registration_order_no: "12345678", bank_name: "ملت" }],
      new Map(),
    );

    expect(plan.items).toEqual([]);
    expect(plan.missing_owner_order_numbers).toEqual(["12345678"]);
  });
});
