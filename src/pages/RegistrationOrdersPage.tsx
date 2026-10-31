import React,{useEffect,useMemo,useState}from'react';
import{CheckCircle2,FileText,Lock,Unlock,Plus,RefreshCw,Save}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{buildExternalRegistrationOrderAllocationPayload,calculateRegistrationOrderCapacity}from'../lib/registrationOrderAllocations';
import{useAuth}from'../context/AuthContext';

type Client={id:string;name:string};
type RegistrationOrder={
 id:string;organization_id:string;case_id:string|null;client_id:string|null;order_number:string;order_date:string|null;
 status:string;tariff_code:string|null;quantity:number|null;quantity_unit:string|null;value_amount:number|null;currency:string|null;
 notes:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;bank_name:string|null;bank_branch:string|null;
 bank_branch_code:string|null;payment_instrument_code:string|null;is_closed:boolean;closed_at:string|null;
};
type CaseLegacy={id:string;registration_order_no:string|null;net_weight_kg:number|null;gross_weight_kg:number|null};
type Reconciliation={
 registration_order_id:string;order_number:string;shipment_count:number;registered_net_weight_kg:number|null;
 shipped_net_weight_kg:number;registered_gross_weight_kg:number|null;shipped_gross_weight_kg:number;
 registered_value_amount:number|null;shipped_value_amount:number;currency:string|null;shipments_missing_invoice_value:number;
 shipments_with_currency_mismatch:number;is_closed:boolean;external_allocation_count:number;
 external_allocated_net_weight_kg:number;external_allocated_gross_weight_kg:number;external_allocated_value_amount:number;
 external_allocations_missing_value:number;external_allocations_currency_mismatch:number;
 total_allocated_net_weight_kg:number;total_allocated_gross_weight_kg:number;total_allocated_value_amount:number;total_allocation_count:number;
};
type ExternalAllocation={
 id:string;organization_id:string;registration_order_id:string;recipient_company:string|null;destination_customs:string|null;
 allocation_reference:string|null;status:'allocated'|'dispatched'|'completed'|'cancelled';net_weight_kg:number;gross_weight_kg:number|null;
 value_amount:number;currency:string;notes:string|null;created_at:string;updated_at:string;
};
type ExternalAllocationForm=Record<string,string>;
const blankExternalAllocation:ExternalAllocationForm={
 recipient_company:'',destination_customs:'',allocation_reference:'',net_weight_kg:'',gross_weight_kg:'',
 value_amount:'',currency:'USD',status:'allocated',notes:''
};
const externalAllocationStatuses=[['allocated','اختصاص‌یافته'],['dispatched','ارسال‌شده'],['completed','تحویل / ترخیص‌شده'],['cancelled','لغوشده']];

type Form=Record<string,string>;
const blank:Form={order_number:'',client_id:'',order_date:'',status:'received',tariff_code:'',quantity:'',quantity_unit:'',net_weight_kg:'',gross_weight_kg:'',value_amount:'',currency:'IRR',bank_name:'',bank_branch:'',bank_branch_code:'',payment_instrument_code:'',notes:''};
const digits=(value:string)=>String(value||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const number=(value:string)=>{const raw=digits(value).replace(/[٬,\s]/g,'');if(!raw)return null;const parsed=Number(raw);return Number.isFinite(parsed)?parsed:null};
const fa=(value:number|string|null|undefined)=>value==null?'—':new Intl.NumberFormat('fa-IR',{maximumFractionDigits:3}).format(Number(value));
const currencies=[['IRR','ریال'],['USD','دلار آمریکا'],['EUR','یورو'],['AED','درهم'],['CNY','یوان'],['RUB','روبل'],['GBP','پوند'],['CHF','فرانک سوئیس'],['TRY','لیر ترکیه']];
const statuses=[['pending','در انتظار'],['received','دریافت شده'],['verified','تأیید شده'],['used','استفاده شده'],['cancelled','لغو شده']];
const inputClass='w-full rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm';
export const RegistrationOrdersPage:React.FC=()=>{
 const{profile}=useAuth();
 const[orders,setOrders]=useState<RegistrationOrder[]>([]);
 const[clients,setClients]=useState<Client[]>([]);
 const[cases,setCases]=useState<CaseLegacy[]>([]);
 const[reconciliation,setReconciliation]=useState<Reconciliation[]>([]);
 const[externalAllocations,setExternalAllocations]=useState<ExternalAllocation[]>([]);
 const[allocationForm,setAllocationForm]=useState<ExternalAllocationForm>({...blankExternalAllocation});
 const[allocationEditingId,setAllocationEditingId]=useState('');
 const[allocationBusy,setAllocationBusy]=useState(false);
 const[allocationError,setAllocationError]=useState('');
 const[selected,setSelected]=useState('');
 const[form,setForm]=useState<Form>({...blank});
 const[editing,setEditing]=useState(false);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState('');
 const[error,setError]=useState('');
 const set=(key:string,value:string)=>setForm(prev=>({...prev,[key]:value}));
 const load=async()=>{
  if(!profile?.organization_id)return;
  setBusy(true);setError('');
  try{
   const[{data:o,error:oe},{data:c,error:ce},{data:legacy,error:le},{data:r,error:re}]=await Promise.all([
    supabase.from('registration_orders').select('id,organization_id,case_id,client_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,notes,net_weight_kg,gross_weight_kg,bank_name,bank_branch,bank_branch_code,payment_instrument_code,is_closed,closed_at').eq('organization_id',profile.organization_id).order('created_at',{ascending:false}),
    supabase.from('clients').select('id,name').eq('organization_id',profile.organization_id).order('name'),
    supabase.from('cases').select('id,registration_order_no,net_weight_kg,gross_weight_kg').eq('organization_id',profile.organization_id),
    supabase.from('registration_order_reconciliation').select('*').eq('organization_id',profile.organization_id)
   ]);
   if(oe||ce||le||re)throw oe||ce||le||re;
   setOrders((o||[]) as RegistrationOrder[]);setClients((c||[]) as Client[]);setCases((legacy||[]) as CaseLegacy[]);setReconciliation((r||[]) as Reconciliation[]);
   const selectedOrder=(o||[]).find(x=>x.id===selected);
   if(selectedOrder&&!editing)selectOrder(selectedOrder,(legacy||[]) as CaseLegacy[]);
   if(!selectedOrder&&!selected&&o?.length&&!editing){selectOrder(o[0] as RegistrationOrder,(legacy||[]) as CaseLegacy[])}
  }catch(e:any){setError(e?.message||'بارگذاری ثبت سفارش‌ها ناموفق بود')}
  finally{setBusy(false)}
 };
 const loadExternalAllocations=async()=>{
  if(!selected||!profile?.organization_id){setExternalAllocations([]);return}
  const{data,error:e}=await supabase.from('registration_order_external_allocations')
   .select('id,organization_id,registration_order_id,recipient_company,destination_customs,allocation_reference,status,net_weight_kg,gross_weight_kg,value_amount,currency,notes,created_at,updated_at')
   .eq('organization_id',profile.organization_id).eq('registration_order_id',selected).order('created_at',{ascending:false});
  if(e){setAllocationError(e.message||'بارگذاری سهم‌های واگذارشده ناموفق بود');return}
  setExternalAllocations((data||[]) as ExternalAllocation[]);
 };
 useEffect(()=>{void loadExternalAllocations();setAllocationForm({...blankExternalAllocation,currency:current?.currency||'USD'});setAllocationEditingId('');setAllocationError('')},[selected,profile?.organization_id]);
 const caseFor=(order:RegistrationOrder,allCases=cases)=>allCases.find(c=>c.id===order.case_id)||allCases.find(c=>c.registration_order_no===order.order_number);
 const selectOrder=(order:RegistrationOrder,allCases=cases)=>{
  const legacy=caseFor(order,allCases);
  setSelected(order.id);setEditing(false);
  setForm({
   order_number:order.order_number||'',client_id:order.client_id||'',order_date:order.order_date||'',status:order.status||'received',
   tariff_code:order.tariff_code||'',quantity:order.quantity==null?'':String(order.quantity),quantity_unit:order.quantity_unit||'',
   net_weight_kg:String(order.net_weight_kg??legacy?.net_weight_kg??''),gross_weight_kg:String(order.gross_weight_kg??legacy?.gross_weight_kg??''),
   value_amount:order.value_amount==null?'':String(order.value_amount),currency:order.currency||'IRR',
   bank_name:order.bank_name||'',bank_branch:order.bank_branch||'',bank_branch_code:order.bank_branch_code||'',
   payment_instrument_code:order.payment_instrument_code||'',notes:order.notes||''
  });
  setMessage('ثبت سفارش انتخاب شد.');
 };
 useEffect(()=>{void load()},[profile?.organization_id]);
 const current=useMemo(()=>orders.find(o=>o.id===selected)||null,[orders,selected]);
 const currentReconciliation=reconciliation.find(r=>r.registration_order_id===selected);
 const clientName=(id:string|null)=>clients.find(c=>c.id===id)?.name||'—';
 const beginNew=()=>{setSelected('');setForm({...blank});setEditing(true);setMessage('ثبت سفارش جدید آماده ورود اطلاعات است.');setError('')};
 const save=async()=>{
  if(!profile?.organization_id)return setError('سازمان کاربر مشخص نیست.');
  if(!form.order_number.trim())return setError('شماره ثبت سفارش الزامی است.');
  if(!form.client_id)return setError('صاحب کالا را انتخاب کنید.');
  const expectedNet=number(form.net_weight_kg),expectedGross=number(form.gross_weight_kg),value=number(form.value_amount);
  if(expectedNet!==null&&expectedNet<0||expectedGross!==null&&expectedGross<0||value!==null&&value<0)return setError('وزن و ارزش نمی‌توانند منفی باشند.');
  setBusy(true);setError('');setMessage('');
  try{
   const payload={organization_id:profile.organization_id,client_id:form.client_id,order_number:form.order_number.trim(),order_date:form.order_date||null,status:form.status,tariff_code:form.tariff_code.trim()||null,quantity:number(form.quantity),quantity_unit:form.quantity_unit.trim()||null,net_weight_kg:expectedNet,gross_weight_kg:expectedGross,value_amount:value,currency:value===null?null:form.currency,bank_name:form.bank_name.trim()||null,bank_branch:form.bank_branch.trim()||null,bank_branch_code:form.bank_branch_code.trim()||null,payment_instrument_code:form.payment_instrument_code.trim()||null,notes:form.notes.trim()||null};
   if(selected){
    const{error:e}=await supabase.from('registration_orders').update(payload).eq('id',selected).eq('organization_id',profile.organization_id);
    if(e)throw e;
   }else{
    const{data,error:e}=await supabase.from('registration_orders').insert(payload).select('id').single();
    if(e)throw e;
    setSelected(data.id);
   }
   setEditing(false);setMessage('اطلاعات ثبت سفارش ذخیره شد. مشخصات بانکی و ابزار پرداخت از این پس برای تمام محموله‌های متصل به همین ثبت سفارش مشترک خواهد بود.');
   await load();
  }catch(e:any){setError(e?.message||'ذخیره ثبت سفارش انجام نشد')}
  finally{setBusy(false)}
 };
 const finalize=async(closed:boolean)=>{
  if(!current)return;
  setBusy(true);setError('');setMessage('');
  try{
   const{error:e}=await supabase.from('registration_orders').update({is_closed:closed,...(closed?{status:'used'}:{})}).eq('id',current.id).eq('organization_id',profile?.organization_id);
   if(e)throw e;
   setMessage(closed?'ثبت سفارش نهایی شد؛ افزودن یا تغییر محموله برای این ثبت سفارش قفل شد.':'ثبت سفارش باز شد و امکان اتصال یا اصلاح محموله‌ها دوباره فعال است.');
   await load();
  }catch(e:any){setError(e?.message||'نهایی‌سازی ثبت سفارش انجام نشد')}
  finally{setBusy(false)}
 };
 const canManageExternalAllocations=['owner','admin','broker'].includes(String(profile?.role||''));
 const resetExternalAllocation=()=>{
  setAllocationForm({...blankExternalAllocation,currency:current?.currency||'USD'});
  setAllocationEditingId('');
  setAllocationError('');
 };
 const editExternalAllocation=(allocation:ExternalAllocation)=>{
  setAllocationEditingId(allocation.id);
  setAllocationForm({
   recipient_company:allocation.recipient_company||'',
   destination_customs:allocation.destination_customs||'',
   allocation_reference:allocation.allocation_reference||'',
   net_weight_kg:String(allocation.net_weight_kg),
   gross_weight_kg:allocation.gross_weight_kg==null?'':String(allocation.gross_weight_kg),
   value_amount:String(allocation.value_amount),
   currency:allocation.currency,
   status:allocation.status,
   notes:allocation.notes||''
  });
  setAllocationError('');
 };
 const saveExternalAllocation=async()=>{
  if(!current||!profile?.organization_id)return setAllocationError('ابتدا یک ثبت سفارش را انتخاب کنید.');
  if(current.is_closed)return setAllocationError('ثبت سفارش نهایی شده است و تغییر سهم‌های آن مجاز نیست.');
  if(current.net_weight_kg==null||current.value_amount==null||!current.currency)return setAllocationError('ابتدا سقف وزن خالص، ارزش کل و ارز ثبت سفارش مادر را تکمیل کنید تا کنترل عدم تجاوز فعال باشد.');
  if(current.gross_weight_kg!=null&&!allocationForm.gross_weight_kg.trim())return setAllocationError('وزن ناخالص در ثبت سفارش مادر مشخص است؛ وزن ناخالص سهم بیرونی را هم وارد کنید.');
  const validation=buildExternalRegistrationOrderAllocationPayload(allocationForm,current.currency);
  if(!validation.ok)return setAllocationError(validation.error);
  setAllocationBusy(true);setAllocationError('');setError('');setMessage('');
  try{
   const payload={
    ...validation.payload,
    organization_id:profile.organization_id,
    registration_order_id:current.id
   };
   if(allocationEditingId){
    const{data,error:e}=await supabase.from('registration_order_external_allocations').update(payload)
     .eq('id',allocationEditingId).eq('organization_id',profile.organization_id).select('id').maybeSingle();
    if(e)throw e;
    if(!data?.id)throw new Error('سهم واگذارشده به‌روزرسانی نشد؛ دسترسی یا وضعیت ثبت سفارش را بررسی کنید.');
    setMessage(validation.payload.status==='cancelled'?'سهم واگذارشده لغو شد و ظرفیت آن آزاد شد.':'سهم واگذارشده به‌روزرسانی شد؛ سقف وزن و ارزش دوباره کنترل شد.');
   }else{
    const{data,error:e}=await supabase.from('registration_order_external_allocations').insert(payload).select('id').single();
    if(e)throw e;
    if(!data?.id)throw new Error('سهم واگذارشده ثبت نشد.');
    setMessage('سهم خارج از دسترس ثبت شد و وزن و ارزش آن از مانده ثبت سفارش کسر شد.');
   }
   resetExternalAllocation();
   await Promise.all([loadExternalAllocations(),load()]);
  }catch(e:any){setAllocationError(e?.message||'ذخیره سهم واگذارشده ناموفق بود')}
  finally{setAllocationBusy(false)}
 };
 const cancelExternalAllocation=async(allocation:ExternalAllocation)=>{
  if(!current||current.is_closed)return setAllocationError('ابتدا ثبت سفارش را باز کنید.');
  setAllocationBusy(true);setAllocationError('');
  try{
   const{data,error:e}=await supabase.from('registration_order_external_allocations')
    .update({status:'cancelled'}).eq('id',allocation.id).eq('organization_id',profile?.organization_id).select('id').maybeSingle();
   if(e)throw e;
   if(!data?.id)throw new Error('لغو سهم تأیید نشد.');
   setMessage('سهم واگذارشده لغو شد؛ وزن و ارزش آن دوباره به مانده قابل تخصیص برگشت.');
   await Promise.all([loadExternalAllocations(),load()]);
  }catch(e:any){setAllocationError(e?.message||'لغو سهم واگذارشده ناموفق بود')}
  finally{setAllocationBusy(false)}
 };
 const reconciliationFor=(order:RegistrationOrder)=>{
  const r=reconciliation.find(x=>x.registration_order_id===order.id);
  const legacy=caseFor(order);
  return {
   ...r,registered_net_weight_kg:order.net_weight_kg??legacy?.net_weight_kg??null,
   registered_gross_weight_kg:order.gross_weight_kg??legacy?.gross_weight_kg??null,
   registered_value_amount:order.value_amount,currency:order.currency
  } as Reconciliation;
 };
 return <main dir="rtl" className="min-h-screen p-4 sm:p-6 lg:p-8" style={{background:'var(--bg)',color:'var(--text)'}}>
  <div className="mx-auto max-w-7xl space-y-5">
   <header className="flex flex-wrap items-center justify-between gap-3">
    <div><div className="text-xs app-muted">مدیریت اطلاعات پایه واردات</div><h1 className="mt-1 text-2xl font-black">مدیریت ثبت سفارش‌ها</h1><p className="mt-1 text-sm app-muted">هر ثبت سفارش یک مشخصات بانکی و یک ابزار پرداخت مشترک دارد و می‌تواند چند محموله داشته باشد.</p></div>
    <div className="flex gap-2"><button onClick={()=>void load()} disabled={busy} className="rounded-xl border app-border px-3 py-2.5"><RefreshCw size={17}/></button><button onClick={beginNew} className="rounded-xl bg-[var(--primary)] px-4 py-2.5 font-bold text-white"><Plus size={16} className="inline ml-1"/>ثبت سفارش جدید</button></div>
   </header>
   {error&&<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
   {message&&<div className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{message}</div>}
   <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
    <section className="rounded-2xl border app-border bg-[var(--surface)] p-4">
     <div className="mb-3 flex items-center justify-between"><b>فهرست ثبت سفارش‌ها</b><span className="text-xs app-muted">{fa(orders.length)} مورد</span></div>
     <div className="space-y-2">{orders.map(order=><button key={order.id} type="button" onClick={()=>selectOrder(order)} className={'w-full rounded-xl border p-3 text-right '+(selected===order.id?'border-[var(--primary)] bg-[var(--surface-2)]':'app-border')}>
      <div className="flex items-center justify-between gap-2"><b dir="ltr">{order.order_number}</b>{order.is_closed?<span className="text-[10px] text-emerald-600">نهایی شده</span>:<span className="text-[10px] app-muted">باز</span>}</div>
      <div className="mt-1 text-xs app-muted">{clientName(order.client_id)} · {statuses.find(x=>x[0]===order.status)?.[1]||order.status}</div>
      <div className="mt-2 text-[11px] app-muted">{fa(reconciliation.find(r=>r.registration_order_id===order.id)?.shipment_count||0)} محموله متصل</div>
     </button>)}{!orders.length&&<div className="rounded-xl border border-dashed app-border p-6 text-center text-sm app-muted">هنوز ثبت سفارشی تعریف نشده است.</div>}</div>
    </section>
    <section className="space-y-4">
     {editing?<section className="rounded-2xl border app-border bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-black">{selected?'ویرایش ثبت سفارش':'ثبت سفارش جدید'}</h2><button onClick={()=>{setEditing(false);if(current)selectOrder(current)}} className="text-sm app-muted">انصراف</button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
       <label className="text-xs app-muted">شماره ثبت سفارش *<input dir="ltr" value={form.order_number} onChange={e=>set('order_number',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">صاحب کالا *<select value={form.client_id} onChange={e=>set('client_id',e.target.value)} className={inputClass}><option value="">انتخاب صاحب کالا</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
       <label className="text-xs app-muted">تاریخ ثبت سفارش<input type="date" value={form.order_date} onChange={e=>set('order_date',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">وضعیت<select value={form.status} onChange={e=>set('status',e.target.value)} className={inputClass}>{statuses.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
       <label className="text-xs app-muted">کد تعرفه<input dir="ltr" value={form.tariff_code} onChange={e=>set('tariff_code',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">تعداد مجاز<input inputMode="decimal" value={form.quantity} onChange={e=>set('quantity',digits(e.target.value))} className={inputClass}/></label>
       <label className="text-xs app-muted">واحد تعداد<input value={form.quantity_unit} onChange={e=>set('quantity_unit',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">وزن خالص مجاز (kg)<input inputMode="decimal" value={form.net_weight_kg} onChange={e=>set('net_weight_kg',digits(e.target.value))} className={inputClass}/></label>
       <label className="text-xs app-muted">وزن ناخالص مجاز (kg)<input inputMode="decimal" value={form.gross_weight_kg} onChange={e=>set('gross_weight_kg',digits(e.target.value))} className={inputClass}/></label>
       <label className="text-xs app-muted">ارزش کل ثبت سفارش<input inputMode="decimal" value={form.value_amount} onChange={e=>set('value_amount',digits(e.target.value))} className={inputClass}/></label>
       <label className="text-xs app-muted">ارز<select value={form.currency} onChange={e=>set('currency',e.target.value)} className={inputClass}>{currencies.map(([v,l])=><option key={v} value={v}>{v} · {l}</option>)}</select></label>
      </div>
      <div className="my-5 border-t app-border"/>
      <div className="mb-3"><h3 className="font-black">مشخصات بانکی مشترک</h3><p className="mt-1 text-xs app-muted">این مشخصات فقط در همین ثبت سفارش نگهداری می‌شود و برای همه محموله‌های متصل یکسان است.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
       <label className="text-xs app-muted">نام بانک<input value={form.bank_name} onChange={e=>set('bank_name',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">شعبه بانک<input value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted">کد شعبه<input dir="ltr" value={form.bank_branch_code} onChange={e=>set('bank_branch_code',e.target.value)} className={inputClass}/></label>
       <label className="text-xs app-muted sm:col-span-2">کد ابزار پرداخت / شماره اعتبار اسنادی (LC)<input dir="ltr" value={form.payment_instrument_code} onChange={e=>set('payment_instrument_code',e.target.value)} className={inputClass}/></label>
      </div>
      <label className="mt-4 block text-xs app-muted">یادداشت<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3} className={inputClass}/></label>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><button onClick={()=>void save()} disabled={busy} className="rounded-xl bg-[var(--primary)] px-5 py-3 font-bold text-white"><Save size={16} className="inline ml-1"/>ذخیره ثبت سفارش</button></div>
     </section>:current?<>
      <section className="rounded-2xl border app-border bg-[var(--surface)] p-5">
       <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs app-muted">ثبت سفارش</div><h2 className="mt-1 text-xl font-black" dir="ltr">{current.order_number}</h2><div className="mt-1 text-sm app-muted">{clientName(current.client_id)} · {current.order_date||'بدون تاریخ'} · {statuses.find(x=>x[0]===current.status)?.[1]||current.status}</div></div><div className="flex gap-2"><button type="button" onClick={()=>{setEditing(true);setError('')}} disabled={current.is_closed} className="rounded-xl border app-border px-4 py-2 text-sm font-bold disabled:opacity-40">ویرایش</button>{current.is_closed?<button type="button" onClick={()=>void finalize(false)} disabled={busy} className="rounded-xl border app-border px-4 py-2 text-sm font-bold"><Unlock size={15} className="inline ml-1"/>بازگشایی</button>:<button type="button" onClick={()=>void finalize(true)} disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"><Lock size={15} className="inline ml-1"/>نهایی‌سازی</button>}</div></div>
       {current.is_closed&&<div className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-600">این ثبت سفارش نهایی شده و برای جلوگیری از ثبت بیش از سقف، اتصال یا اصلاح محموله‌ها قفل است.</div>}
       {(()=>{const r=reconciliationFor(current);const net=calculateRegistrationOrderCapacity(r.registered_net_weight_kg,r.shipped_net_weight_kg,r.external_allocated_net_weight_kg);const gross=calculateRegistrationOrderCapacity(r.registered_gross_weight_kg,r.shipped_gross_weight_kg,r.external_allocated_gross_weight_kg);const value=calculateRegistrationOrderCapacity(current.value_amount,r.shipped_value_amount,r.external_allocated_value_amount);return <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">وزن خالص مجاز ثبت سفارش</div><b>{fa(net.registered)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">وزن محموله‌های داخلی</div><b>{fa(net.internal)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">وزن واگذارشده به غیر</div><b>{fa(net.external)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">مانده وزن خالص قابل تخصیص</div><b className={net.exceeded?'text-red-500':'text-emerald-600'}>{fa(net.remaining)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">وزن ناخالص مجاز</div><b>{fa(gross.registered)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">وزن ناخالص تخصیص‌یافته (داخلی + بیرونی)</div><b>{fa(gross.allocated)} kg</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">ارزش کل ثبت سفارش</div><b>{fa(value.registered)} {current.currency||''}</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">ارزش محموله‌های داخلی</div><b>{fa(value.internal)} {current.currency||''}</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">ارزش واگذارشده به غیر</div><b>{fa(value.external)} {current.currency||''}</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">مانده ارزش قابل تخصیص</div><b className={value.exceeded?'text-red-500':'text-emerald-600'}>{fa(value.remaining)} {current.currency||''}</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">محموله‌های داخلی متصل</div><b>{fa(r.shipment_count||0)}</b></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-xs app-muted">سهم‌های خارج از دسترس فعال</div><b>{fa(r.external_allocation_count||0)}</b></div>
       </div>})()}
       <section className="mt-4 rounded-2xl border app-border bg-[var(--surface-2)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
         <div><h3 className="font-black">سهم ثبت سفارش واگذارشده به گمرک یا شرکت دیگر</h3><p className="mt-1 text-xs app-muted">برای بخشی از ثبت سفارش که محموله‌اش در سیستم ما قابل مشاهده نیست، فقط مقصد، وزن و ارزش را ثبت کن. این سهم از همان ظرفیت مشترک کم می‌شود.</p></div>
         <span className="rounded-lg border app-border px-2 py-1 text-xs">در سقف کل محاسبه می‌شود</span>
        </div>
        {allocationError&&<div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">{allocationError}</div>}
        {externalAllocations.length>0?<div className="mt-3 space-y-2">
         {externalAllocations.map(allocation=><div key={allocation.id} className="rounded-xl border app-border bg-[var(--surface)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
           <div><b>{allocation.recipient_company||'شرکت ثبت نشده'}</b><div className="mt-1 text-xs app-muted">{allocation.destination_customs||'گمرک مقصد ثبت نشده'}{allocation.allocation_reference?' · '+allocation.allocation_reference:''}</div></div>
           <span className={'rounded-lg px-2 py-1 text-[11px] '+(allocation.status==='cancelled'?'bg-red-500/10 text-red-500':allocation.status==='completed'?'bg-emerald-500/10 text-emerald-600':'bg-[var(--surface-2)] app-muted')}>{externalAllocationStatuses.find(x=>x[0]===allocation.status)?.[1]||allocation.status}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
           <div>وزن خالص: <b>{fa(allocation.net_weight_kg)} kg</b></div>
           <div>وزن ناخالص: <b>{fa(allocation.gross_weight_kg)} kg</b></div>
           <div>ارزش: <b>{fa(allocation.value_amount)} {allocation.currency}</b></div>
          </div>
          {allocation.notes&&<p className="mt-2 text-xs app-muted">{allocation.notes}</p>}
          {canManageExternalAllocations&&!current.is_closed&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>editExternalAllocation(allocation)} disabled={allocationBusy} className="rounded-lg border app-border px-3 py-1.5 text-xs">ویرایش سهم</button>{allocation.status!=='cancelled'&&<button type="button" onClick={()=>void cancelExternalAllocation(allocation)} disabled={allocationBusy} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500">لغو و آزادسازی ظرفیت</button>}</div>}
         </div>)}
        </div>:<div className="mt-3 rounded-xl border border-dashed app-border p-4 text-center text-xs app-muted">برای این ثبت سفارش هنوز سهم واگذارشده‌ای ثبت نشده است.</div>}
        {canManageExternalAllocations&&!current.is_closed&&<div className="mt-4 border-t app-border pt-4">
         <div className="mb-3 font-bold text-sm">{allocationEditingId?'ویرایش سهم واگذارشده':'ثبت سهم خارج از دسترس'}</div>
         <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs app-muted">شرکت دریافت‌کننده<input value={allocationForm.recipient_company} onChange={e=>setAllocationForm(p=>({...p,recipient_company:e.target.value}))} className={inputClass} placeholder="نام شرکت دیگر"/></label>
          <label className="text-xs app-muted">گمرک مقصد<input value={allocationForm.destination_customs} onChange={e=>setAllocationForm(p=>({...p,destination_customs:e.target.value}))} className={inputClass} placeholder="نام گمرک"/></label>
          <label className="text-xs app-muted">شماره ارجاع / بارنامه / پیگیری<input value={allocationForm.allocation_reference} onChange={e=>setAllocationForm(p=>({...p,allocation_reference:e.target.value}))} className={inputClass}/></label>
          <label className="text-xs app-muted">وزن خالص واگذارشده (کیلوگرم) *<input inputMode="decimal" value={allocationForm.net_weight_kg} onChange={e=>setAllocationForm(p=>({...p,net_weight_kg:digits(e.target.value)}))} className={inputClass}/></label>
          <label className="text-xs app-muted">وزن ناخالص (کیلوگرم)<input inputMode="decimal" value={allocationForm.gross_weight_kg} onChange={e=>setAllocationForm(p=>({...p,gross_weight_kg:digits(e.target.value)}))} className={inputClass}/></label>
          <label className="text-xs app-muted">ارزش واگذارشده *<input inputMode="decimal" value={allocationForm.value_amount} onChange={e=>setAllocationForm(p=>({...p,value_amount:digits(e.target.value)}))} className={inputClass}/></label>
          <label className="text-xs app-muted">ارز سهم واگذارشده<select value={allocationForm.currency} onChange={e=>setAllocationForm(p=>({...p,currency:e.target.value}))} className={inputClass} disabled>{currencies.map(([v,l])=><option key={v} value={v}>{v} · {l}</option>)}</select></label>
          <label className="text-xs app-muted">وضعیت سهم<select value={allocationForm.status} onChange={e=>setAllocationForm(p=>({...p,status:e.target.value}))} className={inputClass}>{externalAllocationStatuses.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs app-muted sm:col-span-2 lg:col-span-3">توضیحات<textarea value={allocationForm.notes} onChange={e=>setAllocationForm(p=>({...p,notes:e.target.value}))} rows={2} className={inputClass}/></label>
         </div>
         <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={resetExternalAllocation} disabled={allocationBusy} className="rounded-xl border app-border px-3 py-2 text-xs">پاک‌کردن فرم</button><button type="button" onClick={()=>void saveExternalAllocation()} disabled={allocationBusy} className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white">{allocationBusy?'در حال ذخیره…':allocationEditingId?'ذخیره تغییرات سهم':'ثبت و کسر از ظرفیت'}</button></div>
         <p className="mt-2 text-[11px] app-muted">وزن خالص و ارزش اجباری است. ارز فقط برابر با ارز ثبت سفارش پذیرفته می‌شود. با لغو سهم، ظرفیت آن دوباره آزاد خواهد شد.</p>
        </div>}
        {current.is_closed&&<p className="mt-3 text-xs text-amber-600">ثبت سفارش نهایی شده؛ سهم‌های بیرونی فقط قابل مشاهده هستند تا ثبت سفارش باز شود.</p>}
       </section>
       {!!currentReconciliation?.shipments_missing_invoice_value&&<div className="mt-3 text-xs text-amber-600">ارزش فاکتور یا ارز {fa(currentReconciliation.shipments_missing_invoice_value)} محموله هنوز ثبت نشده است.</div>}
       {!!currentReconciliation?.shipments_with_currency_mismatch&&<div className="mt-2 text-xs text-red-500">ارز فاکتور {fa(currentReconciliation.shipments_with_currency_mismatch)} محموله با ارز ثبت سفارش یکسان نیست.</div>}
       <div className="mt-4 rounded-xl border app-border p-3"><div className="font-bold text-sm">بانک و ابزار پرداخت مشترک</div><div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm"><div>بانک: <b>{current.bank_name||'—'}</b></div><div>شعبه: <b>{current.bank_branch||'—'}</b></div><div>کد شعبه: <b>{current.bank_branch_code||'—'}</b></div><div>کد ابزار پرداخت / LC: <b dir="ltr">{current.payment_instrument_code||'—'}</b></div></div></div>
      </section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="text-sm app-muted">برای افزودن محموله، از فرم «شروع عملیات» همین ثبت سفارش را انتخاب کن.</div><Link to="/operations" className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white"><FileText size={15} className="inline ml-1"/>رفتن به عملیات محموله</Link></section>
     </>:<section className="rounded-2xl border border-dashed app-border bg-[var(--surface)] p-10 text-center text-sm app-muted">یک ثبت سفارش از فهرست انتخاب کن یا ثبت سفارش جدید بساز.</section>}
    </section>
   </div>
   <p className="text-xs app-muted">محموله‌های داخلی و سهم‌های واگذارشده به شرکت یا گمرک دیگر، هر دو از یک سقف مشترک وزن و ارزش استفاده می‌کنند. نهایی‌سازی فقط وقتی مجاز است که مجموع هر دو دقیقاً با ثبت سفارش برابر باشد. کد ساتا به هر محموله جداگانه تعلق دارد و تا مرحله خروج اجباری نیست.</p>
  </div>
 </main>;
};
