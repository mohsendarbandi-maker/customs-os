interface D1Database {
  prepare(query: string): { first<T = Record<string, unknown>>(): Promise<T | null> };
}

interface Env {
  MIGRATION_DB: D1Database;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'customs-os-migration-staging',
        productionTraffic: false,
        dataImported: false,
      });
    }

    if (url.pathname === '/health/db') {
      try {
        const row = await env.MIGRATION_DB.prepare(
          "SELECT id, stage, schema_version FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
        ).first<{ id: string; stage: string; schema_version: number }>();

        if (!row) return json({ ok: false, error: 'MIGRATION_MANIFEST_MISSING' }, 503);
        return json({
          ok: true,
          database: 'customs-os-migration-staging',
          manifest: row,
          productionDataImported: false,
        });
      } catch {
        return json({ ok: false, error: 'STAGING_DATABASE_UNAVAILABLE' }, 503);
      }
    }

    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  },
};
