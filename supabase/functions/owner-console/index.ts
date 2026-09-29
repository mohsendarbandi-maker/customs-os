async function listRows(sb:any,profile:any,resource:string,body:any){
async function write(ctx:any,body:any){
 const {sb,user,profile}=ctx;
 const resource=str(body.resource), op=str(body.action||body.op);

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
   const r=cfg.global
     ? await sb.from(cfg.table).update(d).eq('id',body.id).select('*').single()
     : await sb.from(cfg.table).update(d).eq('id',body.id).eq('organization_id',profile.organization_id).select('*').single();
   if(r.error)throw r.error;return r.data;
 }
 if(op==='delete'){
   if(!isUuid(body.id))throw new Error('record id required');
   if(cfg.global)throw new Error('Global reference records cannot be physically deleted from Owner Console.');
   const r=await sb.from(cfg.table).delete().eq('id',body.id).eq('organization_id',profile.organization_id);
   if(r.error)throw r.error;return {deleted:true,id:body.id};
 }
 throw new Error('Unsupported operation');
}

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
