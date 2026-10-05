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
});
