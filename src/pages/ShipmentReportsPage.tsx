import React,{useEffect,useMemo,useState} from 'react';
import {Activity,AlertCircle,ClipboardList,Filter,Plus,RefreshCw,Search,X} from 'lucide-react';
import {useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {useAuth} from '../context/AuthContext';

type Shipment={id:string;display_name:string|null;bill_of_lading_no:string|null;shipping_line:string|null;current_status:string|null;};
type Report={id:string;shipment_id:string;status:'received'|'in_review'|'action_required'|'completed'|'blocked'|'archived';stage:string;report:string;actor_name:string;created_at:string;};
const labels:Record<string,string>={received:'دریافت شده',in_review:'در حال بررسی',action_required:'نیازمند اقدام',completed:'انجام شده',blocked:'متوقف / دارای مانع',archived:'مختومه'};
export const ShipmentReportsPage:React.FC=()=>{
 const {profile}=useAuth();const org=profile?.organization_id||'';const [params,setParams]=useSearchParams();
 const [shipments,setShipments]=useState<Shipment[]>([]);const [reports,setReports]=useState<Report[]>([]);const [selected,setSelected]=useState(params.get('shipmentId')||'all');const [statusFilter,setStatusFilter]=useState('all');const [query,setQuery]=useState('');
 const [status,setStatus]=useState<Report['status']>('in_review');const [stage,setStage]=useState('');const [draft,setDraft]=useState('');const [saving,setSaving]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const load=async()=>{if(!org)return;setLoading(true);setError('');try{const [s,r]=await Promise.all([supabase.from('shipments').select('id,display_name,bill_of_lading_no,shipping_line,current_status').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),(supabase as any).from('file_manager_shipment_reports').select('id,shipment_id,status,stage,report,actor_name,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(2000)]);if(s.error)throw s.error;if(r.error)throw r.error;setShipments((s.data||[]) as Shipment[]);setReports((r.data||[]) as Report[]);}catch(e){setError(e instanceof Error?e.message:'دریافت گزارش‌ها ناموفق بود.');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[org]);
 const selectedShipment=shipments.find(s=>s.id===selected)||null;
 const filtered=useMemo(()=>reports.filter(r=>{if(selected!=='all'&&r.shipment_id!==selected)return false;if(statusFilter!=='all'&&r.status!==statusFilter)return false;const sh=shipments.find(s=>s.id===r.shipment_id);const q=query.toLocaleLowerCase().trim();return !q||[sh?.display_name,sh?.bill_of_lading_no,sh?.shipping_line,r.report,r.stage,r.actor_name].filter(Boolean).join(' ').toLocaleLowerCase().includes(q);}),[reports,selected,statusFilter,query,shipments]);
 const save=async()=>{if(!selectedShipment||!draft.trim()||saving)return;setSaving(true);setError('');setMessage('');try{const {error:e}=await (supabase as any).from('file_manager_shipment_reports').insert({organization_id:org,shipment_id:selectedShipment.id,status,stage:stage.trim(),report:draft.trim()});if(e)throw e;setDraft('');setMessage('گزارش محموله ثبت شد و برای همکاران قابل مشاهده است.');await load();}catch(e){setError(e instanceof Error?e.message:'ثبت گزارش ناموفق بود.');}finally{setSaving(false);}};
 return <main className="shipment-reports-page" dir="rtl">
  <header className="reports-hero"><div><span className="showcase-kicker">TEAM REPORTING · SHIPMENT HISTORY</span><h1>گزارش‌های محموله</h1><p>ثبت و مشاهدهٔ گزارش‌های مشترک تیم؛ هر گزارش به یک محموله متصل است، نه به فایل یا سند.</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> تازه‌سازی</button></header>
  <section className="reports-layout">
   <aside className="reports-compose"><div className="reports-panel-title"><span><Plus size={17}/></span><div><b>ثبت گزارش جدید</b><small>برای یک محموله مشخص</small></div></div>
    <label>انتخاب محموله<select value={selected==='all'?'':selected} onChange={e=>{const v=e.target.value||'all';setSelected(v);const next=new URLSearchParams(params);if(v==='all')next.delete('shipmentId');else next.set('shipmentId',v);setParams(next);}}><option value="">انتخاب کنید…</option>{shipments.map(s=><option key={s.id} value={s.id}>{s.display_name||s.bill_of_lading_no||s.id}</option>)}</select></label>
    {selectedShipment&&<div className="reports-selected-shipment"><b>{selectedShipment.display_name||'محموله'}</b><small>{selectedShipment.bill_of_lading_no||'شماره بارنامه ثبت نشده'} · {selectedShipment.shipping_line||'—'}</small></div>}
    <label>وضعیت<select value={status} onChange={e=>setStatus(e.target.value as Report['status'])}>{Object.entries(labels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
    <label>مرحله فعلی<input value={stage} onChange={e=>setStage(e.target.value)} placeholder="مثلاً تخلیه، ترخیص، اخذ مجوز…"/></label>
    <label>شرح گزارش و اقدام بعدی<textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={6} maxLength={4000} placeholder="اقدام انجام‌شده، نقص یا مانع، مسئول پیگیری و اقدام بعدی…"/></label>
    <button className="reports-submit" onClick={()=>void save()} disabled={saving||!selectedShipment||!draft.trim()}>{saving?'در حال ثبت…':'ثبت گزارش محموله'}</button>
    {message&&<p className="reports-success">{message}</p>}{error&&<p className="reports-error">{error}</p>}
   </aside>
   <section className="reports-history"><div className="reports-history-head"><div><span className="showcase-kicker">AUDITABLE ACTIVITY</span><h2>تاریخچه گزارش‌ها</h2><p>{filtered.length.toLocaleString('fa-IR')} گزارش</p></div><div className="reports-filters"><label><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجو در گزارش‌ها…"/></label><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option>{Object.entries(labels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></div></div>
    {error&&!message&&<div className="reports-error"><AlertCircle size={16}/>{error}</div>}
    {loading?<div className="showcase-empty">در حال دریافت گزارش‌ها…</div>:filtered.length===0?<div className="showcase-empty">گزارشی برای نمایش وجود ندارد.</div>:<div className="reports-list">{filtered.map(r=>{const sh=shipments.find(s=>s.id===r.shipment_id);return <article key={r.id}><div className="reports-item-top"><div><span className="reports-status">{labels[r.status]||r.status}</span><b>{sh?.display_name||'محموله حذف‌شده/نامشخص'}</b></div><time>{new Date(r.created_at).toLocaleString('fa-IR')}</time></div><div className="reports-item-meta">{sh?.bill_of_lading_no||'بدون بارنامه'} · {r.stage||'بدون مرحله'} · ثبت‌کننده: {r.actor_name}</div><p>{r.report}</p></article>;})}</div>}
   </section>
  </section>
 </main>;
};
export default ShipmentReportsPage;
