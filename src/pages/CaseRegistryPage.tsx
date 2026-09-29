import React,{useEffect,useMemo,useState}from'react';
import{Loader2,Search,ArrowLeft,Ship,FileText}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';
import{useCaseSelectorData}from'../hooks/useCaseSelectorData';
import{formatCaseDisplayName}from'../lib/shared/case-display';

type Shipment={id:string;case_id:string|null;client_id:string|null;vessel_id:string|null;bill_of_lading_no:string|null;cargo_count:number|string|null;cargo_count_unit:string|null;net_weight_kg:number|string|null;gross_weight_kg:number|string|null;display_name:string;current_status:string|null;transport_documents_status:string|null;release_invoice_payment_status:string|null;finance_status:string|null;updated_at:string;case_created_at:string|null;client_name:string|null;vessel_name:string|null};
type Declaration={id:string;shipment_id:string;case_id:string|null;kottaj_number:string|null;declaration_date:string|null;customs_path:string|null;workflow_stage:number|null};
const fa=(n:number|string|null|undefined)=>n==null?'—':new Intl.NumberFormat('fa-IR').format(Number(n));
const stage=(s:Shipment,d:Declaration|null,customsComplete:boolean)=>{if(s.finance_status==='closed')return'۵';if(d&&customsComplete)return'۵';if(d&&Number(d.workflow_stage)>=4)return'۴';if(d)return'۳';if(s.transport_documents_status==='ready')return'۲';return'۱'};

export const CaseRegistryPage:React.FC=()=>{
 const{profile}=useAuth();
 const{clients,vessels,rows:shipments,loading:selectorLoading,error:selectorError}=useCaseSelectorData(profile?.organization_id);
 const[declarations,setDeclarations]=useState<Declaration[]>([]);
 const[customsComplete,setCustomsComplete]=useState<Record<string,boolean>>({});
 const[clientId,setClientId]=useState('');const[q,setQ]=useState('');
 const[declLoading,setDeclLoading]=useState(false);const[error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;
  (async()=>{
   setDeclLoading(true);
   try{
    const ids=shipments.map(x=>x.id);
    const{data:ds,error:de}=ids.length?await supabase.from('customs_declarations').select('id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,workflow_stage,created_at').in('shipment_id',ids).order('created_at',{ascending:false}):{data:[],error:null};
    if(de)throw de;
    const dids=(ds||[]).map((x:any)=>x.id);
    const{data:ci,error:ce}=dids.length?await supabase.from('declaration_checklist_items').select('declaration_id,item_key,completed').in('declaration_id',dids):{data:[],error:null};
    if(ce)throw ce;
    const cm=new Map<string,number>();(ci||[]).forEach((x:any)=>{if(x.completed)cm.set(x.declaration_id,(cm.get(x.declaration_id)||0)+1)});
    if(cancelled)return;
    setDeclarations((ds||[]) as Declaration[]);
    setCustomsComplete(Object.fromEntries((ds||[]).map((x:any)=>[x.id,(cm.get(x.id)||0)>=11])));
   }catch(e:any){if(!cancelled)setError(e?.message||'دریافت اطلاعات اظهارنامه‌ها انجام نشد')}
   finally{if(!cancelled)setDeclLoading(false)}
  })();
  return()=>{cancelled=true};
 },[shipments]);
 const clientMap=useMemo(()=>new Map(clients.map(c=>[c.id,c.name])),[clients]);
 const vesselMap=useMemo(()=>new Map(vessels.map(v=>[v.id,v.name])),[vessels]);
 const declMap=useMemo(()=>{const m=new Map<string,Declaration>();declarations.forEach(d=>{if(!m.has(d.shipment_id))m.set(d.shipment_id,d)});return m},[declarations]);
 const visible=shipments.filter(s=>{
   const hay=[s.display_name,s.bill_of_lading_no||'',clientMap.get(s.client_id||'')||'',vesselMap.get(s.vessel_id||'')||'',declMap.get(s.id)?.kottaj_number||''].join(' ').toLowerCase();
   return(!clientId||s.client_id===clientId)&&(!q||hay.includes(q.toLowerCase()));
 });
 const loading=selectorLoading||declLoading;
 const display=(s:Shipment)=>formatCaseDisplayName({cargo_count:s.cargo_count,cargo_count_unit:s.cargo_count_unit,client_name:s.client_name||clientMap.get(s.client_id||''),vessel_name:s.vessel_name||vesselMap.get(s.vessel_id||'')});
 return <main dir="rtl" className="min-h-screen p-4 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-7xl mx-auto space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs app-muted">پرونده‌های واقعی محموله</div><h1 className="text-2xl font-black mt-1">پرونده</h1><p className="text-sm app-muted mt-1">منبع انتخاب و نام‌گذاری محموله با Hook مشترک پرونده‌ها هماهنگ است.</p></div><Link to="/operations" className="rounded-xl border app-border bg-[var(--surface)] px-4 py-2 text-sm font-bold"><ArrowLeft className="inline ml-1" size={15}/>عملیات</Link></header>
  {(selectorError||error)&&<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{selectorError||error}</div>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 grid md:grid-cols-[1fr_1fr] gap-3"><label className="text-sm font-bold">صاحب کالا<select value={clientId} onChange={e=>setClientId(e.target.value)} className="mt-2 w-full rounded-xl border app-border bg-transparent px-3 py-2"><option value="">همه صاحبان کالا</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm font-bold">جستجو<div className="mt-2 relative"><Search size={16} className="absolute right-3 top-3 app-muted"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="نام محموله، بارنامه، کوتاژ، صاحب کالا یا کشتی..." className="w-full rounded-xl border app-border bg-transparent py-2 pr-9 pl-3"/></div></label></section>
  {loading?<div className="py-12 text-center app-muted"><Loader2 className="animate-spin mx-auto"/></div>:<section className="space-y-3">{visible.map(s=>{const d=declMap.get(s.id)||null;const name=display(s);return <div key={s.id} className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-black">{name}</div><div className="text-xs app-muted mt-1">صاحب کالا: {clientMap.get(s.client_id||'')||'—'} · کشتی: {vesselMap.get(s.vessel_id||'')||'—'}</div></div><span className="text-xs rounded-full border app-border px-3 py-1 font-bold">مرحله {stage(s,d,!!d&&customsComplete[d.id])} از ۵</span></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs"><div className="rounded-xl border app-border px-3 py-2">بارنامه: <b>{s.bill_of_lading_no||'—'}</b></div><div className="rounded-xl border app-border px-3 py-2">کوتاژ: <b>{d?.kottaj_number||'—'}</b></div><div className="rounded-xl border app-border px-3 py-2">مسیر گمرکی: <b>{d?.customs_path||'—'}</b></div><div className="rounded-xl border app-border px-3 py-2">وضعیت اظهار: <b>{d?'ثبت شده':'ثبت نشده'}</b></div><div className="rounded-xl border app-border px-3 py-2">مقدار: <b>{fa(s.cargo_count)} {s.cargo_count_unit||''}</b></div><div className="rounded-xl border app-border px-3 py-2">وزن خالص: <b>{fa(s.net_weight_kg)} کیلوگرم</b></div><div className="rounded-xl border app-border px-3 py-2">وزن ناخالص: <b>{fa(s.gross_weight_kg)} کیلوگرم</b></div><div className="rounded-xl border app-border px-3 py-2">اسناد پایه: <b>{s.transport_documents_status==='ready'?'آماده':'در انتظار'}</b></div><div className="rounded-xl border app-border px-3 py-2">وضعیت مالی: <b>{s.finance_status==='closed'?'بسته و بایگانی':s.finance_status==='ready'?'آماده مالی':'در انتظار مالی'}</b></div></div><div className="mt-3 flex flex-wrap gap-2"><Link to={d?'/operations?tab=declaration&shipmentId='+encodeURIComponent(s.id):'/operations'} className="inline-flex items-center gap-1 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white"><FileText size={14}/> مشاهده عملیات</Link><Link to={'/operations?shipmentId='+encodeURIComponent(s.id)} className="inline-flex items-center gap-1 rounded-xl border app-border px-3 py-2 text-xs font-bold"><Ship size={14}/> مشاهده محموله</Link></div></div>})}{visible.length===0&&<div className="rounded-2xl border app-border bg-[var(--surface)] p-8 text-center app-muted">محموله‌ای برای انتخاب فعلی پیدا نشد.</div>}</section>}
 </div></main>;
};
