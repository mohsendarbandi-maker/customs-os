import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

function readMigration(name: string) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

function readAllMigrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readMigration(name) }));
}

describe('STATIC TESTS -- Database Invariant Verification', () => {
  const migrations = readAllMigrations();
  const migrationFiles = migrations.map(({ name }) => name);
  const allSql = migrations.map(({ sql }) => sql).join('\n');

  it('contains the canonical foundation migrations and later production migrations', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(20);
    for (const name of [
      '00001_extensions.sql',
      '00002_enums.sql',
      '00003_auth_foundation.sql',
      '00004_reference_data.sql',
      '00005_core_entities.sql',
      '00006_finance_documents.sql',
      '00007_audit_logs.sql',
      '00008_indexes.sql',
      '00009_rls.sql',
      '00010_triggers.sql',
    ]) {
      expect(migrationFiles).toContain(name);
    }
  });

  it('enforces exact decimal base amount calculation in finance', () => {
    const finSql = readMigration('00006_finance_documents.sql');
    expect(finSql).toContain('chk_base_amount_irr_calc');
    expect(finSql).toContain('base_amount_irr = ROUND(original_amount * exchange_rate, 2)');
  });

  it('enforces client scoping invariants on profiles and core entities', () => {
    const authSql = readMigration('00003_auth_foundation.sql');
    expect(authSql).toContain('chk_profile_client_role');
    expect(authSql).toContain('auth.user_client_id()');

    const rlsSql = readMigration('00009_rls.sql');
    expect(rlsSql).toContain("auth.user_role() <> 'client'");
    expect(rlsSql).toContain('client_id = auth.user_client_id()');
  });

  it('enforces last owner protection in profile trigger', () => {
    const triggerSql = readMigration('00010_triggers.sql');
    expect(triggerSql).toContain('Cannot demote or deactivate the last active owner in the organization');
  });

  it('prohibits application deletion of organizations and profiles', () => {
    const triggerSql = readMigration('00010_triggers.sql');
    expect(triggerSql).toContain('tr_profile_no_delete');
    expect(triggerSql).toContain('tr_org_no_delete');
  });

  it('enforces broker role validation on cases table', () => {
    const triggerSql = readMigration('00010_triggers.sql');
    expect(triggerSql).toContain('validate_case_assigned_broker');
    expect(triggerSql).toContain('tr_case_broker_validate');
  });

  it('verifies immutability guards on audit logs and status history', () => {
    const triggerSql = readMigration('00010_triggers.sql');
    expect(triggerSql).toContain('tr_audit_immutable');
    expect(triggerSql).toContain('tr_status_history_immutable');
  });

  it('verifies release migration history is present in the repository', () => {
    const requiredHistoryFiles = [
      '20260913182750_phase8_case_stage_gate.sql',
      '20260913182759_phase9_case_completion_readiness.sql',
      '20260913182808_phase10_integrity_checks.sql',
      '20260913182815_phase11_production_security_hardening.sql',
      '20260913184205_phase12_security_advisor_cleanup.sql',
    ];

    for (const name of requiredHistoryFiles) {
      expect(migrationFiles).toContain(name);
    }

    // History reconciliation files may intentionally contain comments only.
    // Semantic verification belongs across the complete local migration set.
    expect(allSql).toContain('advance_case_stage');
    expect(allSql).toContain('get_case_completion_readiness');
    expect(allSql).toContain('get_customs_os_integrity_report');
    expect(allSql).toContain('case_operational_readiness');
    expect(allSql).toContain('SET search_path = public, pg_temp');
    expect(allSql).toContain('security_invoker = true');
  });

  it('contains the durable offline queue and binds replay to the authenticated user', () => {
    const queueSql = fs.readFileSync(path.resolve(__dirname, '../src/lib/offlineQueue.ts'), 'utf8');
    expect(queueSql).toContain("const DB_NAME = 'customs-os-offline'");
    expect(queueSql).toContain("const STORE_NAME = 'rpc_queue'");
    expect(queueSql).toContain('indexedDB.open');
    expect(queueSql).toContain('window.addEventListener(\'online\'');
    expect(queueSql).toContain('attachSupabaseClient');
    expect(queueSql).toContain('OFFLINE_QUEUEABLE_RPCS');
    expect(queueSql).toContain('currentUserId');
    expect(queueSql).toContain('userId');
    expect(queueSql).toContain('attach_registration_order');
    expect(queueSql).toContain('update_case_operational_data');
    expect(queueSql).not.toContain("'create_case_workflow'");
    expect(queueSql).not.toContain("'set_shipment_tracking_status'");
  });

  it('verifies security controls remain present across the repository', () => {
    expect(allSql).toContain('case_status_history');
    expect(allSql).toContain('REVOKE');
    expect(allSql).toContain('SET search_path = public, pg_temp');
  });
});
