import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareCasesApi } from './cloudflareCases';
afterEach(() => { vi.unstubAllGlobals(); });
describe('Cloudflare cases API adapter', () => {
  it('uses same-origin credentials for case list requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, items: [], total: 0, limit: 100, offset: 0, searchApplied: false,
      statusFilter: null, dataScope: 'authenticated_organization_only', readOnly: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await cloudflareCasesApi.list({ search: '۱۴۰۵', status: 'documents', limit: 20 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/cases?');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
  });
  it('encodes case identifiers before detail lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, case: { id: 'case/a' }, shipments: [], declarations: [], documents: [],
      readOnly: true, workflowReadiness: 'not_included', stageTransitions: 'not_supported',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await cloudflareCasesApi.get('case/a');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cases/case%2Fa');
  });
});
