import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261117170000_revoke_direct_chat_helper_rpc.sql'),
  'utf8',
);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify-build.yml'), 'utf8');

describe('internal chat helper RPC ACL', () => {
  it('removes direct API execution but keeps trusted backend execution', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.orgs_are_connected(uuid, uuid)');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.chat_connection_allowed_for_conversation(uuid, uuid)');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain("p.prorettype = 'trigger'::regtype");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('runs real PostgreSQL role and nested SECURITY DEFINER contract tests in CI', () => {
    expect(workflow).toContain('supabase/tests/fixtures/chat_internal_helper_acl_fixture.sql');
    expect(workflow).toContain('supabase/tests/20261117_chat_internal_helper_acl.test.sql');
  });
});
