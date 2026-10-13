import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { validateAdditionalRegimeStage } from '../lib/customsOtherRegimeValidation';

type StageKey = 'documents' | 'permits' | 'declaration' | 'loading' | 'exit' | 'completed';
type Props = { declarationId: string; organizationId: string; userId?: string; customsRegime: string; editable: boolean };
type Field = { key: string; label: string; required?: boolean; placeholder?: string };
type Stage = { key: StageKey; label: string; description: string; fields: Field[] };
type ProcedureState = Record<string, Record<string, string | boolean>>;

const stages: Stage[] = [
  { key: 'documents', label: 'اسناد و مشخصات', description: 'مدارک و مشخصات پایه رویه را ثبت کنید.', fields: [
    { key: 'goodsDescription', label: 'شرح کالا / موضوع عملیات', required: true },
    { key: 'invoiceReference', label: 'شماره فاکتور یا سند مرجع' },
    { key: 'documentReferences', label: 'مراجع اسناد پیوست', required: true },
  ] },
  { key: 'permits', label: 'مجوزها', description: 'وضعیت مجوزها و مراجع ذی‌صلاح را ثبت کنید.', fields: [
    { key: 'authority', label: 'مرجع صادرکننده مجوز' },
    { key: 'permitStatus', label: 'وضعیت مجوز', required: true, placeholder: 'دریافت شد / در انتظار / عدم نیاز مستند' },
    { key: 'permitReference', label: 'شماره / مرجع مجوز' },
  ] },
  { key: 'declaration', label: 'اظهار و ثبت', description: 'شناسه اظهار و مرجع ثبت رسمی را وارد کنید.', fields: [
    { key: 'declarationReference', label: 'شماره کوتاژ / شناسه ثبت', required: true },
    { key: 'declarationDate', label: 'تاریخ ثبت (شمسی)', required: true, placeholder: '۱۴۰۵/۰۷/۲۱' },
    { key: 'officeReference', label: 'گمرک / مرجع محل انجام' },
  ] },
  { key: 'loading', label: 'جابه‌جایی / نگهداری', description: 'اطلاعات مسیر، انبار یا جابه‌جایی مرتبط با رویه را ثبت کنید.', fields: [
    { key: 'location', label: 'محل فعلی کالا / انبار / منطقه', required: true },
    { key: 'movementReference', label: 'شماره مجوز جابه‌جایی / بارنامه' },
    { key: 'movementDate', label: 'تاریخ جابه‌جایی (شمسی)', placeholder: '۱۴۰۵/۰۷/۲۱' },
  ] },
  { key: 'exit', label: 'تعیین تکلیف', description: 'خروج، تحویل، انتقال یا وضعیت نهایی کالا را مستند کنید.', fields: [
    { key: 'dispositionStatus', label: 'وضعیت نهایی / تعیین تکلیف', required: true },
    { key: 'dispositionDate', label: 'تاریخ واقعی (شمسی)', placeholder: '۱۴۰۵/۰۷/۲۱' },
    { key: 'dispositionReference', label: 'شماره سند خروج / تحویل / انتقال' },
    { key: 'exceptionNote', label: 'مغایرت یا توضیحات' },
  ] },
  { key: 'completed', label: 'بازبینی و بستن', description: 'پیش از بستن گردش‌کار، تکمیل مستندات را تأیید کنید.', fields: [
    { key: 'closureReference', label: 'مرجع تأیید نهایی', required: true },
    { key: 'closureNote', label: 'یادداشت بستن پرونده' },
  ] },
];
const labels: Record<string, string> = { cabotage: 'کابوتاژ', customs_warehouse: 'انبار گمرکی', free_zone: 'منطقه آزاد', other: 'سایر رویه‌ها' };
const blankState = (): ProcedureState => Object.fromEntries(stages.map(item => [item.key, {}]));

export const CustomsOtherRegimeWorkflow: React.FC<Props> = ({ declarationId, organizationId, userId, customsRegime, editable }) => {
  const [state, setState] = useState<ProcedureState>(blankState);
  const [stage, setStage] = useState<StageKey>('documents');
  const [savedStage, setSavedStage] = useState<StageKey>('documents');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const title = labels[customsRegime] || labels.other;
  const index = stages.findIndex(item => item.key === stage);

  const load = useCallback(async () => {
    if (!declarationId || !organizationId) { setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: loadError } = await supabase.from('customs_declaration_workflow')
      .select('current_stage,procedure_state').eq('organization_id', organizationId)
      .eq('declaration_id', declarationId).maybeSingle();
    if (loadError) { setError('دریافت گردش‌کار انجام نشد. دسترسی و اتصال را بررسی کنید.'); setLoading(false); return; }
    if (data) {
      const loaded = data.procedure_state && typeof data.procedure_state === 'object' ? data.procedure_state as ProcedureState : {};
      setState({ ...blankState(), ...loaded });
      const validStage = stages.some(item => item.key === data.current_stage) ? data.current_stage as StageKey : 'documents';
      setStage(validStage); setSavedStage(validStage);
    }
    setLoading(false);
  }, [declarationId, organizationId]);
  useEffect(() => { void load(); }, [load]);

  const validate = useCallback((key: StageKey): string[] => validateAdditionalRegimeStage(key, state), [state]);

  const save = async (next: StageKey = stage) => {
    if (!editable || !declarationId || !organizationId) return;
    const targetIndex = stages.findIndex(item => item.key === next);
    const savedIndex = stages.findIndex(item => item.key === savedStage);
    if (targetIndex > savedIndex) {
      const issues = stages.slice(savedIndex, targetIndex).flatMap(item => validate(item.key));
      if (issues.length) { setError(issues.join(' ')); return; }
    }
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: saveError } = await supabase.from('customs_declaration_workflow').upsert({
        organization_id: organizationId, declaration_id: declarationId,
        current_stage: next, procedure_state: state, updated_by: userId || null,
      }, { onConflict: 'declaration_id' });
      if (saveError) throw saveError;
      setStage(next); setSavedStage(next); setMessage('گردش‌کار ذخیره شد.');
    } catch {
      setError('ذخیره گردش‌کار انجام نشد. اتصال و مجوز دسترسی را بررسی کنید.');
    } finally { setSaving(false); }
  };

  const advance = async () => {
    const issues = stages.slice(0, index + 1).flatMap(item => validate(item.key));
    if (issues.length) { setError(issues.join(' ')); return; }
    await save(stages[Math.min(index + 1, stages.length - 1)].key);
  };
  const updateField = (key: StageKey, field: string, value: string) =>
    setState(previous => ({ ...previous, [key]: { ...(previous[key] || {}), [field]: value } }));
  const current = stages.find(item => item.key === stage) || stages[0];

  if (loading) return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-5 text-sm app-muted">در حال دریافت گردش‌کار...</section>;
  return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5 space-y-4">
    <header className="flex items-start justify-between gap-3">
      <div><div className="text-xs app-muted">گردش‌کار تکمیلی رویه</div><h2 className="text-lg font-black mt-1">{title}</h2><p className="text-xs app-muted mt-1">اطلاعات ثبت‌شده در پرونده همین اظهارنامه نگهداری می‌شود؛ تصمیم قانونی با مرجع ذی‌صلاح است.</p></div>
      <button type="button" onClick={() => void load()} className="rounded-xl border app-border p-2" aria-label="بازخوانی"><RefreshCw size={16}/></button>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"><AlertTriangle className="inline ml-1" size={15}/>{error}</div>}
    {message && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{message}</div>}
    <nav className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {stages.map((item, i) => <button key={item.key} type="button" onClick={() => setStage(item.key)} className={'rounded-xl border px-3 py-2 text-right text-xs font-bold ' + (stage === item.key ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'app-border')}><span className="app-muted ml-1">{i + 1}.</span>{item.label}</button>)}
    </nav>
    <div className="rounded-xl border app-border p-4 space-y-4">
      <div><h3 className="font-black">{current.label}</h3><p className="text-xs app-muted mt-1">{current.description}</p></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {current.fields.map(field => <label key={field.key} className="block text-sm"><span className="block mb-1.5 text-xs app-muted">{field.label}{field.required ? ' *' : ''}</span><input disabled={!editable} value={String(state[stage]?.[field.key] ?? '')} onChange={event => updateField(stage, field.key, event.target.value)} placeholder={field.placeholder || ''} className="w-full rounded-xl border app-border bg-[var(--surface)] px-3 py-2.5 disabled:opacity-60"/></label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!editable || saving} onClick={() => void save()} className="rounded-xl bg-[var(--primary)] text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50"><Save className="inline ml-1" size={15}/>{saving ? 'در حال ذخیره...' : 'ذخیره مرحله'}</button>
        {index < stages.length - 1 && <button type="button" disabled={!editable || saving} onClick={() => void advance()} className="rounded-xl border app-border px-4 py-2.5 text-sm font-bold disabled:opacity-50">مرحله بعد</button>}
        {stage === 'completed' && <span className="text-xs app-muted self-center"><ShieldCheck className="inline ml-1" size={15}/>بستن نهایی پس از تکمیل مرجع تأیید</span>}
      </div>
    </div>
  </section>;
};
