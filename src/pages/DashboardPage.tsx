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

// Converts Persian/Jalali dates such as 1405/02/29 to Gregorian YYYY-MM-DD for PostgreSQL date columns.
const normalizeDateForDb = (value: string | null | undefined): string | null => {
  const raw = (value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[.-]/g, '/');
  const parts = normalized.split('/').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return raw;
  let [y, m, d] = parts;
  if (y >= 1300 && y <= 1600) {
    // Jalali -> Gregorian, integer arithmetic algorithm.
    y -= 979;
    let gy = 1600 + 400 * Math.floor(y / 12053);
    y %= 12053;
    gy += 4 * Math.floor(y / 1461);
    y %= 1461;
    if (y > 365) { gy += Math.floor((y - 1) / 365); y = (y - 1) % 365; }
    let days = y * 365 + Math.floor(y / 4) + (m <= 6 ? (m - 1) * 31 : (m - 7) * 30 + 186) + (d - 1);
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 1;
    while (days >= monthDays[gm - 1]) { days -= monthDays[gm - 1]; gm++; }
    return `${gy}-${String(gm).padStart(2, '0')}-${String(days + 1).padStart(2, '0')}`;
  }
  if (y >= 1900 && y <= 2200) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return raw;
};

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
        const {error:regError}=await supabase.rpc('attach_registration_order',{p_case_id:data,p_order_number:caseForm.regNumber.trim(),p_order_date:normalizeDateForDb(caseForm.regDate),p_status:'received',p_tariff_code:operationForm.tariffCode||null,p_quantity:parseNum(operationForm.cargoCount),p_quantity_unit:operationForm.cargoCountUnit||null,p_value_amount:parseNum(operationForm.invoiceAmount),p_currency:operationForm.invoiceCurrency||null,p_notes:null});
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
      const {error}=await supabase.rpc('update_case_operational_data',{p_case_id:caseId,p_vessel_type:operationForm.vesselType||null,p_unloading_date:normalizeDateForDb(operationForm.unloadingDate),p_warehouse_receipt_no:operationForm.warehouseReceiptNo||null,p_warehouse_receipt_date:normalizeDateForDb(operationForm.warehouseReceiptDate),p_release_status:operationForm.releaseStatus||null,p_cargo_count:parseNum(operationForm.cargoCount),p_cargo_count_unit:operationForm.cargoCountUnit||null,p_cargo_description:operationForm.cargoDescription||null,p_origin_country_code:operationForm.originCountry||null,p_transaction_country_code:operationForm.transactionCountry||null,p_delivery_term:operationForm.deliveryTerm||null,p_invoice_amount:parseNum(operationForm.invoiceAmount),p_invoice_currency:operationForm.invoiceCurrency||null,p_net_weight_kg:parseNum(operationForm.netWeight),p_gross_weight_kg:parseNum(operationForm.grossWeight),p_insurance_amount_irr:parseNum(operationForm.insuranceIrr),p_tariff_code:operationForm.tariffCode||null,p_import_duty_rate:parseNum(operationForm.dutyRate)});
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
    try{const {data,error}=await supabase.rpc('calculate_case_valuation',{p_case_id:caseId,p_customs_fx_rate_irr:fx,p_import_duty_rate:duty,p_vat_rate:vat});if(error)throw error;setValuationResult(data);setActiveTab('declaration');setStatusMessage({type:'success',text:'محاسبه ارزش و عوارض انجام شد.'})}catch(e:any){showError(`خطا در محاسبه: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}};

  const registerDeclaration = async()=>{
    if(!caseId)return showError('ابتدا پرونده را ایجاد کنید.');if(!declarationForm.kottaj.trim())return showError('کوتاژ فقط بعد از ثبت اظهار در EPL وارد می‌شود.');
    setIsProcessing(true);setStatusMessage({type:'info',text:'در حال اتصال کوتاژ به پرونده...'});
    try{const {data,error}=await supabase.rpc('register_declaration_workflow',{p_case_id:caseId,p_kottaj_number:declarationForm.kottaj.trim(),p_declaration_date:normalizeDateForDb(declarationForm.declarationDate),p_customs_office_id:null,p_customs_path:declarationForm.customsPath||null,p_assessed_value_irr:valuationResult?.customs_value_irr??null,p_total_duties_irr:valuationResult?.total_payable_irr??null});if(error)throw error;setStatusMessage({type:'success',text:`کوتاژ ${declarationForm.kottaj} ثبت شد.`});return data}catch(e:any){showError(`خطا در ثبت کوتاژ: ${e?.message||'خطای نامشخص'}`)}finally{setIsProcessing(false)}};

  const printPackage = () => window.print();
  const printData = useMemo(()=>({caseId,client:caseForm.client,reg:caseForm.regNumber,shippingLine:operationForm.shippingLine,vessel:operationForm.vesselName,voyage:operationForm.voyageNo,bl:operationForm.billOfLading,count:`${operationForm.cargoCount} ${operationForm.cargoCountUnit}`,warehouse:operationForm.warehouseReceiptNo,description:operationForm.cargoDescription,origin:operationForm.originCountry,transaction:operationForm.transactionCountry,incoterm:operationForm.deliveryTerm,invoice:`${operationForm.invoiceAmount} ${operationForm.invoiceCurrency}`,net:operationForm.netWeight,gross:operationForm.grossWeight,insurance:operationForm.insuranceIrr,hs:operationForm.tariffCode,duty:operationForm.dutyRate,kottaj:declarationForm.kottaj,path:declarationForm.customsPath,customsValue:valuationResult?.customs_value_irr,total:valuationResult?.total_payable_irr}),[caseId,caseForm,operationForm,declarationForm,valuationResult]);

  return <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl">{/* UI unchanged */}</div>;
};