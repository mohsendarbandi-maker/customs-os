import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

class MockStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly tokenHash: string,
    private readonly sessionRow: Record<string, unknown>,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes('FROM customs_admin_sessions') && this.values[0] === this.tokenHash) {
      return this.sessionRow as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }

  async run() {
    return { meta: { changes: 0 } };
  }
}

const tokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const vesselHtml = [
  '<html><body><h1>TEST VESSEL</h1>',
  '<p>IMO / MMSI 1234567 / 123456789</p>',
  '<p>Latitude: 31.1234 Longitude: 50.5678</p>',
  '</body></html>',
].join('');

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/functions/v1/vessel-multi-source';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staging Worker vessel multi-source route', () => {
  it('rejects requests without an active D1 session cookie', async () => {
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ imo: '1234567' }),
    });
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('DB should not be queried without a cookie'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('rejects cross-origin requests before session lookup', async () => {
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ imo: '1234567' }),
    });
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('DB should not be queried for cross-origin requests'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'ORIGIN_FORBIDDEN' });
  });

  it('serves the same-origin lookup only after verifying the D1 session', async () => {
    const token = 'unit-test-session-token';
    const hash = await tokenHash(token);
    const now = new Date();
    const row = {
      user_id: 'owner-cloudflare-staging',
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
      session_id: 'd2507307-3f99-4af9-8c8b-6b92f89f7b57',
      revoked_at: null,
    };
    const db = {
      prepare: (sql: string) => new MockStatement(sql, hash, row),
    };
    const env = { MIGRATION_DB: db } as unknown as Parameters<typeof migrationWorker.fetch>[1];
    const fetchMock = vi.fn(async () => new Response(vesselHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        cookie: 'customs_os_stage_session=' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ imo: '1234567' }),
    });

    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as {
      imo: string;
      selected: { sourceCount: number } | null;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(payload.imo).toBe('1234567');
    expect(payload.selected?.sourceCount).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
