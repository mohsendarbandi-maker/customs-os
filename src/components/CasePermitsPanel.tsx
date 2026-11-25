import React, { useEffect, useState } from 'react';
import { Check, Edit3, Plus, Save, Trash2, X } from 'lucide-react';
import {
  cloudflareCasesApi,
  type CasePermit,
  type CasePermitInput,
} from '../lib/cloudflareCases';
import { normalizeDigits, toJalali, zonedJalaliToDate } from '../lib/jalali';

type Props = {
  caseId: string;
  initialPermits: CasePermit[];
  editable: boolean;
  onChange?: (permits: CasePermit[]) => void;
};
type PermitForm = {
  permit_type: string;
  permit_number: string;
  issuing_authority: string;
  status: CasePermit['status'];
  issued_at: string;
  expires_at: string;
};
const blank = (): PermitForm => ({
  permit_type: '', permit_number: '', issuing_authority: '',
  status: 'pending', issued_at: '', expires_at: '',
});
const pad = (value: number) => String(value).padStart(2, '0');
const dateFromIso = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const jalali = toJalali(date);
  return jalali.year + '/' + pad(jalali.month) + '/' + pad(jalali.day);
};
const dateToIso = (value: string) => {
  const normalized = normalizeDigits(value.trim()).replace(/[.-]/g, '/');
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) throw new Error('تاریخ را به شکل سال/ماه/روز شمسی وارد کنید.');
  try {
    return zonedJalaliToDate(Number(match[1]), Number(match[2]), Number(match[3]), 12, 0).toISOString();
  } catch {
    throw new Error('تاریخ شمسی معتبر نیست.');
  }
};
const statusLabel: Record<CasePermit['status'], string> = {
  pending: 'در انتظار',
  approved: 'تأیید شد',
  rejected: 'رد شد',
  not_required: 'نیازی نیست',
};
const dateLabel = (value: string | null) => dateFromIso(value) || '—';

export const CasePermitsPanel: React.FC<Props> = ({
  caseId, initialPermits, editable, onChange,
}) => {
  const [items, setItems] = useState<CasePermit[]>(initialPermits);
  const [form, setForm] = useState<PermitForm>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setItems(initialPermits); }, [initialPermits]);

  const setField = <K extends keyof PermitForm>(key: K, value: PermitForm[K]) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const closeForm = () => {
    setEditingId(null);
    setCreating(false);
    setForm(blank());
    setError('');
  };

  const edit = (permit: CasePermit) => {
    setEditingId(permit.id);
    setCreating(false);
    setError('');
    setForm({
      permit_type: permit.permit_type,
      permit_number: permit.permit_number || '',
      issuing_authority: permit.issuing_authority,
      status: permit.status,
      issued_at: dateFromIso(permit.issued_at),
      expires_at: dateFromIso(permit.expires_at),
    });
  };

  const save = async () => {
    if (!caseId) return;
    if (!form.permit_type.trim() || !form.issuing_authority.trim()) {
      setError('نوع مجوز و مرجع صادرکننده الزامی است.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: CasePermitInput = {
        permit_type: form.permit_type.trim(),
        permit_number: form.permit_number.trim() || null,
        issuing_authority: form.issuing_authority.trim(),
        status: form.status,
        issued_at: dateToIso(form.issued_at),
        expires_at: dateToIso(form.expires_at),
      };
      const result = editingId
        ? await cloudflareCasesApi.updatePermit(caseId, editingId, payload)
        : await cloudflareCasesApi.createPermit(caseId, payload);
      const next = editingId
        ? items.map(item => item.id === editingId ? result.permit : item)
        : [result.permit, ...items];
      setItems(next);
      onChange?.(next);
      closeForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ذخیره مجوز انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (permit: CasePermit) => {
    if (!window.confirm('مجوز «' + permit.permit_type + '» حذف شود؟')) return;
    setSaving(true);
    setError('');
    try {
      await cloudflareCasesApi.deletePermit(caseId, permit.id);
      const next = items.filter(item => item.id !== permit.id);
      setItems(next);
      onChange?.(next);
      if (editingId === permit.id) closeForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'حذف مجوز انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4" dir="rtl">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="font-black">مجوزهای پرونده</h2>
        <p className="mt-1 text-xs text-slate-400">ثبت، پیگیری و نگهداری سوابق مجوزهای مرتبط با همین پرونده</p>
      </div>
      {editable && !creating && !editingId && <button type="button" onClick={() => { setCreating(true); setForm(blank()); setError(''); }} className="inline-flex items-center gap-1 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white">
        <Plus size={14}/> افزودن مجوز
      </button>}
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
    {items.length === 0
      ? <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">برای این پرونده مجوزی ثبت نشده است.</p>
      : <div className="space-y-2">
        {items.map(permit => <article key={permit.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-sm">{permit.permit_type}</div>
              <p className="mt-1 text-xs text-slate-400">{permit.issuing_authority} · {permit.permit_number || 'بدون شماره'}</p>
            </div>
            <span className={'rounded-lg px-2 py-1 text-[11px] ' + (permit.status === 'approved' ? 'bg-emerald-900/40 text-emerald-300' : permit.status === 'rejected' ? 'bg-red-900/40 text-red-300' : 'bg-amber-900/30 text-amber-200')}>
              {statusLabel[permit.status]}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
            <span>تاریخ صدور: {dateLabel(permit.issued_at)}</span>
            <span>تاریخ انقضا: {dateLabel(permit.expires_at)}</span>
          </div>
          {editable && <div className="mt-3 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => edit(permit)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs"><Edit3 size={13}/> ویرایش</button>
            <button type="button" disabled={saving} onClick={() => void remove(permit)} className="inline-flex items-center gap-1 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300"><Trash2 size={13}/> حذف</button>
          </div>}
        </article>)}
      </div>}
    {(creating || editingId) && editable && <div className="rounded-xl border border-cyan-700/40 bg-slate-950 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{editingId ? 'ویرایش مجوز' : 'ثبت مجوز جدید'}</h3>
        <button type="button" disabled={saving} onClick={closeForm} aria-label="بستن فرم"><X size={17}/></button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">نوع مجوز
          <input value={form.permit_type} onChange={event => setField('permit_type', event.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100"/>
        </label>
        <label className="text-xs text-slate-400">شماره مجوز
          <input value={form.permit_number} onChange={event => setField('permit_number', event.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100"/>
        </label>
        <label className="text-xs text-slate-400">مرجع صادرکننده
          <input value={form.issuing_authority} onChange={event => setField('issuing_authority', event.target.value)} maxLength={255} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100"/>
        </label>
        <label className="text-xs text-slate-400">وضعیت
          <select value={form.status} onChange={event => setField('status', event.target.value as CasePermit['status'])} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100">
            <option value="pending">در انتظار</option>
            <option value="approved">تأیید شد</option>
            <option value="rejected">رد شد</option>
            <option value="not_required">نیازی نیست</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">تاریخ صدور (شمسی)
          <input value={form.issued_at} onChange={event => setField('issued_at', event.target.value)} placeholder="۱۴۰۵/۰۸/۰۴" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100" dir="ltr"/>
        </label>
        <label className="text-xs text-slate-400">تاریخ انقضا (شمسی)
          <input value={form.expires_at} onChange={event => setField('expires_at', event.target.value)} placeholder="۱۴۰۵/۰۹/۰۴" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100" dir="ltr"/>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={closeForm} disabled={saving} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">انصراف</button>
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-cyan-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          <Save size={13}/> ذخیره
        </button>
      </div>
    </div>}
  </section>;
};
