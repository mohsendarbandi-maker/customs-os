import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CustomsWorkflowAuditHistory } from './CustomsWorkflowAuditHistory';

type StageKey = 'documents' | 'permits' | 'declaration' | 'valuation' | 'loading' | 'exit' | 'completed';
type Field = { key: string; label: string; kind?: 'select' | 'date' | 'number'; options?: { value: string; label: string }[] };
type Stage = { key: StageKey; label: string; description: string; fields: Field[] };
type State = Record<string, Record<string, any>>;
type Props = { declarationId: string; organizationId: string; userId?: string; customsRegime: string; editable: boolean };

const emptyState = (): State => ({
  documents: { billOfLading: '', invoiceNo: '', goodsDescription: '', hsCode: '', quantity: '', unit: '', origin: '', destination: '', exportDeclaration: '', itemCondition: '', documentRefs: '' },
  permits: { status: 'pending', permitReference: '', authority: '', routeApproval: '', notes: '' },
  declaration: { kottajNumber: '', declarationDate: '', officeCode: '', regimeReference: '', deadline: '', notes: '' },
  valuation: { value: '', currency: '', dutyReference: '', guaranteeStatus: 'pending', guaranteeReference: '', notes: '' },
  loading: { vehicle: '', driver: '', sealNumber: '', route: '', dispatchDate: '', arrivalDeadline: '', carrierReference: '', notes: '' },
  exit: { status: 'pending', arrivalDate: '', arrivalReference: '', inspectionStatus: 'pending', exceptionNote: '', notes: '' },
  completed: { reviewed: false, closureReference: '', closureNote: '' }
});

const regimeName: Record<string, string> = {
  external_transit: 'ترانزیت خارجی',
  internal_transit: 'ترانزیت داخلی',
  re_import: 'ورود مجدد',
  re_export: 'اعاده / صدور مجدد',
};
const digits = (value: string) => String(value || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const jalaliParts = (value: string) => {
  const match = digits(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};
const validJalali = (value: string) => {
  const date = jalaliParts(value);
  if (!date || date.month < 1 || date.month > 12 || date.day < 1) return false;
  const leap = [1, 5, 9, 13, 17, 22, 26, 30].includes(date.year % 33);
  const max = date.month <= 6 ? 31 : date.month <= 11 ? 30 : leap ? 30 : 29;
  return date.day <= max;
};
const orderedJalali = (a: string, b: string) => {
  const x = jalaliParts(a), y = jalaliParts(b);
  if (!x || !y) return true;
  return x.year * 10000 + x.month * 100 + x.day <= y.year * 10000 + y.month * 100 + y.day;
};
const select = (key: string, label: string, options: Field['options']): Field => ({ key, label, kind: 'select', options });
const date = (key: string, label: string): Field => ({ key, label, kind: 'date' });
const text = (key: string, label: string): Field => ({ key, label });
const number = (key: string, label: string): Field => ({ key, label, kind: 'number' });

const stagesFor = (regime: string): Stage[] => {
  const transit = regime === 'external_transit' || regime === 'internal_transit';
  const docs: Field[] = transit
    ? [text('billOfLading', 'شماره بارنامه / راهنامه'), text('invoiceNo', 'شماره فاکتور'), text('goodsDescription', 'شرح کالا'), text('hsCode', 'کد تعرفه HS'), number('quantity', 'مقدار کالا'), text('unit', 'واحد اندازه‌گیری'), text('origin', 'مبدأ'), text('destination', 'مقصد / گمرک مقصد'), text('documentRefs', 'مراجع اسناد و پیوست‌ها')]
    : [text('invoiceNo', 'شماره فاکتور ورود / خروج'), text('goodsDescription', 'شرح کالا'), text('hsCode', 'کد تعرفه HS'), number('quantity', 'مقدار کالا'), text('unit', 'واحد اندازه‌گیری'), text('exportDeclaration', 'شماره اظهارنامه صادراتی قبلی (در صورت ورود مجدد)'), text('itemCondition', 'وضعیت کالا نسبت به زمان خروج'), text('documentRefs', 'مراجع اسناد و پیوست‌ها')];
  const permits: Field[] = [
    select('status', 'وضعیت مجوزها و موافقت‌ها', [{ value: 'pending', label: 'در انتظار بررسی' }, { value: 'approved', label: 'تأیید شد' }, { value: 'not_required', label: 'نیاز ندارد' }, { value: 'rejected', label: 'رد شد' }]),
    text('authority', 'مرجع صادرکننده / تأییدکننده'),
    text('permitReference', 'شماره و مرجع مجوز / پروانه'),
    ...(transit ? [text('routeApproval', 'مسیر مصوب و محدودیت‌های مسیر')] : []),
    text('notes', 'شرایط و توضیحات')
  ];
  const declaration: Field[] = [text('kottajNumber', 'شماره کوتاژ'), date('declarationDate', 'تاریخ اظهار (شمسی)'), text('officeCode', 'کد گمرک محل اظهار'), text('regimeReference', transit ? 'شماره پروانه / سند ترانزیت' : 'مرجع مجوز ورود مجدد / اعاده'), ...(transit ? [date('deadline', 'مهلت رسیدن به گمرک مقصد (شمسی)')] : []), text('notes', 'توضیحات')];
  const valuation: Field[] = [text('value', 'ارزش اظهارشده'), text('currency', 'ارز'), text('dutyReference', 'مرجع ارزیابی / حقوق و عوارض'), select('guaranteeStatus', 'وضعیت تضمین / تعهد', [{ value: 'pending', label: 'در انتظار' }, { value: 'provided', label: 'ارائه شده و ثبت شده' }, { value: 'not_required', label: 'نیاز ندارد (با مستند)' }]), text('guaranteeReference', 'شماره تضمین یا مستند عدم نیاز'), text('notes', 'توضیحات ارزش و تسویه')];
  const loading: Field[] = [text('vehicle', 'شماره وسیله نقلیه / کانتینر'), text('driver', 'نام راننده / متصدی حمل'), text('sealNumber', 'شماره پلمب'), text('route', 'مسیر حرکت'), date('dispatchDate', 'تاریخ حرکت (شمسی)'), date('arrivalDeadline', 'مهلت رسیدن (شمسی)'), text('carrierReference', 'مرجع بارنامه حمل / مجوز خروج'), text('notes', 'یادداشت کنترل بارگیری')];
  const exit: Field[] = transit
    ? [select('status', 'وضعیت رسیدن به گمرک مقصد', [{ value: 'pending', label: 'در انتظار رسیدن' }, { value: 'arrived', label: 'رسید و ثبت شد' }, { value: 'exception', label: 'دارای مغایرت / تأخیر' }]), date('arrivalDate', 'تاریخ رسیدن واقعی (شمسی)'), text('arrivalReference', 'شماره ثبت ورود / اعلام وصول'), select('inspectionStatus', 'وضعیت پلمب و بازرسی', [{ value: 'pending', label: 'در انتظار کنترل' }, { value: 'intact', label: 'سالم و مطابق' }, { value: 'exception', label: 'مغایرت / آسیب' }]), text('exceptionNote', 'شرح مغایرت، تأخیر یا صورت‌جلسه'), text('notes', 'توضیحات بستن ترانزیت')]
    : [select('status', regime === 're_import' ? 'وضعیت ورود مجدد' : 'وضعیت اعاده / صدور مجدد', [{ value: 'pending', label: 'در انتظار' }, { value: 'completed', label: 'انجام و مستند شد' }, { value: 'exception', label: 'دارای مغایرت' }]), date('arrivalDate', 'تاریخ واقعی عملیات (شمسی)'), text('arrivalReference', 'شماره سند خروج / ورود و مرجع ثبت'), select('inspectionStatus', 'نتیجه تطبیق کالا و اسناد', [{ value: 'pending', label: 'در انتظار تطبیق' }, { value: 'matched', label: 'مطابق' }, { value: 'exception', label: 'مغایرت' }]), text('exceptionNote', 'شرح مغایرت و مستند رسیدگی'), text('notes', 'توضیحات نهایی')];
  const completed: Field[] = [text('closureReference', 'شماره مرجع بستن پرونده'), text('closureNote', 'یادداشت نهایی / مستندات بایگانی')];
  const result: Stage[] = [
    { key: 'documents', label: 'اسناد و مشخصات کالا', description: 'مشخصات کالا و اسناد پایه باید با پرونده و اظهارنامه تطبیق داشته باشند.', fields: docs },
    { key: 'permits', label: 'مجوزها و موافقت‌ها', description: 'وضعیت هر مجوز را با مرجع رسمی و مستند پرونده ثبت کنید.', fields: permits },
    { key: 'declaration', label: 'اظهار و پروانه گمرکی', description: 'شماره‌ها و تاریخ‌های ثبت‌شده در سامانه رسمی را وارد کنید.', fields: declaration },
  ];
  if (!transit) result.push({ key: 'valuation', label: 'ارزش، تضمین و تعهدات', description: 'ارزش، حقوق و عوارض و وضعیت تضمین باید مستند باشد.', fields: valuation });
  if (transit) result.push({ key: 'loading', label: 'حرکت و کنترل مسیر', description: 'وسیله حمل، پلمب، مسیر مصوب و مهلت رسیدن را ثبت کنید.', fields: loading });
  result.push({ key: 'exit', label: transit ? 'اعلام وصول و بستن ترانزیت' : 'نتیجه ورود / اعاده', description: 'نتیجه عملیات واقعی و هر مغایرت باید مستند شود.', fields: exit });
  result.push({ key: 'completed', label: 'بازبینی و بستن پرونده', description: 'بستن پرونده فقط پس از بازبینی مستندات انجام شود.', fields: completed });
  return result;
};

export const CustomsTransitReimportWorkflow: React.FC<Props> = ({ declarationId, organizationId, userId, customsRegime, editable }) => {
  const stages = useMemo(() => stagesFor(customsRegime), [customsRegime]);
  const [state, setState] = useState<State>(emptyState);
  const [stage, setStage] = useState<StageKey>('documents');
  const [savedStage, setSavedStage] = useState<StageKey>('documents');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const index = stages.findIndex(item => item.key === stage);
  const transit = customsRegime === 'external_transit' || customsRegime === 'internal_transit';
  const patch = (key: string, value: any) => setState(previous => ({ ...previous, [stage]: { ...(previous[stage] || {}), [key]: value } }));

  const load = useCallback(async () => {
    if (!declarationId || !organizationId) return;
    setLoading(true); setError('');
    try {
      const { data, error: fetchError } = await supabase.from('customs_declaration_workflow').select('current_stage,procedure_state').eq('declaration_id', declarationId).eq('organization_id', organizationId).maybeSingle();
      if (fetchError) throw fetchError;
      const merged = { ...emptyState(), ...(data?.procedure_state || {}) } as State;
      setState(merged);
      if (data?.current_stage && stages.some(item => item.key === data.current_stage)) {
        setStage(data.current_stage as StageKey); setSavedStage(data.current_stage as StageKey);
      }
    } catch (cause: any) {
      setError(cause?.message || 'دریافت گردش‌کار انجام نشد');
    } finally { setLoading(false); }
  }, [declarationId, organizationId, stages]);

  useEffect(() => { void load(); }, [load]);

  const validate = (key: StageKey): string[] => {
    const values = state[key] || {};
    const required: Record<string, string[]> = {
      documents: transit ? ['billOfLading', 'goodsDescription', 'hsCode', 'quantity', 'unit', 'origin', 'destination'] : ['invoiceNo', 'goodsDescription', 'hsCode', 'quantity', 'unit', 'documentRefs'],
      permits: ['status'],
      declaration: ['kottajNumber', 'declarationDate', 'officeCode', 'regimeReference'],
      valuation: ['value', 'currency', 'guaranteeStatus'],
      loading: ['vehicle', 'sealNumber', 'route', 'dispatchDate', 'arrivalDeadline'],
      exit: ['status', 'arrivalDate', 'arrivalReference', 'inspectionStatus'],
      completed: ['closureReference']
    };
    const missing = (required[key] || []).filter(field => !String(values[field] ?? '').trim());
    if (key === 'permits' && values.status === 'pending') missing.push('تعیین تکلیف مجوزها');
    if (key === 'valuation' && values.guaranteeStatus === 'pending') missing.push('تعیین تکلیف تضمین');
    if (key === 'exit' && values.status === 'pending') missing.push('تعیین تکلیف نتیجه عملیات');
    if (key === 'exit' && (values.status === 'exception' || values.inspectionStatus === 'exception') && !String(values.exceptionNote || '').trim()) missing.push('شرح مغایرت و مرجع رسیدگی');
    if (key === 'completed' && !state.completed?.reviewed) missing.push('تأیید بازبینی نهایی');
    const dateFields = key === 'declaration' ? ['declarationDate'] : key === 'loading' ? ['dispatchDate', 'arrivalDeadline'] : key === 'exit' ? ['arrivalDate'] : [];
    for (const field of dateFields) if (values[field] && !validJalali(values[field])) missing.push('تاریخ شمسی معتبر برای ' + field);
    if (key === 'loading' && values.dispatchDate && values.arrivalDeadline && validJalali(values.dispatchDate) && validJalali(values.arrivalDeadline) && !orderedJalali(values.dispatchDate, values.arrivalDeadline)) missing.push('مهلت رسیدن باید در همان روز یا پس از تاریخ حرکت باشد');
    if (key === 'exit' && values.arrivalDate && state.loading?.dispatchDate && validJalali(values.arrivalDate) && validJalali(state.loading.dispatchDate) && !orderedJalali(state.loading.dispatchDate, values.arrivalDate)) missing.push('تاریخ رسیدن واقعی نمی‌تواند پیش از تاریخ حرکت باشد');
    if (transit && key === 'exit' && values.arrivalDate && state.loading?.arrivalDeadline && validJalali(values.arrivalDate) && validJalali(state.loading.arrivalDeadline) && !orderedJalali(values.arrivalDate, state.loading.arrivalDeadline) && values.status !== 'exception') missing.push('رسیدن پس از مهلت ثبت شده است؛ وضعیت را «دارای مغایرت / تأخیر» کنید و مستندات را ثبت کنید');
    return [...new Set(missing)];
  };

  const save = async (next: StageKey = stage) => {
    if (!editable || !declarationId || !organizationId) return;
    const targetIndex = stages.findIndex(item => item.key === next);
    const savedIndex = stages.findIndex(item => item.key === savedStage);
    if (targetIndex > savedIndex) {
      const blocked = stages.slice(savedIndex, targetIndex).flatMap(item => validate(item.key).map(issue => item.label + ': ' + issue));
      if (blocked.length) { setError('برای پیشرفت، ابتدا این موارد را تکمیل کنید: ' + blocked.join('، ')); return; }
    }
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: saveError } = await supabase.from('customs_declaration_workflow').upsert({
        organization_id: organizationId, declaration_id: declarationId, current_stage: next,
        procedure_state: state, updated_by: userId || null
      }, { onConflict: 'declaration_id' });
      if (saveError) throw saveError;
      setStage(next); setSavedStage(next); setMessage('گردش‌کار ذخیره شد و در سابقه ممیزی ثبت می‌شود.');
    } catch (cause: any) {
      setError(cause?.message || 'ذخیره گردش‌کار انجام نشد');
    } finally { setSaving(false); }
  };

  const advance = async () => {
    const issues = validate(stage);
    if (issues.length) { setError('برای رفتن به مرحله بعد، موارد زیر را تکمیل کنید: ' + issues.join('، ')); return; }
    const previousIssues = stages.slice(0, index).flatMap(item => validate(item.key).map(issue => item.label + ': ' + issue));
    if (previousIssues.length) { setError('ابتدا مراحل قبلی را تکمیل کنید: ' + previousIssues.join('، ')); return; }
    const next = stages[Math.min(index + 1, stages.length - 1)].key;
    await save(next);
  };

  if (loading) return <section className="rounded-2xl border app-border bg-[var(--surface)] p-5 text-sm app-muted">در حال دریافت گردش‌کار…</section>;
  return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5 space-y-4">
    <header className="flex items-start justify-between gap-3">
      <div><div className="text-xs app-muted">گردش‌کار اختصاصی رویه</div><h2 className="text-lg font-black mt-1">{regimeName[customsRegime] || 'رویه گمرکی'}</h2><p className="text-xs app-muted mt-1">{transit ? 'پلمب، مسیر، مهلت رسیدن و اعلام وصول در یک گردش‌کار قابل پیگیری ثبت می‌شوند.' : 'تطبیق کالا با اسناد قبلی، مرجع مجوز، ارزش و نتیجه نهایی باید مستند باشد.'}</p></div>
      <button type="button" onClick={() => void load()} className="rounded-xl border app-border p-2" aria-label="بارگذاری مجدد"><RefreshCw size={16} /></button>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"><AlertTriangle size={15} className="inline ml-1" />{error}</div>}
    {message && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{message}</div>}
    <nav className="grid grid-cols-2 md:grid-cols-3 gap-2">{stages.map((item, i) => <button key={item.key} type="button" onClick={() => { setStage(item.key); setError(''); }} className={`rounded-xl border p-3 text-right ${stage === item.key ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'app-border'}`}><div className="text-[11px] app-muted">مرحله {String(i + 1).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}</div><div className="text-sm font-bold mt-1">{item.label}</div></button>)}</nav>
    <div className="rounded-xl border app-border p-4 space-y-4"><div><h3 className="font-bold">{stages[index]?.label}</h3><p className="text-xs app-muted mt-1">{stages[index]?.description}</p></div>
      {stages[index]?.fields.map(field => <div key={field.key}><label className="block text-xs app-muted">{field.label}</label>{field.kind === 'select' ? <select disabled={!editable} value={state[stage]?.[field.key] ?? ''} onChange={event => patch(field.key, event.target.value)} className="mt-1 w-full rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input disabled={!editable} type="text" inputMode={field.kind === 'number' ? 'decimal' : 'text'} placeholder={field.kind === 'date' ? '۱۴۰۵/۰۷/۲۱' : ''} value={state[stage]?.[field.key] ?? ''} onChange={event => patch(field.key, event.target.value)} className="mt-1 w-full rounded-xl border app-border bg-[var(--surface)] p-3 text-sm" />}</div>)}
      {stage === 'completed' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={!!state.completed?.reviewed} onChange={event => patch('reviewed', event.target.checked)} /><span><ShieldCheck size={15} className="inline ml-1" />بازبینی اسناد، تطبیق کالا، مجوزها و ثبت مستندات نهایی انجام شده است.</span></label>}
      <div className="flex flex-wrap justify-between gap-2"><button type="button" disabled={!editable || saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl border app-border px-4 py-2.5 text-sm font-bold"><Save size={15} />ذخیره مرحله</button><button type="button" disabled={!editable || saving || stage === 'completed'} onClick={() => void advance()} className="rounded-xl bg-[var(--primary)] text-white px-4 py-2.5 text-sm font-bold">{saving ? 'در حال ذخیره…' : 'اعتبارسنجی و مرحله بعد'}</button></div>
      {!editable && <p className="text-xs app-muted">این حساب فقط اجازه مشاهده گردش‌کار را دارد.</p>}
    </div>
    <p className="text-xs app-muted">این فرم برای ثبت و پیگیری داخلی است؛ مهلت‌ها، مجوزها و تشریفات نهایی باید با پروانه و مقررات رسمی همان پرونده تطبیق داده شوند.</p>
  <CustomsWorkflowAuditHistory declarationId={declarationId} organizationId={organizationId} userId={userId}/>
    </section>;
};
