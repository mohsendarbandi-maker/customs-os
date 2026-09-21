import React,{useEffect,useState}from'react';
import{Download,ExternalLink,Plus,RefreshCw,Save,Ship,Upload}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';
import{buildShipmentDisplayName}from'../lib/displayNames';

type Vessel={id:string;name:string;imo_number?:string|null;flag_code?:string|null;shipping_line_id?:string|null};type ShippingLine={id:string;name:string;name_fa?:string|null};
type Row={id:string;client_id:string|null;vessel_id:string|null;shipping_line:string|null;bill_of_lading_no:string|null;bill_of_lading_year:number|null;voyage_no:string|null;origin_port:string|null;destination_port:string|null;cargo_count:number|null;cargo_count_unit:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;current_status:string;current_location:string|null;display_name:string|null;case_id:string|null;transport_documents_status:'not_ready'|'ready';release_invoice_payment_status:'unpaid'|'paid'};
type Form={ownerId:string;shippingLine:string;billOfLading:string;year:string;voyage:string;vessel:string;imo:string;flag:string;originPort:string;destinationPort:string;count:string;unit:string;net:string;gross:string;status:string;location:string;transportDocumentsStatus:'not_ready'|'ready';releaseInvoicePaymentStatus:'unpaid'|'paid'};
type Doc={id:string;document_name:string;original_file_name:string;storage_path:string;mime_type:string;file_size_bytes:number;created_at:string};
const BUCKET='customs_documents';
const empty:Form={ownerId:'',shippingLine:'',billOfLading:'',year:String(new Date().getFullYear()),voyage:'',vessel:'',imo:'',flag:'',originPort:'',destinationPort:'',count:'',unit:'رول',net:'',gross:'',status:'draft',location:'',transportDocumentsStatus:'not_ready',releaseInvoicePaymentStatus:'unpaid'};
const digits=(v:string)=>v.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const num=(v:string)=>{const n=Number(digits(v).replace(/[٬,]/g,''));return Number.isFinite(n)?n:null};
const same=(a:string,b:string)=>String(a||'').trim().localeCompare(String(b||'').trim(),'fa',{sensitivity:'base'})===0;
const statuses=[['draft','پیش‌نویس'],['booking_confirmed','تأیید رزرو'],['loading','در حال بارگیری'],['loaded','بارگیری کامل'],['departed','حرکت'],['in_transit','در مسیر'],['approaching_destination','نزدیک مقصد'],['anchorage','لنگرگاه'],['berthing','پهلوگیری'],['discharging','در حال تخلیه'],['discharged','تخلیه کامل'],['completed','تکمیل'],['delayed','تأخیر'],['cancelled','لغو']];
const safe=(n:string)=>n.replace(/[^\w.\-\u0600-\u06ff]+/g,'_');

export const ShipmentFirstPage:React.FC=()=>{
 const{profile}=useAuth();
 const[clients,setClients]=useState<any[]>([]),[vessels,setVessels]=useState<Vessel[]>([]),[lines,setLines]=useState<ShippingLine[]>([]),[rows,setRows]=useState<Row[]>([]),[docs,setDocs]=useState<Doc[]>([]);
 const[selected,setSelected]=useState(''),[form,setForm]=useState<Form>(empty),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[message,setMessage]=useState('');
 const set=(k:keyof Form,v:string)=>setForm(p=>({...p,[k]:v}));
 const loadDocs=async(id:string)=>{
  if(!id){setDocs([]);return}
  const{data,error}=await supabase.from('shipment_documents').select('id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,created_at').eq('shipment_id',id).order('created_at',{ascending:false});
  if(error){setMessage(error.message);return} setDocs((data||[]) as Doc[]);
 };
 const load=async()=>{
  if(!profile?.organization_id)return;
  setBusy(true);setMessage('');
  try{
   const[{data:c,error:ce},{data:s,error:se},{data:v,error:ve},{data:l,error:le}]=await Promise.all([
    supabase.from('clients').select('id,name,national_id').eq('organization_id',profile.organization_id).order('name'),
    supabase.from('shipments').select('id,client_id,vessel_id,shipping_line,bill_of_lading_no,bill_of_lading_year,voyage_no,origin_port,destination_port,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,current_location,display_name,case_id,transport_documents_status,release_invoice_payment_status').eq('organization_id',profile.organization_id).order('created_at',{ascending:false}),
    supabase.from('vessels').select('id,name,imo_number,flag_code,shipping_line_id').eq('organization_id',profile.organization_id).order('name'),supabase.from('shipping_lines').select('id,name,name_fa').order('name')
   ]);
   if(ce||se||ve)throw ce||se||ve;
   setClients(c||[]);setVessels((v||[])as Vessel[]);setRows((s||[])as Row[]);
  }catch(e:any){setMessage(e?.message||'خطا در دریافت اطلاعات')}finally{setBusy(false)}
 };
 useEffect(()=>{void load()},[profile?.organization_id]);
 useEffect(()=>{void loadDocs(selected)},[selected]);
 const chooseLine=(name:string)=>{set('shippingLine',name);const line=lines.find(x=>same(x.name,name)||same(x.name_fa||'',name));if(line&&!form.vessel){const v=vessels.find(x=>x.shipping_line_id===line.id);if(v){set('vessel',v.name);set('imo',v.imo_number||'');set('flag',v.flag_code||'')}}};
 const chooseVessel=(name:string)=>{set('vessel',name);const v=vessels.find(x=>same(x.name,name));if(v){set('imo',v.imo_number||'');set('flag',v.flag_code||'')}};
 const reset=()=>{setSelected('');setForm(empty);setDocs([]);setMessage('محموله جدید آماده ثبت است.')};
 const edit=(r:Row)=>{const v=vessels.find(x=>x.id===r.vessel_id);setSelected(r.id);setForm({ownerId:r.client_id||'',shippingLine:r.shipping_line||'',billOfLading:r.bill_of_lading_no||'',year:String(r.bill_of_lading_year||new Date().getFullYear()),voyage:r.voyage_no||'',vessel:v?.name||'',imo:v?.imo_number||'',flag:v?.flag_code||'',originPort:r.origin_port||'',destinationPort:r.destination_port||'',count:r.cargo_count==null?'':String(r.cargo_count),unit:r.cargo_count_unit||'رول',net:r.net_weight_kg==null?'':String(r.net_weight_kg),gross:r.gross_weight_kg==null?'':String(r.gross_weight_kg),status:r.current_status||'draft',location:r.current_location||'',transportDocumentsStatus:r.transport_documents_status||'not_ready',releaseInvoicePaymentStatus:r.release_invoice_payment_status||'unpaid'});setMessage('محموله برای مدیریت انتخاب شد.')};
 const ensureVessel=async()=>{
  const name=form.vessel.trim();if(!name)throw new Error('نام کشتی الزامی است.');
  const found=vessels.find(v=>same(v.name,name));if(found)return found;
  const imo=digits(form.imo).replace(/\D/g,'');if(imo&&!/^\d{7}$/.test(imo))throw new Error('IMO باید ۷ رقم باشد.');
  const{data,error}=await supabase.from('vessels').insert({organization_id:profile?.organization_id,name,imo_number:imo||null,flag_code:form.flag.toUpperCase()||null}).select('id,name,imo_number,flag_code,shipping_line_id').single();
  if(error)throw error;setVessels(p=>[...p,data as Vessel]);return data as Vessel;
 };
 const save=async()=>{
  if(!profile?.organization_id)return setMessage('سازمان کاربر مشخص نیست.');
  if(!form.ownerId)return setMessage('صاحب کالا را انتخاب کنید.');
  if(!clients.some(c=>c.id===form.ownerId))return setMessage('صاحب کالا برای این سازمان معتبر نیست.');
  if(!form.vessel.trim())return setMessage('نام کشتی را وارد یا انتخاب کنید.');
  if(!form.billOfLading.trim())return setMessage('شماره B/L الزامی است.');
  if(!form.count.trim()||!form.net.trim()||!form.gross.trim())return setMessage('تعداد، وزن خالص و وزن ناخالص را تکمیل کنید.');
  setBusy(true);setMessage('در حال ذخیره شروع عملیات...');
  try{
   const vessel=await ensureVessel();const owner=clients.find(c=>c.id===form.ownerId);
   const display=buildShipmentDisplayName({cargo_count:num(form.count),cargo_count_unit:form.unit||'رول',client_name:owner?.name,vessel_name:vessel.name});
   const payload={organization_id:profile.organization_id,client_id:form.ownerId,vessel_id:vessel.id,transport_mode:'sea',shipping_line:form.shippingLine||null,bill_of_lading_no:form.billOfLading.trim(),bill_of_lading_year:num(form.year),voyage_no:form.voyage||null,origin_port:form.originPort||null,destination_port:form.destinationPort||null,cargo_count:num(form.count),cargo_count_unit:form.unit||'رول',net_weight_kg:num(form.net),gross_weight_kg:num(form.gross),current_status:form.status||'draft',current_location:form.location||null,transport_documents_status:form.transportDocumentsStatus,release_invoice_payment_status:form.releaseInvoicePaymentStatus,display_name:display};
   let shipmentId=selected;
   if(selected){const{error}=await supabase.from('shipments').update(payload).eq('id',selected).eq('organization_id',profile.organization_id);if(error)throw error}
   else{
    const{data,error}=await supabase.from('shipments').insert(payload).select('id').single();if(error)throw error;shipmentId=data.id;
    const{data:caseId,error:ce}=await supabase.rpc('create_case_workflow',{p_client_name:owner?.name||'',p_registration_order_no:null});if(ce)throw ce;
    const{error:le}=await supabase.rpc('link_shipment_to_case',{p_shipment_id:shipmentId,p_case_id:caseId});if(le)throw le;
    const{error:ca}=await supabase.from('cases').update({display_name:display}).eq('id',caseId);if(ca)throw ca;
   }
   const{error:te}=await supabase.rpc('set_shipment_tracking_status',{p_shipment_id:shipmentId,p_status:form.status||'draft',p_location:form.location||null,p_event_time:new Date().toISOString(),p_time_type:'actual',p_notes:'شروع عملیات / مدیریت محموله',p_source:'Customs OS'});if(te)throw te;
   setSelected(shipmentId);setMessage('محموله، صاحب کالا، کشتی و وضعیت عملیاتی ذخیره شد.');await load();
  }catch(e:any){setMessage(e?.message||'ذخیره محموله ناموفق بود')}finally{setBusy(false)}
 };
 const upload=async(files:FileList|null)=>{
  if(!files?.length||!selected)return setMessage('ابتدا محموله را ذخیره و انتخاب کنید.');
  setUploading(true);setMessage('');
  try{
   const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('کاربر وارد نشده است.');
   if(!profile?.organization_id)throw new Error('سازمان کاربر مشخص نیست.');
   for(const f of Array.from(files)){
    if(!['application/pdf','image/jpeg','image/png'].includes(f.type)&&!/\.(pdf|jpe?g|png)$/i.test(f.name))throw new Error('فقط PDF، JPG و PNG مجاز است.');
    if(f.size>50*1024*1024)throw new Error('حجم هر فایل نباید بیشتر از ۵۰ مگابایت باشد.');
    const mime=f.type||(/\.pdf$/i.test(f.name)?'application/pdf':/\.png$/i.test(f.name)?'image/png':'image/jpeg');
    const path=`${profile.organization_id}/${selected}/${crypto.randomUUID()}-${safe(f.name)}`;
    const{error:ue}=await supabase.storage.from(BUCKET).upload(path,f,{contentType:mime,cacheControl:'3600',upsert:false});if(ue)throw ue;
    const{error:de}=await supabase.from('shipment_documents').insert({organization_id:profile.organization_id,shipment_id:selected,uploaded_by:user.id,document_name:f.name,original_file_name:f.name,storage_path:path,mime_type:mime,file_size_bytes:f.size});if(de){await supabase.storage.from(BUCKET).remove([path]);throw de}
   }
   await loadDocs(selected);setMessage('اسناد محموله با موفقیت در پرونده محموله ثبت شدند.');
  }catch(e:any){setMessage(e?.message||'آپلود اسناد ناموفق بود')}finally{setUploading(false)}
 };
 const download=async(d:Doc)=>{const{data,error}=await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path,600);if(error)return setMessage(error.message);window.open(data.signedUrl,'_blank','noopener,noreferrer')};
 const selectedRow=rows.find(r=>r.id===selected);
 const vessel=selectedRow?vessels.find(v=>v.id===selectedRow.vessel_id):vessels.find(v=>same(v.name,form.vessel));
 const openPre=selected?'/operations?tab=pre-declaration&shipmentId='+encodeURIComponent(selected):'/operations';
 const vesselSearch=selected?'/vessel-search?name='+encodeURIComponent(vessel?.name||form.vessel)+'&imo='+encodeURIComponent(vessel?.imo_number||form.imo)+'&bl='+encodeURIComponent(form.billOfLading):'#';
 return <main dir="rtl" className="min-h-screen p-4 md:p-6" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-[1500px] mx-auto space-y-4">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs app-muted">مرحله ۱</div><h1 className="text-2xl font-black">شروع عملیات</h1><p className="text-xs app-muted mt-1">محموله، صاحب کالا، کشتی، وضعیت کشتی و اسناد محموله در یک مرحله.</p></div><div className="flex gap-2"><button onClick={()=>void load()} className="icon-btn" title="بروزرسانی"><RefreshCw size={16}/></button><button onClick={reset} className="px-4 py-2 rounded-xl border app-border"><Plus size={16} className="inline ml-1"/>محموله جدید</button></div></header>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="grid lg:grid-cols-4 gap-3">
   <label className="text-xs app-muted lg:col-span-2">صاحب کالا<select value={form.ownerId} onChange={e=>set('ownerId',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="">انتخاب صاحب کالا</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.national_id?' — '+c.national_id:''}</option>)}</select></label>
   <label className="text-xs app-muted">کشتیرانی<select value={form.shippingLine} onChange={e=>chooseLine(e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="">انتخاب کشتیرانی</option>{lines.map(l=><option key={l.id} value={l.name}>{l.name_fa||l.name}</option>)}</select></label><label className="text-xs app-muted">B/L<input value={form.billOfLading} onChange={e=>set('billOfLading',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">سال B/L<input value={form.year} onChange={e=>set('year',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">Voyage<input value={form.voyage} onChange={e=>set('voyage',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted lg:col-span-2">کشتی<input list="operations-vessels" value={form.vessel} onChange={e=>chooseVessel(e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/><datalist id="operations-vessels">{vessels.map(v=><option key={v.id} value={v.name}/>)}</datalist></label><label className="text-xs app-muted">IMO<input value={form.imo} onChange={e=>set('imo',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">پرچم ISO-2<input value={form.flag} onChange={e=>set('flag',e.target.value.toUpperCase())} maxLength={2} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">بندر مبدأ<input value={form.originPort} onChange={e=>set('originPort',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">بندر مقصد<input value={form.destinationPort} onChange={e=>set('destinationPort',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">تعداد<input value={form.count} onChange={e=>set('count',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">واحد<input value={form.unit} onChange={e=>set('unit',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">وزن خالص kg<input value={form.net} onChange={e=>set('net',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">وزن ناخالص kg<input value={form.gross} onChange={e=>set('gross',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">وضعیت کشتی<select value={form.status} onChange={e=>set('status',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3">{statuses.map(s=><option key={s[0]} value={s[0]}>{s[1]}</option>)}</select></label><label className="text-xs app-muted">موقعیت فعلی کشتی<input value={form.location} onChange={e=>set('location',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>{form.status==='completed'&&<><label className="text-xs app-muted">اسناد حمل و قبض انبار<select value={form.transportDocumentsStatus} onChange={e=>set('transportDocumentsStatus',e.target.value as 'not_ready'|'ready')} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="not_ready">آماده نیست</option><option value="ready">آماده است</option></select></label><label className="text-xs app-muted">صورتحساب ترخیصیه<select value={form.releaseInvoicePaymentStatus} onChange={e=>set('releaseInvoicePaymentStatus',e.target.value as 'unpaid'|'paid')} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="unpaid">پرداخت نشده</option><option value="paid">پرداخت شده</option></select></label></>}
   <div className="lg:col-span-4 flex flex-wrap gap-2 pt-2"><button disabled={busy} onClick={()=>void save()} className="px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-black"><Save size={16} className="inline ml-2"/>{busy?'در حال ذخیره...':'ذخیره شروع عملیات'}</button>{selected&&<Link to={openPre} className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold">مرحله ۲ · ورود اطلاعات قبض انبار</Link>}</div>
  </div></section>
  {selected&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-black">اسناد محموله</div><div className="text-xs app-muted mt-1">اسناد مستقیماً به همین Shipment متصل می‌شوند.</div></div><label className="cursor-pointer px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold"><Upload size={16} className="inline ml-1"/>{uploading?'در حال آپلود...':'آپلود فایل'}<input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" disabled={uploading} onChange={e=>{void upload(e.target.files);e.currentTarget.value=''}}/></label></div>{docs.length===0?<div className="py-8 text-center app-muted">هنوز سندی برای این محموله ثبت نشده است.</div>:<div className="grid md:grid-cols-2 gap-2 mt-4">{docs.map(d=><div key={d.id} className="rounded-xl border app-border p-3 flex items-center justify-between gap-3"><div className="min-w-0"><b className="block truncate text-sm">{d.document_name}</b><span className="text-[10px] app-muted">{Math.round(d.file_size_bytes/1024)} KB</span></div><button onClick={()=>void download(d)} className="icon-btn" title="باز کردن"><Download size={16}/></button></div>)}</div>}</section>}
  {message&&<div className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{message}</div>}
  {selected&&vessel&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Ship size={19}/><b>بررسی وضعیت کشتی</b></div><Link to={vesselSearch} className="px-4 py-2 rounded-xl border app-border font-bold text-sm"><ExternalLink size={15} className="inline ml-1"/>جستجوی اطلاعات کشتی</Link></div><div className="grid md:grid-cols-6 gap-3 mt-3 text-sm"><div><span className="app-muted text-xs">کشتی</span><b className="block mt-1">{vessel.name}</b></div><div><span className="app-muted text-xs">IMO</span><b className="block mt-1" dir="ltr">{vessel.imo_number||'—'}</b></div><div><span className="app-muted text-xs">پرچم</span><b className="block mt-1">{vessel.flag_code||'—'}</b></div><div><span className="app-muted text-xs">وضعیت</span><b className="block mt-1">{statuses.find(x=>x[0]===selectedRow?.current_status)?.[1]||selectedRow?.current_status||'—'}</b></div><div><span className="app-muted text-xs">موقعیت</span><b className="block mt-1">{selectedRow?.current_location||'—'}</b></div><div><span className="app-muted text-xs">B/L</span><b className="block mt-1" dir="ltr">{selectedRow?.bill_of_lading_no||form.billOfLading||'—'}</b></div>{selectedRow?.current_status==='completed'&&<><div><span className="app-muted text-xs">اسناد حمل و قبض انبار</span><b className="block mt-1">{selectedRow.transport_documents_status==='ready'?'آماده است':'آماده نیست'}</b></div><div><span className="app-muted text-xs">صورتحساب ترخیصیه</span><b className="block mt-1">{selectedRow.release_invoice_payment_status==='paid'?'پرداخت شده':'پرداخت نشده'}</b></div></>}</div></section>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex items-center justify-between mb-3"><b>محموله‌های ثبت‌شده</b><span className="text-xs app-muted">{rows.length} محموله</span></div>{rows.length===0?<div className="py-10 text-center app-muted">هنوز محموله‌ای ثبت نشده است.</div>:<div className="space-y-2">{rows.map(r=><button key={r.id} onClick={()=>edit(r)} className={'w-full text-right rounded-xl border p-3 '+(selected===r.id?'border-[var(--primary)] bg-[var(--surface-2)]':'app-border bg-[var(--surface)]')}><div className="flex justify-between gap-3"><div><b>{r.display_name||'محموله'}</b><div className="text-xs app-muted mt-1">{r.shipping_line||'—'} · B/L {r.bill_of_lading_no||'—'}</div></div><span className="text-xs app-muted">{statuses.find(x=>x[0]===r.current_status)?.[1]||r.current_status}</span></div></button>)}</div>}</section>
 </div></main>
};
