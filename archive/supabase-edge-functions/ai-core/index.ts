import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowed=new Set(['https://darbandicommercial.ir','https://www.darbandicommercial.ir','https://mobile.darbandicommercial.ir','http://darbandicommercial.ir','http://www.darbandicommercial.ir','https://customs-os-psi.vercel.app','https://customs.mohsen-darbandi.workers.dev','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string)=>({'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://customs.mohsen-darbandi.workers.dev','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const reply=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any)=>String(v??'').trim();
const strip=(s:string)=>s.replace(/^data:[^;]+;base64,/,'');
const clip=(s:string,n:number)=>{const x=String(s||'');return x.length<=n?x:x.slice(0,n)+'\\n[context clipped]';};
const providerPrompt=(base:string,limit:number)=>clip(base,limit);
const valid=(v:any)=>{const s=clean(v);return !!s&&!/^x{2,}$/i.test(s)&&s!=='-'&&s!=='—'};

async function getContext(sb:any,org:string){
 const [ship,clients,cases,decl,customs,docs,ext,checks,payments,requests,vessels]=await Promise.all([
  sb.from('shipments').select('id,case_id,client_id,vessel_id,display_name,bill_of_lading_no,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,release_status,release_invoice_payment_status,finance_status,updated_at').eq('organization_id',org).limit(500),
  sb.from('clients').select('id,name').eq('organization_id',org).limit(500),
  sb.from('cases').select('id,client_id,case_number,display_name,registration_order_no,warehouse_receipt_no,warehouse_receipt_date,cargo_count,cargo_count_unit,cargo_description,net_weight_kg,gross_weight_kg,status').eq('organization_id',org).limit(500),
  sb.from('customs_declarations').select('id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,workflow_stage').eq('organization_id',org).limit(500),
  sb.from('shipment_customs_data').select('shipment_id,registration_order_no,warehouse_receipt_no,warehouse_receipt_date_shamsi,cargo_description,tariff_code,net_weight_kg,gross_weight_kg,bill_of_lading,invoice_amount,invoice_currency').eq('organization_id',org).limit(500),
  sb.from('shipment_documents').select('id,shipment_id,document_name,extraction_status,created_at').eq('organization_id',org).limit(1000),
  sb.from('shipment_document_extractions').select('document_id,shipment_id,field_key,extracted_value,source_text,page_number,confidence,extraction_method,updated_at').eq('organization_id',org).limit(3000),
  sb.from('case_checklist_items').select('case_id,stage_no,item_key,completed').eq('organization_id',org).limit(3000),
  sb.from('finance_payments').select('shipment_id,case_id,amount,currency,amount_irr,payment_type,description,payment_date').eq('organization_id',org).limit(2000),
  sb.from('finance_payment_requests').select('shipment_id,request_no,requested_amount,currency,status,subject').eq('organization_id',org).limit(1000),
  sb.from('vessels').select('id,name,imo_number,flag,last_latitude,last_longitude,last_position_at,last_position_source,last_speed_knots,last_course_deg').eq('organization_id',org).limit(500)
 ]);
 const cm=new Map((clients.data||[]).map((x:any)=>[x.id,x]));
 const km=new Map((cases.data||[]).map((x:any)=>[x.id,x]));
 const vm=new Map((vessels.data||[]).map((x:any)=>[x.id,x]));
 const dm=new Map<string,any>(); for(const d of (decl.data||[])){if(d.shipment_id&&!dm.has(d.shipment_id))dm.set(d.shipment_id,d)}
 const scm=new Map<string,any>(); for(const x of (customs.data||[])){if(x.shipment_id&&!scm.has(x.shipment_id))scm.set(x.shipment_id,x)}
 const db=new Map<string,any[]>(); for(const x of (docs.data||[])){const a=db.get(x.shipment_id)||[];a.push(x);db.set(x.shipment_id,a)}
 const eb=new Map<string,any[]>(); for(const x of (ext.data||[])){const a=eb.get(x.shipment_id)||[];a.push(x);eb.set(x.shipment_id,a)}
 const cb=new Map<string,any[]>(); for(const x of (checks.data||[])){const a=cb.get(x.case_id)||[];a.push(x);cb.set(x.case_id,a)}
 return (ship.data||[]).map((s:any)=>{
  const c=km.get(s.case_id)||{},cl=cm.get(s.client_id||c.client_id)||{},d=dm.get(s.id)||{},cd=scm.get(s.id)||{};
  return {shipment_id:s.id,case_id:s.case_id,case_number:c.case_number||null,client_name:cl.name||null,shipment_name:s.display_name||null,cargo_count:s.cargo_count??c.cargo_count??null,cargo_unit:s.cargo_count_unit??c.cargo_count_unit??null,bill_of_lading:s.bill_of_lading_no||cd.bill_of_lading||null,kottaj_number:d.kottaj_number||null,warehouse_receipt_no:cd.warehouse_receipt_no||c.warehouse_receipt_no||null,warehouse_receipt_date:cd.warehouse_receipt_date_shamsi||c.warehouse_receipt_date||null,registration_order_no:cd.registration_order_no||c.registration_order_no||null,net_weight_kg:s.net_weight_kg??cd.net_weight_kg??c.net_weight_kg??null,gross_weight_kg:s.gross_weight_kg??cd.gross_weight_kg??c.gross_weight_kg??null,cargo_description:cd.cargo_description||c.cargo_description||null,tariff_code:cd.tariff_code||null,status:s.current_status||c.status||null,release_status:s.release_status||null,release_invoice_payment_status:s.release_invoice_payment_status||null,finance_status:s.finance_status||null,workflow_stage:d.workflow_stage??null,customs_path:d.customs_path||null,vessel:vm.get(s.vessel_id)||null,documents:db.get(s.id)||[],extractions:eb.get(s.id)||[],checklist:cb.get(s.case_id)||[],payments:(payments.data||[]).filter((p:any)=>p.shipment_id===s.id),payment_requests:(requests.data||[]).filter((r:any)=>r.shipment_id===s.id)};
 });
}


async function getWebsiteContext(sb:any,org:string,query:string,shipmentId:string){
 const reportQuery=sb.from('file_manager_shipment_reports').select('shipment_id,status,stage,report,actor_name,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(250);
 const fileQuery=sb.from('file_manager_files').select('id,shipment_id,client_id,folder_id,original_name,mime_type,document_type,tags,operation_sections,file_manager_search_text,created_at').eq('organization_id',org).eq('is_archived',false).order('created_at',{ascending:false}).limit(400);
 const customsQuery=sb.from('customs_document_extractions').select('shipment_id,display_name,original_file_name,document_type,operation_section,status,extracted_fields,confidence,completed_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(250);
 const extractionQuery=sb.from('shipment_document_extractions').select('shipment_id,document_id,field_key,field_label,extracted_value,source_text,confidence,page_number,updated_at').eq('organization_id',org).order('updated_at',{ascending:false}).limit(500);
 const reminderQuery=sb.from('operational_reminders').select('shipment_id,case_id,title,description,due_at,priority,status,kind,entity_type,visibility').eq('organization_id',org).is('deleted_at',null).order('due_at',{ascending:true}).limit(300);
 if(shipmentId){reportQuery.eq('shipment_id',shipmentId);fileQuery.eq('shipment_id',shipmentId);customsQuery.eq('shipment_id',shipmentId);extractionQuery.eq('shipment_id',shipmentId);reminderQuery.eq('shipment_id',shipmentId);}
 const [reports,files,folders,customsExtractions,extractions,reminders,orders]=await Promise.all([
  reportQuery,fileQuery,
  sb.from('file_manager_folders').select('id,display_name,parent_id').eq('organization_id',org).limit(500),
  customsQuery,extractionQuery,reminderQuery,
  sb.from('registration_orders').select('case_id,client_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,net_weight_kg,gross_weight_kg,bank_name,bank_branch_code,payment_instrument_code,is_closed,notes').eq('organization_id',org).order('created_at',{ascending:false}).limit(250)
 ]);
 const foldersById=new Map((folders.data||[]).map((x:any)=>[x.id,x.display_name]));
 const terms=clean(query).toLowerCase().split(/\s+/).filter((x:string)=>x.length>=2);
 const relevant=(items:any[],value:(x:any)=>string,max:number)=>{
  const matches=terms.length?items.filter((x:any)=>terms.some((t:string)=>String(value(x)||'').toLowerCase().includes(t))):[];
  return (matches.length?matches:items).slice(0,max);
 };
 const reportsOut=relevant(reports.data||[],(x:any)=>[x.report,x.stage,x.status,x.actor_name].join(' '),24).map((x:any)=>({...x,report:String(x.report||'').slice(0,1400)}));
 const filesOut=relevant(files.data||[],(x:any)=>[x.original_name,x.document_type,(x.tags||[]).join(' '),(x.operation_sections||[]).join(' '),x.file_manager_search_text].join(' '),30).map((x:any)=>({shipment_id:x.shipment_id,client_id:x.client_id,name:x.original_name,folder:foldersById.get(x.folder_id)||null,mime_type:x.mime_type,document_type:x.document_type,tags:x.tags,operation_sections:x.operation_sections,search_text:String(x.file_manager_search_text||'').slice(0,800),created_at:x.created_at}));
 const customsOut=relevant(customsExtractions.data||[],(x:any)=>[x.display_name,x.original_file_name,x.document_type,x.operation_section,JSON.stringify(x.extracted_fields||{})].join(' '),24);
 const extractionsOut=relevant(extractions.data||[],(x:any)=>[x.field_label,x.field_key,x.extracted_value,x.source_text].join(' '),40).map((x:any)=>({...x,source_text:String(x.source_text||'').slice(0,350)}));
 const remindersOut=relevant(reminders.data||[],(x:any)=>[x.title,x.description,x.status,x.kind].join(' '),24);
 const ordersOut=relevant(orders.data||[],(x:any)=>[x.order_number,x.tariff_code,x.status,x.bank_name,x.payment_instrument_code,x.notes].join(' '),24);
 return {reports:reportsOut,files:filesOut,customs_document_extractions:customsOut,shipment_document_extractions:extractionsOut,operational_reminders:remindersOut,registration_orders:ordersOut};
}

function selectRows(rows:any[],q:string,shipmentId:string){
 if(shipmentId){
  const exact=rows.filter(r=>r.shipment_id===shipmentId);
  return exact.length?exact:rows.filter(r=>r.case_id===shipmentId).slice(0,12);
 }
 const n=clean(q).toLowerCase();
 if(!n)return rows.slice(0,12);
 const nums=n.match(/\d+/g)||[];
 const stop=new Set(['برای','محموله','پرونده','اسناد','سند','اطلاعات','وضعیت','چیست','چیه','درباره','لطفا','لطفاً','بگو','به','از','در','را','رو','که','این','آن','من','ما','شما','دارد','دارم','دارند','است','هست','هستند','همه','کدام','کدوم','چند','آخرین','فعلی','سامانه']);
 const tokens=n.split(/\s+/).map(x=>x.trim()).filter(x=>x.length>=3&&!stop.has(x));
 const ranked=rows.map(r=>{
  const h=[r.client_name,r.shipment_name,r.case_number,r.bill_of_lading,r.cargo_description,r.cargo_count,r.cargo_unit,r.warehouse_receipt_no,r.registration_order_no,r.kottaj_number].filter(valid).join(' ').toLowerCase();
  const tokenHits=tokens.filter(t=>h.includes(t)).length;
  const numberHit=nums.length===0||nums.some(x=>h.includes(x));
  const docHit=(r.documents||[]).length>0&&/(سند|اسناد|مدرک|مدارک|بارنامه|قبض|document|file)/i.test(n);
  const extractionHit=(r.extractions||[]).length>0&&/(استخراج|اطلاعات|مقدار|وزن|تعداد|مشخصات|document|extraction)/i.test(n);
  const score=tokenHits*5+(numberHit&&nums.length?5:0)+(docHit?3:0)+(extractionHit?3:0);
  return {r,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.r);
 const fallback=rows.filter(r=>(r.documents||[]).length>0);
 return [...ranked,...fallback].filter((r,i,a)=>a.findIndex(x=>x.shipment_id===r.shipment_id)===i).slice(0,12);
}

function risks(rows:any[]){
 const out:any[]=[];
 for(const r of rows){
  const e=r.extractions||[];
  for(const k of ['packageCount','cargoCount','netWeight','grossWeight','billOfLading','warehouseReceiptNo','regNumber']){
   const vals=[...new Set(e.filter((x:any)=>x.field_key===k&&valid(x.extracted_value)).map((x:any)=>clean(x.extracted_value)))];
   if(vals.length>1)out.push({shipment_id:r.shipment_id,risk_type:'document_mismatch',severity:'high',title:'مغایرت '+k,details:vals.join(' / '),evidence:e.filter((x:any)=>x.field_key===k)});
  }
  const missing:string[]=[];
  if(!valid(r.bill_of_lading))missing.push('بارنامه');
  if(!valid(r.warehouse_receipt_no))missing.push('قبض انبار');
  if(!valid(r.registration_order_no))missing.push('ثبت سفارش');
  if(missing.length)out.push({shipment_id:r.shipment_id,risk_type:'missing_data',severity:'medium',title:'اطلاعات ناقص',details:missing.join('، '),evidence:[]});
  const s4=(r.checklist||[]).filter((x:any)=>Number(x.stage_no)===4&&!x.completed);
  const s5=(r.checklist||[]).filter((x:any)=>Number(x.stage_no)===5&&!x.completed);
  if(s4.length)out.push({shipment_id:r.shipment_id,risk_type:'workflow',severity:'medium',title:'چک‌لیست مرحله ۴ ناقص است',details:s4.map((x:any)=>x.item_key).join('، '),evidence:s4});
  if(!s4.length&&s5.length)out.push({shipment_id:r.shipment_id,risk_type:'workflow',severity:'medium',title:'مرحله ۵ ناقص است',details:s5.map((x:any)=>x.item_key).join('، '),evidence:s5});
 }
 return out;
}

async function gemini(prompt:string,parts:any[],key:string,model:string){
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:'You are Customs OS enterprise AI. Never invent official identifiers. Use only supplied database/document evidence. Explicitly report missing or conflicting evidence. Answer Persian.'}]},contents:[{role:'user',parts:[{text:prompt},...parts]}]})});
 const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};if(!r.ok)throw new Error(d?.error?.message||'Gemini HTTP '+r.status);return String(d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('\n')||'').trim();
}

async function geminiEmbedding(text:string,key:string){
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{
  method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
  body:JSON.stringify({content:{parts:[{text:text.slice(0,30000)}]},output_dimensionality:1536}),
  signal:AbortSignal.timeout(7000)
 });
 const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}
 if(!r.ok)throw new Error(d?.error?.message||'Embedding HTTP '+r.status);
 const v=d?.embedding?.values;
 if(!Array.isArray(v)||v.length!==1536)throw new Error('Invalid embedding');
 return v;
}

Deno.serve(async(req)=>{
 const origin=req.headers.get('Origin')||'';
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405,origin);
 try{
  const auth=req.headers.get('Authorization')||'';const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
  if(!token)return reply({error:'Unauthorized'},401,origin);
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');if(!url||!anon)return reply({error:'Supabase configuration missing'},503,origin);
  const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user}}=await sb.auth.getUser(token);if(!user)return reply({error:'Unauthorized'},401,origin);
  const {data:profile}=await sb.from('profiles').select('role,is_active,organization_id').eq('id',user.id).maybeSingle();if(!profile||profile.is_active===false)return reply({error:'پروفایل کاربر معتبر یا فعال نیست.'},403,origin);
  const b=await req.json().catch(()=>({}));const query=clean(b.query);const mode=clean(b.mode||(b.command_mode?'agent':'chat'));const shipmentId=clean(b.shipment_id);
  if(!query&&!b.document_data&&!b.document_text)return reply({error:'No input'},400,origin);
  const sessionId=clean(b.session_id);
  const memory=sessionId?await sb.from('ai_interactions').select('query,answer,created_at').eq('organization_id',profile.organization_id).eq('session_id',sessionId).order('created_at',{ascending:false}).limit(8).then((x:any)=>x.data||[]).catch(()=>[]):[];
  const [rows,websiteContext]=await Promise.all([profile.organization_id?getContext(sb,profile.organization_id):Promise.resolve([]),profile.organization_id?getWebsiteContext(sb,profile.organization_id,query,shipmentId).catch((e:any)=>{console.error('[ai-core] website context failed:',e instanceof Error?e.message:String(e));return {}; }):Promise.resolve({})]);const selected=selectRows(rows,query,shipmentId);const finding=['agent','command','audit','risk'].includes(mode)?risks(selected):[];
  const normalizedQuery=query
     .replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200f\u0640]/g,' ')
     .replace(/[،؛:!?؟(){}\[\]"']+/g,' ').replace(/\s+/g,' ').trim();
   const stopWords=new Set(['از','به','در','را','با','که','این','آن','برای','چیست','چیه','چطور','چگونه','چه','می','شود','است','هست','و','یا','یک','هم','تا','پس','اگر','من','ما','شما','لطفا','لطفاً','بگو','درباره','اطلاعات','مورد','موارد','طبق','قانون','قوانین','بخشنامه','دستورالعمل','گمرک']);
   const focusTerms=[...new Set(normalizedQuery.split(/\s+/).filter((x:string)=>x.length>=2&&!stopWords.has(x)))].slice(0,10);
   const focusedQuery=focusTerms.join(' ');
   const documentNumbers=[...new Set(query.match(/[0-9۰-۹]{4}[\/／-][0-9۰-۹]{3,}/g)||[])];
   const lexicalQueries=[...new Set([query,focusedQuery,...documentNumbers].filter(Boolean))].slice(0,4);
   const keywordTask=sb.rpc('search_knowledge_keyword',{
     search_text:focusedQuery||normalizedQuery,
     match_count:24
   }).then((result:any)=>{
     if(result.error)console.warn('[ai-core] keyword knowledge search failed:',result.error.message);
     return Array.isArray(result.data)?result.data:[];
   }).catch((error:any)=>{
     console.warn('[ai-core] keyword knowledge search unavailable:',error instanceof Error?error.message:String(error));
     return [];
   });
   const lexicalTask=Promise.all(lexicalQueries.map(async(searchText:string)=>{
     try{
       const result=await sb.rpc('search_knowledge_chunks',{query_text:searchText.slice(0,1000),match_count:16});
       if(result.error){console.warn('[ai-core] legacy lexical search warning:',result.error.message);return [];}
       return Array.isArray(result.data)?result.data:[];
     }catch(error){
       console.warn('[ai-core] legacy lexical search unavailable:',error instanceof Error?error.message:String(error));
       return [];
     }
   }));
   const semanticTask=(async()=>{
     const gk=Deno.env.get('GEMINI_API_KEY');
     if(!query||!profile.organization_id||!gk)return [];
     try{
       const qv=await geminiEmbedding(query,gk);
       const result=await sb.rpc('search_knowledge_semantic',{
         query_embedding:qv,match_count:18,match_threshold:0.12
       });
       if(result.error)throw result.error;
       return Array.isArray(result.data)?result.data:[];
     }catch(error){
       console.warn('[ai-core] semantic knowledge search unavailable; keyword retrieval remains active:',error instanceof Error?error.message:String(error));
       return [];
     }
   })();
   const [keywordKnowledge,legacyLexicalResults,semanticKnowledge]=await Promise.all([
     keywordTask,lexicalTask,semanticTask
   ]);
   const knowledgeMap=new Map<string,any>();
   const addKnowledgeHit=(row:any,kind:string,position:number)=>{
     const key=String(row.id||row.source_id+'|'+row.page_number+'|'+String(row.content||'').slice(0,140));
     const previous=knowledgeMap.get(key)||{...row,_rrf:0,_lexical:false,_semantic:false};
     previous._rrf+=1/(60+position);
     if(kind==='keyword'){
       previous._lexical=true;
       previous._rrf+=Math.max(0,Math.min(10,Number(row.rank)||0))*0.002;
     }
     if(kind==='semantic'){
       previous._semantic=true;
       previous._rrf+=Math.max(0,Math.min(1,Number(row.similarity)||0))*0.04;
     }
     if(documentNumbers.some((n:string)=>String(row.content||'').includes(n))){
       previous._rrf+=0.25;
       previous._exact_document_number=true;
     }
     knowledgeMap.set(key,previous);
   };
   keywordKnowledge.forEach((row:any,i:number)=>addKnowledgeHit(row,'keyword',i+1));
   for(const results of legacyLexicalResults)results.forEach((row:any,i:number)=>addKnowledgeHit(row,'lexical',i+1));
   semanticKnowledge.forEach((row:any,i:number)=>addKnowledgeHit(row,'semantic',i+1));
   let knowledgeHits=[...knowledgeMap.values()]
     .sort((a:any,b:any)=>b._rrf-a._rrf)
     .slice(0,20);
   let pageQualityNote='';
   const exactAnchor=knowledgeHits.find((row:any)=>documentNumbers.some((n:string)=>String(row.content||'').includes(n)));
   const anchor=exactAnchor||knowledgeHits.find((row:any)=>row.source_id&&Number.isInteger(Number(row.page_number)));
   if(anchor?.source_id&&Number.isInteger(Number(anchor.page_number))){
     const center=Number(anchor.page_number);
     const {data:neighbors,error:neighborError}=await sb.from('knowledge_chunks')
       .select('id,source_id,title,source_number,issued_at,content,page_number')
       .eq('source_id',anchor.source_id)
       .eq('organization_id',profile.organization_id)
       .gte('page_number',Math.max(1,center-1))
       .lte('page_number',center+2)
       .order('page_number',{ascending:true})
       .limit(16);
     if(neighborError)console.warn('[ai-core] adjacent knowledge pages unavailable:',neighborError.message);
     else if(Array.isArray(neighbors)){
       for(let i=0;i<neighbors.length;i++)addKnowledgeHit(neighbors[i],'adjacent',i+1);
       knowledgeHits=[...knowledgeMap.values()].sort((a:any,b:any)=>b._rrf-a._rrf).slice(0,20);
     }
     try{
       const {data:quality,error:qualityError}=await sb.rpc('get_knowledge_page_quality',{
         p_source_id:anchor.source_id,
         p_from_page:Math.max(1,center-1),
         p_to_page:center+2
       });
       if(!qualityError&&Array.isArray(quality)){
         const unresolved=quality.filter((p:any)=>p.status!=='complete');
         if(unresolved.length){
           pageQualityNote='هشدار کنترل کیفیت دانشنامه: وضعیت استخراج این صفحات هنوز نهایی نیست: '+
             unresolved.map((p:any)=>'صفحه '+p.page_number+' ('+p.status+')').join('، ')+
             '. این صفحات را قطعی تلقی نکن و کمبود شواهد را صریح اعلام کن.\n';
         }
       }
     }catch(qualityError){
       console.warn('[ai-core] knowledge page-quality warning:',qualityError instanceof Error?qualityError.message:String(qualityError));
     }
   }
   const provenanceIds=[...new Set(knowledgeHits.map((row:any)=>String(row.source_id||'')).filter(Boolean))].slice(0,20);
   const provenanceMap=new Map<string,any>();
   if(provenanceIds.length){
     const {data:provenanceRows,error:provenanceError}=await sb.from('knowledge_sources')
       .select('id,metadata,source_url,status')
       .eq('organization_id',profile.organization_id)
       .in('id',provenanceIds);
     if(provenanceError)console.warn('[ai-core] knowledge provenance lookup unavailable:',provenanceError.message);
     else for(const source of (provenanceRows||[])){
       const meta=source.metadata&&typeof source.metadata==='object'?source.metadata:{};
       provenanceMap.set(String(source.id),{
         source_class:meta.source_class||'unknown',
         source_class_label:meta.source_class_label||'',
         legal_status:meta.legal_status||'not_specified',
         source_channel_label:meta.source_channel_label||'',
         classification:meta.classification||{},
         authority_checked:meta.authority_checked===true,
         status:source.status,
         source_url:source.source_url||''
       });
     }
   }
   knowledgeHits=knowledgeHits.map((row:any)=>({...row,_provenance:provenanceMap.get(String(row.source_id||''))||null}));
   const knowledgeContext=pageQualityNote+knowledgeHits.map((row:any,i:number)=>
     '['+(i+1)+'] '+String(row.title||'سند دانشنامه')+
     ' | شماره سند: '+String(row.source_number||'نامشخص')+
     ' | تاریخ: '+String(row.issued_at||'نامشخص')+
     ' | صفحه PDF: '+String(row.page_number??'نامشخص')+
     ' | مرجع صادرکننده: '+String(row._provenance?.classification?.authority_label||'نامشخص')+
     ' | منبع: '+String(row._provenance?.source_class_label||row._provenance?.source_channel_label||'مرجع ثبت‌شده')+
     ' | وضعیت اعتبار: '+(row._provenance?.legal_status==='secondary_channel_text_not_primary_original'?'متن کانال ثانویه؛ اصل سند صادرکننده تأیید نشده':row._provenance?.legal_status==='secondary_copy_requires_authority_check'?'نسخه ثانویه؛ تطبیق با اصل سند الزامی است':row._provenance?.authority_checked?'مرجع رسمی تطبیق داده شده':'وضعیت اعتبار در منبع مشخص نشده')+
     ' | بازیابی: '+(row._semantic?'معنایی ':'')+(row._lexical?'متنی':'')+
     '\n'+String(row.content||'')
   ).join('\n\n');
   const mutationIntent=mode==='agent'&&/(ثبت|تغییر|اصلاح|حذف|بستن|تأیید|رد|پرداخت|ایجاد|ویرایش|لغو|ارسال|کنسل|update|delete|create|change)/i.test(query);
  let prompt='کاربر: '+clip(query,4000)+'\nحالت: '+mode+'\nداده واقعی محموله: '+clip(JSON.stringify(selected),10000)+'\nیافته‌های اعتبارسنجی: '+clip(JSON.stringify(finding),4000)+'\nحافظه پایدار دانشنامه (بازیابی ترکیبی معنایی و کلیدواژه‌ای، همراه با متن و شماره صفحه): '+clip(knowledgeContext,10000)+'\nحافظه جلسه اخیر: '+clip(JSON.stringify(memory),3000)+'\nاگر از دانشنامه استفاده می‌کنی، عنوان سند، شماره سند و شماره صفحه PDF را کنار هر ادعای مستند ذکر کن. هرگز منبع، بند یا شماره صفحه را جعل نکن. میان متن صریح سند، برداشت خودت و اطلاعات ناموجود تفاوت روشن بگذار. اگر صفحه‌ای هشدار کنترل کیفیت دارد، آن را قطعی فرض نکن. منابع ثانویه مانند کانال‌های خبری گمرکی و تجمیع‌کننده‌ها برای رصد سریع و کشف سند مفیدند، اما به‌تنهایی مرجع رسمی ابلاغ نیستند؛ اگر اصل سند و مرجع صادرکننده تأیید نشده، آن را صریحاً «منبع ثانویه/نیازمند تطبیق با اصل» معرفی کن و از آن حکم قطعی حقوقی یا گمرکی نساز.';
  prompt+='\nداده‌های زنده سایر بخش‌های وب‌سایت، شامل گزارش‌ها، فایل‌منیجر، استخراج اسناد گمرکی، یادآورها و ثبت‌سفارش‌ها: '+clip(JSON.stringify(websiteContext),7000)+'\nاین اطلاعات نیز فقط در محدوده سازمان کاربر است؛ مقادیر ناموجود را حدس نزن.';if(mutationIntent)prompt+='\nاین درخواست تغییر داده است. فقط پیشنهاد اقدام ساختاریافته بده؛ هیچ تغییر مستقیم در داده اصلی انجام نده و برای هر پیشنهاد شواهد و ریسک را مشخص کن.';
  if(mode==='audit'||mode==='risk')prompt+='\nگزارش: وضعیت، موارد تاییدشده، مغایرت‌ها، کمبودها و اقدام بعدی را جدا کن.';
  if(mode==='extract')prompt+='\nفقط داده واقعی سند را استخراج کن؛ موارد ناموجود/ناخوانا xxxx.';
  const parts:any[]=[];const docText=clean(b.document_text);if(docText)parts.push({text:'DOCUMENT:\n'+clip(docText,18000)});
  const data=strip(String(b.document_data||''));const mime=clean(b.document_mime_type).toLowerCase();if(data&&(mime==='application/pdf'||mime.startsWith('image/')))parts.push({inlineData:{mimeType:mime,data}});
  let answer='',provider='',model='',errors:string[]=[];
  const providers:any[]=[
    {name:'gemini',key:Deno.env.get('GEMINI_API_KEY'),run:async(k:string)=>{const m='gemini-3.8-flash';return {answer:await gemini(prompt,parts,k,m),model:m}}},
    {name:'cloudflare',key:Deno.env.get('CLOUDFLARE_API_TOKEN'),run:async(k:string)=>{const account=Deno.env.get('CLOUDFLARE_ACCOUNT_ID');if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID missing');const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/meta/llama-3.1-8b-instruct',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:providerPrompt(prompt,24000)}]})});const d=await r.json();if(!r.ok)throw new Error(d?.errors?.[0]?.message||'Cloudflare HTTP '+r.status);return {answer:String(d?.result?.response||''),model:'@cf/meta/llama-3.1-8b-instruct'}}},
    {name:'groq',key:Deno.env.get('GROQ_API_KEY'),run:async(k:string,groqPrompt?:string)=>{const input=providerPrompt(groqPrompt||prompt,20000);const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-120b',messages:[{role:'user',content:input}],temperature:0,max_tokens:900})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Groq HTTP '+r.status);return {answer:String(d?.choices?.[0]?.message?.content||''),model:'openai/gpt-oss-120b'}}},
    {name:'openrouter',key:Deno.env.get('OPENROUTER_API_KEY'),run:async(k:string)=>{const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-4o-mini',messages:[{role:'user',content:providerPrompt(prompt,24000)}]})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'OpenRouter HTTP '+r.status);return {answer:String(d?.choices?.[0]?.message?.content||''),model:'openai/gpt-4o-mini'}}},
    {name:'openai',key:Deno.env.get('OPENAI_API_KEY'),run:async(k:string)=>{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',input:providerPrompt(prompt,30000)})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'OpenAI HTTP '+r.status);return {answer:String(d?.output_text||''),model:'gpt-4.1-mini'}}}
  ];
  for(const p of providers){if(!p.key)continue;try{const z=await (p.name==='Groq'?p.run(p.key,providerPrompt(prompt,20000)):p.run(p.key));if(String(z.answer||'').trim()){answer=String(z.answer).trim();provider=p.name;model=z.model;break}errors.push(p.name+': empty output')}catch(e){errors.push(p.name+': '+(e instanceof Error?e.message:String(e)))}}
  if(!answer)return reply({error:'همه سرویس‌های AI ناموفق بودند: '+errors.join(' | ')},502,origin);
  const interaction=await sb.from('ai_interactions').insert({organization_id:profile.organization_id,user_id:user.id,shipment_id:shipmentId||selected[0]?.shipment_id||null,case_id:selected[0]?.case_id||null,session_id:sessionId||null,mode,query,answer,provider,model,latency_ms:null,status:'completed'}).select('id').single();
  const interactionId=interaction.data?.id||null;
  let proposals:any[]=[];
  if(mutationIntent&&interactionId){
    const {data:proposal,error:proposalError}=await sb.from('ai_action_proposals').insert({
      organization_id:profile.organization_id,interaction_id:interactionId,shipment_id:shipmentId||selected[0]?.shipment_id||null,case_id:selected[0]?.case_id||null,
      action_type:'review_required',payload:{requested_command:query,matched_shipment_ids:selected.map((r:any)=>r.shipment_id)},evidence_ids:[],risk_level:'high',status:'proposed',created_by:user.id
    }).select('id,action_type,payload,risk_level,status').single();
    if(!proposalError&&proposal)proposals=[proposal];
  }
  if(finding.length)await sb.from('ai_risk_findings').insert(finding.map((f:any)=>({organization_id:profile.organization_id,interaction_id:interactionId,shipment_id:f.shipment_id,risk_type:f.risk_type,severity:f.severity,title:f.title,details:f.details,evidence:f.evidence||[]}))).catch(()=>{});
  return reply({answer,provider,model,status:'completed',interaction_id:interactionId,matched_shipments:selected.map((r:any)=>r.shipment_id),findings:finding,proposals,knowledge_hits:knowledgeHits.length,memory_turns:memory.length},200,origin);
 }catch(e){console.error(e);return reply({error:e instanceof Error?e.message:'AI Core failed'},500,origin)}
});