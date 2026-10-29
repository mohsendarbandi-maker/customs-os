import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
describe('workspace cache persistence', () => {
  it('partitions persisted query snapshots by the authenticated user and organization', () => {
    const cache = read('src/components/QueryCachePersistence.tsx');
    expect(cache).toContain('readOfflineQueryCache<CachedQuerySnapshot>(CACHE_NAMESPACE, user.id, profile!.organization_id)');
    expect(cache).toContain('saveOfflineQueryCache(CACHE_NAMESPACE, user.id, profile.organization_id, snapshot)');
    expect(cache).toContain('activeScope.current !== currentScope');
    expect(cache).toContain('activeScope.current && activeScope.current !== scope');
    expect(cache).toContain('if (previousScope && previousScope !== scope) queryClient.clear()');
    expect(cache).toContain('const [scopeSwitching, setScopeSwitching] = useState(false)');
    expect(cache).toContain('scopeSwitching ||');
    expect(cache).toContain("activeScope.current.split(':', 1)[0] !== user.id");
    expect(cache).toContain('(user && activeUserId !== user.id)');
    expect(cache).not.toContain('if (scope && readyScope !== scope)');
    expect(cache).toContain('queryClient.clear()');
  });
  it('excludes session material, chat bodies, attachments and documents from the general snapshot', () => {
    const cache = read('src/components/QueryCachePersistence.tsx');
    expect(cache).toContain("'token'");
    expect(cache).toContain("'chat'");
    expect(cache).toContain("'attachment'");
    expect(cache).toContain("'document_content'");
    expect(cache).toContain('MAX_SNAPSHOT_BYTES');
  });
  it('restores the cached auth profile before launching the background profile refresh', () => {
    const auth = read('src/context/AuthContext.tsx');
    expect(auth).toContain("'auth-profile'");
    expect(auth).toContain('void fetchProfile(userId)');
    expect(auth).toContain('setLoading(false)');
  });
});
