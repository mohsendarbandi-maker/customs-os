import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014141954_workspace_chat_member_rpc_self_scope.sql'),
  'utf8',
);

describe('chat member helper privacy regression', () => {
  it('only answers membership for the signed-in user', () => {
    expect(migration).toContain('auth.uid() IS NOT NULL');
    expect(migration).toContain('p_user_id = auth.uid()');
    expect(migration).toContain('m.user_id = auth.uid()');
    expect(migration).not.toContain('m.user_id = p_user_id');
  });
});
