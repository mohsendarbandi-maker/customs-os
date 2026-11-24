import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareClientsApi } from './cloudflareClients';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Cloudflare clients frontend adapter', () => {
  it('uses same-origin credentials and the Worker endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, items: [], total: 0, limit: 100, offset: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await cloudflareClientsApi.list({ search: 'دربندی' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/clients?');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
  });

  it('surfaces a dependency conflict rather than claiming deletion succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: 'CLIENT_HAS_DEPENDENCIES', dependencies: { cases: 2 },
    }), { status: 409, headers: { 'content-type': 'application/json' } })));
    await expect(cloudflareClientsApi.remove('client-a')).rejects.toMatchObject({
      code: 'CLIENT_HAS_DEPENDENCIES',
      dependencies: { cases: 2 },
    });
  });
});
