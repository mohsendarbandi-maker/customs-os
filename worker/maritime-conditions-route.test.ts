import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/api/maritime/conditions?latitude=37.47&longitude=49.46';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staging Worker maritime conditions route', () => {
  it('serves public Open-Meteo data only to same-origin requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({
        current: { weather_code: 1 },
        timezone: 'Asia/Tehran',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await migrationWorker.fetch(new Request(endpoint, {
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    }), {} as Parameters<typeof migrationWorker.fetch>[1]);

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; weather: unknown; marine: unknown };
    expect(payload.success).toBe(true);
    expect(payload.weather).not.toBeNull();
    expect(payload.marine).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects cross-origin weather requests before provider calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await migrationWorker.fetch(new Request(endpoint, {
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    }), {} as Parameters<typeof migrationWorker.fetch>[1]);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'ORIGIN_FORBIDDEN',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
