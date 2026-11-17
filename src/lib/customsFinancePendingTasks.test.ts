import { describe, expect, it } from "vitest";
import { buildCustomsFinancePendingTasks } from "./customsFinancePendingTasks";

describe("customs finance pending task projection", () => {
  it("links submitted costs to the canonical finance record", () => {
    const tasks = buildCustomsFinancePendingTasks([{
      id: "cost-1",
      shipment_id: "shipment-1",
      description: "هزینه بازرسی",
      amount: 125000,
      currency: "IRR",
      workflow_status: "SUBMITTED",
    }], (id) => "/finance/shipments/" + id);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "finance:cost-1",
      title: "هزینه بازرسی",
      stage: "finance",
      priority: "normal",
      href: "/finance/shipments/shipment-1",
      source: "finance",
    });
    expect(tasks[0].detail).toContain("در انتظار تأیید مالی");
  });

  it("marks rejected records as urgent and ignores non-actionable states", () => {
    const tasks = buildCustomsFinancePendingTasks([
      { id: "cost-2", shipment_id: "s", description: "هزینه ردشده", amount: "50", currency: "IRR", workflow_status: "REJECTED" },
      { id: "cost-3", shipment_id: "s", description: "پیش‌نویس", amount: 25, currency: "IRR", workflow_status: "DRAFT" },
      { id: "cost-4", shipment_id: "s", description: "تأییدشده", amount: 30, currency: "IRR", workflow_status: "APPROVED" },
    ], (id) => "/finance/shipments/" + id);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].priority).toBe("urgent");
    expect(tasks[0].detail).toContain("نیازمند اصلاح مالی");
  });
});
