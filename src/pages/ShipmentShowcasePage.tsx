import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, ChevronLeft, ChevronRight, Clock3, FileText, RefreshCw, Search, Ship, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Shipment = {
  id: string;
  display_name: string | null;
  bill_of_lading_no: string | null;
  shipping_line: string | null;
  current_status: string | null;
  current_location: string | null;
  eta_destination: string | null;
  cargo_count: number | null;
  cargo_count_unit: string | null;
  gross_weight_kg: number | null;
  created_at: string;
};
type Reminder = { id: string; shipment_id: string | null; title: string; description: string | null; due_at: string | null; priority: string; status: string; };

const faDate = (value: string | null) => value ? new Date(value).toLocaleDateString('fa-IR') : '—';
const statusText = (value: string | null) => {
  const status = (value || '').toLowerCase();
  if (/complete|done|released|ترخیص|انجام|archived/.test(status)) return /archiv/.test(status) ? 'مختومه' : 'تکمیل شده';
  if (/block|hold|وقف|مانع|مشکل/.test(status)) return 'دارای مانع';
  if (/action|required|نیاز/.test(status)) return 'نیازمند اقدام';
  if (/received|دریافت/.test(status)) return 'دریافت شده';
  if (/review|بررسی/.test(status)) return 'در حال بررسی';
  if (/arriv|رسید|تخلیه/.test(status)) return 'رسیده / تخلیه';
  if (/load|depart|حمل|بارگیری/.test(status)) return 'در حال حمل';
  return value || 'در جریان';
};
const statusTone = (status: string) => status === 'تکمیل شده' || status === 'مختومه' ? 'done' : status === 'دارای مانع' || status === 'نیازمند اقدام' ? 'alert' : 'active';
const isOpenReminder = (reminder: Reminder) => !/done|completed|انجام/.test(reminder.status || '');

export const ShipmentShowcasePage: React.FC = () => {
  const { profile } = useAuth();
  const org = profile?.organization_id || '';
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    setError('');
    try {
      const [shipmentResult, reminderResult] = await Promise.all([
        supabase.from('shipments')
          .select('id,display_name,bill_of_lading_no,shipping_line,current_status,current_location,eta_destination,cargo_count,cargo_count_unit,gross_weight_kg,created_at')
          .eq('organization_id', org).order('created_at', { ascending: false }).limit(500),
        supabase.from('operational_reminders')
          .select('id,shipment_id,title,description,due_at,priority,status')
          .eq('organization_id', org).is('deleted_at', null).order('due_at', { ascending: true }).limit(1000),
      ]);
      if (shipmentResult.error) throw shipmentResult.error;
      if (reminderResult.error) throw reminderResult.error;
      setShipments((shipmentResult.data || []) as Shipment[]);
      setReminders((reminderResult.data || []) as Reminder[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'بارگذاری ویترین محموله ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const updateSize = () => setPageSize(window.innerWidth < 650 ? 500 : window.innerWidth < 1100 ? 4 : 6);
    updateSize();
    window.addEventListener('resize', updateSize, { passive: true });
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const visible = useMemo(() => shipments.filter(shipment => {
    const term = query.trim().toLocaleLowerCase();
    const searchable = [shipment.display_name, shipment.bill_of_lading_no, shipment.shipping_line, shipment.current_status, shipment.current_location]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    if (term && !searchable.includes(term)) return false;
    const label = statusText(shipment.current_status);
    if (filter === 'attention') return label === 'دارای مانع' || label === 'نیازمند اقدام';
    if (filter === 'done') return label === 'تکمیل شده' || label === 'مختومه';
    if (filter === 'active') return label !== 'تکمیل شده' && label !== 'مختومه' && label !== 'دارای مانع';
    return true;
  }), [shipments, query, filter]);

  const todayKey = new Date().toDateString();
  const todayReminders = reminders.filter(item => item.due_at && new Date(item.due_at).toDateString() === todayKey && isOpenReminder(item));
  const overdue = reminders.filter(item => item.due_at && new Date(item.due_at).getTime() < Date.now() && isOpenReminder(item));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const reminderByShipment = useMemo(() => {
    const grouped = new Map<string, Reminder[]>();
    reminders.filter(isOpenReminder).forEach(item => {
      if (!item.shipment_id) return;
      const list = grouped.get(item.shipment_id) || [];
      if (list.length < 2) list.push(item);
      grouped.set(item.shipment_id, list);
    });
    return grouped;
  }, [reminders]);

  useEffect(() => { setPage(0); }, [query, filter, pageSize]);

  return <main className="shipment-showcase-page fm-showcase-screen" dir="rtl">
    <header className="showcase-hero">
      <div><span className="showcase-kicker">DAR BANDI · LIVE OPERATIONS</span><h1>ویترین محموله‌ها</h1><p>تابلوی زندهٔ وضعیت محموله‌ها؛ هر کارت یک پرونده و مسیرهای دسترسی مستقل دارد.</p></div>
      <button onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> تازه‌سازی</button>
    </header>

    <section className="showcase-kpis" aria-label="خلاصه وضعیت محموله‌ها">
      <article><span>کل محموله‌ها</span><strong>{shipments.length.toLocaleString('fa-IR')}</strong><small>پرونده‌های ثبت‌شده</small></article>
      <article><span>یادآورهای امروز</span><strong>{todayReminders.length.toLocaleString('fa-IR')}</strong><small>موعد امروز</small></article>
      <article><span>موارد عقب‌افتاده</span><strong>{overdue.length.toLocaleString('fa-IR')}</strong><small>نیازمند پیگیری</small></article>
    </section>

    <section className="showcase-toolbar">
      <div><span className="showcase-kicker">SHIPMENT BOARD</span><h2>تابلوی وضعیت</h2><p>{visible.length.toLocaleString('fa-IR')} محموله در این فهرست</p></div>
      <div className="showcase-controls">
        <label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="جست‌وجوی محموله، بارنامه، کشتی…" /></label>
        <select value={filter} onChange={event => setFilter(event.target.value)} aria-label="فیلتر وضعیت">
          <option value="all">همه وضعیت‌ها</option><option value="active">در جریان</option><option value="attention">نیازمند پیگیری</option><option value="done">تکمیل‌شده</option>
        </select>
      </div>
    </section>

    {error && <div className="showcase-error"><AlertCircle size={17} />{error}</div>}
    {loading ? <div className="showcase-empty">در حال بارگذاری محموله‌ها…</div> : <>
      <section className="showcase-grid fm-showcase-grid" aria-live="polite">
        {pageItems.map(shipment => {
          const status = statusText(shipment.current_status);
          const tone = statusTone(status);
          const tasks = reminderByShipment.get(shipment.id) || [];
          return <article className={'showcase-card fm-showcase-card ' + tone} key={shipment.id}>
            <div className="showcase-card-head"><span className="showcase-ship-icon"><Ship size={20} /></span><span className={'showcase-status ' + tone}>{status}</span></div>
            <h3>{shipment.display_name || 'محموله بدون عنوان'}</h3>
            <div className="showcase-identifiers"><span>بارنامه: {shipment.bill_of_lading_no || '—'}</span><span>{shipment.shipping_line || 'خط کشتیرانی نامشخص'}</span></div>
            <div className="showcase-facts">
              <div><small>تعداد / مقدار</small><b>{shipment.cargo_count != null ? Number(shipment.cargo_count).toLocaleString('fa-IR') + ' ' + (shipment.cargo_count_unit || '') : '—'}</b></div>
              <div><small>وزن ناخالص</small><b>{shipment.gross_weight_kg != null ? Number(shipment.gross_weight_kg).toLocaleString('fa-IR') + ' kg' : '—'}</b></div>
              <div><small>موقعیت فعلی</small><b>{shipment.current_location || '—'}</b></div>
              <div><small>زمان تخمینی رسیدن</small><b>{faDate(shipment.eta_destination)}</b></div>
            </div>
            <div className="showcase-reminders">
              <div className="showcase-activity-title"><Bell size={14} /> پیگیری‌های باز</div>
              {tasks.length ? tasks.map(task => <div className="showcase-task" key={task.id}><Clock3 size={13} /><span>{task.title}</span><small>{faDate(task.due_at)}</small></div>) : <p className="showcase-no-task">پیگیری بازی برای این محموله ثبت نشده است.</p>}
            </div>
            <footer>
              <Link to={'/file-manager?shipmentId=' + encodeURIComponent(shipment.id)}><FileText size={14} /> پرونده</Link>
              <Link to={'/shipment-reports?shipmentId=' + encodeURIComponent(shipment.id)}><Truck size={14} /> گزارش محموله</Link>
            </footer>
          </article>;
        })}
        {!pageItems.length && <div className="showcase-empty">محموله‌ای با این فیلتر پیدا نشد.</div>}
      </section>
      <footer className="fm-showcase-pagination">
        <button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={safePage === 0}><ChevronRight size={17} /> قبلی</button>
        <span>صفحهٔ {(safePage + 1).toLocaleString('fa-IR')} از {pageCount.toLocaleString('fa-IR')} · {visible.length.toLocaleString('fa-IR')} محموله</span>
        <button type="button" onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} disabled={safePage >= pageCount - 1}>بعدی <ChevronLeft size={17} /></button>
      </footer>
    </>}
    <div className="showcase-footer-note"><Truck size={15} /> گزارش‌ها فقط در بخش مستقل «گزارش محموله‌ها» ثبت و نگهداری می‌شوند؛ این ویترین فقط وضعیت و پیگیری‌های باز را نمایش می‌دهد.</div>
  </main>;
};

export default ShipmentShowcasePage;
