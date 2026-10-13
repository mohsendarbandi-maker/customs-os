import React,{useCallback,useEffect,useMemo,useState}from'react';
import{AlertTriangle,Check,Landmark,Plus,Pencil,RefreshCw,Save,Search,Trash2,X}from'lucide-react';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';

type Office={id:string;organization_id:string|null;code:string;name:string;city:string;is_active:boolean;created_at:string};
type OfficeForm={code:string;name:string;city:string;is_active:boolean};
const empty:OfficeForm={code:'',name:'',city:'',is_active:true};
const digits=(v:string)=>v.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const faDigits=(v:string|number)=>String(v).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export const CustomsOfficesPage:React.FC=()=>{
 const{profile}=useAuth();
 const canManage=profile?.role==='owner'||profile?.role==='admin';
 const[rows,setRows]=useState<Office[]>([]);
 const[form,setForm]=useState<OfficeForm>(empty);
 const[editing,setEditing]=useState<string|null>(null);
 const[query,setQuery]=useState('');
 const[busy,setBusy]=useState(false);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  if(!profile?.organization_id){setLoading(false);return}
  setLoading(true);setError('');
  try{
   const{data,error:e}=await supabase.from('customs_offices').select('id,organization_id,code,name,city,is_active,created_at').order('name',{ascending:true});
   if(e)throw e;
   setRows((data||[]) as Office[]);
  }catch(e:any){setError(e?.message||'دریافت فهرست گمرک‌ها انجام نشد')}
  finally{setLoading(false)}
 },[profile?.organization_id]);
 useEffect(()=>{void load()},[load]);
 const visible=useMemo(()=>rows.filter(r=>[r.code,r.name,r.city].some(x=>String(x||'').toLocaleLowerCase('fa').includes(query.trim().toLocaleLowerCase('fa')))),[rows,query]);
 const set=(k:keyof OfficeForm,v:string|boolean)=>setForm(p=>({...p,[k]:v}));
 const reset=()=>{setEditing(null);setForm(empty);setError('');setMessage('')};
 const edit=(r:Office)=>{setEditing(r.id);setForm({code:r.code,name:r.name,city:r.city,is_active:r.is_active});setError('');setMessage('')};
 const save=async()=>{
  if(!canManage)return;
  const code=digits(form.code).trim();
  const name=form.name.trim();
  const city=form.city.trim();
  if(!code||!name||!city){setError('کد گمرک، نام گمرک و شهر را تکمیل کنید.');return}
  if(rows.some(r=>r.id!==editing&&r.code.trim().toLowerCase()===code.toLowerCase())){setError('این کد گمرک قبلاً ثبت شده است.');return}
  if(!profile?.organization_id){setError('سازمان کاربر مشخص نیست.');return}
  setBusy(true);setError('');setMessage('');
  try{
   if(editing){
    const{error:e}=await supabase.from('customs_offices').update({code,name,city,is_active:form.is_active}).eq('id',editing).eq('organization_id',profile.organization_id);
    if(e)throw e;
    setMessage('اطلاعات گمرک به‌روزرسانی شد.');
   }else{
    const{error:e}=await supabase.from('customs_offices').insert({organization_id:profile.organization_id,code,name,city,is_active:form.is_active});
    if(e)throw e;
    setMessage('گمرک با موفقیت ثبت شد.');
   }
   reset();
   await load();
  }catch(e:any){
   const raw=String(e?.message||'');
   setError(/duplicate|unique/i.test(raw)?'کد گمرک تکراری است.':raw||'ذخیره گمرک انجام نشد.');
  }finally{setBusy(false)}
 };
 const remove=async(r:Office)=>{
  if(!canManage||r.organization_id!==profile?.organization_id)return;
  if(!window.confirm('گمرک «'+r.name+'» حذف شود؟ اگر به اظهارنامه یا پرونده متصل باشد، سامانه مانع حذف می‌شود.'))return;
  setBusy(true);setError('');setMessage('');
  try{
   const{error:e}=await supabase.from('customs_offices').delete().eq('id',r.id).eq('organization_id',profile.organization_id);
   if(e)throw e;
   setRows(p=>p.filter(x=>x.id!==r.id));if(editing===r.id)reset();setMessage('گمرک حذف شد.');
  }catch(e:any){setError(e?.message||'حذف گمرک ممکن نیست؛ احتمالاً به محموله، پرونده یا اظهارنامه متصل است.')}
  finally{setBusy(false)}
 };
 return <main dir="rtl" className="min-h-screen p-4 sm:p-6 lg:p-8" style={{background:'var(--bg)',color:'var(--text)'}}>
  <div className="max-w-6xl mx-auto space-y-5">
   <header className="flex flex-wrap items-center justify-between gap-3">
    <div><div className="text-xs font-bold text-[var(--primary)] mb-1">CUSTOMS DIRECTORY</div><h1 className="text-2xl font-black flex items-center gap-2"><Landmark size={25}/>گمرک‌ها</h1><p className="text-sm app-muted mt-2">فهرست مرجع گمرک‌ها؛ کد و نام انتخاب‌شده در اطلاعات محموله و اظهارنامه نمایش داده می‌شود.</p></div>
    <button type="button" onClick={()=>void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-4 py-2.5 text-sm font-bold"><RefreshCw size={15} className={loading?'animate-spin':''}/>بروزرسانی</button>
   </header>
   {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</div>}
   {message&&<div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{message}</div>}
   {canManage&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-5">
    <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="font-black">{editing?'ویرایش گمرک':'ثبت گمرک جدید'}</h2><p className="text-xs app-muted mt-1">کد گمرک را مطابق مرجع رسمی وارد کنید.</p></div>{editing&&<button type="button" onClick={reset} className="rounded-lg border app-border p-2" aria-label="لغو ویرایش"><X size={16}/></button>}</div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
     <label className="text-xs app-muted"><span className="block mb-1.5">کد گمرک *</span><input value={faDigits(form.code)} onChange={e=>set('code',digits(e.target.value))} autoComplete="off" inputMode="numeric" placeholder="مثلاً کد رسمی گمرک" className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm" /></label>
     <label className="text-xs app-muted sm:col-span-1 lg:col-span-1"><span className="block mb-1.5">نام گمرک *</span><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="مثلاً گمرک شهید رجایی" className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm" /></label>
     <label className="text-xs app-muted"><span className="block mb-1.5">شهر *</span><input value={form.city} onChange={e=>set('city',e.target.value)} placeholder="مثلاً بندرعباس" className="w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm" /></label>
     <label className="flex items-center gap-2 self-end rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm"><input type="checkbox" checked={form.is_active} onChange={e=>set('is_active',e.target.checked)} className="h-4 w-4 accent-[var(--primary)]"/><span>فعال و قابل انتخاب باشد</span></label>
    </div>
    <div className="flex flex-wrap gap-2 mt-4"><button type="button" onClick={()=>void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white disabled:opacity-50"><Save size={16}/>{busy?'در حال ذخیره…':editing?'ذخیره تغییرات':'ثبت گمرک'}</button><button type="button" onClick={reset} disabled={busy} className="rounded-xl border app-border px-5 py-3 text-sm font-bold">پاک‌کردن فرم</button></div>
   </section>}
   <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden">
    <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b app-border"><div><h2 className="font-black">فهرست گمرک‌ها</h2><p className="text-xs app-muted mt-1">{faDigits(visible.length)} مورد · انتخاب گمرک هنگام تکمیل اطلاعات قبل اظهار</p></div><label className="relative w-full sm:max-w-xs"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 app-muted"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجوی نام، کد یا شهر" className="w-full rounded-xl border app-border bg-[var(--surface-2)] py-2.5 pr-9 pl-3 text-sm"/></label></div>
    {loading?<div className="py-12 text-center app-muted">در حال دریافت فهرست…</div>:visible.length===0?<div className="p-10 text-center"><Landmark size={30} className="mx-auto app-muted"/><p className="font-bold mt-3">{query?'موردی مطابق جست‌وجو پیدا نشد.':'هنوز گمرکی ثبت نشده است.'}</p><p className="text-xs app-muted mt-1">پس از ثبت گمرک، کد و نام آن در مراحل مربوط به محموله و اظهارنامه قابل انتخاب خواهد بود.</p></div>:<div className="divide-y app-border">{visible.map(r=><div key={r.id} className="p-4 sm:px-5 flex flex-wrap items-center gap-3">
     <div className="h-11 w-11 rounded-xl bg-[var(--surface-2)] grid place-items-center shrink-0"><Landmark size={19}/></div>
     <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{r.name}</b><span className="rounded-md border app-border px-2 py-0.5 text-xs font-bold" dir="ltr">{faDigits(r.code)}</span><span className={'rounded-full px-2 py-1 text-[10px] font-bold '+(r.is_active?'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':'bg-slate-500/10 app-muted')}>{r.is_active?'فعال':'غیرفعال'}</span></div><div className="text-xs app-muted mt-1">{r.city}</div></div>
     {canManage&&r.organization_id===profile?.organization_id&&<div className="flex items-center gap-1"><button type="button" disabled={busy} onClick={()=>edit(r)} className="rounded-lg border app-border p-2" aria-label={'ویرایش '+r.name} title="ویرایش"><Pencil size={15}/></button><button type="button" disabled={busy} onClick={()=>void remove(r)} className="rounded-lg border app-border p-2 text-red-500" aria-label={'حذف '+r.name} title="حذف"><Trash2 size={15}/></button></div>}
    </div>)}</div>}
   </section>
   {!canManage&&<p className="text-xs app-muted">فهرست برای مشاهده در دسترس است؛ ثبت و ویرایش گمرک فقط توسط مالک یا مدیر سازمان انجام می‌شود.</p>}
   <div className="flex items-start gap-2 text-xs app-muted"><AlertTriangle size={15} className="mt-0.5 shrink-0"/><p>کدها در این بخش دستی ثبت می‌شوند؛ پیش از استفاده عملیاتی، صحت کد هر گمرک را با مرجع رسمی خودتان تطبیق دهید.</p></div>
  </div>
 </main>
};
