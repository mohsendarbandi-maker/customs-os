import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/api/knowledge/circular-preview';
const sessionToken = 'circular-preview-test-session';

const rss = '<rss><channel><item>' +
  '<title>بخشنامه گمرکی و ترخیص کالا</title>' +
  '<link>https://www.iranimpex.com/circular/123</link>' +
  '<description>واردات و ثبت سفارش</description>' +
  '</item></channel></rss>';
const telegram = '<div class="tgme_widget_message_wrap">' +
  '<div data-post="gomrok_news/900">' +
  '<div class="tgme_widget_message_text">اطلاعیه گمرکی درباره ترخیص</div>' +
  '</div></div>';

const sha256Hex = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const makeDatabase = async () => {
  const expectedHash = await sha256Hex(sessionToken);
  const writes: string[] = [];
  const statements: string[] = [];

  const db = {
    prepare(sql: string) {
      statements.push(sql);
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          values = next;
          return this;
        },
        async first() {
          if (sql.includes('FROM customs_admin_sessions') && values[0] === expectedHash) {
            return {
              user_id: 'owner-cloudflare-staging',
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              session_id: 'session-preview-1',
              revoked_at: null,
            };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          writes.push(sql);
          return { meta: { changes: 1 } };
        },
      };
    },
    async batch(_statements: unknown[]) {
      writes.push('BATCH');
      return [];
    },
  } as never;

  return { db, writes, statements };
};

const makeRequest = (options: {
  method?: string;
  cookie?: string;
  originHeader?: string;
  fetchSite?: string;
} = {}) => {
  const headers = new Headers({
    accept: 'application/json',
    origin: options.originHeader ?? origin,
    'sec-fetch-site': options.fetchSite ?? 'same-origin',
  });
  if (options.cookie) headers.set('cookie', 'customs_os_stage_session=' + options.cookie);
  return new Request(endpoint, {
    method: options.method ?? 'GET',
    headers,
  });
};

describe('Staging circular source preview route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a valid D1 session before requesting public sources', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes } = await makeDatabase();

    const response = await migrationWorker.fetch(
      makeRequest(),
      { MIGRATION_DB: db, MIGRATION_ENVIRONMENT: 'staging' } as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('blocks cross-origin requests before reading D1 or contacting sources', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes, statements } = await makeDatabase();

    const response = await migrationWorker.fetch(
      makeRequest({
        cookie: sessionToken,
        originHeader: 'https://attacker.example',
        fetchSite: 'cross-site',
      }),
      { MIGRATION_DB: db, MIGRATION_ENVIRONMENT: 'staging' } as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORIGIN_FORBIDDEN' });
    expect(statements).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('returns source preview to the authenticated staging owner without D1 writes or binary downloads', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url.includes('iranimpex.com') ? rss : telegram, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes } = await makeDatabase();

    const response = await migrationWorker.fetch(
      makeRequest({ cookie: sessionToken }),
      { MIGRATION_DB: db, MIGRATION_ENVIRONMENT: 'staging' } as never,
    );
    const payload = await response.json() as {
      ok: boolean;
      previewOnly: boolean;
      writesPerformed: number;
      binaryDownloadsPerformed: number;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      previewOnly: true,
      writesPerformed: 0,
      binaryDownloadsPerformed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(0);
  });
});
