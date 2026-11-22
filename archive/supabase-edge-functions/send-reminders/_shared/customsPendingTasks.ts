import {
  getAbandonedGoodsWarnings,
  getWorkflowStageIssues,
  type CustomsWorkflowValidationState,
} from "./customsDeclarationWorkflow.ts";

export const CUSTOMS_WORKFLOW_PENDING_STAGES = [
  { key: "evaluation", label: "ارزیابی" },
  { key: "expertise", label: "کارشناسی و مجوزها" },
  { key: "cashier", label: "صندوق و ضمانت‌نامه" },
  { key: "loading_permit", label: "مجوزها و منشأ ارز" },
  { key: "exit", label: "درب خروج" },
  { key: "port_charges", label: "عوارض بندری" },
] as const;

export type CustomsWorkflowPendingTask = {
  id: string;
  declarationId: string;
  stage: string;
  stageLabel: string;
  title: string;
  priority: "normal" | "urgent";
  kind: "workflow";
};

type WorkflowLike = {
  declaration_id?: string | null;
  customs_path?: string | null;
  evaluation_state?: unknown;
  expertise_state?: unknown;
  cashier_state?: unknown;
  loading_permit_state?: unknown;
  exit_state?: unknown;
  port_charges_state?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asText = (value: unknown): string => String(value ?? "").trim();

/**
 * Uses the same operational validation rules as the customs workflow UI.
 * A task appears only when the corresponding activity is still incomplete;
 * explicit "not_required" values are respected by getWorkflowStageIssues.
 */
export function buildCustomsWorkflowPendingTasks(
  workflow: WorkflowLike,
  customsPath?: string | null,
  now: Date = new Date(),
): CustomsWorkflowPendingTask[] {
  const declarationId = asText(workflow.declaration_id) || "unknown-declaration";
  const evaluation = asRecord(workflow.evaluation_state);
  const expertise = asRecord(workflow.expertise_state);
  const cashier = asRecord(workflow.cashier_state);
  const loadingPermit = asRecord(workflow.loading_permit_state);
  const exit = asRecord(workflow.exit_state);
  const port = asRecord(workflow.port_charges_state);

  const state: CustomsWorkflowValidationState = {
    customsPath: asText(customsPath ?? workflow.customs_path),
    evaluation,
    expertise,
    cashier,
    loadingPermit,
    exit,
    port,
  };

  const tasks: CustomsWorkflowPendingTask[] = CUSTOMS_WORKFLOW_PENDING_STAGES.flatMap(
    ({ key, label }) =>
      getWorkflowStageIssues(key, state).map((title, index) => ({
        id: declarationId + ":" + key + ":" + index,
        declarationId,
        stage: key,
        stageLabel: label,
        title,
        priority: "normal" as const,
        kind: "workflow" as const,
      })),
  );

  const warnings = getAbandonedGoodsWarnings({
    loadingFormReceivedAt: asText(port.loading_form_received_at) || null,
    loadingCompletedAt: asText(exit.loading_completed_at) || null,
    warehouseReceiptAt: asText(port.warehouse_receipt_date) || null,
    loadingStartedAt: asText(port.loading_started_at) || null,
  }, now);

  if (warnings.loadingFormExpired) {
    tasks.push({
      id: declarationId + ":abandoned:loading-form",
      declarationId,
      stage: "abandoned",
      stageLabel: "هشدار متروکه",
      title: "مهلت یک‌ماهه فرم بارگیری گذشته و اتمام بارگیری ثبت نشده است.",
      priority: "urgent",
      kind: "workflow",
    });
  }

  if (warnings.receiptExpired) {
    tasks.push({
      id: declarationId + ":abandoned:warehouse-receipt",
      declarationId,
      stage: "abandoned",
      stageLabel: "هشدار متروکه",
      title: "سه ماه از تاریخ قبض انبار گذشته و شروع بارگیری ثبت نشده است.",
      priority: "urgent",
      kind: "workflow",
    });
  }

  return tasks;
}
