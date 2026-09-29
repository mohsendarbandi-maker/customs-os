import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Risk='safe'|'requires_confirmation'|'destructive';
type Plan={action_code:string;module:string;target:Record<string,unknown>;params:Record<string,unknown>;risk?:Risk;confidence?:number;clarification?:string|null;reason?:string};
const ORIGINS=new Set(['https://darbandicommercial.ir','https://www.darbandicommercial.ir','http://darbandicommercial.ir','http://www.darbandicommercial.ir','https://customs-os-psi.vercel.app','http://localhost:5173','http://127.0.0.1:5173']);
const ACTIONS:Record<string,{module:string;label:string;risk:Risk;description:string}>={
 'cases.read':{module:'cases',label:'مشاهده پرونده',risk:'safe',description:'خواندن پرونده و اطلاعات محموله و اظهار مرتبط'},
 'cases.update':{module:'cases',label:'ویرایش پرونده',risk:'requires_confirmation',description:'ویرایش داده های عملیاتی پرونده'},
 'cases.status_change':{module:'cases',label:'تغییر وضعیت پرونده',risk:'requires_confirmation',description:'تغییر مرحله فقط از advance_case_stage'},
 'cases.delete':{module:'cases',label:'حذف پرونده',risk:'destructive',description:'حذف ایمن پرونده با delete_case_safely'},
 'maritime.read':{module:'maritime',label:'مشاهده کشتیرانی',risk:'safe',description:'خواندن کشتیرانی، کشتی و مسئولان تماس'},
 'maritime.shipment_update':{module:'maritime',label:'ویرایش محموله دریایی',risk:'requires_confirmation',description:'ویرایش B/L، کشتیرانی، کشتی، سفر، بنادر و وزن با RPC موجود'},
 'maritime.shipping_line.create':{module:'maritime',label:'ایجاد کشتیرانی',risk:'requires_confirmation',description:'ایجاد shipping line'},
 'maritime.shipping_line.update':{module:'maritime',label:'ویرایش کشتیرانی',risk:'requires_confirmation',description:'ویرایش shipping line'},
 'maritime.shipping_line.delete':{module:'maritime',label:'حذف کشتیرانی',risk:'destructive',description:'حذف shipping line'},
 'maritime.vessel.create':{module:'maritime',label:'ایجاد کشتی',risk:'requires_confirmation',description:'ایجاد vessel'},
 'maritime.vessel.update':{module:'maritime',label:'ویرایش کشتی',risk:'requires_confirmation',description:'ویرایش vessel'},
 'maritime.vessel.delete':{module:'maritime',label:'حذف کشتی',risk:'destructive',description:'حذف vessel'},
 'maritime.contact.create':{module:'maritime',label:'ایجاد مسئول کشتیرانی',risk:'requires_confirmation',description:'ایجاد contact'},
 'maritime.contact.update':{module:'maritime',label:'ویرایش مسئول کشتیرانی',risk:'requires_confirmation',description:'ویرایش contact'},
 'maritime.contact.delete':{module:'maritime',label:'حذف مسئول کشتیرانی',risk:'destructive',description:'حذف contact'},
 'documents.read':{module:'documents',label:'مشاهده اسناد',risk:'safe',description:'خواندن اسناد محموله و اسناد گمرکی'},
 'documents.upload':{module:'documents',label:'آپلود سند',risk:'requires_confirmation',description:'آپلود سند به Storage و ثبت shipment_documents'},
 'documents.update':{module:'documents',label:'ویرایش سند',risk:'requires_confirmation',description:'ویرایش متادیتای سند'},
 'documents.delete':{module:'documents',label:'حذف سند',risk:'destructive',description:'حذف سند و فایل Storage'},
 'permits.read':{module:'permits',label:'مشاهده مجوز',risk:'safe',description:'خواندن مجوزها'},
 'permits.create':{module:'permits',label:'ایجاد مجوز',risk:'requires_confirmation',description:'ایجاد permit'},
 'permits.update':{module:'permits',label:'ویرایش مجوز',risk:'requires_confirmation',description:'ویرایش permit'},
 'permits.delete':{module:'permits',label:'حذف مجوز',risk:'destructive',description:'حذف permit'},
 'permit_rules.read':{module:'permits',label:'مشاهده قواعد مجوز',risk:'safe',description:'خواندن permit rules'},
 'permit_rules.create':{module:'permits',label:'ایجاد قاعده مجوز',risk:'requires_confirmation',description:'ایجاد permit rule'},
 'permit_rules.update':{module:'permits',label:'ویرایش قاعده مجوز',risk:'requires_confirmation',description:'ویرایش permit rule'},
 'permit_rules.delete':{module:'permits',label:'حذف قاعده مجوز',risk:'destructive',description:'حذف permit rule'},
 'declarations.read':{module:'declaration',label:'مشاهده اظهار',risk:'safe',description:'خواندن اظهارنامه'},
 'declarations.register':{module:'declaration',label:'ثبت اظهار',risk:'requires_confirmation',description:'ثبت اظهار با register_shipment_declaration'},
 'declarations.update':{module:'declaration',label:'ویرایش اظهار',risk:'requires_confirmation',description:'ویرایش کوتاژ، تاریخ، مسیر، مبلغ و مرجع پرداخت'},
 'checklist.update':{module:'workflow',label:'تغییر چک‌لیست',risk:'requires_confirmation',description:'تغییر آیتم چک‌لیست'},
 'finance.read':{module:'finance',label:'مشاهده مالی',risk:'safe',description:'خواندن هزینه، پرداخت، درخواست وجه، فاکتور و تراکنش'},
 'finance.cost.create':{module:'finance',label:'ثبت هزینه',risk:'requires_confirmation',description:'ثبت finance_cost_items'},
 'finance.cost.update':{module:'finance',label:'ویرایش هزینه',risk:'requires_confirmation',description:'ویرایش finance_cost_items'},
 'finance.cost.delete':{module:'finance',label:'حذف هزینه',risk:'destructive',description:'حذف finance_cost_items'},
 'finance.payment.create':{module:'finance',label:'ثبت پرداخت/تنخواه',risk:'requires_confirmation',description:'ثبت finance_payments'},
 'finance.payment.update':{module:'finance',label:'ویرایش پرداخت/تنخواه',risk:'requires_confirmation',description:'ویرایش finance_payments'},
 'finance.payment.delete':{module:'finance',label:'حذف پرداخت/تنخواه',risk:'destructive',description:'حذف finance_payments'},
 'finance.payment_request.create':{module:'finance',label:'ایجاد درخواست وجه',risk:'requires_confirmation',description:'ایجاد finance_payment_requests'},
 'finance.payment_request.update':{module:'finance',label:'ویرایش درخواست وجه',risk:'requires_confirmation',description:'ویرایش finance_payment_requests'},
 'finance.payment_request.delete':{module:'finance',label:'حذف درخواست وجه',risk:'destructive',description:'حذف finance_payment_requests'},
 'finance.invoice.create':{module:'finance',label:'ایجاد فاکتور',risk:'requires_confirmation',description:'ایجاد finance_invoices و خطوط آن از هزینه های محموله'},
 'finance.invoice.issue':{module:'finance',label:'صدور فاکتور',risk:'requires_confirmation',description:'صدور فاکتور draft'},
 'finance.invoice.delete':{module:'finance',label:'حذف فاکتور',risk:'destructive',description:'حذف finance_invoices'},
 'accounting_vouchers.read':{module:'accounting_vouchers',label:'مشاهده سند حسابداری',risk:'safe',description:'خواندن سند حسابداری و ردیف ها'},
 'accounting_vouchers.create':{module:'accounting_vouchers',label:'ایجاد سند حسابداری',risk:'requires_confirmation',description:'ایجاد سند با RPC موجود'},
 'accounting_vouchers.update':{module:'accounting_vouchers',label:'ویرایش سند حسابداری',risk:'requires_confirmation',description:'ویرایش سند با RPC موجود'},
 'accounting_vouchers.void_line':{module:'accounting_vouchers',label:'Void ردیف سند',risk:'destructive',description:'باطل کردن ردیف با RPC موجود و دلیل اجباری'},
 'exit.read':{module:'exit',label:'مشاهده خروج',risk:'safe',description:'خواندن عملیات خروج'},
 'exit.update':{module:'exit',label:'ثبت/ویرایش خروج',risk:'requires_confirmation',description:'ثبت خروج با upsert_case_exit_operation'},
 'control.report':{module:'control',label:'گزارش مرکز کنترل',risk:'safe',description:'خواندن get_control_center_shipments'},
 'control.reminder.create':{module:'control',label:'ایجاد یادآور',risk:'requires_confirmation',description:'ایجاد operational reminder'},
 'control.reminder.update':{module:'control',label:'ویرایش یادآور',risk:'requires_confirmation',description:'ویرایش operational reminder'},
 'control.reminder.delete':{module:'control',label:'حذف یادآور',risk:'destructive',description:'حذف operational reminder'},
 'settings.org.update':{module:'settings',label:'ویرایش تنظیمات سازمان',risk:'requires_confirmation',description:'ویرایش organization_settings'},
 'settings.cost_category.read':{module:'settings',label:'مشاهده دسته‌های هزینه',risk:'safe',description:'خواندن finance_cost_categories'},
 'settings.cost_category.create':{module:'settings',label:'ایجاد دسته هزینه',risk:'requires_confirmation',description:'ایجاد finance_cost_categories'},
 'settings.cost_category.update':{module:'settings',label:'ویرایش دسته هزینه',risk:'requires_confirmation',description:'ویرایش finance_cost_categories'},
 'settings.cost_category.delete':{module:'settings',label:'حذف دسته هزینه',risk:'destructive',description:'حذف finance_cost_categories'},
 'settings.user.read':{module:'settings',label:'مشاهده کاربران و نقش‌ها',risk:'safe',description:'خواندن پروفایل‌های سازمان'},
 'settings.user.create':{module:'settings',label:'ایجاد پروفایل کاربر',risk:'requires_confirmation',description:'ایجاد پروفایل برای کاربر Auth موجود'},
 'settings.user.update':{module:'settings',label:'ویرایش کاربر/نقش',risk:'requires_confirmation',description:'ویرایش profile با RPC امن Owner'},
 'settings.user.deactivate':{module:'settings',label:'غیرفعال‌سازی کاربر',risk:'destructive',description:'غیرفعال‌سازی profile با RPC امن Owner'},
 'settings.ai_gateway.read':{module:'settings',label:'مشاهده AI Gateway',risk:'safe',description:'خواندن ai_gateway_settings'},
 'settings.ai_gateway.update':{module:'settings',label:'ویرایش AI Gateway',risk:'requires_confirmation',description:'ویرایش ai_gateway_settings'},
 'settings.requirement_rule.read':{module:'settings',label:'مشاهده Rule مدارک',risk:'safe',description:'خواندن document_requirement_rules'},
 'settings.requirement_rule.create':{module:'settings',label:'ایجاد Rule مدارک',risk:'requires_confirmation',description:'ایجاد document_requirement_rules'},
 'settings.requirement_rule.update':{module:'settings',label:'ویرایش Rule مدارک',risk:'requires_confirmation',description:'ویرایش document_requirement_rules'},
 'settings.requirement_rule.delete':{module:'settings',label:'حذف Rule مدارک',risk:'destructive',description:'حذف document_requirement_rules'},
 'settings.print_template.read':{module:'settings',label:'مشاهده قالب چاپ',risk:'safe',description:'خواندن print_templates'},
 'settings.print_template.create':{module:'settings',label:'ایجاد قالب چاپ',risk:'requires_confirmation',description:'ایجاد print_templates'},
 'settings.print_template.update':{module:'settings',label:'ویرایش قالب چاپ',risk:'requires_confirmation',description:'ویرایش print_templates'},
 'settings.print_template.delete':{module:'settings',label:'حذف قالب چاپ',risk:'destructive',description:'حذف print_templates'},
 'settings.audit.read':{module:'settings',label:'مشاهده Audit Log',risk:'safe',description:'خواندن Audit Log غیرقابل تغییر'},
 'assistant.answer':{module:'assistant',label:'پاسخ هوشمند',risk:'safe',description:'پاسخ به پرسش کاربر بر اساس داده واقعی Customs OS بدون تغییر داده'}
};
const headers=(o:string)=>({'Access-Control-Allow-Origin':ORIGINS.has(o)?o:'https://darbandicommercial.ir','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'});
const out=(v:unknown,code=200,o='')=>new Response(JSON.stringify(v),{status:code,headers:headers(o)});
const str=(v:any)=>String(v??'').trim();
const isUuid=(v:any)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(v));
const pick=(r:any,ks:string[])=>r?Object.fromEntries(ks.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])):null;
const cleanText=(v:any,n=8000)=>str(v).slice(0,n);
function redact(v:string){let s=v;s=s.replace(/(authorization|bearer|api[_ -]?key|token|password|secret|کلید|رمز)\s*[:=]?\s*\S+/gi,'$1:[REDACTED]');s=s.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,'[REDACTED]');s=s.replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g,'[REDACTED]');return cleanText(s);}
function forbidden(v:any):boolean{if(v==null)return false;if(Array.isArray(v))return v.some(forbidden);if(typeof v==='object')return Object.entries(v).some(([k,x])=>/raw.?sql|execute.?sql|service.?role|secret_key|admin.?key|access_token|refresh_token/i.test(k)||forbidden(x));return typeof v==='string'&&/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b\s+.+\b(FROM|TABLE|INTO)\b/i.test(v);}
function riskFor(p:Plan):Risk{
 const d=ACTIONS[p.action_code];if(!d)return'destructive';
 if(p.action_code==='cases.status_change'&&str(p.params?.target_status)==='archived')return'destructive';if(p.action_code==='exit.update'&&str(p.params?.exit_status)==='exited')return'destructive';
 if(p.action_code==='settings.user.update'&&(p.params?.role!==undefined||p.params?.is_active!==undefined||p.params?.client_id!==undefined))return'destructive';
 if(p.action_code==='settings.user.deactivate')return'destructive';
 return d.risk;
}
const effectiveRisk=(p:Plan)=>riskFor(p);
const catalog=()=>Object.entries(ACTIONS).map(([action_code,d])=>({action_code,module:d.module,label:d.label,description:d.description,risk:d.risk}));
const transition=async(sb:any,id:string,patch:any)=>{
 const r=await sb.rpc('ai_operator_transition_command',{
  p_command_id:id,p_status:patch.status,
  p_confirmation_at:patch.confirmation_at??null,
  p_final_confirmation_at:patch.final_confirmation_at??null,
  p_result:patch.result??null,
  p_error_message:patch.error_message??null,
  p_before_data:patch.before_data??null,
  p_after_data:patch.after_data??null,
  p_executed_by:patch.executed_by??null,
  p_executed_at:patch.executed_at??null
 });
 if(r.error)throw r.error;
 return r.data;
};

async function providerCall(provider:string,key:string,prompt:string){
 if(provider==='gemini'){const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||'Gemini HTTP '+r.status);return str(d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('\n'));}
 if(provider==='cloudflare'){const account=Deno.env.get('CLOUDFLARE_ACCOUNT_ID');if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID missing');const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/meta/llama-3.1-8b-instruct',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'Return JSON only.'},{role:'user',content:prompt}]})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.errors?.[0]?.message||'Cloudflare HTTP '+r.status);return str(d?.result?.response);}
 if(provider==='groq'||provider==='openrouter'){const base=provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions';const model=provider==='groq'?'openai/gpt-oss-120b':'openrouter/free';const h:any={Authorization:'Bearer '+key,'Content-Type':'application/json'};if(provider==='openrouter'){h['HTTP-Referer']='https://darbandicommercial.ir';h['X-Title']='Customs OS AI Operator';}const r=await fetch(base,{method:'POST',headers:h,body:JSON.stringify({model,messages:[{role:'system',content:'Return exactly one JSON object.'},{role:'user',content:prompt}],temperature:0,max_tokens:1400,response_format:{type:'json_object'}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||provider+' HTTP '+r.status);return str(d?.choices?.[0]?.message?.content);}
 if(provider==='openai'){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',input:prompt,text:{format:{type:'json_object'}}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||'OpenAI HTTP '+r.status);return str(d?.output_text);}
 throw new Error('provider not supported');
}
function parseJson(raw:string){const v=raw.replace(/^\s*\`\`\`(?:json)?/i,'').replace(/\`\`\`\s*$/,'').trim();const a=v.indexOf('{'),b=v.lastIndexOf('}');if(a<0||b<a)throw new Error('Action Plan معتبر JSON نیست.');return JSON.parse(v.slice(a,b+1));}
const isCapabilitiesQuery=(q:string)=>{const s=str(q).replace(/[؟?!.,،؛:]+$/g,'').replace(/\s+/g,' ').trim();return /^(?:سلام|درود|چه کارهایی از دستت برمیاد|چه کارهایی از دست شما برمیاد|چه کارهایی میتونی انجام بدی|چه کارهایی می‌توانی انجام بدهی|چه امکاناتی داری|چه قابلیت هایی داری|چه قابلیت‌هایی داری|چه امکاناتی می‌توانی ارائه کنی|از دستت چی برمیاد|چه چیزهایی میتونی انجام بدی|what can you do|capabilities|help)$/iu.test(s)};
const capabilitiesText=()=>"AI Operator در محدوده دسترسی همین کاربر می‌تواند:\n\nمشاهده و گزارش‌گیری پرونده‌ها، محموله‌ها و وضعیت عملیات\nمشاهده و مدیریت کشتیرانی، کشتی‌ها و اطلاعات سفر\nمشاهده، ثبت و مدیریت اسناد\nمشاهده و مدیریت مجوزها و قواعد مجوز\nمشاهده و مدیریت اظهار و اطلاعات اظهارنامه\nمدیریت چک‌لیست workflow\nمشاهده و مدیریت امور مالی، هزینه‌ها، تنخواه، پرداخت‌ها، درخواست وجه و فاکتورها\nمشاهده و مدیریت اسناد حسابداری\nمشاهده و ثبت عملیات خروج\nگزارش مرکز کنترل و یادآورها\nتنظیمات سازمان و قابلیت‌های مجاز Owner\n\nدر عملیات نوشتاری، قبل از اجرا تأیید لازم گرفته می‌شود و عملیات مخرب تأیید دو مرحله‌ای دارند.";
const normalizeText=(v:any)=>str(v).toLowerCase().replace(/[\\u200c\\u200f\\u0640]/g,' ').replace(/[_-]+/g,' ').replace(/[^\\p{L}\\p{N}]+/gu,' ').replace(/\\s+/g,' ').trim();
async function loadOperatorContext(sb:any,org:string,q:string){
 const [ships,clients,cases,decls,customs,vessels,docs,payments,requests]=await Promise.all([
  sb.from('shipments').select('id,case_id,client_id,vessel_id,display_name,bill_of_lading_no,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,release_status,release_invoice_payment_status,finance_status,updated_at').eq('organization_id',org).order('updated_at',{ascending:false}).limit(400),
  sb.from('clients').select('id,name').eq('organization_id',org).order('name').limit(400),
  sb.from('cases').select('id,client_id,case_number,display_name,registration_order_no,warehouse_receipt_no,warehouse_receipt_date,cargo_count,cargo_count_unit,cargo_description,net_weight_kg,gross_weight_kg,status,release_status').eq('organization_id',org).order('created_at',{ascending:false}).limit(400),
  sb.from('customs_declarations').select('id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,payment_reference,workflow_stage').eq('organization_id',org).order('declaration_date',{ascending:false}).limit(400),
  sb.from('shipment_customs_data').select('shipment_id,registration_order_no,warehouse_receipt_no,warehouse_receipt_date_shamsi,cargo_description,tariff_code,net_weight_kg,gross_weight_kg,bill_of_lading,invoice_amount,invoice_currency').eq('organization_id',org).limit(500),
  sb.from('vessels').select('id,name,imo_number,flag_code,shipping_line_id,last_latitude,last_longitude,last_position_at,last_position_source,last_speed_knots,last_course_deg').eq('organization_id',org).order('name').limit(400),
  sb.from('shipment_documents').select('shipment_id,document_name,original_file_name,extraction_status,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(700),
  sb.from('finance_payments').select('shipment_id,case_id,amount,currency,amount_irr,payment_type,description,payment_date').eq('organization_id',org).order('payment_date',{ascending:false}).limit(700),
  sb.from('finance_payment_requests').select('shipment_id,request_no,requested_amount,currency,status,subject').eq('organization_id',org).order('request_date',{ascending:false}).limit(500)
 ]);
 const cm=new Map((clients.data||[]).map((x:any)=>[x.id,x.name]));
 const km=new Map((cases.data||[]).map((x:any)=>[x.id,x]));
 const dm=new Map<string,any>();for(const x of (decls.data||[])){if(x.shipment_id&&!dm.has(x.shipment_id))dm.set(x.shipment_id,x);}
 const scm=new Map<string,any>();for(const x of (customs.data||[])){if(x.shipment_id&&!scm.has(x.shipment_id))scm.set(x.shipment_id,x);}
 const vm=new Map((vessels.data||[]).map((x:any)=>[x.id,x]));
 const db=new Map<string,any[]>();for(const x of (docs.data||[])){const a=db.get(x.shipment_id)||[];a.push(x);db.set(x.shipment_id,a);}
 const pb=new Map<string,any[]>();for(const x of (payments.data||[])){const a=pb.get(x.shipment_id)||[];a.push(x);pb.set(x.shipment_id,a);}
 const rb=new Map<string,any[]>();for(const x of (requests.data||[])){const a=rb.get(x.shipment_id)||[];a.push(x);rb.set(x.shipment_id,a);}
 const rows=(ships.data||[]).map((s:any)=>{
  const c=km.get(s.case_id)||{},cd=scm.get(s.id)||{},d=dm.get(s.id)||{},v=vm.get(s.vessel_id)||null;
  return {shipment_id:s.id,case_id:s.case_id,client_id:s.client_id||c.client_id||null,client_name:cm.get(s.client_id||c.client_id)||null,shipment_name:s.display_name||null,case_number:c.case_number||null,cargo_count:s.cargo_count??c.cargo_count??null,cargo_unit:s.cargo_count_unit??c.cargo_count_unit??null,cargo_description:cd.cargo_description||c.cargo_description||null,bill_of_lading:s.bill_of_lading_no||cd.bill_of_lading||null,kottaj_number:d.kottaj_number||null,warehouse_receipt_no:cd.warehouse_receipt_no||c.warehouse_receipt_no||null,warehouse_receipt_date:cd.warehouse_receipt_date_shamsi||c.warehouse_receipt_date||null,registration_order_no:cd.registration_order_no||c.registration_order_no||null,net_weight_kg:s.net_weight_kg??cd.net_weight_kg??c.net_weight_kg??null,gross_weight_kg:s.gross_weight_kg??cd.gross_weight_kg??c.gross_weight_kg??null,status:s.current_status||c.status||null,release_status:s.release_status||c.release_status||null,release_invoice_payment_status:s.release_invoice_payment_status||null,finance_status:s.finance_status||null,workflow_stage:d.workflow_stage??null,customs_path:d.customs_path||null,vessel:v?{id:v.id,name:v.name,imo_number:v.imo_number,flag_code:v.flag_code}:null,documents:db.get(s.id)||[],payments:pb.get(s.id)||[],payment_requests:rb.get(s.id)||[],updated_at:s.updated_at||null};
 });
 const query=normalizeText(q);
 const nums=query.match(/\\d+/g)||[];
 const stop=new Set(['برای','محموله','پرونده','اطلاعات','وضعیت','چیست','چیه','درباره','لطفا','لطفاً','بگو','به','از','در','را','رو','که','این','آن','من','ما','شما','دارد','دارم','دارند','است','هست','هستند','همه','کدام','کدوم','چند','آخرین','فعلی','سامانه','نشون','نشان','کن','کنه','کنم','میخواهم','می‌خواهم','لطفا']);
 const tokens=query.split(/\\s+/).filter((x:string)=>x.length>=2&&!stop.has(x));
 const scored=rows.map((r:any)=>{
   const hay=normalizeText([r.client_name,r.shipment_name,r.case_number,r.cargo_description,r.bill_of_lading,r.kottaj_number,r.warehouse_receipt_no,r.registration_order_no,r.vessel?.name,r.cargo_count,r.cargo_unit].filter((x:any)=>x!=null).join(' '));
   const hits=tokens.filter((t:string)=>hay.includes(t)).length;
   const numHit=nums.length?nums.some((n:string)=>hay.includes(n)):false;
   return {r,score:hits*6+(numHit?8:0)};
 }).sort((a:any,b:any)=>b.score-a.score);
 const matched=scored.filter((x:any)=>x.score>0).slice(0,20).map((x:any)=>x.r);
 const recent=rows.slice(0,15).filter((r:any)=>!matched.some((m:any)=>m.shipment_id===r.shipment_id));
 return JSON.stringify({organization_visible_shipments:rows.length,matched, recent, matching_note:'matched records are ranked by exact identifiers, numbers, names, cargo, B/L, client and vessel text. Use only these records as database evidence.'}).slice(0,65000);
}

async function buildPlan(sb:any,org:string,query:string,role:string,page:string,g:any,attachmentMeta:any=null){
 const providers=Array.from(new Set([str(g.preferred_provider),...(Array.isArray(g.fallback_providers)?g.fallback_providers:[])]).values()).filter(Boolean);
 const active=g.online_enabled===false?providers.filter((x:string)=>x==='cloudflare'):providers;
 const keyList=(p:string)=>{
  if(p==='gemini')return Array.from({length:11},(_,i)=>Deno.env.get(i===0?'GEMINI_API_KEY':'GEMINI_API_KEY_'+i)).filter(Boolean) as string[];
  if(p==='groq')return Array.from({length:6},(_,i)=>Deno.env.get(i===0?'GROQ_API_KEY':'GROQ_API_KEY_'+i)).filter(Boolean) as string[];
  if(p==='cloudflare')return [Deno.env.get('CLOUDFLARE_AI_TOKEN')].filter(Boolean) as string[];
  if(p==='openrouter')return [Deno.env.get('OPENROUTER_API_KEY')].filter(Boolean) as string[];
  if(p==='openai')return [Deno.env.get('OPENAI_API_KEY')].filter(Boolean) as string[];
  return [];
 };
 const safeQuery=g.redaction_enabled===false?cleanText(query):redact(query);const safePage=redact(cleanText(page,1600));const safeAttachment=attachmentMeta&&typeof attachmentMeta==='object'?pick(attachmentMeta,['file_name','mime_type','file_size_bytes']):null;const liveContext=await loadOperatorContext(sb,org,query).catch(()=>'{"matched":[],"recent":[]}');const prompt='You are the intelligent operational brain of Customs OS. Understand the user\'s natural-language intent before choosing an action. User role: '+role+'\\nCurrent page: '+safePage+'\\nAttachment metadata: '+cleanText(JSON.stringify(safeAttachment||{}),800)+'\\nLive database evidence (already filtered by the user\'s RLS permissions): '+cleanText(liveContext,62000)+'\\nAction catalog: '+cleanText(JSON.stringify(catalog()),18000)+'\\nUser command: '+safeQuery+'\\nRules: (1) Never invent IDs, official numbers, names, amounts or dates. (2) Use the live database evidence to resolve fuzzy references such as «۲۲ رول آبتین», client names, B/L, vessel names and cargo descriptions. (3) If exactly one record matches, populate its UUID in target. (4) If multiple records match, return clarification and name the conflicting candidates. (5) If no record matches for a requested record-specific action, return clarification. (6) For a purely informational/conversational question, use action_code assistant.answer, module assistant, risk safe, and put a concise Persian answer in params.answer based only on the live evidence. (7) For a real data change, choose exactly one catalog action and fill all required params. (8) Never output SQL, tokens, secrets or service_role. Return JSON with action_code,module,target,params,risk,confidence,clarification,reason.';
 const errors:string[]=[];
 for(const p of active){for(const key of keyList(p)){try{return{plan:parseJson(await providerCall(p,key,prompt)),provider:p};}catch(e){errors.push(p+': '+(e instanceof Error?e.message:String(e)));}}}
 throw new Error('هیچ provider فعالی نتوانست Action Plan بسازد. '+errors.join(' | '));
}
function validate(raw:any,g:any):Plan{
 if(forbidden(raw))throw new Error('Action Plan شامل مسیر یا کلید ممنوع است.');
 if(str(raw?.action_code)==='clarification')return{action_code:'clarification',module:str(raw?.module)||'unknown',target:raw?.target||{},params:raw?.params||{},confidence:Number(raw?.confidence)||0,clarification:str(raw?.clarification)||'هدف یا پارامترها مبهم است.',reason:str(raw?.reason)};
 const code=str(raw?.action_code),def=ACTIONS[code];if(!def)throw new Error('Action ناشناخته است.');
 const p:Plan={action_code:code,module:str(raw?.module),target:raw?.target&&typeof raw.target==='object'?raw.target:{},params:raw?.params&&typeof raw.params==='object'?raw.params:{},confidence:Number(raw?.confidence),clarification:raw?.clarification?str(raw.clarification):null,reason:str(raw?.reason)};
 if(p.module!==def.module)throw new Error('Module/action mismatch.');
 if(!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)throw new Error('Confidence نامعتبر است.');
 p.risk=riskFor(p);if(p.confidence<(Number(g.confidence_threshold)||.75))p.clarification=p.clarification||'اطمینان برای اجرای امن کافی نیست؛ هدف یا پارامترها را دقیق تر مشخص کنید.';
 return p;
}
async function one(sb:any,table:string,id:any){if(!isUuid(id))return null;const{data,error}=await sb.from(table).select('*').eq('id',id).maybeSingle();if(error)throw error;return data||null;}
async function byField(sb:any,table:string,field:string,value:any){if(!str(value))return{row:null};const{data,error}=await sb.from(table).select('*').eq(field,str(value)).limit(2);if(error)throw error;if((data||[]).length===1)return{row:data![0]};if((data||[]).length>1)return{clarification:'چند رکورد منطبق وجود دارد؛ شناسه دقیق را مشخص کنید.'};return{row:null};}
async function shipment(sb:any,t:any){if(isUuid(t?.shipment_id)){const r=await one(sb,'shipments',t.shipment_id);if(r)return{row:r};}if(str(t?.bill_of_lading)){const x=await byField(sb,'shipments','bill_of_lading_no',t.bill_of_lading);if(x.clarification)return x;if(x.row)return x;}if(str(t?.shipment_name)){const x=await byField(sb,'shipments','display_name',t.shipment_name);if(x.clarification)return x;if(x.row)return x;}if(isUuid(t?.case_id)){const{data,error}=await sb.from('shipments').select('*').eq('case_id',t.case_id).limit(2);if(error)throw error;if((data||[]).length===1)return{row:data![0]};if((data||[]).length>1)return{clarification:'این پرونده چند محموله دارد؛ محموله دقیق را مشخص کنید.'};}return{clarification:'محموله یکتا پیدا نشد.'};}
async function caseRow(sb:any,t:any){if(isUuid(t?.case_id)){const r=await one(sb,'cases',t.case_id);if(r)return{row:r};}if(isUuid(t?.shipment_id)){const x=await shipment(sb,t);if(x.clarification)return x;if(x.row?.case_id){const r=await one(sb,'cases',x.row.case_id);if(r)return{row:r,shipment:x.row};}}if(str(t?.case_number)){const x=await byField(sb,'cases','case_number',t.case_number);if(x.clarification)return x;if(x.row)return x;}return{clarification:'پرونده یکتا پیدا نشد. شماره پرونده، شناسه پرونده یا محموله دقیق را مشخص کنید.'};}
async function target(sb:any,table:string,t:any,idKey:string,nameKey:string,nameField:string){if(isUuid(t?.[idKey])){const r=await one(sb,table,t[idKey]);if(r)return{row:r};}return byField(sb,table,nameField,t?.[nameKey]);}

const snap=async(sb:any,code:string,t:any)=>{
 if(code.startsWith('cases.')){const x=await caseRow(sb,t);return x.row?pick(x.row,['id','case_number','client_id','status','registration_order_no','proforma_no','warehouse_receipt_no','warehouse_receipt_date','cargo_description','cargo_count','cargo_count_unit','net_weight_kg','gross_weight_kg','release_status','valuation_status','total_payable_irr']):null;}
 if(code.startsWith('maritime.shipping_line.')){const x=await target(sb,'shipping_lines',t,'shipping_line_id','name','name');return pick(x.row,['id','name','name_fa']);}
 if(code.startsWith('maritime.vessel.')){const x=await target(sb,'vessels',t,'vessel_id','name','name');return pick(x.row,['id','name','imo_number','flag_code','shipping_line_id']);}
 if(code.startsWith('maritime.contact.')){const x=await target(sb,'shipping_line_contacts',t,'contact_id','full_name','full_name');return pick(x.row,['id','shipping_line_id','full_name','role_title','phone','whatsapp','email','is_primary']);}
 if(code==='maritime.shipment_update'){const x=await shipment(sb,t);return pick(x.row,['id','case_id','client_id','vessel_id','shipping_line','bill_of_lading_no','bill_of_lading_year','voyage_no','origin_port','destination_port','cargo_count','cargo_count_unit','net_weight_kg','gross_weight_kg','release_invoice_no','release_invoice_date','release_status']);}
 if(code==='documents.upload'||code==='documents.update'||code==='documents.delete'){if(!isUuid(t?.document_id))return null;const x=await one(sb,'shipment_documents',t.document_id);if(x)return pick(x,['id','shipment_id','document_name','original_file_name','storage_path','mime_type','file_size_bytes','extraction_status','created_at']);const y=await one(sb,'customs_documents',t.document_id);return pick(y,['id','shipment_id','case_id','document_type','display_name','original_name','storage_path','status','document_number','issue_date','created_at']);}
 if(code.startsWith('permits.')){const x=await target(sb,'permits',t,'permit_id','permit_number','permit_number');return pick(x.row,['id','case_id','permit_type','permit_number','issuing_authority','status','issued_at','expires_at']);}
 if(code.startsWith('permit_rules.')){const x=await target(sb,'permit_rules',t,'rule_id','rule_name','rule_name');return pick(x.row,['id','rule_name','document_type','condition_json','required','priority','note','is_active']);}
 if(code.startsWith('declarations.')&&isUuid(t?.declaration_id))return pick(await one(sb,'customs_declarations',t.declaration_id),['id','shipment_id','case_id','kottaj_number','declaration_date','customs_path','payment_reference','total_duties_irr','workflow_stage']);
 if(code==='checklist.update'){if(isUuid(t?.case_id)){const r=await sb.from('case_checklist_items').select('*').eq('case_id',t.case_id).eq('item_key',str(t.item_key||'' )).maybeSingle();return pick(r.data,['id','case_id','stage_no','item_key','completed','updated_at']);}if(isUuid(t?.declaration_id)){const r=await sb.from('declaration_exit_checklist_items').select('*').eq('declaration_id',t.declaration_id).eq('item_key',str(t.item_key||'' )).maybeSingle();return pick(r.data,['id','declaration_id','item_key','completed','completed_at','completed_by','updated_at']);}}
 if(code.startsWith('finance.cost.')){const x=await target(sb,'finance_cost_items',t,'cost_id','cost_id','id');return pick(x.row,['id','shipment_id','case_id','client_id','description','amount','amount_irr','status','paid_by','billable']);}
 if(code.startsWith('finance.payment.')){const x=await target(sb,'finance_payments',t,'payment_id','payment_no','payment_no');return pick(x.row,['id','payment_no','shipment_id','case_id','amount','amount_irr','currency','direction','payment_type','reference_no']);}
 if(code.startsWith('finance.payment_request.')){const x=await target(sb,'finance_payment_requests',t,'request_id','request_no','request_no');return pick(x.row,['id','request_no','shipment_id','requested_amount','currency','status','subject']);}
 if(code.startsWith('finance.invoice.')){const x=await target(sb,'finance_invoices',t,'invoice_id','invoice_no','invoice_no');return pick(x.row,['id','invoice_no','client_id','status','subtotal','vat_amount','total_amount','currency']);}
 if(code.startsWith('accounting_vouchers.')&&isUuid(t?.voucher_id))return pick(await one(sb,'customs_accounting_vouchers',t.voucher_id),['id','voucher_number','case_id','client_id','company_name','cargo_type','tonnage','unit_count','unit_type','cargo_entry_date','permit_issue_date','debit_total','credit_total','balance_total','is_balanced']);
 if(code==='accounting_vouchers.void_line'&&isUuid(t?.line_id))return pick(await one(sb,'voucher_line_items',t.line_id),['id','voucher_id','row_number','description','receipt_number','debit_amount','credit_amount','status','void_reason','voided_by','voided_at']);
 if(code==='exit.update'){const x=await target(sb,'case_exit_operations',t,'exit_id','exit_permit_no','exit_permit_no');return pick(x.row,['id','case_id','exit_status','exit_permit_no','exit_permit_date','exit_at','vehicle_plate','driver_name']);}
 if(code.startsWith('control.reminder.')){const x=await target(sb,'operational_reminders',t,'reminder_id','title','title');return pick(x.row,['id','case_id','shipment_id','title','description','due_at','due_precision','priority','status']);}
 if(code==='settings.user.create'||code==='settings.user.update'||code==='settings.user.deactivate'){if(isUuid(t?.user_id))return pick(await one(sb,'profiles',t.user_id),['id','full_name','phone','role','client_id','is_active','created_at','updated_at']);}
 if(code.startsWith('settings.cost_category.')){const x=await target(sb,'finance_cost_categories',t,'category_id','name_fa','name_fa');return pick(x.row,['id','code','name_fa','name_en','description','is_pass_through','is_billable_default','is_active','sort_order']);}
 if(code.startsWith('settings.requirement_rule.')){const x=await target(sb,'document_requirement_rules',t,'rule_id','rule_name','rule_name');return pick(x.row,['id','rule_name','document_type','condition_json','required','priority','note','is_active']);}
 if(code.startsWith('settings.print_template.')){const x=await target(sb,'print_templates',t,'template_id','template_key','template_key');return pick(x.row,['id','template_key','name','document_type','html_template','css_text','is_active']);}
 if(code==='settings.ai_gateway.update'){const r=await sb.from('ai_gateway_settings').select('*').eq('organization_id',t.organization_id||'').maybeSingle();return r.error?null:r.data;}
 if(code==='settings.org.update'){const r=await sb.from('organization_settings').select('*').eq('organization_id',t.organization_id||'').maybeSingle();return r.error?null:r.data;}
 return null;
};

const targetWithResult=(code:string,targetInput:any,resultData:any)=>{const t={...(targetInput||{})};const d=resultData&&typeof resultData==='object'?resultData:{};const pairs:Array<[string,string]>=[];if(code.startsWith('maritime.shipping_line.'))pairs.push(['shipping_line_id','id']);if(code.startsWith('maritime.vessel.'))pairs.push(['vessel_id','id']);if(code.startsWith('maritime.contact.'))pairs.push(['contact_id','id']);if(code.startsWith('documents.'))pairs.push(['document_id','id']);if(code.startsWith('permits.'))pairs.push(['permit_id','id']);if(code.startsWith('declarations.'))pairs.push(['declaration_id','id']);if(code.startsWith('finance.cost.'))pairs.push(['cost_id','id']);if(code.startsWith('finance.payment.'))pairs.push(['payment_id','id']);if(code.startsWith('finance.payment_request.'))pairs.push(['request_id','id']);if(code.startsWith('finance.invoice.'))pairs.push(['invoice_id','id']);if(code.startsWith('accounting_vouchers.create'))pairs.push(['voucher_id','voucher_id']);if(code==='accounting_vouchers.void_line')pairs.push(['line_id','id']);if(code.startsWith('control.reminder.'))pairs.push(['reminder_id','id']);if(code==='exit.update')pairs.push(['exit_id','exit_id']);if(code.startsWith('settings.cost_category.'))pairs.push(['category_id','id']);if(code.startsWith('settings.requirement_rule.'))pairs.push(['rule_id','id']);if(code.startsWith('settings.print_template.'))pairs.push(['template_id','id']);for(const [k,dkey] of pairs){if(isUuid(d[dkey])){t[k]=d[dkey];break;}}if(code==='exit.update'&&isUuid(resultData))t.exit_id=resultData;if((code==='settings.user.create'||code==='settings.user.update'||code==='settings.user.deactivate')&&isUuid(d.id))t.user_id=d.id;return t;};
const execute=async(sb:any,user:any,org:string,code:string,t:any,p:any,attachment:any)=>{
 if(code==='assistant.answer'){return{type:'read',data:{answer:cleanText(p?.answer,12000)}};}
 if(code==='cases.read'){
   const x=await caseRow(sb,t);if(x.clarification)return x;
   const sh=x.shipment||(await sb.from('shipments').select('*').eq('case_id',x.row.id).limit(1)).data?.[0];
   const decl=sh?(await sb.from('customs_declarations').select('id,kottaj_number,declaration_date,customs_path,payment_reference,total_duties_irr,workflow_stage').eq('shipment_id',sh.id).order('created_at',{ascending:false}).limit(1)).data?.[0]:null;
   return{type:'read',data:{case:pick(x.row,['id','case_number','client_id','status','registration_order_no','proforma_no','warehouse_receipt_no','warehouse_receipt_date','cargo_description','cargo_count','cargo_count_unit','net_weight_kg','gross_weight_kg','release_status','valuation_status','total_payable_irr']),shipment:sh?pick(sh,['id','display_name','bill_of_lading_no','shipping_line','current_status','current_location','finance_status','gross_weight_kg','net_weight_kg','cargo_count','cargo_count_unit']):null,declaration:decl||null}};
 }
 if(code==='control.report'){const r=await sb.rpc('get_control_center_shipments');if(r.error)throw r.error;return{type:'read',data:(r.data||[]).slice(0,100)};}
 if(code==='maritime.read'){const [a,b,c]=await Promise.all([sb.from('shipping_lines').select('id,name,name_fa').order('name').limit(200),sb.from('vessels').select('id,name,imo_number,flag_code,shipping_line_id,last_latitude,last_longitude,last_position_at,last_speed_knots,last_course_deg').order('name').limit(300),sb.from('shipping_line_contacts').select('id,shipping_line_id,full_name,role_title,phone,whatsapp,email,is_primary').order('full_name').limit(500)]);const e=a.error||b.error||c.error;if(e)throw e;return{type:'read',data:{shipping_lines:a.data||[],vessels:b.data||[],contacts:c.data||[]}};}
 if(code==='documents.read'){const [a,b]=await Promise.all([sb.from('shipment_documents').select('id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,extraction_status,created_at').order('created_at',{ascending:false}).limit(100),sb.from('customs_documents').select('id,shipment_id,case_id,document_type,display_name,original_name,storage_path,status,document_number,issue_date,created_at').order('created_at',{ascending:false}).limit(100)]);if(a.error||b.error)throw a.error||b.error;return{type:'read',data:{shipment_documents:a.data||[],customs_documents:b.data||[]}};}
 if(code==='permits.read'){let q=sb.from('permits').select('*').order('created_at',{ascending:false}).limit(100);if(isUuid(t?.case_id))q=q.eq('case_id',t.case_id);const r=await q;if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='permit_rules.read'){const r=await sb.from('permit_rules').select('*').order('priority').limit(200);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='declarations.read'){let q=sb.from('customs_declarations').select('*').order('created_at',{ascending:false}).limit(100);if(isUuid(t?.case_id))q=q.eq('case_id',t.case_id);if(isUuid(t?.shipment_id))q=q.eq('shipment_id',t.shipment_id);const r=await q;if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='finance.read'){const [a,b,c,d,e]=await Promise.all([sb.from('finance_cost_items').select('*').order('occurred_at',{ascending:false}).limit(100),sb.from('finance_payments').select('*').order('payment_date',{ascending:false}).limit(100),sb.from('finance_payment_requests').select('*').order('request_date',{ascending:false}).limit(100),sb.from('finance_invoices').select('*').order('issue_date',{ascending:false}).limit(100),sb.from('financial_transactions').select('*').order('transaction_date',{ascending:false}).limit(100)]);const er=[a,b,c,d,e].find(x=>x.error)?.error;if(er)throw er;return{type:'read',data:{costs:a.data||[],payments:b.data||[],requests:c.data||[],invoices:d.data||[],transactions:e.data||[]}};}
 if(code==='accounting_vouchers.read'){let q=sb.from('customs_accounting_vouchers').select('*').order('created_at',{ascending:false}).limit(100);if(isUuid(t?.case_id))q=q.eq('case_id',t.case_id);if(isUuid(t?.voucher_id))q=q.eq('id',t.voucher_id);const r=await q;if(r.error)throw r.error;const ids=(r.data||[]).map((x:any)=>x.id);const li=ids.length?await sb.from('voucher_line_items').select('*').in('voucher_id',ids).order('row_number'):({data:[],error:null} as any);if(li.error)throw li.error;return{type:'read',data:{vouchers:r.data||[],lines:li.data||[]}};}
 if(code==='exit.read'){let q=sb.from('case_exit_operations').select('*').order('updated_at',{ascending:false}).limit(100);if(isUuid(t?.case_id))q=q.eq('case_id',t.case_id);const r=await q;if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.audit.read'){const r=await sb.from('audit_logs').select('id,user_id,action,table_name,record_id,old_data,new_data,created_at').order('created_at',{ascending:false}).limit(200);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.user.read'){const r=await sb.from('profiles').select('id,full_name,phone,role,client_id,is_active,created_at,updated_at').eq('organization_id',org).order('full_name').limit(200);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.cost_category.read'){const r=await sb.from('finance_cost_categories').select('*').eq('organization_id',org).order('sort_order').order('name_fa').limit(300);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.requirement_rule.read'){const r=await sb.from('document_requirement_rules').select('*').eq('organization_id',org).order('priority').order('rule_name').limit(300);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.print_template.read'){const r=await sb.from('print_templates').select('*').eq('organization_id',org).order('name').limit(200);if(r.error)throw r.error;return{type:'read',data:r.data||[]};}
 if(code==='settings.ai_gateway.read'){const r=await sb.from('ai_gateway_settings').select('*').eq('organization_id',org).maybeSingle();if(r.error)throw r.error;return{type:'read',data:r.data||null};}

 if(code==='cases.status_change'){const x=await caseRow(sb,t);if(x.clarification)return x;const r=await sb.rpc('advance_case_stage',{p_case_id:x.row.id,p_target_status:str(p.target_status),p_notes:str(p.notes)||'AI Operator'});if(r.error)throw r.error;return{type:'write',data:{case_id:x.row.id,status:r.data}};}
 if(code==='cases.update'){const x=await caseRow(sb,t);if(x.clarification)return x;const fields=['registration_order_no','proforma_no','warehouse_receipt_no','warehouse_receipt_date','release_status','cargo_description','cargo_count','cargo_count_unit','net_weight_kg','gross_weight_kg','origin_country_code','transaction_country_code','delivery_term','invoice_amount','invoice_currency','insurance_amount_irr','tariff_code','import_duty_rate','customs_fx_rate_irr','customs_value_irr','import_duty_irr','vat_irr','total_payable_irr','valuation_status','vessel_type','unloading_date'];const ch:any={};for(const k of fields)if(p[k]!==undefined)ch[k]=p[k];if(!Object.keys(ch).length)throw new Error('هیچ فیلد مجازی برای ویرایش مشخص نشده است.');const r=await sb.from('cases').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','case_number','status',...fields])};}
 if(code==='cases.delete'){const x=await caseRow(sb,t);if(x.clarification)return x;const r=await sb.rpc('delete_case_safely',{p_case_id:x.row.id});if(r.error)throw r.error;return{type:'delete',data:{case_id:x.row.id}};}

 if(code==='maritime.shipment_update'){const x=await shipment(sb,t);if(x.clarification)return x;const r=await sb.rpc('update_shipment_maritime_data',{p_case_id:x.row.case_id||null,p_shipping_line:p.shipping_line,p_bill_of_lading_no:p.bill_of_lading_no,p_bill_of_lading_year:p.bill_of_lading_year,p_vessel_name:p.vessel_name,p_vessel_imo:p.vessel_imo||null,p_vessel_flag_code:p.vessel_flag_code||null,p_voyage_no:p.voyage_no||null,p_origin_port:p.origin_port||null,p_destination_port:p.destination_port||null,p_cargo_count:p.cargo_count??null,p_cargo_count_unit:p.cargo_count_unit||null,p_net_weight_kg:p.net_weight_kg??null,p_gross_weight_kg:p.gross_weight_kg??null,p_tally_no:p.tally_no||null,p_release_invoice_no:p.release_invoice_no||null,p_release_invoice_date:p.release_invoice_date||null,p_release_status:p.release_status||null,p_electronic_release_no:p.electronic_release_no||null,p_client_id:x.row.client_id||null});if(r.error)throw r.error;return{type:'write',data:{shipment_id:r.data}};}
 if(code.startsWith('maritime.shipping_line.')){if(code.endsWith('.create')){const r=await sb.from('shipping_lines').insert({organization_id:org,name:str(p.name),name_fa:str(p.name_fa)||null}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','name','name_fa'])};}const x=await target(sb,'shipping_lines',t,'shipping_line_id','name','name');if(x.clarification)return x;if(code.endsWith('.update')){const r=await sb.from('shipping_lines').update({name:str(p.name)||x.row.name,name_fa:p.name_fa===undefined?x.row.name_fa:(str(p.name_fa)||null)}).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','name','name_fa'])};}const r=await sb.from('shipping_lines').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}
 if(code.startsWith('maritime.vessel.')){if(code.endsWith('.create')){const line=await target(sb,'shipping_lines',t,'shipping_line_id','shipping_line_name','name');if(line.clarification)return line;const r=await sb.from('vessels').insert({organization_id:org,name:str(p.name),imo_number:str(p.imo_number)||null,flag_code:str(p.flag_code).toUpperCase()||null,shipping_line_id:line.row.id}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','name','imo_number','flag_code','shipping_line_id'])};}const x=await target(sb,'vessels',t,'vessel_id','name','name');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['name','imo_number','flag_code','shipping_line_id'])if(p[k]!==undefined)ch[k]=k==='flag_code'?str(p[k]).toUpperCase():p[k];const r=await sb.from('vessels').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','name','imo_number','flag_code','shipping_line_id'])};}const r=await sb.from('vessels').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}
 if(code.startsWith('maritime.contact.')){if(code.endsWith('.create')){const line=await target(sb,'shipping_lines',t,'shipping_line_id','shipping_line_name','name');if(line.clarification)return line;const r=await sb.from('shipping_line_contacts').insert({organization_id:org,shipping_line_id:line.row.id,full_name:str(p.full_name),role_title:str(p.role_title)||null,phone:str(p.phone)||null,whatsapp:str(p.whatsapp)||null,email:str(p.email)||null,notes:str(p.notes)||null,is_primary:Boolean(p.is_primary)}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','shipping_line_id','full_name','role_title','phone','whatsapp','email','is_primary'])};}const x=await target(sb,'shipping_line_contacts',t,'contact_id','full_name','full_name');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['full_name','role_title','phone','whatsapp','email','notes','is_primary','shipping_line_id'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('shipping_line_contacts').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','shipping_line_id','full_name','role_title','phone','whatsapp','email','is_primary'])};}const r=await sb.from('shipping_line_contacts').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}

 if(code==='documents.upload'){
   const x=await shipment(sb,t);if(x.clarification)return x;
   if(!attachment?.data&&!attachment?.storage_path)throw new Error('فایل ضمیمه لازم است.');
   const mime=str(attachment.mime_type).toLowerCase();if(!/^(application\/pdf|image\/(jpeg|png))$/i.test(mime))throw new Error('فقط PDF/JPG/PNG مجاز است.');
   const name=str(attachment.file_name)||'document';const safe=name.replace(/[^\w.\-\u0600-\u06ff]+/g,'_');const suppliedPath=str(attachment.storage_path);
   if(suppliedPath){
     const prefix=org+'/'+x.row.id+'/';
     if(!suppliedPath.startsWith(prefix))throw new Error('مسیر فایل ضمیمه خارج از محدوده محموله است.');
     const existingSize=Number(attachment.file_size_bytes||0);
     if(existingSize<0||existingSize>50*1024*1024)throw new Error('حجم فایل نامعتبر است.');
     const r=await sb.from('shipment_documents').insert({organization_id:org,shipment_id:x.row.id,uploaded_by:user.id,document_name:name,original_file_name:name,storage_path:suppliedPath,mime_type:mime,file_size_bytes:existingSize,extraction_status:'pending'}).select('*').single();
     if(r.error)throw r.error;
     return{type:'write',data:pick(r.data,['id','shipment_id','document_name','original_file_name','storage_path','mime_type','file_size_bytes'])};
   }
   const bytes=Uint8Array.from(atob(str(attachment.data)),c=>c.charCodeAt(0));if(bytes.length>50*1024*1024)throw new Error('حجم فایل بیش از ۵۰MB است.');
   const path=org+'/'+x.row.id+'/'+crypto.randomUUID()+'-'+safe;
   const up=await sb.storage.from('customs_documents').upload(path,bytes,{contentType:mime,upsert:false});if(up.error)throw up.error;
   const r=await sb.from('shipment_documents').insert({organization_id:org,shipment_id:x.row.id,uploaded_by:user.id,document_name:name,original_file_name:name,storage_path:path,mime_type:mime,file_size_bytes:bytes.length,extraction_status:'pending'}).select('*').single();
   if(r.error){await sb.storage.from('customs_documents').remove([path]);throw r.error;}
   return{type:'write',data:pick(r.data,['id','shipment_id','document_name','original_file_name','storage_path','mime_type','file_size_bytes'])};
 }
 if(code==='documents.update'||code==='documents.delete'){
  const id=t.document_id;
  if(!isUuid(id))throw new Error('document_id لازم است.');
  const shipmentDoc=await one(sb,'shipment_documents',id);
  if(shipmentDoc){
   if(code==='documents.update'){
    const ch:any={};
    for(const k of ['document_name','original_file_name','extraction_status'])if(p[k]!==undefined)ch[k]=p[k];
    const r=await sb.from('shipment_documents').update(ch).eq('id',id).select('*').single();
    if(r.error)throw r.error;
    return{type:'write',data:pick(r.data,['id','document_name','original_file_name','extraction_status','storage_path'])};
   }
   const r=await sb.from('shipment_documents').delete().eq('id',id);
   if(r.error)throw r.error;
   if(shipmentDoc.storage_path)await sb.storage.from('customs_documents').remove([shipmentDoc.storage_path]);
   return{type:'delete',data:{id},before:pick(shipmentDoc,['id','shipment_id','document_name','storage_path'])};
  }
  const customsDoc=await one(sb,'customs_documents',id);
  if(!customsDoc)throw new Error('سند پیدا نشد یا دسترسی ندارید.');
  if(code==='documents.update'){
   const ch:any={};
   for(const k of ['display_name','status','document_number','issue_date'])if(p[k]!==undefined)ch[k]=p[k];
   const r=await sb.from('customs_documents').update(ch).eq('id',id).select('*').single();
   if(r.error)throw r.error;
   return{type:'write',data:pick(r.data,['id','display_name','status','document_number','issue_date','storage_path'])};
  }
  const r=await sb.from('customs_documents').delete().eq('id',id);
  if(r.error)throw r.error;
  if(customsDoc.storage_path)await sb.storage.from('customs_documents').remove([customsDoc.storage_path]);
  return{type:'delete',data:{id},before:pick(customsDoc,['id','shipment_id','display_name','storage_path'])};
 }
 if(code.startsWith('permits.')){
   if(code.endsWith('.create')){const cx=await caseRow(sb,t);if(cx.clarification)return cx;const r=await sb.from('permits').insert({organization_id:org,case_id:cx.row.id,permit_type:str(p.permit_type),permit_number:str(p.permit_number)||null,issuing_authority:str(p.issuing_authority)||null,status:str(p.status)||'pending',issued_at:p.issued_at||null,expires_at:p.expires_at||null}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','case_id','permit_type','permit_number','issuing_authority','status','issued_at','expires_at'])};}
   const x=await target(sb,'permits',t,'permit_id','permit_number','permit_number');if(x.clarification)return x;
   if(code.endsWith('.update')){const ch:any={};for(const k of ['permit_type','permit_number','issuing_authority','status','issued_at','expires_at'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('permits').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','case_id','permit_type','permit_number','issuing_authority','status','issued_at','expires_at'])};}
   const r=await sb.from('permits').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code.startsWith('permit_rules.')){
   if(code.endsWith('.create')){const r=await sb.from('permit_rules').insert({organization_id:org,rule_name:str(p.rule_name),hs_prefix:str(p.hs_prefix)||null,cargo_keyword:str(p.cargo_keyword)||null,permit_type:str(p.permit_type),issuing_authority:str(p.issuing_authority),required:p.required!==false,priority:Number(p.priority)||100,note:str(p.note)||null,is_active:p.is_active!==false}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','rule_name','hs_prefix','cargo_keyword','permit_type','issuing_authority','required','priority','is_active'])};}
   const x=await target(sb,'permit_rules',t,'rule_id','rule_name','rule_name');if(x.clarification)return x;
   if(code.endsWith('.update')){const ch:any={};for(const k of ['rule_name','hs_prefix','cargo_keyword','permit_type','issuing_authority','required','priority','note','is_active'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('permit_rules').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','rule_name','permit_type','issuing_authority','priority','is_active'])};}
   const r=await sb.from('permit_rules').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code==='declarations.register'){
   const x=await shipment(sb,t);if(x.clarification)return x;
   const r=await sb.rpc('register_shipment_declaration',{p_shipment_id:x.row.id,p_kottaj_number:str(p.kottaj_number),p_declaration_date:p.declaration_date||new Date().toISOString(),p_customs_path:str(p.customs_path),p_payment_reference:str(p.payment_reference)||null,p_total_duties_irr:p.total_duties_irr==null?null:Number(p.total_duties_irr),p_case_id:x.row.case_id||null});if(r.error)throw r.error;return{type:'write',data:{declaration_id:r.data,shipment_id:x.row.id}};
 }
 if(code==='declarations.update'){
   if(!isUuid(t.declaration_id))throw new Error('declaration_id لازم است.');const ch:any={};for(const k of ['kottaj_number','declaration_date','customs_path','payment_reference','total_duties_irr'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('customs_declarations').update(ch).eq('id',t.declaration_id).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,Object.keys(ch).concat(['id','shipment_id','case_id']))};
 }
 if(code==='checklist.update'){
   const key=str(p.item_key);if(!key)throw new Error('item_key لازم است.');const completed=Boolean(p.completed);
   if(isUuid(t.case_id)){const r=await sb.from('case_checklist_items').update({completed}).eq('case_id',t.case_id).eq('item_key',key).select('*').maybeSingle();if(r.error)throw r.error;if(!r.data)throw new Error('آیتم چک‌لیست پیدا نشد یا دسترسی ندارید.');return{type:'write',data:pick(r.data,['id','case_id','stage_no','item_key','completed','updated_at'])};}
   if(isUuid(t.declaration_id)){const r=await sb.from('declaration_exit_checklist_items').update({completed,completed_at:completed?new Date().toISOString():null,completed_by:completed?user.id:null,updated_at:new Date().toISOString()}).eq('declaration_id',t.declaration_id).eq('item_key',key).select('*').maybeSingle();if(r.error)throw r.error;if(!r.data)throw new Error('آیتم چک‌لیست خروج پیدا نشد یا دسترسی ندارید.');return{type:'write',data:pick(r.data,['id','declaration_id','item_key','completed','completed_at','completed_by'])};}
   throw new Error('case_id یا declaration_id لازم است.');
 }

 if(code.startsWith('finance.cost.')){
   if(code.endsWith('.create')){
     const x=await shipment(sb,t);if(x.clarification)return x;
     const category=isUuid(p.category_id)?p.category_id:null;const q=Number(p.quantity),price=Number(p.unit_price),rate=Number(p.exchange_rate||1),vat=Number(p.vat_rate||0);
     if(!category||!(q>0)||!(price>=0)||!(rate>0)||!(vat>=0)||!str(p.description))throw new Error('دسته، شرح، مقدار، مبلغ و نرخ معتبر الزامی است.');
     const amount=Math.round(q*price*100)/100,irr=Math.round(amount*rate*100)/100,vatAmount=Math.round(irr*vat/100*100)/100;
     const r=await sb.from('finance_cost_items').insert({organization_id:org,shipment_id:x.row.id,case_id:x.row.case_id||null,client_id:x.row.client_id,category_id:category,description:str(p.description),quantity:q,unit:str(p.unit)||null,unit_price:price,amount,currency:str(p.currency)||'IRR',exchange_rate:rate,amount_irr:irr,vat_rate:vat,vat_amount:vatAmount,payable_by:str(p.payable_by)||'client',paid_by:str(p.paid_by)||'organization',billable:p.billable!==false,reimbursable:Boolean(p.reimbursable),status:'confirmed',created_by:user.id,updated_by:user.id}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','shipment_id','case_id','category_id','description','quantity','unit','unit_price','amount','currency','exchange_rate','amount_irr','vat_rate','vat_amount','status'])};
   }
   const x=await target(sb,'finance_cost_items',t,'cost_id','cost_id','id');if(x.clarification)return x;
   if(code.endsWith('.update')){const ch:any={};for(const k of ['description','quantity','unit','unit_price','currency','exchange_rate','vat_rate','payable_by','paid_by','billable','reimbursable','status'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('finance_cost_items').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}
   const r=await sb.from('finance_cost_items').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code.startsWith('finance.payment.')){
   if(code.endsWith('.create')){const x=await shipment(sb,t);if(x.clarification)return x;const amount=Number(p.amount),rate=Number(p.exchange_rate||1);if(!(amount>0)||!(rate>0))throw new Error('مبلغ و نرخ تبدیل معتبر لازم است.');const r=await sb.from('finance_payments').insert({organization_id:org,client_id:x.row.client_id,payment_no:str(p.payment_no)||null,payment_date:p.payment_date||new Date().toISOString(),direction:str(p.direction)||'received',amount,currency:str(p.currency)||'IRR',exchange_rate:rate,amount_irr:Math.round(amount*rate*100)/100,method:str(p.method)||null,reference_no:str(p.reference_no)||null,bank_name:str(p.bank_name)||null,account_last4:str(p.account_last4)||null,description:str(p.description)||null,created_by:user.id,shipment_id:x.row.id,case_id:x.row.case_id||null,payment_type:str(p.payment_type)||'advance'}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','payment_no','shipment_id','case_id','amount','currency','amount_irr','direction','payment_type','reference_no'])};}
   const x=await target(sb,'finance_payments',t,'payment_id','payment_no','payment_no');if(x.clarification)return x;
   if(code.endsWith('.update')){const ch:any={};for(const k of ['payment_no','payment_date','direction','amount','currency','exchange_rate','amount_irr','method','reference_no','bank_name','account_last4','description','payment_type'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('finance_payments').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}
   const r=await sb.from('finance_payments').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code.startsWith('finance.payment_request.')){
   if(code.endsWith('.create')){const x=await shipment(sb,t);if(x.clarification)return x;if(!str(p.request_no))throw new Error('request_no الزامی است.');const r=await sb.from('finance_payment_requests').insert({organization_id:org,client_id:x.row.client_id,shipment_id:x.row.id,request_no:str(p.request_no),request_date:p.request_date||new Date().toISOString().slice(0,10),requested_amount:Number(p.requested_amount||0),currency:str(p.currency)||'IRR',status:str(p.status)||'issued',subject:str(p.subject)||'درخواست وجه',body_text:str(p.body_text)||null,public_note:str(p.public_note)||null,internal_note:str(p.internal_note)||null,issued_at:new Date().toISOString(),issued_by:user.id,created_by:user.id}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','request_no','shipment_id','requested_amount','currency','status','subject'])};}
   const x=await target(sb,'finance_payment_requests',t,'request_id','request_no','request_no');if(x.clarification)return x;
   if(code.endsWith('.update')){const ch:any={};for(const k of ['request_date','requested_amount','currency','status','subject','body_text','public_note','internal_note'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('finance_payment_requests').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}
   const r=await sb.from('finance_payment_requests').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code.startsWith('finance.invoice.')){
   if(code.endsWith('.create')){const sh=await shipment(sb,t);if(sh.clarification)return sh;if(!str(p.invoice_no))throw new Error('invoice_no الزامی است.');let q=sb.from('finance_cost_items').select('*').eq('shipment_id',sh.row.id).eq('status','confirmed').eq('billable',true);if(Array.isArray(p.cost_item_ids)&&p.cost_item_ids.length)q=q.in('id',p.cost_item_ids.filter(isUuid));const cr=await q;if(cr.error)throw cr.error;if(!cr.data?.length)throw new Error('هزینه قابل صورتحساب پیدا نشد.');const sub=cr.data.reduce((a:any,x:any)=>a+Number(x.amount_irr||0),0),vat=cr.data.reduce((a:any,x:any)=>a+Number(x.vat_amount||0),0);const r=await sb.from('finance_invoices').insert({organization_id:org,client_id:sh.row.client_id,invoice_no:str(p.invoice_no),invoice_year:Number(p.invoice_year||new Date().getFullYear()),status:'draft',subtotal:sub,discount_amount:0,vat_amount:vat,total_amount:sub+vat,currency:'IRR',created_by:user.id,updated_by:user.id}).select('*').single();if(r.error)throw r.error;const li=await sb.from('finance_invoice_lines').insert(cr.data.map((x:any,i:number)=>({organization_id:org,invoice_id:r.data.id,cost_item_id:x.id,shipment_id:sh.row.id,line_type:'cost',description:x.description,quantity:x.quantity,unit:x.unit,unit_price:x.unit_price,amount:x.amount_irr,vat_rate:x.vat_rate,vat_amount:x.vat_amount,sort_order:i})));if(li.error)throw li.error;const si=await sb.from('finance_invoice_shipments').insert({organization_id:org,invoice_id:r.data.id,shipment_id:sh.row.id});if(si.error)throw si.error;await sb.from('finance_cost_items').update({status:'invoiced',updated_by:user.id}).in('id',cr.data.map((x:any)=>x.id));return{type:'write',data:pick(r.data,['id','invoice_no','client_id','status','subtotal','vat_amount','total_amount','currency'])};}
   const x=await target(sb,'finance_invoices',t,'invoice_id','invoice_no','invoice_no');if(x.clarification)return x;
   if(code.endsWith('.issue')){const r=await sb.from('finance_invoices').update({status:'issued',issued_at:new Date().toISOString(),issued_by:user.id,updated_by:user.id}).eq('id',x.row.id).eq('status','draft').select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','invoice_no','status','issued_at','total_amount'])};}
   const r=await sb.from('finance_invoices').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};
 }
 if(code==='accounting_vouchers.create'||code==='accounting_vouchers.update'){
   let vid:string|null=null,old:any=null;if(code.endsWith('.update')){if(!isUuid(t.voucher_id))throw new Error('voucher_id لازم است.');old=await one(sb,'customs_accounting_vouchers',t.voucher_id);if(!old)throw new Error('سند حسابداری پیدا نشد یا دسترسی ندارید.');vid=old.id;}
   const cx=code.endsWith('.create')?await caseRow(sb,t):null;if(cx?.clarification)return cx;
   const h={company_name:str(p.company_name||old?.company_name),cargo_type:str(p.cargo_type||old?.cargo_type),tonnage:Number(p.tonnage??old?.tonnage??0),unit_count:Number(p.unit_count??old?.unit_count??0),unit_type:str(p.unit_type||old?.unit_type),cargo_entry_date:p.cargo_entry_date||old?.cargo_entry_date||null,kottaj_number:p.kottaj_number===undefined?(old?.kottaj_number||null):(str(p.kottaj_number)||null),permit_issue_date:p.permit_issue_date||old?.permit_issue_date||null};
   if(code.endsWith('.create')){const r=await sb.rpc('create_customs_accounting_voucher',{p_case_id:cx.row.id,p_company_name:h.company_name,p_cargo_type:h.cargo_type,p_tonnage:h.tonnage,p_unit_count:h.unit_count,p_unit_type:h.unit_type,p_cargo_entry_date:h.cargo_entry_date,p_kottaj_number:h.kottaj_number,p_permit_issue_date:h.permit_issue_date});if(r.error)throw r.error;vid=r.data?.voucher_id||r.data;}
   if(Array.isArray(p.lines)){const lines=p.lines.map((x:any,i:number)=>({id:x.id||null,row_number:Number(x.row_number||i+1),description:str(x.description)||str(x.description_category),category_id:isUuid(x.category_id)?x.category_id:null,description_category:str(x.description_category)||null,receipt_number:str(x.receipt_number)||null,debit_amount:Number(x.debit_amount||0),credit_amount:Number(x.credit_amount||0)}));const r=await sb.rpc('save_customs_accounting_voucher',{p_voucher_id:vid,p_company_name:h.company_name,p_cargo_type:h.cargo_type,p_tonnage:h.tonnage,p_unit_count:h.unit_count,p_unit_type:h.unit_type,p_cargo_entry_date:h.cargo_entry_date,p_kottaj_number:h.kottaj_number,p_permit_issue_date:h.permit_issue_date,p_lines:lines});if(r.error)throw r.error;return{type:'write',data:r.data};}
   return{type:'write',data:pick(await one(sb,'customs_accounting_vouchers',vid),['id','voucher_number','case_id','client_id','company_name','cargo_type','tonnage','unit_count','unit_type','debit_total','credit_total','balance_total','is_balanced'])};
 }
 if(code==='accounting_vouchers.void_line'){if(!isUuid(t.line_id)||!str(p.reason))throw new Error('line_id و دلیل Void الزامی است.');const r=await sb.rpc('void_customs_voucher_line',{p_line_id:t.line_id,p_reason:str(p.reason)});if(r.error)throw r.error;return{type:'delete',data:r.data};}
 if(code==='exit.update'){const cx=await caseRow(sb,t);if(cx.clarification)return cx;const r=await sb.rpc('upsert_case_exit_operation',{p_case_id:cx.row.id,p_exit_status:str(p.exit_status),p_exit_permit_no:str(p.exit_permit_no)||null,p_exit_permit_date:p.exit_permit_date||null,p_exit_authorized_at:p.exit_authorized_at||null,p_exit_at:p.exit_at||null,p_vehicle_plate:str(p.vehicle_plate)||null,p_driver_name:str(p.driver_name)||null,p_driver_national_id:str(p.driver_national_id)||null,p_notes:str(p.notes)||'AI Operator'});if(r.error)throw r.error;return{type:'write',data:{exit_id:r.data,case_id:cx.row.id}};}
 if(code==='control.reminder.create'){const r=await sb.rpc('create_operational_reminder',{p_title:str(p.title),p_description:str(p.description)||null,p_due_at:p.due_at,p_priority:str(p.priority)||'medium',p_case_id:isUuid(t.case_id)?t.case_id:null,p_shipment_id:isUuid(t.shipment_id)?t.shipment_id:null,p_due_precision:str(p.due_precision)||'day'});if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code==='control.reminder.update'||code==='control.reminder.delete'){const x=await target(sb,'operational_reminders',t,'reminder_id','title','title');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['title','description','due_at','due_precision','priority','status'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('operational_reminders').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const r=await sb.from('operational_reminders').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}

 if(code==='settings.org.update'){const r=await sb.from('organization_settings').upsert({organization_id:org,settings:p.settings||{},updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:'organization_id'}).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code.startsWith('settings.cost_category.')){if(code.endsWith('.create')){const r=await sb.from('finance_cost_categories').insert({organization_id:org,code:str(p.code)||'ai_'+Date.now(),name_fa:str(p.name_fa),name_en:str(p.name_en)||null,description:str(p.description)||null,is_pass_through:Boolean(p.is_pass_through),is_billable_default:p.is_billable_default!==false,is_active:p.is_active!==false,sort_order:Number(p.sort_order)||999}).select('*').single();if(r.error)throw r.error;return{type:'write',data:pick(r.data,['id','code','name_fa','name_en','is_active','sort_order'])};}const x=await target(sb,'finance_cost_categories',t,'category_id','name_fa','name_fa');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['code','name_fa','name_en','description','is_pass_through','is_billable_default','is_active','sort_order'])if(p[k]!==undefined)ch[k]=p[k];const r=await sb.from('finance_cost_categories').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const r=await sb.from('finance_cost_categories').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}
if(code==='settings.user.create'){if(!isUuid(p.user_id)||!str(p.full_name))throw new Error('user_id و نام کامل الزامی است.');const r=await sb.rpc('owner_insert_profile',{p_user_id:p.user_id,p_role:str(p.role)||'client',p_client_id:isUuid(p.client_id)?p.client_id:null,p_full_name:str(p.full_name),p_phone:str(p.phone)||null});if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code==='settings.user.update'){if(!isUuid(t.user_id))throw new Error('user_id لازم است.');const r=await sb.rpc('owner_update_profile',{p_user_id:t.user_id,p_role:p.role===undefined?null:str(p.role),p_client_id:p.client_id===undefined?null:(isUuid(p.client_id)?p.client_id:null),p_full_name:p.full_name===undefined?null:str(p.full_name),p_phone:p.phone===undefined?null:str(p.phone),p_is_active:p.is_active===undefined?null:Boolean(p.is_active)});if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code==='settings.user.deactivate'){if(!isUuid(t.user_id))throw new Error('user_id لازم است.');const r=await sb.rpc('owner_update_profile',{p_user_id:t.user_id,p_role:null,p_client_id:null,p_full_name:null,p_phone:null,p_is_active:false});if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code==='settings.ai_gateway.update'){const row={organization_id:org,enabled:p.enabled!==false,online_enabled:p.online_enabled!==false,preferred_provider:str(p.preferred_provider)||'gemini',fallback_providers:Array.isArray(p.fallback_providers)?p.fallback_providers:['cloudflare','groq','openrouter','openai'],confidence_threshold:Number(p.confidence_threshold??.75),redaction_enabled:p.redaction_enabled!==false,max_commands_per_minute:Number(p.max_commands_per_minute||20),updated_by:user.id,updated_at:new Date().toISOString()};const r=await sb.from('ai_gateway_settings').upsert(row,{onConflict:'organization_id'}).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}
 if(code.startsWith('settings.requirement_rule.')){if(code.endsWith('.create')){const r=await sb.from('document_requirement_rules').insert({organization_id:org,rule_name:str(p.rule_name),document_type:str(p.document_type),condition_json:p.condition_json||{},required:p.required!==false,priority:Number(p.priority)||100,note:str(p.note)||null,is_active:p.is_active!==false,created_by:user.id,updated_by:user.id}).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const x=await target(sb,'document_requirement_rules',t,'rule_id','rule_name','rule_name');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['rule_name','document_type','condition_json','required','priority','note','is_active'])if(p[k]!==undefined)ch[k]=p[k];ch.updated_by=user.id;const r=await sb.from('document_requirement_rules').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const r=await sb.from('document_requirement_rules').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}
 if(code.startsWith('settings.print_template.')){if(code.endsWith('.create')){const r=await sb.from('print_templates').insert({organization_id:org,template_key:str(p.template_key),name:str(p.name),document_type:str(p.document_type),html_template:String(p.html_template||''),css_text:String(p.css_text||''),is_active:p.is_active!==false,created_by:user.id,updated_by:user.id}).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const x=await target(sb,'print_templates',t,'template_id','template_key','template_key');if(x.clarification)return x;if(code.endsWith('.update')){const ch:any={};for(const k of ['template_key','name','document_type','html_template','css_text','is_active'])if(p[k]!==undefined)ch[k]=p[k];ch.updated_by=user.id;const r=await sb.from('print_templates').update(ch).eq('id',x.row.id).select('*').single();if(r.error)throw r.error;return{type:'write',data:r.data};}const r=await sb.from('print_templates').delete().eq('id',x.row.id);if(r.error)throw r.error;return{type:'delete',data:{id:x.row.id}};}
 throw new Error('عملیات پشتیبانی نشده است.');
};

async function main(req:Request){
 const origin=req.headers.get('Origin')||'';
 if(req.method==='OPTIONS')return new Response('ok',{headers:headers(origin)});
 if(req.method!=='POST')return out({error:'Method not allowed'},405,origin);

 const auth=req.headers.get('Authorization')||'';const jwt=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
 if(!jwt)return out({error:'Unauthorized'},401,origin);
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 if(!url||!anon)return out({error:'Supabase configuration missing'},503,origin);

 const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}}});
 const authUser=await sb.auth.getUser(jwt);if(!authUser.data.user)return out({error:'Unauthorized'},401,origin);
 const user=authUser.data.user;
 const pr=await sb.from('profiles').select('id,organization_id,role,is_active,client_id,full_name').eq('id',user.id).maybeSingle();
 if(pr.error)throw pr.error;if(!pr.data||pr.data.is_active===false)return out({error:'پروفایل کاربر معتبر یا فعال نیست.'},403,origin);

 const body=await req.json().catch(()=>({}));const op=str(body.op||'plan');
 const gr=await sb.from('ai_gateway_settings').select('*').eq('organization_id',pr.data.organization_id).maybeSingle();if(gr.error)throw gr.error;
 const g=gr.data||{enabled:true,online_enabled:true,preferred_provider:'gemini',fallback_providers:['cloudflare','groq','openrouter','openai'],confidence_threshold:.75,redaction_enabled:true,max_commands_per_minute:20};
 if(g.enabled===false)return out({error:'AI Operator توسط Owner غیرفعال شده است.'},403,origin);

 if(op==='history'){
   const r=await sb.from('ai_operator_commands').select('id,natural_command,module,action_code,risk_level,status,confidence,created_at,confirmation_at,final_confirmation_at,result,error_message').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);
   if(r.error)throw r.error;return out({history:r.data||[]},200,origin);
 }

 if(op==='plan'){
   const query=str(body.query);if(!query)return out({error:'دستور خالی است.'},400,origin);
   if(isCapabilitiesQuery(query))return out({status:'capabilities',answer:capabilitiesText(),capabilities:catalog()},200,origin);
   const since=new Date(Date.now()-60000).toISOString();
   const rc=await sb.from('ai_operator_commands').select('id',{count:'exact',head:true}).eq('user_id',user.id).gte('created_at',since);
   if(rc.error)throw rc.error;if((rc.count||0)>=(Number(g.max_commands_per_minute)||20))return out({error:'سقف درخواست AI Operator در دقیقه پر شده است.'},429,origin);

   const planned=await buildPlan(sb,pr.data.organization_id,query,pr.data.role,str(body.page_context),g,body.attachment_meta||null);
   const plan=validate(planned.plan,g);
   if(plan.action_code.startsWith('settings.')&&pr.data.role!=='owner')return out({error:'این عملیات فقط برای Owner مجاز است.'},403,origin);

   if(plan.action_code==='clarification'||plan.clarification){
     const r=await sb.from('ai_operator_commands').insert({organization_id:pr.data.organization_id,user_id:user.id,session_id:str(body.session_id)||null,natural_command:query,page_context:str(body.page_context),module:plan.module,action_code:'clarification',target:plan.target||{},plan,confidence:plan.confidence||0,risk_level:'safe',status:'clarification_needed'}).select('id').single();
     if(r.error)throw r.error;return out({command_id:r.data.id,status:'clarification_needed',plan,provider:planned.provider},200,origin);
   }

   const risk=riskFor(plan);const phrase=risk==='destructive'?'تأیید نهایی: '+ACTIONS[plan.action_code].label:null;
   const r=await sb.from('ai_operator_commands').insert({organization_id:pr.data.organization_id,user_id:user.id,session_id:str(body.session_id)||null,natural_command:query,page_context:str(body.page_context),module:plan.module,action_code:plan.action_code,target:plan.target||{},plan,confidence:plan.confidence||0,risk_level:risk,status:risk==='safe'?'executing':'awaiting_confirmation',confirmation_required:risk!=='safe',final_confirmation_phrase:phrase}).select('id').single();
   if(r.error)throw r.error;
   if(risk!=='safe')return out({command_id:r.data.id,status:'awaiting_confirmation',plan,risk_level:risk,confirmation_required:true,final_confirmation_phrase:phrase},200,origin);

   try{
     const before=await snap(sb,plan.action_code,plan.target||{});
     const result=await execute(sb,user,pr.data.organization_id,plan.action_code,plan.target||{},plan.params||{},body.attachment||null);
     if(result?.clarification){await transition(sb,r.data.id,{status:'clarification_needed',error_message:result.clarification,result:{clarification:result.clarification}});return out({command_id:r.data.id,status:'clarification_needed',clarification:result.clarification},200,origin);}
     const after=await snap(sb,plan.action_code,targetWithResult(plan.action_code,plan.target||{},result?.data??result));
     await transition(sb,r.data.id,{status:'executed',before_data:before,after_data:after,result:result?.data??result,executed_by:user.id,executed_at:new Date().toISOString(),confirmation_at:new Date().toISOString()});
     return out({command_id:r.data.id,status:'executed',plan,risk_level:risk,result:result?.data??result,before_data:before,after_data:after},200,origin);
   }catch(e){
     const msg=e instanceof Error?e.message:String(e);
     await transition(sb,r.data.id,{status:'failed',error_message:msg,result:{error:msg},executed_by:user.id,executed_at:new Date().toISOString()});
     return out({command_id:r.data.id,status:'failed',error:msg},403,origin);
   }
 }

 if(op==='execute'){
   const id=str(body.command_id);if(!isUuid(id))return out({error:'command_id نامعتبر است.'},400,origin);
   const row=await sb.from('ai_operator_commands').select('*').eq('id',id).maybeSingle();if(row.error)throw row.error;
   if(!row.data)return out({error:'دستور پیدا نشد یا دسترسی ندارید.'},404,origin);
   const cmd=row.data;
   if(cmd.user_id!==user.id)return out({error:'این دستور متعلق به کاربر جاری نیست.'},403,origin);
   if(['executed','failed','rejected','cancelled','clarification_needed'].includes(cmd.status))return out({error:'این دستور دیگر قابل اجرا نیست.',status:cmd.status},409,origin);

   const plan=validate(cmd.plan,g);
   if(plan.action_code==='clarification'||plan.clarification)return out({error:plan.clarification||'Action Plan نیازمند شفاف سازی است.'},409,origin);
   if(plan.action_code.startsWith('settings.')&&pr.data.role!=='owner')return out({error:'این عملیات فقط برای Owner مجاز است.'},403,origin);
   const risk=effectiveRisk(plan);
   if(risk!==cmd.risk_level)return out({error:'Risk mismatch; command rejected.'},409,origin);

   if(risk==='requires_confirmation'){
     if(body.confirm!==true)return out({error:'برای این عملیات تأیید صریح لازم است.',command_id:id},409,origin);
   }
   if(risk==='destructive'&&!cmd.confirmation_at){
     if(body.confirm!==true)return out({error:'ابتدا تأیید اولیه عملیات مخرب لازم است.',command_id:id},409,origin);
     await transition(sb,id,{status:'awaiting_confirmation',confirmation_at:new Date().toISOString()});
     return out({status:'awaiting_final_confirmation',command_id:id,final_confirmation_phrase:cmd.final_confirmation_phrase},200,origin);
   }
   if(risk==='destructive'&&str(body.final_confirmation)!==str(cmd.final_confirmation_phrase))return out({error:'عبارت تأیید نهایی صحیح نیست.',command_id:id},409,origin);

   try{
     await transition(sb,id,{status:'executing',confirmation_at:risk==='requires_confirmation'?new Date().toISOString():cmd.confirmation_at||null,final_confirmation_at:risk==='destructive'?new Date().toISOString():null});
     const before=await snap(sb,cmd.action_code,cmd.target||{});
     const result=await execute(sb,user,pr.data.organization_id,cmd.action_code,cmd.target||{},cmd.plan?.params||{},body.attachment||null);
     if(result?.clarification){await transition(sb,id,{status:'clarification_needed',error_message:result.clarification,result:{clarification:result.clarification}});return out({command_id:id,status:'clarification_needed',clarification:result.clarification},200,origin);}
     const after=await snap(sb,cmd.action_code,targetWithResult(cmd.action_code,cmd.target||{},result?.data??result));
     await transition(sb,id,{status:'executed',before_data:before,after_data:after,result:result?.data??result,executed_by:user.id,executed_at:new Date().toISOString()});
     return out({command_id:id,status:'executed',risk_level:risk,result:result?.data??result,before_data:before,after_data:after},200,origin);
   }catch(e){
     const msg=e instanceof Error?e.message:String(e);
     try{await transition(sb,id,{status:'failed',error_message:msg,result:{error:msg},executed_by:user.id,executed_at:new Date().toISOString()});}catch{}
     return out({command_id:id,status:'failed',error:msg},403,origin);
   }
 }
 return out({error:'Unknown operation.'},400,origin);
}
Deno.serve(async(req)=>{try{return await main(req);}catch(e){console.error(e);return out({error:e instanceof Error?e.message:String(e)},500,req.headers.get('Origin')||'');}});
