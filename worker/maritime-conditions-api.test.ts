import { describe, expect, it, vi } from 'vitest';
import { handleMaritimeConditions } from './maritime-conditions-api';

const weather = {
  current: { temperature_2m: 17, wind_speed_10m: 12, weather_code: 2 },
  current_units: { temperature_2m: '°C' },
  hourly: { precipitation_probability: [10, 20] },
  hourly_units: { precipitation_probability: '%' },
  timezone: 'Asia/Tehran',
};
const marine = {
  current: { wave_height: 0.4, wave_period: 3.2, ocean_current_velocity: 0.1 },
  current_units: { wave_height: 'm' },
  hourly: { wave_height: [0.4, 0.5], sea_level_height_msl: [0.1, 0.2] },
  hourly_units: { wave_height: 'm' },
  timezone: 'Asia/Tehran',
};

const requestFor = (query = '?latitude=37.47&longitude=49.46') => new Request(
  'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/api/maritime/conditions' + query,
);

describe('Cloudflare maritime conditions', () => {
  it('rejects invalid coordinates before external requests', async () => {
    const fetchMock = vi.fn();
    const response = await handleMaritimeConditions(
      requestFor('?latitude=999&longitude=49.46'),
      fetchMock,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'مختصات جغرافیایی معتبر نیست.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries Open-Meteo weather and marine APIs in parallel and preserves the page response contract', async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      const payload = url.hostname === 'api.open-meteo.com' ? weather : marine;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const response = await handleMaritimeConditions(
      requestFor('?latitude=37.4704&longitude=49.4597'),
      fetchMock,
    );
    const payload = await response.json() as {
      success: boolean;
      partial: boolean;
      location: { latitude: number; longitude: number };
      weather: { current: { temperature_2m: number } };
      marine: { current: { wave_height: number } };
      warnings: string[];
      sources: string[];
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      partial: false,
      location: { latitude: 37.47, longitude: 49.46 },
      weather: { current: { temperature_2m: 17 } },
      marine: { current: { wave_height: 0.4 } },
      warnings: [],
    });
    expect(payload.sources).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls.map((url) => url.hostname).sort()).toEqual([
      'api.open-meteo.com',
      'marine-api.open-meteo.com',
    ]);
    expect(urls.every((url) => url.searchParams.get('latitude') === '37.470')).toBe(true);
    expect(response.headers.get('cache-control')).toContain('max-age=120');
  });

  it('returns partial data when only one public source responds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'marine-api.open-meteo.com') {
        return new Response('unavailable', { status: 503 });
      }
      return new Response(JSON.stringify(weather), { status: 200 });
    });

    const response = await handleMaritimeConditions(requestFor(), fetchMock);
    const payload = await response.json() as {
      success: boolean;
      partial: boolean;
      weather: unknown;
      marine: unknown;
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.partial).toBe(true);
    expect(payload.weather).not.toBeNull();
    expect(payload.marine).toBeNull();
    expect(payload.warnings).toContain('marine_unavailable');
  });

  it('returns 503 when both public sources are unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const response = await handleMaritimeConditions(requestFor(), fetchMock);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      warnings: ['weather_unavailable', 'marine_unavailable'],
    });
  });

  it('rejects unsupported methods', async () => {
    const request = new Request(
      'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/api/maritime/conditions',
      { method: 'POST' },
    );
    const fetchMock = vi.fn();
    const response = await handleMaritimeConditions(request, fetchMock);

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
