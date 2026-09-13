import React,{useEffect,useState} from 'react';
import {ArrowRight,History,RefreshCw,ShieldCheck} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';

const statusLabels:Record<string,string>={draft:'پیش‌نویس',registration_order:'ثبت سفارش',documents_ready:'اسناد آماده',epl_submitted:'اظهار ثبت شد',kottaj_received:'کوتاژ دریافت شد',path_green:'مسیر سبز',path_yellow:'مسیر زرد',path_red:'مسیر قرمز',valuation:'ارزش‌گذاری',duties_calculation:'محاسبه حقوق',exit_permit:'مجوز خروج',completed:'تکمیل‌شده',archived:'بایگانی'};
const actionLabels:Record<string,string>={INSERT:'ایجاد',UPDATE:'ویرایش',DELETE:'حذف'};

const fmtDate=(v?:string)=>v?new Intl.DateTimeFormat('fa-IR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
const pretty=(v:any)=>{if(v===null||v===undefined||v==='')return '—';if(typeof v==='object')return JSON.stringify(v,null,2);return String(v)};

export const CaseHistoryPage:React.FC=()=>{
 const [params]=useSearchParams();
 const caseId=params.get('caseId')||'';
 const [caseRow,setCaseRow]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[audit,setAudit]=useState<any[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const load=async()=>{if(!caseId){setError('شناسه پرونده در لینک وجود ندارد.');return}setLoading(true);setError('');try{const [cr,hr,ar]=await Promise.all([
  supabase.from('cases').select('id,case_number,status,client_id,created_at').eq('id',caseId).maybeSingle(),
  supabase.from('case_status_history').select('id,case_id,changed_by,previous_status,new_status,notes,created_at').eq('case_id',caseId).order('created_at',{ascending:false}),
  supabase.from('audit_logs').select('id,user_id,action,table_name,record_id,old_data,new_data,created_at').eq('record_id',caseId).order('created_at',{ascending:false})
 ]);if(cr.error)throw cr.error;if(hr.error)throw hr.error;if(ar.error)throw ar.error;setCaseRow(cr.data);setHistory(hr.data||[]);setAudit(ar.data||[])}catch(e:any){setError(e?.message||'خطا در خواندن تاریخچه')}finally{setLoading(false)}};
 useEffect(()=>{load()},[caseId]);
 return <main className="min-h-screen bg-slate-950 text-slate-100 p-5 md:p-8" dir="rtl"><div className="max-w-6xl mx-auto">
  <header className="flex flex-wrap items-center justify-between gap-4 mb-6"><div><div className="flex items-center gap-3"><History className="text-cyan-400" size={28}/><h1 className="text-2xl font-black">تاریخچه پرونده</h1></div><p className="text-sm text-slate-400 mt-2">تاریخچه وضعیت و لاگ تغییرات این پرونده؛ این صفحه کاملاً فقط‌خواندنی است.</p></div><div className="flex gap-2"><button onClick={load} className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900"><RefreshCw className={loading?'animate-spin inline ml-2':'inline ml-2'} size={16}/> بروزرسانی</button><Link to={caseId?`/operations?caseId=${encodeURIComponent(caseId)}`:'/operations'} className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900"><ArrowRight className="inline ml-2" size={16}/> پرونده</Link></div></header>
  {error&&<div className="mb-5 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>}
  {caseRow&&<section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5"><div className="grid md:grid-cols-4 gap-4"><div><div className="text-xs text-slate-500">شماره پرونده</div><div className="font-bold mt-1">{caseRow.case_number||'—'}</div></div><div><div className="text-xs text-slate-500">شناسه</div><div className="font-mono text-xs mt-1 break-all">{caseRow.id}</div></div><div><div className="text-xs text-slate-500">وضعیت فعلی</div><div className="font-bold mt-1">{statusLabels[caseRow.status]||caseRow.status||'—'}</div></div><div><div className="text-xs text-slate-500">ایجاد</div><div className="mt-1">{fmtDate(caseRow.created_at)}</div></div></div></section>}
  <div className="grid lg:grid-cols-2 gap-5">
   <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center gap-2 mb-4"><ShieldCheck className="text-cyan-400" size={20}/><h2 className="font-black">تاریخچه وضعیت</h2></div><div className="space-y-3">{history.map((x,i)=><div key={x.id} className="relative border border-slate-800 rounded-xl p-4 bg-slate-950"><div className="flex justify-between gap-3"><b>{statusLabels[x.new_status]||x.new_status}</b><span className="text-xs text-slate-500">{fmtDate(x.created_at)}</span></div><div className="text-xs text-slate-400 mt-2">{x.previous_status?`از ${statusLabels[x.previous_status]||x.previous_status}`:'شروع'} → {statusLabels[x.new_status]||x.new_status}</div>{x.notes&&<div className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{x.notes}</div>}</div>)}{history.length===0&&<p className="text-sm text-slate-500">هنوز سابقه وضعیت ثبت نشده است.</p>}</div></section>
   <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center gap-2 mb-4"><History className="text-cyan-400" size={20}/><h2 className="font-black">Audit Log</h2></div><div className="space-y-3">{audit.map(x=><details key={x.id} className="border border-slate-800 rounded-xl bg-slate-950"><summary className="cursor-pointer list-none p-4"><div className="flex justify-between gap-3"><b>{actionLabels[x.action]||x.action} · {x.table_name}</b><span className="text-xs text-slate-500">{fmtDate(x.created_at)}</span></div></summary><div className="px-4 pb-4 space-y-3"><div><div className="text-xs text-slate-500 mb-1">Record ID</div><div className="font-mono text-xs break-all">{x.record_id||'—'}</div></div><div><div className="text-xs text-slate-500 mb-1">قبل</div><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64 bg-slate-900 rounded-lg p-3">{pretty(x.old_data)}</pre></div><div><div className="text-xs text-slate-500 mb-1">بعد</div><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64 bg-slate-900 rounded-lg p-3">{pretty(x.new_data)}</pre></div></div></details>)}{audit.length===0&&<p className="text-sm text-slate-500">برای این پرونده Audit Log مستقیمی ثبت نشده است.</p>}</div></section>
  </div>
 </div></main>;
};
