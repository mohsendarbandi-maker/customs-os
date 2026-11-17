import { describe, expect, it } from "vitest";
import {
  deriveCustomsChecklistCompletion,
  isWorkflowManagedChecklistItem,
} from "./customsChecklistStatus";

describe("customs checklist mirrors operational state", () => {
  it("derives assessment completion from green-route not-required state", () => {
    expect(deriveCustomsChecklistCompletion(
      { item_label: "ارزیابی", source: "system" },
      { evaluation_state: { status: "not_required", expert_requested: false } },
      "green",
    )).toBe(true);
  });

  it("does not mark a requested assessment complete", () => {
    expect(deriveCustomsChecklistCompletion(
      { item_label: "ارزیابی", source: "system" },
      { evaluation_state: { status: "not_required", expert_requested: true } },
      "green",
    )).toBe(false);
  });

  it("maps tax, SATA exception, appointment and standards to their own fields", () => {
    const workflow = {
      expertise_state: {
        appointment_status: "scheduled",
        standard: { expert_review: "approved" },
      },
      loading_permit_state: {
        tax_permission_status: "approved",
        central_bank_status: "not_required",
      },
    };
    expect(deriveCustomsChecklistCompletion({ item_label: "نوبت کارشناسی", source: "system" }, workflow, "yellow")).toBe(true);
    expect(deriveCustomsChecklistCompletion({ item_label: "مجوز استاندارد", source: "system" }, workflow, "yellow")).toBe(true);
    expect(deriveCustomsChecklistCompletion({ item_label: "مالیات علی الحساب", source: "system" }, workflow, "yellow")).toBe(true);
    expect(deriveCustomsChecklistCompletion({ item_label: "کد ساتا", source: "system" }, workflow, "yellow")).toBe(true);
  });

  it("keeps manual checklist items independent", () => {
    expect(deriveCustomsChecklistCompletion(
      { item_label: "کد ساتا", source: "manual" },
      { loading_permit_state: { sata_code: "123456" } },
      "green",
    )).toBe(null);
  });

  it("returns null for non-mapped checklist items", () => {
    expect(deriveCustomsChecklistCompletion(
      { item_label: "پیگیری نامه اختصاصی", source: "system" },
      { loading_permit_state: { sata_code: "123456" } },
      "green",
    )).toBe(null);
  });

  it("identifies mapped system items as workflow-managed", () => {
    expect(isWorkflowManagedChecklistItem({ item_label: "کد ساتا", source: "system" })).toBe(true);
    expect(isWorkflowManagedChecklistItem({ item_label: "کد ساتا", source: "manual" })).toBe(false);
  });
});
