import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261117171500_revoke_direct_case_alert_sync.sql'),
  'utf8',
);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify-build.yml'), 'utf8');

describe('case alert sync RPC ACL', () => {
  it('removes direct authenticated/anonymous execution and preserves service role', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.sync_case_alert_reminders(uuid)');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });

  it('runs PostgreSQL privilege and service-role contract tests in CI', () => {
    expect(workflow).toContain('supabase/tests/fixtures/case_alert_sync_acl_fixture.sql');
    expect(workflow).toContain('supabase/tests/20261117_case_alert_sync_acl.test.sql');
  });
});
