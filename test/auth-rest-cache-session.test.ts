import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/supabase.ts'), 'utf8');

describe('authenticated REST read cache', () => {
  it('uses an Auth event snapshot instead of refreshing or reading a session for every GET', () => {
    const scopeStart = source.indexOf('const getRestCacheScope = async () => {');
    const scopeEnd = source.indexOf('const cacheRestResponse = async (', scopeStart);
    expect(scopeStart).toBeGreaterThanOrEqual(0);
    expect(scopeEnd).toBeGreaterThan(scopeStart);

    const scopeBody = source.slice(scopeStart, scopeEnd);
    expect(scopeBody).not.toContain('auth.getSession');
    expect(scopeBody).toContain('cachedAuthIdentity');
    expect(source).toContain('baseClient.auth.onAuthStateChange((_event, currentSession)');
  });

  it('invalidates organization cache scopes when the active session changes', () => {
    expect(source).toContain('cachedAuthIdentity = currentSession?.user?.id');
    expect(source).toContain('restCacheScopes.clear()');
  });
});
