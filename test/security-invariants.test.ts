import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('STATIC TESTS -- Database Invariant Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).sort();

  it('contains exactly 10 migration files in strict dependency order', () => {
    expect(migrationFiles.length).toBe(10);
    expect(migrationFiles[0]).toBe('00001_extensions.sql');
    expect(migrationFiles[1]).toBe('00002_enums.sql');
    expect(migrationFiles[2]).toBe('00003_auth_foundation.sql');
    expect(migrationFiles[3]).toBe('00004_reference_data.sql');
    expect(migrationFiles[4]).toBe('00005_core_entities.sql');
    expect(migrationFiles[5]).toBe('00006_finance_documents.sql');
    expect(migrationFiles[6]).toBe('00007_audit_logs.sql');
    expect(migrationFiles[7]).toBe('00008_indexes.sql');
    expect(migrationFiles[8]).toBe('00009_rls.sql');
    expect(migrationFiles[9]).toBe('00010_triggers.sql');
  });

  it('enforces exact decimal base amount calculation in finance', () => {
    const finSql = fs.readFileSync(path.join(migrationsDir, '00006_finance_documents.sql'), 'utf8');
    expect(finSql).toContain('chk_base_amount_irr_calc');
    expect(finSql).toContain('base_amount_irr = ROUND(original_amount * exchange_rate, 2)');
  });

  it('enforces client scoping invariants on profiles and core entities', () => {
    const authSql = fs.readFileSync(path.join(migrationsDir, '00003_auth_foundation.sql'), 'utf8');
    expect(authSql).toContain('chk_profile_client_role');
    expect(authSql).toContain('auth.user_client_id()');

    const rlsSql = fs.readFileSync(path.join(migrationsDir, '00009_rls.sql'), 'utf8');
    expect(rlsSql).toContain('auth.user_role() <> \'client\'');
    expect(rlsSql).toContain('client_id = auth.user_client_id()');
  });

  it('enforces last owner protection in profile trigger', () => {
    const triggerSql = fs.readFileSync(path.join(migrationsDir, '00010_triggers.sql'), 'utf8');
    expect(triggerSql).toContain('Cannot demote or deactivate the last active owner in the organization');
  });

  it('prohibits application deletion of organizations and profiles', () => {
    const triggerSql = fs.readFileSync(path.join(migrationsDir, '00010_triggers.sql'), 'utf8');
    expect(triggerSql).toContain('tr_profile_no_delete');
    expect(triggerSql).toContain('tr_org_no_delete');
  });

  it('enforces broker role validation on cases table', () => {
    const triggerSql = fs.readFileSync(path.join(migrationsDir, '00010_triggers.sql'), 'utf8');
    expect(triggerSql).toContain('validate_case_assigned_broker');
    expect(triggerSql).toContain('tr_case_broker_validate');
  });

  it('verifies immutability guards on audit logs and status history', () => {
    const triggerSql = fs.readFileSync(path.join(migrationsDir, '00010_triggers.sql'), 'utf8');
    expect(triggerSql).toContain('tr_audit_immutable');
    expect(triggerSql).toContain('tr_status_history_immutable');
  });
});
