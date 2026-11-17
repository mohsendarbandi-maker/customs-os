import { describe, expect, it } from "vitest";
import { buildCustomsWorkflowPendingTasks } from "./customsPendingTasks";

const completedWorkflow = {
  declaration_id: "declaration-1",
  customs_path: "green",
  evaluation_state: { status: "not_required", expert_requested: false },
  expertise_state: {
    appointment_status: "not_required",
    road_authority_status: "not_required",
    plant_quarantine_status: "not_required",
    standard: {
      expert_review: "not_required",
      inspection_status: "not_required",
      sample_status: "not_required",
      standard_fee_paid: true,
      standard_notified: true,
    },
  },
  cashier_state: { method: "cash", cash_paid_irr: 0 },
  loading_permit_state: {
    clause2_request_status: "not_required",
    tax_permission_status: "not_required",
    central_bank_status: "not_required",
    sata_code: "",
  },
  exit_state: {
    loading_permission_status: "approved",
    financial_registration_status: "registered",
    weighbridge_required: false,
    loading_completed_at: "1405/01/03",
  },
  port_charges_state: {
    insurance_issue_date: "1404/12/29",
    warehouse_receipt_date: "1405/01/01",
    insurance_followup_status: "not_required",
    initial_invoice_status: "paid",
    transport_power_of_attorney_status: "approved",
    loading_form_received_at: "1405/01/01",
    loading_started_at: "1405/01/02",
    supplemental_invoice_status: "not_required",
    last_truck_loaded_at: "",
  },
};

describe("customs pending report", () => {
  it("does not report activities explicitly marked not required", () => {
    const tasks = buildCustomsWorkflowPendingTasks(
      completedWorkflow,
      "green",
      new Date("2026-03-25T12:00:00.000Z"),
    );

    expect(tasks).toEqual([]);
  });

  it("reports a pending permit using the same rule as workflow validation", () => {
    const workflow = {
      ...completedWorkflow,
      loading_permit_state: {
        ...completedWorkflow.loading_permit_state,
        tax_permission_status: "pending",
      },
    };

    const tasks = buildCustomsWorkflowPendingTasks(workflow, "green");

    expect(tasks.some(task =>
      task.stage === "loading_permit" && task.title.includes("امور مالیاتی"),
    )).toBe(true);
  });

  it("keeps overdue warehouse and loading-form warnings visible", () => {
    const workflow = {
      ...completedWorkflow,
      exit_state: { ...completedWorkflow.exit_state, loading_completed_at: "" },
      port_charges_state: {
        ...completedWorkflow.port_charges_state,
        loading_form_received_at: "1405/01/01",
        warehouse_receipt_date: "1405/01/01",
        loading_started_at: "",
      },
    };

    const tasks = buildCustomsWorkflowPendingTasks(
      workflow,
      "green",
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(tasks.filter(task => task.priority === "urgent")).toHaveLength(2);
  });
});
