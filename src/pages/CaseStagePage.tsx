import React,{useEffect,useState}from'react';
import{ArrowRight,ExternalLink}from'lucide-react';
import{Link,useSearchParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{buildShipmentDisplayName}from'../lib/displayNames';

type CaseRow={id:string;case_number:string|null;status:string;client_id?:string|null;cargo_count?:number|null;cargo_count_unit?:string|null;shipment_cargo_count?:number|null;shipment_cargo_count_unit?:string|null;shipment_client_name?:string|null;shipment_vessel_name?:string|null;effective_display_name?:string|null};
export const CaseStagePage:React.FC=()=>{
 const[p]=useSearchParams();const caseId=p.get('caseId')||'';const[cases,setCases]=useState<CaseRow[]>([]);const[selected,setSelected]=useState(caseId);const[shipmentId,setShipmentId]=useState('');const[customs,setCustoms]=useState<any|null>(null);const[declaration,setDeclaration]=useState<any|null>(null);const[error,setError]=useState('');
 const load=async(id:string)=>{
  setError('');
  try{
   const{data,error:e}=await supabase.from('case_display_context').select('id,case_number,status,client_id,cargo_count,cargo_count_unit,shipment_cargo_count,shipment_cargo_count_unit,shipment_client_name,shipment_vessel_name,effective_display_name').order('created_at',{ascending:false});
   if(e)throw e;setCases((data||[])as CaseRow[]);
   if(!id){setShipmentId('');setCustoms(null);setDeclaration(null);return}
   const{data:ship,error:se}=await supabase.from('shipments').select('id').eq('case_id',id).maybeSingle();if(se)throw se;
   const sid=ship?.id||'';setShipmentId(sid);
   if(!sid){setCustoms(null);setDeclaration(null);return}
   const[{data:cd,error:ce},{data:decl,error:de}]=await Promise.all([
    supabase.from('shipment_customs_data').select('*').eq('shipment_id',sid).maybeSingle(),
    supabase.from('customs_declarations').select('id,kottaj_number,declaration_date,customs_path,payment_reference,total_duties_irr').eq('shipment_id',sid).order('created_at',{ascending:false}).limit(1).maybeSingle()
   ]);
   if(ce||de)throw ce||de;setCustoms(cd||null);setDeclaration(decl||null);
  }catch(e:any){setError(e?.message||'دریافت اطلاعات پرونده انجام نشد')}
 };
 useEffect(()=>{void load(selected)},[selected]);
 const current=cases.find(c=>c.id===selected);
 const display=current?buildShipmentDisplayName({cargo_count:current.shipment_cargo_count??current.cargo_count,cargo_count_unit:current.shipment_cargo_count_unit??current.cargo_count_unit,client_name:current.shipment_client_name,vessel_name:current.shipment_vessel_name}):'';
 return <main dir="rtl" className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-8"><div className="max-w-5xl mx-auto space-y-5">
  <header className="flex items-center justify-between gap-3"><div><div className="text-[10px] app-muted">مدیریت پرونده</div><h1 className="text-2xl md:text-3xl font-black mt-1">مدیریت پرونده</h1><p className="text-xs app-muted mt-1">اطلاعات گمرکی از Shipment خوانده می‌شود؛ این صفحه دیگر مسیر اجرای عملیات پنج‌مرحله‌ای نیست.</p></div><Link to="/" className="px-4 py-2 rounded-xl border app-border bg-[var(--surface)] text-xs font-bold"><ArrowRight className="inline ml-1" size={15}/>صفحه اصلی</Link></header>
  {error&&<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><label className="text-xs app-muted">پرونده</label><select value={selected} onChange={e=>{setSelected(e.target.value);void load(e.target.value)}} className="mt-2 w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"><option value="">انتخاب پرونده</option>{cases.map(c=><option key={c.id} value={c.id}>{c.effective_display_name||buildShipmentDisplayName({cargo_count:c.shipment_cargo_count??c.cargo_count,cargo_count_unit:c.shipment_cargo_count_unit??c.cargo_count_unit,client_name:c.shipment_client_name,vessel_name:c.shipment_vessel_name})}</option>)}</select></section>
  {selected&&<><section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-lg">{display||'پرونده'}</h2><div className="text-xs app-muted mt-1">اطلاعات گمرکی و وضعیت اظهارنامه مرتبط با همین Shipment</div></div>{shipmentId&&<Link to={'/operations?shipmentId='+encodeURIComponent(shipmentId)} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold text-sm"><ExternalLink className="inline ml-1" size={15}/>بازگشت به شروع عملیات</Link>}</div></section>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><h2 className="font-black">اطلاعات گمرکی محموله</h2>{customs?<div className="grid md:grid-cols-3 gap-3 mt-4 text-sm">{[['شماره ثبت سفارش',customs.registration_order_no],['تاریخ ثبت سفارش',customs.registration_order_date_shamsi],['شماره قبض انبار',customs.warehouse_receipt_no],['تاریخ قبض انبار',customs.warehouse_receipt_date_shamsi],['شرح کالا',customs.cargo_description],['کشور مبدا',customs.origin_country],['کشور طرف معامله',customs.transaction_country],['شرایط تحویل',customs.delivery_term],['تعرفه',customs.tariff_code],['وزن خالص',customs.net_weight_kg],['وزن ناخالص',customs.gross_weight_kg],['B/L',customs.bill_of_lading],['مبلغ فاکتور',customs.invoice_amount],['ارز',customs.invoice_currency],['بیمه',customs.insurance_irr]].map(([l,v])=><div key={String(l)}><span className="app-muted text-xs">{l}</span><b className="block mt-1">{v??'—'}</b></div>)}</div>:<div className="text-sm app-muted mt-3">اطلاعات گمرکی برای این محموله هنوز ثبت نشده است.</div>}</section>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><h2 className="font-black">ثبت اظهار مرتبط</h2>{declaration?<div className="grid md:grid-cols-5 gap-3 mt-4 text-sm"><div><span className="app-muted text-xs">کوتاژ</span><b className="block mt-1">{declaration.kottaj_number}</b></div><div><span className="app-muted text-xs">تاریخ</span><b className="block mt-1">{new Date(declaration.declaration_date).toLocaleDateString('fa-IR')}</b></div><div><span className="app-muted text-xs">مسیر</span><b className="block mt-1">{declaration.customs_path||'—'}</b></div><div><span className="app-muted text-xs">شناسه پرداخت</span><b className="block mt-1">{declaration.payment_reference||'—'}</b></div><div><span className="app-muted text-xs">مبلغ گمرکی</span><b className="block mt-1">{declaration.total_duties_irr??'—'}</b></div></div>:<div className="text-sm app-muted mt-3">هنوز اظهارنامه‌ای برای این محموله ثبت نشده است.</div>}</section></>}
 </div></main>
};
