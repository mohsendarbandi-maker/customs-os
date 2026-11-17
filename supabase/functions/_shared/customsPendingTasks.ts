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

export type CustomsActivityPendingLike = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "waiting" | "blocked" | "completed" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  assignee_id?: string | null;
  due_at?: string | null;
  declaration_id?: string | null;
  shipment_id?: string | null;
};

export type CustomsActivityPendingTask = {
  id: string;
  activityId: string;
  declarationId: string | null;
  shipmentId: string | null;
  title: string;
  detail: string;
  bucket: "overdue" | "due_today" | "unassigned" | "waiting" | "open";
  priority: "normal" | "urgent";
  urgent: boolean;
  overdue: boolean;
  dueToday: boolean;
  unassigned: boolean;
  waiting: boolean;
  assigneeId: string | null;
  dueAt: string | null;
  kind: "activity";
};

const activityStatusLabels: Record<CustomsActivityPendingLike["status"], string> = {
  open: "باز",
  in_progress: "در حال انجام",
  waiting: "در انتظار",
  blocked: "مسدود",
  completed: "انجام‌شده",
  cancelled: "لغوشده",
};

/**
 * Projects independent customs activities into a shared daily-work view.
 * The activity remains the source of truth; linked reminders and finance rows
 * are not counted as duplicate activities.
 */
export function buildCustomsActivityPendingTasks(
  activities: readonly CustomsActivityPendingLike[],
  now: Date = new Date(),
): CustomsActivityPendingTask[] {
  const formatTehranDay = (value: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
  const todayKey = formatTehranDay(now);

  return activities
    .filter((activity) => !["completed", "cancelled"].includes(activity.status))
    .map((activity) => {
      const dueAt = asText(activity.due_at) || null;
      const dueTimestamp = dueAt ? Date.parse(dueAt) : Number.NaN;
      const hasDueDate = Number.isFinite(dueTimestamp);
      const overdue = hasDueDate && dueTimestamp < now.getTime();
      const dueToday = hasDueDate && formatTehranDay(new Date(dueTimestamp)) === todayKey;
      const unassigned = !asText(activity.assignee_id);
      const waiting = activity.status === "waiting" || activity.status === "blocked";
      const urgent = activity.priority === "urgent" || overdue;
      const bucket: CustomsActivityPendingTask["bucket"] = overdue
        ? "overdue"
        : dueToday
          ? "due_today"
          : unassigned
            ? "unassigned"
            : waiting
              ? "waiting"
              : "open";
      const details = [
        activityStatusLabels[activity.status],
        unassigned ? "بدون مسئول" : "مسئول تخصیص‌یافته",
        overdue ? "موعد گذشته" : dueToday ? "موعد امروز" : hasDueDate ? "موعد " + new Date(dueTimestamp).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : "بدون موعد",
        activity.priority === "urgent" ? "فوری" : "",
      ].filter(Boolean);

      return {
        id: "activity:" + activity.id,
        activityId: activity.id,
        declarationId: activity.declaration_id || null,
        shipmentId: activity.shipment_id || null,
        title: asText(activity.title) || "فعالیت بدون عنوان",
        detail: details.join(" · "),
        bucket,
        priority: urgent ? "urgent" : "normal",
        urgent,
        overdue,
        dueToday,
        unassigned,
        waiting,
        assigneeId: activity.assignee_id || null,
        dueAt,
        kind: "activity" as const,
      };
    });
}

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
