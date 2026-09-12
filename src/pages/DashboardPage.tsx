import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Ship, Building2, Wallet, LayoutDashboard, LogOut, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const roleLabels: Record<string, string> = {
  owner: 'مالک', admin: 'مدیر', broker: 'کارگزار', accountant: 'حسابدار', warehouse: 'انباردار', client: 'مشتری'
};

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
};

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder = '', type = 'text' }) => (
  <label className="block">
    <span className="block text-xs text-slate-400 mb-1.5">{label}</span>
    <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
  </label>
);

export const DashboardPage: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'case' | 'shipment'>('case');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [caseId, setCaseId] = useState('');
  const [caseForm, setCaseForm] = useState({ client: '', regNumber: '' });
  const [shipmentForm, setShipmentForm] = useState({ shippingLine: '', bl: '', blYear: String(new Date().getFullYear()), vessel: '', grossWeight: '', transportMode: 'sea' });

  const showError = (text: string) => setStatusMessage({ type: 'error', text });

  const createCase = async () => {
    if (!caseForm.client.trim() || !caseForm.regNumber.trim()) return showError('صاحب کالا و شماره ثبت سفارش الزامی است.');
    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال ایجاد پرونده...' });
    try {
      const { data, error } = await supabase.rpc('create_case_workflow', {
        p_client_name: caseForm.client.trim(),
        p_registration_order_no: caseForm.regNumber.trim(),
      });
      if (error) throw error;
      setCaseId(data);
      setCaseForm(prev => ({ ...prev, regNumber: '' }));
      setActiveTab('shipment');
      setStatusMessage({ type: 'success', text: `پرونده ایجاد شد. شناسه پرونده: ${data}` });
    } catch (e: any) {
      showError(`خطا در ایجاد پرونده: ${e?.message || 'خطای نامشخص'}`);
    } finally { setIsProcessing(false); }
  };

  const registerShipment = async () => {
    if (!caseId) return showError('ابتدا یک پرونده ایجاد یا انتخاب کنید.');
    if (!shipmentForm.shippingLine.trim() || !shipmentForm.bl.trim() || !shipmentForm.blYear.trim() || !shipmentForm.grossWeight.trim()) {
      return showError('خط کشتیرانی، B/L، سال B/L و وزن ناخالص الزامی هستند.');
    }
    if (shipmentForm.transportMode === 'sea' && !shipmentForm.vessel.trim()) return showError('برای حمل دریایی نام کشتی الزامی است.');
    const weight = Number(shipmentForm.grossWeight.replace(/,/g, ''));
    const year = Number(shipmentForm.blYear);
    if (!Number.isFinite(weight) || weight <= 0) return showError('وزن ناخالص باید عددی بزرگ‌تر از صفر باشد.');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return showError('سال B/L معتبر نیست.');

    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال ثبت B/L و اتصال محموله به پرونده...' });
    try {
      const { data, error } = await supabase.rpc('register_shipment_workflow', {
        p_case_id: caseId,
        p_shipping_line: shipmentForm.shippingLine.trim(),
        p_bill_of_lading_no: shipmentForm.bl.trim(),
        p_bill_of_lading_year: year,
        p_vessel_name: shipmentForm.vessel.trim() || null,
        p_gross_weight_kg: weight,
        p_transport_mode: shipmentForm.transportMode,
      });
      if (error) throw error;
      setStatusMessage({ type: 'success', text: `محموله با موفقیت ثبت شد. شناسه محموله: ${data}` });
    } catch (e: any) {
      showError(`خطا در ثبت محموله: ${e?.message || 'خطای نامشخص'}`);
    } finally { setIsProcessing(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl">
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between px-5">
        <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center"><Ship size={20} /></div><div><b>Customs OS</b><div className="text-[10px] text-blue-400">سیستم مدیریت عملیات گمرکی</div></div></div>
        <div className="flex items-center gap-4 text-xs"><span>{profile?.full_name || '—'} · {profile?.role ? roleLabels[profile.role] : '—'}</span><button onClick={signOut} className="text-slate-400 hover:text-rose-400"><LogOut size={18} /></button></div>
      </header>

      <div className="max-w-7xl mx-auto p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <button onClick={() => setActiveTab('case')} className={`p-4 rounded-2xl border text-right ${activeTab === 'case' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900/50'}`}><Building2 className="mb-2 text-blue-400" size={20} /><b className="text-sm">پرونده جدید</b><div className="text-[11px] text-slate-500 mt-1">صاحب کالا + ثبت سفارش</div></button>
          <button onClick={() => setActiveTab('shipment')} className={`p-4 rounded-2xl border text-right ${activeTab === 'shipment' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900/50'}`}><Ship className="mb-2 text-emerald-400" size={20} /><b className="text-sm">بارنامه و محموله</b><div className="text-[11px] text-slate-500 mt-1">B/L + خط کشتیرانی + کشتی</div></button>
          <button onClick={() => setActiveTab('home')} className={`p-4 rounded-2xl border text-right ${activeTab === 'home' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900/50'}`}><LayoutDashboard className="mb-2 text-amber-400" size={20} /><b className="text-sm">داشبورد</b><div className="text-[11px] text-slate-500 mt-1">نمای کلی عملیات</div></button>
          <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/50"><Wallet className="mb-2 text-violet-400" size={20} /><b className="text-sm">مالی</b><div className="text-[11px] text-slate-500 mt-1">در فاز بعد</div></div>
        </div>

        {statusMessage && <div className={`mb-5 p-4 rounded-xl border text-sm flex items-center gap-3 ${statusMessage.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : statusMessage.type === 'info' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}`}>{statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : statusMessage.type === 'info' ? <Loader2 className="animate-spin" size={18} /> : <AlertCircle size={18} />}{statusMessage.text}</div>}

        {activeTab === 'case' && <section className="max-w-3xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <h1 className="text-lg font-bold mb-1">ایجاد پرونده گمرکی</h1><p className="text-xs text-slate-500 mb-6">مرحله ۱: صاحب کالا و شماره ثبت سفارش</p>
          <div className="grid md:grid-cols-2 gap-4"><Field label="صاحب کالا / شرکت" value={caseForm.client} onChange={v => setCaseForm({ ...caseForm, client: v })} placeholder="نام شرکت" /><Field label="شماره ثبت سفارش" value={caseForm.regNumber} onChange={v => setCaseForm({ ...caseForm, regNumber: v })} /></div>
          <p className="text-[11px] text-slate-500 mt-4">یک صاحب کالا می‌تواند در طول سال چند ثبت سفارش و چند پرونده داشته باشد.</p>
          <button onClick={createCase} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm"><Save size={17} className="inline ml-2" /> ایجاد پرونده واقعی</button>
        </section>}

        {activeTab === 'shipment' && <section className="max-w-4xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <div className="flex justify-between items-start mb-6"><div><h1 className="text-lg font-bold">ثبت بارنامه و محموله</h1><p className="text-xs text-slate-500 mt-1">مرحله ۲: B/L به پرونده متصل می‌شود</p></div><div className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">Case: <span dir="ltr">{caseId || 'ابتدا پرونده بسازید'}</span></div></div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="خط کشتیرانی" value={shipmentForm.shippingLine} onChange={v => setShipmentForm({ ...shipmentForm, shippingLine: v })} placeholder="MSC / MAERSK / ..." />
            <Field label="شماره B/L" value={shipmentForm.bl} onChange={v => setShipmentForm({ ...shipmentForm, bl: v })} />
            <Field label="سال B/L" value={shipmentForm.blYear} onChange={v => setShipmentForm({ ...shipmentForm, blYear: v })} type="number" />
            <Field label="نام کشتی" value={shipmentForm.vessel} onChange={v => setShipmentForm({ ...shipmentForm, vessel: v })} />
            <Field label="وزن ناخالص (کیلوگرم)" value={shipmentForm.grossWeight} onChange={v => setShipmentForm({ ...shipmentForm, grossWeight: v })} />
            <label><span className="block text-xs text-slate-400 mb-1.5">روش حمل</span><select value={shipmentForm.transportMode} onChange={e => setShipmentForm({ ...shipmentForm, transportMode: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="sea">دریایی</option><option value="land">زمینی</option><option value="air">هوایی</option><option value="rail">ریلی</option></select></label>
          </div>
          <button onClick={registerShipment} disabled={isProcessing || !caseId} className="mt-5 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold text-sm"><Save size={17} className="inline ml-2" /> ثبت بارنامه و محموله</button>
          <p className="text-[11px] text-slate-500 mt-4">قانون B/L: شماره B/L می‌تواند برای مالک یا کشتی دیگر تکرار شود؛ اما برای یک خط کشتیرانی در یک سال، تکرار آن در همان سازمان مجاز نیست.</p>
        </section>}

        {activeTab === 'home' && <section className="grid md:grid-cols-3 gap-4"><div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800"><div className="text-xs text-slate-500">پرونده جاری</div><div className="text-2xl font-bold mt-2">{caseId ? '۱' : '۰'}</div></div><div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800"><div className="text-xs text-slate-500">مرحله فعلی</div><div className="text-2xl font-bold mt-2">{caseId ? 'B/L' : 'پرونده'}</div></div><div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800"><div className="text-xs text-slate-500">مرحله بعد</div><div className="text-2xl font-bold mt-2">اظهارنامه</div></div></section>}
      </div>
    </div>
  );
};

export default DashboardPage;
