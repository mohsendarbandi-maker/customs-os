import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261117173000_revoke_legacy_reminder_overload_rpc.sql'),
  'utf8',
);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify-build.yml'), 'utf8');
const remindersPage = fs.readFileSync(path.join(root, 'src/features/reminders/RemindersPage.tsx'), 'utf8');
const quickAdd = fs.readFileSync(path.join(root, 'src/features/reminders/AddReminderButton.tsx'), 'utf8');

describe('legacy reminder overload RPC ACL', () => {
  it('revokes the two legacy positional overloads but keeps JSONB and service-role paths', () => {
    expect(migration).toContain('create_operational_reminder(\n  text, text, timestamptz, text, uuid, uuid\n)');
    expect(migration).toContain('create_operational_reminder(\n  text, text, timestamptz, text, uuid, uuid, text\n)');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });

  it('confirms active reminder UI uses only the role-checked JSONB overload', () => {
    expect(remindersPage).toContain("rpcWithOfflineQueue('create_operational_reminder',{p_payload:payload})");
    expect(quickAdd).toContain("supabase.rpc('create_operational_reminder',{p_payload:");
    expect(remindersPage).not.toMatch(/rpc\(['"]create_operational_reminder['"],\s*\{\s*p_title/);
  });

  it('runs isolated PostgreSQL overload ACL and JSONB compatibility tests in CI', () => {
    expect(workflow).toContain('supabase/tests/fixtures/legacy_reminder_rpc_acl_fixture.sql');
    expect(workflow).toContain('supabase/tests/20261117_legacy_reminder_rpc_acl.test.sql');
  });
});
