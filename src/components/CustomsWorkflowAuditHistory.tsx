import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Props = { declarationId: string; organizationId: string; userId?: string };
type EventRow = {
  id: string;
  event_type: string;
  previous_stage: string | null;
  current_stage: string;
  changed_fields: string[] | null;
  actor_id: string | null;
  created_at: string;
};

const stageLabels: Record<string, string> = {
  evaluation: 'ارزیابی', expertise: 'کارشناسی و مجوزها', cashier: 'صندوق',
  loading_permit: 'مجوز بارگیری', exit: 'درب خروج', port_charges: 'عوارض بندری',
  abandoned: 'متروکه', documents: 'اسناد', permits: 'مجوزها', declaration: 'اظهار',
  valuation: 'ارزش و تضمین', loading: 'بارگیری / جابه‌جایی', guarantee: 'تضمین',
  use_period: 'دوره استفاده / پردازش', re_export: 'خروج مجدد', completed: 'تکمیل',
};
const eventLabels: Record<string, string> = {
  created: 'ایجاد گردش‌کار', stage_changed: 'تغییر مرحله', saved: 'ذخیره اطلاعات',
};
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'زمان ثبت‌شده' : new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tehran',
  }).format(date);
};

export const CustomsWorkflowAuditHistory: React.FC<Props> = ({ declarationId, organizationId, userId }) => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!declarationId || !organizationId) { setEvents([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('customs_declaration_workflow_events')
      .select('id,event_type,previous_stage,current_stage,changed_fields,actor_id,created_at')
      .eq('declaration_id', declarationId).eq('organization_id', organizationId)
      .order('created_at', { ascending: false }).limit(10);
    if (error) { setEvents([]); setUnavailable(true); setLoading(false); return; }
    setEvents((data || []) as EventRow[]);
    setUnavailable(false);
    setLoading(false);
  }, [declarationId, organizationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-4 space-y-3">
    <header className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><History size={17}/><h3 className="font-black text-sm">سوابق ممیزی گردش‌کار</h3></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border app-border p-2" aria-label="به‌روزرسانی سوابق"><RefreshCw size={14}/></button></header>
    {loading ? <p className="text-xs app-muted">در حال دریافت سوابق...</p> : unavailable ? <p className="text-xs app-muted">نمایش سوابق در حال حاضر در دسترس نیست؛ ثبت گردش‌کار را می‌توانید ادامه دهید.</p> : events.length === 0 ? <p className="text-xs app-muted">هنوز رویدادی برای این گردش‌کار ثبت نشده است.</p> :
      <ol className="space-y-2">{events.map(event => <li key={event.id} className="rounded-xl border app-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{eventLabels[event.event_type] || 'رویداد گردش‌کار'}</b><time className="text-[11px] app-muted">{dateLabel(event.created_at)}</time></div>
        <p className="text-xs mt-1 app-muted">{event.previous_stage && event.previous_stage !== event.current_stage ? 'از ' + (stageLabels[event.previous_stage] || 'مرحله قبلی') + ' به ' + (stageLabels[event.current_stage] || 'مرحله جدید') : 'مرحله: ' + (stageLabels[event.current_stage] || 'ثبت‌شده')}</p>
        {!!event.changed_fields?.length && <p className="text-xs mt-1">{event.changed_fields.length} بخش تغییر یافته</p>}
        <p className="text-[11px] app-muted mt-1">{event.actor_id && event.actor_id === userId ? 'توسط شما' : 'توسط کاربر مجاز'}</p>
      </li>)}</ol>}
  </section>;
};
