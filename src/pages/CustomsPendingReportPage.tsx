import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock3, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { buildCustomsWorkflowPendingTasks, type CustomsWorkflowPendingTask } from "../lib/customsPendingTasks";

type DeclarationRow = {
  id: string;
  case_id: string | null;
  shipment_id: string | null;
  kottaj_number: string;
  customs_path: string | null;
  customs_regime: string | null;
  created_at: string;
};

type WorkflowRow = {
  id: string;
  declaration_id: string;
  current_stage: string;
  evaluation_state: Record<string, unknown>;
  expertise_state: Record<string, unknown>;
  cashier_state: Record<string, unknown>;
  loading_permit_state: Record<string, unknown>;
  exit_state: Record<string, unknown>;
  port_charges_state: Record<string, unknown>;
  updated_at: string;
};

type ShipmentRow = {
  id: string;
  case_id: string | null;
  client_id: string | null;
  display_name: string | null;
  bill_of_lading_no: string | null;
};

type CaseRow = { id: string; case_number: string | null; client_id: string | null };
type ClientRow = { id: string; name: string };
type ChecklistRow = { id: string; declaration_id: string; item_label: string; note: string | null };
type PermitRow = {
  id: string;
  case_id: string;
  permit_type: string;
  permit_number: string | null;
  issuing_authority: string;
};

type ReportItem = {
  id: string;
  declarationId: string;
  title: string;
  detail: string;
  stage: string;
  priority: "normal" | "urgent";
  href: string;
  source: "workflow" | "checklist" | "permit";
};

type ReportGroup = {
  declarationId: string;
  shipmentName: string;
  billOfLading: string;
  clientName: string;
  caseNumber: string;
  kottaj: string;
  regime: string | null;
  href: string;
  items: ReportItem[];
};

const roleAllowed = ["owner", "admin", "broker", "accountant", "warehouse"];
const faNumber = (value: number) => value.toLocaleString("fa-IR");
const regimeLabel = (value: string | null) =>
  value === "import_definitive" ? "واردات قطعی" : value || "رویه ثبت‌نشده";

export const CustomsPendingReportPage: React.FC = () => {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id || "";
  const allowed = roleAllowed.includes(String(profile?.role || ""));
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !allowed) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: workflows, error: workflowError } = await supabase
        .from("customs_declaration_workflow")
        .select("id,declaration_id,current_stage,evaluation_state,expertise_state,cashier_state,loading_permit_state,exit_state,port_charges_state,updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (workflowError) throw workflowError;

      const workflowRows = (workflows || []) as WorkflowRow[];
      const declarationIds = [...new Set(workflowRows.map((row) => row.declaration_id).filter(Boolean))];
      if (!declarationIds.length) {
        setGroups([]);
        setRefreshedAt(new Date());
        return;
      }

      const { data: declarations, error: declarationError } = await supabase
        .from("customs_declarations")
        .select("id,case_id,shipment_id,kottaj_number,customs_path,customs_regime,created_at")
        .eq("organization_id", organizationId)
        .in("id", declarationIds);
      if (declarationError) throw declarationError;
      const declarationRows = (declarations || []) as DeclarationRow[];
      const caseIds = [...new Set(declarationRows.map((row) => row.case_id).filter((id): id is string => Boolean(id)))];
      const shipmentIds = [...new Set(declarationRows.map((row) => row.shipment_id).filter((id): id is string => Boolean(id)))];

      const [shipmentById, shipmentByCase, caseResult, checklistResult] = await Promise.all([
        shipmentIds.length
          ? supabase.from("shipments").select("id,case_id,client_id,display_name,bill_of_lading_no").eq("organization_id", organizationId).in("id", shipmentIds)
          : Promise.resolve({ data: [], error: null } as any),
        caseIds.length
          ? supabase.from("shipments").select("id,case_id,client_id,display_name,bill_of_lading_no").eq("organization_id", organizationId).in("case_id", caseIds).order("created_at", { ascending: false }).limit(1000)
          : Promise.resolve({ data: [], error: null } as any),
        caseIds.length
          ? supabase.from("cases").select("id,case_number,client_id").eq("organization_id", organizationId).in("id", caseIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from("declaration_checklist_items")
          .select("id,declaration_id,item_label,note")
          .eq("organization_id", organizationId)
          .in("declaration_id", declarationIds)
          .eq("source", "manual")
          .eq("is_active", true)
          .eq("completed", false),
      ]);
      for (const result of [shipmentById, shipmentByCase, caseResult, checklistResult]) {
        if (result.error) throw result.error;
      }

      const shipments = [...(shipmentById.data || []), ...(shipmentByCase.data || [])] as ShipmentRow[];
      const uniqueShipments = [...new Map(shipments.map((row) => [row.id, row])).values()];
      const cases = (caseResult.data || []) as CaseRow[];
      const checklistItems = (checklistResult.data || []) as ChecklistRow[];
      const clientIds = [...new Set([
        ...uniqueShipments.map((row) => row.client_id),
        ...cases.map((row) => row.client_id),
      ].filter((id): id is string => Boolean(id)))];

      const [clientResult, permitResult] = await Promise.all([
        clientIds.length
          ? supabase.from("clients").select("id,name").eq("organization_id", organizationId).in("id", clientIds)
          : Promise.resolve({ data: [], error: null } as any),
        caseIds.length
          ? supabase.from("permits").select("id,case_id,permit_type,permit_number,issuing_authority").eq("organization_id", organizationId).in("case_id", caseIds).eq("status", "pending")
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (clientResult.error) throw clientResult.error;
      if (permitResult.error) throw permitResult.error;

      const clientMap = new Map((clientResult.data || []).map((row: ClientRow) => [row.id, row.name] as const));
      const caseMap = new Map(cases.map((row) => [row.id, row] as const));
      const shipmentMap = new Map(uniqueShipments.map((row) => [row.id, row] as const));
      const workflowByDeclaration = new Map(workflowRows.map((row) => [row.declaration_id, row] as const));
      const checklistByDeclaration = new Map<string, ChecklistRow[]>();
      for (const row of checklistItems) {
        checklistByDeclaration.set(row.declaration_id, [...(checklistByDeclaration.get(row.declaration_id) || []), row]);
      }
      const permitsByCase = new Map<string, PermitRow[]>();
      const latestDeclarationByCase = new Map<string, DeclarationRow>();
      for (const declaration of [...declarationRows].sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))) {
        if (declaration.case_id && !latestDeclarationByCase.has(declaration.case_id)) {
          latestDeclarationByCase.set(declaration.case_id, declaration);
        }
      }
      for (const row of (permitResult.data || []) as PermitRow[]) {
        permitsByCase.set(row.case_id, [...(permitsByCase.get(row.case_id) || []), row]);
      }

      const nextGroups: ReportGroup[] = [];
      for (const declaration of declarationRows) {
        const workflow = workflowByDeclaration.get(declaration.id);
        if (!workflow) continue;
        const caseRow = declaration.case_id ? caseMap.get(declaration.case_id) : undefined;
        const shipment = (declaration.shipment_id ? shipmentMap.get(declaration.shipment_id) : undefined)
          || uniqueShipments.find((row) => row.case_id === declaration.case_id);
        const clientId = shipment?.client_id || caseRow?.client_id || null;
        const clientName = clientId ? clientMap.get(clientId) || "صاحب کالا نامشخص" : "صاحب کالا ثبت نشده";
        const shipmentName = shipment?.display_name || "محموله بدون عنوان";
        const href = declaration.shipment_id
          ? "/operations?tab=declaration&shipmentId=" + encodeURIComponent(declaration.shipment_id)
          : declaration.case_id
            ? "/cases?caseId=" + encodeURIComponent(declaration.case_id)
            : "/operations";
        const items: ReportItem[] = [];

        const workflowTasks: CustomsWorkflowPendingTask[] = buildCustomsWorkflowPendingTasks({
          ...workflow,
          customs_path: declaration.customs_path,
        }, declaration.customs_path);
        for (const task of workflowTasks) {
          items.push({
            id: task.id,
            declarationId: declaration.id,
            title: task.title,
            detail: task.stageLabel,
            stage: task.stage,
            priority: task.priority,
            href,
            source: "workflow",
          });
        }

        for (const item of checklistByDeclaration.get(declaration.id) || []) {
          items.push({
            id: "checklist:" + item.id,
            declarationId: declaration.id,
            title: item.item_label,
            detail: item.note ? "توضیح: " + item.note : "چک‌لیست دستی",
            stage: "checklist",
            priority: "normal",
            href,
            source: "checklist",
          });
        }

        const isLatestCaseDeclaration = !declaration.case_id || latestDeclarationByCase.get(declaration.case_id)?.id === declaration.id;
        for (const permit of (isLatestCaseDeclaration && declaration.case_id ? permitsByCase.get(declaration.case_id) || [] : [])) {
          items.push({
            id: "permit:" + permit.id,
            declarationId: declaration.id,
            title: "مجوز در انتظار: " + permit.permit_type,
            detail: [permit.issuing_authority, permit.permit_number].filter(Boolean).join(" · ") || "مرجع ثبت نشده",
            stage: "permits",
            priority: "normal",
            href,
            source: "permit",
          });
        }

        if (items.length) {
          nextGroups.push({
            declarationId: declaration.id,
            shipmentName,
            billOfLading: shipment?.bill_of_lading_no || "بارنامه ثبت نشده",
            clientName,
            caseNumber: caseRow?.case_number || "شماره پرونده ثبت نشده",
            kottaj: declaration.kottaj_number || "کوتاژ ثبت نشده",
            regime: declaration.customs_regime,
            href,
            items,
          });
        }
      }
      setGroups(nextGroups);
      setRefreshedAt(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "دریافت گزارش کارهای باز گمرکی ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, allowed]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const items = groups.flatMap((group) => group.items);
    return {
      tasks: items.length,
      shipments: groups.length,
      urgent: items.filter((item) => item.priority === "urgent").length,
      workflow: items.filter((item) => item.source === "workflow").length,
      checklist: items.filter((item) => item.source === "checklist").length,
      permits: items.filter((item) => item.source === "permit").length,
    };
  }, [groups]);

  if (!allowed) return <main dir="rtl" className="p-6">دسترسی به گزارش عملیات گمرکی برای این نقش فعال نیست.</main>;

  return (
    <main dir="rtl" className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold tracking-wide app-muted">CUSTOMS OPERATIONS · DAILY OPEN ITEMS</div>
            <h1 className="mt-1 text-2xl font-black">گزارش کارهای انجام‌نشده گمرکی</h1>
            <p className="mt-1 text-sm app-muted">فعالیت‌های باز، مجوزهای معوق و موارد دستی چک‌لیست در یک گزارش تجمیع شده‌اند.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-50">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""}/> تازه‌سازی
          </button>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">کل موارد باز</div><b className="mt-1 block text-xl">{faNumber(stats.tasks)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">محموله‌های درگیر</div><b className="mt-1 block text-xl">{faNumber(stats.shipments)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">مهلت‌های فوری</div><b className="mt-1 block text-xl">{faNumber(stats.urgent)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">فعالیت‌های عملیات</div><b className="mt-1 block text-xl">{faNumber(stats.workflow)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">مجوز / چک‌لیست دستی</div><b className="mt-1 block text-xl">{faNumber(stats.permits + stats.checklist)}</b></div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</div>}
        <div className="text-xs app-muted">
          {refreshedAt ? "آخرین به‌روزرسانی: " + refreshedAt.toLocaleString("fa-IR") : "گزارش هنوز به‌روزرسانی نشده است"}
          {" · "}این گزارش فقط وضعیت‌های ذخیره‌شده را می‌خواند؛ انجام یادآور به‌معنای تکمیل فعالیت یا مجوز نیست.
        </div>

        {loading ? (
          <div className="rounded-xl border app-border bg-[var(--surface)] p-10 text-center app-muted">در حال جمع‌آوری وضعیت محموله‌ها و فعالیت‌ها…</div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border app-border bg-[var(--surface)] p-10 text-center">
            <div className="font-black">در حال حاضر کار باز گمرکی ثبت نشده است.</div>
            <p className="mt-2 text-sm app-muted">این نتیجه بر اساس گردش‌کارهای ثبت‌شده و موارد دستی/مجوزهای معوق قابل مشاهده برای سازمان فعلی است.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <article key={group.declarationId} className="overflow-hidden rounded-xl border app-border bg-[var(--surface)]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b app-border p-4">
                  <div className="min-w-0">
                    <div className="font-black">{group.shipmentName}</div>
                    <div className="mt-1 text-xs app-muted">{group.clientName} · {group.billOfLading} · {regimeLabel(group.regime)}</div>
                    <div className="mt-1 text-xs app-muted">پرونده: {group.caseNumber} · کوتاژ: {group.kottaj}</div>
                  </div>
                  <Link to={group.href} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white">بازکردن عملیات <ArrowUpRight size={14}/></Link>
                </div>
                <div className="divide-y app-border">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-start gap-3 p-3">
                      <div className={"mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg " + (item.priority === "urgent" ? "bg-red-500/10 text-red-600" : "bg-[var(--surface-2)] app-muted")}>
                        {item.priority === "urgent" ? <AlertTriangle size={16}/> : <Clock3 size={16}/>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className="mt-1 text-xs app-muted">{item.detail} · {item.source === "workflow" ? "فعالیت عملیات" : item.source === "permit" ? "مجوز" : "چک‌لیست دستی"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="flex justify-end"><Link to="/operations" className="text-sm app-muted">بازگشت به عملیات گمرکی</Link></div>
      </div>
    </main>
  );
};


export default CustomsPendingReportPage;
