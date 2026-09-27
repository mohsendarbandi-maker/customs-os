import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowed=new Set(['https://customs-os-psi.vercel.app','https://customs.mohsen-darbandi.workers.dev','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string)=>({'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://customs.mohsen-darbandi.workers.dev','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const reply=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any)=>String(v??'').trim();
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

function selectRows(rows:any[],q:string,shipmentId:string){
 if(shipmentId)return rows.filter(r=>r.shipment_id===shipmentId);
 const n=q.toLowerCase(); const nums=n.match(/\d+/g)||[];
 return rows.filter(r=>{
  const h=[r.client_name,r.shipment_name,r.case_number,r.bill_of_lading,r.cargo_description,r.cargo_count,r.cargo_unit].filter(valid).join(' ').toLowerCase();
  return (nums.length===0||nums.some(x=>h.includes(x)))&&(h.includes(n)||String(r.client_name||'').toLowerCase().split(' ').some((w:string)=>w.length>2&&n.includes(w)));
 }).slice(0,12);
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
  body:JSON.stringify({content:{parts:[{text:text.slice(0,30000)}]},output_dimensionality:1536})
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
  const rows=profile.organization_id?await getContext(sb,profile.organization_id):[];const selected=selectRows(rows,query,shipmentId);const finding=['agent','command','audit','risk'].includes(mode)?risks(selected):[];
  const knowledge=await sb.rpc('ai_find_knowledge',{search_text:query,org_id:profile.organization_id,max_rows:6}).then((x:any)=>x.data||[]).catch(()=>[]);
  let semanticKnowledge:any[]=[];
  if(query&&profile.organization_id){
    const gk=Deno.env.get('GEMINI_API_KEY');
    if(gk){try{const qv=await geminiEmbedding(query,gk);semanticKnowledge=await sb.rpc('search_knowledge_semantic',{query_embedding:qv,match_count:10,match_threshold:0.18}).then((x:any)=>x.data||[]).catch(()=>[]);}catch{}}
  }
  const mutationIntent=mode==='agent'&&/(ثبت|تغییر|اصلاح|حذف|بستن|تأیید|رد|پرداخت|ایجاد|ویرایش|لغو|ارسال|کنسل|update|delete|create|change)/i.test(query);
  let prompt='کاربر: '+query+'\nحالت: '+mode+'\nداده واقعی محموله: '+JSON.stringify(selected).slice(0,90000)+'\nیافته‌های اعتبارسنجی: '+JSON.stringify(finding).slice(0,30000)+'\nدانش داخلی مرتبط: '+JSON.stringify(knowledge).slice(0,20000);
  if(mutationIntent)prompt+='\nاین درخواست تغییر داده است. فقط پیشنهاد اقدام ساختاریافته بده؛ هیچ تغییر مستقیم در داده اصلی انجام نده و برای هر پیشنهاد شواهد و ریسک را مشخص کن.';
  if(mode==='audit'||mode==='risk')prompt+='\nگزارش: وضعیت، موارد تاییدشده، مغایرت‌ها، کمبودها و اقدام بعدی را جدا کن.';
  if(mode==='extract')prompt+='\nفقط داده واقعی سند را استخراج کن؛ موارد ناموجود/ناخوانا xxxx.';
  const parts:any[]=[];const docText=clean(b.document_text);if(docText)parts.push({text:'DOCUMENT:\n'+docText.slice(0,120000)});
  const data=strip(String(b.document_data||''));const mime=clean(b.document_mime_type).toLowerCase();if(data&&(mime==='application/pdf'||mime.startsWith('image/')))parts.push({inline_data:{mime_type:mime,data}});
  let answer='',provider='',model='',errors:string[]=[];
  const g=Deno.env.get('GEMINI_API_KEY');if(g){try{model=mode==='extract'?'gemini-3.5-flash-lite':'gemini-3.8-flash';answer=await gemini(prompt,parts,g,model);provider='gemini'}catch(e){errors.push('Gemini: '+(e instanceof Error?e.message:String(e)))}}
  if(!answer){const groq=Deno.env.get('GROQ_API_KEY');if(groq){try{const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+groq,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-120b',messages:[{role:'user',content:prompt}],temperature:0})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Groq error');answer=String(d?.choices?.[0]?.message?.content||'');provider='groq';model='openai/gpt-oss-120b'}catch(e){errors.push('Groq: '+(e instanceof Error?e.message:String(e)))}}}
  if(!answer){const key=Deno.env.get('OPENAI_API_KEY');if(key){try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',input:prompt})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'OpenAI error');answer=String(d?.output_text||'');provider='openai';model='gpt-4.1-mini'}catch(e){errors.push('OpenAI: '+(e instanceof Error?e.message:String(e)))}}}
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
  return reply({answer,provider,model,status:'completed',interaction_id:interactionId,matched_shipments:selected.map((r:any)=>r.shipment_id),findings:finding,proposals,knowledge_hits:knowledge.length+semanticKnowledge.length,memory_turns:memory.length},200,origin);
 }catch(e){console.error(e);return reply({error:e instanceof Error?e.message:'AI Core failed'},500,origin)}
});