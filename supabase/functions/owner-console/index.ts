import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGIN_RE=/^(https?:\/\/)(www\.)?(darbandicommercial\.ir|customs-os-psi\.vercel\.app|customs\.mohsen-darbandi\.workers\.dev)$/i;
const ORIGINS=new Set(['https://darbandicommercial.ir','https://www.darbandicommercial.ir','http://darbandicommercial.ir','http://www.darbandicommercial.ir','https://customs.mohsen-darbandi.workers.dev','https://customs-os-psi.vercel.app','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string,requestedHeaders:string|null=null,requestedMethod:string|null=null)=>{
 const allow=ORIGINS.has(origin)||ORIGIN_RE.test(origin);
 const headers=requestedHeaders?.trim()||'authorization, x-client-info, apikey, content-type';
 const methods=requestedMethod?.trim()?(requestedMethod.toUpperCase()==='POST'?'POST, OPTIONS':'POST, OPTIONS'):'POST, OPTIONS';
 return {'Access-Control-Allow-Origin':allow?origin:'https://darbandicommercial.ir','Access-Control-Allow-Headers':headers,'Access-Control-Allow-Methods':methods,'Access-Control-Max-Age':'600','Access-Control-Allow-Credentials':'true','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin, Access-Control-Request-Headers'};
};
const out=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:cors(origin)});
const str=(v:any)=>String(v??'').trim();
const isUuid=(v:any)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(v));
const getSecretKey=()=>{try{const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(raw){const keys=JSON.parse(raw);if(keys?.default)return String(keys.default)}}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';};

type Resource={table:string; immutable?:boolean; archive?:boolean; softDelete?:boolean; global?:boolean; searchFields?:string[]};
const RESOURCES:Record<string,Resource>={
 clients:{table:'clients',searchFields:['name']},cases:{table:'cases',searchFields:['case_number','display_name','registration_order_no','proforma_no','warehouse_receipt_no','cargo_description']},
 registration_orders:{table:'registration_orders',searchFields:['order_number','tariff_code','notes']},shipments:{table:'shipments',searchFields:['display_name','bill_of_lading_no','shipping_line','voyage_no','origin_port','destination_port']},
 containers:{table:'containers',searchFields:['container_number','seal_number']},shipment_customs_data:{table:'shipment_customs_data',searchFields:['registration_order_no','warehouse_receipt_no','cargo_description','tariff_code','bill_of_lading']},
 shipping_lines:{table:'shipping_lines',searchFields:['name','name_fa']},vessels:{table:'vessels',searchFields:['name','imo_number','flag_code']},contacts:{table:'shipping_line_contacts',searchFields:['full_name','phone','whatsapp','email']},
 shipment_documents:{table:'shipment_documents',archive:true,searchFields:['document_name','original_file_name','storage_path']},customs_documents:{table:'customs_documents',archive:true,searchFields:['original_name','display_name','document_number']},
 shipment_document_extractions:{table:'shipment_document_extractions',searchFields:['field_key','field_label','extracted_value']},document_extraction_fields:{table:'document_extraction_fields',searchFields:['field_key','extracted_value','verification_status']},
 documents:{table:'documents',searchFields:['file_name','doc_type','storage_path']},document_rules:{table:'document_requirement_rules',searchFields:['rule_name','document_type']},
 permit_rules:{table:'permit_rules',searchFields:['rule_name','hs_prefix','cargo_keyword','permit_type']},permits:{table:'permits',searchFields:['permit_number','permit_type','issuing_authority']},
 customs_offices:{table:'customs_offices',global:true,searchFields:['name','code']},hs_codes:{table:'hs_codes',global:true,searchFields:['code','description']},settings_reference_data:{table:'settings_reference_data',searchFields:['category','code','name']},
 case_checklist_items:{table:'case_checklist_items',searchFields:['item_key']},declaration_checklist_items:{table:'declaration_checklist_items',searchFields:['item_key']},declaration_exit_checklist_items:{table:'declaration_exit_checklist_items',searchFields:['item_key']},
 declarations:{table:'customs_declarations',searchFields:['kottaj_number','customs_path','payment_reference']},
 cost_categories:{table:'finance_cost_categories',searchFields:['code','name_fa','name_en','description']},finance_settings:{table:'finance_org_settings'},
 costs:{table:'finance_cost_items',searchFields:['description','notes','internal_notes']},payments:{table:'finance_payments',searchFields:['payment_no','reference_no','bank_name','description']},payment_requests:{table:'finance_payment_requests',searchFields:['request_no','subject','body_text']},
 payment_request_lines:{table:'finance_payment_request_lines',searchFields:['description']},invoices:{table:'finance_invoices',searchFields:['invoice_no','public_note','internal_note']},invoice_lines:{table:'finance_invoice_lines',searchFields:['description']},invoice_shipments:{table:'finance_invoice_shipments'},
 payment_allocations:{table:'finance_payment_allocations',searchFields:['id']},vouchers:{table:'customs_accounting_vouchers',searchFields:['company_name','cargo_type']},voucher_lines:{table:'voucher_line_items',immutable:true},financial_permissions:{table:'financial_permissions'},petty_cash_ledger:{table:'petty_cash_ledger'},voucher_line_profit:{table:'voucher_line_profit'},
 exit:{table:'case_exit_operations',searchFields:['exit_permit_no','vehicle_plate','driver_name']},org:{table:'organizations',searchFields:['name','economic_code']},org_settings:{table:'organization_settings'},
 ai_gateway:{table:'ai_gateway_settings'},templates:{table:'print_templates',searchFields:['template_key','name','document_type']},user_settings:{table:'user_settings'},
 knowledge_sources:{table:'knowledge_sources',searchFields:['title','source_type','source_number','issuer','subject']},knowledge_chunks:{table:'knowledge_chunks',searchFields:['content']},
 ai_knowledge_documents:{table:'ai_knowledge_documents',searchFields:['title','source_type','source_uri']},ai_knowledge_chunks:{table:'ai_knowledge_chunks',searchFields:['content']}
}

const READ_ONLY:Record<string,string>={
 audit:'audit_logs',case_history:'case_status_history',financial_history:'financial_transactions',
 ai_commands:'ai_operator_commands',ai_interactions:'ai_interactions',ai_action_logs:'ai_agent_action_logs',
 ai_risk_findings:'ai_risk_findings',file_security_events:'file_security_events',
 shipment_tracking:'shipment_tracking_events',discrepancy_logs:'discrepancy_logs'
};

const PROTECTED=new Set(['id','organization_id','created_at','updated_at','created_by','updated_by','user_id','uploaded_by','voided_by','voided_at','archived_by','archived_at','is_archived','archive_reason']);
const allowedData=(data:any)=>{
 const src=data&&typeof data==='object'?data:{}, out:any={};
 for(const [k,v] of Object.entries(src))if(!PROTECTED.has(k))out[k]=v;
 return out;
};

async function authContext(req:Request){
 const auth=req.headers.get('Authorization')||'';
 const jwt=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
 if(!jwt)throw new Error('Unauthorized');
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 if(!url||!anon)throw new Error('Supabase configuration missing');
 const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}}});
 const {data:{user}}=await sb.auth.getUser(jwt);if(!user)throw new Error('Unauthorized');
 const {data:profile,error}=await sb.from('profiles').select('id,organization_id,role,is_active,full_name').eq('id',user.id).maybeSingle();
 if(error)throw error;
 if(!profile||profile.is_active===false||profile.role!=='owner')throw new Error('Owner access required');
 return {sb,user,profile};
}

async function listRows(sb:any,profile:any,resource:string,body:any){
 if(resource==='profiles'){
   let q=sb.from('profiles').select('id,full_name,phone,role,client_id,is_active,created_at,updated_at').eq('organization_id',profile.organization_id).order('full_name').limit(Math.min(Number(body.limit)||300,500));
   const search=str(body.search);if(search){if(isUuid(search))q=q.or('full_name.ilike.%'+search+'%,phone.ilike.%'+search+'%,role.ilike.%'+search+',id.eq.'+search);else q=q.or('full_name.ilike.%'+search+'%,phone.ilike.%'+search+'%,role.ilike.%'+search+'%');}
   const r=await q;if(r.error)throw r.error;return r.data||[];
 }
 const ro=READ_ONLY[resource];
 if(ro){const r=await sb.from(ro).select('*').eq('organization_id',profile.organization_id).limit(Math.min(Number(body.limit)||300,500));if(r.error)throw r.error;return r.data||[];}
  const cfg=RESOURCES[resource];if(!cfg)throw new Error('Unknown resource');
 let q:any;
 if(cfg.table==='organizations')q=sb.from(cfg.table).select('*').eq('id',profile.organization_id).limit(1);
 else if(cfg.table==='user_settings'){const users=await sb.from('profiles').select('id').eq('organization_id',profile.organization_id);if(users.error)throw users.error;q=sb.from(cfg.table).select('*').in('user_id',(users.data||[]).map((x:any)=>x.id)).limit(500);}
 else if(cfg.global)q=sb.from(cfg.table).select('*').limit(Math.min(Number(body.limit)||300,500));
 else {
   q=sb.from(cfg.table).select('*').eq('organization_id',profile.organization_id);
   if(!['declaration_exit_checklist_items','finance_payment_request_lines','finance_invoice_shipments','organization_settings'].includes(cfg.table))q=q.order('created_at',{ascending:false});
   q=q.limit(Math.min(Number(body.limit)||300,500));
 }
 const search=str(body.search);if(search){const safe=search.replace(/[%,]/g,' ');const sf=(cfg.searchFields||[]).map((k:string)=>k+'.ilike.%'+safe+'%');if(sf.length)q=q.or(sf.join(','));}
 const r=await q;if(r.error)throw r.error;return r.data||[];
}

async function write(ctx:any,body:any){
 const {sb,user,profile}=ctx;
 const resource=str(body.resource), op=str(body.action||body.op);
 if(resource==='profiles'){
   if(op==='list')return await listRows(sb,profile,'profiles',body);
   if(op==='create'){
     const d=body.data||{};
     const email=str(body.email||d.email);
     const password=str(body.password||d.password);
     const requestedRole=str(d.role);
     const role=requestedRole||'broker';
     const clientId=d.client_id;

     if(email && password){
       if(role==='client'&&!isUuid(clientId))throw new Error('برای نقش صاحب کالا، Client UUID معتبر الزامی است.');
       if(role!=='client'&&clientId)throw new Error('برای نقش‌های سازمانی، Client UUID نباید تعیین شود.');
       if(!/^\\S+@\\S+\\.\\S+$/.test(email))throw new Error('ایمیل کاربر معتبر نیست');
       if(password.length<8)throw new Error('رمز عبور کاربر باید حداقل ۸ کاراکتر باشد');

       const serviceRole=getSecretKey();
       const serviceUrl=Deno.env.get('SUPABASE_URL');
       if(!serviceRole||!serviceUrl)throw new Error('Supabase server configuration missing');

       const admin=createClient(serviceUrl,serviceRole,{auth:{autoRefreshToken:false,persistSession:false}});
       const created=await admin.auth.admin.createUser({
         email,
         password,
         email_confirm:true,
         user_metadata:{full_name:str(body.full_name)},
       });
       if(created.error)throw created.error;

       const authUserId=created.data.user?.id;
       if(!authUserId)throw new Error('Auth user creation returned no user id');

       const profile=await sb.rpc('owner_insert_profile',{
         p_user_id:authUserId,
         p_role:role as any,
         p_client_id:role==='client'?clientId:null,
         p_full_name:str(body.full_name),
         p_phone:str(d.phone)||null,
       });

       if(profile.error){
         await admin.auth.admin.deleteUser(authUserId);
         throw profile.error;
       }

       return profile.data;
     }

     if(!isUuid(body.user_id)||!str(body.full_name))throw new Error('ایمیل و رمز عبور برای کاربر جدید الزامی است؛ برای Auth User موجود، User ID را وارد کنید');
     if(role==='client'&&!isUuid(clientId))throw new Error('برای نقش صاحب کالا، Client UUID معتبر الزامی است.');
     if(role!=='client'&&clientId)throw new Error('برای نقش‌های سازمانی، Client UUID نباید تعیین شود.');
     const r=await sb.rpc('owner_insert_profile',{
       p_user_id:body.user_id,
       p_role:role as any,
       p_client_id:role==='client'?clientId:null,
       p_full_name:str(body.full_name),
       p_phone:str(d.phone)||null
     });
     if(r.error)throw r.error;
     return r.data;
   }
   if(op==='save'){
     if(!isUuid(body.id))throw new Error('user id required');
     const d=body.data||{};
     if((d.role!==undefined||d.is_active!==undefined||d.client_id!==undefined) && str(body.confirmation)!=='تأیید نهایی تغییر کاربر')throw new Error('Final confirmation phrase is required for role/status changes.');
     const r=await sb.rpc('owner_manage_profile',{p_user_id:body.id,p_role:d.role===undefined?null:d.role,p_client_id:d.client_id===undefined?null:d.client_id,p_full_name:d.full_name===undefined?null:d.full_name,p_phone:d.phone===undefined?null:d.phone,p_is_active:d.is_active===undefined?null:Boolean(d.is_active),p_reason:str(body.reason)});if(r.error)throw r.error;return r.data;
   }
   if(op==='deactivate'){
     if(!isUuid(body.id))throw new Error('user id required');
     if(str(body.confirmation)!=='تأیید نهایی غیرفعال‌سازی کاربر')throw new Error('Final confirmation phrase is required.');
     const r=await sb.rpc('owner_manage_profile',{p_user_id:body.id,p_role:null,p_client_id:null,p_full_name:null,p_phone:null,p_is_active:false,p_reason:str(body.reason)});
     if(r.error)throw r.error;return r.data;
   }
   throw new Error('User deletion is intentionally soft-deactivation only.');
 }
 if(resource==='case_status_override'){
   if(!isUuid(body.id)||!str(body.new_status)||!str(body.reason))throw new Error('case id, status and reason are required');
   if(str(body.confirmation)!=='تأیید نهایی اصلاح وضعیت')throw new Error('Final confirmation phrase is required.');
   const r=await sb.rpc('owner_override_case_status',{p_case_id:body.id,p_new_status:body.new_status,p_reason:str(body.reason)});
   if(r.error)throw r.error;return r.data;
 }
 if(resource==='case_delete'){
   if(!isUuid(body.id)||str(body.confirmation)!=='تأیید نهایی حذف پرونده')throw new Error('Final confirmation phrase is required');
   const r=await sb.rpc('owner_delete_case',{p_case_id:body.id,p_reason:str(body.reason),p_confirmation:str(body.confirmation)});
   if(r.error)throw r.error;return r.data;
 }
 if(resource==='document_archive'){
   if(!isUuid(body.id))throw new Error('document id required');
   if(str(body.confirmation)!=='تأیید نهایی Archive سند')throw new Error('Final confirmation phrase is required.');
   const r=await sb.rpc('owner_archive_document',{p_document_id:body.id,p_reason:str(body.reason)});
   if(r.error)throw r.error;return r.data;
 }
 if(resource==='voucher_void'){
   if(!isUuid(body.id)||str(body.confirmation)!=='تأیید نهایی ابطال ردیف سند')throw new Error('Final confirmation phrase is required');
   const r=await sb.rpc('owner_void_customs_voucher_line',{p_line_id:body.id,p_reason:str(body.reason),p_confirmation:str(body.confirmation)});
   if(r.error)throw r.error;return r.data;
 }

 const cfg=RESOURCES[resource];if(!cfg)throw new Error('Unknown resource');
 if(cfg.immutable)throw new Error('این منبع غیرقابل‌ویرایش است.');
 if(op==='list')return await listRows(sb,profile,resource,body);

 if(op==='delete'){
   if(cfg.archive)throw new Error('Documents must use document_archive; physical delete is not permitted.');
   if(resource==='cases')throw new Error('Cases must use case_delete; generic delete is not permitted.');
   if(resource==='profiles')throw new Error('Profiles use owner-managed deactivation; physical delete is not permitted.');
   if(!str(body.reason))throw new Error('دلیل حذف الزامی است.');
   if(str(body.confirmation)!=='تأیید نهایی عملیات')throw new Error('Final confirmation phrase is required.');
 }
 if(op==='update'&&['org_settings','finance_settings','ai_gateway'].includes(resource)){
   const d=allowedData(body.data);
   if(resource==='org_settings'){
     d.organization_id=profile.organization_id; d.updated_by=user.id; d.updated_at=new Date().toISOString();
     const r=await sb.from('organization_settings').upsert(d,{onConflict:'organization_id'}).select('*').single();if(r.error)throw r.error;return r.data;
   }
   if(resource==='finance_settings'){
     d.organization_id=profile.organization_id;
     const r=await sb.from('finance_org_settings').upsert(d,{onConflict:'organization_id'}).select('*').single();if(r.error)throw r.error;return r.data;
   }
   d.organization_id=profile.organization_id; d.updated_by=user.id; d.updated_at=new Date().toISOString();
   const r=await sb.from('ai_gateway_settings').upsert(d,{onConflict:'organization_id'}).select('*').single();if(r.error)throw r.error;return r.data;
 }
 const d=allowedData(body.data);
 if(resource==='cases'&&op==='update')delete d.status;
 if(op==='create'){
   if(cfg.table==='organizations')d.id=profile.organization_id;
   else if(!cfg.global&&cfg.table!=='user_settings')d.organization_id=profile.organization_id;
   if(cfg.table!=='user_settings'&&('created_by' in (body.data||{})||resource==='costs'||resource==='payments'||resource==='payment_requests'||resource==='invoices'))d.created_by=user.id;
   if('updated_by' in (body.data||{})||resource==='costs'||resource==='payment_requests'||resource==='invoices')d.updated_by=user.id;
   if(cfg.table==='user_settings')d.user_id=isUuid(d.user_id)?d.user_id:user.id;
   const r=await sb.from(cfg.table).insert(d).select('*').single();if(r.error)throw r.error;return r.data;
 }
 if(op==='update'){
   if(!isUuid(body.id))throw new Error('record id required');
   if(!Object.keys(d).length)throw new Error('No editable fields supplied');
   if(resource==='organizations')return await updateOrg(sb,profile.organization_id,d);
   if('updated_by' in (body.data||{})||resource==='costs'||resource==='payment_requests'||resource==='invoices')d.updated_by=user.id;
   const r=cfg.global ? await sb.from(cfg.table).update(d).eq('id',body.id).select('*').single() : await sb.from(cfg.table).update(d).eq('id',body.id).eq('organization_id',profile.organization_id).select('*').single();
   if(r.error)throw r.error;return r.data;
 }
 if(op==='delete'){
   if(!isUuid(body.id))throw new Error('record id required');
   const r=cfg.global ? await sb.from(cfg.table).delete().eq('id',body.id) : await sb.from(cfg.table).delete().eq('id',body.id).eq('organization_id',profile.organization_id);
   if(r.error)throw r.error;return {deleted:true,id:body.id};
 }
 throw new Error('Unsupported operation');
}

async function updateOrg(sb:any,org:string,d:any){
 const r=await sb.from('organizations').update(d).eq('id',org).select('*').single();
 if(r.error)throw r.error;return r.data;
}

Deno.serve(async(req)=>{
 const origin=req.headers.get('Origin')||'';
 if(req.method==='OPTIONS')return new Response('ok',{status:204,headers:cors(origin,req.headers.get('Access-Control-Request-Headers'),req.headers.get('Access-Control-Request-Method'))});
 if(req.method!=='POST')return out({error:'Method not allowed'},405,origin);
 try{
  const ctx=await authContext(req);
  const body=await req.json().catch(()=>({}));
  const action=str(body.action||body.op||'list');
  if(action==='list'||action==='create'||action==='update'||action==='delete'||action==='save'||action==='deactivate')
    return out(await write(ctx,body),200,origin);
  throw new Error('Unsupported operation');
 }catch(e){
  const msg=e instanceof Error?e.message:String(e);
  const code=/Unauthorized|Owner access required/i.test(msg)?403:400;
  return out({error:msg},code,origin);
 }
});
