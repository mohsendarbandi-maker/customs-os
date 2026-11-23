import { describe, expect, it, vi } from 'vitest';
import { serveMapTile, type MapTileCache } from './map-tiles-api';

const requestFor = (
  path = '/api/map/tiles/8/145/99.png',
  method: 'GET' | 'HEAD' | 'POST' = 'GET',
  headers: Record<string, string> = {},
) => new Request('https://staging.example' + path, { method, headers });

describe('Cloudflare OpenStreetMap tile proxy', () => {
  it('rejects invalid paths and out-of-range coordinates without contacting the provider', async () => {
    const fetchMock = vi.fn();
    const invalidPaths = [
      '/api/map/tiles/20/0/0.png',
      '/api/map/tiles/4/16/0.png',
      '/api/map/tiles/4/0/16.png',
      '/api/map/tiles/-1/0/0.png',
      '/api/map/tiles/4/0/0.jpg',
      '/api/map/tiles/4/0/0/1.png',
    ];

    for (const path of invalidPaths) {
      const response = await serveMapTile(requestFor(path), fetchMock);
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches one validated PNG tile and forwards a first-party referrer', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=3600',
          etag: '"tile-1"',
        },
      }),
    );

    const response = await serveMapTile(
      requestFor('/api/map/tiles/8/145/99.png', 'GET', {
        referer: 'https://staging.example/marine-conditions',
      }),
      fetchMock,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const [url, init] = fetchMock.mock.calls[0];

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-customs-map-cache')).toBe('MISS');
    expect(response.headers.get('etag')).toBe('"tile-1"');
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(String(url)).toBe('https://tile.openstreetmap.org/8/145/99.png');
    expect(new Headers(init?.headers).get('referer')).toBe('https://staging.example/marine-conditions');
    expect(new Headers(init?.headers).get('user-agent')).toContain('Customs OS');
  });

  it('does not forward an untrusted cross-origin referrer', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    await serveMapTile(
      requestFor('/api/map/tiles/8/145/99.png', 'GET', {
        referer: 'https://attacker.example/page',
      }),
      fetchMock,
    );

    const init = fetchMock.mock.calls[0][1];
    expect(new Headers(init?.headers).get('referer')).toBe('https://staging.example/marine-conditions');
  });

  it('serves cached tiles without a provider request', async () => {
    const cache: MapTileCache = {
      match: vi.fn(async () => new Response(new Uint8Array([7, 8]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
      })),
      put: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn();
    const response = await serveMapTile(requestFor(), fetchMock, cache);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-customs-map-cache')).toBe('HIT');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([7, 8]);
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not return a response body for HEAD requests', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    const response = await serveMapTile(requestFor('/api/map/tiles/8/145/99.png', 'HEAD'), fetchMock);

    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-image upstream responses', async () => {
    const fetchMock = vi.fn(async () => new Response('not an image', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    const response = await serveMapTile(requestFor(), fetchMock);

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('temporarily unavailable');
  });

  it('returns a bounded 503 for upstream errors', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    const response = await serveMapTile(requestFor(), fetchMock);

    expect(response.status).toBe(404);
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('rejects unsupported methods', async () => {
    const fetchMock = vi.fn();
    const response = await serveMapTile(requestFor('/api/map/tiles/8/145/99.png', 'POST'), fetchMock);

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
