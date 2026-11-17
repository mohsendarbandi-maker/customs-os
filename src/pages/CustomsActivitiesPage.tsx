import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, Bell, CalendarDays, ChevronDown, Clock3,
  FilePlus2, History, Link2, LoaderCircle, Plus, RefreshCw, Save, Trash2,
  UserRound, X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { AddReminderButton } from "../features/reminders/AddReminderButton";

type ActivityStatus = "open" | "in_progress" | "waiting" | "blocked" | "completed" | "cancelled";
type ActivityPriority = "low" | "normal" | "high" | "urgent";
type CustomsActivity = {
  id: string;
  organization_id: string;
  declaration_id: string | null;
  shipment_id: string | null;
  activity_type: string;
  title: string;
  description: string | null;
  status: ActivityStatus;
  priority: ActivityPriority;
  assignee_id: string | null;
  starts_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
type DeclarationOption = { id: string; kottaj_number: string; shipment_id: string | null; customs_regime: string | null };
type ShipmentOption = { id: string; display_name: string | null; bill_of_lading_no: string | null; client_id: string | null };
type StaffOption = { id: string; full_name: string | null; role: string };
type ActivityEvent = { id: string; event_type: string; changed_fields: string[]; previous_snapshot: Record<string, unknown> | null; snapshot: Record<string, unknown>; actor_id: string | null; created_at: string };
type ActivityAttachment = { id: string; file_asset_id: string; label: string | null; document_type: string; created_at: string };
type FileOption = { id: string; file_asset_id: string; original_name: string; document_type: string | null; shipment_id: string | null };
type ActivityDependency = { id: string; prerequisite_activity_id: string; blocked_activity_id: string; reason: string | null };
type ActivityCost = { id: string; description: string; amount: string | number; currency: string; workflow_status: string; customs_activity_id: string | null };

const statusLabels: Record<ActivityStatus, string> = {
  open: "باز",
  in_progress: "در حال انجام",
  waiting: "در انتظار",
  blocked: "مسدود",
  completed: "انجام‌شده",
  cancelled: "لغوشده",
};
const priorityLabels: Record<ActivityPriority, string> = {
  low: "کم",
  normal: "عادی",
  high: "زیاد",
  urgent: "فوری",
};
const activityTypeLabels: Record<string, string> = {
  general: "فعالیت عمومی",
  document: "بررسی اسناد",
  permit: "مجوز و مجوزها",
  finance: "امور مالی",
  inspection: "بازرسی",
  warehouse: "انبار و بارگیری",
  transport: "حمل و خروج",
  other: "سایر",
};
const eventLabels: Record<string, string> = {
  created: "ایجاد فعالیت",
  updated: "ویرایش فعالیت",
  status_changed: "تغییر وضعیت",
  assignee_changed: "تغییر مسئول",
  deadline_changed: "تغییر موعد",
  dependency_added: "ثبت وابستگی",
  dependency_removed: "حذف وابستگی",
  attachment_added: "پیوست سند موجود",
  attachment_removed: "حذف پیوند سند",
  cost_linked: "اتصال هزینه موجود",
  cost_unlinked: "قطع اتصال هزینه",
  reminder_linked: "اتصال یادآور",
  reminder_unlinked: "قطع اتصال یادآور",
};
const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "بدون موعد";
const toDateTimeLocal = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromDateTimeLocal = (value: string) => value ? new Date(value).toISOString() : null;
const faNumber = (value: number) => value.toLocaleString("fa-IR");
const isFinanceRole = (role: string) => ["owner", "admin", "accountant"].includes(role);

export const CustomsActivitiesPage: React.FC = () => {
  const { user, profile } = useAuth();
  const organizationId = profile?.organization_id || "";
  const role = String(profile?.role || "");
  const canWrite = ["owner", "admin", "broker", "warehouse"].includes(role);
  const canLinkFinance = isFinanceRole(role);
  const [activities, setActivities] = useState<CustomsActivity[]>([]);
  const [declarations, setDeclarations] = useState<DeclarationOption[]>([]);
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ActivityStatus>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newShipmentId, setNewShipmentId] = useState("");
  const [newDeclarationId, setNewDeclarationId] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [newStartAt, setNewStartAt] = useState("");
  const [newPriority, setNewPriority] = useState<ActivityPriority>("normal");
  const [newActivityType, setNewActivityType] = useState("general");
  const [expandedId, setExpandedId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([]);
  const [availableFiles, setAvailableFiles] = useState<FileOption[]>([]);
  const [dependencies, setDependencies] = useState<ActivityDependency[]>([]);
  const [costs, setCosts] = useState<ActivityCost[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [selectedPrerequisiteId, setSelectedPrerequisiteId] = useState("");
  const [dependencyReason, setDependencyReason] = useState("");

  const shipmentMap = useMemo(() => new Map(shipments.map((item) => [item.id, item])), [shipments]);
  const declarationMap = useMemo(() => new Map(declarations.map((item) => [item.id, item])), [declarations]);
  const staffMap = useMemo(() => new Map(staff.map((item) => [item.id, item])), [staff]);
  const visibleActivities = useMemo(() => {
    const rows = statusFilter === "all" ? activities : activities.filter((item) => item.status === statusFilter);
    return [...rows].sort((a, b) => {
      const aDue = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER;
      const bDue = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER;
      return aDue - bDue || Date.parse(b.updated_at) - Date.parse(a.updated_at);
    });
  }, [activities, statusFilter]);

  const load = useCallback(async () => {
    if (!organizationId) {
      setActivities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [activityResult, declarationResult, shipmentResult, staffResult] = await Promise.all([
      supabase.from("customs_activities").select("*").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(1000),
      supabase.from("customs_declarations").select("id,kottaj_number,shipment_id,customs_regime").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1000),
      supabase.from("shipments").select("id,display_name,bill_of_lading_no,client_id").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1000),
      supabase.from("profiles").select("id,full_name,role").eq("organization_id", organizationId).eq("is_active", true).neq("role", "client").order("full_name"),
    ]);
    const failure = [activityResult, declarationResult, shipmentResult, staffResult].find((result) => result.error);
    if (failure?.error) {
      setError(failure.error.message || "دریافت فعالیت‌های گمرکی ناموفق بود.");
      setLoading(false);
      return;
    }
    setActivities((activityResult.data || []) as CustomsActivity[]);
    setDeclarations((declarationResult.data || []) as DeclarationOption[]);
    setShipments((shipmentResult.data || []) as ShipmentOption[]);
    setStaff((staffResult.data || []) as StaffOption[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const refreshDetails = useCallback(async (activity: CustomsActivity) => {
    if (!organizationId) return;
    setDetailLoading(true);
    setError("");
    const [eventResult, attachmentResult, fileResult, dependencyResult, costResult] = await Promise.all([
      supabase.from("customs_activity_events")
        .select("id,event_type,changed_fields,previous_snapshot,snapshot,actor_id,created_at")
        .eq("organization_id", organizationId).eq("activity_id", activity.id)
        .order("created_at", { ascending: false }).limit(40),
      supabase.from("customs_activity_attachments")
        .select("id,file_asset_id,label,document_type,created_at")
        .eq("organization_id", organizationId).eq("activity_id", activity.id)
        .order("created_at", { ascending: false }),
      activity.shipment_id
        ? supabase.from("file_manager_files")
            .select("id,file_asset_id,original_name,document_type,shipment_id")
            .eq("organization_id", organizationId).eq("shipment_id", activity.shipment_id)
            .not("file_asset_id", "is", null).order("created_at", { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null } as any),
      supabase.from("customs_activity_dependencies")
        .select("id,prerequisite_activity_id,blocked_activity_id,reason")
        .eq("organization_id", organizationId)
        .or("prerequisite_activity_id.eq." + activity.id + ",blocked_activity_id.eq." + activity.id),
      canLinkFinance && activity.shipment_id
        ? supabase.from("finance_cost_items")
            .select("id,description,amount,currency,workflow_status,customs_activity_id")
            .eq("organization_id", organizationId).eq("shipment_id", activity.shipment_id)
            .is("deleted_at", null).order("created_at", { ascending: false }).limit(300)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    const failed = [eventResult, attachmentResult, fileResult, dependencyResult].find((result) => result.error);
    if (failed?.error) {
      setError(failed.error.message || "دریافت جزئیات فعالیت ناموفق بود.");
    }
    setEvents((eventResult.data || []) as ActivityEvent[]);
    setAttachments((attachmentResult.data || []) as ActivityAttachment[]);
    setAvailableFiles((fileResult.data || []) as FileOption[]);
    setDependencies((dependencyResult.data || []) as ActivityDependency[]);
    if (costResult.error && canLinkFinance) {
      setNotice("دسترسی به فهرست هزینه‌ها از سیاست‌های مالی دیتابیس پیروی می‌کند.");
      setCosts([]);
    } else {
      setCosts((costResult.data || []) as ActivityCost[]);
    }
    setDetailLoading(false);
  }, [organizationId, canLinkFinance]);

  const updateActivity = async (activity: CustomsActivity, patch: Partial<CustomsActivity>) => {
    if (!canWrite || !user) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("customs_activities")
        .update({ ...patch, updated_by: user.id })
        .eq("id", activity.id)
        .eq("organization_id", organizationId)
        .eq("version", activity.version)
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("این فعالیت در نشست دیگری تغییر کرده است. اطلاعات تازه را دریافت و دوباره اقدام کنید.");
      setActivities((current) => current.map((item) => item.id === activity.id ? data as CustomsActivity : item));
      setNotice("تغییر فعالیت ذخیره شد.");
      if (expandedId === activity.id) await refreshDetails(data as CustomsActivity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ذخیره تغییر فعالیت انجام نشد.");
    } finally {
      setSaving(false);
    }
  };

  const createActivity = async () => {
    if (!canWrite || !user || !newTitle.trim()) return;
    if (!newShipmentId && !newDeclarationId) {
      setError("برای فعالیت، محموله یا اظهارنامه را انتخاب کنید.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: insertError } = await supabase.from("customs_activities").insert({
        organization_id: organizationId,
        shipment_id: newShipmentId || null,
        declaration_id: newDeclarationId || null,
        activity_type: newActivityType,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        status: "open",
        priority: newPriority,
        assignee_id: newAssigneeId || null,
        starts_at: fromDateTimeLocal(newStartAt),
        due_at: fromDateTimeLocal(newDueAt),
        source: "manual",
        created_by: user.id,
        updated_by: user.id,
      });
      if (insertError) throw insertError;
      setNewTitle("");
      setNewDescription("");
      setNewShipmentId("");
      setNewDeclarationId("");
      setNewAssigneeId("");
      setNewDueAt("");
      setNewStartAt("");
      setNewPriority("normal");
      setNewActivityType("general");
      setCreateOpen(false);
      setNotice("فعالیت مستقل ثبت شد.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ثبت فعالیت گمرکی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDetails = async (activity: CustomsActivity) => {
    if (expandedId === activity.id) {
      setExpandedId("");
      return;
    }
    setExpandedId(activity.id);
    setSelectedFileId("");
    setSelectedPrerequisiteId("");
    setDependencyReason("");
    await refreshDetails(activity);
  };

  const attachExistingFile = async (activity: CustomsActivity) => {
    if (!user || !selectedFileId) return;
    const file = availableFiles.find((item) => item.id === selectedFileId);
    if (!file?.file_asset_id) return;
    setSaving(true);
    setError("");
    try {
      const { error: attachError } = await supabase.from("customs_activity_attachments").insert({
        organization_id: organizationId,
        activity_id: activity.id,
        file_asset_id: file.file_asset_id,
        label: file.original_name,
        document_type: "other",
        added_by: user.id,
      });
      if (attachError) throw attachError;
      setSelectedFileId("");
      setNotice("سند موجود به فعالیت متصل شد؛ فایل دوباره آپلود نشد.");
      await refreshDetails(activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "اتصال سند ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const detachFile = async (attachment: ActivityAttachment, activity: CustomsActivity) => {
    setSaving(true);
    setError("");
    try {
      const { error: deleteError } = await supabase.from("customs_activity_attachments")
        .delete().eq("id", attachment.id).eq("organization_id", organizationId);
      if (deleteError) throw deleteError;
      await refreshDetails(activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "حذف پیوند سند ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const addDependency = async (activity: CustomsActivity) => {
    if (!user || !selectedPrerequisiteId || selectedPrerequisiteId === activity.id) return;
    setSaving(true);
    setError("");
    try {
      const { error: dependencyError } = await supabase.from("customs_activity_dependencies").insert({
        organization_id: organizationId,
        prerequisite_activity_id: selectedPrerequisiteId,
        blocked_activity_id: activity.id,
        reason: dependencyReason.trim() || null,
        created_by: user.id,
      });
      if (dependencyError) throw dependencyError;
      setSelectedPrerequisiteId("");
      setDependencyReason("");
      setNotice("وابستگی واقعی ثبت شد. تکمیل این فعالیت تا تکمیل پیش‌نیاز مجاز نخواهد بود.");
      await refreshDetails(activity);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(message.includes("CUSTOMS_ACTIVITY_DEPENDENCY_CYCLE")
        ? "این وابستگی چرخه ایجاد می‌کند و ثبت نشد."
        : message || "ثبت وابستگی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const removeDependency = async (dependency: ActivityDependency, activity: CustomsActivity) => {
    setSaving(true);
    setError("");
    try {
      const { error: removeError } = await supabase.from("customs_activity_dependencies")
        .delete().eq("id", dependency.id).eq("organization_id", organizationId);
      if (removeError) throw removeError;
      await refreshDetails(activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "حذف وابستگی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const linkCost = async (cost: ActivityCost, activity: CustomsActivity) => {
    if (!canLinkFinance || !user) return;
    setSaving(true);
    setError("");
    try {
      const { data, error: linkError } = await supabase.from("finance_cost_items")
        .update({ customs_activity_id: activity.id, updated_by: user.id })
        .eq("id", cost.id).eq("organization_id", organizationId)
        .is("customs_activity_id", null)
        .select("id").maybeSingle();
      if (linkError) throw linkError;
      if (!data) throw new Error("هزینه قبلاً به فعالیت دیگری متصل شده یا تغییر کرده است.");
      setNotice("هزینه موجود به فعالیت متصل شد؛ رکورد مالی جدیدی ساخته نشد.");
      await refreshDetails(activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "اتصال هزینه ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  const unlinkCost = async (cost: ActivityCost, activity: CustomsActivity) => {
    if (!canLinkFinance || !user) return;
    setSaving(true);
    setError("");
    try {
      const { error: unlinkError } = await supabase.from("finance_cost_items")
        .update({ customs_activity_id: null, updated_by: user.id })
        .eq("id", cost.id).eq("organization_id", organizationId)
        .eq("customs_activity_id", activity.id);
      if (unlinkError) throw unlinkError;
      await refreshDetails(activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "قطع اتصال هزینه ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  if (!["owner", "admin", "broker", "warehouse", "accountant"].includes(role)) {
    return <main dir="rtl" className="p-6">دسترسی به فعالیت‌های گمرکی برای این نقش فعال نیست.</main>;
  }

  const totalOpen = activities.filter((item) => !["completed", "cancelled"].includes(item.status)).length;
  const overdue = activities.filter((item) => item.due_at && Date.parse(item.due_at) < Date.now() && !["completed", "cancelled"].includes(item.status)).length;
  const unassigned = activities.filter((item) => !item.assignee_id && !["completed", "cancelled"].includes(item.status)).length;

  return (
    <main dir="rtl" className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold tracking-wide app-muted">CUSTOMS OS · INDEPENDENT ACTIVITIES</div>
            <h1 className="mt-1 text-2xl font-black">فعالیت‌های مستقل گمرکی</h1>
            <p className="mt-1 text-sm app-muted">هر فعالیت مسئول، موعد، وضعیت، تاریخچه و پیوندهای مستقل دارد؛ ترتیب مراحل به‌صورت اجباری تحمیل نمی‌شود.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} disabled={loading || saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-50">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""}/> تازه‌سازی
            </button>
            {canWrite && <button type="button" onClick={() => setCreateOpen((open) => !open)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white">
              {createOpen ? <X size={16}/> : <Plus size={16}/>} {createOpen ? "بستن فرم" : "فعالیت جدید"}
            </button>}
          </div>
        </header>

        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">فعالیت‌های باز</div><b className="mt-1 block text-xl">{faNumber(totalOpen)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">عقب‌افتاده</div><b className="mt-1 block text-xl">{faNumber(overdue)}</b></div>
          <div className="rounded-xl border app-border bg-[var(--surface)] p-3"><div className="text-xs app-muted">بدون مسئول</div><b className="mt-1 block text-xl">{faNumber(unassigned)}</b></div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
        {notice && <div role="status" className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{notice}</div>}

        {createOpen && canWrite && (
          <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 space-y-3">
            <div className="flex items-center gap-2 font-black"><Plus size={17}/> ثبت فعالیت مستقل</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs app-muted">عنوان فعالیت
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={240} className="input mt-1 w-full" placeholder="مثلاً پیگیری مجوز استاندارد"/>
              </label>
              <label className="text-xs app-muted">محموله
                <select value={newShipmentId} onChange={(event) => setNewShipmentId(event.target.value)} className="input mt-1 w-full">
                  <option value="">انتخاب محموله (اختیاری در صورت انتخاب اظهارنامه)</option>
                  {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.display_name || "محموله بدون عنوان"} · {shipment.bill_of_lading_no || "بدون بارنامه"}</option>)}
                </select>
              </label>
              <label className="text-xs app-muted">اظهارنامه
                <select value={newDeclarationId} onChange={(event) => {
                  const id = event.target.value;
                  setNewDeclarationId(id);
                  const declaration = declarations.find((item) => item.id === id);
                  if (declaration?.shipment_id) setNewShipmentId(declaration.shipment_id);
                }} className="input mt-1 w-full">
                  <option value="">انتخاب اظهارنامه (اختیاری در صورت انتخاب محموله)</option>
                  {declarations.map((item) => <option key={item.id} value={item.id}>کوتاژ {item.kottaj_number} · {item.customs_regime || "رویه نامشخص"}</option>)}
                </select>
              </label>
              <label className="text-xs app-muted">مسئول
                <select value={newAssigneeId} onChange={(event) => setNewAssigneeId(event.target.value)} className="input mt-1 w-full">
                  <option value="">بدون مسئول</option>
                  {staff.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.role} · {person.role}</option>)}
                </select>
              </label>
              <label className="text-xs app-muted">زمان شروع
                <input type="datetime-local" value={newStartAt} onChange={(event) => setNewStartAt(event.target.value)} className="input mt-1 w-full" dir="ltr"/>
              </label>
              <label className="text-xs app-muted">موعد انجام
                <input type="datetime-local" value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} className="input mt-1 w-full" dir="ltr"/>
              </label>
              <label className="text-xs app-muted">اولویت
                <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as ActivityPriority)} className="input mt-1 w-full">
                  {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs app-muted">نوع فعالیت
                <select value={newActivityType} onChange={(event) => setNewActivityType(event.target.value)} className="input mt-1 w-full">
                  {Object.entries(activityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs app-muted md:col-span-2">توضیحات
                <textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} rows={2} className="input mt-1 w-full" placeholder="شرح، نتیجه مورد انتظار یا نکات اجرایی"/>
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={saving || !newTitle.trim() || (!newShipmentId && !newDeclarationId)} onClick={() => void createActivity()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-white disabled:opacity-50">
                {saving ? <LoaderCircle size={16} className="animate-spin"/> : <Save size={16}/>} ثبت فعالیت
              </button>
            </div>
          </section>
        )}

        <section className="flex flex-wrap items-center gap-2">
          <span className="text-xs app-muted">فیلتر وضعیت:</span>
          {(["all","open","in_progress","waiting","blocked","completed","cancelled"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setStatusFilter(value)} className={"rounded-full border px-3 py-1.5 text-xs font-semibold " + (statusFilter === value ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "app-border bg-[var(--surface)]")}>
              {value === "all" ? "همه" : statusLabels[value]}
            </button>
          ))}
        </section>

        {loading ? (
          <div className="rounded-xl border app-border bg-[var(--surface)] p-10 text-center app-muted"><LoaderCircle size={20} className="mx-auto mb-2 animate-spin"/>در حال دریافت فعالیت‌ها…</div>
        ) : visibleActivities.length === 0 ? (
          <div className="rounded-xl border app-border bg-[var(--surface)] p-10 text-center">
            <Activity size={28} className="mx-auto mb-2 app-muted"/>
            <div className="font-black">فعالیتی در این وضعیت ثبت نشده است.</div>
            <p className="mt-1 text-sm app-muted">فعالیت مستقل را ثبت کنید؛ فعالیت‌های ثبت‌شده در گردش‌کار قبلی بدون تغییر باقی می‌مانند.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleActivities.map((activity) => {
              const shipment = activity.shipment_id ? shipmentMap.get(activity.shipment_id) : null;
              const declaration = activity.declaration_id ? declarationMap.get(activity.declaration_id) : null;
              const assignee = activity.assignee_id ? staffMap.get(activity.assignee_id) : null;
              const isOverdue = Boolean(activity.due_at && Date.parse(activity.due_at) < Date.now() && !["completed","cancelled"].includes(activity.status));
              const detailOpen = expandedId === activity.id;
              return (
                <article key={activity.id} className="overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
                  <div className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-black">{activity.title}</h2>
                          <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[10px] font-semibold">{activityTypeLabels[activity.activity_type] || activity.activity_type}</span>
                          <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[10px] font-semibold">{priorityLabels[activity.priority]}</span>
                          {isOverdue && <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-600">عقب‌افتاده</span>}
                        </div>
                        <div className="mt-1 text-xs app-muted">
                          {shipment?.display_name || "محموله بدون عنوان"} · {shipment?.bill_of_lading_no || "بارنامه ثبت نشده"}
                          {declaration ? " · کوتاژ " + declaration.kottaj_number : ""}
                        </div>
                        {activity.description && <p className="mt-2 whitespace-pre-wrap text-sm app-muted">{activity.description}</p>}
                      </div>
                      <button type="button" onClick={() => void toggleDetails(activity)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border app-border px-3 text-xs font-bold">
                        {detailOpen ? "بستن جزئیات" : "جزئیات و پیوندها"} <ChevronDown size={15} className={detailOpen ? "rotate-180" : ""}/>
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="flex items-center gap-2 text-xs app-muted"><UserRound size={15}/>{assignee?.full_name || "بدون مسئول"}</div>
                      <div className={"flex items-center gap-2 text-xs " + (isOverdue ? "text-red-600" : "app-muted")}><CalendarDays size={15}/>{dateLabel(activity.due_at)}</div>
                      <div className="flex items-center gap-2 text-xs app-muted"><Clock3 size={15}/>آخرین تغییر: {dateLabel(activity.updated_at)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[11px] app-muted">وضعیت</label>
                      <select disabled={!canWrite || saving} value={activity.status} onChange={(event) => void updateActivity(activity, { status: event.target.value as ActivityStatus })} className="input min-h-9 w-auto text-xs">
                        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {canWrite && <label className="text-[11px] app-muted">مسئول</label>}
                      {canWrite && <select disabled={saving} value={activity.assignee_id || ""} onChange={(event) => void updateActivity(activity, { assignee_id: event.target.value || null })} className="input min-h-9 w-auto text-xs">
                        <option value="">بدون مسئول</option>
                        {staff.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.role}</option>)}
                      </select>}
                    </div>
                  </div>

                  {detailOpen && (
                    <section className="border-t app-border bg-[var(--surface-2)]/40 p-4 space-y-4">
                      {detailLoading ? <div className="text-sm app-muted">در حال دریافت تاریخچه و پیوندها…</div> : (
                        <>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                              <div className="flex items-center gap-2 font-bold text-sm"><CalendarDays size={16}/> برنامه زمانی</div>
                              <label className="block text-xs app-muted">زمان شروع
                                <input type="datetime-local" disabled={!canWrite || saving} defaultValue={toDateTimeLocal(activity.starts_at)} onBlur={(event) => {
                                  const next = fromDateTimeLocal(event.currentTarget.value);
                                  if (next !== activity.starts_at) void updateActivity(activity, { starts_at: next });
                                }} className="input mt-1 w-full" dir="ltr"/>
                              </label>
                              <label className="block text-xs app-muted">موعد
                                <input type="datetime-local" disabled={!canWrite || saving} defaultValue={toDateTimeLocal(activity.due_at)} onBlur={(event) => {
                                  const next = fromDateTimeLocal(event.currentTarget.value);
                                  if (next !== activity.due_at) void updateActivity(activity, { due_at: next });
                                }} className="input mt-1 w-full" dir="ltr"/>
                              </label>
                            </div>
                            <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                              <div className="flex items-center gap-2 font-bold text-sm"><Bell size={16}/> یادآور مرتبط</div>
                              <p className="text-xs app-muted">یادآور از سیستم فعلی ساخته می‌شود و به همین فعالیت متصل خواهد بود؛ وضعیت یادآور جایگزین وضعیت فعالیت نیست.</p>
                              <AddReminderButton entityType="customs_activities" entityId={activity.id} defaultTitle={"پیگیری: " + activity.title}/>
                            </div>
                          </div>

                          <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                            <div className="flex items-center gap-2 font-bold text-sm"><FilePlus2 size={16}/> اسناد پیوست‌شده از File Manager</div>
                            <p className="text-xs app-muted">فقط فایل‌های موجود انتخاب می‌شوند؛ انتقال فایل یا آپلود مجدد لازم نیست.</p>
                            {canWrite && availableFiles.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                <select value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)} className="input min-w-0 flex-1 text-xs">
                                  <option value="">انتخاب سند موجود از همین محموله</option>
                                  {availableFiles.filter((file) => !attachments.some((item) => item.file_asset_id === file.file_asset_id)).map((file) => <option key={file.id} value={file.id}>{file.original_name}</option>)}
                                </select>
                                <button type="button" disabled={!selectedFileId || saving} onClick={() => void attachExistingFile(activity)} className="rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white">اتصال سند</button>
                              </div>
                            )}
                            {attachments.length === 0 ? <div className="text-xs app-muted">هنوز سندی به این فعالیت متصل نشده است.</div> : (
                              <div className="space-y-2">
                                {attachments.map((attachment) => {
                                  const file = availableFiles.find((item) => item.file_asset_id === attachment.file_asset_id);
                                  return <div key={attachment.id} className="flex items-center gap-2 rounded-lg border app-border p-2 text-xs">
                                    <FilePlus2 size={15}/><span className="min-w-0 flex-1 truncate">{attachment.label || file?.original_name || "سند پیوست‌شده"}</span>
                                    {canWrite && <button type="button" disabled={saving} onClick={() => void detachFile(attachment, activity)} aria-label="قطع پیوند سند" className="rounded-md p-1 text-red-600"><Trash2 size={14}/></button>}
                                  </div>;
                                })}
                              </div>
                            )}
                            {activity.shipment_id && <a href={"/file-manager?shipmentId=" + encodeURIComponent(activity.shipment_id)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]">بازکردن File Manager <Link2 size={13}/></a>}
                          </div>

                          <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                            <div className="flex items-center gap-2 font-bold text-sm"><Link2 size={16}/> وابستگی‌های واقعی</div>
                            <p className="text-xs app-muted">هیچ وابستگی خودکاری ساخته نمی‌شود. فقط پیش‌نیازهایی را اضافه کنید که واقعاً مانع تکمیل این فعالیت هستند.</p>
                            {canWrite && (
                              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                <select value={selectedPrerequisiteId} onChange={(event) => setSelectedPrerequisiteId(event.target.value)} className="input text-xs">
                                  <option value="">انتخاب پیش‌نیاز</option>
                                  {activities.filter((item) => item.id !== activity.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                                </select>
                                <input value={dependencyReason} onChange={(event) => setDependencyReason(event.target.value)} className="input text-xs" placeholder="دلیل وابستگی (اختیاری)"/>
                                <button type="button" disabled={!selectedPrerequisiteId || saving} onClick={() => void addDependency(activity)} className="rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white">افزودن</button>
                              </div>
                            )}
                            {dependencies.length === 0 ? <div className="text-xs app-muted">وابستگی ثبت نشده است.</div> : (
                              <div className="space-y-2">
                                {dependencies.map((dependency) => {
                                  const prerequisite = activities.find((item) => item.id === dependency.prerequisite_activity_id);
                                  const blocked = activities.find((item) => item.id === dependency.blocked_activity_id);
                                  const currentIsBlocked = dependency.blocked_activity_id === activity.id;
                                  return <div key={dependency.id} className="flex items-center gap-2 rounded-lg border app-border p-2 text-xs">
                                    <span className="min-w-0 flex-1">{currentIsBlocked ? "پیش‌نیاز: " + (prerequisite?.title || "فعالیت دیگر") : "این فعالیت پیش‌نیازِ: " + (blocked?.title || "فعالیت دیگر")}{dependency.reason ? " · " + dependency.reason : ""}</span>
                                    {canWrite && <button type="button" disabled={saving} onClick={() => void removeDependency(dependency, activity)} className="rounded-md p-1 text-red-600" aria-label="حذف وابستگی"><X size={14}/></button>}
                                  </div>;
                                })}
                              </div>
                            )}
                          </div>

                          {canLinkFinance && (
                            <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                              <div className="flex items-center gap-2 font-bold text-sm"><Activity size={16}/> هزینه‌های متصل از دفتر مالی</div>
                              <p className="text-xs app-muted">هزینه‌ها در همان دفتر مالی باقی می‌مانند و فقط به این فعالیت ارجاع داده می‌شوند.</p>
                              {costs.filter((cost) => cost.customs_activity_id === activity.id).map((cost) => (
                                <div key={cost.id} className="flex items-center gap-2 rounded-lg border app-border p-2 text-xs">
                                  <span className="min-w-0 flex-1">{cost.description} · {Number(cost.amount).toLocaleString("fa-IR")} {cost.currency}</span>
                                  <button type="button" disabled={saving} onClick={() => void unlinkCost(cost, activity)} className="text-red-600">قطع اتصال</button>
                                </div>
                              ))}
                              {activity.shipment_id && costs.filter((cost) => !cost.customs_activity_id).map((cost) => (
                                <div key={cost.id} className="flex items-center gap-2 rounded-lg border app-border p-2 text-xs">
                                  <span className="min-w-0 flex-1">{cost.description} · {Number(cost.amount).toLocaleString("fa-IR")} {cost.currency} · {cost.workflow_status}</span>
                                  <button type="button" disabled={saving} onClick={() => void linkCost(cost, activity)} className="font-bold text-[var(--primary)]">اتصال</button>
                                </div>
                              ))}
                              {costs.length === 0 && <div className="text-xs app-muted">هزینه قابل مشاهده‌ای برای اتصال وجود ندارد.</div>}
                            </div>
                          )}

                          <div className="rounded-xl border app-border bg-[var(--surface)] p-3 space-y-2">
                            <div className="flex items-center gap-2 font-bold text-sm"><History size={16}/> تاریخچه فعالیت</div>
                            {events.length === 0 ? <div className="text-xs app-muted">رویدادی ثبت نشده است.</div> : (
                              <div className="space-y-2">
                                {events.map((event) => (
                                  <div key={event.id} className="flex items-start gap-2 border-r-2 app-border pr-3 py-1">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-bold">{eventLabels[event.event_type] || event.event_type}</div>
                                      <div className="mt-1 text-[11px] app-muted">{dateLabel(event.created_at)} · {event.changed_fields?.join("، ") || "بدون فیلد تغییریافته"}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <div className="text-xs app-muted">ویرایش هم‌زمان با شماره نسخه کنترل می‌شود؛ تغییر قدیمی روی داده جدید نوشته نمی‌شود. تاریخچه فعالیت‌ها توسط دیتابیس ثبت می‌شود.</div>
      </div>
    </main>
  );
};

export default CustomsActivitiesPage;
