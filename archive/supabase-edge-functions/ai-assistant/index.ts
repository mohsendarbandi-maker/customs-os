import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors=(o:string)=>({'Access-Control-Allow-Origin':o||'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const out=(x:unknown,s=200,o='')=>new Response(JSON.stringify(x),{status:s,headers:{...cors(o),'Content-Type':'application/json','Cache-Control':'no-store'}});
const fields=['vesselType','regNumber','regDate','packageCount','warehouseReceiptNo','warehouseReceiptDate','cargoDescription','originCountry','transactionCountry','deliveryTerm','invoiceAmount','invoiceCurrency','bankBranchCode','bankName','bankBranch','lcNumber','dutyRate','tariffCode','netWeight','grossWeight','billOfLading','insuranceIrr','requiredDocuments'];
const shipFields=['ownerName','shippingLine','vesselName','imo','count','unit','net','gross','billOfLading','billOfLadingYear','voyageNo','originPort','destinationPort'];
const strip=(s:string)=>s.replace(/^data:[^;]+;base64,/,'');
const clip=(s:string,n:number)=>{const x=String(s||'');return x.length<=n?x:x.slice(0,n)+'\\n[context clipped]';};
const geminiSchema=(keys:string[],formSchema:any[]=[])=>({type:'object',properties:Object.fromEntries(keys.map(k=>{const f=formSchema.find((x:any)=>x.key===k),values=Array.isArray(f?.options)?[...new Set(f.options.map((x:any)=>String(x.value||'')).filter(Boolean))]:[];return[k,{type:'string',description:String(f?.label||k),...(values.length?{enum:values}:{})}];})),required:keys});
const openaiSchema=(keys:string[],formSchema:any[]=[])=>({type:'object',properties:Object.fromEntries(keys.map(k=>{const f=formSchema.find((x:any)=>x.key===k),values=Array.isArray(f?.options)?[...new Set(f.options.map((x:any)=>String(x.value||'')).filter(Boolean))]:[];return[k,{type:'string',description:String(f?.label||k),...(values.length?{enum:values}:{})}];})),required:keys,additionalProperties:false});
const text=(d:any)=>d?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').filter(Boolean).join('\n').trim()||d?.output_text||d?.outputs?.filter((x:any)=>x?.type==='text').map((x:any)=>x.text||'').filter(Boolean).join('\n').trim()||d?.steps?.filter((s:any)=>Array.isArray(s?.content)).flatMap((s:any)=>s.content||[]).filter((x:any)=>x?.type==='text').map((x:any)=>x.text||'').filter(Boolean).join('\n').trim()||'';
const limited=(s:number,m:string)=>s===429||/rate.?limit|quota|too many|resource.?exhausted|limit exceeded/i.test(m);
const providerKeys=(name:string,primary:string|undefined)=>{const values:string[]=[];if(primary)values.push(primary);const prefix=name==='Gemini'?'GEMINI_API_KEY':name==='Groq'?'GROQ_API_KEY':'';if(prefix){const count=name==='Gemini'?10:5;for(let i=1;i<=count;i++){const value=Deno.env.get(prefix+'_'+i);if(value&&!values.includes(value))values.push(value);}}if(name==='Cloudflare'){for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_AI_TOKEN']){const value=Deno.env.get(key);if(value&&!values.includes(value))values.push(value);}}return values;};
const loadOperationalContext=async(sb:any,organizationId:string,selectedShipmentId='')=>{
  const shipmentQuery=sb.from('shipments').select('id,case_id,client_id,display_name,bill_of_lading_no,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,release_status,release_invoice_payment_status,finance_status').eq('organization_id',organizationId);
  if(selectedShipmentId)shipmentQuery.eq('id',selectedShipmentId);
  const [sh,cl,ca,de,sc,docsRes,checks,inv,pay,req,vesselResult]=await Promise.all([
    shipmentQuery.order('updated_at',{ascending:false}).limit(300),
    sb.from('clients').select('id,name').eq('organization_id',organizationId).limit(300),
    sb.from('cases').select('id,client_id,case_number,display_name,registration_order_no,warehouse_receipt_no,warehouse_receipt_date,cargo_count,cargo_count_unit,cargo_description,net_weight_kg,gross_weight_kg,status,release_status').eq('organization_id',organizationId).limit(300),
    sb.from('customs_declarations').select('id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,payment_reference,workflow_stage').eq('organization_id',organizationId).limit(300),
    sb.from('shipment_customs_data').select('shipment_id,registration_order_no,warehouse_receipt_no,warehouse_receipt_date_shamsi,cargo_description,tariff_code,net_weight_kg,gross_weight_kg,bill_of_lading').eq('organization_id',organizationId).limit(300),
    sb.from('shipment_documents').select('shipment_id,document_name,original_file_name,extraction_status').eq('organization_id',organizationId).limit(500),
    sb.from('case_checklist_items').select('case_id,stage_no,item_key,completed').eq('organization_id',organizationId).limit(1000),
    sb.from('finance_invoice_shipments').select('shipment_id,invoice_id').eq('organization_id',organizationId).limit(500),
    sb.from('finance_payments').select('shipment_id,case_id,amount,currency,amount_irr,payment_type,description,payment_date').eq('organization_id',organizationId).limit(500),
    sb.from('finance_payment_requests').select('shipment_id,request_no,requested_amount,currency,status,subject').eq('organization_id',organizationId).limit(500),
    sb.from('vessels').select('id,name,imo_number,flag,last_latitude,last_longitude,last_position_at,last_position_source,last_speed_knots,last_course_deg').eq('organization_id',organizationId).limit(300)
  ]);
  const clients=cl.data||[],cases=ca.data||[],declarations=de.data||[],customs=sc.data||[],docs=docsRes.data||[],checklistRows=checks.data||[],invoices=inv.data||[],payments=pay.data||[],requests=req.data||[],vesselRows=vesselResult.data||[];
  const cm=new Map(clients.map((x:any)=>[x.id,x])); const km=new Map(cases.map((x:any)=>[x.id,x]));
  const usable=(v:any)=>{const s=String(v??'').trim();return !!s&&!/^x{2,}$/i.test(s)&&s!=='—'&&s!=='-'};const dm=new Map<string,any>();for(const x of declarations){if(!x.shipment_id)continue;const prev=dm.get(x.shipment_id);if(!prev||(!usable(prev.kottaj_number)&&usable(x.kottaj_number))||(prev.kottaj_number===x.kottaj_number&&new Date(x.declaration_date||0)>new Date(prev.declaration_date||0)))dm.set(x.shipment_id,x);}
  const sm=new Map<string,any>();for(const x of customs){if(x.shipment_id&&!sm.has(x.shipment_id))sm.set(x.shipment_id,x);}const vm=new Map(vesselRows.map((x:any)=>[x.id,x]));const docsBy=new Map<string,any[]>();for(const x of docs){const a=docsBy.get(x.shipment_id)||[];a.push(x);docsBy.set(x.shipment_id,a);}const checksBy=new Map<string,any[]>();for(const x of checklistRows){const a=checksBy.get(x.case_id)||[];a.push(x);checksBy.set(x.case_id,a);}const invIdsBy=new Map<string,string[]>();for(const x of invoices){const a=invIdsBy.get(x.shipment_id)||[];a.push(x.invoice_id);invIdsBy.set(x.shipment_id,a);}const payBy=new Map<string,any[]>();for(const x of payments){const a=payBy.get(x.shipment_id)||[];a.push(x);payBy.set(x.shipment_id,a);}const reqBy=new Map<string,any[]>();for(const x of requests){const a=reqBy.get(x.shipment_id)||[];a.push(x);reqBy.set(x.shipment_id,a);}
  const rows=(sh.data||[]).map((s:any)=>{const ca=km.get(s.case_id)||null,cl=cm.get(s.client_id||ca?.client_id)||null,de=dm.get(s.id)||null,sc=sm.get(s.id)||null;return {shipment_id:s.id,client_name:cl?.name||null,case_number:ca?.case_number||null,shipment_name:s.display_name||null,cargo_count:s.cargo_count??ca?.cargo_count??null,cargo_unit:s.cargo_count_unit??ca?.cargo_count_unit??null,bill_of_lading:s.bill_of_lading_no||sc?.bill_of_lading||null,kottaj_number:de?.kottaj_number||null,warehouse_receipt_no:sc?.warehouse_receipt_no||ca?.warehouse_receipt_no||null,warehouse_receipt_date:sc?.warehouse_receipt_date_shamsi||ca?.warehouse_receipt_date||null,registration_order_no:sc?.registration_order_no||ca?.registration_order_no||null,net_weight_kg:s.net_weight_kg??sc?.net_weight_kg??ca?.net_weight_kg??null,gross_weight_kg:s.gross_weight_kg??sc?.gross_weight_kg??ca?.gross_weight_kg??null,cargo_description:sc?.cargo_description||ca?.cargo_description||null,status:s.current_status||ca?.status||null,release_status:s.release_status||ca?.release_status||null,release_invoice_payment_status:s.release_invoice_payment_status||null,finance_status:s.finance_status||null,workflow_stage:de?.workflow_stage??null,customs_path:de?.customs_path||null,vessel:(vm.get(s.vessel_id)||null),documents:docsBy.get(s.id)||[],checklist:checksBy.get(s.case_id)||[],invoice_ids:invIdsBy.get(s.id)||[],payments:payBy.get(s.id)||[],payment_requests:reqBy.get(s.id)||[]};});
  return JSON.stringify(rows).slice(0,70000);
};

const loadWebsiteContext=async(sb:any,organizationId:string,selectedShipmentId='')=>{
  const reportQuery=sb.from('file_manager_shipment_reports').select('id,shipment_id,status,stage,report,actor_name,created_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(250);
  const fileQuery=sb.from('file_manager_files').select('id,shipment_id,client_id,folder_id,original_name,mime_type,size_bytes,document_type,tags,operation_sections,file_manager_search_text,created_at').eq('organization_id',organizationId).eq('is_archived',false).order('created_at',{ascending:false}).limit(400);
  const customsExtractionQuery=sb.from('customs_document_extractions').select('id,shipment_id,display_name,original_file_name,document_type,operation_section,status,extracted_fields,confidence,created_at,completed_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(300);
  const shipmentExtractionQuery=sb.from('shipment_document_extractions').select('id,shipment_id,document_id,field_key,field_label,extracted_value,source_text,confidence,page_number,updated_at').eq('organization_id',organizationId).order('updated_at',{ascending:false}).limit(600);
  const reminderQuery=sb.from('operational_reminders').select('id,shipment_id,case_id,title,description,due_at,priority,status,kind,entity_type,entity_id,assignee_id,visibility,created_at').eq('organization_id',organizationId).is('deleted_at',null).order('due_at',{ascending:true}).limit(400);
  if(selectedShipmentId){
    reportQuery.eq('shipment_id',selectedShipmentId);
    fileQuery.eq('shipment_id',selectedShipmentId);
    customsExtractionQuery.eq('shipment_id',selectedShipmentId);
    shipmentExtractionQuery.eq('shipment_id',selectedShipmentId);
    reminderQuery.eq('shipment_id',selectedShipmentId);
  }
  const [reports,files,folders,customsExtractions,shipmentExtractions,reminders,orders]=await Promise.all([
    reportQuery,
    fileQuery,
    sb.from('file_manager_folders').select('id,parent_id,display_name').eq('organization_id',organizationId).limit(600),
    customsExtractionQuery,
    shipmentExtractionQuery,
    reminderQuery,
    sb.from('registration_orders').select('id,case_id,client_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,net_weight_kg,gross_weight_kg,bank_name,bank_branch,bank_branch_code,payment_instrument_code,is_closed,closed_at,notes').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(300)
  ]);
  const sourceResults={reports,files,folders,customsExtractions,shipmentExtractions,reminders,orders};
  const unavailableSections=Object.entries(sourceResults).filter(([,result]:any)=>result?.error).map(([name,result]:any)=>({section:name,error:String(result.error.message||'query failed').slice(0,240)}));
  if(unavailableSections.length)console.error('[ai-assistant] website context sections unavailable:',JSON.stringify(unavailableSections));
  const folderNames=new Map((folders.data||[]).map((f:any)=>[f.id,f.display_name]));
  return JSON.stringify({
    reports:(reports.data||[]).slice(0,40).map((x:any)=>({shipment_id:x.shipment_id,status:x.status,stage:x.stage,report:String(x.report||'').slice(0,1800),actor_name:x.actor_name,created_at:x.created_at})),
    file_manager_files:(files.data||[]).slice(0,60).map((x:any)=>({id:x.id,shipment_id:x.shipment_id,client_id:x.client_id,name:x.original_name,folder:folderNames.get(x.folder_id)||null,mime_type:x.mime_type,size_bytes:x.size_bytes,document_type:x.document_type,tags:x.tags,operation_sections:x.operation_sections,search_text:String(x.file_manager_search_text||'').slice(0,1000),created_at:x.created_at})),
    customs_document_extractions:(customsExtractions.data||[]).slice(0,50).map((x:any)=>({shipment_id:x.shipment_id,name:x.display_name||x.original_file_name,document_type:x.document_type,operation_section:x.operation_section,status:x.status,fields:x.extracted_fields,confidence:x.confidence,completed_at:x.completed_at})),
    shipment_document_extractions:(shipmentExtractions.data||[]).slice(0,100).map((x:any)=>({shipment_id:x.shipment_id,document_id:x.document_id,field:x.field_key,label:x.field_label,value:x.extracted_value,source_text:String(x.source_text||'').slice(0,500),confidence:x.confidence,page:x.page_number,updated_at:x.updated_at})),
    operational_reminders:(reminders.data||[]).slice(0,70),
    registration_orders:(orders.data||[]).slice(0,70),
    unavailable_sections:unavailableSections
  }).slice(0,42000);
};

Deno.serve(async(req)=>{const o=req.headers.get('Origin')||'';if(req.method==='OPTIONS')return new Response('ok',{headers:cors(o)});if(req.method!=='POST')return out({error:'Method not allowed.'},405,o);try{
const internalToken=(req.headers.get('x-knowledge-worker-token')||'').trim();
if(internalToken){
 const expected='a228451145959efb301e866e2908a5ea03f156a12b5b6d4872df60595f4c0f9d';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(internalToken))),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==expected)return out({error:'Unauthorized internal knowledge request'},401,o);
 const body=await req.json().catch(()=>({}));
 if(body.action==='knowledge_ocr_status'){
  return out({
   openaiConfigured:Boolean(Deno.env.get('OPENAI_API_KEY')),
   geminiConfigured:Boolean(Deno.env.get('GEMINI_API_KEY')),
   model:'gpt-4.1-mini'
  },200,o);
 }
 if(body.action!=='knowledge_ocr_page')return out({error:'Unsupported internal knowledge action'},400,o);
 const apiKey=Deno.env.get('OPENAI_API_KEY');
 if(!apiKey)return out({error:'OPENAI_API_KEY is not configured on AI service'},503,o);
 const pageNumber=Number(body.page_number);
 const pdfBase64=String(body.page_pdf_base64||'').replace('data:application/pdf;base64,','');
 if(!Number.isInteger(pageNumber)||pageNumber<1||!pdfBase64||pdfBase64.length>25_000_000)return out({error:'Invalid page OCR payload'},400,o);
 const prompt='این فایل دقیقاً یک صفحه از یک سند رسمی گمرکی فارسی است. شماره صفحه PDF اصلی '+pageNumber+' و نام فایل '+String(body.filename||'سند گمرکی')+' است. تمام متن قابل مشاهده همین صفحه را عیناً و کامل رونویسی کن؛ خلاصه‌سازی، حذف، بازنویسی یا تکمیل حدسی ممنوع است. سربرگ، پانوشت، شماره نامه، تاریخ، شماره صفحه چاپی، بندها، تبصره‌ها، اعداد، جدول‌ها، ستون‌ها، مهرها و نوشته‌های داخل تصویر را بررسی کن. جدول‌ها را به صورت ردیف به ردیف و با جداکننده | ثبت کن. ارقام را همانطور که دیده می‌شوند حفظ کن. بخش ناخوانا را فقط با [ناخوانا] مشخص کن و بقیه متن را نگه دار. اگر صفحه واقعاً سفید است page_kind=blank، اگر فقط عنوان یا جداکننده فصل است page_kind=divider. از صفحات دیگر هیچ متنی اضافه نکن.';
 const schema={type:'object',properties:{page_text:{type:'string'},page_kind:{type:'string',enum:['text','table','form','image','cover','divider','blank','unknown']},confidence:{type:'number'},notes:{type:'string'}},required:['page_text','page_kind','confidence','notes'],additionalProperties:false};
 const response=await fetch('https://api.openai.com/v1/responses',{
  method:'POST',
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({
   model:'gpt-4.1-mini',
   input:[{role:'user',content:[
    {type:'input_file',filename:'page-'+pageNumber+'.pdf',file_data:'data:application/pdf;base64,'+pdfBase64},
    {type:'input_text',text:prompt}
   ]}],
   text:{format:{type:'json_schema',name:'customs_page_ocr',strict:true,schema}},
   max_output_tokens:8192,
   store:false
  }),
  signal:AbortSignal.timeout(55000)
 });
 const raw=await response.text();let result:any={};try{result=JSON.parse(raw)}catch{}
 if(!response.ok)return out({error:String(result?.error?.message||'OpenAI page OCR failed: HTTP '+response.status),status:response.status},response.status===429?429:502,o);
 const output=String(result.output_text||(
  Array.isArray(result.output)
   ? result.output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[])
      .filter((item:any)=>item?.type==='output_text'||item?.type==='text')
      .map((item:any)=>String(item?.text||'')).join('\n')
   : ''
 )).trim();
 if(!output)return out({error:'OpenAI returned an empty page OCR result'},502,o);
 let parsed:any;try{parsed=JSON.parse(output)}catch{return out({error:'OpenAI returned invalid page OCR JSON'},502,o);}
 return out({page_text:String(parsed.page_text||''),page_kind:String(parsed.page_kind||'unknown'),confidence:Number(parsed.confidence)||0,notes:String(parsed.notes||''),model:'gpt-4.1-mini'},200,o);
}
const a=req.headers.get('Authorization')||'',token=a.startsWith('Bearer ')?a.slice(7):'';if(!token)return out({error:'Unauthorized'},401,o);const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,sb=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}});const{data:{user}}=await sb.auth.getUser(token);if(!user)return out({error:'Unauthorized'},401,o);const{data:profile}=await sb.from('profiles').select('role,is_active,organization_id').eq('id',user.id).maybeSingle();if(!profile||profile.is_active===false)return out({error:'پروفایل کاربر معتبر یا فعال نیست.'},403,o);const b=await req.json().catch(()=>({}));const q=String(b.query||'').slice(0,12000),dt=String(b.document_text||'').slice(0,30000);let dd=strip(String(b.document_data||''));const dm=String(b.document_mime_type||'').toLowerCase(),documentStoragePath=String(b.document_storage_path||'').trim(),telegramFileAssetId=String(b.telegram_file_asset_id||'').trim(),docs=Array.isArray(b.documents)?b.documents:[],ex=!!b.extract_fields,formFill=!!b.form_fill,voice=!!b.voice_transcription,sh=!!b.shipment_extract||q.includes('اطلاعات محموله کشتیرانی');const formSchema=Array.isArray(b.form_schema)?b.form_schema.slice(0,60).map((f:any)=>({key:String(f?.key||'').slice(0,80),label:String(f?.label||'').slice(0,160),type:String(f?.type||'text').slice(0,24),required:Boolean(f?.required),options:Array.isArray(f?.options)?f.options.slice(0,40).map((o:any)=>({label:String(o?.label||'').slice(0,120),value:String(o?.value??'').slice(0,120)})):[]})).filter((f:any)=>/^[a-zA-Z0-9_-]+$/.test(f.key)&&f.label):[];const formValues=b.current_form_values&&typeof b.current_form_values==='object'?Object.fromEntries(formSchema.filter((f:any)=>typeof b.current_form_values[f.key]==='string').map((f:any)=>[f.key,String(b.current_form_values[f.key]).slice(0,500)])):{};const selectedShipmentId=String(b.shipment_id||'').slice(0,80),pageContext=String(b.page_context||'').slice(0,1000),sessionId=String(b.session_id||'').slice(0,120);const documentSizeBytes=Number(b.document_size_bytes||0);let signedDocumentUrl='';
 if(!dd&&telegramFileAssetId){try{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(telegramFileAssetId))return out({error:'شناسه فایل آرشیو تلگرام معتبر نیست.'},400,o);
  const appBase=(Deno.env.get('CUSTOMS_OS_PUBLIC_URL')||'https://darbandicommercial.ir').replace(/\/$/,'');
  const fileUrl=appBase+'/api/messenger/files/'+encodeURIComponent(telegramFileAssetId)+'/download';
  const fileResponse=await fetch(fileUrl,{method:'GET',headers:{Authorization:`Bearer ${token}`,apikey:anon},signal:AbortSignal.timeout(10000)});
  if(!fileResponse.ok){
   const detail=await fileResponse.text().catch(()=>'');
   throw new Error(`بازیابی سند از آرشیو تلگرام ناموفق بود (HTTP ${fileResponse.status}): ${detail.slice(0,300)}`);
  }
  const buffer=await fileResponse.arrayBuffer();
  if(buffer.byteLength>20*1024*1024)return out({error:'حجم فایل آرشیوشده از سقف قابل بازیابی تلگرام (۲۰MB) بیشتر است.'},413,o);
  const bytes=new Uint8Array(buffer);let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  dd=btoa(binary);
 }catch(e){return out({error:`خواندن فایل از آرشیو تلگرام ناموفق بود: ${e instanceof Error?e.message:String(e)}`},502,o);}}
 if(!dd&&documentStoragePath){try{
  if(documentStoragePath.length>500||documentStoragePath.includes('..')||documentStoragePath.startsWith('/')||!profile.organization_id||!documentStoragePath.startsWith(String(profile.organization_id)+'/'))return out({error:'مسیر سند نامعتبر یا خارج از سازمان است.'},400,o);
  let storedBytes:ArrayBuffer|null=null;
  if(dm==='application/pdf'&&documentSizeBytes>0&&documentSizeBytes<=15*1024*1024){
   try{
    const {data:signed,error:signedError}=await sb.storage.from('customs_documents').createSignedUrl(documentStoragePath,600);
    if(!signedError&&signed?.signedUrl){
     const response=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(10000)});
     if(response.ok)storedBytes=await response.arrayBuffer();
    }
   }catch(storageUrlError){console.warn('[ai-assistant] signed Storage fetch fallback:',storageUrlError instanceof Error?storageUrlError.message:String(storageUrlError));}
  }
  if(!storedBytes){
   const {data:file,error:fileError}=await sb.storage.from('customs_documents').download(documentStoragePath);
   if(fileError||!file)throw new Error(fileError?.message||'سند از Storage قابل دریافت نیست.');
   storedBytes=await file.arrayBuffer();
  }
  if(storedBytes.byteLength>30*1024*1024)return out({error:'حجم سند برای استخراج هوش مصنوعی بیش از ۳۰MB است.'},413,o);
  const bytes=new Uint8Array(storedBytes);let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));dd=btoa(binary);
 }catch(e){return out({error:`دریافت سند از Storage ناموفق بود: ${e instanceof Error?e.message:String(e)}`},502,o);}}
 if(!q&&!dt&&!dd&&!docs.length)return out({error:'No query or document was supplied.'},400,o);const commandMode=!!b.command_mode||String(b.mode||'')==='agent';let operationalContext='';let knowledgeContext='';
 if(!ex&&!sh&&!voice&&!formFill&&q&&profile.organization_id){
  try{
   const {count:activeKnowledgeCount,error:knowledgeCountError}=await sb.from('knowledge_sources').select('id',{count:'exact',head:true}).eq('organization_id',profile.organization_id).eq('status','active');
   if(knowledgeCountError)throw knowledgeCountError;
   if((activeKnowledgeCount||0)>0){
    const numberMatch=q.match(/[0-9۰-۹]{4}[\/／][0-9۰-۹]{3,}/);
    const exactNumber=numberMatch?numberMatch[0].replace(/[۰-۹]/g,(d:string)=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))):'';
    const geminiKey=Deno.env.get('GEMINI_API_KEY');
    let semanticRows:any[]=[];
    if(geminiKey){
     try{
      const er=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{method:'POST',headers:{'x-goog-api-key':geminiKey,'Content-Type':'application/json'},body:JSON.stringify({content:{parts:[{text:q.slice(0,30000)}]},output_dimensionality:1536}),signal:AbortSignal.timeout(7000)});
      const ej=await er.json().catch(()=>({}));
      const vector=ej?.embedding?.values;
      if(er.ok&&Array.isArray(vector)&&vector.length===1536){
       const {data,error}=await sb.rpc('search_knowledge_semantic',{query_embedding:vector,match_count:20,match_threshold:0.12});
       if(error)throw error;
       semanticRows=Array.isArray(data)?data:[];
      }else{console.warn('[ai-assistant] knowledge embedding unavailable:',ej?.error?.message||er.status);}
     }catch(semanticError){console.warn('[ai-assistant] semantic retrieval failed; lexical retrieval will still run:',semanticError instanceof Error?semanticError.message:String(semanticError));}
    }
    const lexicalCalls=[sb.rpc('search_knowledge_chunks',{query_text:q.slice(0,1000),match_count:20})];
    if(exactNumber)lexicalCalls.push(sb.rpc('search_knowledge_chunks',{query_text:exactNumber,match_count:20}));
    const lexicalResults=await Promise.all(lexicalCalls);
    const lexicalRows:any[]=[];
    for(const result of lexicalResults){
     if(result.error)console.warn('[ai-assistant] lexical retrieval warning:',result.error.message);
     if(Array.isArray(result.data))lexicalRows.push(...result.data);
    }
    const merged=new Map<string,any>();
    const addRow=(row:any,kind:string)=>{
     const key=String(row.id||row.source_id+'|'+row.page_number+'|'+String(row.content||'').slice(0,160));
     const prior=merged.get(key)||{...row,_score:0,_exact:false};
     if(kind==='semantic')prior._score=Math.max(prior._score,Number(row.similarity||0)*100);
     if(kind==='lexical')prior._score=Math.max(prior._score,Number(row.rank||0)*100+5);
     if(exactNumber&&String(row.content||'').includes(exactNumber)){prior._exact=true;prior._score+=1000;}
     merged.set(key,prior);
    };
    semanticRows.forEach((row:any)=>addRow(row,'semantic'));
    lexicalRows.forEach((row:any)=>addRow(row,'lexical'));
    const exactAnchor=lexicalRows.find((row:any)=>exactNumber&&String(row.content||'').includes(exactNumber));
    let pageQualityNote='';
    if(exactAnchor?.source_id&&Number.isInteger(Number(exactAnchor.page_number))){
     const center=Number(exactAnchor.page_number);
     const {data:qualityRows,error:qualityError}=await sb.rpc('get_knowledge_page_quality',{
      p_source_id:exactAnchor.source_id,
      p_from_page:Math.max(1,center-2),
      p_to_page:center+3
     });
     if(qualityError){
      console.warn('[ai-assistant] page-quality lookup warning:',qualityError.message);
     }else{
      const unresolved=(Array.isArray(qualityRows)?qualityRows:[]).filter((p:any)=>p.status!=='complete');
      if(unresolved.length){
       pageQualityNote='هشدار کنترل کیفیت حافظه: وضعیت OCR بعضی صفحات مرتبط هنوز کامل تأیید نشده است: '+
        unresolved.map((p:any)=>'صفحه '+p.page_number+' ('+p.status+')').join('، ')+
        '. محتوای این صفحات را قطعی تلقی نکن و کمبود شواهد را صریح اعلام کن.';
      }
     }
     const {data:neighbors,error:neighborError}=await sb.from('knowledge_chunks')
      .select('id,source_id,content,page_number,metadata')
      .eq('source_id',exactAnchor.source_id)
      .eq('organization_id',profile.organization_id)
      .gte('page_number',Math.max(1,center-2))
      .lte('page_number',center+3)
      .order('page_number',{ascending:true})
      .limit(40);
     if(neighborError)console.warn('[ai-assistant] adjacent-page retrieval warning:',neighborError.message);
     for(const row of (Array.isArray(neighbors)?neighbors:[])){
      addRow({...row,title:exactAnchor.title,source_number:exactAnchor.source_number,issued_at:exactAnchor.issued_at},'lexical');
      const key=String(row.id||row.source_id+'|'+row.page_number+'|'+String(row.content||'').slice(0,160));
      const neighbor=merged.get(key);if(neighbor)neighbor._score=Math.max(neighbor._score,350);
     }
    }
    const rows=[...merged.values()].sort((a:any,b:any)=>(b._score-a._score)||((a.page_number||0)-(b.page_number||0))).slice(0,24);
    knowledgeContext=(pageQualityNote?pageQualityNote+'\n\n':'')+rows.map((row:any,i:number)=>
     '['+(i+1)+'] '+String(row.title||'سند دانشنامه')+
     ' | شماره سند: '+String(row.source_number||'نامشخص')+
     ' | تاریخ: '+String(row.issued_at||'نامشخص')+
     ' | صفحه PDF: '+String(row.page_number??'نامشخص')+
     '\n'+String(row.content||'')
    ).join('\n\n').slice(0,16000);
   }
  }catch(knowledgeError){console.error('[ai-assistant] hybrid knowledge retrieval failed:',knowledgeError instanceof Error?knowledgeError.message:String(knowledgeError));}
 }
 if(!ex&&!sh&&!voice&&!formFill&&q&&profile.organization_id){try{const [shipmentContext,websiteContext]=await Promise.all([loadOperationalContext(sb,profile.organization_id,selectedShipmentId),loadWebsiteContext(sb,profile.organization_id,selectedShipmentId)]);operationalContext='SHIPMENT CONTEXT (JSON):\\n'+shipmentContext+'\\nWEBSITE CONTEXT (JSON):\\n'+websiteContext;}catch(contextError){console.error('[ai-assistant] live website context failed:',contextError instanceof Error?contextError.message:String(contextError));operationalContext=''}}if(!ex&&!sh&&!voice&&q&&profile.organization_id){try{const [shipmentContext,websiteContext]=await Promise.all([loadOperationalContext(sb,profile.organization_id,selectedShipmentId),loadWebsiteContext(sb,profile.organization_id,selectedShipmentId)]);operationalContext='SHIPMENT CONTEXT (JSON):\\n'+shipmentContext+'\\nWEBSITE CONTEXT (JSON):\\n'+websiteContext;}catch(contextError){console.error('[ai-assistant] live website context failed:',contextError instanceof Error?contextError.message:String(contextError));operationalContext=''}}console.log(JSON.stringify({event:'ai_request',extract_fields:ex,has_document_data:!!dd,has_storage_path:!!documentStoragePath,has_telegram_file_asset:!!telegramFileAssetId,fetched_from_storage:!!documentStoragePath&&!!dd,fetched_from_telegram:!!telegramFileAssetId&&!!dd,mime:dm,document_bytes_base64:dd.length}));const prompt=voice?'این فایل صوتی را به متن دقیق فارسی تبدیل کن. فقط همان کلمات گفته‌شده را برگردان؛ هیچ خلاصه، توضیح، ترجمه، حدس یا قالب‌بندی اضافه نکن.':formFill?'به‌عنوان دستیار تکمیل فرم Customs OS، فرم باز را فقط با شواهد موجود در داده‌های واقعی محموله/پرونده همین سازمان، مقادیر فعلی فرم و درخواست کاربر تکمیل پیشنهادی کن. هرگز شماره رسمی، IMO، بارنامه، کوتاژ، ثبت سفارش، وزن، تعداد، مبلغ یا تاریخ را حدس نزن. مقدارهای فعلی را حفظ کن مگر کاربر صریحاً تغییرشان را خواسته باشد. فقط کلیدهای زیر را برگردان. برای select فقط value دقیق یکی از گزینه‌های schema را انتخاب کن؛ اگر شاهد یا تطبیق قطعی نیست رشته خالی بده. هیچ عملیاتی را ثبت یا ارسال نکن. درخواست کاربر: '+q+'\nساختار فرم و گزینه‌های مجاز: '+JSON.stringify(formSchema)+'\nمقادیر فعلی فرم: '+JSON.stringify(formValues)+'\nداده‌های عملیاتی واقعی سازمان: '+clip(operationalContext,9000)+'\nخروجی فقط JSON.':sh?'از تمام صفحات و جدول‌های همین بارنامه فقط این کلیدها را استخراج کن: ownerName (نام دقیق صاحب کالا/Consignee)، shippingLine، vesselName، imo، count (تعداد واقعی محموله/بسته)، unit (واحد همان سند مثل رول/بسته/کانتینر)، net (وزن خالص)، gross (وزن ناخالص)، billOfLading (شماره B/L)، billOfLadingYear (سال درج‌شده روی B/L)، voyageNo (شماره سفر)، originPort (بندر بارگیری)، destinationPort (بندر تخلیه). فقط مقادیر قابل مشاهده در سند را برگردان؛ شماره IMO، B/L، تعداد و وزن را حدس نزن و بین وزن خالص و ناخالص جابه‌جا نکن. هر مقدار ناموجود یا ناخوانا را رشته خالی بده. خروجی فقط JSON با همین کلیدها و مقدارهای رشته‌ای.':ex?'فقط از همین سند/فایل ورودی اطلاعات استخراج کن؛ از حافظه، پیام‌های قبلی، اسناد قبلی یا حدس استفاده نکن. همه صفحات، جدول‌ها، سربرگ‌ها، پاورقی‌ها و نوشته‌های روی بارنامه/اسناد را بخوان. اعداد، واحدها، تعداد بسته و رول، نام اشخاص و شرکت‌ها، شماره بارنامه، شماره سفر، IMO، بندر بارگیری و تخلیه، تاریخ‌ها، وزن خالص و ناخالص و مقادیر مالی را دقیقاً همان‌طور که در سند آمده حفظ کن. مقدار ناموجود یا ناخوانا را خالی بگذار و هرگز حدس نزن. برای فرم فعلی فقط کلیدهای ارسالی را برگردان؛ در فیلدهای select فقط value دقیق یکی از گزینه‌های مجاز را استفاده کن و اگر تطبیق قطعی نیست خالی بگذار. ساختار فرم و گزینه‌های مجاز: '+JSON.stringify(formSchema)+'. خروجی فقط یک شیء JSON با مقادیر رشته‌ای باشد.':commandMode?'تو دستیار عملیاتی Customs OS هستی. پرسش را فقط بر اساس داده واقعی زیر پاسخ بده. برای «۲۲ رول شرکت آبتین» تعداد و صاحب کالا را تطبیق بده. شماره کوتاژ فقط از kottaj_number، قبض انبار فقط از warehouse_receipt_no و ثبت سفارش فقط از registration_order_no. اگر چند مورد است همه را جدا کن؛ اگر نیست صریحاً ثبت نشده بگو؛ هرگز حدس نزن. پاسخ کوتاه و فارسی باشد. داده عملیاتی:\n'+operationalContext:q||'اسناد را برای عملیات گمرکی تحلیل کن.';const keys=(formFill||ex)&&formSchema.length?formSchema.map((f:any)=>f.key):(sh?shipFields:(ex?fields:[]));const chatContextSuffix=(!voice&&!ex&&!sh&&!formFill&&!commandMode&&operationalContext?'\n\nداده‌های زنده و مجاز از وب‌سایت Customs OS، شامل محموله‌ها، فایل‌منیجر، گزارش‌ها، استخراج اسناد، یادآورها و ثبت‌سفارش‌ها. فقط بر اساس این داده‌ها پاسخ بده؛ موارد ناموجود را صریحاً اعلام کن و هیچ شماره/مبلغ/تاریخی را حدس نزن:\n'+clip(operationalContext,10500):'')+(knowledgeContext?'\\n\\nحافظه پایدار دانشنامه Customs OS (بازیابی ترکیبی معنایی + متنی، جست‌وجوی شماره سند و صفحات مجاور؛ هر ادعای مستند را با عنوان سند و شماره صفحه PDF ارجاع بده. متن ناقص یا صفحه نیازمند بازبینی را کامل فرض نکن؛ میان عین متن سند، استنباط و داده ناموجود صریحاً تفاوت بگذار و هیچ شماره/تاریخ/ماده قانونی را حدس نزن):\\n'+clip(knowledgeContext,12000):'');const input=clip('صفحه فعلی: '+pageContext+'\nمحموله انتخاب‌شده: '+selectedShipmentId+'\n'+prompt+chatContextSuffix+'\n'+(dt?dt:''),22000);const errors:string[]=[];const binaryDocumentExtraction=ex&&!!dd&&(dm==='application/pdf'||dm.startsWith('image/'));
 const extractionDeadline=Date.now()+(binaryDocumentExtraction?38000:12000);
 const toBytes=(b64:string)=>{const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};
 const providers=[
 {name:'Gemini',key:Deno.env.get('GEMINI_API_KEY'),run:async(k:string)=>{
  let last:any=null;
  const modelOrder=['gemini-3.5-flash-lite','gemini-3.8-flash'];
  for(const model of modelOrder){
   const remaining=extractionDeadline-Date.now();if(remaining<2000)break;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(binaryDocumentExtraction?13500:5200,remaining-900));
   try{
    let endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent';
    let payload:any;
    if(dm==='application/pdf'&&dd){
     endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
     payload={model,input:[{type:'text',text:input},{type:'document',data:dd,mime_type:dm}],response_format:{type:'text',mime_type:'application/json',schema:geminiSchema(keys,formSchema)},generation_config:{max_output_tokens:1800},store:false};
    }else{
     const pp:any=[{text:input}];if(dd)pp.push({inlineData:{mimeType:dm,data:dd}});
     payload={contents:[{role:'user',parts:pp}],generationConfig:keys.length?{responseMimeType:'application/json',responseSchema:geminiSchema(keys,formSchema),maxOutputTokens:900,temperature:0.2}:{maxOutputTokens:650,temperature:0.2}};
    }
    const r=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':k,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};const t=text(d);
    last={r,d,t};
    if(r.ok&&String(t||'').trim())return last;
    const reason=String(d?.error?.message||d?.error||`HTTP ${r.status}`);
    errors.push(`Gemini ${model}: ${reason}`);
   }catch(e){
    const reason=e instanceof Error?e.message:String(e);
    errors.push(`Gemini ${model}: ${reason}`);
    last={r:{status:0,ok:false},d:{error:{message:reason}},t:''};
   }finally{clearTimeout(timer);}
  }
  if(last)return last;
  throw new Error('هیچ مدل Gemini پاسخ نداد.');
}},
 {name:'Cloudflare',key:Deno.env.get('CLOUDFLARE_API_TOKEN')||Deno.env.get('CLOUDFLARE_AI_TOKEN'),run:async(k:string)=>{const account=Deno.env.get('CLOUDFLARE_ACCOUNT_ID');if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID missing');const model=voice?'@cf/openai/whisper':'@cf/meta/llama-3.1-8b-instruct';const headers:any={Authorization:'Bearer '+k};let body:any;if(voice){body=toBytes(dd);headers['Content-Type']='application/octet-stream';}else{headers['Content-Type']='application/json';body=JSON.stringify({messages:[{role:'user',content:input}]});}const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/'+model,{method:'POST',headers,body});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:voice?(d?.result?.text||''):(d?.result?.response||'')}}},
 {name:'Groq',key:Deno.env.get('GROQ_API_KEY'),run:async(k:string)=>{if(voice){const form=new FormData();form.append('file',new Blob([toBytes(dd)],{type:dm||'audio/mp4'}),'voice.'+(dm.includes('webm')?'webm':'mp4'));form.append('model','whisper-large-v3');form.append('language','fa');form.append('response_format','json');form.append('temperature','0');const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${k}`},body:form});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:d?.text||''};}const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${k}`,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-120b',messages:[{role:'system',content:'Return exactly one JSON object. Never invent customs identifiers or values.'},{role:'user',content:clip(input,14000)}],temperature:0,max_tokens:1400,response_format:keys.length?{type:'json_object'}:undefined})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:d?.choices?.[0]?.message?.content||''}}},
 {name:'OpenRouter',key:Deno.env.get('OPENROUTER_API_KEY'),run:async(k:string)=>{const content:any[]=voice?[{type:'text',text:input},{type:'input_audio',input_audio:{data:dd,format:dm.includes('webm')?'webm':'mp4'}}]:[{type:'text',text:input}];const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json','HTTP-Referer':'https://customs.mohsen-darbandi.workers.dev','X-Title':'Customs OS'},body:JSON.stringify({model:'google/gemini-2.5-flash',messages:[{role:'user',content}],response_format:keys.length?{type:'json_object'}:undefined})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:d?.choices?.[0]?.message?.content||''}}},
 {name:'OpenAI',key:Deno.env.get('OPENAI_API_KEY'),run:async(k:string)=>{if(voice){const form=new FormData();form.append('file',new Blob([toBytes(dd)],{type:dm||'audio/mp4'}),'voice.'+(dm.includes('webm')?'webm':'mp4'));form.append('model','gpt-4o-mini-transcribe');form.append('language','fa');const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${k}`},body:form});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:d?.text||''};}const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${k}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',input:input,text:keys.length?{format:{type:'json_schema',name:'extraction',schema:openaiSchema(keys,formSchema),strict:true}}:undefined})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};return {r,d,t:d?.output_text||''}}}
 ];for(const p of providers){if(Date.now()>=extractionDeadline)break;if(binaryDocumentExtraction&&p.name!=='Gemini'){errors.push(p.name+': skipped because it does not receive the uploaded PDF/image payload');continue;}for(const key of providerKeys(p.name,p.key)){if(Date.now()>=extractionDeadline)break;try{const providerStartedAt=Date.now();const z=await p.run(key),msg=String(z.d?.error?.message||z.d?.error||`HTTP ${z.r.status}`);if(z.r.ok&&String(z.t||'').trim()){const finalAnswer=String(z.t).trim();console.log(JSON.stringify({event:'ai_provider_success',provider:p.name,elapsed_ms:Date.now()-providerStartedAt,model:z.d?.modelVersion||null,has_live_context:!!operationalContext}));if(!ex&&!voice&&!sh&&q&&profile.organization_id){const {error:interactionError}=await sb.from('ai_interactions').insert({organization_id:profile.organization_id,user_id:user.id,shipment_id:selectedShipmentId||null,session_id:sessionId||null,mode:commandMode?'agent':'chat',query:q,answer:finalAnswer,provider:p.name,model:String(z.d?.modelVersion||z.d?.model||'unknown'),latency_ms:Date.now()-providerStartedAt,status:'completed'});if(interactionError)console.warn('[ai-assistant] interaction log failed:',interactionError.message);}return out({answer:finalAnswer,provider:p.name,status:'completed',context_loaded:!!operationalContext},200,o);}errors.push(`${p.name} [${Date.now()-providerStartedAt}ms]: ${msg}`);continue}catch(e){errors.push(`${p.name}: ${e instanceof Error?e.message:String(e)}`)}}}console.error(JSON.stringify({event:'ai_provider_failure',errors}));return out({error:`همه سرویس‌های هوش مصنوعی در دسترس نبودند. ${errors.join(' | ')}`},502,o)}catch(e){return out({error:e instanceof Error?e.message:'AI request failed'},500,o)}});