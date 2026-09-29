import React,{useMemo,useState}from'react';
import{Bot,Check,ChevronDown,Clock3,History,Loader2,Send,ShieldAlert,ShieldCheck,Trash2,X}from'lucide-react';
import{supabase}from'../lib/supabase';
import{makeClientId}from'../lib/clientId';

type Risk='safe'|'requires_confirmation'|'destructive';
type Plan={action_code:string;module:string;target?:Record<string,unknown>;params?:Record<string,unknown>;risk?:Risk;confidence?:number;clarification?:string|null;reason?:string};
type Message={role:'user'|'assistant';text:string;plan?:Plan;commandId?:string;status?:string;finalPhrase?:string;result?:unknown};

const riskMeta:Record<Risk,{label:string;icon:React.ElementType;className:string}>={
 safe:{label:'ایمن — فقط خواندنی',icon:ShieldCheck,className:'safe'},
 requires_confirmation:{label:'نیازمند تأیید',icon:ShieldCheck,className:'confirm'},
 destructive:{label:'عملیات مخرب — تأیید دو مرحله‌ای',icon:ShieldAlert,className:'danger'}
};

const faNumber=(n:number)=>new Intl.NumberFormat('fa-IR').format(n);
const compact=(v:unknown)=>typeof v==='string'?v:(v==null?'':JSON.stringify(v,null,2));
const planSummary=(p:Plan)=>{
 const t=Object.entries(p.target||{}).filter(([,v])=>v!==null&&v!==undefined&&String(v)!=='').map(([k,v])=>k+': '+String(v)).slice(0,4);
 return t.length?t.join(' · '):p.reason||'هدف در Action Plan مشخص شده است.';
};
const resultSummary=(v:any)=>{
 if(!v)return'عملیات انجام شد.';
 if(v.type==='read')return'اطلاعات با موفقیت خوانده شد.';
 if(v.id)return'رکورد '+v.id+' با موفقیت ثبت/ویرایش شد.';
 if(v.case_id)return'پرونده '+v.case_id+' با موفقیت پردازش شد.';
 if(v.shipment_id)return'محموله '+v.shipment_id+' با موفقیت پردازش شد.';
 if(Array.isArray(v))return faNumber(v.length)+' مورد دریافت شد.';
 return'عملیات با موفقیت انجام شد.';
};

export const AIOperatorPanel:React.FC<{pageContext?:string}>=({pageContext=''})=>{
 const[open,setOpen]=useState(false),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[messages,setMessages]=useState<Message[]>([]),[history,setHistory]=useState<any[]>([]),[showHistory,setShowHistory]=useState(false),[pending,setPending]=useState<{commandId:string;risk:Risk;phrase?:string}>(),[finalPhrase,setFinalPhrase]=useState(''),[error,setError]=useState('');

 const call=async(body:any)=>{
  const{data,error}=await supabase.functions.invoke('ai-operator',{body});
  if(error){
   let detail=error.message;
   try{const c=await (error as any).context?.json?.();detail=c?.error||detail}catch{}
   throw new Error(detail||'AI Operator پاسخ نداد.');
  }
  return data;
 };
 const send=async()=>{
  const q=input.trim();if(!q||busy)return;
  setInput('');setError('');setBusy(true);setMessages(m=>[...m,{role:'user',text:q}]);
  try{
   const data=await call({op:'plan',query:q,page_context:pageContext,session_id:makeClientId()});
   const p=data?.plan as Plan|undefined;
   if(data?.status==='awaiting_confirmation'){
    const risk=(data.risk_level||p?.risk||'requires_confirmation') as Risk;
    setPending({commandId:data.command_id,risk,phrase:data.final_confirmation_phrase});
    setMessages(m=>[...m,{role:'assistant',text:'این عملیات نیازمند تأیید شماست.',plan:p,commandId:data.command_id,status:data.status,finalPhrase:data.final_confirmation_phrase}]);
   }else if(data?.status==='clarification_needed'){
    setMessages(m=>[...m,{role:'assistant',text:p?.clarification||data?.clarification||'اطلاعات کافی نیست؛ لطفاً هدف را دقیق‌تر مشخص کنید.',plan:p,status:data.status}]);
   }else{
    setMessages(m=>[...m,{role:'assistant',text:resultSummary(data.result),plan:p,status:data.status,result:data.result}]);
   }
  }catch(e:any){const msg=e?.message||'اجرای دستور ناموفق بود.';setError(msg);setMessages(m=>[...m,{role:'assistant',text:msg,status:'failed'}])}
  finally{setBusy(false)}
 };
 const confirm=async()=>{
  if(!pending||busy)return;
  setBusy(true);setError('');
  try{
   const data=await call({op:'execute',command_id:pending.commandId,confirm:true});
   if(data?.status==='awaiting_final_confirmation'){
    setPending({...pending,phrase:data.final_confirmation_phrase});setFinalPhrase('');
    setMessages(m=>m.map(x=>x.commandId===pending.commandId?{...x,text:'تأیید اول ثبت شد. برای اجرای نهایی، عبارت زیر را عیناً وارد کنید.',status:data.status,finalPhrase:data.final_confirmation_phrase}:x));
   }else{
    setMessages(m=>[...m,{role:'assistant',text:resultSummary(data.result),commandId:pending.commandId,status:data.status,result:data.result}]);setPending(undefined);setFinalPhrase('');
   }
  }catch(e:any){const msg=e?.message||'تأیید عملیات ناموفق بود.';setError(msg)}
  finally{setBusy(false)}
 };
 const finalConfirm=async()=>{
  if(!pending?.phrase||finalPhrase.trim()!==pending.phrase.trim()||busy)return;
  await executeFinal();
 };
 const executeFinal=async()=>{
  if(!pending)return;setBusy(true);setError('');
  try{
   const data=await call({op:'execute',command_id:pending.commandId,confirm:true,final_confirmation:finalPhrase.trim()});
   setMessages(m=>[...m,{role:'assistant',text:resultSummary(data.result),commandId:pending.commandId,status:data.status,result:data.result}]);setPending(undefined);setFinalPhrase('');
  }catch(e:any){setError(e?.message||'تأیید نهایی ناموفق بود.')}
  finally{setBusy(false)}
 };
 const loadHistory=async()=>{setBusy(true);try{const data=await call({op:'history'});setHistory(data?.history||[]);setShowHistory(true)}catch(e:any){setError(e?.message||'تاریخچه دریافت نشد.')}finally{setBusy(false)}};
 const activePending=useMemo(()=>pending&&messages.find(x=>x.commandId===pending.commandId),[pending,messages]);
 
 return <>{!open&&<button type="button" className="ai-operator-launcher" aria-label="AI Operator" onClick={()=>setOpen(true)}><Bot size={19}/><span>AI</span></button>}
 {open&&<><div className="ai-operator-backdrop" onClick={()=>setOpen(false)}/><aside className="ai-operator-panel" dir="rtl">
  <header className="ai-operator-header"><div className="flex items-center gap-2 min-w-0"><div className="ai-operator-avatar"><Bot size={17}/></div><div><b>AI Operator</b><div className="text-[9px] app-muted">دستیار عملیاتی Customs OS</div></div></div><div className="flex items-center gap-1"><button className="ai-header-icon" title="تاریخچه دستورات" onClick={()=>void loadHistory()}><History size={17}/></button><button className="ai-header-icon" title="بستن" onClick={()=>setOpen(false)}><X size={18}/></button></div></header>
  <main className="ai-operator-messages">
   {!messages.length&&!showHistory&&<div className="ai-operator-welcome"><Bot size={28}/><h3>دستور عملیاتی خود را بنویسید</h3><p>خواندن، ثبت، ویرایش و تغییر وضعیت فقط در محدوده دسترسی همین کاربر انجام می‌شود.</p><div className="text-[10px] app-muted mt-4">مثال: «وضعیت مالی پرونده ۱۲۳۴ را نشان بده»</div></div>}
   {showHistory&&<section className="ai-operator-history"><div className="flex items-center justify-between mb-3"><b>تاریخچه ۵۰ دستور اخیر</b><button className="text-xs app-muted" onClick={()=>setShowHistory(false)}>بازگشت</button></div>{history.map(h=><div key={h.id} className="ai-history-row"><div className="font-bold text-xs">{h.natural_command}</div><div className="text-[10px] app-muted mt-1">{h.module} · {h.action_code||'—'} · {h.status}</div></div>)}{!history.length&&<div className="py-8 text-center app-muted text-xs">تاریخچه‌ای ثبت نشده است.</div>}</section>}
   {!showHistory&&messages.map((m,i)=><div key={i} className={`ai-op-message ${m.role==='user'?'user':'assistant'}`}><div className="text-[9px] app-muted mb-1">{m.role==='user'?'شما':'AI Operator'}</div><div className="whitespace-pre-wrap leading-7">{m.text}</div>
     {m.plan&&<div className="ai-plan-card"><div className="flex items-center justify-between gap-2"><b>{m.plan.module}</b>{m.plan.risk&&(()=>{const R=riskMeta[m.plan.risk!];const I=R.icon;return <span className={`ai-risk-badge ${R.className}`}><I size={12}/>{R.label}</span>})()}</div><div className="text-xs mt-2">{m.plan.action_code}</div><div className="text-[11px] app-muted mt-1">{planSummary(m.plan)}</div>{m.plan.confidence!=null&&<div className="text-[10px] app-muted mt-2">Confidence: {Math.round(m.plan.confidence*100)}%</div>}
     {m.status==='awaiting_confirmation'&&pending?.commandId===m.commandId&&!pending.phrase&&<button type="button" className="ai-operator-confirm" disabled={busy} onClick={()=>void confirm()}><Check size={14}/> تأیید و اجرا</button>}
     {m.status==='awaiting_final_confirmation'&&pending?.commandId===m.commandId&&pending.phrase&&<div className="mt-3"><div className="text-[10px] app-muted mb-1">عبارت تأیید نهایی:</div><code className="block rounded-lg bg-[var(--surface-2)] p-2 text-[11px]">{pending.phrase}</code><input className="ai-operator-final-input" value={finalPhrase} onChange={e=>setFinalPhrase(e.target.value)} placeholder="عبارت را عیناً وارد کنید" onKeyDown={e=>{if(e.key==='Enter')void finalConfirm()}}/><button type="button" className="ai-operator-confirm danger" disabled={busy||finalPhrase.trim()!==pending.phrase.trim()} onClick={()=>void finalConfirm()}><Trash2 size={14}/> تأیید نهایی</button></div>}
     </div>}
     {m.result!=null&&<details className="mt-2"><summary className="text-[10px] app-muted cursor-pointer flex items-center gap-1"><ChevronDown size={12}/> جزئیات نتیجه</summary><pre className="mt-2 text-[9px] overflow-auto max-h-56 rounded-lg bg-[var(--surface-2)] p-2" dir="ltr">{compact(m.result)}</pre></details>}
   </div>)}
   {activePending&&pending?.phrase&&!activePending.finalPhrase&&null}
   {busy&&<div className="ai-operator-busy"><Loader2 size={14} className="animate-spin"/> در حال پردازش…</div>}
   {error&&<div className="ai-operator-error">{error}</div>}
  </main>
  <footer className="ai-operator-composer"><textarea value={input} rows={1} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')void send()}} placeholder="دستور عملیاتی را بنویسید…"/><button type="button" disabled={busy||!input.trim()} onClick={()=>void send()}><Send size={17}/></button><div className="ai-operator-hint">Enter برای خط جدید · Ctrl/⌘+Enter برای اجرا</div></footer>
 </aside></>}
 </>;
};
