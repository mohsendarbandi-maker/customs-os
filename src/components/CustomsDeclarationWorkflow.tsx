import React,{useCallback,useEffect,useMemo,useState}from'react';
import{AlertTriangle,Clock3,RefreshCw,Save,ShieldCheck}from'lucide-react';
import{supabase}from'../lib/supabase';
import{compareJalaliDates,getAbandonedGoodsWarnings,getWorkflowStageIssues,type CustomsWorkflowValidationState}from'../lib/customsDeclarationWorkflow';

type WorkflowRow={
 id:string;organization_id:string;declaration_id:string;current_stage:string;
 evaluation_state:Record<string,any>;expertise_state:Record<string,any>;cashier_state:Record<string,any>;
 loading_permit_state:Record<string,any>;exit_state:Record<string,any>;port_charges_state:Record<string,any>;
 notes:string|null;updated_at:string;
};
type WorkflowEvent={id:string;event_type:'created'|'stage_changed'|'saved';previous_stage:string|null;current_stage:string;changed_fields:string[];actor_id:string|null;created_at:string};
type Props={declarationId:string;organizationId:string;userId?:string;customsRegime:string;customsPath:string;editable:boolean};
const stages=[['evaluation','ارزیابی'],['expertise','کارشناسی و مجوزها'],['cashier','صندوق'],['loading_permit','مجوز بارگیری'],['exit','درب خروج'],['port_charges','عوارض بندری'],['abandoned','متروکه'],['completed','تکمیل']] as const;
const emptyEvaluation={status:'not_required',evaluator_number:'',expert_requested:false,expert_request_note:''};
const emptyExpertise={appointment_status:'not_requested',appointment_number:'',road_authority_status:'not_required',plant_quarantine_status:'not_required',standard:{expert_review:'pending',inspection_status:'not_requested',inspection_company:'',inspection_fee:null,inspection_paid:false,inspection_invoice_received:false,inspection_invoice_status:'pending',sample_status:'not_sent',laboratory:'',results_uploaded:false,standard_fee:null,standard_fee_paid:false,standard_notified:false}};
const emptyCashier={method:'pending',cash_paid_irr:null,guarantee_duties:false,guarantee_vat:false,guarantee_reference:''};
const emptyLoadingPermit={clause2_request_status:'not_required',tax_permission_status:'pending',central_bank_status:'pending',sata_code:'',clearance_90_percent_requested:false,comment:''};
const emptyExit={loading_permission_status:'pending',financial_registration_status:'pending',weighbridge_required:false,weighbridge_demand_irr:null,weighbridge_paid:false,loading_completed_at:''};
const emptyPort={insurance_policy_no:'',insurance_issue_date:'',insurance_followup_status:'pending',warehouse_receipt_date:'',initial_invoice_status:'pending',transport_power_of_attorney_status:'pending',loading_form_received_at:'',loading_started_at:'',supplemental_invoice_status:'not_required',last_truck_loaded_at:''};
const digits=(v:string)=>String(v||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const faDigits=(v:string|number)=>String(v??'').replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const Label:React.FC<{children:React.ReactNode}>=({children})=><label className="block min-w-0 text-xs app-muted"><span className="block mb-1.5">{children}</span></label>;

export const CustomsDeclarationWorkflow:React.FC<Props>=({declarationId,organizationId,userId,customsRegime,customsPath,editable})=>{
 const[row,setRow]=useState<WorkflowRow|null>(null);
 const[stage,setStage]=useState('evaluation');
 const[evaluation,setEvaluation]=useState<Record<string,any>>(emptyEvaluation);
 const[expertise,setExpertise]=useState<Record<string,any>>(emptyExpertise);
 const[cashier,setCashier]=useState<Record<string,any>>(emptyCashier);
 const[loadingPermit,setLoadingPermit]=useState<Record<string,any>>(emptyLoadingPermit);
 const[exitState,setExitState]=useState<Record<string,any>>(emptyExit);
 const[port,setPort]=useState<Record<string,any>>(emptyPort);
 const[notes,setNotes]=useState('');
 const[commodity,setCommodity]=useState({vesselType:'',description:'',hsCode:''});
 const[loading,setLoading]=useState(true);
 const[saving,setSaving]=useState(false);
 const[error,setError]=useState('');
 const[message,setMessage]=useState('');
 const[history,setHistory]=useState<WorkflowEvent[]>([]);
 const[historyUnavailable,setHistoryUnavailable]=useState(false);
 const isImport=customsRegime==='import_definitive';

 const refreshHistory=useCallback(async()=>{
  if(!declarationId||!organizationId){setHistory([]);return}
  setHistoryUnavailable(false);
  const{data,error:historyError}=await supabase.from('customs_declaration_workflow_events').select('id,event_type,previous_stage,current_stage,changed_fields,actor_id,created_at').eq('declaration_id',declarationId).eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(8);
  if(historyError){setHistory([]);setHistoryUnavailable(true);return}
  setHistory((data||[]) as WorkflowEvent[]);setHistoryUnavailable(false);
 },[declarationId,organizationId]);

 const defaults=useCallback((data:{vesselType:string;description:string;hsCode:string})=>{
  const text=(data.description||'').toLowerCase();
  const hs=digits(data.hsCode||'').replace(/\D/g,'');
  const foreign=/خارج|foreign|international/i.test(data.vesselType||'');
  const quarantine=/چوب|تخته نراد|نراد|ذرت|جو|گندم|غلات|چوب خام|wood|lumber|barley|wheat|corn|grain/i.test(text)||/^(44|10|12)/.test(hs);
  const standard=/ورق آهن|ورق فولاد|ورق فولادی|فولاد|آهن|steel sheet|iron sheet/i.test(text)||/^72/.test(hs);
  return {
   evaluation:{...emptyEvaluation,status:customsPath==='red'?'required':'not_required'},
   expertise:{...emptyExpertise,road_authority_status:foreign?'pending':'not_required',plant_quarantine_status:quarantine?'pending':'not_required',standard:{...emptyExpertise.standard,expert_review:standard?'pending':'not_required',inspection_status:standard?'not_requested':'not_required',standard_fee_paid:false}},
   cashier:{...emptyCashier},loadingPermit:{...emptyLoadingPermit},exit:{...emptyExit},port:{...emptyPort}
  };
 },[customsPath]);

 const load=useCallback(async()=>{
  if(!declarationId||!organizationId){setLoading(false);return}
  setLoading(true);setError('');setMessage('');
  try{
   const{data:declarationRef,error:declarationRefError}=await supabase.from('customs_declarations').select('shipment_id').eq('id',declarationId).single();
   if(declarationRefError)throw declarationRefError;
   if(!declarationRef?.shipment_id)throw new Error('اظهارنامه به محموله متصل نیست.');
   const{data:customData,error:customError}=await supabase.from('shipment_customs_data').select('vessel_type,cargo_description,tariff_code').eq('shipment_id',declarationRef.shipment_id).maybeSingle();
   if(customError)throw customError;
   const info={vesselType:String(customData?.vessel_type||''),description:String(customData?.cargo_description||''),hsCode:String(customData?.tariff_code||'')};
   setCommodity(info);
   const{data:existing,error:e}=await supabase.from('customs_declaration_workflow').select('*').eq('declaration_id',declarationId).maybeSingle();
   if(e)throw e;
   if(existing){
    const r=existing as WorkflowRow;setRow(r);setStage(r.current_stage||'evaluation');
    setEvaluation({...emptyEvaluation,...(r.evaluation_state||{})});
    const storedStandard=((r.expertise_state||{}).standard||{}) as Record<string,any>;const mergedStandard={...emptyExpertise.standard,...storedStandard};if(!storedStandard.inspection_invoice_status&&storedStandard.inspection_invoice_received)mergedStandard.inspection_invoice_status='received';const ex={...emptyExpertise,...(r.expertise_state||{}),standard:mergedStandard};
    setExpertise(ex);
    setCashier({...emptyCashier,...(r.cashier_state||{})});
    setLoadingPermit({...emptyLoadingPermit,...(r.loading_permit_state||{})});
    setExitState({...emptyExit,...(r.exit_state||{})});
    setPort({...emptyPort,...(r.port_charges_state||{})});
    setNotes(r.notes||'');
   }else if(editable){
    const initial=defaults(info);
    const{data:created,error:createError}=await supabase.from('customs_declaration_workflow').insert({
      organization_id:organizationId,declaration_id:declarationId,current_stage:'evaluation',
      evaluation_state:initial.evaluation,expertise_state:initial.expertise,cashier_state:initial.cashier,
      loading_permit_state:initial.loadingPermit,exit_state:initial.exit,port_charges_state:initial.port,
      created_by:userId||null,updated_by:userId||null
    }).select('*').single();
    if(createError)throw createError;
    const r=created as WorkflowRow;setRow(r);setStage(r.current_stage);
    setEvaluation({...emptyEvaluation,...r.evaluation_state});
    setExpertise({...emptyExpertise,...r.expertise_state,standard:{...emptyExpertise.standard,...r.expertise_state?.standard}});
    setCashier({...emptyCashier,...r.cashier_state});setLoadingPermit({...emptyLoadingPermit,...r.loading_permit_state});
    setExitState({...emptyExit,...r.exit_state});setPort({...emptyPort,...r.port_charges_state});setNotes(r.notes||'');
   }else{
    setEvaluation(defaults(info).evaluation);setExpertise(defaults(info).expertise);
   }
   await refreshHistory();
  }catch(e:any){const raw=String(e?.message||'');setError(/permission|row-level security|42501/i.test(raw)?'دسترسی مشاهده گردش‌کار برای این کاربر مجاز نیست.':'بارگذاری گردش‌کار گمرکی انجام نشد؛ اتصال اظهارنامه و مجوز دسترسی را بررسی کنید.')}
  finally{setLoading(false)}
 },[declarationId,organizationId,userId,editable,defaults,refreshHistory]);
 useEffect(()=>{void load()},[load]);

 const overdue=useMemo(()=>getAbandonedGoodsWarnings({loadingFormReceivedAt:port.loading_form_received_at,loadingCompletedAt:exitState.loading_completed_at,warehouseReceiptAt:port.warehouse_receipt_date,loadingStartedAt:port.loading_started_at}),[port.loading_form_received_at,port.warehouse_receipt_date,port.loading_started_at,exitState.loading_completed_at]);
 const insuranceComparison=useMemo(()=>compareJalaliDates(port.insurance_issue_date,port.warehouse_receipt_date),[port.insurance_issue_date,port.warehouse_receipt_date]);
 const insuranceWarning=insuranceComparison!==null&&insuranceComparison>=0&&port.insurance_followup_status!=='completed';

 const save=async()=>{
  if(!row){setError('رکورد گردش‌کار هنوز آماده نیست. یک‌بار بروزرسانی کنید.');return}
  if(!editable)return;
  const stageOrder=['evaluation','expertise','cashier','loading_permit','exit','port_charges','completed'];
  const targetIndex=stageOrder.indexOf(stage);
  const persistedIndex=stageOrder.indexOf(row.current_stage);
  if(stage!=='abandoned'&&targetIndex>=0&&targetIndex>(persistedIndex<0?0:persistedIndex)){
   const validationState:CustomsWorkflowValidationState={customsPath,evaluation,expertise:{...expertise,standard},cashier,loadingPermit,exit:exitState,port:{...port}};
   const blockers=stageOrder.slice(0,targetIndex).flatMap(priorStage=>getWorkflowStageIssues(priorStage,validationState));
   if(blockers.length){setError('برای عبور به مرحله «'+stageLabel(stage)+'»، ابتدا موارد زیر را تکمیل کنید:\n• '+blockers.join('\n• '));return}
  }
  setSaving(true);setError('');setMessage('');
  try{
   const nextEvaluation={...evaluation};
   if(nextEvaluation.expert_requested&&nextEvaluation.status==='not_required')nextEvaluation.status='required';
   const payload={current_stage:stage,evaluation_state:nextEvaluation,expertise_state:expertise,cashier_state:cashier,loading_permit_state:loadingPermit,exit_state:exitState,port_charges_state:port,notes:notes.trim()||null,updated_by:userId||null,updated_at:new Date().toISOString()};
   const{error:e}=await supabase.from('customs_declaration_workflow').update(payload).eq('id',row.id).eq('organization_id',organizationId);
   if(e)throw e;
   setEvaluation(nextEvaluation);setRow({...row,...payload} as WorkflowRow);setMessage('مراحل عملیات گمرکی ذخیره شد.');await refreshHistory();
  }catch(e:any){const raw=String(e?.message||'');setError(/permission|row-level security|42501/i.test(raw)?'مجوز ذخیره عملیات گمرکی را ندارید.':'ذخیره عملیات گمرکی انجام نشد؛ اطلاعات واردشده و دسترسی را بررسی کنید.')}
  finally{setSaving(false)}
 };
 const input=(label:string,value:any,onChange:(v:string)=>void,placeholder='',numeric=false)=><Label>{label}<input value={value==null?'':typeof value==='boolean'?'':String(value)} onChange={e=>onChange(numeric?digits(e.target.value).replace(/[^0-9.]/g,''):e.target.value)} inputMode={numeric?'decimal':undefined} placeholder={placeholder} disabled={!editable} className="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)] disabled:opacity-60"/></Label>;
 const dateInput=(label:string,value:any,onChange:(v:string)=>void)=><Label>{label}<input value={faDigits(value||'')} onChange={e=>onChange(digits(e.target.value).replace(/[.-]/g,'/'))} placeholder="۱۴۰۵/۰۷/۲۱" inputMode="numeric" disabled={!editable} className="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)] disabled:opacity-60"/></Label>;
 const select=(label:string,value:any,options:readonly (readonly [string,string])[]|[string,string][],onChange:(v:string)=>void)=><Label>{label}<select value={value||''} onChange={e=>onChange(e.target.value)} disabled={!editable} className="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)] disabled:opacity-60">{options.map(o=><option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></Label>;
 const check=(label:string,value:any,onChange:(v:boolean)=>void,disabled=false)=><label className={'flex items-center gap-2 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm '+(disabled?'opacity-60':'')}><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)} disabled={!editable||disabled} className="h-4 w-4 accent-[var(--primary)]"/><span>{label}</span></label>;
 const setEx=(key:string,value:any)=>setExpertise(p=>({...p,[key]:value}));
 const standard={...emptyExpertise.standard,...(expertise.standard||{})};
 const setStandard=(key:string,value:any)=>setExpertise(p=>({...p,standard:{...emptyExpertise.standard,...(p.standard||{}),[key]:value}}));
 const panel=(title:string,subtitle:string,children:React.ReactNode)=><section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5 space-y-4"><div><h3 className="font-black">{title}</h3><p className="text-xs app-muted mt-1">{subtitle}</p></div>{children}</section>;
 const stageLabel=(key:string|null)=>stages.find(x=>x[0]===key)?.[1]||key||'—';
 const eventLabel=(event:WorkflowEvent)=>event.event_type==='created'?'گردش‌کار ایجاد شد':event.event_type==='stage_changed'?'مرحله تغییر کرد':'اطلاعات مرحله ذخیره شد';
 const changedFieldLabels:Record<string,string>={current_stage:'مرحله جاری',evaluation_state:'ارزیابی',expertise_state:'کارشناسی و مجوزها',cashier_state:'صندوق',loading_permit_state:'مجوز بارگیری',exit_state:'درب خروج',port_charges_state:'عوارض بندری',notes:'یادداشت‌ها'};

 if(!isImport)return <section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 text-[var(--primary)]"/><div><h2 className="font-black">گردش‌کار متناسب با رویه گمرکی</h2><p className="text-sm app-muted mt-1">این گردش‌کار جزئیات ارزیابی، کارشناسی، صندوق، مجوز بارگیری، درب خروج، عوارض بندری و متروکه را برای «واردات قطعی» فعال می‌کند. رویه انتخاب‌شده این اظهارنامه: {customsRegime||'ثبت نشده'}.</p></div></div></section>;

 return <section className="space-y-4">
  <header className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">گردش‌کار واردات قطعی</h2><p className="text-xs app-muted mt-1">هفت مرحله عملیاتی، وابسته به همین اظهارنامه؛ ثبت هر گام همراه با توضیح و وضعیت.</p><div className="text-xs app-muted mt-2">تشخیص پیشنهادی کالا: {commodity.description||'شرح کالا ثبت نشده'} · HS: {commodity.hsCode||'—'} · نوع کشتی: {commodity.vesselType||'—'}</div></div><button type="button" onClick={()=>void load()} disabled={loading||saving} className="rounded-xl border app-border p-2.5" aria-label="بروزرسانی گردش‌کار"><RefreshCw size={16} className={loading?'animate-spin':''}/></button></div>
   <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-4">{stages.map(([key,label],i)=><button type="button" key={key} onClick={()=>setStage(key)} className={'rounded-xl border px-2 py-3 text-xs font-bold '+(stage===key?'border-[var(--primary)] bg-[var(--primary)] text-white':'app-border bg-[var(--surface-2)]')}>{faDigits(i+1)}<span className="block mt-1">{label}</span></button>)}</div>
  </header>
  {loading&&<div className="rounded-xl border app-border p-6 text-center app-muted">در حال بارگذاری گردش‌کار…</div>}
  {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
  {message&&<div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}
  {overdue.any&&<div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4"><div className="flex items-start gap-2"><AlertTriangle size={19} className="shrink-0 text-red-600"/><div><b className="text-red-700 dark:text-red-300">هشدار بررسی متروکه</b>{overdue.loadingFormExpired&&<p className="text-sm mt-1">بیش از یک ماه از دریافت فرم بارگیری گذشته و اتمام بارگیری ثبت نشده است.</p>}{overdue.receiptExpired&&<p className="text-sm mt-1">سه ماه از تاریخ قبض انبار گذشته و شروع بارگیری ثبت نشده است.</p>}<p className="text-xs app-muted mt-2">این هشدار بر اساس تاریخ‌های ثبت‌شده در سامانه است؛ وضعیت قانونی پرونده را با گمرک/بندر کنترل کنید.</p><button type="button" onClick={()=>setStage('abandoned')} className="mt-3 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold">بررسی در مرحله متروکه</button></div></div></div>}
  {!loading&&stage==='evaluation'&&panel('۱. ارزیابی','مسیر سبز معمولاً از ارزیابی عبور می‌کند؛ مسیر قرمز نیازمند بررسی است. در مسیر سبز/زرد نیز کارشناس می‌تواند ارزیابی درخواست کند.',<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
   {select('وضعیت ارزیابی',evaluation.status,[['not_required','نیازی نیست'],['required','الزامی / درخواست شده'],['in_progress','در حال ارزیابی'],['completed','ارزیابی تکمیل شد']],v=>setEvaluation(p=>({...p,status:v})))}
   {input('شماره ارزیاب (مثلاً ۱، ۲، ۳…)',evaluation.evaluator_number,v=>setEvaluation(p=>({...p,evaluator_number:v})),'شماره ارزیاب')}
   {check('درخواست ارزیابی توسط کارشناس',evaluation.expert_requested,v=>setEvaluation(p=>({...p,expert_requested:v,status:v&&p.status==='not_required'?'required':p.status})))}
   <div className="sm:col-span-2 lg:col-span-3">{input('توضیح درخواست / نتیجه ارزیابی',evaluation.expert_request_note,v=>setEvaluation(p=>({...p,expert_request_note:v})),'علت ارجاع، نتیجه یا توضیح کارشناس')}</div>
  </div>)}
  {!loading&&stage==='expertise'&&panel('۲. کارشناسی و مجوزها','برای هر مجوز وضعیت جداگانه ثبت می‌شود. پیشنهادهای زیر بر اساس نوع کشتی، شرح کالا و HS هستند و جایگزین تشخیص کارشناس نیستند.',<div className="space-y-5">
   <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {select('نوبت کارشناسی',expertise.appointment_status,[['not_requested','درخواست نشده'],['requested','درخواست نوبت'],['scheduled','نوبت دریافت شد'],['completed','کارشناسی انجام شد']],v=>setEx('appointment_status',v))}
    {input('شماره نوبت / مرجع',expertise.appointment_number,v=>setEx('appointment_number',v),'شماره یا کد نوبت')}
    {select('راهداری (در صورت کشتی خارجی)',expertise.road_authority_status,[['not_required','نیازی نیست'],['pending','در انتظار'],['requested','درخواست شد'],['approved','مجوز صادر شد'],['rejected','رد شد']],v=>setEx('road_authority_status',v))}
    {select('حفظ نباتات / قرنطینه',expertise.plant_quarantine_status,[['not_required','نیازی نیست'],['pending','در انتظار'],['requested','درخواست شد'],['approved','مجوز صادر شد'],['rejected','رد شد']],v=>setEx('plant_quarantine_status',v))}
   </div>
   <div className="rounded-xl border app-border p-4 space-y-3"><div><h4 className="font-black">سازمان ملی استاندارد</h4><p className="text-xs app-muted mt-1">برای کالاهای مشمول استاندارد، از جمله ورق آهن/فولاد در موارد الزامی؛ شمول نهایی بر اساس HS و مقررات جاری تأیید شود.</p></div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {select('بررسی کارشناس استاندارد',standard.expert_review,[['not_required','نیازی نیست'],['pending','در انتظار بررسی'],['requested','ارجاع شده'],['approved','تأیید'],['rejected','رد']],v=>setStandard('expert_review',v))}
    {select('بازدید / نمونه‌گیری شرکت بازرسی',standard.inspection_status,[['not_required','نیازی نیست'],['not_requested','درخواست نشده'],['scheduled','زمان بازدید تعیین شد'],['sampled','بازدید/نمونه‌گیری انجام شد'],['completed','تکمیل شد']],v=>setStandard('inspection_status',v))}
    {input('نام شرکت بازرسی',standard.inspection_company,v=>setStandard('inspection_company',v),'شرکت بازرسی')}
    {input('هزینه بازرسی (ریال)',standard.inspection_fee,v=>setStandard('inspection_fee',v),'مبلغ',true)}
    {check('هزینه بازرسی پرداخت شد',standard.inspection_paid,v=>setStandard('inspection_paid',v))}
    {check('فاکتور بازرسی دریافت شد',standard.inspection_invoice_received,v=>setStandard('inspection_invoice_received',v))}
    {select('ارسال نمونه به آزمایشگاه',standard.sample_status,[['not_required','نیازی نیست'],['not_sent','ارسال نشده'],['sent_to_lab','ارسال شد'],['received','نتیجه دریافت شد']],v=>setStandard('sample_status',v))}
    {input('نام آزمایشگاه',standard.laboratory,v=>setStandard('laboratory',v),'نام آزمایشگاه')}
    {check('نتایج آزمایش در سامانه استاندارد بارگذاری شد',standard.results_uploaded,v=>setStandard('results_uploaded',v))}
    {input('کارمزد استاندارد (ریال)',standard.standard_fee,v=>setStandard('standard_fee',v),'مبلغ',true)}
    {check('کارمزد استاندارد پرداخت شد',standard.standard_fee_paid,v=>setStandard('standard_fee_paid',v))}
    {check('استاندارد مطلع شد',standard.standard_notified,v=>setStandard('standard_notified',v))}
   </div></div>
  </div>)}
  {!loading&&stage==='cashier'&&panel('۳. صندوق','روش پرداخت نقدی یا ضمانت‌نامه بانکی را انتخاب کنید؛ ضمانت حقوق ورودی و مالیات بر ارزش افزوده به‌صورت مستقل علامت می‌خورند.',<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
   {select('روش تسویه',cashier.method,[['pending','تعیین نشده'],['cash','پرداخت نقدی'],['bank_guarantee','ضمانت‌نامه بانکی'],['mixed','ترکیبی']],v=>setCashier(p=>({...p,method:v})))}
   {input('مبلغ پرداخت نقدی (ریال)',cashier.cash_paid_irr,v=>setCashier(p=>({...p,cash_paid_irr:v})),'مبلغ',true)}
   {check('ضمانت حقوق ورودی',cashier.guarantee_duties,v=>setCashier(p=>({...p,guarantee_duties:v})))}
   {check('ضمانت مالیات بر ارزش افزوده',cashier.guarantee_vat,v=>setCashier(p=>({...p,guarantee_vat:v})))}
   {input('شماره ضمانت‌نامه / مرجع پرداخت',cashier.guarantee_reference,v=>setCashier(p=>({...p,guarantee_reference:v})),'شماره سند یا مرجع')}
  </div>)}
  {!loading&&stage==='loading_permit'&&panel('۴. صدور مجوز بارگیری','درخواست‌ها و موانع ترخیص در این مرحله پیگیری می‌شوند. درخواست ترخیص ۹۰ درصدی نیازمند ثبت توضیح و تأیید مرجع ذی‌ربط است.',<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
   {select('درخواست تبصره ۲ منطقه آزاد',loadingPermit.clause2_request_status,[['not_required','نیازی نیست'],['pending','در انتظار'],['requested','درخواست شد'],['approved','تأیید شد'],['rejected','رد شد']],v=>setLoadingPermit(p=>({...p,clause2_request_status:v})))}
   {select('مجوز سازمان امور مالیاتی',loadingPermit.tax_permission_status,[['pending','در انتظار'],['requested','درخواست شد'],['approved','صادر شد'],['rejected','رد شد'],['not_required','نیازی نیست']],v=>setLoadingPermit(p=>({...p,tax_permission_status:v})))}
   {select('مجوز بانک مرکزی / منشأ ارز',loadingPermit.central_bank_status,[['pending','در انتظار'],['awaiting_sata','منتظر کد ساتا'],['requested','درخواست شد'],['approved','تأیید شد'],['rejected','رد شد'],['not_required','نیازی نیست']],v=>setLoadingPermit(p=>({...p,central_bank_status:v})))}
   {input('کد ساتا',loadingPermit.sata_code,v=>setLoadingPermit(p=>({...p,sata_code:v,clearance_90_percent_requested:v.trim()?false:p.clearance_90_percent_requested})),'کد ساتا')}
   {check('درخواست ترخیص ۹۰ درصدی در صورت نداشتن ساتا',loadingPermit.clearance_90_percent_requested,v=>setLoadingPermit(p=>({...p,clearance_90_percent_requested:!p.sata_code.trim()&&v})),!!String(loadingPermit.sata_code||'').trim())}
   <div className="sm:col-span-2 lg:col-span-3">{input('توضیح / کامنت درخواست',loadingPermit.comment,v=>setLoadingPermit(p=>({...p,comment:v})),'شرح درخواست، مرجع پیگیری و پاسخ دریافتی')}</div>
  </div>)}
  {!loading&&stage==='exit'&&panel('۵. درب خروج','مجوز بارگیری، ثبت مالی و هزینه دیماند باسکول پس از اتمام بارگیری (در صورت وجود) ثبت می‌شوند.',<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
   {select('اجازه بارگیری',exitState.loading_permission_status,[['pending','در انتظار'],['approved','صادر شد'],['rejected','رد شد']],v=>setExitState(p=>({...p,loading_permission_status:v})))}
   {select('ثبت مالی',exitState.financial_registration_status,[['pending','ثبت نشده'],['registered','ثبت مالی انجام شد']],v=>setExitState(p=>({...p,financial_registration_status:v})))}
   {check('باسکول / دیماند لازم است',exitState.weighbridge_required,v=>setExitState(p=>({...p,weighbridge_required:v})))}
   {exitState.weighbridge_required&&input('مبلغ دیماند باسکول (ریال)',exitState.weighbridge_demand_irr,v=>setExitState(p=>({...p,weighbridge_demand_irr:v})),'مبلغ',true)}
   {exitState.weighbridge_required&&check('دیماند باسکول پرداخت شد',exitState.weighbridge_paid,v=>setExitState(p=>({...p,weighbridge_paid:v})))}
   {dateInput('تاریخ اتمام بارگیری',exitState.loading_completed_at,v=>setExitState(p=>({...p,loading_completed_at:v})))}
  </div>)}
  {!loading&&stage==='port_charges'&&panel('۶. عوارض بندری','بیمه، صورتحساب‌ها و مدارک حمل/بارگیری را ثبت کنید. تاریخ‌ها شمسی هستند و برای هشدار متروکه بررسی می‌شوند.',<div className="space-y-4">
   <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {input('شماره بیمه‌نامه',port.insurance_policy_no,v=>setPort(p=>({...p,insurance_policy_no:v})),'شماره بیمه‌نامه')}
    {dateInput('تاریخ بیمه‌نامه',port.insurance_issue_date,v=>setPort(p=>({...p,insurance_issue_date:v})))}
    {dateInput('تاریخ قبض انبار',port.warehouse_receipt_date,v=>setPort(p=>({...p,warehouse_receipt_date:v})))}
    {select('صورتحساب اولیه',port.initial_invoice_status,[['pending','در انتظار'],['received','دریافت شد'],['paid','پرداخت شد'],['not_required','نیازی نیست']],v=>setPort(p=>({...p,initial_invoice_status:v})))}
    {select('وکالت حمل',port.transport_power_of_attorney_status,[['pending','در انتظار'],['received','دریافت شد'],['approved','تأیید شد'],['not_required','نیازی نیست']],v=>setPort(p=>({...p,transport_power_of_attorney_status:v})))}
    {dateInput('تاریخ دریافت فرم بارگیری',port.loading_form_received_at,v=>setPort(p=>({...p,loading_form_received_at:v})))}
    {dateInput('تاریخ شروع بارگیری',port.loading_started_at,v=>setPort(p=>({...p,loading_started_at:v})))}
    {select('صورتحساب متمم (برای کامیون آخر)',port.supplemental_invoice_status,[['not_required','هنوز لازم نیست'],['pending','در انتظار'],['required','باید صادر شود'],['received','دریافت شد'],['paid','پرداخت شد']],v=>setPort(p=>({...p,supplemental_invoice_status:v})))}
    {dateInput('تاریخ بارگیری کامیون آخر',port.last_truck_loaded_at,v=>setPort(p=>({...p,last_truck_loaded_at:v})))}
   </div>
   {insuranceWarning&&<div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertTriangle size={16} className="inline ml-1 text-amber-600"/>تاریخ بیمه‌نامه در روز قبض انبار یا پس از آن است؛ بیمه‌نامه باید از نظر تاریخ و اعتبار بررسی شود.</div>}
   <div className="rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs app-muted">یادآوری: تاریخ بیمه‌نامه را با تاریخ قبض انبار تطبیق دهید. صورتحساب متمم را هنگام اقدام به بارگیری آخرین کامیون پیگیری کنید.</div>
  </div>)}
  {!loading&&stage==='abandoned'&&panel('۷. بررسی متروکه','سامانه در صورت عبور از مهلت‌های ثبت‌شده هشدار می‌دهد؛ وضعیت نهایی متروکه باید با توجه به پرونده و تصمیم مرجع بندری/گمرکی تأیید شود.',<div className="space-y-3">
   {overdue.any?<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">یک یا چند مهلت ثبت‌شده گذشته است؛ پرونده نیازمند اقدام و بررسی فوری است.</div>:<div className="rounded-xl border app-border p-3 text-sm">بر اساس تاریخ‌های ثبت‌شده، هنوز مهلت هشدار متروکه عبور نکرده یا تاریخ لازم ثبت نشده است.</div>}
   <div className="grid sm:grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-[var(--surface-2)] p-3">فرم بارگیری: {faDigits(port.loading_form_received_at||'ثبت نشده')} · مهلت یک‌ماهه</div><div className="rounded-xl bg-[var(--surface-2)] p-3">قبض انبار: {faDigits(port.warehouse_receipt_date||'ثبت نشده')} · مهلت سه‌ماهه</div></div>
   {input('یادداشت پیگیری متروکه',notes,v=>setNotes(v),'اقدام انجام‌شده، مرجع پیگیری و توضیحات')}
  </div>)}
  {!loading&&stage==='completed'&&panel('تکمیل گردش‌کار','پس از کنترل اسناد، وضعیت نهایی و توضیحات پرونده را ذخیره کنید.',<div className="grid sm:grid-cols-2 gap-3">{input('یادداشت نهایی',notes,v=>setNotes(v),'خلاصه وضعیت و موارد باقی‌مانده')}</div>)}
  {!loading&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4 flex flex-wrap items-center justify-between gap-3"><div className="text-xs app-muted flex items-center gap-2"><Clock3 size={15}/>مرحله جاری: <b className="text-[var(--text)]">{stages.find(x=>x[0]===stage)?.[1]||stage}</b>{row?.updated_at&&<span>· آخرین ذخیره {new Date(row.updated_at).toLocaleString('fa-IR')}</span>}</div><button type="button" onClick={()=>void save()} disabled={!editable||saving||loading||!row} className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white disabled:opacity-50"><Save size={16}/>{saving?'در حال ذخیره…':'ذخیره مرحله و وضعیت‌ها'}</button></section>}
  {!loading&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5 space-y-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black">سوابق تغییرات عملیات گمرکی</h3><p className="text-xs app-muted mt-1">تغییر مرحله و ذخیره هر بخش به‌صورت خودکار ثبت می‌شود.</p></div><span className="rounded-full border app-border px-2.5 py-1 text-xs app-muted">{faDigits(history.length)} رویداد اخیر</span></div>
   {historyUnavailable?<p className="text-sm app-muted">تاریخچه در حال حاضر قابل دریافت نیست؛ داده‌های عملیات همچنان جداگانه ذخیره شده‌اند.</p>:history.length===0?<p className="text-sm app-muted">هنوز رویدادی ثبت نشده است. پس از اولین ذخیره، سوابق در این قسمت نمایش داده می‌شوند.</p>:<ol className="space-y-3">{history.map(event=><li key={event.id} className="relative rounded-xl border app-border bg-[var(--surface-2)] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="font-bold text-sm">{eventLabel(event)}</div><time className="text-[11px] app-muted" dir="auto">{new Date(event.created_at).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'})}</time></div>
    <p className="text-xs app-muted mt-1">{event.previous_stage&&event.previous_stage!==event.current_stage?'از '+stageLabel(event.previous_stage)+' به '+stageLabel(event.current_stage):'مرحله: '+stageLabel(event.current_stage)}</p>
    {event.changed_fields?.length>0&&<p className="text-xs mt-2">بخش‌های تغییرکرده: {event.changed_fields.map(key=>changedFieldLabels[key]||key).join('، ')}</p>}
    <p className="text-[11px] app-muted mt-2">{event.actor_id&&event.actor_id===userId?'توسط شما':'توسط کاربر مجاز'}</p>
   </li>)}</ol>}
   <div className="flex justify-end"><button type="button" onClick={()=>void refreshHistory()} disabled={saving} className="rounded-lg border app-border px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw size={13} className="inline ml-1"/>بروزرسانی سوابق</button></div>
  </section>}
  {!editable&&<p className="text-xs app-muted">این بخش فقط برای مشاهده است؛ ثبت تغییرات به دسترسی کاربر عملیاتی نیاز دارد.</p>}
 </section>
};
