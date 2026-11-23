import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/api/map/tiles/8/145/99.png';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staging Worker map tile route', () => {
  it('serves same-origin map tiles without requiring a database session', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request(endpoint, {
      method: 'GET',
      headers: {
        'sec-fetch-site': 'same-origin',
        referer: origin + '/marine-conditions',
      },
    });
    const response = await migrationWorker.fetch(request, {} as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks cross-site attempts to use the map endpoint as a proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request(endpoint, {
      method: 'GET',
      headers: {
        'sec-fetch-site': 'cross-site',
        referer: 'https://attacker.example/',
      },
    });
    const response = await migrationWorker.fetch(request, {} as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORIGIN_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
