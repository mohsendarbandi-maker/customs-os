import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/supabase.ts'), 'utf8');
describe('authenticated REST read cache', () => {
  it('caches only GET PostgREST JSON and excludes auth, chat, files and sensitive records', () => {
    expect(source).toContain("request.method !== 'GET'");
    expect(source).toContain("url.pathname.startsWith('/rest/v1/')");
    expect(source).toContain("table === 'rpc'");
    expect(source).toContain('profiles|chat(?:_|$)|chat_|documents?');
    expect(source).toContain('MAX_CACHED_REST_BODY_CHARS');
  });
  it('partitions cache by the current user and organization and validates the active bearer token', () => {
    expect(source).toContain("'auth-profile'");
    expect(source).toContain('saveOfflineQueryCache(\'rest-get:\' + namespace, userId, organizationId, payload)');
    expect(source).toContain("request.headers.get('authorization') !== 'Bearer ' + scope.accessToken");
  });
  it('returns cached JSON immediately and refreshes it in the background', () => {
    expect(source).toContain("headers.set('X-Customs-OS-Read-Cache', 'HIT')");
    expect(source).toContain('void nativeFetch(input, init)');
    expect(source).toContain('global: { fetch: cachedRestFetch }');
  });
});
