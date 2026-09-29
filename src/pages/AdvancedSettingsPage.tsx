import React,{useEffect,useState}from'react';
import{AlertTriangle,Bot,Check,FileCog,History,Plus,RefreshCw,Save,ShieldCheck,Trash2,UserCog}from'lucide-react';
import{useAuth}from'../context/AuthContext';
import{supabase}from'../lib/supabase';

const input='w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--primary)]';
const tabs=[['users','کاربران'],['rules','قواعد مدارک'],['categories','دسته هزینه'],['ai','AI Gateway'],['print','قالب چاپ'],['audit','Audit Log']] as const;
type Tab=typeof tabs[number][0];


type OwnerResource=ResourceKey;
const ownerSections=[
 {id:'users',label:'کاربران و نقش‌ها',resources:['profiles']},
 {id:'cases',label:'پرونده و عملیات',resources:['cases']},
 {id:'registration',label:'Registration Order',resources:['registration_orders']},
 {id:'maritime',label:'کشتیرانی و حمل',resources:['shipments','shipping_lines','vessels','contacts']},
 {id:'documents',label:'اسناد',resources:['shipment_documents','customs_documents']},
 {id:'doc_rules',label:'Rule Engine مدارک',resources:['document_rules']},
 {id:'permit_rules',label:'Permit Rules',resources:['permit_rules','permits']},
 {id:'finance',label:'مالی و حسابداری',resources:['finance_settings','cost_categories','costs','payments','payment_requests','invoices','vouchers','voucher_lines']},
 {id:'declarations',label:'Declaration / EPL / کوتاژ',resources:['declarations']},
 {id:'exit',label:'Exit / خروج',resources:['exit']},
 {id:'ai',label:'AI Gateway / AI Core',resources:['ai_gateway']},
 {id:'print',label:'قالب چاپ / PDF',resources:['templates']},
 {id:'offline',label:'Offline Queue',resources:[]},
 {id:'org',label:'تنظیمات سازمان',resources:['org','org_settings','finance_settings']}
] as const;

const ownerFields=(resource:OwnerResource,row:any)=>{
 const out:any={};for(const [k,v] of Object.entries(row||{})){
  if(['id','organization_id','created_at','updated_at','created_by','updated_by','user_id','uploaded_by','voided_by','voided_at','archived_by','archived_at','is_archived','archive_reason'].includes(k))continue;
  out[k]=v;
 }return out;
};

const OwnerResourcePanel:React.FC<{resource:OwnerResource;onMessage:(s:string)=>void}>=({resource,onMessage})=>{
 const[rows,setRows]=useState<any[]>([]),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>(null),[json,setJson]=useState('{}'),[busy,setBusy]=useState(false),[modal,setModal]=useState<'delete'|'archive'|'void'|null>(null),[reason,setReason]=useState(''),[phrase,setPhrase]=useState('');
 const cols=resourceColumns[resource]||[];
 const isCase=resource==='cases';
 const isDoc=resource==='shipment_documents'||resource==='customs_documents';
 const isVoid=resource==='voucher_lines';
 const load=async()=>{
  setBusy(true);
  try{
   const{data,error}=await supabase.functions.invoke('owner-console',{body:{action:'list',resource,search,limit:500}});
   if(error)throw error;setRows(Array.isArray(data)?data:[]);
  }catch(e:any){onMessage(e?.message||'خطا در خواندن داده.')}finally{setBusy(false)}
 };
 useEffect(()=>{void load()},[resource,search]);
 const open=(row:any)=>{setSelected(row);setJson(JSON.stringify(ownerFields(resource,row),null,2))};
 const createNew=()=>{setSelected(null);setJson('{}')};
 const save=async()=>{
  setBusy(true);
  try{
   const data=JSON.parse(json||'{}');const body:any={action:selected?'update':'create',resource,data};
   if(selected?.id)body.id=selected.id;
   const{data:outData,error}=await supabase.functions.invoke('owner-console',{body});
   if(error)throw error;
   onMessage(selected?'رکورد ویرایش شد.':'رکورد ایجاد شد.');
   setSelected(outData);setJson(JSON.stringify(ownerFields(resource,outData),null,2));await load();
  }catch(e:any){onMessage(e?.message||'JSON یا ذخیره نامعتبر است.')}finally{setBusy(false)}
 };
 const runDanger=async()=>{
  if(!selected||!modal||!reason.trim())return;
  setBusy(true);
  try{
   let body:any;
   if(modal==='archive')body={action:'delete',resource:'document_archive',id:selected.id,reason:reason.trim()};
   else if(modal==='void')body={action:'delete',resource:'voucher_void',id:selected.id,reason:reason.trim(),confirmation:phrase.trim()};
   else body={action:'delete',resource:'case_delete',id:selected.id,reason:reason.trim(),confirmation:phrase.trim()};
   const{error}=await supabase.functions.invoke('owner-console',{body});if(error)throw error;
   onMessage('عملیات با موفقیت ثبت شد.');setModal(null);setReason('');setPhrase('');setSelected(null);await load();
  }catch(e:any){onMessage(e?.message||'عملیات ناموفق بود.')}finally{setBusy(false)}
 };
 const needsPhrase=modal==='delete'||modal==='void';
 const requiredPhrase=modal==='delete'?'تأیید نهایی حذف پرونده':modal==='void'?'تأیید نهایی ابطال ردیف سند':'';
 return <section className="space-y-3">
  <div className="rounded-2xl border app-border bg-[var(--surface)] p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><b>{resourceLabels[resource]}</b><div className="text-[10px] app-muted mt-1">{rows.length} رکورد</div></div>
    <div className="flex gap-2"><button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={createNew}>＋ رکورد جدید</button><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={15}/></button></div>
   </div>
   <div className="relative mt-3"><Search size={15} className="absolute right-3 top-3 app-muted"/><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] pr-9 px-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)} placeholder="جست‌وجو در این بخش…"/></div>
  </div>
  <div className="grid xl:grid-cols-[1fr_480px] gap-3">
   <div className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden max-h-[68vh] overflow-auto">
    {rows.map((row:any)=><button key={row.id||JSON.stringify(row)} type="button" onClick={()=>open(row)} className={'w-full text-right border-b app-border px-4 py-3 hover:bg-[var(--surface-2)] '+(selected?.id===row.id?'bg-[var(--surface-2)]':'')}><div className="grid grid-cols-2 md:grid-cols-3 gap-3">{cols.slice(0,9).map(k=><div key={k} className="min-w-0"><div className="text-[9px] app-muted">{k}</div><div className="text-xs truncate">{pretty(row[k])||'—'}</div></div>)}</div></button>)}
    {!rows.length&&<div className="p-10 text-center text-xs app-muted">رکوردی یافت نشد.</div>}
   </div>
   <div className="rounded-2xl border app-border bg-[var(--surface)] p-4 h-fit">
    <div className="flex items-center justify-between gap-2"><b>{selected?'ویرایش':'رکورد جدید'}</b>{selected?.id&&<span className="text-[9px] app-muted break-all">{selected.id}</span>}</div>
    <textarea dir="ltr" className="w-full min-h-[430px] rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs mt-3 font-mono" value={json} onChange={e=>setJson(e.target.value)}/>
    <div className="flex flex-wrap gap-2 mt-3"><button disabled={busy} onClick={()=>void save()} className="px-4 py-2.5 rounded-xl bg-[var(--primary)] text-white text-xs font-bold inline-flex items-center gap-2"><Save size={14}/>ذخیره</button>
    {selected?.id&&isCase&&<button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={()=>setJson(j=>j)}>تصحیح وضعیت ← در JSON</button>}
    {selected?.id&&<button className="px-3 py-2 rounded-xl border border-red-500/30 text-red-500 text-xs" onClick={()=>setModal(isDoc?'archive':isVoid?'void':'delete')}>{isDoc?<><Archive size={14} className="inline ml-1"/>Archive</>:isVoid?<><Lock size={14} className="inline ml-1"/>Void</>:<><Trash2 size={14} className="inline ml-1"/>Delete</>}</button>}</div>
    {isCase&&<CaseStatusOwnerAction row={selected} onMessage={onMessage} onDone={load}/>}
   </div>
  </div>
  {modal&&<div className="fixed inset-0 z-[120] bg-black/55 flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-lg rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex justify-between gap-3"><div><b className="flex items-center gap-2"><AlertTriangle size={18}/>تأیید عملیات</b><p className="text-xs app-muted mt-2">{modal==='archive'?'سند فیزیکی حذف نمی‌شود و Storage دست‌نخورده می‌ماند.':modal==='void'?'ردیف حسابداری باطل می‌شود و داده‌های Void قابل ویرایش نیستند.':'این عملیات روی رکورد واقعی سازمان انجام می‌شود.'}</p></div><button className="icon-btn" onClick={()=>setModal(null)}><X size={17}/></button></div><textarea className="w-full min-h-24 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm mt-4" value={reason} onChange={e=>setReason(e.target.value)} placeholder="دلیل اجباری…"/>{needsPhrase&&<><div className="text-[10px] app-muted mt-3">عبارت نهایی:</div><div className="rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs font-bold mt-1">{requiredPhrase}</div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mt-2" value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder="عبارت را عیناً وارد کنید"/></>}<div className="flex justify-end gap-2 mt-4"><button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={()=>setModal(null)}>انصراف</button><button disabled={busy||!reason.trim()||(needsPhrase&&phrase!==requiredPhrase)} onClick={()=>void runDanger()} className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold">تأیید نهایی</button></div></div></div>}
 </section>;
};

const CaseStatusOwnerAction:React.FC<{row:any;onMessage:(s:string)=>void;onDone:()=>void}>=({row,onMessage,onDone})=>{
 const[open,setOpen]=useState(false),[status,setStatus]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 if(!row)return null;
 const run=async()=>{
  if(!status.trim()||!reason.trim())return;setBusy(true);
  try{const{error}=await supabase.functions.invoke('owner-console',{body:{action:'update',resource:'case_status_override',id:row.id,new_status:status.trim(),reason:reason.trim()}});if(error)throw error;onMessage('Status با Override ثبت و در History/Audit ثبت شد.');setOpen(false);setStatus('');setReason('');onDone()}catch(e:any){onMessage(e?.message||'Override ناموفق بود.')}finally{setBusy(false)}
 };
 return <><button className="w-full mt-3 px-3 py-2.5 rounded-xl border border-amber-500/30 text-amber-600 text-xs font-bold" onClick={()=>setOpen(true)}>Override Status — فقط Owner</button>{open&&<div className="fixed inset-0 z-[120] bg-black/55 flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-lg rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex justify-between"><b>اصلاح دستی Status</b><button className="icon-btn" onClick={()=>setOpen(false)}><X size={17}/></button></div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mt-4" value={status} onChange={e=>setStatus(e.target.value)} placeholder="مقدار معتبر case_status، مانند archived"/><textarea className="w-full min-h-24 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm mt-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="دلیل اجباری Override…"/><div className="flex justify-end gap-2 mt-4"><button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={()=>setOpen(false)}>انصراف</button><button disabled={busy||!status.trim()||!reason.trim()} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-xs" onClick={()=>void run()}>ثبت Override</button></div></div></div>}</>;
};

const OwnerLogsPanel:React.FC<{onMessage:(s:string)=>void}>=({onMessage})=>{
 const[kind,setKind]=useState<ReadOnlyKey>('audit'),[rows,setRows]=useState<any[]>([]);
 const load=async()=>{try{const{data,error}=await supabase.functions.invoke('owner-console',{body:{action:'list',resource:kind,limit:500}});if(error)throw error;setRows(Array.isArray(data)?data:[])}catch(e:any){onMessage(e?.message||'خواندن Log ناموفق بود.')}};
 useEffect(()=>{void load()},[kind]);
 return <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden"><div className="p-4 border-b app-border flex flex-wrap gap-2 items-center"><select className="min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-xs" value={kind} onChange={e=>setKind(e.target.value as ReadOnlyKey)}>{Object.entries(readOnlyLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={15}/></button><span className="text-[10px] app-muted">فقط خواندنی؛ Update/Delete در API و Database مسدود است.</span></div><div className="max-h-[56vh] overflow-auto">{rows.map((r:any,i:number)=><details key={r.id||i} className="border-b app-border p-3"><summary className="text-xs cursor-pointer">{readOnlyLabels[kind]} · {r.created_at||r.event_at||''}</summary><pre dir="ltr" className="mt-2 text-[9px] overflow-auto rounded-xl bg-[var(--surface-2)] p-3">{JSON.stringify(r,null,2)}</pre></details>)}</div></section>;
};

const OwnerOfflinePanel:React.FC=()=>{
 const[items,setItems]=useState<any[]>([]);
 useEffect(()=>{const a:any[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';if(k.toLowerCase().includes('queue')||k.toLowerCase().includes('offline')||k.toLowerCase().includes('sync')){let v:any=localStorage.getItem(k);try{v=JSON.parse(v||'')}catch{}a.push({key:k,value:v})}}setItems(a)},[]);
 return <section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><b>Offline Queue</b><p className="text-xs app-muted mt-1">عیب‌یابی read-only؛ هیچ Sync Queue از اینجا حذف نمی‌شود.</p>{items.length?items.map(x=><details key={x.key} className="border app-border rounded-xl p-3 mt-2"><summary className="text-xs">{x.key}</summary><pre dir="ltr" className="text-[9px] mt-2 overflow-auto">{pretty(x.value)}</pre></details>):<div className="p-10 text-center text-xs app-muted">صف قابل مشاهده‌ای در localStorage پیدا نشد.</div>}</section>;
};

export const AdvancedSettingsPage:React.FC=()=>{
 const{profile}=useAuth();const owner=profile?.role==='owner';const[section,setSection]=useState<(typeof ownerSections)[number]['id']>('users');const[resource,setResource]=useState<OwnerResource>('profiles');const[message,setMessage]=useState('');
 const current=useMemo(()=>ownerSections.find(x=>x.id===section)!,[section]);
 useEffect(()=>{if(current.resources[0])setResource(current.resources[0] as OwnerResource)},[section]);
 if(!owner)return <main dir="rtl" className="p-6"><div className="max-w-xl mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center"><ShieldCheck className="mx-auto mb-3 text-red-500"/><h1 className="font-black text-lg mt-3">دسترسی غیرمجاز</h1><p className="text-xs app-muted mt-2">Owner Console فقط برای Owner مجاز است.</p></div></main>;
 return <main dir="rtl" className="min-h-screen p-4 md:p-6"><div className="max-w-[1800px] mx-auto"><header className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><div className="text-[10px] app-muted">OWNER CONTROL PLANE</div><h1 className="text-2xl font-black">تنظیمات تخصصی</h1><p className="text-xs app-muted mt-1">مدیریت کامل و امن داده‌های سازمان در محدوده Owner</p></div><span className="px-3 py-2 rounded-xl border app-border text-[10px]"><Lock size={13} className="inline ml-1"/>Owner Only</span></header>{message&&<div className="mb-4 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs">{message}</div>}<div className="grid xl:grid-cols-[250px_1fr] gap-4"><aside className="rounded-2xl border app-border bg-[var(--surface)] p-2 h-fit xl:sticky xl:top-4"><div className="px-3 py-2 text-[10px] app-muted">کنسول مدیریت</div>{ownerSections.map(s=><button key={s.id} onClick={()=>setSection(s.id)} className={'w-full text-right flex items-center px-3 py-2.5 rounded-xl text-xs font-bold '+(section===s.id?'bg-[var(--primary)] text-white':'hover:bg-[var(--surface-2)]')}>{s.label}</button>)}<div className="border-t app-border my-2"/><button onClick={()=>setSection('ai')} className="w-full text-right flex items-center px-3 py-2.5 rounded-xl text-xs">Audit / Logs فقط خواندنی</button></aside><div>{current.resources.length>1&&<div className="flex gap-2 overflow-x-auto pb-2">{current.resources.map(r=><button key={r} onClick={()=>setResource(r as OwnerResource)} className={'px-3 py-2 rounded-xl border app-border text-xs font-bold whitespace-nowrap '+(resource===r?'bg-[var(--primary)] text-white':'bg-[var(--surface)]')}>{resourceLabels[r as OwnerResource]}</button>)}</div>}{section==='offline'?<OwnerOfflinePanel/>:<><OwnerResourcePanel resource={resource} onMessage={setMessage}/><div className="mt-3"><OwnerLogsPanel onMessage={setMessage}/></div></>}</div></div></div></main>;
};
