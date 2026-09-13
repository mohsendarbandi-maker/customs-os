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

describe('STATIC TESTS -- Database Invariant Verification', () => {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  it('contains the canonical foundation migrations plus later phase migrations', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(20);

    const required = [
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
    ];

    for (const name of required) {
      expect(migrationFiles).toContain(name);
    }

    expect(migrationFiles.some((name) => name.includes('phase4'))).toBe(true);
    expect(migrationFiles.some((name) => name.includes('phase5'))).toBe(true);
    expect(migrationFiles.some((name) => name.includes('phase6'))).toBe(true);
    expect(migrationFiles.some((name) => name.includes('phase7'))).toBe(true);
    expect(migrationFiles.some((name) => name.includes('phase8'))).toBe(true);
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

  it('includes production readiness migrations for stage gating, integrity and security', () => {
    expect(migrationFiles).toContain(
      '20260913182750_phase8_case_stage_gate.sql',
    );
    expect(migrationFiles).toContain(
      '20260913182759_phase9_case_completion_readiness.sql',
    );
    expect(migrationFiles).toContain(
      '20260913182808_phase10_integrity_checks.sql',
    );
    expect(migrationFiles).toContain(
      '20260913182815_phase11_production_security_hardening.sql',
    );
  });
});
