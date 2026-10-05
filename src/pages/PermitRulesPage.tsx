import React,{useEffect,useState}from'react';
import{ArrowRight,BrainCircuit,Loader2,Plus,Save,ShieldCheck,Trash2}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';

type Rule={id?:string;rule_name:string;hs_prefix:string;cargo_keyword:string;permit_type:string;issuing_authority:string;required:boolean;priority:string;note:string;is_active:boolean};
type OperationRule={id:string;rule_name:string;hs_code_prefix:string;customs_path:string;transport_mode:string;checklist_counts:Record<string,number>;field_counts:Record<string,number>;workflow_stages:number[];evidence_count:number;confidence:number;source:string;is_active:boolean};
const empty:Rule={rule_name:'',hs_prefix:'',cargo_keyword:'',permit_type:'',issuing_authority:'',required:true,priority:'100',note:'',is_active:true};

export const PermitRulesPage:React.FC=()=>{
 const[rules,setRules]=useState<Rule[]>([]);
 const[operationRules,setOperationRules]=useState<OperationRule[]>([]);
 const[form,setForm]=useState<Rule>(empty);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState('');

 const load=async()=>{
  setBusy(true);setMessage('');
  try{
   const[{data:permitRules,error:pe},{data:learnedRules,error:oe}]=await Promise.all([
    supabase.from('permit_rules').select('id,rule_name,hs_prefix,cargo_keyword,permit_type,issuing_authority,required,priority,note,is_active').order('priority').order('rule_name'),
    supabase.from('customs_operation_rules').select('id,rule_name,hs_code_prefix,customs_path,transport_mode,checklist_counts,field_counts,workflow_stages,evidence_count,confidence,source,is_active').order('evidence_count',{ascending:false}).order('hs_code_prefix')
   ]);
   if(pe)throw pe;if(oe)throw oe;
   setRules((permitRules||[]) as Rule[]);setOperationRules((learnedRules||[]) as OperationRule[]);
  }catch(e:any){setMessage(e?.message||'دریافت قواعد انجام نشد')}finally{setBusy(false)}
 };

 useEffect(()=>{void load()},[]);

 const save=async()=>{
  if(!form.rule_name.trim()||(!form.hs_prefix.trim()&&!form.cargo_keyword.trim())||!form.permit_type.trim()||!form.issuing_authority.trim()){
   setMessage('نام قاعده، HS یا کلیدواژه، نوع مجوز و مرجع صادرکننده الزامی است.');return;
  }
  setBusy(true);setMessage('');
  try{
   const payload={rule_name:form.rule_name.trim(),hs_prefix:form.hs_prefix.trim()||null,cargo_keyword:form.cargo_keyword.trim()||null,permit_type:form.permit_type.trim(),issuing_authority:form.issuing_authority.trim(),required:form.required,priority:Number(form.priority)||100,note:form.note.trim()||null,is_active:form.is_active};
   const{error}=form.id?await supabase.from('permit_rules').update(payload).eq('id',form.id):await supabase.from('permit_rules').insert(payload);
   if(error)throw error;
   setForm(empty);setMessage(form.id?'قاعده مجوز ویرایش شد.':'قاعده مجوز ثبت شد.');await load();
  }catch(e:any){setMessage(e?.message||'خطا در ذخیره قاعده')}finally{setBusy(false)}
 };

 const edit=(r:Rule)=>setForm({...r,priority:String(r.priority)});
 const remove=async(id:string)=>{
  if(!window.confirm('این قاعده حذف شود؟'))return;
  setBusy(true);
  try{const{error}=await supabase.from('permit_rules').delete().eq('id',id);if(error)throw error;setMessage('قاعده حذف شد.');await load()}catch(e:any){setMessage(e?.message||'حذف انجام نشد')}finally{setBusy(false)}
 };
 const toggleLearned=async(r:OperationRule)=>{
  setBusy(true);setMessage('');
  try{const{error}=await supabase.from('customs_operation_rules').update({is_active:!r.is_active,updated_at:new Date().toISOString()}).eq('id',r.id);if(error)throw error;setMessage(r.is_active?'قاعده یادگرفته‌شده غیرفعال شد.':'قاعده یادگرفته‌شده فعال شد.');await load()}catch(e:any){setMessage(e?.message||'تغییر وضعیت قاعده انجام نشد')}finally{setBusy(false)}
 };

 return <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-5 md:p-8" dir="rtl"><div className="max-w-7xl mx-auto space-y-6">
  <header className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-black">قواعد گمرکی و یادگیری عملیات</h1><p className="text-sm app-muted mt-2">قواعد مجوز دستی در کنار قواعد عملیاتی که Customs OS از پرونده‌های واقعی یاد می‌گیرد.</p></div><Link to="/operations" className="px-4 py-2 rounded-xl border app-border bg-[var(--surface)]"><ArrowRight className="inline ml-2" size={16}/> عملیات</Link></header>
  {message&&<div className="p-3 rounded-xl bg-[var(--surface)] border app-border text-sm">{message}</div>}

  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-4"><ShieldCheck size={19}/><div><h2 className="font-black">قواعد مجوز</h2><p className="text-xs app-muted mt-1">موتور فعلی پیشنهاد مجوز بر اساس HS و شرح کالا.</p></div></div>
   <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">{[['rule_name','نام قاعده'],['hs_prefix','پیشوند HS'],['cargo_keyword','کلیدواژه شرح کالا'],['permit_type','نوع مجوز'],['issuing_authority','مرجع صادرکننده'],['priority','اولویت'],['note','یادداشت']].map(([k,l])=><label key={k} className="text-xs app-muted">{l}<input value={(form as any)[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className="mt-1 w-full bg-[var(--surface-2)] border app-border rounded-xl px-3 py-2.5" dir={['hs_prefix','priority'].includes(k)?'ltr':'rtl'}/></label>)}<label className="text-xs app-muted flex items-center gap-2 pt-6"><input type="checkbox" checked={form.required} onChange={e=>setForm(p=>({...p,required:e.target.checked}))}/> مجوز لازم است</label><label className="text-xs app-muted flex items-center gap-2 pt-6"><input type="checkbox" checked={form.is_active} onChange={e=>setForm(p=>({...p,is_active:e.target.checked}))}/> فعال</label></div>
   <div className="mt-4 flex gap-2"><button onClick={()=>void save()} disabled={busy} className="px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold">{busy?<Loader2 className="inline ml-2 animate-spin" size={16}/>:form.id?<Save className="inline ml-2" size={16}/>:<Plus className="inline ml-2" size={16}/>} {form.id?'ذخیره تغییرات':'افزودن قاعده'}</button>{form.id&&<button onClick={()=>setForm(empty)} className="px-5 py-3 rounded-xl border app-border">لغو</button>}</div>
  </section>

  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div className="flex items-center gap-2"><BrainCircuit size={19}/><div><h2 className="font-black">قواعد یادگرفته‌شده عملیات گمرکی</h2><p className="text-xs app-muted mt-1">پس از حداقل ۲ نمونه مشابه فعال می‌شوند و برای پرونده بعدی پیشنهاد خودکار می‌سازند.</p></div><span className="rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 px-2.5 py-1 text-xs font-bold">{operationRules.length} قاعده</span></div><button type="button" onClick={()=>void load()} disabled={busy} className="icon-btn" title="بروزرسانی"><Loader2 className={busy?'animate-spin':''} size={16}/></button></div>
   {operationRules.length===0?<div className="py-10 text-center app-muted text-sm">هنوز هیچ الگوی یادگرفته‌شده‌ای ثبت نشده است. با تکمیل یا عبور عملیاتی از یک اظهارنامه، نمونه یادگیری ثبت می‌شود.</div>:<div className="space-y-3">{operationRules.map(r=>{
      const topChecklist=Object.entries(r.checklist_counts||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,12);
      const topFields=Object.entries(r.field_counts||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,10);
      return <article key={r.id} className="rounded-2xl border app-border bg-[var(--surface-2)] p-4">
       <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><b>HS {r.hs_code_prefix}</b><span className="text-xs app-muted">{r.customs_path?({green:'سبز',yellow:'زرد',red:'قرمز'} as Record<string,string>)[r.customs_path]||r.customs_path:'همه مسیرها'} · {r.transport_mode||'sea'}</span>{r.is_active?<span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold">فعال</span>:<span className="rounded-full bg-slate-500/10 app-muted px-2 py-0.5 text-[10px] font-bold">غیرفعال</span>}</div><div className="text-xs app-muted mt-1">{r.evidence_count} نمونه · اطمینان {Math.round(r.confidence*100)}٪ · {r.source==='learned'?'یادگیری خودکار':'دستی'}</div></div><button type="button" disabled={busy} onClick={()=>void toggleLearned(r)} className="px-3 py-2 rounded-xl border app-border text-xs font-bold">{r.is_active?'غیرفعال کردن':'فعال کردن'}</button></div>
       {topChecklist.length>0&&<div className="mt-3"><div className="text-xs font-bold mb-2">کارهای پرتکرار</div><div className="flex flex-wrap gap-2">{topChecklist.map(([label,count])=><span key={label} className="rounded-full border app-border bg-[var(--surface)] px-3 py-1.5 text-xs">{label}<span className="app-muted"> · {count}/{r.evidence_count}</span></span>)}</div></div>}
       {topFields.length>0&&<div className="mt-3"><div className="text-xs font-bold mb-2">اطلاعات پرتکرار</div><div className="flex flex-wrap gap-2">{topFields.map(([key,count])=><span key={key} className="rounded-full border app-border bg-[var(--surface)] px-3 py-1.5 text-xs">{key}<span className="app-muted"> · {count}/{r.evidence_count}</span></span>)}</div></div>}
      </article>
    })}</div>}
  </section>

  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-xs app-muted border-b app-border"><th className="p-2">قاعده</th><th>HS</th><th>کلیدواژه</th><th>مجوز</th><th>مرجع</th><th>اولویت</th><th>فعال</th><th></th></tr></thead><tbody>{rules.length===0?<tr><td colSpan={8} className="p-5 text-center app-muted">قاعده‌ای ثبت نشده.</td></tr>:rules.map(r=><tr key={r.id} className="border-b app-border"><td className="p-2 font-bold">{r.rule_name}</td><td dir="ltr">{r.hs_prefix||'—'}</td><td>{r.cargo_keyword||'—'}</td><td>{r.permit_type}</td><td>{r.issuing_authority}</td><td dir="ltr">{r.priority}</td><td>{r.is_active?'بله':'خیر'}</td><td className="flex gap-3 p-2"><button onClick={()=>edit(r)} className="text-[var(--primary)]">ویرایش</button><button onClick={()=>void remove(r.id!)} className="text-red-500"><Trash2 size={16}/></button></td></tr>)}</tbody></table></div></section>
 </div></main>;
};
