import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,Info,RefreshCw,ShieldAlert} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {alertCounts,buildCaseAlerts,CaseAlert} from '../lib/caseAlerts';

export const CaseAlertPanel:React.FC=()=>{
 const[alerts,setAlerts]=useState<CaseAlert[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const load=async()=>{setLoading(true);setError('');try{const results=await Promise.all([
  supabase.from('cases').select('id,case_number,status,valuation_status,release_status'),
  supabase.from('customs_documents').select('case_id,document_type,status'),
  supabase.from('customs_declarations').select('case_id,kottaj_number,customs_path,created_at').order('created_at',{ascending:false}),
  supabase.from('permits').select('case_id,status')
 ]);const bad=results.find(r=>r.error);if(bad?.error)throw bad.error;const[{data:c},{data:d},{data:de},{data:p}]=results;setAlerts(buildCaseAlerts(c||[],d||[],de||[],p||[]));}catch(e:any){setError(e?.message||'خطا در دریافت هشدارهای پرونده')}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 const counts=useMemo(()=>alertCounts(alerts),[alerts]);
 const levelClass=(level:CaseAlert['level'])=>level==='urgent'?'border-red-500/30 bg-red-500/5':level==='warning'?'border-amber-500/30 bg-amber-500/5':'app-border bg-[var(--surface-2)]';
 const LevelIcon=({level}:{level:CaseAlert['level']})=>level==='urgent'?<ShieldAlert size={17} className="text-red-500"/>:level==='warning'?<AlertTriangle size={17} className="text-amber-500"/>:<Info size={17} className="text-[var(--primary)]"/>;
 return <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5 mb-5" dir="rtl">
  <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="font-black">هشدارهای عملیاتی پرونده‌ها</h2><p className="text-xs app-muted mt-1">هشدارها از وضعیت واقعی پرونده، اسناد، اظهار و مجوزها ساخته می‌شوند.</p></div><button onClick={load} disabled={loading} className="icon-btn" title="بروزرسانی"><RefreshCw size={16} className={loading?'animate-spin':''}/></button></div>
  <div className="grid grid-cols-3 gap-2 mb-3"><div className="rounded-xl bg-[var(--surface-2)] p-3 text-center"><div className="text-xs app-muted">کل</div><div className="text-xl font-black">{counts.total}</div></div><div className="rounded-xl bg-red-500/5 p-3 text-center"><div className="text-xs text-red-500">فوری</div><div className="text-xl font-black text-red-500">{counts.urgent}</div></div><div className="rounded-xl bg-amber-500/5 p-3 text-center"><div className="text-xs text-amber-500">هشدار</div><div className="text-xl font-black text-amber-500">{counts.warning}</div></div></div>
  {error?<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</div>:alerts.length===0?<div className="py-7 text-center app-muted text-sm">هشدار عملیاتی فعالی وجود ندارد.</div>:<div className="space-y-2 max-h-96 overflow-auto">{alerts.slice(0,12).map(a=><Link key={a.id} to={a.href} className={`block rounded-xl border p-3 hover:opacity-80 ${levelClass(a.level)}`}><div className="flex items-start gap-2"><LevelIcon level={a.level}/><div className="min-w-0"><div className="font-bold text-sm">{a.title}</div><div className="text-xs app-muted mt-1">{a.detail}</div><div className="text-[11px] app-muted mt-1">{a.caseNumber}</div></div></div></Link>)}</div>}
  {alerts.length>12&&<Link to="/alerts" className="block text-center text-sm font-bold text-[var(--primary)] mt-3">مشاهده همه هشدارها ({counts.total})</Link>}
 </section>;
};
