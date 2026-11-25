import React,{useEffect,useMemo,useState} from 'react';


const makeCompatibleUUID=()=>{if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256)}bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5')};import {ArrowRight,Calculator,ClipboardPaste,FileCheck2,FileText,Loader2,Save,Trash2,Upload,ShieldCheck,Plus} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {isCloudflareRecoveryHost} from '../lib/recoveryHost';
import {cloudflareCasesApi} from '../lib/cloudflareCases';
import {cloudflareClientsApi} from '../lib/cloudflareClients';
import {cloudflareRegistrationOrdersApi} from '../lib/cloudflareRegistrationOrders';

const digits=(v:string)=>v.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/,/g,'');
const num=(v:string)=>v.trim()?Number(digits(v)):null;
const dateDb=(v:string)=>{const r=(v||'').trim();if(!r)return null;const n=r.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[.-]/g,'/');const p=n.split('/').map(Number);if(p.length!==3||p.some(x=>!Number.isFinite(x)))return r;const[y,m,d]=p;if(y>=1900)return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const fmt=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});for(let i=0;i<380;i++){const dt=new Date(Date.UTC(y+621,2,19)+i*86400000);const q=fmt.formatToParts(dt);if(`${q.find(x=>x.type==='year')?.value}-${Number(q.find(x=>x.type==='month')?.value)}-${Number(q.find(x=>x.type==='day')?.value)}`===`${y}-${m}-${d}`)return dt.toISOString().slice(0,10)}return r};

type FormState=Record<string,string>;
const blank:FormState={clientId:'',client:'',regNumber:'',regDate:'',vesselType:'ایرانی',unloadingDate:'',warehouseReceiptNo:'',warehouseReceiptDate:'',releaseStatus:'pending',cargoCount:'',cargoCountUnit:'رول',cargoDescription:'',originCountry:'',transactionCountry:'',deliveryTerm:'CFR',invoiceAmount:'',invoiceCurrency:'USD',netWeight:'',grossWeight:'',insuranceIrr:'',tariffCode:'',dutyRate:'',shippingLine:'',billOfLading:'',billYear:String(new Date().getFullYear()),vesselName:'',voyageNo:'',originPort:'',destinationPort:''};

const docTypes=[
 ['proforma_invoice','پروفورما'],['commercial_invoice','Invoice'],['packing_list','Packing List'],['bill_of_lading','B/L / بارنامه'],['certificate_of_origin','گواهی مبدأ'],['health_certificate','گواهی بهداشت/سلامت'],['standard_permit','مجوز استاندارد'],['insurance','بیمه'],['customs_declaration','اظهار گمرکی'],['exit_permit','پروانه/مجوز خروج'],['receipt','رسید'],['other','سایر']
] as const;

export const OperationsPage:React.FC=()=>{
 const [searchParams,setSearchParams]=useSearchParams();
 const requestedTab=searchParams.get('tab');
 const requestedCaseId=searchParams.get('caseId');
 const cloudflareMode=isCloudflareRecoveryHost();
 const [clients,setClients]=useState<any[]>([]),[cases,setCases]=useState<any[]>([]),[shipments,setShipments]=useState<any[]>([]),[orders,setOrders]=useState<any[]>([]),[documents,setDocuments]=useState<any[]>([]),[permits,setPermits]=useState<any[]>([]);
 const [caseId,setCaseId]=useState(''),[clientId,setClientId]=useState('');
 const [tab,setTab]=useState<'operation'|'registration'|'declaration'|'valuation'|'documents'>(()=>cloudflareMode&&requestedTab==='declaration'?'operation':requestedTab==='declaration'?'declaration':requestedTab==='valuation'?'valuation':requestedTab==='documents'?'documents':requestedTab==='registration'?'registration':'operation');
 const [form,setForm]=useState<FormState>(blank),[decl,setDecl]=useState({kottaj:'',path:''}),[val,setVal]=useState({customsValue:'',dutyRate:'',duty:'',vat:'',total:''}),[valResult,setValResult]=useState<any>(null);
 const [paste,setPaste]=useState(''),[pasteOpen,setPasteOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [orderForm,setOrderForm]=useState({number:'',date:'',status:'received',tariff:'',quantity:'',unit:'',value:'',currency:'USD',bankName:'',bankBranch:'',bankBranchCode:'',paymentInstrumentCode:'',notes:''});
 const [permitForm,setPermitForm]=useState({type:'',number:'',authority:'',status:'pending',issued:'',expires:'',notes:''});
 const [docType,setDocType]=useState('other');

 useEffect(()=>{const t=cloudflareMode&&requestedTab==='declaration'?'operation':requestedTab==='declaration'||requestedTab==='valuation'||requestedTab==='documents'||requestedTab==='registration'?requestedTab:'operation';setTab(t)},[requestedTab,cloudflareMode]);
 const changeTab=(t:typeof tab)=>{setTab(t);setSearchParams(t==='operation'?{}:{tab:t})};
 const set=(k:string,v:string)=>setForm(p=>({...p,[k]:v}));

 const load=async()=>{
  if(cloudflareMode){
   try{
    const [cr,sr,shipmentResponse,orr]=await Promise.all([
     cloudflareClientsApi.list({limit:200}),
     cloudflareCasesApi.list({limit:200}),
     fetch('/api/shipments?limit=200',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}),
     cloudflareRegistrationOrdersApi.list({limit:100})
    ]);
    const shipmentBody=await shipmentResponse.json() as {ok?:boolean;items?:any[];error?:string};
    if(!shipmentResponse.ok||!shipmentBody.ok)throw new Error(shipmentBody.error||'SHIPMENTS_API_NOT_READY');
    setClients(cr.items||[]);
    setCases(sr.items||[]);
    setShipments(shipmentBody.items||[]);
    setOrders(orr.items||[]);
    if(caseId){
     const detail=await cloudflareCasesApi.get(caseId);
     setDocuments((detail.documents||[]).map((d:any)=>({
      id:d.id,doc_type:d.document_type||'other',file_name:d.display_name||d.original_name||'سند',
      file_size_bytes:null,created_at:d.created_at,storage_path:null,
     })));
     setPermits(detail.permits||[]);
    }else{setDocuments([]);setPermits([])}
   }catch(error:any){
    setMessage(error?.message||'دریافت اطلاعات از Cloudflare D1 ناموفق بود.');
   }
   return;
  }
  const [cr,sr,shr,orr]=await Promise.all([
   supabase.from('clients').select('id,name,national_id').order('name'),
   supabase.from('cases').select('id,case_number,status,client_id,registration_order_no,proforma_no,vessel_type,unloading_date,warehouse_receipt_no,warehouse_receipt_date,release_status,cargo_count,cargo_count_unit,cargo_description,origin_country_code,transaction_country_code,delivery_term,invoice_amount,invoice_currency,insurance_amount_irr,tariff_code,import_duty_rate,net_weight_kg,gross_weight_kg,created_at').order('created_at',{ascending:false}),
   supabase.from('shipments').select('id,client_id,case_id,shipping_line,bill_of_lading_no,bill_of_lading_year,voyage_no,origin_port,destination_port,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,vessel_id,created_at').order('created_at',{ascending:false}),
   supabase.from('registration_orders').select('id,client_id,case_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,notes,created_at').order('created_at',{ascending:false})
  ]);
  setClients(cr.data||[]);setCases(sr.data||[]);setShipments(shr.data||[]);setOrders(orr.data||[]);
  if(caseId){
   const [dr,pr]=await Promise.all([
    supabase.from('documents').select('id,case_id,doc_type,file_name,storage_path,mime_type,file_size_bytes,version,created_at').eq('case_id',caseId).order('created_at',{ascending:false}),
    supabase.from('permits').select('id,case_id,permit_type,permit_number,issuing_authority,status,issued_at,expires_at,created_at').eq('case_id',caseId).order('created_at',{ascending:false})
   ]);setDocuments(dr.data||[]);setPermits(pr.data||[])
  } else {setDocuments([]);setPermits([])}
 };
 const selectedClient=useMemo(()=>clients.find(c=>c.id===clientId),[clients,clientId]);
 const ownerLabel=selectedClient?.name||form.client||'—';
 const applyShipment=(s:any)=>{if(!s)return;setForm(p=>({...p,shippingLine:s.shipping_line||'',billOfLading:s.bill_of_lading_no||'',billYear:String(s.bill_of_lading_year||p.billYear),voyageNo:s.voyage_no||'',originPort:s.origin_port||'',destinationPort:s.destination_port||'',cargoCount:s.cargo_count==null?p.cargoCount:String(s.cargo_count),cargoCountUnit:s.cargo_count_unit||p.cargoCountUnit,netWeight:s.net_weight_kg==null?p.netWeight:String(s.net_weight_kg),grossWeight:s.gross_weight_kg==null?p.grossWeight:String(s.gross_weight_kg)}))};
 const selectCase=(id:string)=>{const c=cases.find(x=>x.id===id);if(!c){setCaseId('');return}setCaseId(id);setClientId(c.client_id||'');const owner=clients.find(x=>x.id===c.client_id);setForm(p=>({...p,clientId:c.client_id||'',client:owner?.name||'',regNumber:c.registration_order_no||'',vesselType:c.vessel_type||p.vesselType,unloadingDate:c.unloading_date||'',warehouseReceiptNo:c.warehouse_receipt_no||'',warehouseReceiptDate:c.warehouse_receipt_date||'',releaseStatus:c.release_status||'pending',cargoCount:String(c.cargo_count??''),cargoCountUnit:c.cargo_count_unit||'',cargoDescription:c.cargo_description||'',originCountry:c.origin_country_code||'',transactionCountry:c.transaction_country_code||'',deliveryTerm:c.delivery_term||'',invoiceAmount:String(c.invoice_amount??''),invoiceCurrency:c.invoice_currency||'USD',insuranceIrr:String(c.insurance_amount_irr??''),tariffCode:c.tariff_code||'',dutyRate:String(c.import_duty_rate??''),netWeight:String(c.net_weight_kg??''),grossWeight:String(c.gross_weight_kg??'')}));setVal({customsValue:String(c.customs_value_irr??''),dutyRate:String(c.import_duty_rate??''),duty:String(c.import_duty_irr??''),vat:String(c.vat_irr??''),total:String(c.total_payable_irr??'')});setValResult(null);const linkedOrder=orders.find(o=>o.case_id===id);if(linkedOrder||c.registration_order_no)setOrderForm(p=>({...p,number:linkedOrder?.order_number||c.registration_order_no||p.number,date:linkedOrder?.order_date||p.date,status:linkedOrder?.status||'received',tariff:linkedOrder?.tariff_code||c.tariff_code||p.tariff,quantity:String(linkedOrder?.quantity??c.cargo_count??p.quantity),unit:linkedOrder?.quantity_unit||c.cargo_count_unit||p.unit,value:String(linkedOrder?.value_amount??c.invoice_amount??p.value),currency:linkedOrder?.currency||c.invoice_currency||p.currency,bankName:linkedOrder?.bank_name||p.bankName,bankBranch:linkedOrder?.bank_branch||p.bankBranch,bankBranchCode:linkedOrder?.bank_branch_code||p.bankBranchCode,paymentInstrumentCode:linkedOrder?.payment_instrument_code||p.paymentInstrumentCode,notes:linkedOrder?.notes||p.notes}));const s=shipments.find(x=>x.case_id===id);if(s)applyShipment(s)};
 const createCase=async()=>{
  if(!clientId)return setMessage('ابتدا صاحب کالا را انتخاب کنید.');
  setBusy(true);
  try{
   if(cloudflareMode){
    const result=await cloudflareCasesApi.create({client_id:clientId,registration_order_no:form.regNumber.trim()||null});
    setCaseId(result.case.id);
    if(form.regNumber.trim())setOrderForm({
     number:form.regNumber.trim(),date:form.regDate,status:'received',tariff:form.tariffCode,
     quantity:form.cargoCount,unit:form.cargoCountUnit,value:form.invoiceAmount,
     currency:form.invoiceCurrency||'USD',bankName:'',bankBranch:'',bankBranchCode:'',paymentInstrumentCode:'',notes:'',
    });
    setMessage(result.created?'پرونده در Cloudflare D1 ایجاد شد؛ ثبت سفارش مادر برای اتصال به پرونده در تب ثبت سفارش آماده شده است.':'پرونده با همین شماره ثبت سفارش از قبل وجود داشت و بازیابی شد.');
    await load();
    return;
   }
   const owner=clients.find(c=>c.id===clientId);
   const {data,error}=await supabase.rpc('create_case_workflow',{p_client_name:owner?.name||form.client,p_registration_order_no:null});
   if(error)throw error;
   if(form.regNumber.trim()){
    const {error:e}=await supabase.rpc('attach_registration_order',{p_case_id:data,p_order_number:form.regNumber.trim(),p_order_date:dateDb(form.regDate),p_status:'received',p_tariff_code:form.tariffCode||null,p_quantity:num(form.cargoCount),p_quantity_unit:form.cargoCountUnit||null,p_value_amount:num(form.invoiceAmount),p_currency:form.invoiceCurrency||null,p_notes:null});
    if(e)throw e
   }
   setCaseId(data);setMessage('پرونده ایجاد شد.');await load()
  }catch(e:any){setMessage(e?.message||'خطا در ایجاد پرونده')}
  finally{setBusy(false)}
 };
 const saveOp=async()=>{
  if(!caseId)return setMessage('ابتدا پرونده را انتخاب یا ایجاد کنید.');
  setBusy(true);
  try{
   if(cloudflareMode){
    const patch={
     vessel_type:form.vesselType||null,
     unloading_date:dateDb(form.unloadingDate),
     warehouse_receipt_no:form.warehouseReceiptNo||null,
     warehouse_receipt_date:dateDb(form.warehouseReceiptDate),
     release_status:form.releaseStatus||'pending',
     cargo_count:num(form.cargoCount),
     cargo_count_unit:form.cargoCountUnit||null,
     cargo_description:form.cargoDescription||null,
     origin_country_code:form.originCountry||null,
     transaction_country_code:form.transactionCountry||null,
     delivery_term:form.deliveryTerm||null,
     invoice_amount:num(form.invoiceAmount),
     invoice_currency:form.invoiceCurrency||null,
     net_weight_kg:num(form.netWeight),
     gross_weight_kg:num(form.grossWeight),
     insurance_amount_irr:num(form.insuranceIrr),
     tariff_code:form.tariffCode||null,
     import_duty_rate:num(form.dutyRate),
    };
    await cloudflareCasesApi.update(caseId,patch);
    const linkedShipment=shipments.find(s=>s.case_id===caseId);
    const hasMaritimeInput=Boolean(form.billOfLading.trim()&&form.shippingLine.trim()&&form.vesselName.trim());
    if(linkedShipment&&hasMaritimeInput){
     const response=await fetch('/api/shipments/'+encodeURIComponent(linkedShipment.id),{
      method:'PATCH',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
       clientId:clientId||linkedShipment.client_id,
       caseId,
       registrationOrderId:linkedShipment.registration_order_id||null,
       shippingLine:form.shippingLine,
       billOfLading:form.billOfLading,
       billOfLadingYear:Number(form.billYear),
       voyageNo:form.voyageNo||null,
       vesselName:form.vesselName,
       vesselImo:null,vesselFlag:null,
       originPort:form.originPort||null,destinationPort:form.destinationPort||null,
       cargoCount:num(form.cargoCount)??linkedShipment.cargo_count,
       cargoCountUnit:form.cargoCountUnit||linkedShipment.cargo_count_unit||'رول',
       netWeightKg:num(form.netWeight)??linkedShipment.net_weight_kg,
       grossWeightKg:num(form.grossWeight)??linkedShipment.gross_weight_kg,
       currentStatus:linkedShipment.current_status||'draft',
       currentLocation:linkedShipment.current_location||null,
       transportDocumentsStatus:linkedShipment.transport_documents_status||'not_ready',
       releaseInvoicePaymentStatus:linkedShipment.release_invoice_payment_status||'unpaid',
       registrationOrderNo:form.regNumber||linkedShipment.registration_order_no||null,
       customsRegime:linkedShipment.customs_regime||null,
       sataCode:linkedShipment.sata_code||null,
       cargoDescription:form.cargoDescription||linkedShipment.cargo_description||null,
      }),
     });
     const body=await response.json() as {ok?:boolean;error?:string};
     if(!response.ok||!body.ok)throw new Error('اطلاعات پرونده ذخیره شد، اما همگام‌سازی محموله ناموفق بود: '+(body.error||response.status));
    }
    try{localStorage.setItem('customs_last_maritime',JSON.stringify({...form,clientId}))}catch{}
    setMessage(linkedShipment&&hasMaritimeInput?'اطلاعات پرونده و محموله در Cloudflare D1 ذخیره شد.':'اطلاعات عملیاتی پرونده در Cloudflare D1 ذخیره شد.');
    await load();
    return;
   }
   const {error}=await supabase.rpc('update_case_operational_data',{p_case_id:caseId,p_vessel_type:form.vesselType||null,p_unloading_date:dateDb(form.unloadingDate),p_warehouse_receipt_no:form.warehouseReceiptNo||null,p_warehouse_receipt_date:dateDb(form.warehouseReceiptDate),p_release_status:form.releaseStatus,p_cargo_count:num(form.cargoCount),p_cargo_count_unit:form.cargoCountUnit||null,p_cargo_description:form.cargoDescription||null,p_origin_country_code:form.originCountry||null,p_transaction_country_code:form.transactionCountry||null,p_delivery_term:form.deliveryTerm||null,p_invoice_amount:num(form.invoiceAmount),p_invoice_currency:form.invoiceCurrency||null,p_net_weight_kg:num(form.netWeight),p_gross_weight_kg:num(form.grossWeight),p_insurance_amount_irr:num(form.insuranceIrr),p_tariff_code:form.tariffCode||null,p_import_duty_rate:num(form.dutyRate)});
   if(error)throw error;
   if(form.billOfLading&&form.shippingLine&&form.vesselName){
    const {error:e}=await supabase.rpc('update_shipment_maritime_data',{p_case_id:caseId,p_shipping_line:form.shippingLine,p_bill_of_lading_no:form.billOfLading,p_bill_of_lading_year:Number(form.billYear),p_vessel_name:form.vesselName,p_vessel_imo:null,p_vessel_flag_code:null,p_voyage_no:form.voyageNo||null,p_origin_port:form.originPort||null,p_destination_port:form.destinationPort||null,p_cargo_count:num(form.cargoCount),p_cargo_count_unit:form.cargoCountUnit||null,p_net_weight_kg:num(form.netWeight),p_gross_weight_kg:num(form.grossWeight),p_tally_no:null,p_release_invoice_no:null,p_release_invoice_date:null,p_release_status:form.releaseStatus,p_electronic_release_no:null,p_client_id:clientId||null});
    if(e)throw e;
    try{localStorage.setItem('customs_last_maritime',JSON.stringify({...form,clientId}))}catch{}
   }
   setMessage('اطلاعات پرونده ذخیره و با کشتیرانی همگام شد.');await load()
  }catch(e:any){setMessage(e?.message||'خطا در ذخیره اطلاعات')}
  finally{setBusy(false)}
 };
 const applyPaste=()=>{const m:Record<string,string>={};paste.split(/\r?\n/).forEach(l=>{const x=l.match(/^\s*([^:=：]+?)\s*[:=：]\s*(.*?)\s*$/);if(x)m[x[1].trim()]=x[2].trim()});const get=(...keys:string[])=>Object.entries(m).find(([k])=>keys.some(x=>k.toLowerCase().includes(x.toLowerCase())))?.[1]||'';setForm(p=>({...p,shippingLine:get('کشتیرانی','shipping')||p.shippingLine,vesselName:get('کشتی','vessel')||p.vesselName,billOfLading:get('B/L','بارنامه','bill of lading')||p.billOfLading,voyageNo:get('voyage')||p.voyageNo,cargoCount:get('تعداد','quantity')||p.cargoCount,cargoCountUnit:get('واحد','unit')||p.cargoCountUnit,cargoDescription:get('شرح کالا','cargo description')||p.cargoDescription,originCountry:get('مبدأ','origin')||p.originCountry,transactionCountry:get('کشور معامله','transaction')||p.transactionCountry,deliveryTerm:get('اینکوترمز','incoterm')||p.deliveryTerm,invoiceAmount:get('فاکتور','invoice')||p.invoiceAmount,invoiceCurrency:get('ارز','currency')||p.invoiceCurrency,netWeight:get('وزن خالص','net weight')||p.netWeight,grossWeight:get('وزن ناخالص','gross weight')||p.grossWeight,insuranceIrr:get('بیمه ریالی','insurance')||p.insuranceIrr,tariffCode:get('HS','تعرفه')||p.tariffCode,dutyRate:get('حقوق ورودی','duty rate').replace('%','')||p.dutyRate,regNumber:get('ثبت سفارش','registration order')||p.regNumber,regDate:get('تاریخ ثبت سفارش','registration order date')||p.regDate,unloadingDate:get('تاریخ تخلیه','unloading date')||p.unloadingDate,warehouseReceiptNo:get('شماره قبض انبار','warehouse receipt')||p.warehouseReceiptNo}));setPaste('');setPasteOpen(false);setMessage('اطلاعات روی فرم عملیات اعمال شد؛ قبل از ذخیره کنترل کنید.')};
 const addOrder=async()=>{
  if(!orderForm.number.trim())return setMessage('شماره ثبت سفارش الزامی است.');
  if(!clientId)return setMessage('صاحب کالا را انتخاب کنید.');
  setBusy(true);
  try{
   if(cloudflareMode){
    const existingOrder=orders.find(o=>String(o.order_number).trim()===orderForm.number.trim());
    const d1OrderInput={
     client_id:clientId,case_id:caseId||null,order_number:orderForm.number.trim(),order_date:dateDb(orderForm.date),
     status:orderForm.status==='active'?'verified':orderForm.status==='expired'?'cancelled':orderForm.status as any,
     tariff_code:orderForm.tariff||form.tariffCode||null,
     quantity:num(orderForm.quantity)??num(form.cargoCount),
     quantity_unit:orderForm.unit||form.cargoCountUnit||null,
     net_weight_kg:num(form.netWeight),gross_weight_kg:num(form.grossWeight),
     value_amount:num(orderForm.value)??num(form.invoiceAmount),
     currency:(orderForm.value.trim()||form.invoiceAmount.trim())?orderForm.currency||form.invoiceCurrency:null,
     bank_name:orderForm.bankName.trim()||existingOrder?.bank_name||null,
     bank_branch:orderForm.bankBranch.trim()||existingOrder?.bank_branch||null,
     bank_branch_code:orderForm.bankBranchCode.trim()||existingOrder?.bank_branch_code||null,
     payment_instrument_code:orderForm.paymentInstrumentCode.trim()||existingOrder?.payment_instrument_code||null,
     notes:orderForm.notes||null,
    };
    if(!d1OrderInput.bank_name||!d1OrderInput.bank_branch||!d1OrderInput.bank_branch_code||!d1OrderInput.payment_instrument_code){
     throw new Error('برای هر ثبت سفارش، بانک، شعبه، کد شعبه و شماره اعتبار اسنادی الزامی است.');
    }
    if(existingOrder){
     if(existingOrder.client_id!==clientId)throw new Error('این شماره ثبت سفارش از قبل برای صاحب کالای دیگری ثبت شده است.');
     if(existingOrder.case_id&&existingOrder.case_id!==caseId)throw new Error('این ثبت سفارش به پرونده دیگری متصل است و جابه‌جایی آن مجاز نیست.');
     await cloudflareRegistrationOrdersApi.update(existingOrder.id,d1OrderInput);
     setMessage(caseId?'ثبت سفارش موجود به همین پرونده متصل شد.':'ثبت سفارش در Cloudflare D1 به‌روزرسانی شد.');
    }else{
     await cloudflareRegistrationOrdersApi.create(d1OrderInput);
     setMessage(caseId?'ثبت سفارش مادر در Cloudflare D1 به پرونده متصل شد.':'ثبت سفارش مستقل در Cloudflare D1 ثبت شد.');
    }
   }else if(caseId){
    const {error}=await supabase.rpc('attach_registration_order',{p_case_id:caseId,p_order_number:orderForm.number.trim(),p_order_date:dateDb(orderForm.date),p_status:orderForm.status,p_tariff_code:orderForm.tariff||null,p_quantity:num(orderForm.quantity),p_quantity_unit:orderForm.unit||null,p_value_amount:num(orderForm.value),p_currency:orderForm.currency||null,p_notes:orderForm.notes||null});
    if(error)throw error;setMessage('ثبت سفارش به پرونده متصل شد.')
   }else{
    const {error}=await supabase.from('registration_orders').insert({client_id:clientId,order_number:orderForm.number.trim(),order_date:dateDb(orderForm.date),status:orderForm.status,tariff_code:orderForm.tariff||null,quantity:num(orderForm.quantity),quantity_unit:orderForm.unit||null,value_amount:num(orderForm.value),currency:orderForm.currency||null,notes:orderForm.notes||null});
    if(error)throw error;setMessage('ثبت سفارش مستقل برای صاحب کالا ثبت شد.')
   }
   setOrderForm({number:'',date:'',status:'received',tariff:'',quantity:'',unit:'',value:'',currency:'USD',bankName:'',bankBranch:'',bankBranchCode:'',paymentInstrumentCode:'',notes:''});await load()
  }catch(e:any){setMessage(e?.message||'خطا در ثبت سفارش')}
  finally{setBusy(false)}
 };
 const deleteOrder=async(id:string)=>{if(cloudflareMode)return setMessage('حذف ثبت سفارش در API D1 هنوز پیاده‌سازی نشده است؛ هیچ درخواستی ارسال نشد.');if(!window.confirm('این ثبت سفارش حذف شود؟'))return;setBusy(true);try{const{error}=await supabase.from('registration_orders').delete().eq('id',id);if(error)throw error;setMessage('ثبت سفارش حذف شد.');await load()}catch(e:any){setMessage(e?.message||'حذف انجام نشد')}finally{setBusy(false)}};
 const addPermit=async()=>{
  if(!caseId)return setMessage('ابتدا پرونده را انتخاب کنید.');
  if(!permitForm.type||!permitForm.authority)return setMessage('نوع مجوز و مرجع صادرکننده الزامی است.');
  setBusy(true);
  try{
   if(cloudflareMode){
    await cloudflareCasesApi.createPermit(caseId,{
     permit_type:permitForm.type.trim(),permit_number:permitForm.number.trim()||null,
     issuing_authority:permitForm.authority.trim(),status:permitForm.status as any,
     issued_at:permitForm.issued?new Date(permitForm.issued).toISOString():null,
     expires_at:permitForm.expires?new Date(permitForm.expires).toISOString():null,
    });
   }else{
    const {error}=await supabase.from('permits').insert({case_id:caseId,permit_type:permitForm.type.trim(),permit_number:permitForm.number.trim()||null,issuing_authority:permitForm.authority.trim(),status:permitForm.status,issued_at:permitForm.issued?new Date(permitForm.issued).toISOString():null,expires_at:permitForm.expires?new Date(permitForm.expires).toISOString():null});
    if(error)throw error;
   }
   setPermitForm({type:'',number:'',authority:'',status:'pending',issued:'',expires:'',notes:''});
   setMessage('مجوز ثبت شد.');await load()
  }catch(e:any){setMessage(e?.message||'خطا در ثبت مجوز')}
  finally{setBusy(false)}
 };
 const deletePermit=async(id:string)=>{
  if(!window.confirm('مجوز حذف شود؟'))return;
  setBusy(true);
  try{
   if(cloudflareMode)await cloudflareCasesApi.deletePermit(caseId,id);
   else{
    const {error}=await supabase.from('permits').delete().eq('id',id);
    if(error)throw error;
   }
   setMessage('مجوز حذف شد.');await load()
  }catch(e:any){setMessage(e?.message||'حذف انجام نشد')}
  finally{setBusy(false)}
 };
 const uploadDocument=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];e.target.value='';if(!file||!caseId)return;if(cloudflareMode)return setMessage('بارگذاری فایل تا تکمیل اتصال R2 و آرشیو اسناد فعال نشده است.');if(!['application/pdf','image/jpeg','image/png'].includes(file.type))return setMessage('فقط PDF/JPEG/PNG مجاز است.');if(file.size>15*1024*1024)return setMessage('حداکثر حجم فایل ۱۵MB است.');setBusy(true);try{const safe=file.name.replace(/[^\p{L}\p{N}._-]+/gu,'_');const path=`${caseId}/${makeCompatibleUUID()}-${safe}`;const{error:up}=await supabase.storage.from('customs_documents').upload(path,file,{contentType:file.type,upsert:false});if(up)throw up;const{error:ins}=await supabase.from('documents').insert({case_id:caseId,doc_type:docType,file_name:file.name,storage_path:path,mime_type:file.type,file_size_bytes:file.size,version:1});if(ins){await supabase.storage.from('customs_documents').remove([path]);throw ins}setMessage('سند با موفقیت بارگذاری شد.');await load()}catch(err:any){setMessage(err?.message||'خطا در بارگذاری سند')}finally{setBusy(false)}};
 const deleteDocument=async(id:string,path:string)=>{if(cloudflareMode)return setMessage('حذف فایل تا تکمیل انتقال باینری‌ها به R2/Telegram فعال نشده است.');if(!window.confirm('این سند حذف شود؟'))return;setBusy(true);try{const{error}=await supabase.from('documents').delete().eq('id',id);if(error)throw error;await supabase.storage.from('customs_documents').remove([path]);setMessage('سند حذف شد.');await load()}catch(e:any){setMessage(e?.message||'حذف سند انجام نشد')}finally{setBusy(false)}};
 const valuation=async()=>{
  if(!caseId)return setMessage('ابتدا پرونده را انتخاب کنید.');
  const customsValue=num(val.customsValue);
  if(customsValue===null||customsValue<0)return setMessage('ارزش گمرکی معتبر و غیرمنفی الزامی است.');
  setBusy(true);
  try{
   const input={
    customs_value_irr:val.customsValue,
    import_duty_rate:val.dutyRate.trim()||null,
    import_duty_irr:val.duty.trim()||null,
    vat_irr:val.vat.trim()||null,
    total_payable_irr:val.total.trim()||null,
   };
   if(cloudflareMode){
    const result=await cloudflareCasesApi.completeValuation(caseId,input);
    setValResult(result.valuation);
    setMessage('ارزش‌گذاری واردشده در Cloudflare D1 ثبت و مرحله پرونده تأیید شد.');
    await load();
    return;
   }
   const {error}=await supabase.rpc('complete_case_valuation',{
    p_case_id:caseId,p_customs_value_irr:customsValue,
    p_import_duty_rate:num(val.dutyRate),p_import_duty_irr:num(val.duty),
    p_vat_irr:num(val.vat),p_total_payable_irr:num(val.total),
   });
   if(error)throw error;
   setValResult(input);setMessage('ارزش‌گذاری ثبت و تأیید شد.');await load()
  }catch(e:any){setMessage(e?.message||'خطا در ثبت ارزش‌گذاری')}
  finally{setBusy(false)}
 };
 const declaration=async()=>{if(cloudflareMode)return setMessage('ثبت اظهار از طریق API D1 هنوز تکمیل نشده است؛ هیچ درخواستی به Supabase ارسال نشد.');if(!caseId||!decl.kottaj.trim())return setMessage('پرونده و کوتاژ الزامی است.');setBusy(true);try{const {error}=await supabase.rpc('register_declaration_workflow',{p_case_id:caseId,p_kottaj_number:decl.kottaj.trim(),p_declaration_date:new Date().toISOString(),p_customs_office_id:null,p_customs_path:decl.path||null,p_assessed_value_irr:null,p_total_duties_irr:null});if(error)throw error;setMessage('اظهار و کوتاژ ثبت شد.');await load()}catch(e:any){setMessage(e?.message||'خطا در ثبت اظهار')}finally{setBusy(false)}};
 const removeCase=async()=>{
  if(cloudflareMode)return setMessage('حذف ایمن پرونده هنوز در API D1 پیاده‌سازی و آزمون نشده است؛ هیچ درخواستی ارسال نشد.');
  if(!caseId)return;
  if(!window.confirm('حذف کامل پرونده انجام شود؟ Audit و Status History باقی می‌مانند.'))return;
  setBusy(true);
  try{
   const {error}=await supabase.rpc('delete_case_workflow',{p_case_id:caseId});
   if(error)throw error;setCaseId('');setMessage('پرونده حذف شد؛ Audit/History باقی ماند.');await load()
  }catch(e:any){setMessage(e?.message||'خطا در حذف پرونده')}
  finally{setBusy(false)}
 };
 const input=(k:string,label:string,dir='rtl')=><label key={k} className="text-xs text-slate-400">{label}<input value={form[k]||''} onChange={e=>set(k,e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5" dir={dir}/></label>;
 return <main className="operations-page min-h-screen bg-slate-950 text-slate-100 p-5 md:p-8" dir="rtl"><div className="max-w-7xl mx-auto">
  <header className="flex items-center justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black">عملیات گمرکی / Customs Operations</h1><p className="text-sm text-slate-400 mt-2">یک پرونده، یک منبع اطلاعات؛ ثبت سفارش می‌تواند قبل یا بعد از ایجاد پرونده وارد شود.</p></div><Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900"><ArrowRight className="inline ml-2" size={16}/> صفحه اصلی</Link></header>
  <section className="flex flex-wrap gap-2 mb-5"><select value={caseId} onChange={e=>selectCase(e.target.value)} className="min-w-[340px] bg-slate-900 border border-slate-800 rounded-xl p-3"><option value="">انتخاب پرونده</option>{cases.map(c=><option key={c.id} value={c.id}>{clients.find(x=>x.id===c.client_id)?.name||'—'} — {c.case_number||c.id.slice(0,8)} — {c.status}</option>)}</select><select value={clientId} onChange={e=>{setClientId(e.target.value);const c=clients.find(x=>x.id===e.target.value);setForm(p=>({...p,clientId:e.target.value,client:c?.name||''}))}} className="min-w-[300px] bg-slate-900 border border-slate-800 rounded-xl p-3"><option value="">صاحب کالا</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name} — {c.national_id||'—'}</option>)}</select><button onClick={createCase} disabled={busy||!clientId} className="px-5 py-3 rounded-xl bg-blue-600 disabled:opacity-40 font-bold">ثبت پرونده جدید</button>{caseId&&!cloudflareMode&&<button onClick={removeCase} disabled={busy} className="px-5 py-3 rounded-xl border border-red-800 text-red-300"><Trash2 className="inline ml-2" size={16}/> حذف پرونده</button>}</section>
  {message&&<div className="mb-4 p-3 rounded-xl bg-slate-900 border border-slate-800 text-sm">{message}</div>}
  <section className="flex flex-wrap gap-2 mb-4"><button onClick={()=>changeTab('operation')} className={`px-4 py-2 rounded-xl ${tab==='operation'?'bg-cyan-700':'bg-slate-900 border border-slate-800'}`}>Operation</button><button onClick={()=>changeTab('registration')} className={`px-4 py-2 rounded-xl ${tab==='registration'?'bg-amber-700':'bg-slate-900 border border-slate-800'}`}>ثبت سفارش</button>{!cloudflareMode&&<button onClick={()=>changeTab('declaration')} className={`px-4 py-2 rounded-xl ${tab==='declaration'?'bg-blue-700':'bg-slate-900 border border-slate-800'}`}>اظهار / EPL</button>}<button onClick={()=>changeTab('valuation')} className={`px-4 py-2 rounded-xl ${tab==='valuation'?'bg-emerald-700':'bg-slate-900 border border-slate-800'}`}>ارزش‌گذاری</button><button onClick={()=>changeTab('documents')} className={`px-4 py-2 rounded-xl ${tab==='documents'?'bg-violet-700':'bg-slate-900 border border-slate-800'}`}><FileText className="inline ml-1" size={16}/> اسناد و مجوزها</button></section>
  {tab==='operation'&&<><section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"><button onClick={()=>setPasteOpen(v=>!v)} className="w-full px-5 py-4 flex items-center justify-between text-right"><span className="flex items-center gap-2 font-bold"><ClipboardPaste size={18} className="text-cyan-400"/> ورود سریع اطلاعات</span><span className="text-xs text-slate-500">Smart Paste · {pasteOpen?'بستن':'باز کردن'}</span></button>{pasteOpen&&<div className="p-5 border-t border-slate-800"><textarea value={paste} onChange={e=>setPaste(e.target.value)} className="w-full min-h-36 bg-slate-950 border border-slate-800 rounded-xl p-3" placeholder="کشتیرانی: ...\nکشتی: ...\nB/L: ...\nتعداد: ...\nوزن خالص: ...\nوزن ناخالص: ..."/><div className="mt-3 flex gap-2"><button onClick={applyPaste} className="px-5 py-2 rounded-xl bg-cyan-700">اعمال اطلاعات</button><button onClick={()=>setPaste('')} className="px-5 py-2 rounded-xl border border-slate-700">پاک کردن</button></div></div>}</section><section className="mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="mb-4 rounded-xl bg-slate-950 border border-slate-800 p-4"><div className="text-xs text-slate-500">صاحب کالا / Cargo Owner</div><div className="font-black text-lg mt-1">{ownerLabel}</div></div><div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">{Object.entries({regNumber:'شماره ثبت سفارش',regDate:'تاریخ ثبت سفارش',vesselType:'نوع کشتی',unloadingDate:'تاریخ تخلیه',warehouseReceiptNo:'شماره قبض انبار',warehouseReceiptDate:'تاریخ قبض انبار',cargoCount:'تعداد کالا',cargoCountUnit:'واحد',cargoDescription:'شرح کالا',originCountry:'مبدأ',transactionCountry:'کشور معامله',deliveryTerm:'اینکوترمز',invoiceAmount:'مبلغ فاکتور',invoiceCurrency:'ارز',netWeight:'وزن خالص kg',grossWeight:'وزن ناخالص kg',insuranceIrr:'بیمه ریالی',tariffCode:'HS / کد تعرفه',dutyRate:'حقوق ورودی %',shippingLine:'کشتیرانی',billOfLading:'B/L',billYear:'سال B/L',vesselName:'کشتی',voyageNo:'Voyage',originPort:'بندر مبدأ',destinationPort:'بندر مقصد'}).map(([k,l])=>input(k,l,['regNumber','regDate','cargoCount','invoiceAmount','invoiceCurrency','netWeight','grossWeight','insuranceIrr','tariffCode','dutyRate','billOfLading','billYear','voyageNo'].includes(k)?'ltr':'rtl'))}</div><button onClick={saveOp} disabled={busy||!caseId} className="mt-5 px-6 py-3 rounded-xl bg-blue-600 disabled:opacity-40 font-bold">{busy?<Loader2 className="inline animate-spin ml-2" size={16}/>:<Save className="inline ml-2" size={16}/>} ذخیره و همگام‌سازی</button></section></>}
  {tab==='registration'&&<section className="space-y-5"><div className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-bold mb-4 flex items-center gap-2"><Plus size={18}/> ثبت سفارش {caseId?'برای پرونده انتخاب‌شده':'مستقل'}</h2><div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">{[['number','شماره ثبت سفارش'],['date','تاریخ'],['tariff','HS / تعرفه'],['quantity','مقدار'],['unit','واحد'],['value','ارزش'],['bankName','نام بانک'],['bankBranch','نام شعبه'],['bankBranchCode','کد شعبه'],['paymentInstrumentCode','شماره اعتبار اسنادی'],['notes','یادداشت']].map(([k,l])=><label key={k} className="text-xs text-slate-400">{l}<input value={(orderForm as any)[k]} onChange={e=>setOrderForm(p=>({...p,[k]:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5" dir={['number','date','tariff','quantity','value'].includes(k)?'ltr':'rtl'}/></label>)}<label className="text-xs text-slate-400">وضعیت<select value={orderForm.status} onChange={e=>setOrderForm(p=>({...p,status:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5"><option value="received">دریافت شد</option><option value="verified">تأیید شد</option><option value="active">فعال</option><option value="used">استفاده شد</option><option value="cancelled">لغو شد</option><option value="expired">منقضی</option></select></label><label className="text-xs text-slate-400">ارز<select value={orderForm.currency} onChange={e=>setOrderForm(p=>({...p,currency:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-3" dir="ltr">{['USD','EUR','AED','CNY','RUB','GBP','CHF','TRY','IRR'].map(x=><option key={x}>{x}</option>)}</select></label></div><button onClick={addOrder} disabled={busy||!clientId} className="mt-5 px-6 py-3 rounded-xl bg-amber-700 font-bold">ثبت سفارش {cloudflareMode&&caseId?'و اتصال به پرونده':''}</button></div><div className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h3 className="font-bold mb-3">ثبت سفارش‌های موجود</h3><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="p-2">شماره</th><th>تاریخ</th><th>وضعیت</th><th>HS</th><th>صاحب کالا</th><th>پرونده</th><th></th></tr></thead><tbody>{orders.length===0?<tr><td colSpan={7} className="p-4 text-slate-500">موردی ثبت نشده.</td></tr>:orders.map(o=><tr key={o.id} className="border-b border-slate-900"><td className="p-2" dir="ltr">{o.order_number}</td><td>{o.order_date||'—'}</td><td>{o.status}</td><td dir="ltr">{o.tariff_code||'—'}</td><td>{clients.find(c=>c.id===o.client_id)?.name||'—'}</td><td>{cases.find(c=>c.id===o.case_id)?.case_number||'مستقل'}</td><td>{!cloudflareMode&&<button onClick={()=>deleteOrder(o.id)} className="text-red-300"><Trash2 size={16}/></button>}</td></tr>)}</tbody></table></div></div></section>}
  {!cloudflareMode&&tab==='declaration'&&<section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-bold mb-4 flex items-center gap-2"><FileCheck2/> اظهار گمرکی / EPL</h2><div className="grid md:grid-cols-2 gap-4"><label className="text-xs text-slate-400">شماره کوتاژ<input value={decl.kottaj} onChange={e=>setDecl(p=>({...p,kottaj:e.target.value}))} dir="ltr" className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-3"/></label><label className="text-xs text-slate-400">مسیر گمرکی<select value={decl.path} onChange={e=>setDecl(p=>({...p,path:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-3"><option value="">انتخاب</option><option value="green">🟢 سبز</option><option value="yellow">🟡 زرد</option><option value="red">🔴 قرمز</option></select></label></div><button onClick={declaration} disabled={busy||!caseId} className="mt-5 px-6 py-3 rounded-xl bg-blue-600">ثبت اظهار و کوتاژ</button></section>}
  {tab==='valuation'&&<section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-bold mb-4 flex items-center gap-2"><Calculator/> ارزش‌گذاری / ثبت و تأیید</h2><p className="text-xs text-slate-400 mb-4">مقادیر قطعی اعلام‌شده توسط ارزیاب/گمرک را وارد کنید؛ در این فرم هیچ محاسبه خودکاری انجام نمی‌شود.</p><div className="grid md:grid-cols-2 gap-4">{Object.entries({customsValue:'ارزش گمرکی (ریال) *',dutyRate:'نرخ حقوق ورودی (%)',duty:'حقوق ورودی (ریال)',vat:'مالیات بر ارزش افزوده (ریال)',total:'مجموع قابل پرداخت (ریال)'}).map(([k,l])=><label key={k} className="text-xs text-slate-400">{l}<input value={(val as any)[k]} onChange={e=>setVal(p=>({...p,[k]:e.target.value}))} inputMode="decimal" dir="ltr" className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-3"/></label>)}</div><button onClick={valuation} disabled={busy||!caseId||!val.customsValue.trim()} className="mt-5 px-6 py-3 rounded-xl bg-emerald-700">ثبت و تأیید ارزش‌گذاری</button>{valResult&&<pre className="mt-5 bg-slate-950 rounded-xl p-4 overflow-auto text-xs" dir="ltr">{JSON.stringify(valResult,null,2)}</pre>}</section>}
  {tab==='documents'&&<section className="space-y-5"><div className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-bold mb-4 flex items-center gap-2"><Upload size={18}/> اسناد پرونده</h2>{!caseId?<p className="text-sm text-slate-400">برای بارگذاری و مدیریت سند، ابتدا پرونده را انتخاب کنید.</p>:<>{cloudflareMode?<p className="text-xs text-amber-300 mb-3">فایل‌های این پرونده هنوز به‌صورت باینری به R2/Telegram منتقل نشده‌اند؛ بارگذاری و حذف در این محیط غیرفعال است.</p>:<div className="flex flex-wrap gap-3 items-end"><label className="text-xs text-slate-400">نوع سند<select value={docType} onChange={e=>setDocType(e.target.value)} className="mt-1 bg-slate-950 border border-slate-800 rounded-xl p-3">{docTypes.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label className="px-5 py-3 rounded-xl bg-violet-700 cursor-pointer font-bold">انتخاب و بارگذاری<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={uploadDocument} className="hidden"/></label><span className="text-xs text-slate-500">PDF/JPEG/PNG · حداکثر ۱۵MB</span></div>}<div className="mt-5 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="p-2">نوع</th><th>نام فایل</th><th>حجم</th><th>تاریخ</th><th></th></tr></thead><tbody>{documents.length===0?<tr><td colSpan={5} className="p-4 text-slate-500">هنوز سندی بارگذاری نشده.</td></tr>:documents.map(d=><tr key={d.id} className="border-b border-slate-900"><td className="p-2">{docTypes.find(x=>x[0]===d.doc_type)?.[1]||d.doc_type}</td><td>{d.file_name}</td><td dir="ltr">{Math.round((d.file_size_bytes||0)/1024)} KB</td><td>{new Date(d.created_at).toLocaleDateString('fa-IR')}</td><td>{!cloudflareMode&&<button onClick={()=>deleteDocument(d.id,d.storage_path)} className="text-red-300"><Trash2 size={16}/></button>}</td></tr>)}</tbody></table></div></>}</div><div className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-bold mb-4 flex items-center gap-2"><ShieldCheck size={18}/> مجوزها / Permits</h2>{!caseId?<p className="text-sm text-slate-400">برای مدیریت مجوز، ابتدا پرونده را انتخاب کنید.</p>:<><div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">{[['type','نوع مجوز'],['number','شماره مجوز'],['authority','مرجع صادرکننده'],['issued','تاریخ صدور'],['expires','تاریخ انقضا']].map(([k,l])=><label key={k} className="text-xs text-slate-400">{l}<input value={(permitForm as any)[k]} onChange={e=>setPermitForm(p=>({...p,[k]:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5"/></label>)}<label className="text-xs text-slate-400">وضعیت<select value={permitForm.status} onChange={e=>setPermitForm(p=>({...p,status:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5"><option value="pending">در انتظار</option><option value="approved">تأیید شد</option><option value="rejected">رد شد</option><option value="not_required">لازم نیست</option></select></label></div><button onClick={addPermit} disabled={busy} className="mt-4 px-5 py-2.5 rounded-xl bg-violet-700">ثبت مجوز</button><div className="mt-5 space-y-2">{permits.length===0?<p className="text-sm text-slate-500">مجوزی ثبت نشده.</p>:permits.map(p=><div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800"><div><b>{p.permit_type}</b><div className="text-xs text-slate-500 mt-1">{p.issuing_authority} · {p.permit_number||'بدون شماره'} · {p.status}</div></div><button onClick={()=>deletePermit(p.id)} className="text-red-300"><Trash2 size={16}/></button></div>)}</div></>}</div></section>}
 </div></main>;
};