import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,ChevronDown,Info,RefreshCw,ShieldAlert} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {buildCaseAlerts,CaseAlert,AlertCase,AlertDoc,AlertDeclaration,AlertPermit} from '../lib/caseAlerts';

type Props={refreshKey?:string};

export const OperationalAlertsDropdown:React.FC<Props>=({refreshKey=''})=>{
 const [alerts,setAlerts]=useState<CaseAlert[]>([]);
 const [open,setOpen]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState(false);
 const root=useRef<HTMLDivElement>(null);

 const load=useCallback(async()=>{
  setLoading(true);setError(false);
  try{
   const {data:cases,error:caseError}=await supabase.from('cases').select('id,case_number,status,valuation_status,release_status');
   if(caseError)throw caseError;
   const ids=(cases||[]).map(c=>c.id);
   if(!ids.length){setAlerts([]);return;}
   const results=await Promise.all([
    supabase.from('customs_documents').select('case_id,document_type,status').in('case_id',ids),
    supabase.from('customs_declarations').select('case_id,kottaj_number,customs_path,created_at').in('case_id',ids).order('created_at',{ascending:false}),
    supabase.from('permits').select('case_id,status').in('case_id',ids)
   ]);
   const failed=results.find(r=>r.error);
   if(failed?.error)throw failed.error;
   setAlerts(buildCaseAlerts(
    (cases||[]) as AlertCase[],
    (results[0].data||[]) as AlertDoc[],
    (results[1].data||[]) as AlertDeclaration[],
    (results[2].data||[]) as AlertPermit[]
   ));
  }catch{
   setError(true);
  }finally{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{void load();},[load,refreshKey]);
 useEffect(()=>{
  if(!open)return;
  const onPointerDown=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false);};
  const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',onPointerDown);
  document.addEventListener('keydown',onKeyDown);
  return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown);};
 },[open]);

 const visible=useMemo(()=>alerts.slice(0,8),[alerts]);
 const urgent=alerts.some(a=>a.level==='urgent');
 const hasWarnings=alerts.length>0;
 const arrowTone=urgent?'text-red-500':hasWarnings?'text-amber-500':'app-muted';

 const iconFor=(level:CaseAlert['level'])=>level==='urgent'
  ?<ShieldAlert size={16} className="text-red-500 shrink-0"/>
  :level==='warning'
   ?<AlertTriangle size={16} className="text-amber-500 shrink-0"/>
   :<Info size={16} className="text-[var(--primary)] shrink-0"/>;

 return <div ref={root} className="relative">
  <button
   type="button"
   className="icon-btn inline-flex items-center justify-center gap-1.5"
   aria-label={hasWarnings?'هشدارهای عملیاتی، '+alerts.length+' مورد':'هشدارهای عملیاتی'}
   aria-haspopup="menu"
   aria-expanded={open}
   title="هشدارهای عملیاتی"
   onClick={()=>setOpen(v=>!v)}
  >
   <AlertTriangle size={17} className={urgent?'text-red-500':hasWarnings?'text-amber-500':'app-muted'}/>
   {hasWarnings&&<span className="text-[11px] font-black tabular-nums">{alerts.length>99?'۹۹+':new Intl.NumberFormat('fa-IR').format(alerts.length)}</span>}
   <ChevronDown size={15} className={'transition-colors duration-150 '+arrowTone}/>
  </button>
  {open&&<div role="menu" aria-label="هشدارهای عملیاتی" className="absolute left-0 top-[calc(100%+8px)] z-[600] w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border app-border bg-[var(--surface)] shadow-2xl" dir="rtl">
   <div className="flex items-center justify-between gap-3 border-b app-border px-4 py-3">
    <div><b className="block text-sm">هشدارهای عملیاتی</b><span className="block mt-1 text-[10px] app-muted">{new Intl.NumberFormat('fa-IR').format(alerts.length)} مورد نیازمند بررسی</span></div>
    <button type="button" className="icon-btn !w-8 !h-8" aria-label="بروزرسانی هشدارها" title="بروزرسانی" onClick={()=>void load()} disabled={loading}><RefreshCw size={15} className={loading?'animate-spin':''}/></button>
   </div>
   <div className="max-h-[min(65vh,24rem)] overflow-y-auto p-2">
    {loading&&alerts.length===0?<div className="p-7 text-center text-xs app-muted">در حال بررسی هشدارها…</div>
    :error&&alerts.length===0?<div className="p-5 text-center text-xs app-muted">دریافت هشدارها انجام نشد. دوباره تلاش کنید.</div>
    :visible.length===0?<div className="p-7 text-center text-xs app-muted">هشدار عملیاتی فعالی وجود ندارد.</div>
    :visible.map(a=><Link key={a.id} role="menuitem" to={a.href} onClick={()=>setOpen(false)} className="flex items-start gap-2.5 rounded-xl p-3 hover:bg-[var(--surface-2)] transition-colors">
      <span className="mt-0.5">{iconFor(a.level)}</span>
      <span className="min-w-0 flex-1"><b className="block text-xs leading-5">{a.title}</b><span className="mt-1 block text-[11px] app-muted leading-5">{a.detail}</span><span className="mt-1 block text-[10px] app-muted">پرونده {a.caseNumber}</span></span>
     </Link>)}
   </div>
   {alerts.length>visible.length&&<Link to="/alerts" onClick={()=>setOpen(false)} className="block border-t app-border px-4 py-3 text-center text-xs font-bold text-[var(--primary)]">مشاهده همه هشدارها</Link>}
  </div>}
 </div>;
};
