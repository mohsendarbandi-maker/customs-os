import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,BookOpen,Check,Plus,Printer,Trash2,X} from 'lucide-react';
import {Link,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {useAuth} from '../context/AuthContext';
import '../styles/customs-accounting-voucher.css';

type Line={
 id?:string; row_number:number; description:string; category_id:string; description_category:string;
 receipt_number:string; debit_amount:string; credit_amount:string; status:'active'|'voided';
 void_reason?:string|null; voided_at?:string|null;
};
const DIGITS='۰۱۲۳۴۵۶۷۸۹';
const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(Number(n)||0));
const num=(v:string|number)=>Number(String(v??'').replace(/[۰-۹]/g,d=>String(DIGITS.indexOf(d))).replace(/,/g,''))||0;
const jalali=(v?:string|null)=>v?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v+'T00:00:00')):'—';
const blank=(row:number):Line=>({row_number:row,description:'',category_id:'',description_category:'',receipt_number:'',debit_amount:'',credit_amount:'',status:'active'});

export const CustomsAccountingVoucherPage:React.FC=()=>{
 const {id}=useParams(); const isEdit=!!id&&id!=='new'; const navigate=useNavigate(); const [params]=useSearchParams();
 const {profile}=useAuth(); const canWrite=!!profile&&['owner','admin','accountant'].includes(profile.role);
 const [cases,setCases]=useState<any[]>([]),[categories,setCategories]=useState<any[]>([]),[vouchers,setVouchers]=useState<any[]>([]);
 const [voucher,setVoucher]=useState<any>(null),[caseData,setCaseData]=useState<any>(null);
 const [lines,setLines]=useState<Line[]>(Array.from({length:30},(_,i)=>blank(i+1)));
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const [actualKottaj,setActualKottaj]=useState(''),[showCategory,setShowCategory]=useState(false),[categoryName,setCategoryName]=useState('');
 const [voidTarget,setVoidTarget]=useState<Line|null>(null),[voidReason,setVoidReason]=useState('');
 const [header,setHeader]=useState({
   case_id:params.get('caseId')||'',company_name:'',cargo_type:'',tonnage:'',unit_count:'',unit_type:'',
   cargo_entry_date:'',kottaj_number:'',permit_issue_date:''
 });

 const loadCategories=async()=>{const {data,error}=await supabase.from('finance_cost_categories').select('id,code,name_fa,name_en,is_active').eq('is_active',true).order('sort_order').order('name_fa');if(error)setMessage(error.message);setCategories(data||[])};
 const loadCases=async()=>{if(!canWrite)return;const {data,error}=await supabase.from('cases').select('id,case_number,client_id,registration_order_no,proforma_no,cargo_description,unloading_date,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,clients(name)').order('updated_at',{ascending:false});if(error)setMessage(error.message);setCases(data||[])};
 const loadCase=async(caseId:string)=>{
   if(!caseId)return;setLoading(true);
   const [{data:c,error:ce},{data:d},{data:p}]=await Promise.all([
    supabase.from('cases').select('id,case_number,client_id,registration_order_no,proforma_no,cargo_description,unloading_date,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,clients(name)').eq('id',caseId).single(),
    supabase.from('customs_declarations').select('id,kottaj_number,updated_at,declaration_date').eq('case_id',caseId).order('updated_at',{ascending:false}).limit(1).maybeSingle(),
    supabase.from('permits').select('issued_at').eq('case_id',caseId).not('issued_at','is',null).order('issued_at',{ascending:false}).limit(1).maybeSingle()
   ]);
   if(ce){setMessage(ce.message);setLoading(false);return}
   const ton=c?.net_weight_kg!=null?Number(c.net_weight_kg)/1000:c?.gross_weight_kg!=null?Number(c.gross_weight_kg)/1000:'';
   setCaseData({...c,declaration:d||null,permit:p||null});setActualKottaj(d?.kottaj_number||'');
   setHeader({case_id:caseId,company_name:c?.clients?.name||'',cargo_type:c?.cargo_description||'',tonnage:ton===''?'':String(ton),
    unit_count:c?.cargo_count==null?'':String(c.cargo_count),unit_type:c?.cargo_count_unit||'',cargo_entry_date:c?.unloading_date||'',
    kottaj_number:d?.kottaj_number||'',permit_issue_date:p?.issued_at?.slice(0,10)||''});setLoading(false);
 };
 const loadList=async()=>{setLoading(true);const {data,error}=await supabase.from('customs_accounting_vouchers').select('id,voucher_number,case_id,client_id,company_name,kottaj_number,debit_total,credit_total,created_at,cases(case_number),clients(name)').order('created_at',{ascending:false});if(error)setMessage(error.message);setVouchers(data||[]);setLoading(false)};
 const loadVoucher=async(voucherId:string)=>{
   setLoading(true);
   const [{data:v,error:ve},{data:l,error:le}]=await Promise.all([
    supabase.from('customs_accounting_vouchers').select('*,cases(case_number,registration_order_no,proforma_no,cargo_description,unloading_date,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,clients(name)),clients(name),customs_declarations(id,kottaj_number)').eq('id',voucherId).single(),
    supabase.from('voucher_line_items').select('*').eq('voucher_id',voucherId).order('row_number')
   ]);
   if(ve||le){setMessage(ve?.message||le?.message||'خطا در خواندن سند');setLoading(false);return}
   setVoucher(v);setCaseData({...v.cases,declaration:v.customs_declarations||null});setActualKottaj(v.customs_declarations?.kottaj_number||'');
   setHeader({case_id:v.case_id||'',company_name:v.company_name||v.clients?.name||'',cargo_type:v.cargo_type||v.cases?.cargo_description||'',
    tonnage:v.tonnage==null?'':String(v.tonnage),unit_count:v.unit_count==null?'':String(v.unit_count),unit_type:v.unit_type||'',
    cargo_entry_date:v.cargo_entry_date||'',kottaj_number:v.kottaj_number||'',permit_issue_date:v.permit_issue_date||''});
   const mapped=(l||[]).map((x:any)=>({id:x.id,row_number:x.row_number,description:x.description||'',category_id:x.category_id||'',
    description_category:x.description_category||'',receipt_number:x.receipt_number||'',debit_amount:x.debit_amount?String(x.debit_amount):'',
    credit_amount:x.credit_amount?String(x.credit_amount):'',status:x.status,void_reason:x.void_reason||null,voided_at:x.voided_at||null}));
   setLines(mapped.length?mapped:Array.from({length:30},(_,i)=>blank(i+1)));setLoading(false);
 };
 useEffect(()=>{void loadCategories();if(isEdit)void loadVoucher(id!);else{void loadCases();void loadList();const c=params.get('caseId');if(c)void loadCase(c)}},[id]);
 const previewDebit=useMemo(()=>lines.filter(x=>x.status==='active').reduce((a,x)=>a+num(x.debit_amount),0),[lines]);
 const previewCredit=useMemo(()=>lines.filter(x=>x.status==='active').reduce((a,x)=>a+num(x.credit_amount),0),[lines]);
 const mismatch=!!actualKottaj&&!!header.kottaj_number&&actualKottaj!==header.kottaj_number;
 const uh=(k:keyof typeof header,v:string)=>setHeader(h=>({...h,[k]:v}));
 const ul=(idx:number,k:keyof Line,v:string)=>setLines(p=>p.map((x,i)=>{if(i!==idx)return x;const n={...x,[k]:v};if(k==='debit_amount'&&num(v)>0)n.credit_amount='';if(k==='credit_amount'&&num(v)>0)n.debit_amount='';if(k==='category_id')n.description_category=categories.find(c=>c.id===v)?.name_fa||'';return n}));
 const addRow=()=>setLines(p=>p.concat(blank((p[p.length-1]?.row_number||0)+1)));
 const save=async()=>{
   if(!canWrite){setMessage('دسترسی ثبت و ویرایش سند حسابداری ندارید.');return}
   if(!header.case_id||!header.company_name.trim()){setMessage('پرونده و نام صاحب کالا الزامی است.');return}
   const active=lines.filter(x=>x.status==='active'&&(x.description.trim()||num(x.debit_amount)>0||num(x.credit_amount)>0));
   for(const x of active){
    if(!x.description.trim()){setMessage('شرح برای ردیف دارای مبلغ الزامی است.');return}
    if(num(x.debit_amount)>0&&num(x.credit_amount)>0){setMessage('در هر ردیف فقط بدهکار یا بستانکار می‌تواند مقدار داشته باشد.');return}
    if(num(x.debit_amount)<=0&&num(x.credit_amount)<=0){setMessage('ردیف ثبت‌شده باید مبلغ بدهکار یا بستانکار داشته باشد.');return}
    if(x.receipt_number&&!/^[0-9۰-۹]+$/.test(x.receipt_number.trim())){setMessage('شماره فیش فقط باید عددی باشد.');return}
   }
   setSaving(true);setMessage('');
   try{
    let voucherId=isEdit?id:'';
    if(!voucherId){
     const {data,error}=await supabase.rpc('create_customs_accounting_voucher',{p_case_id:header.case_id,p_company_name:header.company_name,p_cargo_type:header.cargo_type,
      p_tonnage:header.tonnage===''?null:num(header.tonnage),p_unit_count:header.unit_count===''?null:num(header.unit_count),p_unit_type:header.unit_type,
      p_cargo_entry_date:header.cargo_entry_date||null,p_kottaj_number:header.kottaj_number,p_permit_issue_date:header.permit_issue_date||null});
     if(error)throw error;voucherId=data?.voucher_id;if(!voucherId)throw new Error('شناسه سند پس از ایجاد دریافت نشد.');
    }
    const {data,error}=await supabase.rpc('save_customs_accounting_voucher',{p_voucher_id:voucherId,p_company_name:header.company_name,
     p_cargo_type:header.cargo_type,p_tonnage:header.tonnage===''?null:num(header.tonnage),p_unit_count:header.unit_count===''?null:num(header.unit_count),p_unit_type:header.unit_type,
     p_cargo_entry_date:header.cargo_entry_date||null,p_kottaj_number:header.kottaj_number,p_permit_issue_date:header.permit_issue_date||null,
     p_lines:active.map(x=>({id:x.id||null,row_number:x.row_number,description:x.description.trim(),category_id:x.category_id||null,description_category:x.description_category||null,
      receipt_number:x.receipt_number.trim()||null,debit_amount:num(x.debit_amount),credit_amount:num(x.credit_amount)}))});
    if(error)throw error;
    setMessage('سند حسابداری با موفقیت ذخیره شد.');navigate('/finance/accounting-vouchers/'+voucherId,{replace:true});await loadVoucher(voucherId);
   }catch(e:any){setMessage(e?.message||'خطا در ذخیره سند')}finally{setSaving(false)}
 };
 const voidLine=async()=>{
   if(!voidTarget?.id||!voidReason.trim())return;setSaving(true);
   const {error}=await supabase.rpc('void_customs_voucher_line',{p_line_id:voidTarget.id,p_reason:voidReason.trim()});
   if(error)setMessage(error.message);else{setMessage('ردیف باطل شد؛ در سند و چاپ باقی می‌ماند و در جمع لحاظ نمی‌شود.');setVoidTarget(null);setVoidReason('');if(id)await loadVoucher(id)}
   setSaving(false);
 };
 const addCategory=async()=>{if(!canWrite||!categoryName.trim())return;const {data,error}=await supabase.from('finance_cost_categories').insert({
   organization_id:profile!.organization_id,code:'voucher_custom_'+Date.now(),name_fa:categoryName.trim(),name_en:null,description:'دسته‌بندی سند هزینه پروانه قطعی',
   is_pass_through:false,is_billable_default:true,is_active:true,sort_order:999}).select('id,code,name_fa,name_en,is_active').single();if(error){setMessage(error.message);return}
   setCategories(p=>p.concat(data||[]));setCategoryName('');setShowCategory(false);setMessage('دسته‌بندی اضافه شد.')};
 if(!id)return <main dir="rtl" className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black flex items-center gap-2"><BookOpen size={22}/>اسناد هزینه پروانه قطعی</h1><p className="app-muted">دفتر اسناد حسابداری متصل به پرونده و کوتاژ</p></div><div className="flex gap-2">{canWrite&&<Link to="/finance/accounting-vouchers/new" className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Plus size={16} className="inline ml-1"/>سند جدید</Link>}<Link to="/finance" className="icon-btn"><ArrowRight size={18}/></Link></div></header>{message&&<div className="app-surface border app-border rounded-xl p-3">{message}</div>}<section className="app-surface border app-border rounded-2xl p-4 overflow-auto"><table className="w-full text-sm min-w-[850px]"><thead><tr className="border-b app-border"><th className="p-2 text-right">شماره سند</th><th>صاحب کالا</th><th>پرونده</th><th>کوتاژ</th><th>بدهکار</th><th>بستانکار</th><th></th></tr></thead><tbody>{vouchers.map(v=><tr key={v.id} className="border-b app-border/50"><td className="p-2 font-bold" dir="ltr">{v.voucher_number}</td><td>{v.clients?.name||v.company_name}</td><td>{v.cases?.case_number||'—'}</td><td dir="ltr">{v.kottaj_number||'—'}</td><td dir="ltr">{money(v.debit_total)} ریال</td><td dir="ltr">{money(v.credit_total)} ریال</td><td className="whitespace-nowrap"><Link className="text-[var(--primary)] font-bold ml-3" to={'/finance/accounting-vouchers/'+v.id}>مشاهده</Link><a className="text-[var(--primary)] font-bold cursor-pointer" onClick={()=>window.open('/finance/accounting-vouchers/print?id='+encodeURIComponent(v.id),'_blank','noopener,noreferrer')}><Printer size={14} className="inline ml-1"/>چاپ</a></td></tr>)}</tbody></table>{!loading&&!vouchers.length&&<div className="p-8 text-center app-muted">سندی ثبت نشده است.</div>}</section></main>;
 return <main dir="rtl" className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Link to="/finance/accounting-vouchers" className="icon-btn"><ArrowRight size={18}/></Link><div><h1 className="text-2xl font-black">سند حسابداری هزینه پروانه قطعی <span className="app-muted text-base">{voucher?('#'+voucher.voucher_number):''}</span></h1><p className="app-muted text-sm">متصل به Case / Registration Order / Declaration · ردیف Void شده حذف فیزیکی نمی‌شود</p></div></div><div className="flex gap-2">{isEdit&&<button onClick={()=>window.open('/finance/accounting-vouchers/print?id='+encodeURIComponent(id!),'_blank','noopener,noreferrer')} className="px-4 py-2 rounded-xl border app-border font-bold"><Printer size={16} className="inline ml-1"/>چاپ / PDF</button>}{canWrite&&<button onClick={save} disabled={saving||loading} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Check size={16} className="inline ml-1"/>{saving?'در حال ذخیره...':'ذخیره سند'}</button>}</div></header>{message&&<div className="app-surface border app-border rounded-xl p-3">{message}</div>}
<section className="app-surface border app-border rounded-2xl p-4"><div className="grid md:grid-cols-3 gap-4">
<label className="text-xs app-muted">پرونده{isEdit?<div className="input mt-1 font-bold">{caseData?.case_number||header.case_id}</div>:<select value={header.case_id} onChange={e=>{uh('case_id',e.target.value);void loadCase(e.target.value)}} className="input mt-1"><option value="">انتخاب پرونده</option>{cases.map(c=><option key={c.id} value={c.id}>{c.clients?.name||'—'} — {c.case_number||c.id.slice(0,8)}</option>)}</select>}</label>
<label className="text-xs app-muted">شماره صورتحساب / سند<div className="input mt-1 font-bold" dir="ltr">{voucher?.voucher_number||'بعد از اولین ذخیره'}</div></label>
<label className="text-xs app-muted">نام شرکت / صاحب کالا<input className="input mt-1" value={header.company_name} onChange={e=>uh('company_name',e.target.value)} readOnly={!canWrite}/></label>
<label className="text-xs app-muted">نوع کالا<input className="input mt-1" value={header.cargo_type} onChange={e=>uh('cargo_type',e.target.value)} readOnly={!canWrite}/></label>
<label className="text-xs app-muted">تناژ (تن)<input className="input mt-1" value={header.tonnage} onChange={e=>uh('tonnage',e.target.value)} dir="ltr" readOnly={!canWrite}/></label>
<label className="text-xs app-muted">تعداد<input className="input mt-1" value={header.unit_count} onChange={e=>uh('unit_count',e.target.value)} dir="ltr" readOnly={!canWrite}/></label>
<label className="text-xs app-muted">واحد تعداد<input className="input mt-1" value={header.unit_type} onChange={e=>uh('unit_type',e.target.value)} readOnly={!canWrite}/></label>
<label className="text-xs app-muted">تاریخ ورود کالا<input type="date" className="input mt-1" value={header.cargo_entry_date} onChange={e=>uh('cargo_entry_date',e.target.value)} readOnly={!canWrite}/><span className="text-[10px]">شمسی: {jalali(header.cargo_entry_date)}</span></label>
<label className="text-xs app-muted">شماره کوتاژ<input className="input mt-1" value={header.kottaj_number} onChange={e=>uh('kottaj_number',e.target.value)} dir="ltr" readOnly={!canWrite}/></label>
<label className="text-xs app-muted">تاریخ صدور پروانه<input type="date" className="input mt-1" value={header.permit_issue_date} onChange={e=>uh('permit_issue_date',e.target.value)} readOnly={!canWrite}/><span className="text-[10px]">شمسی: {jalali(header.permit_issue_date)}</span></label>
</div><div className="mt-4 flex flex-wrap gap-4 text-xs app-muted"><span>شماره پرونده: <b>{caseData?.case_number||'—'}</b></span><span>ثبت سفارش: <b dir="ltr">{caseData?.registration_order_no||'—'}</b></span><span>پروفرما: <b>{caseData?.proforma_no||'—'}</b></span><span>کوتاژ واقعی اظهار: <b dir="ltr">{actualKottaj||'ثبت نشده'}</b></span></div>{mismatch&&<div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm font-bold">هشدار: شماره کوتاژ این سند با کوتاژ ثبت‌شده در اظهار پرونده مغایرت دارد؛ ثبت مسدود نمی‌شود.</div>}</section>
<section className="app-surface border app-border rounded-2xl p-4"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 className="font-black">ردیف‌های هزینه</h2><p className="app-muted text-xs">۵ ردیف نمونه در فرم واقعی قابل ثبت است؛ فرم از ابتدا ۳۰ ردیف دارد و با «افزودن ردیف» افزایش می‌یابد.</p></div>{canWrite&&<div className="flex gap-2"><button onClick={()=>setShowCategory(true)} className="px-3 py-2 rounded-xl border app-border text-sm font-bold">+ دسته جدید</button><button onClick={addRow} className="px-3 py-2 rounded-xl bg-[var(--primary)] text-white text-sm font-bold"><Plus size={15} className="inline ml-1"/>افزودن ردیف</button></div>}</div><div className="overflow-auto"><table className="voucher-lines w-full text-sm min-w-[1120px]"><thead><tr><th>ردیف</th><th>شرح</th><th>شماره فیش</th><th>بدهکار / ریال</th><th>بستانکار / ریال</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{lines.map((x,idx)=><tr key={x.id||'new-'+idx} className={x.status==='voided'?'voucher-voided':''}><td className="p-2 text-center font-bold">{x.row_number}</td><td className="p-2"><div className="min-w-[280px]"><input className="input" value={x.description} onChange={e=>ul(idx,'description',e.target.value)} readOnly={!canWrite||x.status==='voided'}/>{canWrite&&x.status==='active'?<select className="input mt-1 text-xs" value={x.category_id} onChange={e=>ul(idx,'category_id',e.target.value)}><option value="">دسته از پیش‌تعریف‌شده (اختیاری)</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name_fa}</option>)}</select>:null}</div></td><td className="p-2"><input className="input min-w-[140px]" value={x.receipt_number} onChange={e=>ul(idx,'receipt_number',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2"><input className="input min-w-[180px]" value={x.debit_amount} onChange={e=>ul(idx,'debit_amount',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2"><input className="input min-w-[180px]" value={x.credit_amount} onChange={e=>ul(idx,'credit_amount',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2 whitespace-nowrap">{x.status==='voided'?<span className="text-red-600 font-black">باطل<div className="text-[10px] font-normal">{x.void_reason}</div></span>:<span className="text-emerald-600 font-bold">فعال</span>}</td><td className="p-2">{canWrite&&x.status==='active'&&x.id?<button onClick={()=>{setVoidTarget(x);setVoidReason('')}} className="px-2 py-1 rounded-lg border border-red-500/40 text-red-600 text-xs font-bold"><Trash2 size={13} className="inline ml-1"/>باطل کردن</button>:null}</td></tr>)}</tbody><tfoot><tr className="font-black"><td colSpan={3} className="p-3 text-left">جمع نهایی</td><td className="p-3" dir="ltr">{money(previewDebit)} ریال</td><td className="p-3" dir="ltr">{money(previewCredit)} ریال</td><td colSpan={2}/></tr></tfoot></table></div>{voucher&&<div className="mt-3 text-xs app-muted">جمع تأییدشده در Postgres: بدهکار <b>{money(voucher.debit_total)} ریال</b> · بستانکار <b>{money(voucher.credit_total)} ریال</b></div>}</section>
{showCategory&&<div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"><div className="w-full max-w-md app-surface border app-border rounded-2xl p-5"><div className="flex justify-between items-center"><h3 className="font-black">دسته‌بندی جدید</h3><button className="icon-btn" onClick={()=>setShowCategory(false)}><X size={18}/></button></div><input className="input mt-4" value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="نام دسته"/><button className="mt-4 w-full px-4 py-3 rounded-xl bg-[var(--primary)] text-white font-bold" onClick={addCategory}>ثبت دسته</button></div></div>}
{voidTarget&&<div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"><div className="w-full max-w-lg app-surface border app-border rounded-2xl p-5"><div className="flex justify-between items-center"><h3 className="font-black text-red-600">باطل کردن ردیف {voidTarget.row_number}</h3><button className="icon-btn" onClick={()=>setVoidTarget(null)}><X size={18}/></button></div><p className="text-sm app-muted mt-3">حذف فیزیکی ممنوع است. این ردیف با دلیل، کاربر و زمان Void می‌شود.</p><textarea className="input mt-4 min-h-[100px]" value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="دلیل باطل شدن..."/><div className="flex gap-2 mt-4"><button className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold" disabled={saving||!voidReason.trim()} onClick={voidLine}>باطل کردن</button><button className="px-4 py-3 rounded-xl border app-border" onClick={()=>setVoidTarget(null)}>انصراف</button></div></div></div>}
</main>;
};