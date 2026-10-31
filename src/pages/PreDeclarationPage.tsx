import React,{useEffect,useMemo,useState}from'react';
import{CalendarDays,Calculator,Check,Copy,FileSearch,Loader2,Printer,RotateCcw,Save,Sparkles,ClipboardPaste}from'lucide-react';
import{Link,useSearchParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{normalizeRegistrationOrderNumber,registrationOrderNumberVariants,resolveLegacyRegistrationBankDetails}from'../lib/registrationOrderLookup';
import{useAuth}from'../context/AuthContext';
import{useAutosavedDraft,formDraftKey}from'../hooks/useAutosavedDraft';
import{FormDraftIndicator}from'../components/FormDraftIndicator';
import {ShipmentStageCosts} from '../features/finance/ShipmentStageCosts';
import { extractDocumentText } from '../lib/documentTextExtraction';
type V=Record<string,string>;
type Shipment={id:string;client_id:string|null;shipping_line:string|null;bill_of_lading_no:string|null;cargo_count:number|null;cargo_count_unit:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;current_status:string;display_name:string|null;customs_office_id?:string|null;case_id?:string|null;registration_order_id?:string|null;organization_id?:string};type RegistrationOrderShared={id:string|null;order_number:string;order_date:string|null;currency:string|null;bank_name:string|null;bank_branch:string|null;bank_branch_code:string|null;payment_instrument_code:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;value_amount:number|null;client_id?:string|null;is_closed?:boolean;legacy_source_count?:number;legacy_conflicts?:string[]};
type CustomsOffice={id:string;organization_id:string|null;code:string;name:string;city:string;is_active:boolean};
const customsRegimes=[['import_definitive','واردات قطعی'],['export_definitive','صادرات قطعی'],['temporary_export','صادرات موقت'],['import_temporary','ورود موقت'],['temporary_processing','ورود موقت برای پردازش'],['re_export','مرجوعی / اعاده به خارج'],['external_transit','ترانزیت خارجی'],['internal_transit','ترانزیت داخلی'],['re_import','ورود مجدد'],['cabotage','کابوتاژ'],['customs_warehouse','ورود به انبار گمرکی'],['free_zone','رویه منطقه آزاد'],['other','سایر رویه‌ها']] as const;
type Doc={id:string;document_name:string;original_file_name:string;storage_path:string;mime_type:string;size_bytes?:number;storage_backend?:'supabase'|'telegram';file_asset_id?:string|null;folder_id?:string|null;source:'shipment_documents'|'customs_documents'};
const fields:[string,string][]=[['vesselType','نوع کشتی'],['regNumber','شماره ثبت سفارش'],['regDate','تاریخ ثبت سفارش'],['packageCount','تعداد'],['warehouseReceiptNo','شماره قبض انبار'],['warehouseReceiptDate','تاریخ قبض انبار'],['cargoDescription','شرح کالا'],['originCountry','کشور مبدا'],['transactionCountry','کشور طرف معامله'],['deliveryTerm','شرایط تحویل'],['invoiceAmount','مبلغ کل فاکتور'],['invoiceCurrency','ارز'],['dutyRate','ماخذ حقوق ورودی'],['tariffCode','کد تعرفه کالا'],['netWeight','وزن خالص'],['grossWeight','وزن ناخالص'],['billOfLading','شماره بارنامه'],['sataCode','کد ساتا این محموله'],['insuranceIrr','بیمه (ریال)']];
const blank:V=Object.fromEntries(fields.map(([k])=>[k,'']));
const normalize=(x:any)=>String(x??'').trim();
const digits=(s:string)=>s.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const weightKg=(x:any)=>{const s=digits(String(x??'')).replace(/,/g,'').replace(/٬/g,'').trim();const m=s.match(/(-?\d+(?:\.\d+)?)\s*(MT|M\/T|TONNES?|TON|T|تن|کیلوگرم|کیلو|KG|KGS|G|GRAMS?|گرم)?/i);if(!m)return '';const n=Number(m[1]);if(!Number.isFinite(n))return '';const u=String(m[2]||'').toUpperCase();return String(Math.round(/^(MT|M\/T|TONNES?|TON|T|تن)$/.test(u)?n*1000:/^(G|GRAMS?|گرم)$/.test(u)?n/1000:n))};
const num=(x:string)=>{const n=Number(digits(x).replace(/[٬,]/g,''));return Number.isFinite(n)?n:null};

const jalaliFormatter=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'numeric',day:'numeric'});
type JalaliParts={year:number;month:number;day:number};
const jalaliMonths=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const jalaliWeekdays=['ش','ی','د','س','چ','پ','ج'];
const faDigits=(value:string|number)=>String(value).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const jalaliParts=(date:Date):JalaliParts=>{const p=jalaliFormatter.formatToParts(date);const get=(k:string)=>Number(p.find(x=>x.type===k)?.value||0);return{year:get('year'),month:get('month'),day:get('day')}};
const parseJalali=(value:string):JalaliParts|null=>{const m=digits(value).trim().match(/^(\d{3,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(!m)return null;const p={year:Number(m[1]),month:Number(m[2]),day:Number(m[3])};return p.year>=1200&&p.year<=1600&&p.month>=1&&p.month<=12&&p.day>=1&&p.day<=31?p:null};
const formatJalali=(p:JalaliParts)=>String(p.year)+'/'+String(p.month).padStart(2,'0')+'/'+String(p.day).padStart(2,'0');
const findJalaliMonthStart=(year:number,month:number):Date|null=>{const d=new Date(year+621,2,1,12);for(let i=0;i<370;i++){const p=jalaliParts(d);if(p.year===year&&p.month===month&&p.day===1)return d;d.setDate(d.getDate()+1)}return null};
const normalizeVesselType=(value:any)=>{const s=String(value??'').trim().toLowerCase();if(!s)return'';if(/خارج|foreign|international/.test(s))return'خارجی';if(/ایران|iran|داخلی|national/.test(s))return'ایرانی';return s==='ایرانی'||s==='خارجی'?s:''};

const JalaliDatePicker:React.FC<{value:string;onChange:(value:string)=>void;label:string}> = ({value,onChange,label})=>{
 const initial=parseJalali(value)||jalaliParts(new Date());
 const[open,setOpen]=useState(false);
 const[view,setView]=useState({year:initial.year,month:initial.month});
 useEffect(()=>{if(open){const p=parseJalali(value);if(p)setView({year:p.year,month:p.month})}},[open,value]);
 const days=useMemo(()=>{const first=findJalaliMonthStart(view.year,view.month);if(!first)return[];const offset=(first.getDay()+1)%7;const start=new Date(first.getFullYear(),first.getMonth(),first.getDate()-offset,12);return Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i,12))},[view.year,view.month]);
 const selected=parseJalali(value);
 const moveMonth=(delta:number)=>setView(prev=>{let month=prev.month+delta;let year=prev.year;if(month<1){month=12;year--}if(month>12){month=1;year++}return{year,month}});
 return <div className="relative flex min-w-0 gap-2">
  <input aria-label={label} value={faDigits(value)} onChange={e=>onChange(digits(e.target.value).replace(/[-.]/g,'/'))} placeholder="۱۴۰۵/۰۷/۱۸" className="w-full min-w-0 rounded-xl border app-border bg-[var(--surface-2)] p-3"/>
  <button type="button" aria-label={'انتخاب '+label+' از تقویم شمسی'} onClick={()=>setOpen(v=>!v)} className="shrink-0 rounded-xl border app-border bg-[var(--surface-2)] px-3" title="تقویم شمسی"><CalendarDays size={18}/></button>
  {open&&<div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[85vw] rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl" role="dialog" aria-label={'تقویم شمسی '+label}>
   <div className="mb-3 flex items-center justify-between gap-2"><button type="button" onClick={()=>moveMonth(-1)} className="rounded-lg border app-border px-3 py-1.5" aria-label="ماه قبل">‹</button><b className="text-sm">{jalaliMonths[view.month-1]} {faDigits(view.year)}</b><button type="button" onClick={()=>moveMonth(1)} className="rounded-lg border app-border px-3 py-1.5" aria-label="ماه بعد">›</button></div>
   <div className="mb-1 grid grid-cols-7 gap-1">{jalaliWeekdays.map((day,i)=><span key={day+i} className="py-1 text-center text-xs app-muted">{day}</span>)}</div>
   <div className="grid grid-cols-7 gap-1">{days.map(date=>{const p=jalaliParts(date);const current=p.year===view.year&&p.month===view.month;const isSelected=!!selected&&p.year===selected.year&&p.month===selected.month&&p.day===selected.day;const today=date.toDateString()===new Date().toDateString();return <button key={date.toISOString()} type="button" onClick={()=>{onChange(formatJalali(p));setOpen(false)}} className={'min-h-9 rounded-lg text-sm '+(isSelected?'bg-[var(--primary)] text-white font-bold':current?'hover:bg-[var(--surface-2)]':'app-muted opacity-40')+(today&&!isSelected?' border border-[var(--primary)]':'')} aria-pressed={isSelected}>{faDigits(p.day)}</button>})}</div>
   <div className="mt-3 flex justify-between"><button type="button" onClick={()=>{onChange('');setOpen(false)}} className="text-xs app-muted underline">پاک کردن تاریخ</button><button type="button" onClick={()=>{const p=jalaliParts(new Date());onChange(formatJalali(p));setView({year:p.year,month:p.month});setOpen(false)}} className="text-xs font-bold text-[var(--primary)]">امروز</button></div>
  </div>}
 </div>
};

const calculateExpression=(expression:string):number|null=>{try{const source=digits(expression).replace(/[٬,\s]/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/[−–]/g,'-').replace(/٫/g,'.');if(!source)return null;let i=0;const parseExpression=():number=>{let n=parseTerm();while(source[i]==='+'||source[i]==='-'){const op=source[i++];const rhs=parseTerm();n=op==='+'?n+rhs:n-rhs}return n};const parseTerm=():number=>{let n=parseUnary();while(source[i]==='*'||source[i]==='/'){const op=source[i++];const rhs=parseUnary();if(op==='/'&&rhs===0)throw new Error('تقسیم بر صفر');n=op==='*'?n*rhs:n/rhs}return n};const parseUnary=():number=>{if(source[i]==='+'){i++;return parseUnary()}if(source[i]==='-'){i++;return-parseUnary()}return parsePrimary()};const parsePrimary=():number=>{let n:number;if(source[i]==='('){i++;n=parseExpression();if(source[i]!==')')throw new Error('پرانتز ناقص است');i++}else{const start=i;while(/[0-9.]/.test(source[i]||''))i++;if(start===i)throw new Error('عدد نامعتبر است');const token=source.slice(start,i);if((token.match(/\./g)||[]).length>1)throw new Error('عدد نامعتبر است');n=Number(token);if(!Number.isFinite(n))throw new Error('عدد نامعتبر است')}if(source[i]==='%'){n/=100;i++}return n};const result=parseExpression();if(i!==source.length||!Number.isFinite(result))return null;return result}catch{return null}};
const formatPersianNumber=(value:number)=>new Intl.NumberFormat('fa-IR',{maximumFractionDigits:6}).format(value);

const InsuranceCalculator:React.FC<{initialValue:string;onApply:(value:string)=>void;onClose:()=>void}> = ({initialValue,onApply,onClose})=>{
 const[expression,setExpression]=useState(digits(initialValue));
 const result=useMemo(()=>calculateExpression(expression),[expression]);
 const press=(key:string)=>{if(key==='C'){setExpression('');return}if(key==='⌫'){setExpression(v=>v.slice(0,-1));return}if(key==='='){if(result!==null)setExpression(String(Number(result.toPrecision(12))));return}const value=key==='٫'?'.':key==='×'?'*':key==='÷'?'/':key==='−'?'-':key;setExpression(v=>v+value)};
 const keys=['۷','۸','۹','÷','۴','۵','۶','×','۱','۲','۳','−','۰','٫','%','+','(',')','⌫','C','='];
 return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={onClose}>
  <section dir="rtl" role="dialog" aria-modal="true" aria-label="ماشین‌حساب مبلغ بیمه" onClick={e=>e.stopPropagation()} className="w-full max-w-sm rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
   <header className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-black"><Calculator size={20}/>ماشین‌حساب مبلغ بیمه</div><button type="button" onClick={onClose} className="rounded-lg border app-border px-3 py-1" aria-label="بستن">×</button></header>
   <label className="block text-xs app-muted">عبارت محاسباتی</label>
   <input autoFocus value={faDigits(expression).replace(/\*/g,'×').replace(/\//g,'÷').replace(/-/g,'−').replace(/\./g,'٫')} onChange={e=>setExpression(digits(e.target.value).replace(/[×xX]/g,'*').replace(/÷/g,'/').replace(/[−–]/g,'-').replace(/٫/g,'.'))} dir="ltr" inputMode="decimal" className="mt-1 w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-left text-lg font-bold"/>
   <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">نتیجه (ریال)</div><div className="mt-1 min-h-7 text-xl font-black">{result===null?'—':formatPersianNumber(result)}</div></div>
   <div className="mt-3 grid grid-cols-4 gap-2">{keys.map(key=><button type="button" key={key} onClick={()=>press(key)} className={'min-h-11 rounded-xl border app-border font-bold '+(key==='='?'bg-[var(--primary)] text-white':key==='C'?'text-red-500':'bg-[var(--surface-2)]')} aria-label={key==='⌫'?'حذف رقم آخر':key==='C'?'پاک کردن':key}>{key}</button>)}</div>
   <div className="mt-3 flex gap-2"><button type="button" onClick={onClose} className="flex-1 rounded-xl border app-border px-3 py-3 font-bold">انصراف</button><button type="button" disabled={result===null} onClick={()=>{if(result!==null){onApply(String(Math.round(result)));onClose()}}} className="flex-1 rounded-xl bg-[var(--primary)] px-3 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">انتقال به مبلغ بیمه</button></div>
  </section>
 </div>
};

const line=(text:string,label:string)=>{for(const raw of text.replace(/\r/g,'').split('\n')){const x=raw.trim();if(x.toLowerCase().startsWith(label.toLowerCase()+':')||x.startsWith(label+'：'))return x.slice(x.indexOf(':')>=0?x.indexOf(':')+1:x.indexOf('：')+1).trim()}return ''};
const parseSmartPaste=(text:string):V=>{const out:{[k:string]:string}={...blank};const first=text.replace(/\r/g,'').split('\n').find(x=>x.trim())||'';const m=first.match(/^(\d+)\s*(?:رول|roll|عدد|کیسه|تن)?/i);if(m)out.packageCount=digits(m[1]);const map:[keyof V,string][]=[['vesselType','نوع کشتی'],['regNumber','شماره ثبت سفارش'],['regDate','تاریخ ثبت سفارش'],['warehouseReceiptNo','شماره قبض انبار'],['warehouseReceiptDate','تاریخ قبض انبار'],['cargoDescription','شرح کالا'],['originCountry','کشور مبدا'],['transactionCountry','کشور طرف معامله'],['deliveryTerm','شرایط تحویل'],['invoiceAmount','مبلغ کل فاکتور'],['invoiceCurrency','ارز'],['dutyRate','ماخذ حقوق ورودی'],['tariffCode','کد تعرفه کالا'],['netWeight','وزن خالص'],['grossWeight','وزن ناخالص'],['billOfLading','شماره بارنامه'],['sataCode','کد ساتا این محموله'],['insuranceIrr','بیمه (ریال)']];map.forEach(([k,l])=>{const v=line(text,l);if(v)out[k]=v});out.vesselType=normalizeVesselType(out.vesselType);out.netWeight=weightKg(out.netWeight);out.grossWeight=weightKg(out.grossWeight);return out};
export const PreDeclarationPage:React.FC=()=>{
const{user,profile}=useAuth();const[params]=useSearchParams();const shipmentId=params.get('shipmentId')||'';const[shipment,setShipment]=useState<Shipment|null>(null);const[registrationOrder,setRegistrationOrder]=useState<RegistrationOrderShared|null>(null);const[clientName,setClientName]=useState('');const[offices,setOffices]=useState<CustomsOffice[]>([]);const[customsOfficeId,setCustomsOfficeId]=useState('');const[customsRegime,setCustomsRegime]=useState('');const[docs,setDocs]=useState<Doc[]>([]);const[values,setValues]=useState<V>(blank);const[extracted,setExtracted]=useState<V>(blank);const[bankResolving,setBankResolving]=useState(false);const[bankResolutionStatus,setBankResolutionStatus]=useState('');const[needed,setNeeded]=useState('');const[paste,setPaste]=useState('');const[busy,setBusy]=useState(false);const[status,setStatus]=useState('');const[copied,setCopied]=useState(false);const[registered,setRegistered]=useState(false);const[insuranceCalcOpen,setInsuranceCalcOpen]=useState(false);
const formDraft=useAutosavedDraft(
 formDraftKey(user?.id,`pre-declaration:${shipmentId}`,profile?.organization_id),
 {values,paste,needed,customsOfficeId,customsRegime},
 (draft:{values?:V;paste?:string;needed?:string;customsOfficeId?:string;customsRegime?:string})=>{
  if(draft.values)setValues({...blank,...draft.values});
  setPaste(draft.paste||'');
  setNeeded(draft.needed||'');
  if(typeof draft.customsOfficeId==='string')setCustomsOfficeId(draft.customsOfficeId);
  if(typeof draft.customsRegime==='string')setCustomsRegime(draft.customsRegime);
  setRegistered(false);
 },
);
const profileOrg=async()=>{const{data:{user}}=await supabase.auth.getUser();if(!user){setStatus('کاربر وارد نشده است.');return null}const{data,error}=await supabase.from('profiles').select('organization_id').eq('id',user.id).maybeSingle();if(error||!data?.organization_id){setStatus(error?.message||'سازمان کاربر مشخص نیست.');return null}return data.organization_id};
const load=async()=>{if(!shipmentId){setStatus('شناسه محموله وجود ندارد. این مرحله فقط از مرحله ۱ فراخوانی می‌شود.');return}setBusy(true);try{const[{data:s,error:se},{data:canonical,error:ce},{data:legacy,error:le},{data:saved,error:de}]=await Promise.all([supabase.from('shipments').select('id,organization_id,registration_order_id,client_id,shipping_line,bill_of_lading_no,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,display_name,customs_office_id,case_id').eq('id',shipmentId).maybeSingle(),supabase.from('shipment_documents').select('id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,storage_backend,file_asset_id,folder_id,created_at').eq('shipment_id',shipmentId).eq('is_archived',false).order('created_at',{ascending:true}),supabase.from('customs_documents').select('id,shipment_id,original_name,display_name,storage_path,mime_type,size_bytes,storage_backend,file_asset_id,folder_id,created_at').eq('shipment_id',shipmentId).eq('is_archived',false).order('created_at',{ascending:true}),supabase.from('shipment_customs_data').select('*').eq('shipment_id',shipmentId).maybeSingle()]);if(se||ce||le||de)throw se||ce||le||de;if(!s)throw new Error('محموله پیدا نشد.');const{data:officeRows,error:officeError}=await supabase.from('customs_offices').select('id,organization_id,code,name,city,is_active').order('name');if(officeError)throw officeError;setOffices((officeRows||[]) as CustomsOffice[]);setShipment(s as Shipment);let linkedOrder:RegistrationOrderShared|null=null;if(s.registration_order_id){const{data:order,error:orderError}=await supabase.from('registration_orders').select('id,order_number,order_date,currency,bank_name,bank_branch,bank_branch_code,payment_instrument_code,net_weight_kg,gross_weight_kg,value_amount').eq('id',s.registration_order_id).eq('organization_id',s.organization_id||profile?.organization_id||'').maybeSingle();if(orderError)throw orderError;linkedOrder=order as RegistrationOrderShared|null}else if(s.case_id){const{data:caseRef,error:caseError}=await supabase.from('cases').select('registration_order_no').eq('id',s.case_id).maybeSingle();if(caseError)throw caseError;if(caseRef?.registration_order_no){const{data:order,error:orderError}=await supabase.from('registration_orders').select('id,order_number,order_date,currency,bank_name,bank_branch,bank_branch_code,payment_instrument_code,net_weight_kg,gross_weight_kg,value_amount').eq('order_number',caseRef.registration_order_no).eq('organization_id',s.organization_id||profile?.organization_id||'').maybeSingle();if(orderError)throw orderError;linkedOrder=order as RegistrationOrderShared|null}}setRegistrationOrder(linkedOrder);if(s.client_id){const{data:client,error:clientError}=await supabase.from('clients').select('name').eq('id',s.client_id).maybeSingle();if(clientError)throw clientError;setClientName(client?.name||'')}else setClientName('');const cd=(canonical||[]).map((d:any)=>({id:d.id,document_name:d.document_name||d.original_file_name||'سند',original_file_name:d.original_file_name||d.document_name||'سند',storage_path:d.storage_path,mime_type:d.mime_type||'application/octet-stream',size_bytes:Number(d.file_size_bytes||0),storage_backend:d.storage_backend||'supabase',file_asset_id:d.file_asset_id||null,folder_id:d.folder_id||null,source:'shipment_documents' as const}));const ids=new Set(cd.map(x=>x.id));const ld=(legacy||[]).filter((d:any)=>!ids.has(d.id)).map((d:any)=>({id:d.id,document_name:d.display_name||d.original_name||'سند',original_file_name:d.original_name||d.display_name||'سند',storage_path:d.storage_path,mime_type:d.mime_type||'application/octet-stream',size_bytes:Number(d.size_bytes||0),storage_backend:d.storage_backend||'supabase',file_asset_id:d.file_asset_id||null,folder_id:d.folder_id||null,source:'customs_documents' as const}));setDocs([...cd,...ld]);const preserveLocalDraft=formDraft.hasDraftRef.current||['saving','saved','restored'].includes(formDraft.statusRef.current);if(saved){const x:any=saved;if(!preserveLocalDraft){formDraft.clearDraft();setCustomsOfficeId(String(x.customs_office_id||s.customs_office_id||''));setCustomsRegime(String(x.customs_regime||''));setValues({vesselType:normalizeVesselType(x.vessel_type),regNumber:linkedOrder?.order_number||x.registration_order_no||'',regDate:linkedOrder?.order_date||x.registration_order_date_shamsi||'',packageCount:x.package_count==null?'':String(x.package_count),warehouseReceiptNo:x.warehouse_receipt_no||'',warehouseReceiptDate:x.warehouse_receipt_date_shamsi||'',cargoDescription:x.cargo_description||'',originCountry:x.origin_country||'',transactionCountry:x.transaction_country||'',deliveryTerm:x.delivery_term||'',invoiceAmount:x.invoice_amount==null?'':String(x.invoice_amount),invoiceCurrency:x.invoice_currency||'',sataCode:x.sata_code||'',dutyRate:x.duty_rate==null?'':String(x.duty_rate),tariffCode:x.tariff_code||'',netWeight:x.net_weight_kg==null?'':String(x.net_weight_kg),grossWeight:x.gross_weight_kg==null?'':String(x.gross_weight_kg),billOfLading:x.bill_of_lading||'',insuranceIrr:x.insurance_irr==null?'':String(x.insurance_irr)});setNeeded(x.required_documents||'')}setRegistered(!preserveLocalDraft)}else if(!preserveLocalDraft){formDraft.clearDraft();setCustomsOfficeId(String(s.customs_office_id||''));setCustomsRegime('');setValues(v=>({...v,regNumber:linkedOrder?.order_number||v.regNumber||'',packageCount:s.cargo_count==null?'':String(Math.round(s.cargo_count)),netWeight:s.net_weight_kg==null?'':weightKg(s.net_weight_kg),grossWeight:s.gross_weight_kg==null?'':weightKg(s.gross_weight_kg),billOfLading:s.bill_of_lading_no||''}))}}catch(e:any){setStatus(e?.message||'دریافت اطلاعات ناموفق بود')}finally{setBusy(false)}};
useEffect(()=>{void load()},[shipmentId]);
const set=(k:string,v:string)=>{setRegistered(false);setValues(p=>({...p,[k]:k==='netWeight'||k==='grossWeight'?weightKg(v):k==='vesselType'?normalizeVesselType(v):v}))};

const resolveRegistrationOrderByNumber=async(rawValue:string)=>{
 const number=normalizeRegistrationOrderNumber(rawValue);
 const organizationId=shipment?.organization_id||profile?.organization_id;
 if(!number||!organizationId)return;
 const variants=registrationOrderNumberVariants(rawValue);
 setBankResolving(true);
 setBankResolutionStatus('در حال جست‌وجوی سوابق همین شماره ثبت سفارش…');
 try{
  const fields='id,organization_id,case_id,client_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,notes,net_weight_kg,gross_weight_kg,bank_name,bank_branch,bank_branch_code,payment_instrument_code,is_closed,closed_at';
  const[{data:orders,error:orderError},{data:historyRows,error:historyError}]=await Promise.all([
   supabase.from('registration_orders').select(fields).eq('organization_id',organizationId).in('order_number',variants).limit(5),
   supabase.from('shipment_customs_data').select('shipment_id,registration_order_no,bank_name,bank_branch,bank_branch_code,lc_number,updated_at').eq('organization_id',organizationId).in('registration_order_no',variants).order('updated_at',{ascending:false}).limit(100)
  ]);
  if(orderError)throw orderError;
  if(historyError)throw historyError;
  const matchingHistory=(historyRows||[]).filter((row:any)=>normalizeRegistrationOrderNumber(row.registration_order_no)===number);
  const resolved=resolveLegacyRegistrationBankDetails(matchingHistory);
  let master=(orders||[]).find((row:any)=>normalizeRegistrationOrderNumber(row.order_number)===number) as any||null;
  const detailFields=['bank_name','bank_branch','bank_branch_code','payment_instrument_code'] as const;
  const mergedDetails:any={};
  detailFields.forEach(key=>{mergedDetails[key]=String(master?.[key]||'').trim()||resolved[key]||null});
  let persistenceMessage='';
  if(!master&&detailFields.some(key=>Boolean(resolved[key]))){
   const{data:created,error:createError}=await supabase.from('registration_orders').insert({
    organization_id:organizationId,
    order_number:number,
    client_id:shipment?.client_id||null,
    bank_name:resolved.bank_name,
    bank_branch:resolved.bank_branch,
    bank_branch_code:resolved.bank_branch_code,
    payment_instrument_code:resolved.payment_instrument_code,
   }).select(fields).maybeSingle();
   if(!createError&&created)master=created;
   else if(createError?.code==='23505'){
    const{data:retry,error:retryError}=await supabase.from('registration_orders').select(fields).eq('organization_id',organizationId).in('order_number',variants).limit(5);
    if(retryError)throw retryError;
    master=(retry||[]).find((row:any)=>normalizeRegistrationOrderNumber(row.order_number)===number)||null;
   }else{
    persistenceMessage=' مشخصات از اسناد قبلی خوانده شد، اما به علت سطح دسترسی در رکورد مادر ذخیره نشد.';
   }
  }else if(master){
   const updates:any={};
   detailFields.forEach(key=>{if(!String(master[key]||'').trim()&&resolved[key])updates[key]=resolved[key]});
   if(Object.keys(updates).length){
    const{data:updated,error:updateError}=await supabase.from('registration_orders').update(updates).eq('id',master.id).eq('organization_id',organizationId).select(fields).maybeSingle();
    if(!updateError&&updated)master=updated;
    else persistenceMessage=' مشخصات از اسناد قبلی خوانده شد، اما ذخیره در رکورد مادر به سطح دسترسی نیاز دارد.';
   }
  }
  const result:RegistrationOrderShared={
   id:master?.id||null,
   order_number:master?.order_number||number,
   order_date:master?.order_date||null,
   currency:master?.currency||null,
   value_amount:master?.value_amount==null?null:Number(master.value_amount),
   net_weight_kg:master?.net_weight_kg==null?null:Number(master.net_weight_kg),
   gross_weight_kg:master?.gross_weight_kg==null?null:Number(master.gross_weight_kg),
   client_id:master?.client_id||shipment?.client_id||null,
   is_closed:Boolean(master?.is_closed),
   ...mergedDetails,
   legacy_source_count:resolved.source_count,
   legacy_conflicts:resolved.conflicts,
  };
  setRegistrationOrder(result);
  if(resolved.source_count&&detailFields.some(key=>Boolean(mergedDetails[key]))){
   const conflictText=resolved.conflicts.length?' اختلاف در '+resolved.conflicts.join('، ')+' بین اسناد قبلی وجود داشت؛ مقدار پرتکرارتر بازیابی شد.':'';
   setBankResolutionStatus('اطلاعات بانکی از '+resolved.source_count.toLocaleString('fa-IR')+' سند قبلی با همین شماره بازیابی شد.'+conflictText+persistenceMessage);
  }else if(master){
   setBankResolutionStatus(detailFields.some(key=>Boolean(mergedDetails[key]))?'اطلاعات بانکی از ثبت سفارش مادر بارگذاری شد.':'ثبت سفارش پیدا شد، اما در سوابق آن اطلاعات بانکی ثبت نشده است.');
  }else{
   setBankResolutionStatus('ثبت سفارش مادر یا اطلاعات بانکی در اسناد قبلی با این شماره پیدا نشد.');
  }
  if(master?.id){
   const historicalIds=[...new Set([shipmentId,...matchingHistory.map((row:any)=>row.shipment_id).filter(Boolean)])];
   const{data:related,error:relatedError}=await supabase.from('shipments').select('id,client_id,registration_order_id').eq('organization_id',organizationId).in('id',historicalIds);
   if(relatedError)throw relatedError;
   const linkable=(related||[]).filter((row:any)=>!row.registration_order_id&&(!master.client_id||row.client_id===master.client_id)).map((row:any)=>row.id);
   if(linkable.length){
    const{error:linkError}=await supabase.from('shipments').update({registration_order_id:master.id}).eq('organization_id',organizationId).in('id',linkable).is('registration_order_id',null);
    if(linkError){
     setBankResolutionStatus(current=>current+' اتصال خودکار محموله به ثبت سفارش مادر نیازمند بررسی دسترسی است.');
    }else if(linkable.includes(shipmentId)){
     setShipment((current:any)=>current?{...current,registration_order_id:master.id}:current);
    }
   }
  }
 }catch(error:any){
  setBankResolutionStatus(error?.message||'بازیابی اطلاعات بانکی بر اساس شماره ثبت سفارش ناموفق بود.');
 }finally{
  setBankResolving(false);
 }
};
useEffect(()=>{
 const number=normalizeRegistrationOrderNumber(values.regNumber||'');
 if(!number){
  setBankResolving(false);
  setBankResolutionStatus('');
  if(!values.regNumber)setRegistrationOrder(null);
  return;
 }
 if(number.length<4){
  setRegistrationOrder(null);
  setBankResolutionStatus('برای بازیابی خودکار، شماره ثبت سفارش را کامل وارد کنید.');
  return;
 }
 const currentNumber=registrationOrder?.order_number?normalizeRegistrationOrderNumber(registrationOrder.order_number):'';
 if(currentNumber!==number)setRegistrationOrder(null);
 let active=true;
 const timer=window.setTimeout(()=>{if(active)void resolveRegistrationOrderByNumber(values.regNumber)},300);
 return()=>{active=false;window.clearTimeout(timer)};
},[values.regNumber,shipmentId,profile?.organization_id,shipment?.client_id,shipment?.registration_order_id]);

const extractAll=async()=>{
 if(!shipmentId)return setStatus('از مرحله ۱ یک محموله را انتخاب کنید.');
 if(!docs.length)return setStatus('برای این محموله سندی ثبت نشده است.');
 const processDocs=docs.filter(d=>Boolean(d.file_asset_id||d.storage_path));
 if(!processDocs.length)return setStatus('برای این محموله فایل قابل‌خواندن در Storage یا آرشیو تلگرام پیدا نشد.');
 setBusy(true);setRegistered(false);setStatus('در حال آماده‌سازی اسناد برای استخراج…');
 const organizationId=profile?.organization_id||await profileOrg();
 if(!organizationId){setBusy(false);return}
 const usable=(value:any)=>{const s=String(value??'').trim();return !!s&&!/^x{2,}$/i.test(s)&&s!=='—'&&s!=='-'};
 const parseAnswer=(payload:any)=>{
  const raw=payload?.answer??payload?.message??payload;
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;
  let text=String(raw??'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
  try{return JSON.parse(text)}catch{
   const start=text.indexOf('{'),end=text.lastIndexOf('}');
   if(start>=0&&end>start){try{return JSON.parse(text.slice(start,end+1))}catch{}}
  }
  throw new Error('پاسخ استخراج ساختار JSON معتبر نداشت.');
 };
 const invokeExtraction=async(body:Record<string,unknown>)=>{
  const {data,error}=await supabase.functions.invoke('ai-assistant',{body});
  if(error)throw new Error(error.message||'سرویس استخراج سند پاسخ نداد.');
  if(data?.error)throw new Error(String(data.error));
  const parsed=parseAnswer(data);
  if(!fields.some(([key])=>usable(parsed[key]))&&!usable(parsed.requiredDocuments)){
   throw new Error('از محتوای سند اطلاعات قابل‌استفاده‌ای استخراج نشد.');
  }
  return parsed;
 };
 const loadFileForFallback=async(d:Doc)=>{
  let response:Response;
  if(d.file_asset_id){
   const {data:{session},error:sessionError}=await supabase.auth.getSession();
   if(sessionError||!session?.access_token)throw new Error('برای دریافت فایل آرشیو تلگرام نشست معتبر در دسترس نیست.');
   const anonKey=String((import.meta as any).env?.VITE_SUPABASE_ANON_KEY||'');
   const endpoint='/api/messenger/files/'+encodeURIComponent(d.file_asset_id)+'/download';
   response=await fetch(endpoint,{headers:{Authorization:'Bearer '+session.access_token,...(anonKey?{apikey:anonKey}:{})},cache:'no-store'});
  }else{
   if(!d.storage_path||d.storage_path.startsWith('telegram://'))throw new Error('مسیر فایل ذخیره‌شده معتبر نیست.');
   const {data:signed,error}=await supabase.storage.from('customs_documents').createSignedUrl(d.storage_path,600);
   if(error||!signed?.signedUrl)throw new Error(error?.message||'لینک امن دریافت سند ساخته نشد.');
   response=await fetch(signed.signedUrl,{cache:'no-store'});
  }
  if(!response.ok)throw new Error('دریافت فایل برای OCR ناموفق بود (HTTP '+response.status+').');
  const blob=await response.blob();
  if(blob.size>20*1024*1024)throw new Error('حجم سند برای مسیر جایگزین OCR بیش از ۲۰ مگابایت است.');
  const type=blob.type||d.mime_type||'application/octet-stream';
  return new File([blob],d.original_file_name||d.document_name,{type});
 };
 const markShipmentDoc=async(documentId:string,status:'processing'|'completed'|'failed',errorMessage?:string)=>{
  const patch:any={extraction_status:status,extraction_error:errorMessage||null};
  if(status==='processing')patch.extraction_started_at=new Date().toISOString();
  if(status==='completed'||status==='failed')patch.extraction_completed_at=new Date().toISOString();
  const {error}=await supabase.from('shipment_documents').update(patch).eq('id',documentId).eq('shipment_id',shipmentId).eq('organization_id',organizationId);
  if(error)console.warn('[PreDeclaration] could not update extraction status:',error.message);
 };;
 const persistDocument=async(d:Doc,parsed:any)=>{
  if(d.source==='shipment_documents'){
   const rows=fields.map(([key,label])=>({key,label,value:parsed?.[key]}))
    .filter((item:any)=>usable(item.value))
    .map((item:any)=>({organization_id:organizationId,shipment_id:shipmentId,document_id:d.id,field_key:item.key,field_label:item.label,extracted_value:String(item.value).trim(),extraction_method:'ai-assistant',confidence:null}));
   if(rows.length){
    const {error}=await supabase.from('shipment_document_extractions').upsert(rows,{onConflict:'shipment_id,document_id,field_key'});
    if(error)throw error;
   }
  }else{
   const {error}=await supabase.from('customs_documents').update({extraction:parsed,extraction_confidence:null}).eq('id',d.id).eq('shipment_id',shipmentId).eq('organization_id',organizationId);
   if(error)throw error;
  }
 };
 const results:Array<{name:string;data:any}>=[];
 const failures:string[]=[];
 for(let index=0;index<processDocs.length;index++){
  const d=processDocs[index];
  try{
   if(d.source==='shipment_documents')await markShipmentDoc(d.id,'processing');
   setStatus('در حال استخراج سند '+(index+1)+' از '+processDocs.length+': '+d.document_name);
   const common={
    query:'این سند را برای تکمیل اطلاعات قبل از اظهار گمرکی بخوان. فقط یک شیء JSON با کلیدهای vesselType,regNumber,regDate,packageCount,warehouseReceiptNo,warehouseReceiptDate,cargoDescription,originCountry,transactionCountry,deliveryTerm,invoiceAmount,invoiceCurrency,dutyRate,tariffCode,netWeight,grossWeight,billOfLading,insuranceIrr,requiredDocuments برگردان. همه صفحات و جدول‌ها را بررسی کن. هیچ شماره، تاریخ، وزن، مبلغ یا مشخصه‌ای را حدس نزن. مقادیر ناخوانا یا ناموجود را خالی بگذار.',
    extract_fields:true,
    document_mime_type:(()=>{const type=String(d.mime_type||'').toLowerCase();if(type&&type!=='application/octet-stream')return type;const name=String(d.original_file_name||d.document_name||'').toLowerCase();return name.endsWith('.pdf')?'application/pdf':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':name.endsWith('.jpg')||name.endsWith('.jpeg')?'image/jpeg':type||'application/pdf'})(),
    document_size_bytes:d.size_bytes||0,
    page_context:'/operations?tab=pre-declaration&shipmentId='+shipmentId,
    shipment_id:shipmentId
   };
   const documentReference=d.file_asset_id
    ?{telegram_file_asset_id:d.file_asset_id}
    :{document_storage_path:d.storage_path};
   let parsed:any;
   try{
    parsed=await invokeExtraction({...common,...documentReference});
   }catch(aiError){
    const primaryMessage=aiError instanceof Error?aiError.message:String(aiError);
    setStatus('سرویس AI برای «'+d.document_name+'» پاسخ نداد؛ مسیر PDF/OCR محلی فعال می‌شود…');
    try{
     const localFile=await loadFileForFallback(d);
     const documentText=await extractDocumentText(localFile,setStatus);
     parsed=await invokeExtraction({
      query:common.query+'\nمتن استخراج‌شده از همان سند در ادامه آمده است؛ فقط از همین متن استفاده کن و مقدار مبهم را خالی بگذار.',
      extract_fields:true,
      document_text:documentText,
      page_context:common.page_context,
      shipment_id:shipmentId
     });
    }catch(fallbackError){
     const fallbackMessage=fallbackError instanceof Error?fallbackError.message:String(fallbackError);
     throw new Error('استخراج هوشمند: '+primaryMessage+' | مسیر PDF/OCR: '+fallbackMessage);
    }
   }
   results.push({name:d.document_name,data:parsed});
   await persistDocument(d,parsed);
   if(d.source==='shipment_documents')await markShipmentDoc(d.id,'completed');
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   failures.push(d.document_name+': '+message);
   if(d.source==='shipment_documents'){
    try{await markShipmentDoc(d.id,'failed',message.slice(0,1000))}catch{}
   }
  }
 }
 if(!results.length){
  setStatus('هیچ‌کدام از '+processDocs.length+' سند خوانده نشدند. '+failures.slice(0,3).join(' | '));
  setBusy(false);
  return;
 }
 const incoming:V={...blank};
 for(const result of results){
  fields.forEach(([key])=>{if(!usable(incoming[key])&&usable(result.data?.[key]))incoming[key]=String(result.data[key]).trim()});
 }
 incoming.netWeight=weightKg(incoming.netWeight);
 incoming.grossWeight=weightKg(incoming.grossWeight);
 incoming.vesselType=normalizeVesselType(incoming.vesselType);
 if(!incoming.packageCount&&shipment?.cargo_count!=null)incoming.packageCount=String(Math.round(shipment.cargo_count));
 if(!incoming.netWeight&&shipment?.net_weight_kg!=null)incoming.netWeight=weightKg(shipment.net_weight_kg);
 if(!incoming.grossWeight&&shipment?.gross_weight_kg!=null)incoming.grossWeight=weightKg(shipment.gross_weight_kg);
 if(!incoming.billOfLading&&shipment?.bill_of_lading_no)incoming.billOfLading=shipment.bill_of_lading_no;
 const merged:V={...values};
 fields.forEach(([key])=>{if(usable(incoming[key])&&!usable(merged[key]))merged[key]=incoming[key]});
 setValues(merged);setExtracted(incoming);
 const required=results.map(result=>String(result.data?.requiredDocuments||'').trim()).find(Boolean)||'';
 if(required)setNeeded(required);
 const conflicts=fields.filter(([key])=>new Set(results.map(result=>String(result.data?.[key]||'').trim()).filter(usable)).size>1);
 const conflictText=conflicts.length?' · '+conflicts.length+' مورد دارای مقادیر متفاوت است؛ لطفاً قبل از ذخیره تطبیق دهید.':'';
 const failureText=failures.length?' · '+failures.length+' سند ناموفق: '+failures.slice(0,2).join('؛ '):'';
 setStatus(results.length+' سند از '+processDocs.length+' سند با موفقیت خوانده شد. اطلاعات استخراج‌شده فقط در فرم قرار گرفت؛ برای ثبت دائمی «ذخیره اطلاعات گمرکی» را بزنید.'+conflictText+failureText);
 setBusy(false);
};
const applyPaste=()=>{const parsed=parseSmartPaste(paste);const next={...values};Object.entries(parsed).forEach(([k,v])=>{if(v)next[k]=v});setValues(next);setExtracted(parsed);setRegistered(false);setStatus('Smart Paste اعمال شد؛ اطلاعات را کنترل و سپس ذخیره کنید.')};
const output=useMemo(()=>{const v=(k:string)=>values[k]||'—';return 'نوع کشتی: '+v('vesselType')+'\n\nشماره ثبت سفارش: '+(registrationOrder?.order_number||v('regNumber'))+'\nتاریخ ثبت سفارش: '+(registrationOrder?.order_date||v('regDate'))+'\n\nتعداد: '+v('packageCount')+'\nشماره قبض انبار: '+v('warehouseReceiptNo')+'\nتاریخ قبض انبار: '+v('warehouseReceiptDate')+'\n\nشرح کالا: '+v('cargoDescription')+'\nکشور مبدا: '+v('originCountry')+'\nکشور طرف معامله: '+v('transactionCountry')+'\nشرایط تحویل: '+v('deliveryTerm')+'\nمبلغ کل فاکتور این محموله: '+v('invoiceAmount')+'\nارز: '+v('invoiceCurrency')+'\n\nاطلاعات بانکی مشترک ثبت سفارش:\nکد شعبه: '+(registrationOrder?.bank_branch_code||'—')+'\nنام بانک: '+(registrationOrder?.bank_name||'—')+'\nشعبه: '+(registrationOrder?.bank_branch||'—')+'\nکد ابزار پرداخت / اعتبار اسنادی: '+(registrationOrder?.payment_instrument_code||'—')+'\n\nماخذ حقوق ورودی: '+v('dutyRate')+'\nکد تعرفه کالا: '+v('tariffCode')+'\nوزن خالص این محموله: '+v('netWeight')+' کیلوگرم\nوزن ناخالص این محموله: '+v('grossWeight')+' کیلوگرم\nشماره بارنامه: '+v('billOfLading')+'\nکد ساتا این محموله: '+v('sataCode')+'\nبیمه (ریال): '+v('insuranceIrr')+'\n\nاطلاعات مورد نیاز: '+(needed||'—')},[values,needed,registrationOrder]);
const save=async()=>{if(!shipmentId)return setStatus('شناسه محموله وجود ندارد.');if(!customsOfficeId)return setStatus('گمرک محل اظهار را انتخاب کنید؛ هر محموله باید گمرک مشخص داشته باشد.');if(!customsRegime)return setStatus('رویه گمرکی را انتخاب کنید؛ اطلاعات قبل اظهار بدون رویه ذخیره نمی‌شود.');const org=await profileOrg();if(!org)return;setBusy(true);setStatus('در حال ذخیره دائمی اطلاعات گمرکی...');try{const{data:{user}}=await supabase.auth.getUser();const row:any={shipment_id:shipmentId,organization_id:org,customs_office_id:customsOfficeId||null,customs_regime:customsRegime||null,vessel_type:normalizeVesselType(values.vesselType)||null,registration_order_no:registrationOrder?.order_number||values.regNumber||null,registration_order_date_shamsi:values.regDate||null,package_count:num(values.packageCount),warehouse_receipt_no:values.warehouseReceiptNo||null,warehouse_receipt_date_shamsi:values.warehouseReceiptDate||null,cargo_description:values.cargoDescription||null,origin_country:values.originCountry||null,transaction_country:values.transactionCountry||null,delivery_term:values.deliveryTerm||null,invoice_amount:num(values.invoiceAmount),invoice_currency:values.invoiceCurrency||null,sata_code:values.sataCode||null,duty_rate:num(values.dutyRate),tariff_code:values.tariffCode||null,net_weight_kg:num(values.netWeight),gross_weight_kg:num(values.grossWeight),bill_of_lading:values.billOfLading||null,insurance_irr:num(values.insuranceIrr),required_documents:needed||null,source_method:paste.trim()?'smart-paste':'manual',source_text:paste.trim()||null,created_by:user?.id||null};const{error}=await supabase.from('shipment_customs_data').upsert(row,{onConflict:'shipment_id'});if(error)throw error;const{error:shipmentOfficeError}=await supabase.from('shipments').update({customs_office_id:customsOfficeId||null}).eq('id',shipmentId).eq('organization_id',org);if(shipmentOfficeError)throw shipmentOfficeError;if(shipment?.case_id){const{error:caseOfficeError}=await supabase.from('cases').update({customs_office_id:customsOfficeId||null,customs_regime:customsRegime||null}).eq('id',shipment.case_id).eq('organization_id',org);if(caseOfficeError)throw caseOfficeError;}formDraft.clearDraft();setRegistered(true);setStatus('اطلاعات گمرکی دائمی ذخیره شد و در مدیریت پرونده قابل مشاهده است.')}catch(e:any){setStatus(e?.message||'ذخیره اطلاعات گمرکی ناموفق بود')}finally{setBusy(false)}};
const copy=async()=>{try{await navigator.clipboard.writeText(output);setCopied(true);setTimeout(()=>setCopied(false),1800)}catch{setStatus('کپی متن در این مرورگر انجام نشد.')}};
const reset=()=>{formDraft.clearDraft(true,{values:{...blank},paste:'',needed:'',customsOfficeId:'',customsRegime:''});setCustomsOfficeId('');setCustomsRegime('');setValues({...blank});setExtracted({...blank});setNeeded('');setPaste('');setRegistered(false);setStatus('')};
return <main dir="rtl" className="min-h-screen p-4 sm:p-6 lg:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-6xl mx-auto space-y-5">
<header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs app-muted">مرحله ۲</div><h1 className="text-2xl font-black">ورود اطلاعات قبض انبار</h1><p className="text-xs app-muted mt-1">{shipment?.display_name||'محموله'} · صاحب کالا: {clientName||'—'} · گمرک: {offices.find(o=>o.id===customsOfficeId)?.name||'تعیین نشده'} · رویه: {customsRegimes.find(x=>x[0]===customsRegime)?.[1]||'تعیین نشده'} · اطلاعات از اسناد همین محموله استخراج می‌شود.</p><div className="mt-2"><FormDraftIndicator status={formDraft.status} onSave={formDraft.saveDraftNow}/></div></div><div className="flex gap-2"><Link to={'/documents?shipmentId='+encodeURIComponent(shipmentId)} className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold"><FileSearch className="inline ml-1" size={16}/>اسناد محموله</Link><Link to="/operations" className="px-4 py-2 rounded-xl border app-border">شروع عملیات</Link></div></header>
<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex flex-wrap gap-2 items-end"><div className="flex-1"><div className="text-xs app-muted mb-1">محموله انتخاب‌شده از مرحله ۱</div><div className="rounded-xl bg-[var(--surface-2)] p-3 font-bold">{shipment?.display_name||shipmentId||'—'}</div></div><button disabled={busy||!docs.length} onClick={()=>void extractAll()} className="rounded-xl bg-[var(--primary)] text-white px-5 py-3 font-bold"><Sparkles className="inline ml-1" size={17}/>استخراج از همه اسناد</button></div><div className="text-xs app-muted mt-2">تعداد اسناد: {docs.length} · Canonical: {docs.filter(d=>d.source==='shipment_documents').length} · Legacy fallback: {docs.filter(d=>d.source==='customs_documents').length}</div></section>
<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-2"><ClipboardPaste size={18}/><b>Smart Paste</b></div><textarea value={paste} onChange={e=>setPaste(e.target.value)} placeholder="متن اطلاعات گمرکی را اینجا Paste کنید..." className="w-full min-h-48 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"/><div className="flex justify-end mt-2"><button disabled={!paste.trim()} onClick={applyPaste} className="rounded-xl border app-border px-5 py-2.5 font-bold">اعمال Smart Paste</button></div></section>
<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><h2 className="font-black text-lg mb-4">محل اظهار و رویه گمرکی</h2><div className="grid sm:grid-cols-2 gap-3 mb-5"><label className="text-xs app-muted"><span className="block mb-1.5">گمرک محل اظهار *</span><select value={customsOfficeId} onChange={e=>setCustomsOfficeId(e.target.value)} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"><option value="">انتخاب گمرک</option>{offices.filter(o=>o.is_active||o.id===customsOfficeId).map(o=><option key={o.id} value={o.id}>{o.code} · {o.name} — {o.city}{!o.is_active?' (غیرفعال؛ فقط برای سابقه)':''}</option>)}</select><span className="block mt-1">گمرکی که اظهارنامه در آن ثبت می‌شود.</span></label><label className="text-xs app-muted"><span className="block mb-1.5">رویه گمرکی *</span><select value={customsRegime} onChange={e=>setCustomsRegime(e.target.value)} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"><option value="">انتخاب رویه</option>{customsRegimes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><span className="block mt-1">رویه برای محموله ذخیره می‌شود و به اظهارنامه منتقل خواهد شد.</span></label></div><section className="mb-5 rounded-xl border app-border bg-[var(--surface-2)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">اطلاعات بانکی مشترک ثبت سفارش</h3><p className="mt-1 text-xs app-muted">با وارد کردن شماره ثبت سفارش، اطلاعات بانک، شعبه، کد شعبه و اعتبار اسنادی از ثبت سفارش مادر یا اسناد قبلی همین شماره به‌صورت خودکار بازیابی می‌شوند.</p></div><Link to="/registration-orders" className="rounded-xl border app-border px-3 py-2 text-xs font-bold">مدیریت ثبت سفارش‌ها</Link></div>{bankResolving&&<div className="mt-3 text-xs app-muted">در حال بازیابی مشخصات بانک و اعتبار اسنادی…</div>}{bankResolutionStatus&&<div className={`mt-3 text-xs ${bankResolutionStatus.includes('اختلاف')?'text-amber-600':'app-muted'}`}>{bankResolutionStatus}</div>}{registrationOrder?<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm"><div>ثبت سفارش: <b dir="ltr">{registrationOrder.order_number}</b></div><div>بانک: <b>{registrationOrder.bank_name||'ثبت نشده'}</b></div><div>شعبه / کد: <b>{registrationOrder.bank_branch||'—'} · {registrationOrder.bank_branch_code||'—'}</b></div><div>کد ابزار پرداخت / LC: <b dir="ltr">{registrationOrder.payment_instrument_code||'ثبت نشده'}</b></div></div>:<div className="mt-3 text-xs text-amber-600">این محموله هنوز به ثبت سفارش مادر متصل نشده یا ثبت سفارش آن تعریف نشده است؛ از بخش مدیریت ثبت سفارش‌ها اطلاعات را ثبت و در مرحله شروع عملیات به محموله متصل کنید.</div>}</section><h2 className="font-black text-lg mb-4">اطلاعات قبض انبار و پیش‌اظهار</h2><div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">{fields.map(([k,l])=><label key={k} className="text-xs app-muted"><span className="block mb-1">{l}</span>{k==='vesselType'?<select value={normalizeVesselType(values[k])} onChange={e=>set(k,e.target.value)} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="">انتخاب کنید</option><option value="ایرانی">ایرانی</option><option value="خارجی">خارجی</option></select>:k==='regDate'||k==='warehouseReceiptDate'?<JalaliDatePicker value={values[k]||''} onChange={v=>set(k,v)} label={l}/>:k==='sataCode'?<><input value={values[k]||''} onChange={e=>set(k,e.target.value)} placeholder="در صورت دریافت، کد ساتای همین محموله را وارد کنید" className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3"/><span className="mt-1 block text-[10px]">تا مراحل پیش از خروج قابل خالی ماندن است؛ کد ساتا برای هر محموله جداگانه ثبت می‌شود.</span></>:k==='insuranceIrr'?<div className="flex gap-2"><input inputMode="numeric" value={faDigits(values[k]||'')} onChange={e=>set(k,digits(e.target.value))} className="w-full min-w-0 rounded-xl border app-border bg-[var(--surface-2)] p-3"/><button type="button" aria-label="ماشین‌حساب مبلغ بیمه" title="ماشین‌حساب مبلغ بیمه" onClick={()=>setInsuranceCalcOpen(true)} className="shrink-0 rounded-xl border app-border bg-[var(--surface-2)] px-3"><Calculator size={18}/></button></div>:<input value={values[k]||''} onChange={e=>set(k,e.target.value)} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3"/>}{extracted[k]&&extracted[k]!==values[k]&&<span className="block mt-1 text-[10px] text-blue-500">خوانش: {extracted[k]}</span>}</label>)}<label className="md:col-span-2 lg:col-span-3 text-xs app-muted"><span className="block mb-1">اطلاعات مورد نیاز</span><input value={needed} onChange={e=>{setRegistered(false);setNeeded(e.target.value)}} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label></div><div className="flex flex-wrap gap-2 mt-5 pt-4 border-t app-border"><button onClick={reset} className="px-4 py-2.5 rounded-xl border app-border"><RotateCcw className="inline ml-1" size={16}/>پاک کردن فرم</button><button disabled={busy||!shipmentId} onClick={()=>void save()} className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold"><Save className="inline ml-1" size={17}/>{busy?'در حال ذخیره...':'ذخیره اطلاعات گمرکی'}</button></div></section>
{insuranceCalcOpen&&<InsuranceCalculator initialValue={values.insuranceIrr||''} onApply={v=>set('insuranceIrr',v)} onClose={()=>setInsuranceCalcOpen(false)}/>}{status&&<div className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{busy&&<Loader2 className="inline ml-2 animate-spin" size={16}/>} {status}</div>}
{registered&&<section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-emerald-600"><Check size={19}/>نسخه ذخیره‌شده اطلاعات گمرکی</div><div className="flex gap-2"><button onClick={copy} className="px-4 py-2.5 rounded-xl bg-[var(--primary)] text-white font-bold"><Copy className="inline ml-1" size={16}/>{copied?'کپی شد':'کپی متن'}</button><button onClick={()=>window.print()} className="px-4 py-2.5 rounded-xl border app-border"><Printer className="inline ml-1" size={16}/>پرینت</button></div></div><pre id="customs-copy-view" className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--surface-2)] p-4 text-sm leading-8 font-sans">{output}</pre></section>}
{shipment&&<ShipmentStageCosts stage="STAGE_2_PRE_DECLARATION" shipmentId={shipment.id} shipment={shipment}/>} 
<section className="flex justify-end">{registered?<Link to={'/operations?tab=declaration&shipmentId='+encodeURIComponent(shipmentId)} className="rounded-xl bg-[var(--primary)] text-white px-6 py-3 font-bold">مرحله ۳ · ثبت اظهار</Link>:<div className="text-xs app-muted rounded-xl border app-border px-4 py-3">ابتدا اطلاعات گمرکی را ذخیره کنید؛ سپس مرحله ۳ فعال می‌شود.</div>}</section>
</div><style>{'@media print{body *{visibility:hidden!important}#customs-copy-view,#customs-copy-view *{visibility:visible!important}#customs-copy-view{position:absolute;inset:0;width:100%;margin:0;padding:24px;background:white;color:black!important;white-space:pre-wrap;font-family:Tahoma,sans-serif;font-size:13pt;line-height:2.2;border:0!important;box-shadow:none!important}}'}</style></main>};
export default PreDeclarationPage;