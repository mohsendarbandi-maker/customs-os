import React,{useCallback,useEffect,useMemo,useState}from'react';
import{AlertTriangle,ArrowLeft,BrainCircuit,Check,Info,Loader2,Plus,Save,Trash2}from'lucide-react';
import{Link,useSearchParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';

type Decl={id:string;shipment_id:string|null;case_id:string|null;kottaj_number:string;declaration_date:string;customs_path:string|null;payment_reference:string|null;total_duties_irr:number|null;declaration_file_name:string|null};
type Item={id:string;item_key:string;item_label:string;completed:boolean;note:string|null;sort_order:number;source:string;is_active:boolean};
type Rule={id:string;rule_name:string;hs_code_prefix:string;customs_path:string;transport_mode:string;checklist_counts:Record<string,number>;field_counts:Record<string,number>;workflow_stages:number[];evidence_count:number;confidence:number;source:string;is_active:boolean};

const PATH_LABELS:Record<string,string>={green:'سبز',yellow:'زرد',red:'قرمز'};
const FIELD_LABELS:Record<string,string>={
 tariff_code:'HS Code',customs_path:'مسیر گمرکی',kottaj_number:'شماره کوتاژ',declaration_date:'تاریخ اظهار',
 payment_reference:'شناسه پرداخت',total_duties_irr:'حقوق ورودی / مبلغ گمرکی',registration_order_no:'شماره ثبت سفارش',
 warehouse_receipt_no:'شماره قبض انبار',cargo_description:'شرح کالا',origin_country:'کشور مبدأ',
 transaction_country:'کشور معامله',delivery_term:'اینکوترمز / شرایط تحویل',invoice_amount:'مبلغ فاکتور',
 invoice_currency:'ارز فاکتور',bank_name:'نام بانک',bank_branch:'شعبه بانک',lc_number:'شماره اعتبار اسنادی',
 duty_rate:'نرخ حقوق ورودی',net_weight_kg:'وزن خالص',gross_weight_kg:'وزن ناخالص',bill_of_lading:'شماره B/L',
 insurance_irr:'بیمه',required_documents:'اسناد موردنیاز',source_method:'منبع اطلاعات'
};
const digits=(v:string)=>String(v||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const normalizeHs=(v:string)=>digits(v).replace(/\D/g,'');
const itemRatio=(count:number,evidence:number)=>evidence>0?count/evidence:0;

export const DeclarationOperationsChecklistPage:React.FC=()=>{
 const{profile}=useAuth();
 const[params]=useSearchParams();
 const declarationId=params.get('declarationId')||'';
 const[decl,setDecl]=useState<Decl|null>(null);
 const[items,setItems]=useState<Item[]>([]);
 const[rule,setRule]=useState<Rule|null>(null);
 const[hs,setHs]=useState('');
 const[draftNote,setDraftNote]=useState<Record<string,string>>({});
 const[noteOpen,setNoteOpen]=useState<Record<string,boolean>>({});
 const[newItem,setNewItem]=useState('');
 const[addOpen,setAddOpen]=useState(false);
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[message,setMessage]=useState('');

 const canEdit=['owner','admin','broker','warehouse'].includes(profile?.role||'');

 const load=useCallback(async()=>{
  if(!declarationId)return;
  setBusy(true);setError('');setMessage('');
  try{
   const{data:d,error:de}=await supabase.from('customs_declarations').select('id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,payment_reference,total_duties_irr,declaration_file_name').eq('id',declarationId).maybeSingle();
   if(de)throw de;if(!d)throw new Error('اظهارنامه پیدا نشد.');
   setDecl(d as Decl);

   const[{data:sc},{data:c},{data:ro}]=await Promise.all([
    d.shipment_id?supabase.from('shipment_customs_data').select('tariff_code').eq('shipment_id',d.shipment_id).maybeSingle():Promise.resolve({data:null} as any),
    d.case_id?supabase.from('cases').select('tariff_code').eq('id',d.case_id).maybeSingle():Promise.resolve({data:null} as any),
    d.case_id?supabase.from('registration_orders').select('tariff_code').eq('case_id',d.case_id).order('updated_at',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null} as any)
   ]);
   const resolvedHs=normalizeHs(String(sc?.tariff_code||c?.tariff_code||ro?.tariff_code||''));
   setHs(resolvedHs);

   const[{data:allRows,error:ce},{data:rules}]=await Promise.all([
    supabase.from('declaration_checklist_items').select('id,item_key,item_label,completed,note,sort_order,source,is_active').eq('declaration_id',declarationId).order('sort_order').order('created_at'),
    canEdit?supabase.from('customs_operation_rules').select('id,rule_name,hs_code_prefix,customs_path,transport_mode,checklist_counts,field_counts,workflow_stages,evidence_count,confidence,source,is_active').eq('is_active',true).order('evidence_count',{ascending:false}):Promise.resolve({data:[]} as any)
   ]);
   if(ce)throw ce;

   if(!allRows?.length&&canEdit){
    const{error:ie}=await supabase.rpc('initialize_declaration_checklist',{p_declaration_id:declarationId});
    if(ie)throw ie;
    const{data:re,error:rer}=await supabase.from('declaration_checklist_items').select('id,item_key,item_label,completed,note,sort_order,source,is_active').eq('declaration_id',declarationId).order('sort_order').order('created_at');
    if(rer)throw rer;
    setItems((re||[]).filter((x:any)=>x.is_active).map((x:any)=>x as Item));
    for(const x of re||[]){if(x.note)setDraftNote(p=>({...p,[x.id]:x.note||''}))}
   }else{
    setItems((allRows||[]).filter((x:any)=>x.is_active).map((x:any)=>x as Item));
    for(const x of allRows||[]){if(x.note)setDraftNote(p=>({...p,[x.id]:x.note||''}))}
   }

   const candidates=((rules||[]) as Rule[]).filter(r=>{
    const prefix=normalizeHs(r.hs_code_prefix);
    const pathOk=!r.customs_path||!d.customs_path||r.customs_path===d.customs_path;
    return !!prefix&&!!resolvedHs&&resolvedHs.startsWith(prefix)&&pathOk;
   }).sort((a,b)=>normalizeHs(b.hs_code_prefix).length-normalizeHs(a.hs_code_prefix).length||b.evidence_count-a.evidence_count);
   setRule(candidates[0]||null);
  }catch(e:any){setError(e?.message||'دریافت چک‌لیست عملیات گمرکی انجام نشد')}
  finally{setBusy(false)}
 },[canEdit,declarationId]);

 useEffect(()=>{void load()},[load]);

 const suggestedItems=useMemo(()=>{
  if(!rule||!rule.is_active||rule.evidence_count<2)return[];
  return Object.entries(rule.checklist_counts||{})
   .filter(([label,count])=>itemRatio(Number(count),rule.evidence_count)>=0.6&&label.trim())
   .sort((a,b)=>Number(b[1])-Number(a[1])).map(([label])=>label);
 },[rule]);

 const suggestedFields=useMemo(()=>{
  if(!rule||rule.evidence_count<2)return[];
  return Object.entries(rule.field_counts||{})
   .filter(([,count])=>itemRatio(Number(count),rule.evidence_count)>=0.6)
   .sort((a,b)=>Number(b[1])-Number(a[1])).map(([key])=>FIELD_LABELS[key]||key);
 },[rule]);

 const pending=useMemo(()=>items.filter(x=>!x.completed),[items]);
 const completed=items.length-pending.length;

 const toggle=async(item:Item)=>{
  if(!canEdit)return;
  const next=!item.completed;
  setItems(p=>p.map(x=>x.id===item.id?{...x,completed:next}:x));
  setError('');setMessage('');
  const{error:e}=await supabase.rpc('update_declaration_checklist_item',{p_item_id:item.id,p_completed:next});
  if(e){setItems(p=>p.map(x=>x.id===item.id?{...x,completed:item.completed}:x));setError(e.message)}
 };

 const saveNote=async(item:Item)=>{
  if(!canEdit)return;
  const note=(draftNote[item.id]??item.note??'').trim();
  const{error:e}=await supabase.rpc('set_declaration_checklist_note',{p_item_id:item.id,p_note:note});
  if(e){setError(e.message);return}
  setItems(p=>p.map(x=>x.id===item.id?{...x,note:note||null}:x));
  setDraftNote(p=>({...p,[item.id]:note}));
  setMessage(note?'توضیح مورد ذخیره شد.':'توضیح مورد پاک شد.');
 };

 const addItem=async()=>{
  if(!canEdit)return;
  const label=newItem.trim();
  if(label.length<2){setError('عنوان مورد جدید را وارد کنید.');return}
  setBusy(true);setError('');setMessage('');
  try{
   const nextOrder=Math.max(0,...items.map(x=>x.sort_order||0))+10;
   const{error:e}=await supabase.rpc('add_declaration_checklist_item',{p_declaration_id:declarationId,p_item_label:label,p_sort_order:nextOrder});
   if(e)throw e;
   setNewItem('');setAddOpen(false);setMessage('مورد جدید به چک‌لیست این اظهارنامه اضافه شد.');await load();
  }catch(e:any){setError(e?.message||'افزودن مورد جدید انجام نشد')}finally{setBusy(false)}
 };

 const removeItem=async(item:Item)=>{
  if(!canEdit)return;
  const{error:e}=await supabase.rpc('set_declaration_checklist_item_active',{p_item_id:item.id,p_active:false});
  if(e){setError(e.message);return}
  setItems(p=>p.filter(x=>x.id!==item.id));setMessage('این مورد از چک‌لیست همین اظهارنامه حذف شد.');
 };

 const complete=async()=>{
  if(!canEdit)return;
  setBusy(true);setError('');setMessage('');
  try{
   const remaining=pending.map(x=>x.note?`${x.item_label} — توضیح: ${x.note}`:x.item_label);
   const{error:e}=await supabase.rpc('advance_declaration_to_exit_stage',{p_declaration_id:declarationId,p_remaining_items:remaining});
   if(e)throw e;
   window.location.assign(`/operations?tab=exit&declarationId=${encodeURIComponent(declarationId)}`);
  }catch(e:any){setError(e?.message||'انتقال به مرحله درب خروج انجام نشد')}finally{setBusy(false)}
 };

 if(!declarationId)return <main dir="rtl" className="p-6"><div className="max-w-xl mx-auto rounded-2xl border app-border bg-[var(--surface)] p-6"><h1 className="font-black text-xl">اظهارنامه انتخاب نشده</h1><p className="text-sm app-muted mt-2">ابتدا اظهارنامه را ثبت کنید.</p><Link to={params.get('shipmentId')?`/operations?tab=declaration&shipmentId=${encodeURIComponent(params.get('shipmentId')||'')}`:'/operations'} className="inline-block mt-4 rounded-xl bg-[var(--primary)] text-white px-4 py-2">ثبت اظهار</Link></div></main>;

 return <main dir="rtl" className="min-h-screen p-4 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-5xl mx-auto space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><div className="text-xs app-muted">مرحله ۴</div><h1 className="text-2xl font-black mt-1">عملیات گمرکی</h1><p className="text-xs app-muted mt-1">چک‌لیست این اظهارنامه قابل تنظیم است و قواعد یادگیرنده بر اساس HS Code و مسیر پیشنهاد می‌شوند.</p></div>
   <Link to={`/operations?tab=declaration&shipmentId=${encodeURIComponent(decl?.shipment_id||'')}`} className="px-4 py-2 rounded-xl border app-border bg-[var(--surface)] text-sm"><ArrowLeft className="inline ml-1" size={15}/>بازگشت به ثبت اظهار</Link>
  </header>

  {error&&<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{error}</div>}
  {message&&<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}

  {decl&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5"><div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-sm">
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3"><span className="app-muted block">کوتاژ</span><div className="font-black mt-1 ltr-num">{decl.kottaj_number||'—'}</div></div>
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3"><span className="app-muted block">تاریخ اظهار</span><div className="font-bold mt-1">{new Date(decl.declaration_date).toLocaleDateString('fa-IR')}</div></div>
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3"><span className="app-muted block">HS Code</span><div className="font-black mt-1 ltr-num">{hs||'ثبت نشده'}</div></div>
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3"><span className="app-muted block">مسیر</span><div className="font-bold mt-1">{decl.customs_path?PATH_LABELS[decl.customs_path]||decl.customs_path:'—'}</div></div>
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3"><span className="app-muted block">وضعیت چک‌لیست</span><div className="font-black mt-1">{completed} از {items.length}</div></div>
  </div></section>}

  {rule&&<section className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-4 md:p-5">
   <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><BrainCircuit size={19}/><div><b className="font-black">پیشنهاد یادگیرنده برای این HS</b><div className="text-xs app-muted mt-1">قاعده: {rule.rule_name} · {rule.evidence_count} نمونه · اطمینان {Math.round(rule.confidence*100)}٪</div></div></div><Link to="/permit-rules" className="text-xs font-bold text-[var(--primary)]">مشاهده قواعد</Link></div>
   {suggestedItems.length>0&&<div className="mt-3"><div className="text-xs font-bold mb-2">مراحل/کارهایی که در نمونه‌های قبلی تکرار شده‌اند:</div><div className="flex flex-wrap gap-2">{suggestedItems.map(x=><span key={x} className="rounded-full border app-border bg-[var(--surface)] px-3 py-1.5 text-xs">{x}</span>)}</div></div>}
   {suggestedFields.length>0&&<div className="mt-3"><div className="text-xs font-bold mb-2">اطلاعاتی که معمولاً برای این HS لازم بوده:</div><div className="flex flex-wrap gap-2">{suggestedFields.map(x=><span key={x} className="rounded-full border app-border bg-[var(--surface)] px-3 py-1.5 text-xs">{x}</span>)}</div></div>}
  </section>}

  {rule&&rule.evidence_count<2&&<section className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm"><div className="flex gap-2"><Info size={17}/><div><b>این الگو هنوز در حال یادگیری است.</b><div className="text-xs mt-1 app-muted">این پرونده به‌عنوان نمونه ثبت می‌شود؛ پس از تکرار در پرونده مشابه، قاعده برای پیشنهاد خودکار فعال خواهد شد.</div></div></div></section>}

  <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden">
   <div className="p-5 border-b app-border flex flex-wrap items-center justify-between gap-3">
    <div><h2 className="font-black">چک‌لیست عملیات گمرکی</h2><div className="text-xs app-muted mt-1">سه مورد «در انتظار مبلغ ترخیصیه»، «پاس کشتی» و «اظهار» از این مرحله حذف شده‌اند.</div></div>
    <div className="flex items-center gap-2"><span className="text-xs app-muted">{completed} از {items.length} تکمیل</span>{canEdit&&<button type="button" onClick={()=>setAddOpen(v=>!v)} className="inline-flex items-center gap-1 rounded-xl bg-[var(--primary)] text-white px-3 py-2 text-xs font-bold"><Plus size={15}/> افزودن مورد</button>}</div>
   </div>

   {addOpen&&<div className="p-4 border-b app-border bg-[var(--surface-2)]"><div className="flex gap-2"><input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void addItem()}} placeholder="مثلاً: کنترل مجوز قرنطینه یا دریافت تأییدیه سهمیه" className="flex-1 rounded-xl border app-border bg-[var(--surface)] px-3 py-2.5 text-sm"/><button type="button" disabled={busy} onClick={()=>void addItem()} className="rounded-xl bg-[var(--primary)] text-white px-4 py-2.5 text-sm font-bold"><Save size={15} className="inline ml-1"/>ثبت</button></div><div className="text-[11px] app-muted mt-2">این مورد فقط به همین اظهارنامه اضافه می‌شود و بخشی از قواعد پایه سیستم را تغییر نمی‌دهد.</div></div>}

   {busy&&!items.length?<div className="py-12 text-center app-muted"><Loader2 className="animate-spin mx-auto"/></div>:items.length===0?<div className="p-8 text-center app-muted text-sm">هنوز مورد فعالی در این چک‌لیست نیست. یک مورد اضافه کنید.</div>:items.map((item,i)=>{
    const open=!!noteOpen[item.id];
    const note=draftNote[item.id]??item.note??'';
    return <div key={item.id} className="border-b app-border last:border-b-0">
      <div className="flex items-start gap-2 p-3 md:p-4">
       <button type="button" onClick={()=>void toggle(item)} disabled={!canEdit} className={`mt-0.5 w-7 h-7 rounded-lg border grid place-items-center shrink-0 ${item.completed?'bg-emerald-500 border-emerald-500 text-white':'app-border'} ${!canEdit?'opacity-70':''}`}>{item.completed&&<Check size={16}/>}</button>
       <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`text-sm font-semibold ${item.completed?'line-through opacity-70':''}`}>{i+1}. {item.item_label||item.item_key}</span>{item.source==='learned'&&<span className="rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-[10px] font-bold">یادگرفته‌شده</span>}{item.source==='manual'&&<span className="rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-bold">افزوده‌شده</span>}</div>{item.note&&<div className="mt-1 text-xs app-muted">توضیح: {item.note}</div>}</div>
       {canEdit&&<div className="flex items-center gap-1 shrink-0"><button type="button" onClick={()=>setNoteOpen(p=>({...p,[item.id]:!open}))} className="w-8 h-8 rounded-lg border app-border grid place-items-center" title="افزودن توضیح"><span className="font-black text-base">{open?'−':'+'}</span></button><button type="button" onClick={()=>void removeItem(item)} className="w-8 h-8 rounded-lg border app-border grid place-items-center text-red-500" title="حذف از این اظهارنامه"><Trash2 size={14}/></button></div>}
      </div>
      {open&&canEdit&&<div className="px-3 pb-4 md:px-14"><div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><div className="text-xs font-bold mb-2">توضیح / دلیل ناقص ماندن مورد</div><textarea value={note} onChange={e=>setDraftNote(p=>({...p,[item.id]:e.target.value}))} rows={2} placeholder="مثلاً: منتظر تأیید کارشناس یا دریافت نامه هستیم..." className="w-full rounded-xl border app-border bg-[var(--surface)] p-3 text-sm"/><button type="button" onClick={()=>void saveNote(item)} className="mt-2 rounded-xl bg-[var(--primary)] text-white px-3 py-2 text-xs font-bold"><Save size={14} className="inline ml-1"/>ذخیره توضیح</button></div></div>}
    </div>;
   })}
   <div className="p-5"><button disabled={busy||!canEdit} onClick={()=>void complete()} className="rounded-xl bg-[var(--primary)] text-white px-6 py-3 font-bold disabled:opacity-40">{busy?<><Loader2 className="inline ml-2 animate-spin" size={16}/>در حال انتقال...</>:pending.length===0?'تکمیل عملیات گمرکی و ورود به مرحله ۵ · درب خروج':'ورود به مرحله ۵ با ثبت هشدار موارد ناقص'}</button>{pending.length>0&&<div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs"><div className="font-bold mb-2 flex items-center gap-2"><AlertTriangle size={14}/> موارد ناقص قبل از خروج</div>{pending.map(x=><div key={x.id} className="py-1">{x.item_label}{x.note?` — ${x.note}`:''}</div>)}</div>}</div>
  </section>
 </div></main>;
};
