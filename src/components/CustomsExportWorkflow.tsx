import React,{useCallback,useEffect,useState}from'react';
import{AlertTriangle,RefreshCw,Save}from'lucide-react';
import{supabase}from'../lib/supabase';

type StageKey='documents'|'permits'|'declaration'|'valuation'|'loading'|'exit'|'completed';
type Stage={key:StageKey;label:string;description:string};
type Props={declarationId:string;organizationId:string;userId?:string;customsRegime:string;editable:boolean};
type State=Record<string,any>;
const stages:Stage[]=[
 {key:'documents',label:'اسناد و مشخصات کالا',description:'اطلاعات پایه اظهار و اسناد پشتیبان'},
 {key:'permits',label:'مجوزها و کنترل‌ها',description:'وضعیت مجوزهای موردنیاز بر اساس کالا و مسیر'},
 {key:'declaration',label:'ثبت اظهار',description:'ثبت شماره کوتاژ و تاریخ اظهار'},
 {key:'valuation',label:'ارزش و تعهدات',description:'ارزش اظهارشده و تعهدات مرتبط با رویه'},
 {key:'loading',label:'آماده‌سازی و بارگیری',description:'ثبت مستندات بارگیری و مقدار خروجی'},
 {key:'exit',label:'درب خروج و بستن عملیات',description:'تأیید خروج و ثبت تاریخ واقعی'},
 {key:'completed',label:'تکمیل پرونده',description:'کنترل نهایی و بستن گردش‌کار'}
];
const defaults:State={
 documents:{invoiceNo:'',goodsDescription:'',hsCode:'',originCountry:'',quantity:'',unit:'',documentsNote:''},
 permits:{status:'pending',requiredPermits:'',permitReferences:'',reviewNote:''},
 declaration:{kottajNumber:'',declarationDate:'',customsPath:'',declarationNote:''},
 valuation:{value:'',currency:'',exchangeRate:'',guaranteeStatus:'not_required',guaranteeReference:'',valuationNote:''},
 loading:{loadingFormNumber:'',loadingDate:'',loadedQuantity:'',loadingNote:''},
 exit:{exitStatus:'pending',exitDate:'',exitReference:'',exitNote:''},
 completed:{reviewed:false,closureNote:''}
};
const regimeNames:Record<string,string>={export_definitive:'صادرات قطعی',temporary_export:'صادرات موقت'};
const digits=(v:string)=>String(v||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const fa=(v:string|number)=>String(v??'').replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const fields:Record<string,{key:string;label:string;type?:string;options?:{value:string;label:string}[]}[]>={
 documents:[{key:'invoiceNo',label:'شماره فاکتور'},{key:'goodsDescription',label:'شرح کالا'},{key:'hsCode',label:'HS Code'},{key:'originCountry',label:'کشور مقصد'},{key:'quantity',label:'مقدار'},{key:'unit',label:'واحد'},{key:'documentsNote',label:'یادداشت اسناد'}],
 permits:[{key:'status',label:'وضعیت مجوزها',type:'select',options:[{value:'pending',label:'در انتظار بررسی'},{value:'approved',label:'تأیید شده'},{value:'not_required',label:'نیاز ندارد'}]},{key:'requiredPermits',label:'مجوزهای لازم / نهاد صادرکننده'},{key:'permitReferences',label:'شماره و مرجع مجوزها'},{key:'reviewNote',label:'توضیحات'}],
 declaration:[{key:'kottajNumber',label:'شماره کوتاژ'},{key:'declarationDate',label:'تاریخ اظهار (شمسی)',type:'date'},{key:'customsPath',label:'مسیر گمرکی',type:'select',options:[{value:'green',label:'سبز'},{value:'yellow',label:'زرد'},{value:'red',label:'قرمز'}]},{key:'declarationNote',label:'توضیحات اظهار'}],
 valuation:[{key:'value',label:'ارزش اظهارشده'},{key:'currency',label:'ارز'},{key:'exchangeRate',label:'نرخ تسعیر (در صورت نیاز)'},{key:'guaranteeStatus',label:'وضعیت تضمین / تعهد',type:'select',options:[{value:'not_required',label:'نیاز ندارد'},{value:'pending',label:'در انتظار'},{value:'provided',label:'ارائه شده'}]},{key:'guaranteeReference',label:'مرجع تضمین یا تعهد'},{key:'returnDeadline',label:'مهلت بازگشت (صادرات موقت)'},{key:'returnObligationRecorded',label:'تعهد بازگشت ثبت شده',type:'select',options:[{value:'',label:'انتخاب کنید'},{value:'yes',label:'بله'},{value:'no',label:'خیر'}]},{key:'valuationNote',label:'توضیحات ارزش'}],
 loading:[{key:'loadingFormNumber',label:'شماره فرم بارگیری'},{key:'loadingDate',label:'تاریخ بارگیری (شمسی)',type:'date'},{key:'loadedQuantity',label:'مقدار بارگیری‌شده'},{key:'loadingNote',label:'توضیحات بارگیری'}],
 exit:[{key:'exitStatus',label:'وضعیت خروج',type:'select',options:[{value:'pending',label:'در انتظار'},{value:'approved',label:'خروج تأیید شد'},{value:'not_applicable',label:'قابل اعمال نیست'}]},{key:'exitDate',label:'تاریخ خروج (شمسی)',type:'date'},{key:'exitReference',label:'شماره/مرجع خروج'},{key:'exitNote',label:'توضیحات'}],
 completed:[{key:'closureNote',label:'یادداشت بستن پرونده'}]
};
const required:Record<StageKey,string[]>={documents:['invoiceNo','goodsDescription','hsCode','quantity','unit'],permits:['status'],declaration:['kottajNumber','declarationDate'],valuation:['value','currency'],loading:['loadingFormNumber','loadingDate','loadedQuantity'],exit:['exitStatus'],completed:[]};
const isTemporary=(regime:string)=>regime==='temporary_export';
const empty=()=>JSON.parse(JSON.stringify(defaults)) as State;
const isJalaliDate=(value:string)=>{const v=digits(value).trim();const m=v.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);if(!m)return false;const month=Number(m[2]),day=Number(m[3]);return month>=1&&month<=12&&day>=1&&day<=(month<=6?31:month<=11?30:30);};
const Label:React.FC<{children:React.ReactNode}>=({children})=><label className="block text-xs app-muted">{children}</label>;
export const CustomsExportWorkflow:React.FC<Props>=({declarationId,organizationId,userId,customsRegime,editable})=>{
 const[state,setState]=useState<State>(empty);const[stage,setStage]=useState<StageKey>('documents');const[savedStage,setSavedStage]=useState<StageKey>('documents');const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[error,setError]=useState('');const[message,setMessage]=useState('');
 const isTemp=isTemporary(customsRegime);
 const currentIndex=stages.findIndex(s=>s.key===stage);
 const patch=(key:string,value:any)=>setState((prev:State)=>({...prev,[stage]:{...(prev[stage]||{}),[key]:value}}));
 const load=useCallback(async()=>{
  if(!declarationId||!organizationId)return;
  setLoading(true);setError('');
  try{
   const{data,error:e}=await supabase.from('customs_declaration_workflow').select('id,current_stage,procedure_state').eq('declaration_id',declarationId).eq('organization_id',organizationId).maybeSingle();
   if(e)throw e;
   const merged={...empty(),...(data?.procedure_state||{})};
   setState(merged);
   if(data?.current_stage&&stages.some(s=>s.key===data.current_stage)){setStage(data.current_stage as StageKey);setSavedStage(data.current_stage as StageKey)}
  }catch(e:any){setError(e?.message||'دریافت گردش‌کار انجام نشد')}finally{setLoading(false)}
 },[declarationId,organizationId]);
 useEffect(()=>{void load()},[load]);
 const validateStage=(key:StageKey):string[]=>{
  const missing=required[key].filter(k=>!String(state[key]?.[k]??'').trim());
  if(key==='completed'&&!state.completed?.reviewed)missing.push('reviewed');
  if(key==='permits'&&state.permits?.status==='pending')missing.push('تعیین تکلیف مجوزها');
  if(key==='valuation'&&state.valuation?.guaranteeStatus==='pending')missing.push('تعیین تکلیف تضمین');
  if(key==='exit'&&state.exit?.exitStatus==='pending')missing.push('تعیین وضعیت خروج');
  if(isTemp&&key==='valuation'&&!String(state.valuation?.returnDeadline||'').trim())missing.push('مهلت بازگشت');
  if(key==='declaration'&&state.declaration?.declarationDate&&!isJalaliDate(state.declaration.declarationDate))missing.push('تاریخ اظهار با قالب شمسی مانند ۱۴۰۵/۰۷/۲۱');
  if(key==='loading'&&state.loading?.loadingDate&&!isJalaliDate(state.loading.loadingDate))missing.push('تاریخ بارگیری با قالب شمسی مانند ۱۴۰۵/۰۷/۲۱');
  if(isTemp&&key==='valuation'&&state.valuation?.returnDeadline&&!isJalaliDate(state.valuation.returnDeadline))missing.push('مهلت بازگشت با قالب شمسی مانند ۱۴۰۵/۰۷/۲۱');
  if(isTemp&&key==='valuation'&&state.valuation?.returnObligationRecorded!=='yes')missing.push('ثبت تعهد بازگشت');
  if(isTemp&&key==='valuation'&&state.valuation?.guaranteeStatus==='not_required'&&!String(state.valuation?.guaranteeReference||'').trim())missing.push('مرجع یا توضیح عدم نیاز به تضمین');
  return missing;
 };
 const save=async(nextStage:StageKey=stage)=>{
  if(!editable||!declarationId||!organizationId)return;
  const targetIndex=stages.findIndex(s=>s.key===nextStage);const savedIndex=stages.findIndex(s=>s.key===savedStage);
  if(targetIndex>savedIndex){const blocked=stages.slice(savedIndex,targetIndex).flatMap(s=>validateStage(s.key).map(issue=>s.label+': '+issue));if(blocked.length){setError('برای ثبت پیشرفت، ابتدا این موارد را تکمیل کنید: '+blocked.join('، '));return}}
  setSaving(true);setError('');setMessage('');
  try{
   const payload={organization_id:organizationId,declaration_id:declarationId,current_stage:nextStage,procedure_state:state,updated_by:userId||null};
   const{error:e}=await supabase.from('customs_declaration_workflow').upsert(payload,{onConflict:'declaration_id'});
   if(e)throw e;
   setStage(nextStage);setSavedStage(nextStage);setMessage('گردش‌کار ذخیره شد. تغییرات در سابقه ممیزی ثبت می‌شود.');
  }catch(e:any){setError(e?.message||'ذخیره گردش‌کار انجام نشد')}finally{setSaving(false)}
 };
 const advance=async()=>{
  const missing=validateStage(stage);
  if(missing.length){setError('برای رفتن به مرحله بعد، موارد زیر را تکمیل کنید: '+missing.join('، '));return}
  const priorIssues=stages.slice(0,currentIndex).flatMap(s=>validateStage(s.key).map(issue=>s.label+': '+issue));
  if(priorIssues.length){setError('ابتدا مراحل قبلی را تکمیل کنید: '+priorIssues.join('، '));return}
  const next=stages[Math.min(currentIndex+1,stages.length-1)].key;
  await save(next);
 };
 if(loading)return <section className="rounded-2xl border app-border bg-[var(--surface)] p-5 text-sm app-muted">در حال دریافت گردش‌کار…</section>;
 return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5 space-y-4">
  <header className="flex items-start justify-between gap-3"><div><div className="text-xs app-muted">گردش‌کار اختصاصی رویه</div><h2 className="font-black text-lg mt-1">{regimeNames[customsRegime]||'رویه صادرات'}{isTemp?' · دارای تعهد بازگشت':''}</h2><p className="text-xs app-muted mt-1">ثبت مرحله‌ای اطلاعات؛ الزام‌ها باید مطابق مجوزها و مقررات واقعی پرونده بررسی شوند.</p></div><button type="button" onClick={()=>void load()} className="rounded-xl border app-border p-2" aria-label="بارگذاری مجدد"><RefreshCw size={16}/></button></header>
  {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"><AlertTriangle className="inline ml-1" size={15}/>{error}</div>}
  {message&&<div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{message}</div>}
  <nav className="grid grid-cols-2 md:grid-cols-4 gap-2">{stages.map((s,i)=><button key={s.key} type="button" onClick={()=>setStage(s.key)} className={`rounded-xl border p-3 text-right ${stage===s.key?'border-[var(--primary)] bg-[var(--primary)]/10':'app-border'}`}><div className="text-[11px] app-muted">مرحله {fa(i+1)}</div><div className="text-sm font-bold mt-1">{s.label}</div></button>)}</nav>
  <div className="rounded-xl border app-border p-4 space-y-4"><div><h3 className="font-bold">{stages[currentIndex].label}</h3><p className="text-xs app-muted mt-1">{stages[currentIndex].description}</p></div>
   {fields[stage].map(field=><div key={field.key}><Label>{field.label}</Label>{field.type==='select'?<select disabled={!editable} value={state[stage]?.[field.key]??''} onChange={e=>patch(field.key,e.target.value)} className="mt-1 w-full rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{field.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={!editable} type={field.type==='date'?'text':'text'} inputMode={field.key==='value'||field.key==='quantity'||field.key==='loadedQuantity'||field.key==='exchangeRate'?'decimal':'text'} placeholder={field.type==='date'?'مثلاً ۱۴۰۵/۰۷/۲۱':''} value={state[stage]?.[field.key]??''} onChange={e=>patch(field.key,e.target.value)} className="mt-1 w-full rounded-xl border app-border bg-[var(--surface)] p-3 text-sm"/>}</div>)}
   {isTemp&&stage==='valuation'&&<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><b>صادرات موقت:</b> مرجع تضمین یا توضیح مستند عدم نیاز و تعهد/مهلت بازگشت را در یادداشت ارزش ثبت کنید.</div>}
   {stage==='completed'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={!!state.completed?.reviewed} onChange={e=>patch('reviewed',e.target.checked)}/><span>کنترل نهایی انجام شد و پرونده برای بستن بررسی شده است.</span></label>}
   <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" disabled={!editable||saving} onClick={()=>void save()} className="inline-flex items-center gap-2 rounded-xl border app-border px-4 py-2.5 text-sm font-bold"><Save size={15}/>ذخیره مرحله</button><button type="button" disabled={!editable||saving||stage==='completed'} onClick={()=>void advance()} className="rounded-xl bg-[var(--primary)] text-white px-4 py-2.5 text-sm font-bold">{saving?'در حال ذخیره…':'اعتبارسنجی و مرحله بعد'}</button></div>
   {!editable&&<p className="text-xs app-muted">این حساب فقط اجازه مشاهده گردش‌کار را دارد.</p>}
  </div>
  {isTemp&&<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">یادآوری: برای صادرات موقت، تاریخ/مهلت بازگشت و بستن تعهد باید در مستندات پرونده ثبت شود؛ این فرم جایگزین تأیید قانونی یا سامانه EPL نیست.</div>}
 </section>
};
