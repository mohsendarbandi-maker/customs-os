import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const legacyMigrationsDir = path.resolve(__dirname, '../supabase/legacy-migrations');

function migrationFilePath(name: string) {
  const primary = path.join(migrationsDir, name);
  if (fs.existsSync(primary)) return primary;
  const legacy = path.join(legacyMigrationsDir, name);
  if (fs.existsSync(legacy)) return legacy;
  throw new Error(`Migration file not found: ${name}`);
}
function readMigration(name: string) { return fs.readFileSync(migrationFilePath(name), 'utf8'); }
function readAllMigrations() {
  const names = new Set<string>();
  for (const dir of [migrationsDir, legacyMigrationsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.sql')) names.add(name);
  }
  return [...names].sort().map((name) => ({ name, sql: readMigration(name) }));
}

describe('STATIC TESTS -- Database Invariant Verification', () => {
  const migrations = readAllMigrations();
  const migrationFiles = migrations.map(({ name }) => name);
  const allSql = migrations.map(({ sql }) => sql).join('\n');

  it('contains the canonical foundation migrations and later production migrations', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(26);
    for (const name of ['00001_extensions.sql','00002_enums.sql','00003_auth_foundation.sql','00004_reference_data.sql','00005_core_entities.sql','00006_finance_documents.sql','00007_audit_logs.sql','00008_indexes.sql','00009_rls.sql','00010_triggers.sql']) expect(migrationFiles).toContain(name);
  });
  it('enforces exact decimal base amount calculation in finance', () => {
    const finSql = readMigration('00006_finance_documents.sql');
    expect(finSql).toContain('chk_base_amount_irr_calc'); expect(finSql).toContain('base_amount_irr = ROUND(original_amount * exchange_rate, 2)');
    const financeUi=fs.readFileSync(path.resolve(__dirname, '../src/pages/FinancePage.tsx'), 'utf8'); const financeUtil=fs.readFileSync(path.resolve(__dirname, '../src/lib/finance.ts'), 'utf8');
    expect(financeUi).toContain("Math.round(amount*rate*100)/100"); expect(financeUi).toContain("paid_by==='our_company'"); expect(financeUtil).toContain('formatCurrency');
  });
  it('enforces client scoping invariants on profiles and core entities', () => {
    const authSql = readMigration('00003_auth_foundation.sql'); const rlsSql = readMigration('00009_rls.sql');
    expect(authSql).toContain('chk_profile_client_role'); expect(authSql).toContain('auth.user_client_id()');
    expect(rlsSql).toContain("auth.user_role() <> 'client'"); expect(rlsSql).toContain('client_id = auth.user_client_id()');
  });
  it('enforces last owner protection in profile trigger', () => expect(readMigration('00010_triggers.sql')).toContain('Cannot demote or deactivate the last active owner in the organization'));
  it('prohibits application deletion of organizations and profiles', () => { const sql=readMigration('00010_triggers.sql'); expect(sql).toContain('tr_profile_no_delete'); expect(sql).toContain('tr_org_no_delete'); });
  it('enforces broker role validation on cases table', () => { const sql=readMigration('00010_triggers.sql'); expect(sql).toContain('validate_case_assigned_broker'); expect(sql).toContain('tr_case_broker_validate'); });
  it('verifies immutability guards on audit logs and status history', () => { const sql=readMigration('00010_triggers.sql'); expect(sql).toContain('tr_audit_immutable'); expect(sql).toContain('tr_status_history_immutable'); });
  it('verifies release migration history and workflow integrity', () => {
    for (const name of ['20260913182750_phase8_case_stage_gate.sql','20260913182759_phase9_case_completion_readiness.sql','20260913182808_phase10_integrity_checks.sql','20260913182815_phase11_production_security_hardening.sql','20260913184205_phase12_security_advisor_cleanup.sql','00021_phase13_workflow_integrity_and_credential_boundary.sql','00022_phase14_maritime_rpc_compatibility.sql','00023_phase15_exit_stage_integrity.sql','00024_stage_transition_and_registration_integrity.sql','00025_lock_trigger_function_execute.sql','00026_completion_requires_release.sql']) expect(migrationFiles).toContain(name);
    const phase13=readMigration('00021_phase13_workflow_integrity_and_credential_boundary.sql'); expect(phase13).toContain('advance_case_stage'); expect(phase13).toContain('get_case_completion_readiness'); expect(phase13).toContain('get_customs_os_integrity_report'); expect(phase13).toContain('security_invoker=true'); expect(phase13).toContain('password_configured boolean'); expect(phase13).not.toContain('vault.decrypted_secrets');
    const phase14=readMigration('00022_phase14_maritime_rpc_compatibility.sql'); expect(phase14).toContain('p_client_id uuid DEFAULT NULL'); expect(phase14).toContain('Client not found or access denied');
    const phase15=readMigration('00023_phase15_exit_stage_integrity.sql'); expect(phase15).toContain('Archived case cannot change exit status'); expect(phase15).toContain('Final cargo exit requires exit-permit stage');
    const phase24=readMigration('00024_stage_transition_and_registration_integrity.sql'); expect(phase24).toContain('Organization mismatch'); expect(phase24).toContain('tr_registration_order_tenant_client'); expect(phase24).toContain('انتقال مرحله غیرمجاز است'); expect(phase24).toContain("WHEN 'kottaj_received' THEN p_target_status IN ('path_green','path_yellow','path_red')"); expect(phase24).toContain("WHEN 'completed' THEN p_target_status = 'archived'");
    expect(readMigration('00025_lock_trigger_function_execute.sql')).toContain('REVOKE ALL ON FUNCTION public.registration_order_set_tenant_and_case_client() FROM PUBLIC, anon, authenticated');
    const phase26=readMigration('00026_completion_requires_release.sql'); expect(phase26).toContain('release_status'); expect(phase26).toContain("<> 'released'"); expect(phase26).toContain('Gross weight'); expect(allSql).toContain('SET search_path = public, pg_temp'); expect(allSql).toContain('REVOKE');
  });
  it('verifies Operations preserves registration-order ownership and exact shipment linking', () => { const ui=fs.readFileSync(path.resolve(__dirname,'../src/pages/OperationsPage.tsx'),'utf8'); expect(ui).toContain("select('id,client_id,case_id,order_number"); expect(ui).toContain('client_id:clientId'); expect(ui).toContain('const s=shipments.find(x=>x.case_id===id);'); });
  it('prevents browser-side EPL password retrieval or printing', () => { const clientUi=fs.readFileSync(path.resolve(__dirname,'../src/pages/ClientRegistryPage.tsx'),'utf8'); const printUi=fs.readFileSync(path.resolve(__dirname,'../src/pages/DeclarationPrintPage.tsx'),'utf8'); expect(clientUi).not.toContain('vault.decrypted_secrets'); expect(clientUi).not.toContain('save_client_epl_credentials'); expect(clientUi).not.toContain('get_client_epl_credentials'); expect(clientUi).not.toContain('eplPassword'); expect(printUi).not.toContain('vault.decrypted_secrets'); expect(printUi).not.toContain('eplPassword'); expect(printUi).toContain('password_configured'); });
  it('contains the durable offline queue and binds replay to the authenticated user', () => { const q=fs.readFileSync(path.resolve(__dirname,'../src/lib/offlineQueue.ts'),'utf8'); expect(q).toContain("const DB_NAME = 'customs-os-offline'"); expect(q).toContain("const STORE_NAME = 'rpc_queue'"); expect(q).toContain('indexedDB.open'); expect(q).toContain("window.addEventListener('online'"); expect(q).toContain('attachSupabaseClient'); expect(q).toContain('OFFLINE_QUEUEABLE_RPCS'); expect(q).toContain('currentUserId'); expect(q).toContain('userId'); expect(q).toContain('attach_registration_order'); expect(q).toContain('update_case_operational_data'); expect(q).toContain('create_operational_reminder'); expect(q).not.toContain(" 'create_case_workflow'"); expect(q).not.toContain("'set_shipment_tracking_status'"); });
  it('verifies security controls remain present across the repository', () => { expect(allSql).toContain('case_status_history'); expect(allSql).toContain('REVOKE'); expect(allSql).toContain('SET search_path = public, pg_temp'); });
  it('verifies reminder migration RLS and idempotency',()=>{const m=readMigration('20261002010000_reminders_full_model.sql');expect(m).toContain('create table if not exists public.push_subscriptions');expect(m).toContain('create table if not exists public.reminder_deliveries');expect(m).toContain("public.user_role()<>'client'");expect(m).toContain('on conflict(created_by,client_uuid)');expect(m).toContain('for update');expect(m).toContain('skip locked');});
});
