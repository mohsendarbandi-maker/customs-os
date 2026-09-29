import{describe,expect,it}from'vitest';
import{readFileSync}from'node:fs';

const operator=readFileSync(new URL('../supabase/functions/ai-operator/index.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const advanced=readFileSync(new URL('../src/pages/AdvancedSettingsPage.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260929160000_ai_operator_and_advanced_settings.sql',import.meta.url),'utf8');
const ledgerMigration=readFileSync(new URL('../supabase/migrations/20260929170000_ai_operator_command_ledger_immutable.sql',import.meta.url),'utf8');

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
 it('has server-derived risk and destructive double confirmation',()=>{
   expect(operator).toContain("effectiveRisk");
   expect(operator).toContain("risk==='destructive'&&!cmd.confirmation_at");
   expect(operator).toContain("final_confirmation");
 });
 it('contains no reset/drop/bulk destructive action in its action catalog',()=>{
   expect(operator).not.toMatch(/database[_ -]?reset|drop[_ -]?table|truncate|bulk[_ -]?delete/i);
 });
 it('hardens the command ledger against direct updates',()=>{
   expect(ledgerMigration).toContain('revoke update on public.ai_operator_commands');
   expect(ledgerMigration).toContain('ai_operator_transition_command');
   expect(ledgerMigration).toContain('Executed AI Operator command is immutable');
 });
 it('enforces owner-only advanced route and page guard',()=>{
   expect(app).toContain("s==='advanced'&&profile?.role!=='owner'");
   expect(app).toContain("<AdvancedSettingsPage/>");
   expect(advanced).toContain("if(!owner)return");
 });
 it('keeps Audit Log read-only in the advanced UI',()=>{
   expect(advanced).toContain("Audit Log — فقط خواندنی");
   expect(advanced).not.toContain("from('audit_logs').delete");
 });
});
