import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const authContext = read('src/context/AuthContext.tsx');
const sessionLifecycle = read('src/components/SessionLifecycle.tsx');
const sessionPanel = read('src/components/SessionManagementPanel.tsx');
const app = read('src/App.tsx');
const migration = read('supabase/migrations/20261031134658_user_device_sessions.sql');

describe('multi-device authentication and session management', () => {
  it('limits ordinary logout to the current browser session', () => {
    const signOutBody = authContext.slice(
      authContext.indexOf('const signOut = useCallback'),
      authContext.indexOf('const refreshProfile', authContext.indexOf('const signOut = useCallback')),
    );

    expect(signOutBody).toContain("supabase.auth.signOut({ scope: 'local' })");
    expect(signOutBody).not.toContain('supabase.auth.signOut()');
    expect(signOutBody).not.toContain("scope: 'global'");
  });

  it('supports a deliberate logout of all other devices without logging out this one', () => {
    expect(sessionPanel).toContain("supabase.auth.signOut({ scope: 'others' })");
    expect(sessionPanel).toContain("from('user_device_sessions')");
    expect(sessionPanel).toContain("rpc('list_my_auth_sessions')");
  });

  it('registers every active session and listens for an individual revoke signal', () => {
    expect(app).toContain('<SessionLifecycle/>');
    expect(sessionLifecycle).toContain("from('user_device_sessions')");
    expect(sessionLifecycle).toContain("table: 'user_device_sessions'");
    expect(sessionLifecycle).toContain('await signOut()');
    expect(sessionLifecycle).toContain('setInterval');
    expect(sessionLifecycle).toContain('revoked_at');
  });

  it('restricts device session data to the authenticated account and prevents reactivation', () => {
    expect(migration).toContain('alter table public.user_device_sessions enable row level security');
    expect(migration).toContain('(select auth.uid()) = user_id');
    expect(migration).toContain('A revoked device session cannot be reactivated');
    expect(migration).toContain('grant execute on function public.list_my_auth_sessions() to authenticated');
  });
});
