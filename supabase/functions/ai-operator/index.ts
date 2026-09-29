import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Risk='safe'|'requires_confirmation'|'destructive';
type Plan={action_code:string;module:string;target:Record<string,unknown>;params:Record<string,unknown>;risk?:Risk;confidence?:number;clarification?:string|null;reason?:string};
const ORIGINS=new Set(['https://darbandicommercial.ir','https://www.darbandicommercial.ir','https://customs-os-psi.vercel.app','http://localhost:5173','http://127.0.0.1:5173']);
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
 'settings.cost_category.create':{module:'settings',label:'ایجاد دسته هزینه',risk:'requires_confirmation',description:'ایجاد finance_cost_categories'},
 'settings.cost_category.update':{module:'settings',label:'ویرایش دسته هزینه',risk:'requires_confirmation',description:'ویرایش finance_cost_categories'},
 'settings.cost_category.delete':{module:'settings',label:'حذف دسته هزینه',risk:'destructive',description:'حذف finance_cost_categories'},
 'settings.user.update':{module:'settings',label:'ویرایش کاربر/نقش',risk:'destructive',description:'ویرایش profile؛ تغییر نقش یا غیرفعال سازی destructive است'},
 'settings.ai_gateway.read':{module:'settings',label:'مشاهده AI Gateway',risk:'safe',description:'خواندن ai_gateway_settings'},
 'settings.ai_gateway.update':{module:'settings',label:'ویرایش AI Gateway',risk:'requires_confirmation',description:'ویرایش ai_gateway_settings'},
 'settings.requirement_rule.create':{module:'settings',label:'ایجاد Rule مدارک',risk:'requires_confirmation',description:'ایجاد document_requirement_rules'},
 'settings.requirement_rule.update':{module:'settings',label:'ویرایش Rule مدارک',risk:'requires_confirmation',description:'ویرایش document_requirement_rules'},
 'settings.requirement_rule.delete':{module:'settings',label:'حذف Rule مدارک',risk:'destructive',description:'حذف document_requirement_rules'},
 'settings.print_template.create':{module:'settings',label:'ایجاد قالب چاپ',risk:'requires_confirmation',description:'ایجاد print_templates'},
 'settings.print_template.update':{module:'settings',label:'ویرایش قالب چاپ',risk:'requires_confirmation',description:'ویرایش print_templates'},
 'settings.print_template.delete':{module:'settings',label:'حذف قالب چاپ',risk:'destructive',description:'حذف print_templates'},
 'settings.audit.read':{module:'settings',label:'مشاهده Audit Log',risk:'safe',description:'خواندن Audit Log غیرقابل تغییر'}
};
const headers=(o:string)=>({'Access-Control-Allow-Origin':ORIGINS.has(o)?o:'https://darbandicommercial.ir','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'});
const out=(v:unknown,code=200,o='')=>new Response(JSON.stringify(v),{status:code,headers:headers(o)});
const str=(v:any)=>String(v??'').trim();
const isUuid=(v:any)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(v));
const pick=(r:any,ks:string[])=>r?Object.fromEntries(ks.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])):null;
const cleanText=(v:any,n=8000)=>str(v).slice(0,n);
function redact(v:string){let s=v;s=s.replace(/(authorization|bearer|api[_ -]?key|token|password|secret|کلید|رمز)\s*[:=]?\s*\S+/gi,'$1:[REDACTED]');s=s.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,'[REDACTED]');s=s.replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g,'[REDACTED]');return cleanText(s);}
function forbidden(v:any):boolean{if(v==null)return false;if(Array.isArray(v))return v.some(forbidden);if(typeof v==='object')return Object.entries(v).some(([k,x])=>/raw.?sql|execute.?sql|service.?role|secret_key|admin.?key|access_token|refresh_token/i.test(k)||forbidden(x));return typeof v==='string'&&/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b\s+.+\b(FROM|TABLE|INTO)\b/i.test(v);}
function riskFor(p:Plan):Risk{const d=ACTIONS[p.action_code];if(!d)return'destructive';if(p.action_code==='cases.status_change'&&str(p.params?.target_status)==='archived')return'destructive';if(p.action_code==='settings.user.update'&&(p.params?.role!==undefined||p.params?.is_active!==undefined||p.params?.client_id!==undefined))return'destructive';return d.risk;}
const catalog=()=>Object.entries(ACTIONS).map(([action_code,d])=>({action_code,module:d.module,label:d.label,description:d.description,risk:d.risk}));

async function providerCall(provider:string,key:string,prompt:string){
 if(provider==='gemini'){const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||'Gemini HTTP '+r.status);return str(d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('\n'));}
 if(provider==='cloudflare'){const account=Deno.env.get('CLOUDFLARE_ACCOUNT_ID');if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID missing');const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/meta/llama-3.1-8b-instruct',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'Return JSON only.'},{role:'user',content:prompt}]})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.errors?.[0]?.message||'Cloudflare HTTP '+r.status);return str(d?.result?.response);}
 if(provider==='groq'||provider==='openrouter'){const base=provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions';const model=provider==='groq'?'openai/gpt-oss-120b':'google/gemini-2.5-flash';const h:any={Authorization:'Bearer '+key,'Content-Type':'application/json'};if(provider==='openrouter'){h['HTTP-Referer']='https://darbandicommercial.ir';h['X-Title']='Customs OS AI Operator';}const r=await fetch(base,{method:'POST',headers:h,body:JSON.stringify({model,messages:[{role:'system',content:'Return exactly one JSON object.'},{role:'user',content:prompt}],temperature:0,max_tokens:1400,response_format:{type:'json_object'}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||provider+' HTTP '+r.status);return str(d?.choices?.[0]?.message?.content);}
 if(provider==='openai'){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',input:prompt,text:{format:{type:'json_object'}}})});const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(d?.error?.message||'OpenAI HTTP '+r.status);return str(d?.output_text);}
 throw new Error('provider not supported');
}
function parseJson(raw:string){const v=raw.replace(/^\s*\`\`\`(?:json)?/i,'').replace(/\`\`\`\s*$/,'').trim();const a=v.indexOf('{'),b=v.lastIndexOf('}');if(a<0||b<a)throw new Error('Action Plan معتبر JSON نیست.');return JSON.parse(v.slice(a,b+1));}
async function buildPlan(query:string,role:string,page:string,g:any){
 const providers=Array.from(new Set([str(g.preferred_provider),...(Array.isArray(g.fallback_providers)?g.fallback_providers:[])]).values()).filter(Boolean);
 const active=g.online_enabled===false?providers.filter((x:string)=>x==='cloudflare'):providers;
 const keys:Record<string,string|undefined>={cloudflare:Deno.env.get('CLOUDFLARE_API_TOKEN'),gemini:Deno.env.get('GEMINI_API_KEY'),groq:Deno.env.get('GROQ_API_KEY'),openrouter:Deno.env.get('OPENROUTER_API_KEY'),openai:Deno.env.get('OPENAI_API_KEY')};
 const prompt='Customs OS secure planner. One action only. Never invent IDs. If target is not unique use action_code=clarification. Never output SQL, token, secret or service_role. User role: '+role+'\\nCurrent page context: '+cleanText(page,1600)+'\\nAction catalog: '+cleanText(JSON.stringify(catalog()),18000)+'\\nUser command: '+redact(query)+'\\nReturn JSON with action_code,module,target,params,risk,confidence,clarification,reason.';
 const errors:string[]=[];
 for(const p of active){const key=keys[p];if(!key)continue;try{return{plan:parseJson(await providerCall(p,key,prompt)),provider:p};}catch(e){errors.push(p+': '+(e instanceof Error?e.message:String(e)));}}
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
