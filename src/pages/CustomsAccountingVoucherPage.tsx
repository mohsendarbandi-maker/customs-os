import React,{useEffect,useMemo,useState}from'react';
import{ArrowRight,BookOpen,Check,Plus,Printer,Trash2,X,LockKeyhole}from'lucide-react';
import{Link,useNavigate,useParams,useSearchParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';
import{useCaseSelectorData,CaseSelectorRow}from'../hooks/useCaseSelectorData';
import{isoToJalali,jalaliToIso,daysBetweenIso}from'../lib/shared/jalali';
import'../styles/customs-accounting-voucher.css';

type Line={id?:string;row_number:number;description:string;category_id:string;description_category:string;receipt_number:string;debit_amount:string;credit_amount:string;status:'active'|'voided';void_reason?:string|null;voided_at?:string|null};
const DIGITS='۰۱۲۳۴۵۶۷۸۹';
const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(Number(n)||0));
const num=(v:string|number)=>Number(String(v??'').replace(/[۰-۹]/g,d=>String(DIGITS.indexOf(d))).replace(/,/g,''))||0;
const fmt3=(v:string|number)=>Number(v||0).toFixed(3);
const blank=(row:number):Line=>({row_number:row,description:'',category_id:'',description_category:'',receipt_number:'',debit_amount:'',credit_amount:'',status:'active'});

const JalaliField=({valueIso,onChange,sourceIso,disabled=false}:{valueIso:string;onChange:(iso:string)=>void;sourceIso:string|null;disabled?:boolean})=>{
 const[text,setText]=useState(isoToJalali(valueIso));
 useEffect(()=>{setText(isoToJalali(valueIso))},[valueIso]);
 const commit=(value:string)=>{setText(value);const iso=jalaliToIso(value);if(iso)onChange(iso)};
 const valid=jalaliToIso(text);
 return <div><input className={'input mt-1 '+(!valid&&text?'border-red-500':'')} value={text} onChange={e=>commit(e.target.value)} onBlur={()=>{if(text&&!jalaliToIso(text)&&valueIso)setText(isoToJalali(valueIso))}} placeholder="۱۴۰۵/۰۷/۰۷" inputMode="numeric" dir="ltr" readOnly={disabled}/>{sourceIso&&<div className="text-[10px] app-muted mt-1">مقدار منبع: {isoToJalali(sourceIso)}</div>}</div>;
};

export const CustomsAccountingVoucherPage:React.FC=()=>{
 const{id}=useParams();const isEdit=!!id&&id!=='new';const navigate=useNavigate();const[params]=useSearchParams();const{profile}=useAuth();
 const{clients,rows,loading:selectorLoading,error:selectorError}=useCaseSelectorData(profile?.organization_id);
 const canWrite=!!profile&&['owner','admin','accountant'].includes(profile.role);
 const[shipmentId,setShipmentId]=useState(params.get('shipmentId')||'');const[clientId,setClientId]=useState('');
 const[categories,setCategories]=useState<any[]>([]);const[vouchers,setVouchers]=useState<any[]>([]);const[voucher,setVoucher]=useState<any>(null);const[loading,setLoading]=useState(false);const[saving,setSaving]=useState(false);const[message,setMessage]=useState('');
 const[categoryName,setCategoryName]=useState('');const[showCategory,setShowCategory]=useState(false);const[voidTarget,setVoidTarget]=useState<Line|null>(null);const[voidReason,setVoidReason]=useState('');
 const[tonnageManual,setTonnageManual]=useState(false);const[entryText,setEntryText]=useState('');const[permitText,setPermitText]=useState('');
 const[header,setHeader]=useState({company_name:'',cargo_type:'',tonnage:'',unit_count:'',unit_type:'',cargo_entry_date:'',permit_issue_date:'',kottaj_number:''});
 const[lines,setLines]=useState<Line[]>(Array.from({length:30},(_,i)=>blank(i+1)));

 const shipment=useMemo<CaseSelectorRow|undefined>(()=>rows.find(r=>r.id===shipmentId),[rows,shipmentId]);
 const filteredShipments=useMemo(()=>clientId?rows.filter(r=>r.case_id&&r.client_id===clientId):[],[rows,clientId]);
 const sourceEntry=shipment?.warehouse_receipt_date||null;
 const sourcePermit=shipment?.initial_warehousing_invoice_confirmed_at?shipment.initial_warehousing_invoice_confirmed_at.slice(0,10):null;
 const grossTons=shipment?.gross_weight_kg==null?null:Number(shipment.gross_weight_kg)/1000;
 const entryWarning=sourceEntry&&header.cargo_entry_date&&daysBetweenIso(sourceEntry,header.cargo_entry_date)!==null&&daysBetweenIso(sourceEntry,header.cargo_entry_date)! > 365;
 const permitWarning=sourcePermit&&header.permit_issue_date&&daysBetweenIso(sourcePermit,header.permit_issue_date)!==null&&daysBetweenIso(sourcePermit,header.permit_issue_date)! > 365;

 useEffect(()=>{if(!shipmentId)return;setClientId(shipment?.client_id||'');if(!isEdit&&shipment){setHeader({company_name:shipment.client_name||'',cargo_type:shipment.cargo_description||'',tonnage:grossTons==null?'':fmt3(grossTons),unit_count:shipment.cargo_count==null?'':String(shipment.cargo_count),unit_type:shipment.cargo_count_unit||'',cargo_entry_date:sourceEntry||'',permit_issue_date:sourcePermit||'',kottaj_number:''});setTonnageManual(false)}},[shipmentId,shipment?.client_id,shipment?.gross_weight_kg,shipment?.warehouse_receipt_date,shipment?.initial_warehousing_invoice_confirmed_at,isEdit]);

 useEffect(()=>{setEntryText(isoToJalali(header.cargo_entry_date));setPermitText(isoToJalali(header.permit_issue_date))},[header.cargo_entry_date,header.permit_issue_date]);

 const loadCategories=async()=>{const{data,error}=await supabase.from('finance_cost_categories').select('id,code,name_fa,name_en,is_active').eq('is_active',true).order('sort_order').order('name_fa');if(error)setMessage(error.message);setCategories(data||[])};
 const loadList=async()=>{if(isEdit)return;const{data,error}=await supabase.from('customs_accounting_vouchers').select('id,voucher_number,case_id,client_id,company_name,kottaj_number,debit_total,credit_total,balance_total,is_balanced,created_at,clients(name)').order('created_at',{ascending:false});if(error)setMessage(error.message);setVouchers(data||[])};
 const loadVoucher=async(voucherId:string)=>{
   setLoading(true);
   const[{data:v,error:ve},{data:l,error:le}]=await Promise.all([
    supabase.from('customs_accounting_vouchers').select('*,cases(case_number,client_id,registration_order_no,cargo_description,warehouse_receipt_date,initial_warehousing_invoice_confirmed_at,clients(name)),clients(name),customs_declarations(id,kottaj_number)').eq('id',voucherId).single(),
    supabase.from('voucher_line_items').select('*').eq('voucher_id',voucherId).order('row_number')
   ]);
   if(ve||le){setMessage(ve?.message||le?.message||'خطا در خواندن سند');setLoading(false);return}
   setVoucher(v);
   const match=rows.find(r=>r.case_id===v.case_id);
   setShipmentId(match?.id||'');setClientId(v.client_id||match?.client_id||'');
   const sourceGross=match?.gross_weight_kg==null?null:Number(match.gross_weight_kg)/1000;
   setTonnageManual(Boolean(v.tonnage_is_manually_overridden));
   setHeader({company_name:v.company_name||v.clients?.name||match?.client_name||'',cargo_type:v.cargo_type||match?.cargo_description||'',tonnage:v.tonnage==null?'':fmt3(v.tonnage),unit_count:v.unit_count==null?'':String(v.unit_count),unit_type:v.unit_type||'',cargo_entry_date:v.cargo_entry_date||'',permit_issue_date:v.permit_issue_date||'',kottaj_number:v.kottaj_number||''});
   if(!match&&sourceGross!==null)setMessage('محموله مرتبط با این سند در فهرست فعلی پیدا نشد؛ اطلاعات سند همچنان فقط‌خواندنی است.');
   const mapped=(l||[]).map((x:any)=>({id:x.id,row_number:x.row_number,description:x.description||'',category_id:x.category_id||'',description_category:x.description_category||'',receipt_number:x.receipt_number||'',debit_amount:x.debit_amount?String(x.debit_amount):'',credit_amount:x.credit_amount?String(x.credit_amount):'',status:x.status,void_reason:x.void_reason||null,voided_at:x.voided_at||null}));
   setLines(mapped.length?mapped:Array.from({length:30},(_,i)=>blank(i+1)));setLoading(false);
 };
 useEffect(()=>{void loadCategories();if(isEdit)void loadVoucher(id!);else void loadList()},[id]);
 useEffect(()=>{const presetShipment=params.get('shipmentId');const presetCase=params.get('caseId');const preset=presetShipment||presetCase;if(!isEdit&&preset&&rows.length){const r=presetShipment?rows.find(x=>x.id===preset):rows.find(x=>x.case_id===preset);if(r){setShipmentId(r.id);setClientId(r.client_id||'')}}},[params,rows,isEdit]);

 const previewDebit=useMemo(()=>lines.filter(x=>x.status==='active').reduce((a,x)=>a+num(x.debit_amount),0),[lines]);
 const previewCredit=useMemo(()=>lines.filter(x=>x.status==='active').reduce((a,x)=>a+num(x.credit_amount),0),[lines]);
 const previewBalance=Math.abs(previewDebit-previewCredit);const previewBalanced=previewDebit===previewCredit;

 const uh=(k:keyof typeof header,v:string)=>setHeader(h=>({...h,[k]:v}));
 const ul=(idx:number,k:keyof Line,v:string)=>setLines(p=>p.map((x,i)=>{if(i!==idx)return x;const n={...x,[k]:v};if(k==='debit_amount'&&num(v)>0)n.credit_amount='';if(k==='credit_amount'&&num(v)>0)n.debit_amount='';if(k==='category_id'){const suggested=categories.find(c=>c.id===v)?.name_fa||'';n.description_category=suggested;if(suggested&&!n.description.trim())n.description=suggested;}return n}));
 const addRow=()=>setLines(p=>p.concat(blank((p[p.length-1]?.row_number||0)+1)));

 const selectClient=(value:string)=>{setClientId(value);setShipmentId('');setVoucher(null);setTonnageManual(false);setHeader({company_name:'',cargo_type:'',tonnage:'',unit_count:'',unit_type:'',cargo_entry_date:'',permit_issue_date:'',kottaj_number:''})};
 const selectShipment=(value:string)=>{setShipmentId(value);const s=rows.find(r=>r.id===value);if(!s)return;setHeader({company_name:s.client_name||'',cargo_type:s.cargo_description||'',tonnage:s.gross_weight_kg==null?'':fmt3(Number(s.gross_weight_kg)/1000),unit_count:s.cargo_count==null?'':String(s.cargo_count),unit_type:s.cargo_count_unit||'',cargo_entry_date:s.warehouse_receipt_date||'',permit_issue_date:s.initial_warehousing_invoice_confirmed_at?s.initial_warehousing_invoice_confirmed_at.slice(0,10):'',kottaj_number:''});setTonnageManual(false)};

 const save=async()=>{
   if(!canWrite){setMessage('دسترسی ثبت و ویرایش سند حسابداری ندارید.');return}
   if(!clientId||!shipment?.case_id){setMessage('ابتدا صاحب کالا و سپس محموله همان صاحب کالا را انتخاب کنید.');return}
   if(!header.company_name.trim()){setMessage('نام صاحب کالا از Client معتبر دریافت نشد.');return}
   const entryIso=jalaliToIso(entryText);const permitIso=jalaliToIso(permitText);
   if(entryText&&!entryIso){setMessage('تاریخ ورود را به‌صورت شمسی صحیح وارد کنید.');return}
   if(permitText&&!permitIso){setMessage('تاریخ صدور پروانه را به‌صورت شمسی صحیح وارد کنید.');return}
   if(!header.tonnage||num(header.tonnage)<0){setMessage('وزن ناخالص معتبر نیست.');return}
   const active=lines.filter(x=>x.status==='active'&&(x.description.trim()||x.description_category.trim()||num(x.debit_amount)>0||num(x.credit_amount)>0));
   for(const x of active){const effectiveDescription=x.description.trim()||x.description_category.trim();if(!effectiveDescription){setMessage('شرح برای ردیف دارای مبلغ الزامی است.');return}if(num(x.debit_amount)>0&&num(x.credit_amount)>0){setMessage('در هر ردیف فقط بدهکار یا بستانکار می‌تواند مقدار داشته باشد.');return}if(num(x.debit_amount)<=0&&num(x.credit_amount)<=0){setMessage('ردیف ثبت‌شده باید مبلغ بدهکار یا بستانکار داشته باشد.');return}if(x.receipt_number&&!/^[0-9۰-۹]+$/.test(x.receipt_number.trim())){setMessage('شماره فیش فقط باید عددی باشد.');return}}
   setSaving(true);setMessage('');
   try{
    let voucherId=isEdit?id:'';
    if(!voucherId){const{data,error}=await supabase.rpc('create_customs_accounting_voucher',{p_case_id:shipment.case_id,p_company_name:header.company_name,p_cargo_type:header.cargo_type,p_tonnage:tonnageManual?num(header.tonnage):null,p_unit_count:num(header.unit_count),p_unit_type:header.unit_type,p_cargo_entry_date:entryIso,p_kottaj_number:null,p_permit_issue_date:permitIso});if(error)throw error;voucherId=data?.voucher_id;if(!voucherId)throw new Error('شناسه سند پس از ایجاد دریافت نشد.')}
    const{data,error}=await supabase.rpc('save_customs_accounting_voucher',{p_voucher_id:voucherId,p_company_name:header.company_name,p_cargo_type:header.cargo_type,p_tonnage:num(header.tonnage),p_unit_count:num(header.unit_count),p_unit_type:header.unit_type,p_cargo_entry_date:entryIso,p_kottaj_number:null,p_permit_issue_date:permitIso,p_lines:active.map(x=>({id:x.id||null,row_number:x.row_number,description:x.description.trim()||x.description_category.trim(),category_id:x.category_id||null,description_category:x.description_category||null,receipt_number:x.receipt_number.trim()||null,debit_amount:num(x.debit_amount),credit_amount:num(x.credit_amount)}))});
    if(error)throw error;
    setMessage('سند با موفقیت ذخیره شد. جمع و وضعیت توسط PostgreSQL محاسبه شد.');
    navigate('/finance/accounting-vouchers/'+voucherId,{replace:true});await loadVoucher(voucherId);
   }catch(e:any){setMessage(e?.message||'خطا در ذخیره سند')}finally{setSaving(false)}
 };

 const voidLine=async()=>{if(!voidTarget?.id||!voidReason.trim())return;setSaving(true);const{error}=await supabase.rpc('void_customs_voucher_line',{p_line_id:voidTarget.id,p_reason:voidReason.trim()});if(error)setMessage(error.message);else{setMessage('ردیف باطل شد؛ در سند/چاپ باقی می‌ماند و از جمع خارج شد.');setVoidTarget(null);setVoidReason('');if(id)await loadVoucher(id)}setSaving(false)};
 const addCategory=async()=>{if(!canWrite||!categoryName.trim())return;const{data,error}=await supabase.from('finance_cost_categories').insert({organization_id:profile!.organization_id,code:'voucher_custom_'+Date.now(),name_fa:categoryName.trim(),name_en:null,description:'دسته‌بندی سند هزینه پروانه قطعی',is_pass_through:false,is_billable_default:true,is_active:true,sort_order:999}).select('id,code,name_fa,name_en,is_active').single();if(error){setMessage(error.message);return}setCategories(p=>p.concat(data||[]));setCategoryName('');setShowCategory(false);setMessage('دسته‌بندی اضافه شد.')};

 if(!id)return <main dir="rtl" className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black flex items-center gap-2"><BookOpen size={22}/>اسناد هزینه پروانه قطعی</h1><p className="app-muted">دفتر اسناد حسابداری متصل به پرونده</p></div><div className="flex gap-2">{canWrite&&<Link to="/finance/accounting-vouchers/new" className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Plus size={16} className="inline ml-1"/>سند جدید</Link>}<Link to="/finance" className="icon-btn"><ArrowRight size={18}/></Link></div></header>{message&&<div className="app-surface border app-border rounded-xl p-3">{message}</div>}<section className="app-surface border app-border rounded-2xl p-4 overflow-auto"><table className="w-full text-sm min-w-[850px]"><thead><tr className="border-b app-border"><th className="p-2 text-right">شماره سند</th><th>صاحب کالا</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th><th>وضعیت</th><th></th></tr></thead><tbody>{vouchers.map(v=><tr key={v.id} className="border-b app-border/50"><td className="p-2 font-bold" dir="ltr">{v.voucher_number}</td><td>{v.clients?.name||v.company_name}</td><td dir="ltr">{money(v.debit_total)} ریال</td><td dir="ltr">{money(v.credit_total)} ریال</td><td dir="ltr">{money(v.balance_total)} ریال</td><td>{v.is_balanced?'متعادل':'نامتعادل'}</td><td className="whitespace-nowrap"><Link className="text-[var(--primary)] font-bold ml-3" to={'/finance/accounting-vouchers/'+v.id}>مشاهده</Link><button className="text-[var(--primary)] font-bold" onClick={()=>window.open('/finance/accounting-vouchers/print?id='+encodeURIComponent(v.id),'_blank','noopener,noreferrer')}><Printer size={14} className="inline ml-1"/>چاپ</button></td></tr>)}</tbody></table>{!loading&&!vouchers.length&&<div className="p-8 text-center app-muted">سندی ثبت نشده است.</div>}</section></main>;

 const serverBalance=Number(voucher?.balance_total??previewBalance);const serverBalanced=Boolean(voucher?voucher.is_balanced:previewBalanced);
 return <main dir="rtl" className="space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Link to="/finance/accounting-vouchers" className="icon-btn"><ArrowRight size={18}/></Link><div><h1 className="text-2xl font-black">سند حسابداری هزینه پروانه قطعی <span className="app-muted text-base">{voucher?'#'+voucher.voucher_number:''}</span></h1><p className="app-muted text-sm">Case → Cargo/Maritime → Voucher → Finance</p></div></div><div className="flex gap-2">{isEdit&&<button onClick={()=>window.open('/finance/accounting-vouchers/print?id='+encodeURIComponent(id!),'_blank','noopener,noreferrer')} className="px-4 py-2 rounded-xl border app-border font-bold"><Printer size={16} className="inline ml-1"/>چاپ / PDF</button>}{canWrite&&<button onClick={save} disabled={saving||loading} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Check size={16} className="inline ml-1"/>{saving?'در حال ذخیره...':'ذخیره سند'}</button>}</div></header>
  {(selectorError||message)&&<div className="app-surface border app-border rounded-xl p-3">{selectorError||message}</div>}
  <section className="app-surface border app-border rounded-2xl p-4">
   <div className="grid md:grid-cols-2 gap-4">
    <label className="text-xs app-muted">۱. صاحب کالا<select value={clientId} onChange={e=>selectClient(e.target.value)} className="input mt-1" disabled={isEdit||!canWrite}><option value="">ابتدا صاحب کالا را انتخاب کنید</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="text-xs app-muted">۲. محموله / Case<select value={shipmentId} onChange={e=>selectShipment(e.target.value)} className="input mt-1" disabled={isEdit||!clientId||!canWrite}><option value="">{clientId?'محموله همان صاحب کالا را انتخاب کنید':'ابتدا صاحب کالا را انتخاب کنید'}</option>{filteredShipments.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></label>
   </div>
   {shipment&&<div className="mt-4 rounded-2xl border app-border bg-[var(--surface-2)] p-4"><div className="font-black">{shipment.display_name}</div><div className="text-xs app-muted mt-1">منبع نمایش: همان فرمت مشترک صفحه پرونده · ترتیب بر اساس created_at پرونده</div></div>}
  </section>
  {shipment&&<section className="app-surface border app-border rounded-2xl p-4">
   <div className="grid md:grid-cols-3 gap-4">
    <label className="text-xs app-muted">صاحب کالا<input className="input mt-1" value={header.company_name} readOnly/></label>
    <label className="text-xs app-muted">نوع کالا<input className="input mt-1" value={header.cargo_type} readOnly/></label>
    <label className="text-xs app-muted">تعداد<input className="input mt-1" value={header.unit_count} dir="ltr" readOnly/></label>
    <label className="text-xs app-muted">واحد تعداد<input className="input mt-1" value={header.unit_type} readOnly/></label>
    <label className="text-xs app-muted">تناژ — وزن ناخالص (تن)<div className="flex gap-2 mt-1"><input className="input" value={header.tonnage} onChange={e=>uh('tonnage',e.target.value)} dir="ltr" readOnly={!canWrite||(!tonnageManual)}/>{canWrite&&<button type="button" className="px-3 rounded-xl border app-border text-xs font-bold whitespace-nowrap" onClick={()=>setTonnageManual(v=>!v)}>{tonnageManual?'قفل':'اصلاح دستی'}</button>}</div><div className="text-[10px] app-muted mt-1">منبع Gross Weight: {shipment.gross_weight_kg==null?'ثبت نشده':Number(shipment.gross_weight_kg).toFixed(3)+' kg'} · مقدار سند: {grossTons==null?'—':fmt3(grossTons)+' ton'}</div></label>
    <label className="text-xs app-muted">شماره سند / صورتحساب<div className="input mt-1 font-bold" dir="ltr">{voucher?.voucher_number||'بعد از اولین ذخیره ایجاد می‌شود'}</div></label>
    <label className="text-xs app-muted">تاریخ ورود کالا — شمسی<JalaliField valueIso={header.cargo_entry_date} sourceIso={sourceEntry} onChange={iso=>uh('cargo_entry_date',iso)} disabled={!canWrite}/></label>
    <label className="text-xs app-muted">تاریخ صدور پروانه — شمسی<JalaliField valueIso={header.permit_issue_date} sourceIso={sourcePermit} onChange={iso=>uh('permit_issue_date',iso)} disabled={!canWrite}/></label>
   </div>
   {entryWarning&&<div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-xs font-bold">هشدار: تاریخ ورود دستی بیش از یک سال با تاریخ قبض انبار منبع فاصله دارد.</div>}
   {permitWarning&&<div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-xs font-bold">هشدار: تاریخ صدور پروانه دستی بیش از یک سال با زمان تأیید صورتحساب انبارداری اولیه فاصله دارد.</div>}
   {voucher&&(voucher.cargo_entry_date_is_manually_overridden||voucher.permit_issue_date_is_manually_overridden||voucher.tonnage_is_manually_overridden)&&<div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs flex items-center gap-2"><LockKeyhole size={15}/><span>این سند دارای Override دستی ثبت‌شده در دیتابیس و Audit Log است.</span></div>}
  </section>}
  <section className="app-surface border app-border rounded-2xl p-4">
   <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 className="font-black">ردیف‌های هزینه</h2><p className="app-muted text-xs mt-1">۳۰ ردیف اولیه؛ ردیف Void شده حفظ می‌شود و در جمع نمی‌آید.</p></div>{canWrite&&<div className="flex gap-2"><button onClick={()=>setShowCategory(true)} className="px-3 py-2 rounded-xl border app-border text-sm font-bold">+ دسته جدید</button><button onClick={addRow} className="px-3 py-2 rounded-xl bg-[var(--primary)] text-white text-sm font-bold"><Plus size={15} className="inline ml-1"/>افزودن ردیف</button></div>}</div>
   <div className="overflow-auto"><table className="voucher-lines w-full text-sm min-w-[1120px]"><thead><tr><th>ردیف</th><th>شرح</th><th>شماره فیش</th><th>بدهکار / ریال</th><th>بستانکار / ریال</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{lines.map((x,idx)=><tr key={x.id||'new-'+idx} className={x.status==='voided'?'voucher-voided':''}><td className="p-2 text-center font-bold">{x.row_number}</td><td className="p-2"><div className="min-w-[280px]"><input className="input" value={x.description} onChange={e=>ul(idx,'description',e.target.value)} readOnly={!canWrite||x.status==='voided'}/>{canWrite&&x.status==='active'?<select className="input mt-1 text-xs" value={x.category_id} onChange={e=>ul(idx,'category_id',e.target.value)}><option value="">دسته‌بندی (اختیاری)</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name_fa}</option>)}</select>:null}</div></td><td className="p-2"><input className="input min-w-[140px]" value={x.receipt_number} onChange={e=>ul(idx,'receipt_number',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2"><input className="input min-w-[180px]" value={x.debit_amount} onChange={e=>ul(idx,'debit_amount',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2"><input className="input min-w-[180px]" value={x.credit_amount} onChange={e=>ul(idx,'credit_amount',e.target.value)} inputMode="numeric" dir="ltr" readOnly={!canWrite||x.status==='voided'}/></td><td className="p-2 whitespace-nowrap">{x.status==='voided'?<span className="text-slate-500 font-black">باطل<div className="text-[10px] font-normal text-slate-500">{x.void_reason}</div></span>:<span className="text-emerald-600 font-bold">فعال</span>}</td><td className="p-2">{canWrite&&x.status==='active'&&x.id?<button onClick={()=>{setVoidTarget(x);setVoidReason('')}} className="px-2 py-1 rounded-lg border border-slate-400/50 text-slate-600 text-xs font-bold"><Trash2 size={13} className="inline ml-1"/>باطل کردن</button>:null}</td></tr>)}</tbody><tfoot><tr className="font-black"><td colSpan={3} className="p-3 text-left">جمع بدهکار / بستانکار</td><td className="p-3" dir="ltr">{money(previewDebit)} ریال</td><td className="p-3" dir="ltr">{money(previewCredit)} ریال</td><td colSpan={2}></td></tr></tfoot></table></div>
   <div className={'mt-4 rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 '+(serverBalanced?'border-emerald-500/40 bg-emerald-500/10':'border-amber-500/40 bg-amber-500/10')}><div><div className="text-xs app-muted">جمع کل / مانده سند</div><div className="text-2xl font-black mt-1" dir="ltr">{money(serverBalance)} ریال</div></div><div className={serverBalanced?'text-emerald-700 dark:text-emerald-300':'text-amber-700 dark:text-amber-300'}><b>{serverBalanced?'Balanced / سند متعادل':'Unbalanced / سند نامتعادل'}</b><div className="text-xs mt-1">فرمول: | بدهکار فعال − بستانکار فعال | · در سند ذخیره‌شده مقدار نهایی از PostgreSQL خوانده می‌شود.</div></div></div>
   {voucher&&<div className="mt-3 text-xs app-muted">Server: بدهکار {money(voucher.debit_total)} · بستانکار {money(voucher.credit_total)} · مانده {money(voucher.balance_total)}</div>}
  </section>
  {showCategory&&<div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"><div className="w-full max-w-md app-surface border app-border rounded-2xl p-5"><div className="flex justify-between items-center"><h3 className="font-black">دسته‌بندی جدید</h3><button className="icon-btn" onClick={()=>setShowCategory(false)}><X size={18}/></button></div><input className="input mt-4" value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="نام دسته"/><button className="mt-4 w-full px-4 py-3 rounded-xl bg-[var(--primary)] text-white font-bold" onClick={addCategory}>ثبت دسته</button></div></div>}
  {voidTarget&&<div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"><div className="w-full max-w-lg app-surface border app-border rounded-2xl p-5"><div className="flex justify-between items-center"><h3 className="font-black text-slate-600">باطل کردن ردیف {voidTarget.row_number}</h3><button className="icon-btn" onClick={()=>setVoidTarget(null)}><X size={18}/></button></div><p className="text-sm app-muted mt-3">حذف فیزیکی ممنوع است؛ دلیل، کاربر و زمان Void ثبت می‌شود.</p><textarea className="input mt-4 min-h-[100px]" value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="دلیل باطل شدن..."/><div className="flex gap-2 mt-4"><button className="flex-1 px-4 py-3 rounded-xl bg-slate-700 text-white font-bold" disabled={saving||!voidReason.trim()} onClick={voidLine}>باطل کردن</button><button className="px-4 py-3 rounded-xl border app-border" onClick={()=>setVoidTarget(null)}>انصراف</button></div></div></div>}
 </main>;
};