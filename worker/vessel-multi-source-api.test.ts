import { describe, expect, it, vi } from 'vitest';
import { handleVesselMultiSourceLookup } from './vessel-multi-source-api';

const vesselHtml = [
  '<html><head><title>TEST VESSEL - Details</title></head><body>',
  '<h1>TEST VESSEL</h1>',
  '<p>IMO / MMSI 1234567 / 123456789</p>',
  '<p>Latitude: 31.1234 Longitude: 50.5678</p>',
  '<p>Speed: 12 Knots Course: 90°</p>',
  '<p>Last Position Update: 2026-11-23 18:00</p>',
  '</body></html>',
].join('');

const requestFor = (body: unknown) => new Request(
  'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/functions/v1/vessel-multi-source',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  },
);

const responseFetch = (
  html: string,
  failedHosts: string[] = [],
) => vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (failedHosts.includes(url.hostname)) {
    return new Response('provider unavailable', { status: 503 });
  }
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

describe('Cloudflare vessel multi-source lookup', () => {
  it('rejects malformed IMO values before contacting external sources', async () => {
    const fetchMock = responseFetch(vesselHtml);
    const response = await handleVesselMultiSourceLookup(requestFor({ imo: '12345' }), fetchMock);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'IMO باید ۷ رقم باشد' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('collects four provider results and builds a cross-source coordinate consensus', async () => {
    const fetchMock = responseFetch(vesselHtml);
    const response = await handleVesselMultiSourceLookup(requestFor({ imo: 'IMO 1234567' }), fetchMock);
    const payload = await response.json() as {
      imo: string;
      mmsi: string | null;
      name: string | null;
      sources: Array<{ source: string; ok: boolean; lat?: number | null; lon?: number | null }>;
      selected: { lat: number; lon: number; sourceCount: number; confidence: string } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.imo).toBe('1234567');
    expect(payload.mmsi).toBe('123456789');
    expect(payload.name).toBe('TEST VESSEL');
    expect(payload.sources).toHaveLength(4);
    expect(payload.sources.every((source) => source.ok)).toBe(true);
    expect(payload.selected).toMatchObject({
      lat: 31.1234,
      lon: 50.5678,
      sourceCount: 4,
      confidence: 'cross-source',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps provider failures isolated while using valid source positions', async () => {
    const fetchMock = responseFetch(vesselHtml, ['www.myshiptracking.com']);
    const response = await handleVesselMultiSourceLookup(requestFor({ imo: '1234567' }), fetchMock);
    const payload = await response.json() as {
      sources: Array<{ source: string; ok: boolean; error?: string }>;
      selected: { sourceCount: number; confidence: string } | null;
    };

    const failed = payload.sources.find((source) => source.source === 'MyShipTracking');
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toContain('HTTP 503');
    expect(payload.selected).toMatchObject({ sourceCount: 3, confidence: 'cross-source' });
  });

  it('returns selected=null when no provider supplies valid coordinates', async () => {
    const fetchMock = responseFetch('<html><body>Vessel record without a recent position</body></html>');
    const response = await handleVesselMultiSourceLookup(requestFor({ imo: '1234567' }), fetchMock);
    const payload = await response.json() as { selected: unknown; sources: Array<{ ok: boolean }> };

    expect(payload.selected).toBeNull();
    expect(payload.sources).toHaveLength(4);
    expect(payload.sources.every((source) => source.ok)).toBe(true);
  });

  it('rejects unsupported HTTP methods', async () => {
    const request = new Request(
      'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/functions/v1/vessel-multi-source',
      { method: 'GET' },
    );
    const response = await handleVesselMultiSourceLookup(request, responseFetch(vesselHtml));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'METHOD_NOT_ALLOWED' });
  });
});
