import{describe,expect,it}from'vitest';
import{readFileSync}from'node:fs';

const operator=readFileSync(new URL('../supabase/functions/ai-operator/index.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const advanced=readFileSync(new URL('../src/pages/AdvancedSettingsPage.tsx',import.meta.url),'utf8');
const migrationPath=(name:string)=>{const primary=new URL('../supabase/migrations/'+name,import.meta.url);const legacy=new URL('../supabase/legacy-migrations/'+name,import.meta.url);return readFileExists(primary)?primary:legacy};
const readFileExists=(url:URL)=>{try{readFileSync(url);return true}catch{return false}};
const migration=readFileSync(migrationPath('20260929160000_ai_operator_and_advanced_settings.sql'),'utf8');
const ledgerMigration=readFileSync(migrationPath('20260929170000_ai_operator_command_ledger_immutable.sql'),'utf8');
const ownerProfileMigration=readFileSync(migrationPath('20260929200000_harden_owner_profile_auth_user.sql'),'utf8');

describe('AI Operator security invariants',()=>{
 it('never references a service-role secret or raw SQL execution',()=>{
   expect(operator).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS|supabase_secret|auth\.admin\./i);
   expect(operator).not.toMatch(/['\"](database_reset|drop_table|truncate_table|bulk_delete)['\"]/i);
 });
 it('requires the caller Authorization JWT and uses the anon key client',()=>{
   expect(operator).toContain("req.headers.get('Authorization')");
   expect(operator).toContain("createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}}})");
   expect(operator).toContain("sb.auth.getUser(jwt)");
 });
 it('redacts online planner context and keeps attachment content out of prompts',()=>{
   expect(operator).toContain('g.redaction_enabled===false?cleanText(query):redact(query)');
   expect(operator).toContain('safePage=redact(cleanText(page,1600))');
   expect(operator).toContain('attachmentMeta');
   expect(operator).toContain('safeAttachment');
   expect(operator).toContain('Live database evidence');
   expect(operator).toContain('action_code assistant.answer');
   expect(operator).toContain('Never invent IDs');
   expect(operator).toContain('Return JSON with action_code,module');
 });
 it('has live context and conversational-answer routing',()=>{
   expect(operator).toContain('loadOperatorContext');
   expect(operator).toContain("'assistant.answer'");
   expect(operator).toContain('matched');
 });
 it('has server-derived risk and destructive double confirmation',()=>{
   expect(operator).toContain("effectiveRisk");
   expect(operator).toContain("risk==='destructive'&&!cmd.confirmation_at");
   expect(operator).toContain("final_confirmation");
 });
 it('prevents orphan profiles by requiring an existing Auth user',()=>{
   expect(ownerProfileMigration).toContain('from auth.users u where u.id=p_user_id');
 });
 it('hardens the command ledger against direct updates',()=>{
   expect(ledgerMigration).toContain('revoke update on public.ai_operator_commands');
   expect(ledgerMigration).toContain('ai_operator_transition_command');
   expect(ledgerMigration).toContain('Executed AI Operator command is immutable');
 });
 it('covers all operator modules and owner-only settings enforcement',()=>{
   for(const moduleName of ['cases','maritime','documents','permits','declaration','finance','accounting_vouchers','exit','control','settings'])expect(operator).toContain("module:'"+moduleName+"'");
   expect(operator).toContain("plan.action_code.startsWith('settings.')&&pr.data.role!=='owner'");
   expect(operator).toContain("sb.rpc('owner_update_profile'");
   expect(operator).toContain("sb.rpc('owner_insert_profile'");
   expect(operator).toContain("if(p.action_code==='exit.update'&&str(p.params?.exit_status)==='exited')return'destructive';");
 });
 it('enforces owner-only advanced route and page guard',()=>{
   expect(app).toContain("s==='advanced'&&profile?.role!=='owner'");
   expect(app).toContain("<AdvancedSettingsPage/>");
   expect(advanced).toContain("if(!owner)return");
 });
 it('keeps Audit Log read-only in the advanced UI',()=>{
   expect(advanced).toContain("سوابق / Logs ← فقط خواندنی");
   expect(advanced).not.toContain("from('audit_logs').delete");
 });
 it('supports dynamic, reviewed AI extraction into the active customs form without auto-submitting it',()=>{
   const workspace=readFileSync(new URL('../src/components/AIWorkspace.tsx',import.meta.url),'utf8');
   const assistant=readFileSync(new URL('../supabase/functions/ai-assistant/index.ts',import.meta.url),'utf8');
   expect(workspace).toContain('collectCurrentFormSchema()');
   expect(workspace).toContain("setAttribute('data-ai-form-field',key)");
   expect(workspace).toContain('form_schema:currentFormSchema');
   expect(workspace).toContain("form_fill:true");
   expect(workspace).toContain("current_form_values:currentValues");
   expect(workspace).toContain("setDocResults([{name:'پیشنهاد تکمیل فرم فعلی'");
   expect(assistant).toContain('formFill=!!b.form_fill');
   expect(assistant).toContain('loadOperationalContext(sb,profile.organization_id,selectedShipmentId)');
   expect(assistant).toContain('shipmentQuery.eq(\'id\',selectedShipmentId)');

   expect(workspace).toContain('مقادیر قبلی فرم را هم جایگزین کن');
   expect(workspace).toContain('هیچ فرمی خودکار ثبت یا ارسال نشد');
   expect(workspace).toContain('formPageContext!==pageContext');
   expect(workspace).toContain('current.some((item,index)=>item.key!==formSchema[index]?.key)');
   expect(workspace).not.toMatch(/\.submit\s*\(/);
   expect(assistant).toContain('formSchema=Array.isArray(b.form_schema)');
   expect(assistant).toContain('JSON.stringify(formSchema)');
   expect(workspace).toContain("const option=Array.from(el.options).find(o=>normalize(o.value)===target||normalize(o.textContent||'')===target)");
 });
 it('keeps the assistant bootable and all provider prompts within known limits',()=>{
   const assistant=readFileSync(new URL('../supabase/functions/ai-assistant/index.ts',import.meta.url),'utf8');
   expect(assistant).toContain('checklistRows=checks.data||[]');
   expect(assistant).toContain('const providerKeys=');
   expect(assistant).toContain('const binaryDocumentExtraction=ex&&!!dd');
   expect(assistant).toContain('fetch(signed.signedUrl');
   expect(assistant).toContain("d?.steps?.filter((s:any)=>s?.type==='model_output')");
   expect(assistant).toContain("response_format:{type:'text',mime_type:'application/json',schema:geminiSchema(keys,formSchema)}");
   expect(assistant).toContain('const extractionDeadline=Date.now()+50000');
   expect(assistant).toContain("d?.outputs?.filter((x:any)=>x?.type==='text')");
   expect(assistant).toContain("binaryDocumentExtraction&&p.name!=='Gemini'");
   expect(assistant).toContain("const modelOrder=binaryDocumentExtraction?['gemini-3.5-flash-lite','gemini-3.8-flash']:['gemini-3.8-flash','gemini-3.5-flash-lite']");
   expect(assistant).toContain("v1beta/interactions");
   expect(assistant).toContain("type:'document',data:dd,mime_type:dm");
   expect(assistant).toContain("createSignedUrl(documentStoragePath,600)");
   expect(assistant).toContain("documentSizeBytes<=15*1024*1024");
   expect(assistant).not.toContain('models/gemini-3.5-flash-lite:generateContent');
   expect(operator).toContain('models/gemini-3.8-flash:generateContent');
   expect(operator).toContain('}).slice(0,16000)');
   expect(operator).toContain('cleanText(liveContext,8000)');
   expect(operator).toContain('cleanText(JSON.stringify(catalog()),5000)');
   const workspace=readFileSync(new URL('../src/components/AIWorkspace.tsx',import.meta.url),'utf8');
   expect(workspace).toContain("invokeEdgeFunction('ai-core'");
 });

 it('requires an uploaded bill of lading and successful extraction on the active form before B/L fill',()=>{
   const workspace=readFileSync(new URL('../src/components/AIWorkspace.tsx',import.meta.url),'utf8');
   expect(workspace).toContain('billOfLadingIntent');
   expect(workspace).toContain('hasExtractedForCurrentForm');
   expect(workspace).toContain("bill-of-lading-document-required");
   expect(workspace).toContain("bill-of-lading-extraction-review");
   expect(workspace).toContain('formPageContext===pageContext');
   expect(workspace).toContain('file.size>30*1024*1024');
 });
 it('guards ai-assistant against the duplicate vessels binding that previously prevented boot',()=>{
   const assistant=readFileSync(new URL('../supabase/functions/ai-assistant/index.ts',import.meta.url),'utf8');
   expect(assistant).toContain('vesselResult]=await Promise.all([');
   expect(assistant).toContain('vesselRows=vesselResult.data||[]');
   expect(assistant).toContain('new Map(vesselRows.map((x:any)=>[x.id,x]))');
   expect(assistant).not.toContain('vessels=vessels.data||[]');
 });

 it('supports pre-uploading a complete bill of lading for a new shipment and sends only its stored path to AI',()=>{
   const shipment=readFileSync(new URL('../src/pages/ShipmentFirstPage.tsx',import.meta.url),'utf8');
   const assistant=readFileSync(new URL('../supabase/functions/ai-assistant/index.ts',import.meta.url),'utf8');
   expect(shipment).toContain("supabase.storage.from(BUCKET).upload(path,file");
   expect(shipment).toContain("${profile.organization_id}/staging/${user.id}/");
   expect(shipment).toContain("document_storage_path:document.storagePath");
   expect(shipment).toContain("document_size_bytes:document.sizeBytes");
   expect(shipment).toContain("shipment_extract:true");
   expect(shipment).toContain("shipment_documents').insert");
   expect(shipment).toContain("pdfjsLib.getDocument");
   expect(shipment).toContain("انتخاب به‌عنوان بارنامه");
   expect(shipment).toContain("profile?.role!=='client'&&<section");
   expect(shipment).toContain("همه صفحات همان PDF خوانده می‌شوند");
   expect(assistant).toContain("createSignedUrl(documentStoragePath,600)");
   expect(assistant).toContain("documentStoragePath.startsWith(String(profile.organization_id)+'/')");
   expect(assistant).toContain("v1beta/interactions");
 });
 it('passes the uploaded document size from AIWorkspace so the Edge Function can avoid Base64 re-upload',()=>{
   const workspace=readFileSync(new URL('../src/components/AIWorkspace.tsx',import.meta.url),'utf8');
   expect(workspace).toContain("document_size_bytes:documentSizeBytes||undefined");
   expect(workspace).toContain("currentFormSchema, file.size");
 });

});
