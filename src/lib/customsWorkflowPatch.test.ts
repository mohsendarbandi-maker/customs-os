import { describe, expect, it } from "vitest";
import { buildCustomsWorkflowJsonbPatch } from "./customsWorkflowPatch";

describe("customs workflow JSONB patches", () => {
  it("only includes the leaf changed by the active operator", () => {
    const baseline = {
      appointment_status: "not_requested",
      road_authority_status: "pending",
      plant_quarantine_status: "not_required",
      standard: { expert_review: "pending", inspection_paid: false, standard_fee_paid: false },
    };
    const current = {
      ...baseline,
      standard: { ...baseline.standard, expert_review: "approved" },
    };

    expect(buildCustomsWorkflowJsonbPatch(baseline, current)).toEqual({
      standard: { expert_review: "approved" },
    });
  });

  it("keeps different nested activities in separate patches", () => {
    const baseline = { standard: { expert_review: "pending", inspection_paid: false } };
    const operatorA = { standard: { expert_review: "approved", inspection_paid: false } };
    const operatorB = { standard: { expert_review: "pending", inspection_paid: true } };

    expect(buildCustomsWorkflowJsonbPatch(baseline, operatorA)).toEqual({
      standard: { expert_review: "approved" },
    });
    expect(buildCustomsWorkflowJsonbPatch(baseline, operatorB)).toEqual({
      standard: { inspection_paid: true },
    });
  });

  it("returns an empty patch when no values changed", () => {
    expect(buildCustomsWorkflowJsonbPatch(
      { status: "completed", standard: { expert_review: "approved" } },
      { status: "completed", standard: { expert_review: "approved" } },
    )).toEqual({});
  });

  it("treats arrays as atomic values", () => {
    expect(buildCustomsWorkflowJsonbPatch(
      { references: ["A", "B"] },
      { references: ["A", "C"] },
    )).toEqual({ references: ["A", "C"] });
  });
});
