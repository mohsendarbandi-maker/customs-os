import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareCaseSelectorApi } from './cloudflareCaseSelector';
afterEach(() => { vi.unstubAllGlobals(); });
describe('Cloudflare case selector adapter', () => {
  it('loads selector data from the same-origin Worker API without caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, clients: [], vessels: [], shipments: [], declarations: [],
      dataScope: 'authenticated_organization_only', checklistStatus: 'not_migrated',
      checklistCompletionVerified: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await cloudflareCaseSelectorApi.load();
    expect(result.checklistStatus).toBe('not_migrated');
    expect(fetchMock).toHaveBeenCalledWith('/api/case-selector-data', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }));
  });
  it('surfaces non-success Worker responses as a typed API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: 'CASE_SELECTOR_DATA_UNAVAILABLE',
    }), { status: 503, headers: { 'content-type': 'application/json' } })));
    await expect(cloudflareCaseSelectorApi.load()).rejects.toMatchObject({
      name: 'CloudflareCaseSelectorError', code: 'CASE_SELECTOR_DATA_UNAVAILABLE',
    });
  });
});
