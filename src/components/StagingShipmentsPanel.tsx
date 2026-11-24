import React from 'react';
import { RefreshCw, Plus, Save, Pencil, X, Ship, Search, AlertCircle } from 'lucide-react';

type ClientOption = { id: string; name: string; national_id?: string | null };
type Shipment = {
  id: string;
  organization_id: string;
  case_id: string | null;
  registration_order_id: string | null;
  client_id: string | null;
  client_name: string | null;
  vessel_id: string | null;
  vessel_name: string | null;
  shipping_line: string | null;
  bill_of_lading_no: string | null;
  bill_of_lading_year: number | null;
  voyage_no: string | null;
  origin_port: string | null;
  destination_port: string | null;
  cargo_count: number | null;
  cargo_count_unit: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  current_status: string | null;
  current_location: string | null;
  display_name: string | null;
  registration_order_no: string | null;
  customs_regime: string | null;
  sata_code: string | null;
  cargo_description: string | null;
  created_at: string;
};
type ShipmentForm = {
  clientId: string;
  shippingLine: string;
  billOfLading: string;
  billOfLadingYear: string;
  voyageNo: string;
  vesselName: string;
  vesselImo: string;
  vesselFlag: string;
  originPort: string;
  destinationPort: string;
  cargoCount: string;
  cargoCountUnit: string;
  netWeightKg: string;
  grossWeightKg: string;
  currentStatus: string;
  currentLocation: string;
  registrationOrderNo: string;
  customsRegime: string;
  sataCode: string;
  cargoDescription: string;
};
type ApiList<T> = { ok: true; items: T[]; total: number };
type ApiError = { error?: string; message?: string };
const emptyForm: ShipmentForm = {
  clientId: '', shippingLine: '', billOfLading: '', billOfLadingYear: String(new Date().getFullYear()),
  voyageNo: '', vesselName: '', vesselImo: '', vesselFlag: '', originPort: '', destinationPort: '',
  cargoCount: '', cargoCountUnit: 'رول', netWeightKg: '', grossWeightKg: '',
  currentStatus: 'draft', currentLocation: '', registrationOrderNo: '',
  customsRegime: 'definitive_import', sataCode: '', cargoDescription: '',
};
const statusOptions = [
  ['draft', 'پیش‌نویس'], ['booking_confirmed', 'تأیید رزرو'], ['loading', 'در حال بارگیری'],
  ['loaded', 'بارگیری کامل'], ['departed', 'حرکت'], ['in_transit', 'در مسیر'],
  ['approaching_destination', 'نزدیک مقصد'], ['anchorage', 'لنگرگاه'], ['berthing', 'پهلوگیری'],
  ['discharging', 'در حال تخلیه'], ['discharged', 'تخلیه کامل'], ['completed', 'تکمیل'],
  ['delayed', 'تأخیر'], ['cancelled', 'لغو'],
] as const;
const regimes = [
  ['definitive_import', 'واردات قطعی'], ['export', 'صادرات'], ['temporary_admission', 'ورود موقت'],
  ['temporary_export', 'صادرات موقت'], ['transit', 'ترانزیت'], ['other', 'سایر'],
] as const;
const inputClass = 'w-full min-h-11 rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';
const labelClass = 'block text-xs font-bold app-muted mb-1.5';
const toNumber = (value: string) => Number(value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[٬,]/g, '').trim());
const errorMessages: Record<string, string> = {
  UNAUTHORIZED: 'نشست ورود معتبر نیست؛ دوباره وارد شوید.',
  FORBIDDEN: 'اجازه ثبت محموله برای این حساب وجود ندارد.',
  CLIENT_NOT_FOUND: 'صاحب کالا در همین سازمان پیدا نشد.',
  REGISTRATION_ORDER_CLOSED: 'ثبت سفارش انتخاب‌شده بسته شده است.',
  REGISTRATION_ORDER_CLIENT_MISMATCH: 'صاحب کالا با ثبت سفارش یکسان نیست.',
  CASE_CLIENT_MISMATCH: 'صاحب کالا با پرونده انتخاب‌شده یکسان نیست.',
  DUPLICATE_BILL_OF_LADING: 'این شماره بارنامه با همین خط کشتیرانی و سال قبلاً ثبت شده است.',
  GROSS_WEIGHT_BELOW_NET_WEIGHT: 'وزن ناخالص نمی‌تواند از وزن خالص کمتر باشد.',
  SHIPMENTS_API_NOT_READY: 'سرویس محموله یا ساختار D1 آماده نیست.',
};
const messageFor = (code: string) => errorMessages[code] || code || 'عملیات انجام نشد.';
const requestJson = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new Error('پاسخ نامعتبر از سرویس محموله دریافت شد.'); }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : 'REQUEST_FAILED';
    throw new Error(messageFor(code));
  }
  return body as T;
};

const Field = ({ label, value, onChange, placeholder = '', type = 'text', dir = 'rtl', disabled = false }:{
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  type?: string; dir?: 'rtl' | 'ltr'; disabled?: boolean;
}) => (
  <label className="block min-w-0">
    <span className={labelClass}>{label}</span>
    <input className={inputClass} value={value} type={type} dir={dir} disabled={disabled}
      placeholder={placeholder} onChange={event => onChange(event.target.value)} />
  </label>
);

export const StagingShipmentsPanel: React.FC = () => {
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [shipments, setShipments] = React.useState<Shipment[]>([]);
  const [total, setTotal] = React.useState(0);
  const [form, setForm] = React.useState<ShipmentForm>(emptyForm);
  const [selectedId, setSelectedId] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);

  const set = (key: keyof ShipmentForm, value: string) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [shipmentData, clientData] = await Promise.all([
        requestJson<ApiList<Shipment>>('/api/shipments?limit=200&offset=0'),
        requestJson<ApiList<ClientOption>>('/api/clients?limit=100&offset=0'),
      ]);
      setShipments(shipmentData.items || []);
      setTotal(shipmentData.total || 0);
      setClients(clientData.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'بارگذاری اطلاعات محموله‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const visible = React.useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return shipments;
    return shipments.filter(item =>
      [item.display_name, item.bill_of_lading_no, item.shipping_line, item.vessel_name, item.client_name]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle),
    );
  }, [shipments, search]);

  const startNew = () => {
    setSelectedId('');
    setForm(emptyForm);
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const startEdit = (shipment: Shipment) => {
    setSelectedId(shipment.id);
    setForm({
      clientId: shipment.client_id || '',
      shippingLine: shipment.shipping_line || '',
      billOfLading: shipment.bill_of_lading_no || '',
      billOfLadingYear: String(shipment.bill_of_lading_year || new Date().getFullYear()),
      voyageNo: shipment.voyage_no || '',
      vesselName: shipment.vessel_name || '',
      vesselImo: '',
      vesselFlag: '',
      originPort: shipment.origin_port || '',
      destinationPort: shipment.destination_port || '',
      cargoCount: shipment.cargo_count == null ? '' : String(shipment.cargo_count),
      cargoCountUnit: shipment.cargo_count_unit || 'رول',
      netWeightKg: shipment.net_weight_kg == null ? '' : String(shipment.net_weight_kg),
      grossWeightKg: shipment.gross_weight_kg == null ? '' : String(shipment.gross_weight_kg),
      currentStatus: shipment.current_status || 'draft',
      currentLocation: shipment.current_location || '',
      registrationOrderNo: shipment.registration_order_no || '',
      customsRegime: shipment.customs_regime || 'definitive_import',
      sataCode: shipment.sata_code || '',
      cargoDescription: shipment.cargo_description || '',
    });
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!form.clientId) return setError('صاحب کالا را انتخاب کنید.');
    if (!form.vesselName.trim()) return setError('نام کشتی را وارد کنید.');
    if (!form.cargoCount.trim() || !form.netWeightKg.trim() || !form.grossWeightKg.trim()) {
      return setError('تعداد، وزن خالص و وزن ناخالص الزامی هستند.');
    }
    const cargoCount = toNumber(form.cargoCount);
    const netWeightKg = toNumber(form.netWeightKg);
    const grossWeightKg = toNumber(form.grossWeightKg);
    if (!Number.isSafeInteger(cargoCount) || cargoCount <= 0 || !Number.isFinite(netWeightKg) ||
        !Number.isFinite(grossWeightKg) || netWeightKg <= 0 || grossWeightKg <= 0) {
      return setError('مقدار تعداد و وزن‌ها معتبر نیست.');
    }
    const payload = {
      clientId: form.clientId,
      shippingLine: form.shippingLine,
      billOfLading: form.billOfLading,
      billOfLadingYear: form.billOfLading.trim() ? toNumber(form.billOfLadingYear) : null,
      voyageNo: form.voyageNo,
      vesselName: form.vesselName,
      vesselImo: form.vesselImo,
      vesselFlag: form.vesselFlag,
      originPort: form.originPort,
      destinationPort: form.destinationPort,
      cargoCount,
      cargoCountUnit: form.cargoCountUnit,
      netWeightKg,
      grossWeightKg,
      currentStatus: form.currentStatus,
      currentLocation: form.currentLocation,
      registrationOrderNo: form.registrationOrderNo,
      customsRegime: form.customsRegime,
      sataCode: form.sataCode,
      cargoDescription: form.cargoDescription,
    };
    setSaving(true);
    try {
      await requestJson<{ ok: true; shipment: Shipment }>(
        selectedId ? '/api/shipments/' + encodeURIComponent(selectedId) : '/api/shipments',
        { method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setNotice(selectedId ? 'تغییرات محموله در D1 ذخیره شد.' : 'محموله جدید و پرونده مرتبط در D1 ثبت شدند.');
      setSelectedId('');
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ذخیره محموله ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border app-border p-4 md:p-5 space-y-4" dir="rtl" aria-label="مدیریت محموله‌ها">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-widest app-muted">D1 · SHIPMENTS</div>
          <h2 className="mt-1 text-lg font-black">ثبت و مدیریت محموله‌ها</h2>
          <p className="mt-1 text-xs app-muted">اطلاعات مستقیماً از D1 خوانده و در همان پایگاه ذخیره می‌شود.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={loading}
            className="min-h-10 rounded-xl border app-border px-3 text-sm font-bold disabled:opacity-50">
            <RefreshCw size={15} className="inline ml-1" /> تازه‌سازی
          </button>
          <button type="button" onClick={startNew}
            className="min-h-10 rounded-xl px-3 text-sm font-black text-white"
            style={{ background: 'var(--primary)' }}>
            <Plus size={16} className="inline ml-1" /> محموله جدید
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <div className="text-xs app-muted">محموله‌های ثبت‌شده</div>
          <div className="mt-1 text-xl font-black tabular-nums">{total.toLocaleString('fa-IR')}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <div className="text-xs app-muted">محموله‌های نمایش‌داده‌شده</div>
          <div className="mt-1 text-xl font-black tabular-nums">{visible.length.toLocaleString('fa-IR')}</div>
        </div>
        <div className="rounded-xl p-3 col-span-2 sm:col-span-1" style={{ background: 'var(--surface-2)' }}>
          <div className="text-xs app-muted">سرویس داده</div>
          <div className="mt-1 text-sm font-black flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Cloudflare D1</div>
        </div>
      </div>

      {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm flex items-start gap-2"><AlertCircle size={17} className="shrink-0 mt-0.5" />{error}</div>}

      {formOpen && (
        <form onSubmit={save} className="rounded-2xl border app-border p-3 md:p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-black">{selectedId ? 'ویرایش محموله' : 'ثبت محموله جدید'}</h3>
            <button type="button" onClick={() => { setFormOpen(false); setSelectedId(''); }} className="min-h-9 min-w-9 rounded-lg border app-border" aria-label="بستن فرم"><X size={16} className="mx-auto" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="block min-w-0">
              <span className={labelClass}>صاحب کالا *</span>
              <select className={inputClass} value={form.clientId} disabled={Boolean(selectedId)}
                onChange={event => set('clientId', event.target.value)}>
                <option value="">انتخاب صاحب کالا</option>
                {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <Field label="خط کشتیرانی" value={form.shippingLine} onChange={value => set('shippingLine', value)} placeholder="نام شرکت کشتیرانی" />
            <Field label="نام کشتی *" value={form.vesselName} onChange={value => set('vesselName', value)} placeholder="نام کشتی" />
            <Field label="IMO" value={form.vesselImo} onChange={value => set('vesselImo', value)} dir="ltr" placeholder="۷ رقم" />
            <Field label="پرچم کشتی" value={form.vesselFlag} onChange={value => set('vesselFlag', value)} dir="ltr" />
            <Field label="شماره بارنامه" value={form.billOfLading} onChange={value => set('billOfLading', value)} dir="ltr" />
            <Field label="سال بارنامه" value={form.billOfLadingYear} onChange={value => set('billOfLadingYear', value)} type="number" dir="ltr" />
            <Field label="شماره سفر" value={form.voyageNo} onChange={value => set('voyageNo', value)} dir="ltr" />
            <Field label="بندر مبدأ" value={form.originPort} onChange={value => set('originPort', value)} />
            <Field label="بندر مقصد" value={form.destinationPort} onChange={value => set('destinationPort', value)} />
            <Field label="تعداد بسته / کالا *" value={form.cargoCount} onChange={value => set('cargoCount', value)} type="number" dir="ltr" />
            <Field label="واحد" value={form.cargoCountUnit} onChange={value => set('cargoCountUnit', value)} />
            <Field label="وزن خالص (کیلوگرم) *" value={form.netWeightKg} onChange={value => set('netWeightKg', value)} type="number" dir="ltr" />
            <Field label="وزن ناخالص (کیلوگرم) *" value={form.grossWeightKg} onChange={value => set('grossWeightKg', value)} type="number" dir="ltr" />
            <label className="block min-w-0"><span className={labelClass}>وضعیت حمل</span><select className={inputClass} value={form.currentStatus} onChange={event => set('currentStatus', event.target.value)}>{statusOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <Field label="موقعیت فعلی" value={form.currentLocation} onChange={value => set('currentLocation', value)} />
            <Field label="شماره ثبت سفارش" value={form.registrationOrderNo} onChange={value => set('registrationOrderNo', value)} dir="ltr" />
            <label className="block min-w-0"><span className={labelClass}>رویه گمرکی</span><select className={inputClass} value={form.customsRegime} onChange={event => set('customsRegime', event.target.value)}>{regimes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <Field label="کد ساتا" value={form.sataCode} onChange={value => set('sataCode', value)} dir="ltr" />
            <div className="sm:col-span-2 lg:col-span-3"><Field label="شرح کالا" value={form.cargoDescription} onChange={value => set('cargoDescription', value)} placeholder="شرح مختصر کالا" /></div>
          </div>
          <p className="text-xs app-muted">بارگذاری سند در این مسیر عمداً غیرفعال است؛ ثبت محموله به Storage یا آپلود فایل وابسته نیست. اسناد پس از تکمیل مسیر آرشیو جداگانه متصل خواهند شد.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="min-h-11 rounded-xl px-4 text-sm font-black text-white disabled:opacity-50" style={{ background: 'var(--primary)' }}>
              <Save size={16} className="inline ml-1" /> {saving ? 'در حال ذخیره…' : selectedId ? 'ذخیره تغییرات' : 'ثبت محموله'}
            </button>
            <button type="button" onClick={() => { setFormOpen(false); setSelectedId(''); }} className="min-h-11 rounded-xl border app-border px-4 text-sm font-bold">انصراف</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-10 flex-1 min-w-[190px] items-center gap-2 rounded-xl border app-border bg-[var(--surface-2)] px-3">
          <Search size={16} className="app-muted" />
          <input className="w-full bg-transparent outline-none text-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="جست‌وجوی محموله، بارنامه، کشتی…" />
        </label>
        <span className="text-xs app-muted">برای تغییر اطلاعات، محموله را انتخاب کنید.</span>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm app-muted">در حال دریافت محموله‌ها از D1…</div>
      ) : visible.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visible.map(shipment => (
            <article key={shipment.id} className="rounded-xl border app-border p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-black text-sm break-words">{shipment.display_name || 'محموله بدون عنوان'}</div>
                  <div className="mt-1 text-xs app-muted">{shipment.client_name || 'صاحب کالا نامشخص'} · {shipment.vessel_name || 'کشتی نامشخص'}</div>
                </div>
                <span className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold" style={{ background: 'var(--surface)', color: 'var(--text)' }}>{shipment.current_status || 'draft'}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><span className="app-muted block">بارنامه</span><b dir="ltr">{shipment.bill_of_lading_no || '—'}</b></div>
                <div><span className="app-muted block">کشتیرانی</span><b>{shipment.shipping_line || '—'}</b></div>
                <div><span className="app-muted block">تعداد</span><b>{shipment.cargo_count == null ? '—' : Number(shipment.cargo_count).toLocaleString('fa-IR') + ' ' + (shipment.cargo_count_unit || '')}</b></div>
                <div><span className="app-muted block">وزن خالص / ناخالص</span><b>{shipment.net_weight_kg ?? '—'} / {shipment.gross_weight_kg ?? '—'}</b></div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[10px] app-muted">شناسه: {shipment.id.slice(0, 8)}</span>
                <button type="button" onClick={() => startEdit(shipment)} className="min-h-9 rounded-lg border app-border px-3 text-xs font-black">
                  <Pencil size={13} className="inline ml-1" /> ویرایش
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border app-border py-8 text-center text-sm app-muted">{error ? 'داده‌ای بارگذاری نشد.' : 'محموله‌ای با این عبارت پیدا نشد.'}</div>
      )}
      <div className="flex items-center gap-2 text-xs app-muted"><Ship size={14} /> نمایش و ذخیره اطلاعات از D1؛ شناسه‌های جدید با UUID سمت Worker ساخته می‌شوند.</div>
    </section>
  );
};
