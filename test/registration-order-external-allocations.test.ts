import { describe, expect, it } from "vitest";
import {
  buildExternalRegistrationOrderAllocationPayload,
  calculateRegistrationOrderCapacity,
  parseAllocationNumber,
  type ExternalRegistrationOrderAllocationForm,
} from "../src/lib/registrationOrderAllocations";

const form = (overrides: Partial<ExternalRegistrationOrderAllocationForm> = {}): ExternalRegistrationOrderAllocationForm => ({
  recipient_company: "شرکت مقصد",
  destination_customs: "گمرک بندرعباس",
  allocation_reference: "OUT-01",
  net_weight_kg: "۴۰۰٬۰۰۰",
  gross_weight_kg: "۴۰۲۰۰۰",
  value_amount: "120000",
  currency: "USD",
  status: "allocated",
  notes: "",
  ...overrides,
});

describe("external registration-order allocations", () => {
  it("parses Persian and Arabic numerals with separators", () => {
    expect(parseAllocationNumber("۴۰۰٬۰۰۰")).toBe(400000);
    expect(parseAllocationNumber("٤٠٠,٠٠٠")).toBe(400000);
  });

  it("builds a valid external allocation payload", () => {
    const result = buildExternalRegistrationOrderAllocationPayload(form(), "USD");
    expect(result).toEqual({
      ok: true,
      payload: {
        recipient_company: "شرکت مقصد",
        destination_customs: "گمرک بندرعباس",
        allocation_reference: "OUT-01",
        net_weight_kg: 400000,
        gross_weight_kg: 402000,
        value_amount: 120000,
        currency: "USD",
        status: "allocated",
        notes: null,
      },
    });
  });

  it("requires a destination, a positive net weight and an order value", () => {
    expect(buildExternalRegistrationOrderAllocationPayload(form({ recipient_company: "", destination_customs: "" }), "USD").ok).toBe(false);
    expect(buildExternalRegistrationOrderAllocationPayload(form({ net_weight_kg: "0" }), "USD").ok).toBe(false);
    expect(buildExternalRegistrationOrderAllocationPayload(form({ value_amount: "" }), "USD").ok).toBe(false);
  });

  it("rejects gross weights below net weight and currencies different from the master", () => {
    expect(buildExternalRegistrationOrderAllocationPayload(form({ gross_weight_kg: "399999" }), "USD").ok).toBe(false);
    expect(buildExternalRegistrationOrderAllocationPayload(form({ currency: "AED" }), "USD").ok).toBe(false);
  });

  it("counts outside allocations together with internal shipments and releases cancelled portions", () => {
    const result = calculateRegistrationOrderCapacity(1000000, 600000, 250000);
    expect(result).toEqual({
      registered: 1000000,
      internal: 600000,
      external: 250000,
      allocated: 850000,
      remaining: 150000,
      exceeded: false,
    });
    expect(calculateRegistrationOrderCapacity(1000000, 600000, 450000).exceeded).toBe(true);
    expect(calculateRegistrationOrderCapacity(1000000, 600000, 0).remaining).toBe(400000);
  });
});
