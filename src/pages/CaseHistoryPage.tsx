import React,{useEffect,useState} from 'react';
import {ArrowRight,History,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {Link,useSearchParams,useNavigate} from 'react-router-dom';
import {supabase} from '../lib/supabase';

const statusLabels:Record<string,string>={draft:'پیش‌نویس',registration_order:'ثبت سفارش',documents_ready:'اسناد آماده',epl_submitted:'اظهار ثبت شد',kottaj_received:'کوتاژ دریافت شد',path_green:'مسیر سبز',path_yellow:'مسیر زرد',path_red:'مسیر قرمز',valuation:'ارزش‌گذاری',duties_calculation:'محاسبه حقوق',exit_permit:'مجوز خروج',completed:'تکمیل‌شده',archived:'بایگانی',stage_5_checklist:'چک‌لیست مرحله ۵'};
const actionLabels:Record<string,string>={INSERT:'ایجاد',UPDATE:'ویرایش',DELETE:'حذف'};
const fmtDate=(v?:string)=>v?new Intl.DateTimeFormat('fa-IR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
const pretty=(v:any)=>{if(v===null||v===undefined||v==='')return '—';if(typeof v==='object')return JSON.stringify(v,null,2);return String(v)};

type CaseOption={id:string;case_number:string|null;status:string;created_at:string};

export const CaseHistoryPage:React.FC=()=>{
 const[params]=useSearchParams();const navigate=useNavigate();const requested=params.get('caseId')||'';
 const[cases,setCases]=useState<CaseOption[]>([]);const[caseId,setCaseId]=useState(requested);
 const[caseRow,setCaseRow]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[audit,setAudit]=useState<any[]>([]);
 const[loading,setLoading]=useState(false),[error,setError]=useState('');

 const loadCases=async()=>{
  const{data,error}=await supabase.from('cases').select('id,case_number,status,created_at').order('created_at',{ascending:false});
  if(error)throw error;
  const rows=(data||[]) as CaseOption[];setCases(rows);
  const next=requested&&rows.some(x=>x.id===requested)?requested:(caseId&&rows.some(x=>x.id===caseId)?caseId:(rows[0]?.id||''));
  if(next!==caseId)setCaseId(next);
  return next;
 };
 const load=async(id?:string)=>{
  setLoading(true);setError('');
  try{
   const id2=id||caseId||await loadCases();
   if(!id2){setCaseRow(null);setHistory([]);setAudit([]);setError('هیچ پرونده‌ای برای نمایش وجود ندارد.');return}
   const{data:cr,error:ce}=await supabase.from('cases').select('id,case_number,status,client_id,created_at').eq('id',id2).maybeSingle();
   if(ce)throw ce;if(!cr){setError('پرونده انتخاب‌شده پیدا نشد.');return}
   const{data:hr,error:he}=await supabase.from('case_status_history').select('id,case_id,changed_by,previous_status,new_status,notes,created_at').eq('case_id',id2).order('created_at',{ascending:false});
   if(he)throw he;
   const{data:ar,error:ae}=await supabase.from('audit_logs').select('id,user_id,action,table_name,record_id,old_data,new_data,created_at').eq('record_id',id2).order('created_at',{ascending:false});
   if(ae)throw ae;
   setCaseRow(cr);setHistory(hr||[]);setAudit(ar||[]);
  }catch(e:any){setError(e?.message||'خطا در خواندن تاریخچه')}finally{setLoading(false)}
 };
 useEffect(()=>{void load(requested||undefined)},[]);
 useEffect(()=>{if(caseId&&!loading)void load(caseId)},[caseId]);

 const selectCase=(id:string)=>{setCaseId(id);navigate('/history?caseId='+encodeURIComponent(id),{replace:true})};

 return <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-6" dir="rtl"><div className="max-w-6xl mx-auto">
  <header className="flex flex-wrap items-center justify-between gap-3 mb-5"><div><div className="flex items-center gap-2"><History className="text-cyan-400" size={22}/><h1 className="text-2xl font-black">تاریخچه پرونده</h1></div><p className="text-xs app-muted mt-1">تاریخچه وضعیت و Audit واقعی پرونده</p></div><div className="flex gap-1"><button onClick={()=>void load(caseId)} disabled={loading} className="icon-btn" title="بازخوانی"><RefreshCw className={loading?'animate-spin':''} size={17}/></button><Link to={caseId?'/operations?caseId='+encodeURIComponent(caseId):'/operations'} className="icon-btn" title="پرونده"><ArrowRight size={18}/></Link><Link to="/" className="icon-btn" title="بستن"><X size={18}/></Link></div></header>

  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 mb-5"><div className="text-xs app-muted mb-2">انتخاب پرونده</div><select value={caseId} onChange={e=>selectCase(e.target.value)} disabled={!cases.length||loading} className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"><option value="">— انتخاب پرونده —</option>{cases.map(c=><option key={c.id} value={c.id}>{c.case_number||'بدون شماره'} · {statusLabels[c.status]||c.status}</option>)}</select></section>

  {error&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
  {caseRow&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4 mb-5"><div className="grid md:grid-cols-4 gap-4"><div><div className="text-xs app-muted">شماره پرونده</div><div className="font-bold mt-1">{caseRow.case_number||'—'}</div></div><div><div className="text-xs app-muted">شناسه</div><div className="font-mono text-[11px] mt-1 break-all" dir="ltr">{caseRow.id}</div></div><div><div className="text-xs app-muted">وضعیت فعلی</div><div className="font-bold mt-1">{statusLabels[caseRow.status]||caseRow.status||'—'}</div></div><div><div className="text-xs app-muted">ایجاد</div><div className="mt-1">{fmtDate(caseRow.created_at)}</div></div></div></section>}

  <div className="grid lg:grid-cols-2 gap-5">
   <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-4"><ShieldCheck className="text-cyan-400" size={20}/><h2 className="font-black">تاریخچه وضعیت</h2></div><div className="space-y-3">{history.map(x=><div key={x.id} className="relative border app-border rounded-xl p-4 bg-[var(--surface-2)]"><div className="flex justify-between gap-3"><b>{statusLabels[x.new_status]||x.new_status}</b><span className="text-xs app-muted">{fmtDate(x.created_at)}</span></div><div className="text-xs app-muted mt-2">{x.previous_status?`از ${statusLabels[x.previous_status]||x.previous_status}`:'شروع'} → {statusLabels[x.new_status]||x.new_status}</div>{x.notes&&<div className="text-sm mt-2 whitespace-pre-wrap">{x.notes}</div>}</div>)}{!history.length&&<p className="text-sm app-muted">برای این پرونده سابقه تغییر وضعیت ثبت نشده است.</p>}</div></section>
   <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-4"><History className="text-cyan-400" size={20}/><h2 className="font-black">Audit Log</h2></div><div className="space-y-3">{audit.map(x=><details key={x.id} className="border app-border rounded-xl bg-[var(--surface-2)]"><summary className="cursor-pointer list-none p-4"><div className="flex justify-between gap-3"><b>{actionLabels[x.action]||x.action} · {x.table_name}</b><span className="text-xs app-muted">{fmtDate(x.created_at)}</span></div></summary><div className="px-4 pb-4 space-y-3"><div><div className="text-xs app-muted mb-1">Record ID</div><div className="font-mono text-xs break-all" dir="ltr">{x.record_id||'—'}</div></div><div><div className="text-xs app-muted mb-1">قبل</div><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64 bg-[var(--surface)] rounded-lg p-3">{pretty(x.old_data)}</pre></div><div><div className="text-xs app-muted mb-1">بعد</div><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64 bg-[var(--surface)] rounded-lg p-3">{pretty(x.new_data)}</pre></div></div></details>)}{!audit.length&&<p className="text-sm app-muted">برای این پرونده Audit Log مستقیمی ثبت نشده است.</p>}</div></section>
  </div>
 </div></main>;
};