import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Ship, Building2, LayoutDashboard, LogOut, Save, Loader2, CheckCircle2, AlertCircle, FileCheck2, Calculator, PackageCheck, ClipboardPaste, Printer, Anchor, FileText } from 'lucide-react';

const roleLabels: Record<string, string> = { owner: 'مالک', admin: 'مدیر', broker: 'کارگزار', accountant: 'حسابدار', warehouse: 'انباردار', client: 'مشتری' };

type FieldProps = { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string };
const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder = '', type = 'text' }) => (
  <label className="block"><span className="block text-xs text-slate-400 mb-1.5">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500" /></label>
);

const normalizeKey = (key: string) => key.trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
const cleanValue = (v: string) => v.trim().replace(/^['"“”]+|['"“”]+$/g, '').trim();

const parseSmartPaste = (raw: string): Record<string, string> => {
  const text = raw.trim();
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    const out: Record<string, string> = {};
    const walk = (obj: any, prefix = '') => Object.entries(obj || {}).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) walk(v, key); else out[normalizeKey(key)] = String(v ?? '');
    });
    walk(json);
    return out;
  } catch { /* plain text format */ }
  const out: Record<string, string> = {};
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^:=：]+?)\s*[:=：]\s*(.*?)\s*$/);
    if (m) out[normalizeKey(m[1])] = cleanValue(m[2]);
  });
  return out;
};

const pick = (data: Record<string,string>, ...keys: string[]) => {
  for (const key of keys) { const n = normalizeKey(key); const found = Object.entries(data).find(([k]) => k === n || k.endsWith(`.${n}`)); if (found?.[1]) return found[1]; }
  return '';
};

const SmartPasteHelp = `قالب پیشنهادی Smart Paste:
صاحب کالا: آذرفولاد امین
شماره ثبت سفارش: 90611944
تاریخ ثبت سفارش: 1405/02/05
کشتیرانی: ...
کشتی: دریتا
Voyage: ...
B/L: 3417-6
سال B/L: 2026
تعداد: 75
واحد: رول
شماره قبض انبار: 1051295
تاریخ قبض انبار: 1405/02/29
تاریخ تخلیه: 1405/02/26
شرح کالا: آهن ورق گرم از محل سرمایه گذار خارجی سایز 2x1000
مبدأ: روسیه
کشور معامله: هنگ کنگ
اینکوترمز: CFR
فاکتور: 861823.80
ارز: USD
وزن خالص: 1595970
وزن ناخالص: 1596720
بیمه ریالی: 220071081
HS: 72083900
حقوق ورودی: 4%
کوتاژ: 37946519
مسیر: سبز`;

export const DashboardPage: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'home'|'case'|'operation'|'valuation'|'declaration'>('case');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{type:'error'|'success'|'info';text:string}|null>(null);
  const [caseId, setCaseId] = useState('');
  const [caseForm, setCaseForm] = useState({ client:'', regNumber:'', regDate:'' });
  const [smartPaste, setSmartPaste] = useState('');
  const [operationForm, setOperationForm] = useState({
    shippingLine:'', vesselName:'', voyageNo:'', vesselType:'ایرانی', billOfLading:'', billYear:String(new Date().getFullYear()),
    originPort:'', destinationPort:'', unloadingDate:'', warehouseReceiptNo:'', warehouseReceiptDate:'', releaseStatus:'pending',
    tallyNo:'', releaseInvoiceNo:'', releaseInvoiceDate:'', electronicReleaseNo:'', cargoCount:'', cargoCountUnit:'رول',
    cargoDescription:'', originCountry:'', transactionCountry:'', deliveryTerm:'CFR', invoiceAmount:'', invoiceCurrency:'USD',
    netWeight:'', grossWeight:'', insuranceIrr:'', tariffCode:'', dutyRate:''
  });
  const [valuationForm, setValuationForm] = useState({ fxRate:'', dutyRate:'', vatRate:'10' });
  const [valuationResult, setValuationResult] = useState<Record<string,any>|null>(null);
  const [declarationForm, setDeclarationForm] = useState({ kottaj:'', declarationDate:new Date().toISOString().slice(0,10), customsPath:'' });

  const showError = (text:string) => setStatusMessage({type:'error',text});
  const parseNum = (v:string) => v.trim() ? Number(v.replace(/,/g,'')) : null;
  const fmt = (v:any) => v === null || v === undefined || v === '' ? '—' : String(v);

  const applySmartPaste = () => {
    const d = parseSmartPaste(smartPaste);
    if (!Object.keys(d).length) return showError('Smart Paste هیچ داده قابل تشخیصی پیدا نکرد.');
    const client = pick(d,'صاحب کالا','صاحب کالا / شرکت','cargo owner','client','consignee');
    const regNumber = pick(d,'شماره ثبت سفارش','ثبت سفارش','registration order','registration_order_no');
    const regDate = pick(d,'تاریخ ثبت سفارش','registration order date');
    const shippingLine = pick(d,'کشتیرانی','shipping line','carrier');
    const vesselName = pick(d,'کشتی','vessel','vessel name');
    const voyageNo = pick(d,'voyage','voyage no','شماره سفر');
    const billOfLading = pick(d,'B/L','BL','bill of lading','شماره بارنامه','بارنامه');
    const billYear = pick(d,'سال B/L','BL year','bill of lading year') || operationForm.billYear;
    const cargoCount = pick(d,'تعداد','cargo count','quantity');
    const cargoCountUnit = pick(d,'واحد','unit','quantity unit');
    const warehouseReceiptNo = pick(d,'شماره قبض انبار','قبض انبار','warehouse receipt');
    const warehouseReceiptDate = pick(d,'تاریخ قبض انبار','warehouse receipt date');
    const unloadingDate = pick(d,'تاریخ تخلیه','unloading date','discharge date');
    const cargoDescription = pick(d,'شرح کالا','cargo description','goods description','کالا');
    const originCountry = pick(d,'مبدأ','کشور مبدأ','origin','origin country');
    const transactionCountry = pick(d,'کشور معامله','transaction country');
    const deliveryTerm = pick(d,'اینکوترمز','incoterm','delivery term');
    const invoiceAmount = pick(d,'فاکتور','invoice','invoice amount','مبلغ فاکتور');
    const invoiceCurrency = pick(d,'ارز','currency','invoice currency');
    const netWeight = pick(d,'وزن خالص','net weight','net weight kg');
    const grossWeight = pick(d,'وزن ناخالص','gross weight','gross weight kg');
    const insuranceIrr = pick(d,'بیمه ریالی','insurance irr','insurance');
    const tariffCode = pick(d,'HS','hs code','tariff code','کد تعرفه');
    const dutyRate = pick(d,'حقوق ورودی','import duty','duty rate');
    const kottaj = pick(d,'کوتاژ','kottaj','kottaj number');
    const customsPath = pick(d,'مسیر','customs path','path');
    setCaseForm(p=>({...p,client:client||p.client,regNumber:regNumber||p.regNumber,regDate:regDate||p.regDate}));
    setOperationForm(p=>({...p,shippingLine:shippingLine||p.shippingLine,vesselName:vesselName||p.vesselName,voyageNo:voyageNo||p.voyageNo,billOfLading:billOfLading||p.billOfLading,billYear:billYear||p.billYear,cargoCount:cargoCount||p.cargoCount,cargoCountUnit:cargoCountUnit||p.cargoCountUnit,warehouseReceiptNo:warehouseReceiptNo||p.warehouseReceiptNo,warehouseReceiptDate:warehouseReceiptDate||p.warehouseReceiptDate,unloadingDate:unloadingDate||p.unloadingDate,cargoDescription:cargoDescription||p.cargoDescription,originCountry:originCountry||p.originCountry,transactionCountry:transactionCountry||p.transactionCountry,deliveryTerm:deliveryTerm||p.deliveryTerm,invoiceAmount:invoiceAmount||p.invoiceAmount,invoiceCurrency:invoiceCurrency||p.invoiceCurrency,netWeight:netWeight||p.netWeight,grossWeight:grossWeight||p.grossWeight,insuranceIrr:insuranceIrr||p.insuranceIrr,tariffCode:tariffCode||p.tariffCode,dutyRate:(dutyRate||p.dutyRate).replace('%',''),vesselType:pick(d,'نوع کشتی','vessel type')||p.vesselType,tallyNo:pick(d,'بارشماری','tally','tally no')||p.tallyNo,releaseInvoiceNo:pick(d,'شماره ترخیصیه','release invoice','release no')||p.releaseInvoiceNo,electronicReleaseNo:pick(d,'ترخیصیه الکترونیک','electronic release')||p.electronicReleaseNo}));
    if (kottaj || customsPath) setDeclarationForm(p=>({...p,kottaj:kottaj||p.kottaj,customsPath:(customsPath||p.customsPath).toLowerCase().replace('سبز','green').replace('زرد','yellow').replace('قرمز','red')}));
    setStatusMessage({type:'success',text:`Smart Paste ${Object.keys(d).length} مورد را شناسایی کرد. قبل از ثبت، اطلاعات را کنترل کن.`});
  };

  const createCase = async () => {
    if (!caseForm.client.trim()) return showError('صاحب کالا برای ایجاد پرونده الزامی است. ثبت سفارش می‌تواند بعداً اضافه شود.');
    setIsProcessing(true); setStatusMessage({type:'info',text:'در حال ایجاد پرونده...'});
    try {
      const {data,error}=await supabase.rpc('create_case_workflow',{p_client_name:caseForm.client.trim(),p_registration_order_no:null});
      if(error) throw error;
      setCaseId(data);
      if(caseForm.regNumber.trim()) {
        const {error:regError}=await supabase.rpc('attach_registration_order',{p_case_id:data,p_order_number:caseForm.regNumber.trim(),p_order_date:caseForm.regDate||null,p_status:'received',p_tariff_code:operationForm.tariffCode||null,p_quantity:parseNum(operationForm.cargoCount),p_quantity_unit:operationForm.cargoCountUnit||null,p_value_amount:parseNum(operationForm.invoiceAmount),p_currency:operationForm.invoiceCurrency||null,p_notes:null});
        if(regError) throw regError;
      }
      setCaseForm(p=>({...p,regNumber:'',regDate:''})); setActiveTab('operation'); setStatusMessage({type:'success',text:`پرونده ایجاد شد. ${caseForm.regNumber?'ثبت سفارش هم به پرونده متصل شد.':'پرونده بدون ثبت سفارش ایجاد شد.'}`});
    }catch(e:any){showError(`خطا در ایجاد پرونده: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}
  };

  const saveOperationData = async () => {
    if(!caseId) return showError('ابتدا پرونده را ایجاد کنید.');
    const nums=['cargoCount','invoiceAmount','netWeight','grossWeight','insuranceIrr','dutyRate'] as const;
    for(const key of nums){const value=parseNum(operationForm[key]);if(value!==null&&(!Number.isFinite(value)||value<0))return showError(`مقدار ${key} معتبر نیست.`)}
    if(operationForm.billOfLading.trim() && !operationForm.shippingLine.trim()) return showError('برای ثبت B/L، نام کشتیرانی الزامی است.');
    setIsProcessing(true);setStatusMessage({type:'info',text:'در حال ذخیره اطلاعات عملیاتی و دریایی...'});
    try{
      const {error}=await supabase.rpc('update_case_operational_data',{p_case_id:caseId,p_vessel_type:operationForm.vesselType||null,p_unloading_date:operationForm.unloadingDate||null,p_warehouse_receipt_no:operationForm.warehouseReceiptNo||null,p_warehouse_receipt_date:operationForm.warehouseReceiptDate||null,p_release_status:operationForm.releaseStatus||null,p_cargo_count:parseNum(operationForm.cargoCount),p_cargo_count_unit:operationForm.cargoCountUnit||null,p_cargo_description:operationForm.cargoDescription||null,p_origin_country_code:operationForm.originCountry||null,p_transaction_country_code:operationForm.transactionCountry||null,p_delivery_term:operationForm.deliveryTerm||null,p_invoice_amount:parseNum(operationForm.invoiceAmount),p_invoice_currency:operationForm.invoiceCurrency||null,p_net_weight_kg:parseNum(operationForm.netWeight),p_gross_weight_kg:parseNum(operationForm.grossWeight),p_insurance_amount_irr:parseNum(operationForm.insuranceIrr),p_tariff_code:operationForm.tariffCode||null,p_import_duty_rate:parseNum(operationForm.dutyRate)});
      if(error)throw error;
      if(operationForm.billOfLading.trim()){
        const {error:shipError}=await supabase.rpc('register_shipment_workflow',{p_case_id:caseId,p_shipping_line:operationForm.shippingLine.trim(),p_bill_of_lading_no:operationForm.billOfLading.trim(),p_bill_of_lading_year:Number(operationForm.billYear)||new Date().getFullYear(),p_vessel_name:operationForm.vesselName.trim(),p_gross_weight_kg:parseNum(operationForm.grossWeight)||1,p_transport_mode:'sea'});
        if(shipError)throw shipError;
      }
      setActiveTab('valuation');setStatusMessage({type:'success',text:'اطلاعات پرونده، محموله و B/L ذخیره شد.'});
    }catch(e:any){showError(`خطا در ذخیره اطلاعات: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}
  };

  const calculateValuation = async()=>{
    if(!caseId)return showError('ابتدا پرونده را ایجاد کنید.');
    const fx=parseNum(valuationForm.fxRate),duty=parseNum(valuationForm.dutyRate),vat=parseNum(valuationForm.vatRate);
    if(fx===null||fx<=0)return showError('نرخ ارز مبادله‌ای گمرک الزامی است.');if(duty===null||duty<0)return showError('درصد حقوق ورودی معتبر نیست.');if(vat===null||vat<0)return showError('نرخ VAT معتبر نیست.');
    setIsProcessing(true);setStatusMessage({type:'info',text:'در حال محاسبه ارزش و عوارض...'});
    try{const {data,error}=await supabase.rpc('calculate_case_valuation',{p_case_id:caseId,p_customs_fx_rate_irr:fx,p_import_duty_rate:duty,p_vat_rate:vat});if(error)throw error;setValuationResult(data);setActiveTab('declaration');setStatusMessage({type:'success',text:'محاسبه ارزش و عوارض انجام شد.'})}catch(e:any){showError(`خطا در محاسبه: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}
  };

  const registerDeclaration = async()=>{
    if(!caseId)return showError('ابتدا پرونده را ایجاد کنید.');if(!declarationForm.kottaj.trim())return showError('کوتاژ فقط بعد از ثبت اظهار در EPL وارد می‌شود.');
    setIsProcessing(true);setStatusMessage({type:'info',text:'در حال اتصال کوتاژ به پرونده...'});
    try{const {data,error}=await supabase.rpc('register_declaration_workflow',{p_case_id:caseId,p_kottaj_number:declarationForm.kottaj.trim(),p_declaration_date:new Date(`${declarationForm.declarationDate}T00:00:00`).toISOString(),p_customs_office_id:null,p_customs_path:declarationForm.customsPath||null,p_assessed_value_irr:valuationResult?.customs_value_irr??null,p_total_duties_irr:valuationResult?.total_payable_irr??null});if(error)throw error;setStatusMessage({type:'success',text:`کوتاژ ${declarationForm.kottaj} ثبت شد.`});return data}catch(e:any){showError(`خطا در ثبت کوتاژ: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}};

  const printPackage = () => window.print();
  const printData = useMemo(()=>({caseId,client:caseForm.client,reg:caseForm.regNumber,shippingLine:operationForm.shippingLine,vessel:operationForm.vesselName,voyage:operationForm.voyageNo,bl:operationForm.billOfLading,count:`${operationForm.cargoCount} ${operationForm.cargoCountUnit}`,warehouse:operationForm.warehouseReceiptNo,description:operationForm.cargoDescription,origin:operationForm.originCountry,transaction:operationForm.transactionCountry,incoterm:operationForm.deliveryTerm,invoice:`${operationForm.invoiceAmount} ${operationForm.invoiceCurrency}`,net:operationForm.netWeight,gross:operationForm.grossWeight,insurance:operationForm.insuranceIrr,hs:operationForm.tariffCode,duty:operationForm.dutyRate,kottaj:declarationForm.kottaj,path:declarationForm.customsPath,customsValue:valuationResult?.customs_value_irr,total:valuationResult?.total_payable_irr}),[caseId,caseForm,operationForm,declarationForm,valuationResult]);

  return <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl">
    <style>{`@media print{body{background:white!important}.no-print{display:none!important}.print-area{display:block!important;color:#111!important;background:white!important}.print-area table{width:100%;border-collapse:collapse}.print-area td,.print-area th{border:1px solid #999;padding:6px;text-align:right}.print-area h1,.print-area h2{color:#111!important}} .print-area{display:none}`}</style>
    <header className="no-print h-16 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between px-5"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center"><Ship size={20}/></div><div><b>Customs OS</b><div className="text-[10px] text-blue-400">سیستم مدیریت عملیات گمرکی</div></div></div><div className="flex items-center gap-4 text-xs"><span>{profile?.full_name||'—'} · {profile?.role?roleLabels[profile.role]:'—'}</span><button onClick={signOut} className="text-slate-400 hover:text-rose-400"><LogOut size={18}/></button></div></header>
    <div className="no-print max-w-7xl mx-auto p-5">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <button onClick={()=>setActiveTab('case')} className={`p-4 rounded-2xl border text-right ${activeTab==='case'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><Building2 className="mb-2 text-blue-400" size={20}/><b className="text-sm">پرونده</b><div className="text-[11px] text-slate-500 mt-1">صاحب کالا + ثبت سفارش اختیاری</div></button>
        <button onClick={()=>setActiveTab('operation')} className={`p-4 rounded-2xl border text-right ${activeTab==='operation'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><Anchor className="mb-2 text-cyan-400" size={20}/><b className="text-sm">کشتیرانی / B/L</b><div className="text-[11px] text-slate-500 mt-1">کشتی + بارنامه + تخلیه</div></button>
        <button onClick={()=>setActiveTab('valuation')} className={`p-4 rounded-2xl border text-right ${activeTab==='valuation'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><Calculator className="mb-2 text-amber-400" size={20}/><b className="text-sm">ارزش و عوارض</b><div className="text-[11px] text-slate-500 mt-1">ارزش‌گذاری</div></button>
        <button onClick={()=>setActiveTab('declaration')} className={`p-4 rounded-2xl border text-right ${activeTab==='declaration'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><FileCheck2 className="mb-2 text-emerald-400" size={20}/><b className="text-sm">EPL / کوتاژ</b><div className="text-[11px] text-slate-500 mt-1">بعد از اظهار</div></button>
        <button onClick={()=>setActiveTab('home')} className={`p-4 rounded-2xl border text-right ${activeTab==='home'?'border-blue-500 bg-blue-500/10':'border-slate-800 bg-slate-900/50'}`}><LayoutDashboard className="mb-2 text-violet-400" size={20}/><b className="text-sm">داشبورد</b><div className="text-[11px] text-slate-500 mt-1">وضعیت پرونده</div></button>
        <button onClick={printPackage} className="p-4 rounded-2xl border border-slate-800 bg-slate-900/50 text-right"><Printer className="mb-2 text-orange-400" size={20}/><b className="text-sm">چاپ فرم اظهار</b><div className="text-[11px] text-slate-500 mt-1">Print / PDF</div></button>
      </div>
      {statusMessage&&<div className={`mb-5 p-4 rounded-xl border text-sm flex items-center gap-3 ${statusMessage.type==='success'?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':statusMessage.type==='info'?'bg-blue-500/10 border-blue-500/20 text-blue-300':'bg-rose-500/10 border-rose-500/20 text-rose-300'}`}>{statusMessage.type==='success'?<CheckCircle2 size={18}/>:statusMessage.type==='info'?<Loader2 className="animate-spin" size={18}/>:<AlertCircle size={18}/>} {statusMessage.text}</div>}
      <section className="mb-5 bg-slate-900/60 border border-slate-800 rounded-2xl p-5"><div className="flex items-center gap-2 mb-3"><ClipboardPaste size={18} className="text-violet-400"/><b>Smart Paste — ورود سریع اطلاعات</b></div><p className="text-xs text-slate-500 mb-3">خروجی AIهای دیگر، متن کپی‌شده یا JSON را اینجا بچسبان. سیستم فقط استخراج و کنترل اولیه انجام می‌دهد؛ ثبت نهایی با تأیید توست.</p><textarea value={smartPaste} onChange={e=>setSmartPaste(e.target.value)} placeholder={SmartPasteHelp} className="w-full min-h-28 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs leading-6 focus:outline-none focus:border-violet-500"/><div className="flex gap-2 mt-3"><button onClick={applySmartPaste} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-bold">تحلیل و پر کردن فرم</button><button onClick={()=>setSmartPaste(SmartPasteHelp)} className="px-4 py-2 rounded-xl border border-slate-700 text-sm">نمایش قالب</button></div></section>

      {activeTab==='case'&&<section className="max-w-3xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">ایجاد پرونده گمرکی</h1><p className="text-xs text-slate-500 mt-1 mb-6">صاحب کالا به ثبت سفارش وابسته نیست. اگر ثبت سفارش هنوز نرسیده، پرونده را همین حالا ایجاد کن و بعداً آن را متصل کن.</p><div className="grid md:grid-cols-3 gap-4"><Field label="صاحب کالا / شرکت *" value={caseForm.client} onChange={v=>setCaseForm({...caseForm,client:v})} placeholder="مثلاً آذرفولاد امین"/><Field label="شماره ثبت سفارش (اختیاری)" value={caseForm.regNumber} onChange={v=>setCaseForm({...caseForm,regNumber:v})}/><Field label="تاریخ ثبت سفارش" value={caseForm.regDate} onChange={v=>setCaseForm({...caseForm,regDate:v})} placeholder="1405/02/05"/></div><button onClick={createCase} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm"><Save size={17} className="inline ml-2"/> ایجاد پرونده</button></section>}

      {activeTab==='operation'&&<section className="max-w-6xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><div className="flex justify-between items-start mb-6"><div><h1 className="text-lg font-bold">کشتیرانی، کشتی، B/L، تخلیه و اسناد پایه</h1><p className="text-xs text-slate-500 mt-1">این اطلاعات می‌تواند قبل از رسیدن ثبت سفارش وارد پرونده شود.</p></div><span className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">Case: <span dir="ltr">{caseId||'—'}</span></span></div><div className="grid md:grid-cols-4 gap-4 mb-6"><Field label="کشتیرانی" value={operationForm.shippingLine} onChange={v=>setOperationForm({...operationForm,shippingLine:v})}/><Field label="نام کشتی" value={operationForm.vesselName} onChange={v=>setOperationForm({...operationForm,vesselName:v})}/><Field label="Voyage" value={operationForm.voyageNo} onChange={v=>setOperationForm({...operationForm,voyageNo:v})}/><Field label="نوع کشتی" value={operationForm.vesselType} onChange={v=>setOperationForm({...operationForm,vesselType:v})}/><Field label="شماره B/L" value={operationForm.billOfLading} onChange={v=>setOperationForm({...operationForm,billOfLading:v})}/><Field label="سال B/L" value={operationForm.billYear} onChange={v=>setOperationForm({...operationForm,billYear:v})}/><Field label="بندر بارگیری" value={operationForm.originPort} onChange={v=>setOperationForm({...operationForm,originPort:v})}/><Field label="بندر تخلیه" value={operationForm.destinationPort} onChange={v=>setOperationForm({...operationForm,destinationPort:v})}/></div><div className="border-t border-slate-800 pt-5"><h2 className="font-bold mb-4 flex items-center gap-2"><PackageCheck size={18} className="text-emerald-400"/> تخلیه، قبض انبار، بارشماری و ترخیصیه</h2><div className="grid md:grid-cols-4 gap-4"><Field label="تاریخ تخلیه" value={operationForm.unloadingDate} onChange={v=>setOperationForm({...operationForm,unloadingDate:v})}/><Field label="شماره قبض انبار" value={operationForm.warehouseReceiptNo} onChange={v=>setOperationForm({...operationForm,warehouseReceiptNo:v})}/><Field label="تاریخ قبض انبار" value={operationForm.warehouseReceiptDate} onChange={v=>setOperationForm({...operationForm,warehouseReceiptDate:v})}/><Field label="شماره بارشماری" value={operationForm.tallyNo} onChange={v=>setOperationForm({...operationForm,tallyNo:v})}/><Field label="شماره ترخیصیه" value={operationForm.releaseInvoiceNo} onChange={v=>setOperationForm({...operationForm,releaseInvoiceNo:v})}/><Field label="تاریخ ترخیصیه" value={operationForm.releaseInvoiceDate} onChange={v=>setOperationForm({...operationForm,releaseInvoiceDate:v})}/><Field label="ترخیصیه الکترونیک" value={operationForm.electronicReleaseNo} onChange={v=>setOperationForm({...operationForm,electronicReleaseNo:v})}/><label className="block"><span className="block text-xs text-slate-400 mb-1.5">وضعیت ترخیصیه</span><select value={operationForm.releaseStatus} onChange={e=>setOperationForm({...operationForm,releaseStatus:e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="pending">در انتظار</option><option value="invoice_received">فاکتور دریافت شد</option><option value="paid">پرداخت شد</option><option value="released">آزاد شد</option></select></label></div></div><div className="border-t border-slate-800 pt-5 mt-5"><h2 className="font-bold mb-4">اطلاعات کالا و اسناد تجاری</h2><div className="grid md:grid-cols-4 gap-4"><Field label="تعداد" value={operationForm.cargoCount} onChange={v=>setOperationForm({...operationForm,cargoCount:v})}/><Field label="واحد" value={operationForm.cargoCountUnit} onChange={v=>setOperationForm({...operationForm,cargoCountUnit:v})}/><Field label="شرح کالا" value={operationForm.cargoDescription} onChange={v=>setOperationForm({...operationForm,cargoDescription:v})}/><Field label="مبدأ" value={operationForm.originCountry} onChange={v=>setOperationForm({...operationForm,originCountry:v})}/><Field label="کشور معامله" value={operationForm.transactionCountry} onChange={v=>setOperationForm({...operationForm,transactionCountry:v})}/><Field label="اینکوترمز" value={operationForm.deliveryTerm} onChange={v=>setOperationForm({...operationForm,deliveryTerm:v})}/><Field label="مبلغ فاکتور" value={operationForm.invoiceAmount} onChange={v=>setOperationForm({...operationForm,invoiceAmount:v})}/><Field label="ارز" value={operationForm.invoiceCurrency} onChange={v=>setOperationForm({...operationForm,invoiceCurrency:v})}/><Field label="وزن خالص (kg)" value={operationForm.netWeight} onChange={v=>setOperationForm({...operationForm,netWeight:v})}/><Field label="وزن ناخالص (kg)" value={operationForm.grossWeight} onChange={v=>setOperationForm({...operationForm,grossWeight:v})}/><Field label="بیمه (ریال)" value={operationForm.insuranceIrr} onChange={v=>setOperationForm({...operationForm,insuranceIrr:v})}/><Field label="HS Code" value={operationForm.tariffCode} onChange={v=>setOperationForm({...operationForm,tariffCode:v})}/><Field label="حقوق ورودی %" value={operationForm.dutyRate} onChange={v=>setOperationForm({...operationForm,dutyRate:v})}/></div><Field label="شرح کالا / توضیحات تکمیلی" value={operationForm.cargoDescription} onChange={v=>setOperationForm({...operationForm,cargoDescription:v})}/></div><button onClick={saveOperationData} disabled={isProcessing} className="mt-6 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold text-sm">ذخیره اطلاعات دریایی و عملیاتی</button></section>}

      {activeTab==='valuation'&&<section className="max-w-3xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">ارزش‌گذاری</h1><p className="text-xs text-slate-500 mt-1 mb-6">این محاسبه فعلاً موتور اولیه است و قبل از نهایی‌سازی قانونی باید قواعد واقعی هر نوع کالا/قرارداد کنترل شود.</p><div className="grid md:grid-cols-3 gap-4"><Field label="نرخ ارز مبادله‌ای گمرک" value={valuationForm.fxRate} onChange={v=>setValuationForm({...valuationForm,fxRate:v})}/><Field label="حقوق ورودی %" value={valuationForm.dutyRate||operationForm.dutyRate} onChange={v=>setValuationForm({...valuationForm,dutyRate:v})}/><Field label="VAT %" value={valuationForm.vatRate} onChange={v=>setValuationForm({...valuationForm,vatRate:v})}/></div><button onClick={calculateValuation} disabled={isProcessing} className="mt-5 w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-bold">محاسبه</button>{valuationResult&&<div className="mt-5 grid md:grid-cols-3 gap-3">{[['ارزش گمرکی',valuationResult.customs_value_irr],['حقوق ورودی',valuationResult.import_duty_irr],['قابل پرداخت',valuationResult.total_payable_irr]].map(([k,v])=><div key={String(k)} className="bg-slate-950 rounded-xl p-4"><div className="text-xs text-slate-500">{k}</div><b>{fmt(v)}</b> ریال</div>)}</div>}</section>}

      {activeTab==='declaration'&&<section className="max-w-4xl bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h1 className="text-lg font-bold">EPL / کوتاژ</h1><p className="text-xs text-slate-500 mt-1 mb-6">کوتاژ خروجی اظهار در EPL است و اینجا بعد از دریافت از همکار ثبت می‌شود.</p><div className="grid md:grid-cols-3 gap-4"><Field label="شماره کوتاژ" value={declarationForm.kottaj} onChange={v=>setDeclarationForm({...declarationForm,kottaj:v})}/><Field label="تاریخ اظهار" value={declarationForm.declarationDate} onChange={v=>setDeclarationForm({...declarationForm,declarationDate:v})} type="date"/><label className="block"><span className="block text-xs text-slate-400 mb-1.5">مسیر</span><select value={declarationForm.customsPath} onChange={e=>setDeclarationForm({...declarationForm,customsPath:e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="">تعیین نشده</option><option value="green">سبز</option><option value="yellow">زرد</option><option value="red">قرمز</option></select></label></div><div className="mt-5 grid md:grid-cols-3 gap-3"><div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20"><b>مجوزها</b><div className="text-xs text-slate-400 mt-1">بر اساس HS و نوع کالا تعیین می‌شوند.</div></div><div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20"><b>ارزیابی</b><div className="text-xs text-slate-400 mt-1">بر اساس مسیر؛ سبز نیاز به ارزیابی ندارد.</div></div><div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20"><b>چاپ</b><div className="text-xs text-slate-400 mt-1">همین فرم برای ارسال به همکار قابل چاپ است.</div></div></div><div className="flex gap-3 mt-5"><button onClick={registerDeclaration} disabled={isProcessing} className="flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-bold">ثبت کوتاژ</button><button onClick={printPackage} className="px-5 py-3 rounded-xl border border-slate-700 font-bold"><Printer size={17} className="inline ml-2"/> چاپ / PDF</button></div></section>}

      {activeTab==='home'&&<section className="max-w-5xl grid md:grid-cols-2 gap-4"><div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h2 className="font-bold mb-4">پرونده جاری</h2><div className="text-sm space-y-2"><div>صاحب کالا: {fmt(caseForm.client)}</div><div>پرونده: <span dir="ltr">{fmt(caseId)}</span></div><div>B/L: <span dir="ltr">{fmt(operationForm.billOfLading)}</span></div><div>کوتاژ: <span dir="ltr">{fmt(declarationForm.kottaj)}</span></div><div>مسیر: {fmt(declarationForm.customsPath)}</div></div></div><div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6"><h2 className="font-bold mb-4">گام بعدی</h2><p className="text-sm text-slate-400">بعد از اظهار، موتور قوانین پرونده را بر اساس مسیر، HS و نوع کالا بررسی می‌کند و فقط اقدامات لازم مثل ارزیابی یا مجوزها را فعال خواهد کرد.</p></div></section>}
    </div>

    <section className="print-area p-8" dir="rtl">
      <div className="flex justify-between items-start mb-5"><div><h1 className="text-2xl font-bold">برگه اطلاعات اظهار گمرکی — Customs OS</h1><div>پرونده: {fmt(printData.caseId)}</div></div><div>تاریخ چاپ: {new Date().toLocaleDateString('fa-IR')}</div></div>
      <h2 className="text-lg font-bold mt-4 mb-2">۱. صاحب کالا و ثبت سفارش</h2><table><tbody><tr><th>صاحب کالا</th><td>{fmt(printData.client)}</td><th>ثبت سفارش</th><td>{fmt(printData.reg)}</td></tr></tbody></table>
      <h2 className="text-lg font-bold mt-4 mb-2">۲. حمل دریایی</h2><table><tbody><tr><th>کشتیرانی</th><td>{fmt(printData.shippingLine)}</td><th>کشتی</th><td>{fmt(printData.vessel)}</td></tr><tr><th>Voyage</th><td>{fmt(printData.voyage)}</td><th>B/L</th><td dir="ltr">{fmt(printData.bl)}</td></tr></tbody></table>
      <h2 className="text-lg font-bold mt-4 mb-2">۳. کالا و اسناد</h2><table><tbody><tr><th>تعداد</th><td>{fmt(printData.count)}</td><th>قبض انبار</th><td>{fmt(printData.warehouse)}</td></tr><tr><th>شرح کالا</th><td colSpan={3}>{fmt(printData.description)}</td></tr><tr><th>مبدأ</th><td>{fmt(printData.origin)}</td><th>کشور معامله</th><td>{fmt(printData.transaction)}</td></tr><tr><th>اینکوترمز</th><td>{fmt(printData.incoterm)}</td><th>فاکتور</th><td>{fmt(printData.invoice)}</td></tr><tr><th>وزن خالص</th><td>{fmt(printData.net)}</td><th>وزن ناخالص</th><td>{fmt(printData.gross)}</td></tr><tr><th>بیمه ریالی</th><td>{fmt(printData.insurance)}</td><th>HS Code</th><td dir="ltr">{fmt(printData.hs)}</td></tr><tr><th>حقوق ورودی</th><td>{fmt(printData.duty)}%</td><th>کوتاژ</th><td dir="ltr">{fmt(printData.kottaj)}</td></tr><tr><th>مسیر</th><td>{fmt(printData.path)}</td><th>ارزش گمرکی</th><td>{fmt(printData.customsValue)} ریال</td></tr><tr><th>مجموع پرداختی</th><td>{fmt(printData.total)} ریال</td><th>وضعیت</th><td>برای اظهار / کنترل همکار</td></tr></tbody></table>
      <div className="mt-8 text-sm">این برگه از اطلاعات ثبت‌شده در Customs OS تولید شده و باید قبل از ثبت نهایی اظهار با اسناد اصلی کنترل شود.</div>
    </section>
  </div>;
};
