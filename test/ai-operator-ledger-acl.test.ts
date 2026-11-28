import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(__dirname,'..');
const operator=fs.readFileSync(path.join(root,'supabase/functions/ai-operator/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261117184500_ai_operator_server_owned_ledger.sql'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/verify-build.yml'),'utf8');
const fixture=fs.readFileSync(path.join(root,'supabase/tests/fixtures/ai_operator_ledger_acl_fixture.sql'),'utf8');
const contract=fs.readFileSync(path.join(root,'supabase/tests/20261117_ai_operator_ledger_acl.test.sql'),'utf8');
describe('AI Operator server-owned command ledger',()=>{
 it('isolates privileged writes to the two server RPCs and retains user-scoped business execution',()=>{
  expect(operator).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
  expect(operator).toContain("auditSb.rpc('ai_operator_create_command_trusted'");
  expect(operator).toContain("auditSb.rpc('ai_operator_transition_command_trusted'");
  expect(operator).toContain("sb.auth.getUser(jwt)");
  expect(operator).toContain("execute(sb,user,pr.data.organization_id");
  expect(operator).not.toContain("sb.from('ai_operator_commands').insert");
  expect(operator).not.toContain("sb.rpc('ai_operator_transition_command'");
  expect(operator).not.toContain("execute(auditSb");
 });
 it('revokes browser table writes and client execution of privileged RPCs',()=>{
  expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON public.ai_operator_commands FROM anon, authenticated, service_role');
  expect(migration).toContain('REVOKE ALL ON FUNCTION public.ai_operator_transition_command');
  expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.ai_operator_create_command_trusted');
  expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.ai_operator_transition_command_trusted');
 });
 it('runs PostgreSQL ACL and audit actor contracts in CI',()=>{
  expect(workflow).toContain('supabase/tests/fixtures/ai_operator_ledger_acl_fixture.sql');
  expect(workflow).toContain('supabase/tests/20261117_ai_operator_ledger_acl.test.sql');
  expect(workflow).toContain('deno check --node-modules-dir=auto supabase/functions/ai-operator/index.ts');
  expect(fixture).toContain('CREATE TABLE public.ai_operator_commands');
  expect(contract).toContain('direct insert unexpectedly succeeded');
  expect(contract).toContain('insert audit actor mismatch');
  expect(contract).toContain('update audit actor mismatch');
 });
});
