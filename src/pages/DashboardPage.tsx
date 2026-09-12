import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Ship, Building2, Wallet, LayoutDashboard, LogOut, Save, Loader2, CheckCircle2, AlertCircle, FileCheck2, Calculator, PackageCheck } from 'lucide-react';

const roleLabels: Record<string, string> = { owner: 'مالک', admin: 'مدیر', broker: 'کارگزار', accountant: 'حسابدار', warehouse: 'انباردار', client: 'مشتری' };

type FieldProps = { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string };
const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder = '', type = 'text' }) => (
  <label className="block"><span className="block text-xs text-slate-400 mb-1.5">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500" /></label>
);

export const DashboardPage: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'case' | 'operation' | 'valuation' | 'declaration'>('case');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [caseId, setCaseId] = useState('');
  const [caseForm, setCaseForm] = useState({ client: '', regNumber: '' });
  const [operationForm, setOperationForm] = useState({
    vesselType: 'ایرانی', unloadingDate: '', warehouseReceiptNo: '', warehouseReceiptDate: '', releaseStatus: 'pending',
    cargoCount: '', cargoCountUnit: 'رول', cargoDescription: '', originCountry: '', transactionCountry: '', deliveryTerm: 'CFR',
    invoiceAmount: '', invoiceCurrency: 'USD', netWeight: '', grossWeight: '', insuranceIrr: '', tariffCode: '', dutyRate: ''
  });
  const [valuationForm, setValuationForm] = useState({ fxRate: '', dutyRate: '', vatRate: '10' });
  const [valuationResult, setValuationResult] = useState<Record<string, any> | null>(null);
  const [declarationForm, setDeclarationForm] = useState({ kottaj: '', declarationDate: new Date().toISOString().slice(0, 10), customsPath: '' });

  const showError = (text: string) => setStatusMessage({ type: 'error', text });
  const parseNum = (v: string) => v.trim() ? Number(v.replace(/,/g, '')) : null;

  const createCase = async () => {
    if (!caseForm.client.trim() || !caseForm.regNumber.trim()) return showError('صاحب کالا و شماره ثبت سفارش الزامی است.');
    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال ایجاد پرونده...' });
    try {
      const { data, error } = await supabase.rpc('create_case_workflow', { p_client_name: caseForm.client.trim(), p_registration_order_no: caseForm.regNumber.trim() });
      if (error) throw error;
      setCaseId(data); setCaseForm(prev => ({ ...prev, regNumber: '' })); setActiveTab('operation');
      setStatusMessage({ type: 'success', text: `پرونده ایجاد شد. شناسه: ${data}` });
    } catch (e: any) { showError(`خطا در ایجاد پرونده: ${e?.message || 'خطای نامشخص'}`); }
    finally { setIsProcessing(false); }
  };

  const saveOperationData = async () => {
    if (!caseId) return showError('ابتدا پرونده را ایجاد کنید.');
    const nums = ['cargoCount','invoiceAmount','netWeight','grossWeight','insuranceIrr','dutyRate'] as const;
    for (const key of nums) { const value = parseNum(operationForm[key]); if (value !== null && (!Number.isFinite(value) || value < 0)) return showError(`مقدار ${key} معتبر نیست.`); }
    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال ذخیره اطلاعات تخلیه، اسناد و محموله...' });
    try {
      const { error } = await supabase.rpc('update_case_operational_data', {
        p_case_id: caseId, p_vessel_type: operationForm.vesselType || null, p_unloading_date: operationForm.unloadingDate || null,
        p_warehouse_receipt_no: operationForm.warehouseReceiptNo || null, p_warehouse_receipt_date: operationForm.warehouseReceiptDate || null,
        p_release_status: operationForm.releaseStatus || null, p_cargo_count: parseNum(operationForm.cargoCount), p_cargo_count_unit: operationForm.cargoCountUnit || null,
        p_cargo_description: operationForm.cargoDescription || null, p_origin_country_code: operationForm.originCountry || null,
        p_transaction_country_code: operationForm.transactionCountry || null, p_delivery_term: operationForm.deliveryTerm || null,
        p_invoice_amount: parseNum(operationForm.invoiceAmount), p_invoice_currency: operationForm.invoiceCurrency || null,
        p_net_weight_kg: parseNum(operationForm.netWeight), p_gross_weight_kg: parseNum(operationForm.grossWeight),
        p_insurance_amount_irr: parseNum(operationForm.insuranceIrr), p_tariff_code: operationForm.tariffCode || null, p_import_duty_rate: parseNum(operationForm.dutyRate)
      });
      if (error) throw error;
      setActiveTab('valuation'); setStatusMessage({ type: 'success', text: 'اطلاعات عملیاتی پرونده ذخیره شد. اکنون محاسبه ارزش گمرکی را انجام بده.' });
    } catch (e: any) { showError(`خطا در ذخیره اطلاعات: ${e?.message || 'خطای نامشخص'}`); }
    finally { setIsProcessing(false); }
  };

  const calculateValuation = async () => {
    if (!caseId) return showError('ابتدا پرونده را ایجاد کنید.');
    const fx = parseNum(valuationForm.fxRate); const duty = parseNum(valuationForm.dutyRate); const vat = parseNum(valuationForm.vatRate);
    if (fx === null || fx <= 0) return showError('نرخ ارز مبادله‌ای گمرک الزامی و باید بزرگ‌تر از صفر باشد.');
    if (duty === null || duty < 0) return showError('درصد حقوق ورودی معتبر نیست.');
    if (vat === null || vat < 0) return showError('نرخ مالیات بر ارزش افزوده معتبر نیست.');
    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال محاسبه ارزش و عوارض...' });
    try {
      const { data, error } = await supabase.rpc('calculate_case_valuation', { p_case_id: caseId, p_customs_fx_rate_irr: fx, p_import_duty_rate: duty, p_vat_rate: vat });
      if (error) throw error;
      setValuationResult(data); setActiveTab('declaration'); setStatusMessage({ type: 'success', text: 'محاسبه ارزش گمرکی، حقوق ورودی و مالیات انجام شد.' });
    } catch (e: any) { showError(`خطا در محاسبه: ${e?.message || 'خطای نامشخص'}`); }
    finally { setIsProcessing(false); }
  };

  const registerDeclaration = async () => {
    if (!caseId) return showError('ابتدا پرونده را ایجاد کنید.');
    if (!declarationForm.kottaj.trim()) return showError('شماره کوتاژ فقط بعد از ثبت اظهار در EPL وارد می‌شود.');
    setIsProcessing(true); setStatusMessage({ type: 'info', text: 'در حال اتصال کوتاژ واقعی EPL به پرونده...' });
    try {
      const { data, error } = await supabase.rpc('register_declaration_workflow', {
        p_case_id: caseId, p_kottaj_number: declarationForm.kottaj.trim(), p_declaration_date: new Date(`${declarationForm.declarationDate}T00:00:00`).toISOString(),
        p_customs_office_id: null, p_customs_path: declarationForm.customsPath || null,
        p_assessed_value_irr: valuationResult?.customs_value_irr ?? null, p_total_duties_irr: valuationResult?.total_payable_irr ?? null
      });
      if (error) throw error;
      setStatusMessage({ type: 'success', text: `کوتاژ به پرونده متصل شد. شناسه اظهارنامه: ${data}` });
    } catch (e: any) { showError(`خطا در ثبت کوتاژ: ${e?.message || 'خطای نامشخص'}`); }
    finally { setIsProcessing(false); }
  };

  return <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl">
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between px-5"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center"><Ship size={20}/></div><div><b>Customs OS</b><div className="text-[10px] text-blue-400">سیستم مدیریت عملیات گمرکی</div></div></div><div className="flex items-center gap-4 text-xs"><span>{profile?.full_name || '—'} · {profile?.role ? roleLabels[profile.role] : '—'}</span><button onClick={signOut} className="text-slate-400 hover:text-rose-400"><LogOut size={18}/></button></div></header>
    <div className="max-w-7xl mx-auto p-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <button onClick={()=>setActiveTab('case')} className={`p-4 rounded-2xl border text-right ${activeTab==='case'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><Building2 className="mb-2 text-blue-400" size={20}/><b className="text-sm">پرونده</b><div className="text-[11px] text-slate-500 mt-1">صاحب کالا + ثبت سفارش</div></button>
        <button onClick={()=>setActiveTab('operation')} className={`p-4 rounded-2xl border text-right ${activeTab==='operation'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><PackageCheck className="mb-2 text-emerald-400" size={20}/><b className="text-sm">تخلیه و اسناد</b><div className="text-[11px] text-slate-500 mt-1">قبض انبار + بار + اسناد</div></button>
        <button onClick={()=>setActiveTab('valuation')} className={`p-4 rounded-2xl border text-right ${activeTab==='valuation'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><Calculator className="mb-2 text-amber-400" size={20}/><b className="text-sm">ارزش و عوارض</b><div className="text-[11px] text-slate-500 mt-1">نرخ ارز + تعرفه + VAT</div></button>
        <button onClick={()=>setActiveTab('declaration')} className={`p-4 rounded-2xl border text-right ${activeTab==='declaration'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><FileCheck2 className="mb-2 text-cyan-400" size={20}/><b className="text-sm">EPL / کوتاژ</b><div className="text-[11px] text-slate-500 mt-1">ثبت اظهار و اتصال کوتاژ</div></button>
        <button onClick={()=>setActiveTab('home')} className={`p-4 rounded-2xl border text-right ${activeTab==='home'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><LayoutDashboard className="mb-2 text-violet-400" size={20}/><b className="text-sm">داشبورد</b><div className="text-[11px] text-slate-500 mt-1">وضعیت پرونده</div></button>
      </div>
      {statusMessage && <div className={`mb-5 p-4 rounded-xl border text-sm flex items-center gap-3 ${statusMessage.type==='success'?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':statusMessage.type==='info'?'bg-blue-500/10 border-blue-500/20 text-blue-300':'bg-rose-500/10 border-rose-500/20 text-rose-300'}`}>{statusMessage.type==='success'?<CheckCircle2 size={18}/>:statusMessage.type==='info'?<Loader2 className="animate-spin" size={18}/>:<AlertCircle size={18}/>} {statusMessage.text}</div>}

      {activeTab==='case' && <section className="max-w-3xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">ایجاد پرونده گمرکی</h1><p className="text-xs text-slate-500 mt-1 mb-6">پرونده با صاحب کالا و هر شماره ثبت سفارش مستقل است.</p><div className="grid md:grid-cols-2 gap-4"><Field label="صاحب کالا / شرکت" value={caseForm.client} onChange={v=>setCaseForm({...caseForm,client:v})} placeholder="مثلاً آذرفولاد امین"/><Field label="شماره ثبت سفارش" value={caseForm.regNumber} onChange={v=>setCaseForm({...caseForm,regNumber:v})}/></div><button onClick={createCase} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm"><Save size={17} className="inline ml-2"/> ایجاد پرونده واقعی</button></section>}

      {activeTab==='operation' && <section className="max-w-5xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><div className="flex justify-between items-start mb-6"><div><h1 className="text-lg font-bold">تخلیه، قبض انبار و اسناد پایه</h1><p className="text-xs text-slate-500 mt-1">این مرحله قبل از اظهار EPL است.</p></div><span className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">Case: <span dir="ltr">{caseId||'—'}</span></span></div><div className="grid md:grid-cols-3 gap-4"><Field label="نوع کشتی" value={operationForm.vesselType} onChange={v=>setOperationForm({...operationForm,vesselType:v})}/><Field label="تاریخ تخلیه" value={operationForm.unloadingDate} onChange={v=>setOperationForm({...operationForm,unloadingDate:v})} type="date"/><Field label="شماره قبض انبار" value={operationForm.warehouseReceiptNo} onChange={v=>setOperationForm({...operationForm,warehouseReceiptNo:v})}/><Field label="تاریخ قبض انبار" value={operationForm.warehouseReceiptDate} onChange={v=>setOperationForm({...operationForm,warehouseReceiptDate:v})} type="date"/><Field label="تعداد" value={operationForm.cargoCount} onChange={v=>setOperationForm({...operationForm,cargoCount:v})}/><Field label="واحد" value={operationForm.cargoCountUnit} onChange={v=>setOperationForm({...operationForm,cargoCountUnit:v})}/><Field label="شرح کالا" value={operationForm.cargoDescription} onChange={v=>setOperationForm({...operationForm,cargoDescription:v})}/><Field label="کشور مبدأ" value={operationForm.originCountry} onChange={v=>setOperationForm({...operationForm,originCountry:v})} placeholder="RU"/><Field label="کشور طرف معامله" value={operationForm.transactionCountry} onChange={v=>setOperationForm({...operationForm,transactionCountry:v})} placeholder="HK"/><Field label="شرایط تحویل" value={operationForm.deliveryTerm} onChange={v=>setOperationForm({...operationForm,deliveryTerm:v})} placeholder="CFR"/><Field label="مبلغ فاکتور" value={operationForm.invoiceAmount} onChange={v=>setOperationForm({...operationForm,invoiceAmount:v})}/><Field label="ارز" value={operationForm.invoiceCurrency} onChange={v=>setOperationForm({...operationForm,invoiceCurrency:v})} placeholder="USD"/><Field label="وزن خالص (kg)" value={operationForm.netWeight} onChange={v=>setOperationForm({...operationForm,netWeight:v})}/><Field label="وزن ناخالص (kg)" value={operationForm.grossWeight} onChange={v=>setOperationForm({...operationForm,grossWeight:v})}/><Field label="بیمه (ریال)" value={operationForm.insuranceIrr} onChange={v=>setOperationForm({...operationForm,insuranceIrr:v})}/><Field label="کد تعرفه" value={operationForm.tariffCode} onChange={v=>setOperationForm({...operationForm,tariffCode:v})}/><Field label="درصد حقوق ورودی" value={operationForm.dutyRate} onChange={v=>setOperationForm({...operationForm,dutyRate:v})} placeholder="مثلاً 4"/></div><label className="block mt-4"><span className="block text-xs text-slate-400 mb-1.5">وضعیت آزادسازی بار</span><select value={operationForm.releaseStatus} onChange={e=>setOperationForm({...operationForm,releaseStatus:e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="pending">در انتظار صورتحساب/پرداخت</option><option value="invoice_received">صورتحساب ترخیصیه دریافت شد</option><option value="paid">پرداخت شد</option><option value="released">بار آزاد شد</option></select></label><button onClick={saveOperationData} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold text-sm"><Save size={17} className="inline ml-2"/> ذخیره اطلاعات عملیاتی</button></section>}

      {activeTab==='valuation' && <section className="max-w-4xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">محاسبه ارزش گمرکی و عوارض</h1><p className="text-xs text-slate-500 mt-1 mb-6">نرخ ارز را از نرخ مبادله‌ای مورد استفاده گمرک وارد کن؛ مبلغ ارز خارجی به‌صورت خودکار به ریال تبدیل می‌شود و مبلغ بیمه ریالی جداگانه به ارزش اضافه می‌شود.</p><div className="grid md:grid-cols-3 gap-4"><Field label="نرخ ارز گمرکی (ریال)" value={valuationForm.fxRate} onChange={v=>setValuationForm({...valuationForm,fxRate:v})}/><Field label="حقوق ورودی (%)" value={valuationForm.dutyRate || operationForm.dutyRate} onChange={v=>setValuationForm({...valuationForm,dutyRate:v})}/><Field label="مالیات ارزش افزوده (%)" value={valuationForm.vatRate} onChange={v=>setValuationForm({...valuationForm,vatRate:v})}/></div><div className="mt-5 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400">پرونده: <span dir="ltr">{caseId||'—'}</span> · HS: <span dir="ltr">{operationForm.tariffCode||'—'}</span> · فاکتور: <span dir="ltr">{operationForm.invoiceAmount||'—'} {operationForm.invoiceCurrency}</span></div><button onClick={calculateValuation} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-bold text-sm"><Calculator size={17} className="inline ml-2"/> محاسبه واقعی</button>{valuationResult&&<div className="mt-5 grid md:grid-cols-3 gap-3">{[['ارزش گمرکی',valuationResult.customs_value_irr],['حقوق ورودی',valuationResult.import_duty_irr],['مالیات + عوارض',valuationResult.total_payable_irr]].map(([label,value])=><div key={String(label)} className="p-4 rounded-xl bg-slate-950 border border-slate-800"><div className="text-xs text-slate-500">{label}</div><b className="block mt-2 text-sm">{Number(value).toLocaleString('fa-IR')} ریال</b></div>)}</div>}</section>}

      {activeTab==='declaration' && <section className="max-w-4xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">EPL و دریافت کوتاژ</h1><p className="text-xs text-slate-500 mt-1 mb-6">اظهار در EPL توسط همکار ثبت می‌شود؛ اینجا فقط نتیجه واقعی EPL و کوتاژ به پرونده متصل می‌شود.</p><div className="grid md:grid-cols-3 gap-4"><Field label="شماره کوتاژ" value={declarationForm.kottaj} onChange={v=>setDeclarationForm({...declarationForm,kottaj:v})} placeholder="مثلاً 37946519"/><Field label="تاریخ اظهار" value={declarationForm.declarationDate} onChange={v=>setDeclarationForm({...declarationForm,declarationDate:v})} type="date"/><label><span className="block text-xs text-slate-400 mb-1.5">مسیر گمرکی</span><select value={declarationForm.customsPath} onChange={e=>setDeclarationForm({...declarationForm,customsPath:e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="">هنوز مشخص نشده</option><option value="green">سبز</option><option value="yellow">زرد</option><option value="red">قرمز</option></select></label></div><div className="mt-5 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 text-xs text-cyan-200">کوتاژ مرحله شروع پرونده نیست؛ بعد از ارسال اطلاعات به EPL و ثبت اظهار به پرونده متصل می‌شود.</div><button onClick={registerDeclaration} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-bold text-sm"><FileCheck2 size={17} className="inline ml-2"/> اتصال کوتاژ به پرونده</button></section>}

      {activeTab==='home' && <section className="max-w-5xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">وضعیت پرونده</h1><div className="mt-5 grid md:grid-cols-4 gap-3"><div className="p-4 rounded-xl bg-slate-950 border border-slate-800"><div className="text-xs text-slate-500">Case ID</div><b className="text-xs break-all">{caseId||'—'}</b></div><div className="p-4 rounded-xl bg-slate-950 border border-slate-800"><div className="text-xs text-slate-500">صاحب کالا</div><b className="text-sm">{caseForm.client||'—'}</b></div><div className="p-4 rounded-xl bg-slate-950 border border-slate-800"><div className="text-xs text-slate-500">ثبت سفارش</div><b className="text-sm">{caseForm.regNumber||'ثبت شده'}</b></div><div className="p-4 rounded-xl bg-slate-950 border border-slate-800"><div className="text-xs text-slate-500">کوتاژ</div><b className="text-sm">{declarationForm.kottaj||'—'}</b></div></div></section>}

      <div className="mt-6 text-[11px] text-slate-600">مالی، مجوزها، کارشناسی، پرداخت و خروج در مراحل بعدی به همین پرونده متصل خواهند شد.</div>
    </div>
  </div>;
};
