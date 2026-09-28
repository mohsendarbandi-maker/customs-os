import React,{useRef,useState} from 'react';
import {Bot,Send,X,CheckCircle2,Mic,MicOff,Plus,PanelLeftClose,SquarePen,ChevronDown} from 'lucide-react';
import {supabase} from '../lib/supabase';

type Msg={role:'user'|'assistant';text:string};
type Extracted=Record<string,string>;
type DocResult={name:string;fields:Extracted;error?:string};

const keyLabels:Record<string,string[]>= {
 client:['صاحب کالا','گیرنده','خریدار','buyer','consignee','importer','client','clientid','client name'],clientNationalId:['شناسه ملی','کد ملی','national id'],clientEconomicId:['کد اقتصادی','economic id'],
 seller:['فروشنده','صادرکننده','seller','exporter'],sellerAddress:['آدرس فروشنده','seller address'],sellerCountry:['کشور فروشنده','seller country'],sellerRegistrationId:['شناسه فروشنده','seller registration'],
 regNumber:['ثبت سفارش','شماره ثبت سفارش','registration order','registration number','regnumber'],regDate:['تاریخ ثبت سفارش','registration order date','regdate'],registrationType:['نوع ثبت سفارش','registration type'],
 proformaNumber:['پرفورما','پروفرما','شماره پروفرما','proforma'],proformaDate:['تاریخ پروفرما','proforma date'],contractNumber:['شماره قرارداد','contract number'],contractDate:['تاریخ قرارداد','contract date'],
 shippingLine:['کشتیرانی','shipping line','carrier'],carrier:['حامل','carrier'],vesselName:['کشتی','نام کشتی','vessel','vesselname'],imoNumber:['imo','شماره imo','imonumber'],voyageNo:['voyage','سفر','شماره سفر','voyageno','voyage no'],billOfLading:['b/l','bl','بارنامه','شماره بارنامه','bill of lading','billoflading'],billYear:['سال بارنامه','bill year','year','b/l year','billyear'],billDate:['تاریخ بارنامه','bill date'],billType:['نوع بارنامه','bill type'],
 originPort:['مبدأ بارگیری','بندر مبدأ','origin port','port of loading','pol','originport'],destinationPort:['بندر مقصد','مقصد','destination port','port of discharge','pod','destinationport'],transshipmentPort:['بندر ترانشیپ','transshipment port'],originCountry:['کشور مبدأ','origin country','origincountry'],transactionCountry:['کشور معامله','transaction country','transactioncountry'],loadingDate:['تاریخ بارگیری','loading date'],unloadingDate:['تاریخ تخلیه','unloading date','unloadingdate'],
 deliveryTerm:['اینکوترمز','incoterm','شرایط تحویل','delivery term','deliveryterm'],paymentTerm:['شرایط پرداخت','payment term'],currency:['ارز','currency'],cargoDescription:['شرح کالا','کالا','cargo description','goods','cargodescription'],cargoBrand:['برند کالا','brand'],cargoModel:['مدل کالا','model'],cargoCount:['تعداد','quantity','qty','count','cargo count','cargocount'],cargoCountUnit:['واحد','unit','count unit','cargo count unit'],packageCount:['تعداد بسته','package count'],packageType:['نوع بسته‌بندی','نوع بسته','package type'],
 netWeight:['وزن خالص','net weight','net','netweight'],grossWeight:['وزن ناخالص','gross weight','gross','grossweight'],volume:['حجم','volume'],weightUnit:['واحد وزن','weight unit'],tariffCode:['hs','تعرفه','hs code','کد تعرفه','tariff code','tariffcode'],tariffDescription:['شرح تعرفه','tariff description'],countryOfOrigin:['کشور سازنده','کشور تولید','country of origin'],
 invoiceAmount:['مبلغ فاکتور','ارزش فاکتور','invoice amount','invoice value','value amount','invoiceamount'],invoiceCurrency:['ارز فاکتور','invoice currency','invoicecurrency'],freightAmount:['کرایه حمل','freight'],freightCurrency:['ارز حمل','freight currency'],insuranceAmount:['مبلغ بیمه','insurance amount'],insuranceCurrency:['ارز بیمه','insurance currency'],insuranceIrr:['بیمه ریالی','insurance irr','insurance amount irr','insuranceirr'],customsValue:['ارزش گمرکی','customs value'],exchangeRate:['نرخ ارز','exchange rate'],dutyRate:['حقوق ورودی','نرخ حقوق','duty rate','import duty rate','dutyrate'],vatRate:['مالیات بر ارزش افزوده','vat rate'],dutyAmount:['مبلغ حقوق ورودی','duty amount'],vatAmount:['مبلغ مالیات','vat amount'],totalPayable:['مبلغ قابل پرداخت','total payable'],
 warehouseReceiptNo:['شماره قبض انبار','warehouse receipt','warehouse receipt no','warehouseReceiptNo'],warehouseReceiptDate:['تاریخ قبض انبار','warehouse receipt date'],warehouseName:['نام انبار','warehouse name'],warehouseAddress:['آدرس انبار','warehouse address'],customsOffice:['گمرک','customs office'],declarationNumber:['شماره اظهارنامه','declaration number'],declarationDate:['تاریخ اظهارنامه','declaration date'],declarationType:['نوع اظهارنامه','declaration type'],
 containerNumber:['شماره کانتینر','container number'],containerCount:['تعداد کانتینر','container count'],sealNumber:['شماره پلمپ','شماره سیل','seal number'],portOfLoading:['بندر بارگیری','port of loading','pol'],portOfDischarge:['بندر تخلیه','port of discharge','pod'],bankName:['نام بانک','bank name'],bankReference:['شماره پیگیری بانکی','bank reference'],paymentDate:['تاریخ پرداخت','payment date'],purchaseOrderNumber:['شماره سفارش خرید','purchase order'],purchaseOrderDate:['تاریخ سفارش خرید','purchase order date'],hsDescription:['شرح hs','hs description'],notes:['توضیحات','یادداشت','notes']
};

// The extracted schema and the existing React forms use different names in several places.
// Keep this alias table here so AI results can target the real form controls without changing the AI model output.
const canonicalAliases:Record<string,string[]>={
 client:['client','clientId'], seller:['seller'], regNumber:['regNumber','registration_order_no','order_number'], regDate:['regDate','order_date'],
 shippingLine:['shippingLine','shipping_line'], vesselName:['vesselName','vessel'], imoNumber:['imoNumber','imo','vessel_imo'], voyageNo:['voyageNo','voyage'], billOfLading:['billOfLading','bl','bill_of_lading_no'], billYear:['billYear','year','bill_of_lading_year'],
 originPort:['originPort','pol','origin_port','portOfLoading'], destinationPort:['destinationPort','pod','destination_port','portOfDischarge'], originCountry:['originCountry','originCountryCode','origin_country_code'], transactionCountry:['transactionCountry','transaction_country_code'], unloadingDate:['unloadingDate','unloading_date'],
 deliveryTerm:['deliveryTerm','delivery_term'], currency:['currency','invoiceCurrency','invoice_currency'], cargoDescription:['cargoDescription','cargo_description'], cargoCount:['cargoCount','count','quantity','cargo_count'], cargoCountUnit:['cargoCountUnit','unit','quantity_unit','cargo_count_unit'],
 netWeight:['netWeight','net','net_weight_kg'], grossWeight:['grossWeight','gross','gross_weight_kg'], tariffCode:['tariffCode','tariff','hs_code','tariff_code'], invoiceAmount:['invoiceAmount','invoice_amount','value_amount'], invoiceCurrency:['invoiceCurrency','invoice_currency','currency'], insuranceIrr:['insuranceIrr','insurance_amount_irr'], dutyRate:['dutyRate','duty_rate','import_duty_rate'],
 warehouseReceiptNo:['warehouseReceiptNo','warehouse_receipt_no'], warehouseReceiptDate:['warehouseReceiptDate','warehouse_receipt_date'], declarationNumber:['declarationNumber','declaration_number'], declarationDate:['declarationDate','declaration_date'],
 containerNumber:['containerNumber','container_number'], containerCount:['containerCount','container_count'], sealNumber:['sealNumber','seal_number'], bankName:['bankName','bank_name'], bankReference:['bankReference','bank_reference'], paymentDate:['paymentDate','payment_date'], notes:['notes']
};

const normalize=(s:string)=>s.toLowerCase().replace(/[\u200c\u200f\u0640]/g,' ').replace(/[_-]+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const compact=(s:string)=>normalize(s).replace(/\s/g,'');
const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||'');const comma=s.indexOf(',');resolve(comma>=0?s.slice(comma+1):s)};r.onerror=()=>reject(new Error('خواندن فایل ناموفق بود.'));r.readAsDataURL(file);});
declare global { interface Window { SpeechRecognition?: any; webkitSpeechRecognition?: any } }
const explainInvokeError=async(error:any)=>{try{if(error?.context?.json){const body=await error.context.json();if(body?.error)return String(body.error);if(body?.message)return String(body.message);}if(error?.context?.text){const body=await error.context.text();if(body)return body;}if(error?.message&&error.message!=='Edge Function returned a non-2xx status code')return error.message;}catch{}return 'Edge Function پاسخ موفق نداد.';};

const attrText=(el:Element)=>normalize([el.getAttribute('name'),el.getAttribute('id'),el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('data-field'),el.getAttribute('data-name')].filter(Boolean).join(' '));
const getReactProps=(el:Element):any=>{const key=Object.keys(el).find(k=>k.startsWith('__reactProps$'));return key?(el as any)[key]:null};
const setNativeValue=(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const own=Object.getOwnPropertyDescriptor(el,'value')?.set;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter&&own!==setter)setter.call(el,value);else own?.call(el,value);};
const findControl=(field:string):HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null=>{
 const names=[field,...(canonicalAliases[field]||[]),...(keyLabels[field]||[])];const needles=names.map(normalize).filter(Boolean);const compactNeedles=names.map(compact).filter(Boolean);
 const controls=Array.from(document.querySelectorAll('input,select,textarea')) as Array<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>;let best:{el:any;score:number}|null=null;const labels=Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
 for(const el of controls){if(el.disabled||el.type==='hidden'||el.type==='file')continue;let score=0;const attrs=attrText(el);const cattrs=compact(attrs);const exact=needles.some(n=>attrs===n)||compactNeedles.some(n=>cattrs===n);const partial=needles.some(n=>attrs.includes(n))||compactNeedles.some(n=>cattrs.includes(n));if(exact)score+=140;else if(partial)score+=80;
  const label=el.id?labels.find(l=>l.htmlFor===el.id):el.closest('label');const labelText=normalize(label?.textContent||'');const clabel=compact(labelText);if(needles.some(n=>labelText===n)||compactNeedles.some(n=>clabel===n))score+=130;else if(needles.some(n=>labelText.includes(n))||compactNeedles.some(n=>clabel.includes(n)))score+=75;
  const parentText=normalize(el.parentElement?.textContent||'').slice(0,350);if(needles.some(n=>parentText.includes(n)))score+=15;
  if(score&&(best===null||score>best.score))best={el,score};}
 return best?.el||null;
};

const setControlValue=(el:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement,value:string)=>{
 if(el instanceof HTMLSelectElement){const target=normalize(value);const option=Array.from(el.options).find(o=>normalize(o.value)===target||normalize(o.textContent||'')===target||normalize(o.textContent||'').includes(target)||target.includes(normalize(o.textContent||'')));if(option)el.value=option.value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));const props=getReactProps(el);if(!option&&props?.onChange){try{props.onChange({target:el,currentTarget:el})}catch{}}return;}
 setNativeValue(el,value);const inputEvent=new Event('input',{bubbles:true});el.dispatchEvent(inputEvent);const changeEvent=new Event('change',{bubbles:true});el.dispatchEvent(changeEvent);
 // Fallback for React-controlled fields whose event delegation did not update state.
 const props=getReactProps(el);if(props?.onChange){try{props.onChange({target:el,currentTarget:el,type:'change',nativeEvent:changeEvent})}catch{}}
};

function applyToCurrentForm(fields:Extracted){const applied:string[]=[];const missing:string[]=[];for(const [field,value] of Object.entries(fields)){if(!value)continue;const el=findControl(field);if(!el){missing.push(field);continue;}try{setControlValue(el,String(value));applied.push(field);}catch{missing.push(field);}}
 // Give React one render cycle, then verify the values survived controlled re-rendering.
 return {applied,missing};
}

export const AIWorkspace:React.FC<{pageContext?:string}>=({pageContext=''})=>{
 const shipmentId=React.useMemo(()=>{try{return new URLSearchParams(window.location.search).get('shipmentId')||''}catch{return ''}},[pageContext]);
 const [sharedContext,setSharedContext]=useState('');
 const loadSharedContext=async()=>{
   if(!shipmentId){setSharedContext('');return;}
   try{
     const [{data:docs},{data:ext},{data:customs}] = await Promise.all([
       supabase.from('shipment_documents').select('id,document_name,original_file_name,extraction_status,extraction_error,extraction_completed_at,created_at').eq('shipment_id',shipmentId).order('created_at',{ascending:false}).limit(30),
       supabase.from('shipment_document_extractions').select('document_id,field_key,field_label,extracted_value,confidence,updated_at').eq('shipment_id',shipmentId).order('updated_at',{ascending:false}).limit(200),
       supabase.from('shipment_customs_data').select('*').eq('shipment_id',shipmentId).maybeSingle()
     ]);
     const context={shipment_id:shipmentId,documents:(docs||[]).map((d:any)=>({id:d.id,name:d.document_name||d.original_file_name,status:d.extraction_status,error:d.extraction_error||null,completed_at:d.extraction_completed_at||null})),extractions:(ext||[]).map((x:any)=>({document_id:x.document_id,field:x.field_key,value:x.extracted_value,confidence:x.confidence})),customs_data:customs||null};
     setSharedContext(JSON.stringify(context));
   }catch{setSharedContext('')}
 };
 React.useEffect(()=>{void loadSharedContext()},[shipmentId]);
 const usable=(v:any)=>{const s=String(v??'').trim();return !!s&&!/^x{2,}$/i.test(s)&&s!=='—'&&s!=='-'};
 const persistDocument=async(file:File)=>{
   if(!shipmentId)return null;
   const {data:{user}}=await supabase.auth.getUser(); if(!user)throw new Error('کاربر وارد نشده است.');
   const {data:profile,error:pe}=await supabase.from('profiles').select('organization_id').eq('id',user.id).maybeSingle();
   if(pe||!profile?.organization_id)throw new Error(pe?.message||'سازمان کاربر مشخص نیست.');
   const safe=file.name.replace(/[^\\w.\\-\\u0600-\\u06ff]+/g,'_');
   const path=`${profile.organization_id}/${shipmentId}/${crypto.randomUUID()}-${safe}`;
   const {error:ue}=await supabase.storage.from('customs_documents').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});
   if(ue)throw new Error(`آپلود «${file.name}» ناموفق بود: ${ue.message}`);
   const {data:doc,error:de}=await supabase.from('shipment_documents').insert({organization_id:profile.organization_id,shipment_id:shipmentId,uploaded_by:user.id,document_name:file.name,original_file_name:file.name,storage_path:path,mime_type:file.type||'application/octet-stream',file_size_bytes:file.size,extraction_status:'pending'}).select('id').single();
   if(de||!doc){await supabase.storage.from('customs_documents').remove([path]);throw new Error(de?.message||'ثبت سند ناموفق بود.');}
   return doc.id as string;
 };
 const updateExtractionStatus=async(documentId:string,status:'processing'|'completed'|'failed',errorMessage?:string)=>{
   const patch:any={extraction_status:status,extraction_error:errorMessage||null};
   if(status==='processing')patch.extraction_started_at=new Date().toISOString();
   if(status==='completed'||status==='failed')patch.extraction_completed_at=new Date().toISOString();
   await supabase.from('shipment_documents').update(patch).eq('id',documentId);
   await loadSharedContext();
 };
 const persistExtraction=async(documentId:string,parsed:Extracted)=>{
   if(!shipmentId)return;
   const {data:{user}}=await supabase.auth.getUser();
   const {data:profile}=user?await supabase.from('profiles').select('organization_id').eq('id',user.id).maybeSingle():{data:null};
   if(!profile?.organization_id)return;
   const rows=Object.entries(parsed).filter(([,v])=>usable(v)).map(([k,v])=>({organization_id:profile.organization_id,shipment_id:shipmentId,document_id:documentId,field_key:k,field_label:k,extracted_value:v,extraction_method:'ai-assistant',confidence:null}));
   if(rows.length){await supabase.from('shipment_document_extractions').upsert(rows,{onConflict:'shipment_id,document_id,field_key'});void supabase.from('ai_evidence').insert(rows.map((r:any)=>({organization_id:r.organization_id,shipment_id:r.shipment_id,document_id:r.document_id,field_key:r.field_key,extracted_value:r.extracted_value,extraction_method:'ai-assistant',verification_status:'unverified'})));}
 };

 const[open,setOpen]=useState(false),[tab,setTab]=useState<'chat'|'doc'>('chat'),[input,setInput]=useState(''),[messages,setMessages]=useState<Msg[]>([]),[busy,setBusy]=useState(false),[fields,setFields]=useState<Extracted>({}),[status,setStatus]=useState(''),[applied,setApplied]=useState(0),[docResults,setDocResults]=useState<DocResult[]>([]),[sessionId]=useState(()=>{try{const k='customs_ai_session_id';const old=localStorage.getItem(k);if(old)return old;const id=crypto.randomUUID();localStorage.setItem(k,id);return id}catch{return ''}}),[listening,setListening]=useState(false);const fileRef=useRef<HTMLInputElement|null>(null);const recognitionRef=useRef<any>(null);const voiceFinalRef=useRef('');const conversationRef=useRef(false);const mediaRecorderRef=useRef<MediaRecorder|null>(null);const mediaStreamRef=useRef<MediaStream|null>(null);const voiceChunksRef=useRef<Blob[]>([]);
 const ask=async(text=input.trim(),documentText='',extractFields=false,documentData='',documentMimeType='',commandMode=false,documentStoragePath='')=>{if(!text&&!documentText&&!documentData)return null;setBusy(true);setStatus('');if(text)setMessages(m=>[...m,{role:'user',text}]);setInput('');try{const contextPrefix=sharedContext?'زمینه زنده محموله و اسناد:\\n'+sharedContext+'\\n\\n':'';const prompt=extractFields?'استخراج کامل سند گمرکی/تجاری برای ورود اطلاعات به Customs OS. همه صفحات، جدول‌ها، سربرگ‌ها و پاورقی‌ها را بررسی کن. فقط اطلاعات واقعی را استخراج کن و حدس نزن.':contextPrefix+(text||'این سند را برای عملیات گمرکی و لجستیکی تحلیل کن.');const functionName=extractFields?'ai-assistant':'ai-core';const body=extractFields?{query:prompt,document_text:documentText,document_data:documentData||undefined,document_mime_type:documentMimeType||undefined,document_storage_path:documentStoragePath||undefined,extract_fields:true,page_context:pageContext}:{query:text||prompt,document_text:documentText,document_data:documentData||undefined,document_mime_type:documentMimeType||undefined,document_storage_path:documentStoragePath||undefined,mode:commandMode?'agent':'chat',shipment_id:shipmentId||undefined,session_id:sessionId||undefined};const{data,error}=await supabase.functions.invoke(functionName,{body});if(error)throw error;const answer=typeof data?.answer==='string'?data.answer:(data?.answer?JSON.stringify(data.answer):data?.message||'پاسخ دریافت نشد.');if(!extractFields){setMessages(m=>[...m,{role:'assistant',text:answer}]);}return answer;}catch(e:any){const detail=await explainInvokeError(e);if(text)setMessages(m=>[...m,{role:'assistant',text:`خطای دستیار: ${detail}`}]);throw new Error(detail)}finally{setBusy(false);if(conversationRef.current&&!recognitionRef.current)scheduleVoiceRestart()}};
 const parseFields=(answer:string)=>{const raw=answer.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();const x=JSON.parse(raw);const parsed:Extracted={};Object.entries(x||{}).forEach(([k,v])=>{if(typeof v==='string'&&v.trim())parsed[k]=v.trim();});return parsed;};
 const extractOne=async(file:File,documentId?:string)=>{if(file.type!=='application/pdf'&&!file.type.startsWith('image/'))throw new Error('فقط PDF و تصویر پشتیبانی می‌شود.');if(file.size>50*1024*1024)throw new Error(`حجم ${file.name} بیشتر از ۵۰MB است.`);if(documentId)await updateExtractionStatus(documentId,'processing');try{let storagePath='';if(documentId){const {data:doc,error:de}=await supabase.from('shipment_documents').select('storage_path').eq('id',documentId).maybeSingle();if(de||!doc?.storage_path)throw new Error(de?.message||'مسیر سند در Storage پیدا نشد.');storagePath=doc.storage_path;}const base64=documentId?'':await fileToBase64(file);const answer=await ask('', '', true, base64, file.type, false, storagePath);if(!answer)throw new Error('پاسخ خالی از سرویس هوش مصنوعی دریافت شد.');const parsed=parseFields(answer);if(documentId){await persistExtraction(documentId,parsed);await updateExtractionStatus(documentId,'completed');}return parsed}catch(e:any){if(documentId)await updateExtractionStatus(documentId,'failed',e?.message||'استخراج ناموفق');throw e;}};
 const extractMany=async(files:FileList|File[])=>{const list=Array.from(files);if(!list.length)return;setTab('doc');setFields({});setApplied(0);setDocResults([]);setBusy(true);const results:DocResult[]=[];const merged:Extracted={};try{for(let i=0;i<list.length;i++){const file=list[i];setStatus(`در حال استخراج سند ${i+1} از ${list.length}: ${file.name}`);try{const documentId=shipmentId?await persistDocument(file):undefined;const f=await extractOne(file,documentId);results.push({name:file.name,fields:f});Object.entries(f).forEach(([k,v])=>{if(!merged[k])merged[k]=v;});setDocResults([...results]);setFields({...merged});}catch(e:any){results.push({name:file.name,fields:{},error:e?.message||'استخراج ناموفق'});setDocResults([...results]);}}setFields({...merged});const ok=results.filter(x=>!x.error).length;const failed=results.filter(x=>x.error).length;setStatus(`استخراج تمام شد: ${ok} سند موفق${failed?`، ${failed} سند ناموفق`:''}؛ مجموع ${Object.keys(merged).length} فیلد یکتا.`);try{localStorage.setItem('customs_ai_extracted',JSON.stringify({fields:merged,documents:results,fileNames:list.map(f=>f.name),pageContext,at:new Date().toISOString()}))}catch{}}finally{setBusy(false)}};
const voiceRestartRef=useRef<ReturnType<typeof setTimeout>|null>(null);
const voiceSessionRef=useRef(0);
const voiceStartTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);

const clearVoiceTimers=()=>{
  if(voiceRestartRef.current)clearTimeout(voiceRestartRef.current);
  if(voiceStartTimerRef.current)clearTimeout(voiceStartTimerRef.current);
  voiceRestartRef.current=null;
  voiceStartTimerRef.current=null;
};

const scheduleVoiceRestart=()=>{
  if(!conversationRef.current)return;
  if(voiceRestartRef.current)clearTimeout(voiceRestartRef.current);
  voiceRestartRef.current=setTimeout(()=>{
    voiceRestartRef.current=null;
    if(conversationRef.current&&!recognitionRef.current)startSpeechConversation();
  },700);
};

const primeMicrophone=async()=>{
  if(!window.isSecureContext){setStatus('برای استفاده از میکروفون، سایت باید با HTTPS باز شود.');return false;}
  if(!navigator.mediaDevices?.getUserMedia){setStatus('مرورگر فعلی درخواست دسترسی مستقیم به میکروفون را پشتیبانی نمی‌کند.');return false;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    stream.getTracks().forEach(track=>track.stop());
    setStatus('دسترسی میکروفون فعال شد.');return true;
  }catch(error:any){
    conversationRef.current=false;setListening(false);const name=String(error?.name||'');
    if(name==='NotAllowedError'||name==='SecurityError')setStatus('دسترسی میکروفون رد شده است. روی «فعال‌کردن میکروفون» بزنید و اجازه Microphone را برای سایت فعال کنید.');
    else if(name==='NotFoundError')setStatus('میکروفون پیدا نشد یا به سیستم وصل نیست.');
    else setStatus('فعال‌سازی میکروفون ناموفق بود؛ تنظیمات Microphone مرورگر را بررسی کنید.');
    return false;
  }
};

const startSpeechConversation=()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    conversationRef.current=false;
    setStatus('تشخیص گفتار فارسی در این مرورگر در دسترس نیست.');
    return;
  }
  if(!window.isSecureContext){
    conversationRef.current=false;
    setStatus('میکروفون فقط در اتصال امن HTTPS قابل استفاده است.');
    return;
  }
  if(recognitionRef.current)return;
  const session=++voiceSessionRef.current;
  try{
    const r=new SR();
    recognitionRef.current=r;
    voiceFinalRef.current='';
    r.lang='fa-IR';
    // iPhone Safari is more reliable with one utterance per recognition session.
    // The conversation remains active and the next turn starts automatically.
    r.continuous=false;
    r.interimResults=true;
    r.maxAlternatives=1;
    r.onstart=()=>{
      if(session!==voiceSessionRef.current)return;
      if(voiceStartTimerRef.current)clearTimeout(voiceStartTimerRef.current);
      voiceStartTimerRef.current=null;
      setListening(true);
      setStatus('🎙️ مکالمه فعال است؛ صحبت کنید. بعد از جمله، پیام خودکار ارسال می‌شود.');
    };
    r.onresult=(ev:any)=>{
      if(session!==voiceSessionRef.current)return;
      let finalText=voiceFinalRef.current;
      let interim='';
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const part=String(ev.results[i]?.[0]?.transcript||'').trim();
        if(!part)continue;
        if(ev.results[i].isFinal)finalText+=(finalText?' ':'')+part;
        else interim+=(interim?' ':'')+part;
      }
      voiceFinalRef.current=finalText;
      const shown=(finalText+' '+interim).trim();
      if(shown)setInput(shown);
      if(finalText&&!busy){
        voiceFinalRef.current='';
        setInput('');
        void ask(finalText);
      }
    };
    r.onerror=(ev:any)=>{
      if(session!==voiceSessionRef.current)return;
      const code=String(ev?.error||'');
      if(voiceStartTimerRef.current)clearTimeout(voiceStartTimerRef.current);
      voiceStartTimerRef.current=null;
      setListening(false);
      recognitionRef.current=null;
      if(code==='not-allowed'||code==='service-not-allowed'){
        conversationRef.current=false;
        setStatus('دسترسی میکروفون یا تشخیص گفتار رد شد. اجازه Microphone را برای سایت فعال کنید.');
        return;
      }
      if(code==='audio-capture'){
        setStatus('میکروفون موقتاً در دسترس نیست؛ در حال تلاش مجدد…');
      }else if(code==='network'){
        setStatus('سرویس تشخیص گفتار موقتاً در دسترس نیست؛ در حال تلاش مجدد…');
      }else if(code==='no-speech'){
        setStatus('صدایی تشخیص داده نشد؛ دوباره صحبت کنید…');
      }else if(code!=='aborted'){
        setStatus('مکالمه موقتاً متوقف شد؛ در حال اتصال مجدد…');
      }
      if(code!=='not-allowed'&&code!=='service-not-allowed')scheduleVoiceRestart();
    };
    r.onend=()=>{
      if(session!==voiceSessionRef.current)return;
      if(voiceStartTimerRef.current)clearTimeout(voiceStartTimerRef.current);
      voiceStartTimerRef.current=null;
      setListening(false);
      recognitionRef.current=null;
      if(voiceFinalRef.current.trim()){
        const finalText=voiceFinalRef.current.trim();
        voiceFinalRef.current='';
        setInput('');
        if(conversationRef.current&&!busy)void ask(finalText);
      }
      if(conversationRef.current)scheduleVoiceRestart();
      else setStatus('مکالمه متوقف شد.');
    };
    r.start();
    voiceStartTimerRef.current=setTimeout(()=>{
      if(session!==voiceSessionRef.current)return;
      if(!recognitionRef.current||listening)return;
      try{recognitionRef.current.abort()}catch{}
      recognitionRef.current=null;
      setListening(false);
      if(conversationRef.current){
        setStatus('سرویس تشخیص گفتار پاسخ نداد؛ در حال راه‌اندازی مجدد…');
        scheduleVoiceRestart();
      }
    },3500);
  }catch{
    if(voiceStartTimerRef.current)clearTimeout(voiceStartTimerRef.current);
    voiceStartTimerRef.current=null;
    recognitionRef.current=null;
    setListening(false);
    if(conversationRef.current){
      setStatus('شروع مکالمه صوتی ناموفق بود؛ در حال تلاش مجدد…');
      scheduleVoiceRestart();
    }
  }
};

const blobToBase64=async(blob:Blob)=>{const buf=await blob.arrayBuffer();let binary='';const bytes=new Uint8Array(buf);const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);};
const transcribeVoice=async(blob:Blob)=>{
 const base64=await blobToBase64(blob);
 const {data,error}=await supabase.functions.invoke('ai-assistant',{body:{voice_transcription:true,document_data:base64,document_mime_type:blob.type||'audio/mp4'}});
 if(error)throw error;
 const text=String(data?.answer||'').trim();
 if(!text)throw new Error('متن از صدا دریافت نشد.');
 setInput('');
 await ask(text);
};
const stopVoiceRecorder=()=>{try{if(mediaRecorderRef.current&&mediaRecorderRef.current.state!=='inactive')mediaRecorderRef.current.stop();}catch{}};
const startVoice=async()=>{
 if(listening||mediaRecorderRef.current){stopVoiceRecorder();return;}
 if(!window.isSecureContext){setStatus('برای استفاده از میکروفون، سایت باید با HTTPS باز شود.');return;}
 if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setStatus('ضبط صدای مرورگر در این دستگاه در دسترس نیست.');return;}
 setStatus('در حال درخواست اجازه Microphone…');
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  mediaStreamRef.current=stream;voiceChunksRef.current=[];
  const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);
  mediaRecorderRef.current=recorder;
  recorder.ondataavailable=(e)=>{if(e.data?.size)voiceChunksRef.current.push(e.data);};
  recorder.onerror=()=>{try{stream.getTracks().forEach(t=>t.stop());}catch{}mediaRecorderRef.current=null;mediaStreamRef.current=null;setListening(false);setStatus('ضبط صدا ناموفق بود.');};
  recorder.onstop=async()=>{
   mediaRecorderRef.current=null;try{stream.getTracks().forEach(t=>t.stop());}catch{}mediaStreamRef.current=null;setListening(false);
   const blob=new Blob(voiceChunksRef.current,{type:preferred||'audio/mp4'});voiceChunksRef.current=[];
   if(blob.size<1000){setStatus('صدای قابل استفاده‌ای ضبط نشد؛ دوباره صحبت کنید.');return;}
   setBusy(true);setStatus('در حال تبدیل صدا به متن…');
   try{await transcribeVoice(blob);setStatus('صدا با موفقیت به متن تبدیل و ارسال شد.');}
   catch(e:any){setStatus('خطای تبدیل صدا: '+await explainInvokeError(e));}
   finally{setBusy(false);}
  };
  recorder.start(250);setListening(true);setStatus('🎙️ میکروفون فعال است؛ صحبت کنید. برای پایان دوباره روی میکروفون بزنید.');
 }catch(error:any){
  setListening(false);const name=String(error?.name||'');
  if(name==='NotAllowedError'||name==='SecurityError')setStatus('دسترسی میکروفون رد شده است. روی «فعال‌کردن میکروفون» بزنید و اجازه Microphone را برای سایت فعال کنید.');
  else if(name==='NotFoundError')setStatus('میکروفون پیدا نشد یا به دستگاه وصل نیست.');
  else setStatus('فعال‌سازی میکروفون ناموفق بود؛ تنظیمات Microphone مرورگر را بررسی کنید.');
 }
};

const requestMicrophone=async()=>{setStatus('در حال درخواست اجازه Microphone…');const ok=await primeMicrophone();if(ok)setStatus('میکروفون آماده است. حالا دکمه میکروفون را بزنید و صحبت کنید.');};
 const apply=()=>{const result=applyToCurrentForm(fields);setApplied(result.applied.length);const missingLabel=result.missing.length?`؛ ${result.missing.length} فیلد در فرم فعلی پیدا نشد`:'';setStatus(`${result.applied.length} از ${Object.keys(fields).length} فیلد به فرم فعلی ارسال شد${missingLabel}. مقادیر از طریق state/رویداد React اعمال می‌شوند و بعد از بازنمایی صفحه نیز حفظ می‌شوند.`)};
 return <>{!open&&<button type="button" aria-label="باز کردن دستیار هوشمند" title="دستیار هوشمند" onClick={()=>setOpen(true)} className="ai-launcher"><Bot size={19}/></button>}{open&&<><div className="ai-backdrop" onClick={()=>setOpen(false)} aria-hidden="true"/><aside className="ai-chat-panel" dir="rtl" role="dialog" aria-label="دستیار هوشمند"><header className="ai-chat-header"><div className="ai-chat-header-main"><div className="ai-chat-avatar"><Bot size={17}/></div><div className="min-w-0"><div className="ai-chat-title">Customs AI</div><div className="ai-chat-subtitle">دستیار هوشمند Customs OS</div></div><button type="button" className="ai-model-button" title="مدل هوش مصنوعی"><span>هوش مصنوعی</span><ChevronDown size={13}/></button></div><div className="ai-chat-header-actions"><button type="button" className="ai-header-icon" title="چت جدید" onClick={()=>{setMessages([]);setInput('');setStatus('')}}><SquarePen size={17}/></button><button type="button" className="ai-header-icon" title="بستن پنل" onClick={()=>setOpen(false)}><PanelLeftClose size={18}/></button></div></header><main className="ai-chat-messages"><div className="ai-chat-column">{messages.length===0&&<div className="ai-welcome"><div className="ai-welcome-orb"><Bot size={23}/></div><h2>چطور می‌توانم کمک کنم؟</h2><p>در مورد محموله، اسناد، اظهار، گمرک یا هر بخش از Customs OS سؤال کنید.</p></div>}{messages.map((m,i)=><div key={i} className={`ai-message-row ${m.role==='user'?'is-user':'is-assistant'}`}><div className="ai-message"><div className="ai-message-role">{m.role==='user'?'شما':'Customs AI'}</div><div className="whitespace-pre-wrap leading-7">{m.text}</div></div></div>)}{busy&&<div className="ai-typing"><span></span><span></span><span></span><em>در حال فکر کردن…</em></div>}{status&&<div className="ai-status">{status}{/میکروفون|Microphone/.test(status)&&<button type="button" onClick={()=>void requestMicrophone()} className="mr-2 underline font-bold">فعال‌کردن میکروفون</button>}</div>}</div></main><footer className="ai-chat-composer-wrap"><div className="ai-chat-composer"><button type="button" className="ai-composer-icon" title="افزودن فایل" onClick={()=>{setTab('doc');setTimeout(()=>fileRef.current?.click(),0)}}><Plus size={20}/></button><input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e=>{if(e.target.files?.length)extractMany(e.target.files);e.currentTarget.value=''}}/><textarea value={input} rows={1} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!busy)void ask()}}} placeholder="پیام خود را بنویسید..." className="ai-chat-input"/><button type="button" onClick={startVoice} className={`ai-composer-icon ${listening?'is-listening':''}`} title={listening?'توقف مکالمه':'مکالمه صوتی'}>{listening?<MicOff size={18}/>:<Mic size={18}/>}</button><button type="button" onClick={()=>void ask()} disabled={busy||!input.trim()} className="ai-send-button" title="ارسال"><Send size={17}/></button></div><div className="ai-composer-hint">Customs AI به زمینه صفحه و اطلاعات محموله انتخاب‌شده دسترسی دارد.</div></footer>{tab==='doc'&&docResults.length>0&&<div className="ai-doc-toast"><div className="flex items-center gap-2"><CheckCircle2 size={16}/><b>استخراج اسناد</b><button type="button" className="ai-header-icon mr-auto" onClick={()=>setTab('chat')}><X size={15}/></button></div>{docResults.map((d,i)=><div key={`${d.name}-${i}`} className="text-xs mt-2">{d.error?`✕ ${d.name}: ${d.error}`:`✓ ${d.name}: ${Object.keys(d.fields).length} فیلد`}</div>)}{Object.keys(fields).length>0&&<button type="button" onClick={apply} className="ai-doc-apply">اعمال فیلدهای استخراج‌شده روی فرم</button>}</div>}</aside></>}</>;
};