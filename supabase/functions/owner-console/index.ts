import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGINS=new Set(['https://darbandicommercial.ir','https://www.darbandicommercial.ir','https://customs-os-psi.vercel.app','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string)=>({'Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:'https://darbandicommercial.ir','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'});
const out=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:cors(origin)});
const str=(v:any)=>String(v??'').trim();
const isUuid=(v:any)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(v));

type Resource={table:string; immutable?:boolean; archive?:boolean; softDelete?:boolean; searchFields?:string[]};
const RESOURCES:Record<string,Resource>={
 cases:{table:'cases'},registration_orders:{table:'registration_orders'},shipments:{table:'shipments'},
 shipping_lines:{table:'shipping_lines'},vessels:{table:'vessels'},contacts:{table:'shipping_line_contacts'},
 shipment_documents:{table:'shipment_documents',archive:true,searchFields:['document_name','original_file_name','storage_path']},customs_documents:{table:'customs_documents',archive:true,searchFields:['original_name','display_name','document_number']},
 document_rules:{table:'document_requirement_rules',searchFields:['rule_name','document_type']},permit_rules:{table:'permit_rules',searchFields:['rule_name','hs_prefix','cargo_keyword','permit_type']},permits:{table:'permits',searchFields:['permit_number','permit_type','issuing_authority']},
 declarations:{table:'customs_declarations',searchFields:['kottaj_number','customs_path','payment_reference']},
 cost_categories:{table:'finance_cost_categories',searchFields:['code','name_fa','name_en','description']},finance_settings:{table:'finance_org_settings'},
 costs:{table:'finance_cost_items',searchFields:['description','notes','internal_notes']},payments:{table:'finance_payments',searchFields:['payment_no','reference_no','bank_name','description']},payment_requests:{table:'finance_payment_requests',searchFields:['request_no','subject','body_text']},
 invoices:{table:'finance_invoices',searchFields:['invoice_no','public_note','internal_note']},invoice_lines:{table:'finance_invoice_lines',searchFields:['description']},invoice_shipments:{table:'finance_invoice_shipments'},
 vouchers:{table:'customs_accounting_vouchers',searchFields:['voucher_number','company_name','cargo_type']},voucher_lines:{table:'voucher_line_items',immutable:true},
 exit:{table:'case_exit_operations',searchFields:['exit_permit_no','vehicle_plate','driver_name']},org:{table:'organizations',searchFields:['name','economic_code']},org_settings:{table:'organization_settings'},
 ai_gateway:{table:'ai_gateway_settings'},templates:{table:'print_templates',searchFields:['template_key','name','document_type']},user_settings:{table:'user_settings'}
};

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
   if(op==='list'){
     let q=sb.from('profiles').select('id,full_name,phone,role,client_id,is_active,created_at,updated_at').eq('organization_id',profile.organization_id).order('full_name').limit(Math.min(Number(body.limit)||300,500));
     const search=str(body.search);if(search){if(isUuid(search))q=q.or('full_name.ilike.%'+search+'%,phone.ilike.%'+search+'%,role.ilike.%'+search+',id.eq.'+search);else q=q.or('full_name.ilike.%'+search+'%,phone.ilike.%'+search+'%,role.ilike.%'+search+'%');}
     const r=await q;if(r.error)throw r.error;return r.data||[];
   }
   if(op==='create'){
     if(!isUuid(body.user_id)||!str(body.full_name))throw new Error('Auth user id و نام کامل لازم است');
     const d=body.data||{};
     const r=await sb.rpc('owner_insert_profile',{p_user_id:body.user_id,p_role:str(d.role)||'client',p_client_id:isUuid(d.client_id)?d.client_id:null,p_full_name:str(body.full_name),p_phone:str(d.phone)||null});if(r.error)throw r.error;return r.data;
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
     const r=await sb.rpc('owner_manage_profile',{p_user_id:body.id,p_role:null,p_client_id:null,p_full_name:null,p_phone:null,p_is_active:false,p_reason:str(body.reason)});if(r.error)throw r.error;return r.data;
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
   const r=await sb.rpc('owner_archive_document',{p_document_id:body.id,p_reason:str(body.reason)});
   if(r.error)throw r.error;return r.data;
 }
 if(resource==='voucher_void'){
   if(!isUuid(body.id)||str(body.confirmation)!=='تأیید نهایی ابطال ردیف سند')throw new Error('Final confirmation phrase is required');
   const r=await sb.rpc('owner_void_customs_voucher_line',{p_line_id:body.id,p_reason:str(body.reason),p_confirmation:str(body.confirmation)});
   if(r.error)throw r.error;return r.data;
 }

 if(resource==='org'&&(op==='create'||op==='delete'))throw new Error('Organization root cannot be created or deleted from Owner Console.');
 const cfg=RESOURCES[resource];if(!cfg)throw new Error('Unknown resource');
 if(cfg.immutable)throw new Error('این منبع غیرقابل‌ویرایش است.');
 if(op==='list')return await listRows(sb,profile,resource,body);

 if(op==='delete'){
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
   else if(cfg.table!=='user_settings')d.organization_id=profile.organization_id;
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
   const r=await sb.from(cfg.table).update(d).eq('id',body.id).eq('organization_id',profile.organization_id).select('*').single();
   if(r.error)throw r.error;return r.data;
 }
 if(op==='delete'){
   if(!isUuid(body.id))throw new Error('record id required');
   const r=await sb.from(cfg.table).delete().eq('id',body.id).eq('organization_id',profile.organization_id);
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
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
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
