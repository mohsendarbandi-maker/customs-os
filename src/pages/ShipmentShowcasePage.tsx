import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowLeft, Bell, CheckCircle2, Clock3, FileText, RefreshCw, Search, Ship, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Shipment = { id:string; display_name:string|null; bill_of_lading_no:string|null; shipping_line:string|null; current_status:string|null; current_location:string|null; eta_destination:string|null; cargo_count:number|null; cargo_count_unit:string|null; gross_weight_kg:number|null; created_at:string; };
type Reminder = { id:string; shipment_id:string|null; title:string; description:string|null; due_at:string|null; priority:string; status:string; };
type Report = { id:string; shipment_id:string; status:string; stage:string; report:string; actor_name:string; created_at:string; };
const faDate=(v:string|null)=>v?new Date(v).toLocaleDateString('fa-IR'):'—';
const statusText=(s:string|null)=>{const v=(s||'').toLowerCase();if(/complete|done|released|ترخیص|انجام/.test(v))return 'تکمیل شده';if(/block|hold|وقف|مانع|مشکل/.test(v))return 'دارای مانع';if(/action|required|نیاز/.test(v))return 'نیازمند اقدام';if(/arriv|رسید|تخلیه/.test(v))return 'رسیده / تخلیه';if(/load|depart|حمل|بارگیری/.test(v))return 'در حال حمل';return s||'در جریان';};
const statusTone=(s:string)=>s==='تکمیل شده'?'done':s==='دارای مانع'||s==='نیازمند اقدام'?'alert':'active';
export const ShipmentShowcasePage:React.FC=()=>{
 const {profile}=useAuth(); const org=profile?.organization_id||'';
 const [shipments,setShipments]=useState<Shipment[]>([]); const [reminders,setReminders]=useState<Reminder[]>([]); const [reports,setReports]=useState<Report[]>([]);
 const [query,setQuery]=useState(''); const [filter,setFilter]=useState('all'); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 const load=async()=>{if(!org)return;setLoading(true);setError('');try{
  const [sh,rm]=await Promise.all([
   supabase.from('shipments').select('id,display_name,bill_of_lading_no,shipping_line,current_status,current_location,eta_destination,cargo_count,cargo_count_unit,gross_weight_kg,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),
   supabase.from('operational_reminders').select('id,shipment_id,title,description,due_at,priority,status').eq('organization_id',org).is('deleted_at',null).order('due_at',{ascending:true}).limit(1000)
  ]);
  if(sh.error)throw sh.error;if(rm.error)throw rm.error;const shipmentRows=(sh.data||[]) as Shipment[];setShipments(shipmentRows);setReminders((rm.data||[]) as Reminder[]);
  const ids=shipmentRows.map(x=>x.id);if(ids.length){const rr=await (supabase as any).from('file_manager_shipment_reports').select('id,shipment_id,status,stage,report,actor_name,created_at').eq('organization_id',org).in('shipment_id',ids).order('created_at',{ascending:false}).limit(1500);if(rr.error)throw rr.error;setReports((rr.data||[]) as Report[]);}else setReports([]);
 }catch(e){setError(e instanceof Error?e.message:'بارگذاری ویترین محموله ناموفق بود.');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[org]);
 const latest=useMemo(()=>{const m=new Map<string,Report>();for(const r of reports)if(!m.has(r.shipment_id))m.set(r.shipment_id,r);return m;},[reports]);
 const today=new Date();const todayKey=today.toDateString();
 const visible=useMemo(()=>shipments.filter(s=>{const q=query.trim().toLocaleLowerCase();const text=[s.display_name,s.bill_of_lading_no,s.shipping_line,s.current_status,s.current_location].filter(Boolean).join(' ').toLocaleLowerCase();if(q&&!text.includes(q))return false;const rep=latest.get(s.id);const label=rep?statusText(rep.status):statusText(s.current_status);if(filter==='attention')return label==='دارای مانع'||label==='نیازمند اقدام';if(filter==='done')return label==='تکمیل شده';if(filter==='active')return label!=='تکمیل شده'&&label!=='دارای مانع';return true;}),[shipments,query,filter,latest]);
 const todayReminders=reminders.filter(r=>r.due_at&&new Date(r.due_at).toDateString()===todayKey);
 const overdue=reminders.filter(r=>r.due_at&&new Date(r.due_at).getTime()<Date.now()&&!/done|completed|انجام/.test(r.status||''));
 return <main className="shipment-showcase-page" dir="rtl">
  <header className="showcase-hero"><div><span className="showcase-kicker">DAR BANDI · LIVE OPERATIONS</span><h1>ویترین محموله</h1><p>نمای زندهٔ وضعیت پرونده‌ها، فعالیت‌های روزانه و اقدام‌های پیشِ رو برای کل تیم</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> تازه‌سازی</button></header>
  <section className="showcase-kpis"><article><span>کل محموله‌ها</span><strong>{shipments.length.toLocaleString('fa-IR')}</strong><small>پرونده‌های ثبت‌شده</small></article><article><span>یادآورهای امروز</span><strong>{todayReminders.length.toLocaleString('fa-IR')}</strong><small>فعالیت‌های موعددار امروز</small></article><article><span>موارد عقب‌افتاده</span><strong>{overdue.length.toLocaleString('fa-IR')}</strong><small>نیازمند پیگیری</small></article><article><span>گزارش‌های ثبت‌شده</span><strong>{reports.length.toLocaleString('fa-IR')}</strong><small>تاریخچه مشترک تیم</small></article></section>
  <section className="showcase-toolbar"><div><span className="showcase-kicker">SHIPMENT BOARD</span><h2>تابلوی وضعیت محموله‌ها</h2><p>کارت‌ها وضعیت فعلی و آخرین اقدام ثبت‌شده را نشان می‌دهند.</p></div><div className="showcase-controls"><label><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجوی محموله، بارنامه، کشتی…"/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option><option value="active">در جریان</option><option value="attention">نیازمند پیگیری</option><option value="done">تکمیل‌شده</option></select></div></section>
  {error&&<div className="showcase-error"><AlertCircle size={17}/>{error}</div>}
  {loading?<div className="showcase-empty">در حال بارگذاری محموله‌ها…</div>:<section className="showcase-grid">{visible.map(s=>{const r=latest.get(s.id);const status=r?statusText(r.status):statusText(s.current_status);const tone=statusTone(status);const tasks=reminders.filter(x=>x.shipment_id===s.id&&!/done|completed|انجام/.test(x.status||'')).slice(0,2);return <article className={'showcase-card '+tone} key={s.id}>
   <div className="showcase-card-head"><span className="showcase-ship-icon"><Ship size={20}/></span><span className={'showcase-status '+tone}>{status}</span></div>
   <h3>{s.display_name||'محموله بدون عنوان'}</h3><div className="showcase-identifiers"><span>بارنامه: {s.bill_of_lading_no||'—'}</span><span>{s.shipping_line||'خط کشتیرانی نامشخص'}</span></div>
   <div className="showcase-facts"><div><small>مقدار</small><b>{s.cargo_count!=null?Number(s.cargo_count).toLocaleString('fa-IR')+' '+(s.cargo_count_unit||''):'—'}</b></div><div><small>وزن ناخالص</small><b>{s.gross_weight_kg!=null?Number(s.gross_weight_kg).toLocaleString('fa-IR')+' kg':'—'}</b></div><div><small>موقعیت</small><b>{s.current_location||'—'}</b></div><div><small>ETA</small><b>{faDate(s.eta_destination)}</b></div></div>
   <div className="showcase-activity"><div className="showcase-activity-title"><Activity size={14}/> آخرین فعالیت</div><p>{r?.report||'هنوز گزارشی برای این محموله ثبت نشده است.'}</p>{r&&<small>{r.actor_name} · {faDate(r.created_at)}{r.stage?' · '+r.stage:''}</small>}</div>
   <div className="showcase-reminders"><div className="showcase-activity-title"><Bell size={14}/> فعالیت‌های روزانه / یادآورها</div>{tasks.length?tasks.map(t=><div className="showcase-task" key={t.id}><Clock3 size={13}/><span>{t.title}</span><small>{faDate(t.due_at)}</small></div>):<p className="showcase-no-task">یادآور فعالی برای این محموله نیست.</p>}</div>
   <footer><Link to={'/file-manager?shipmentId='+encodeURIComponent(s.id)}><FileText size={14}/> پرونده</Link><Link to={'/shipment-reports?shipmentId='+encodeURIComponent(s.id)}><Activity size={14}/> گزارش‌ها</Link><Link to={'/reminders?shipmentId='+encodeURIComponent(s.id)}><Bell size={14}/> یادآورها</Link></footer>
  </article>;})}{!visible.length&&<div className="showcase-empty">محموله‌ای با این فیلتر پیدا نشد.</div>}</section>}
  <div className="showcase-footer-note"><Truck size={15}/> ویترین محموله، گزارش‌ها و یادآورها را از بخش‌های مستقل می‌خواند؛ مدیریت فایل فقط برای آرشیو اسناد است.</div>
 </main>;
};
export default ShipmentShowcasePage;
