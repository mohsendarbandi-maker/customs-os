import React,{useMemo,useRef,useState}from'react';
import{Bot,Check,ChevronDown,History,Loader2,Paperclip,Send,ShieldAlert,ShieldCheck,Trash2,X}from'lucide-react';
import{supabase}from'../lib/supabase';
import{makeClientId}from'../lib/clientId';
import{useAuth}from'../context/AuthContext';

type Risk='safe'|'requires_confirmation'|'destructive';
type Plan={action_code:string;module:string;target?:Record<string,unknown>;params?:Record<string,unknown>;risk?:Risk;confidence?:number;clarification?:string|null;reason?:string};
type Message={role:'user'|'assistant';text:string;plan?:Plan;commandId?:string;status?:string;finalPhrase?:string;result?:unknown};
type Pending={commandId:string;risk:Risk;phrase?:string;plan?:Plan;attachment?:File};

const riskMeta:Record<Risk,{label:string;icon:React.ElementType;className:string}>={
 safe:{label:'ایمن — فقط خواندنی',icon:ShieldCheck,className:'safe'},
 requires_confirmation:{label:'نیازمند تأیید',icon:ShieldCheck,className:'confirm'},
 destructive:{label:'عملیات مخرب — تأیید دو مرحله‌ای',icon:ShieldAlert,className:'danger'}
};

const actionLabels:Record<string,string>={
 'cases.read':'مشاهده پرونده','cases.update':'ویرایش پرونده','cases.status_change':'تغییر وضعیت پرونده','cases.delete':'حذف پرونده',
 'maritime.read':'مشاهده کشتیرانی','maritime.shipment_update':'ویرایش محموله دریایی',
 'documents.read':'مشاهده اسناد','documents.upload':'آپلود سند','documents.update':'ویرایش سند','documents.delete':'حذف سند',
 'permits.read':'مشاهده مجوز','permits.create':'ایجاد مجوز','permits.update':'ویرایش مجوز','permits.delete':'حذف مجوز',
 'declarations.read':'مشاهده اظهار','declarations.register':'ثبت اظهار','declarations.update':'ویرایش اظهار',
 'finance.read':'مشاهده مالی','finance.cost.create':'ثبت هزینه','finance.cost.update':'ویرایش هزینه','finance.cost.delete':'حذف هزینه',
 'accounting_vouchers.read':'مشاهده سند حسابداری','accounting_vouchers.create':'ایجاد سند حسابداری','accounting_vouchers.update':'ویرایش سند حسابداری','accounting_vouchers.void_line':'باطل کردن ردیف سند',
 'exit.read':'مشاهده خروج','exit.update':'ثبت/ویرایش خروج','control.report':'گزارش مرکز کنترل',
 'settings.ai_gateway.read':'مشاهده AI Gateway','settings.ai_gateway.update':'ویرایش AI Gateway','settings.audit.read':'مشاهده Audit Log'
};

const faNumber=(n:number)=>new Intl.NumberFormat('fa-IR').format(n);
const compact=(v:unknown)=>typeof v==='string'?v:(v==null?'':JSON.stringify(v,null,2));
const planSummary=(p:Plan)=>{
 const action=actionLabels[p.action_code]||p.action_code;
 const target=Object.entries(p.target||{}).filter(([,v])=>v!==null&&v!==undefined&&String(v)!=='').map(([k,v])=>k+': '+String(v)).slice(0,3);
 const params=Object.entries(p.params||{}).filter(([,v])=>v!==null&&v!==undefined&&String(v)!=='').map(([k,v])=>k+': '+String(v)).slice(0,3);
 return [action,target.length?'هدف '+target.join(' · '):'',params.length?'پارامتر '+params.join(' · '):'',p.reason||''].filter(Boolean).join(' — ');
};
const resultSummary=(v:any)=>{
 if(!v)return'عملیات انجام شد.';
 if(v.type==='read')return'اطلاعات با موفقیت خوانده شد.';
 if(v.id)return'رکورد با موفقیت ثبت یا ویرایش شد.';
 if(v.case_id)return'پرونده با موفقیت پردازش شد.';
 if(v.shipment_id)return'محموله با موفقیت پردازش شد.';
 if(Array.isArray(v))return faNumber(v.length)+' مورد دریافت شد.';
 return'عملیات با موفقیت انجام شد.';
};
const safeFileName=(name:string)=>name.replace(/[^\w.\-\u0600-\u06ff]+/g,'_').slice(0,180);

export const AIOperatorPanel:React.FC<{pageContext?:string}>=({pageContext=''})=>{
 const{profile}=useAuth();
 const[file,setFile]=useState<File>();
 const[fileInputRef]=useState(()=>React.createRef<HTMLInputElement>());
 const[sessionId]=useState(()=>{try{const k='customs_os_ai_operator_session';const old=localStorage.getItem(k);if(old)return old;const id=makeClientId();localStorage.setItem(k,id);return id}catch{return makeClientId()}});
 const[open,setOpen]=useState(false),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[messages,setMessages]=useState<Message[]>([]),[history,setHistory]=useState<any[]>([]),[showHistory,setShowHistory]=useState(false),[pending,setPending]=useState<Pending>(),[finalPhrase,setFinalPhrase]=useState(''),[error,setError]=useState('');

 const call=async(body:any)=>{
  const{data,error}=await supabase.functions.invoke('ai-operator',{body});
  if(error){let detail=error.message;try{const c=await(error as any).context?.json?.();detail=c?.error||detail}catch{}throw new Error(detail||'AI Operator پاسخ نداد.');}
  return data;
 };

 const chooseFile=(next:File|undefined)=>{
  setError('');
  if(!next){setFile(undefined);return}
  const mime=next.type.toLowerCase();
  if(!/^(application\/pdf|image\/(jpeg|png))$/.test(mime)){setError('برای AI Operator فقط PDF/JPG/PNG مجاز است.');return}
  if(next.size>50*1024*1024){setError('حجم فایل بیش از ۵۰MB است.');return}
  setFile(next);
 };

 const send=async()=>{
  const q=input.trim();if(!q||busy)return;
  setInput('');setError('');setBusy(true);setMessages(m=>[...m,{role:'user',text:q}]);
  try{
   const data=await call({op:'plan',query:q,page_context:pageContext,session_id:sessionId,attachment_meta:file?{file_name:file.name,mime_type:file.type,file_size_bytes:file.size}:null});
   const p=data?.plan as Plan|undefined;
   if(data?.status==='awaiting_confirmation'){
    const risk=(data.risk_level||p?.risk||'requires_confirmation') as Risk;
    setPending({commandId:data.command_id,risk,phrase:data.final_confirmation_phrase,plan:p,attachment:file});
    setMessages(m=>[...m,{role:'assistant',text:'این عملیات نیازمند تأیید صریح شماست.',plan:p,commandId:data.command_id,status:data.status,finalPhrase:data.final_confirmation_phrase}]);
    setFile(undefined);
   }else if(data?.status==='clarification_needed'){
    setMessages(m=>[...m,{role:'assistant',text:p?.clarification||data?.clarification||'اطلاعات کافی نیست؛ لطفاً هدف را دقیق‌تر مشخص کنید.',plan:p,status:data.status}]);
   }else{
    setMessages(m=>[...m,{role:'assistant',text:resultSummary(data.result),plan:p,status:data.status,result:data.result}]);setFile(undefined);
   }
  }catch(e:any){const msg=e?.message||'اجرای دستور ناموفق بود.';setError(msg);setMessages(m=>[...m,{role:'assistant',text:msg,status:'failed'}])}
  finally{setBusy(false)}
 };

 const resolveShipmentId=async(plan:Plan)=>{
  const t=plan.target||{};
  if(typeof t.shipment_id==='string'&&/^[0-9a-f-]{36}$/i.test(t.shipment_id))return t.shipment_id;
  let q=supabase.from('shipments').select('id').eq('organization_id',profile?.organization_id||'');
  if(typeof t.bill_of_lading==='string'&&t.bill_of_lading.trim())q=q.eq('bill_of_lading_no',t.bill_of_lading.trim());
  else if(typeof t.shipment_name==='string'&&t.shipment_name.trim())q=q.eq('display_name',t.shipment_name.trim());
  else return null;
  const{data,error}=await q.limit(2);if(error)throw error;
  if((data||[]).length!==1)throw new Error((data||[]).length?'چند محموله منطبق است؛ محموله دقیق را مشخص کنید.':'محموله دقیق پیدا نشد.');
  return data![0].id;
 };

 const uploadAttachment=async(plan:Plan)=>{
  if(!file||plan.action_code!=='documents.upload')return null;
  if(!profile?.organization_id)throw new Error('سازمان کاربر مشخص نیست.');
  const shipmentId=await resolveShipmentId(plan);if(!shipmentId)throw new Error('برای آپلود سند، محموله دقیق باید مشخص باشد.');
  const path=profile.organization_id+'/'+shipmentId+'/'+makeClientId()+'-'+safeFileName(file.name);
  const{error}=await supabase.storage.from('customs_documents').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(error)throw error;
  return{storage_path:path,file_name:file.name,mime_type:file.type,file_size_bytes:file.size};
 };

 const confirm=async()=>{
  if(!pending||busy)return;
  setBusy(true);setError('');
  try{
   const attachment=await uploadAttachment(pending.plan||{action_code:'' ,module:''});
   const data=await call({op:'execute',command_id:pending.commandId,confirm:true,attachment});
   if(data?.status==='awaiting_final_confirmation'){
    setPending({...pending,phrase:data.final_confirmation_phrase,attachment:undefined});setFinalPhrase('');
    setMessages(m=>m.map(x=>x.commandId===pending.commandId?{...x,text:'تأیید اول ثبت شد. برای اجرای نهایی، عبارت زیر را عیناً وارد کنید.',status:data.status,finalPhrase:data.final_confirmation_phrase}:x));
   }else{
    setMessages(m=>[...m,{role:'assistant',text:resultSummary(data.result),commandId:pending.commandId,status:data.status,result:data.result}]);setPending(undefined);setFinalPhrase('');
   }
  }catch(e:any){setError(e?.message||'تأیید عملیات ناموفق بود.')}
  finally{setBusy(false)}
 };

 const finalConfirm=async()=>{
  if(!pending?.phrase||finalPhrase.trim()!==pending.phrase.trim()||busy)return;
  setBusy(true);setError('');
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
     {m.plan&&<div className="ai-plan-card"><div className="flex items-center justify-between gap-2"><b>{m.plan.module}</b>{m.plan.risk&&(()=>{const R=riskMeta[m.plan.risk!];const I=R.icon;return <span className={`ai-risk-badge ${R.className}`}><I size={12}/>{R.label}</span>})()}</div><div className="text-xs mt-2">{actionLabels[m.plan.action_code]||m.plan.action_code}</div><div className="text-[11px] app-muted mt-1">{planSummary(m.plan)}</div>{m.plan.confidence!=null&&<div className="text-[10px] app-muted mt-2">Confidence: {Math.round(m.plan.confidence*100)}%</div>}
     {m.status==='awaiting_confirmation'&&pending?.commandId===m.commandId&&!pending.phrase&&<button type="button" className="ai-operator-confirm" disabled={busy} onClick={()=>void confirm()}><Check size={14}/> تأیید و اجرا</button>}
     {m.status==='awaiting_final_confirmation'&&pending?.commandId===m.commandId&&pending.phrase&&<div className="mt-3"><div className="text-[10px] app-muted mb-1">عبارت تأیید نهایی:</div><code className="block rounded-lg bg-[var(--surface-2)] p-2 text-[11px]">{pending.phrase}</code><input className="ai-operator-final-input" value={finalPhrase} onChange={e=>setFinalPhrase(e.target.value)} placeholder="عبارت را عیناً وارد کنید" onKeyDown={e=>{if(e.key==='Enter')void finalConfirm()}}/><button type="button" className="ai-operator-confirm danger" disabled={busy||finalPhrase.trim()!==pending.phrase.trim()} onClick={()=>void finalConfirm()}><Trash2 size={14}/> تأیید نهایی</button></div>}
     </div>}
     {m.result!=null&&<details className="mt-2"><summary className="text-[10px] app-muted cursor-pointer flex items-center gap-1"><ChevronDown size={12}/> جزئیات نتیجه</summary><pre className="mt-2 text-[9px] overflow-auto max-h-56 rounded-lg bg-[var(--surface-2)] p-2" dir="ltr">{compact(m.result)}</pre></details>}
   </div>)}
   {activePending&&pending?.phrase&&!activePending.finalPhrase&&null}
   {busy&&<div className="ai-operator-busy"><Loader2 size={14} className="animate-spin"/> در حال پردازش…</div>}
   {error&&<div className="ai-operator-error">{error}</div>}
  </main>
  <footer className="ai-operator-composer"><div className="ai-operator-file-row">{file&&<div className="ai-operator-file-chip"><span className="truncate">{file.name}</span><button type="button" onClick={()=>setFile(undefined)} aria-label="حذف فایل"><X size={12}/></button></div>}<input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={e=>chooseFile(e.target.files?.[0])}/><button type="button" className="ai-operator-attach" disabled={busy} title="پیوست سند" onClick={()=>fileInputRef.current?.click()}><Paperclip size={15}/></button></div><textarea value={input} rows={1} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')void send()}} placeholder="دستور عملیاتی را بنویسید…"/><button type="button" disabled={busy||!input.trim()} onClick={()=>void send()}><Send size={17}/></button><div className="ai-operator-hint">Enter برای خط جدید · Ctrl/⌘+Enter برای اجرا</div></footer>
 </aside></>}
 </>;
};
