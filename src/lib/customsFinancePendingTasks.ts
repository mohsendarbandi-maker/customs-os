export type CustomsFinancePendingCost = {
  id: string;
  shipment_id: string;
  description: string | null;
  amount: number | string;
  currency: string;
  workflow_status: string;
};

export type CustomsFinancePendingTask = {
  id: string;
  title: string;
  detail: string;
  stage: "finance";
  priority: "normal" | "urgent";
  href: string;
  source: "finance";
};

const formatAmount = (value: number | string) =>
  Number(value || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

/** Read-only projection: finance_cost_items remains the canonical monetary source. */
export function buildCustomsFinancePendingTasks(
  rows: readonly CustomsFinancePendingCost[],
  shipmentHref: (shipmentId: string) => string,
): CustomsFinancePendingTask[] {
  return rows
    .filter((row) => row.workflow_status === "SUBMITTED" || row.workflow_status === "REJECTED")
    .map((row) => {
      const rejected = row.workflow_status === "REJECTED";
      return {
        id: "finance:" + row.id,
        title: row.description?.trim() || "هزینه ثبت‌شده محموله",
        detail: formatAmount(row.amount) + " " + row.currency + (rejected ? " · نیازمند اصلاح مالی" : " · در انتظار تأیید مالی"),
        stage: "finance" as const,
        priority: rejected ? "urgent" as const : "normal" as const,
        href: shipmentHref(row.shipment_id),
        source: "finance" as const,
      };
    });
}
