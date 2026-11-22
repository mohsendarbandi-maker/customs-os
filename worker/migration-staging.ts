interface D1Result<T> { results: T[]; success?: boolean; }
interface D1Statement {
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database { prepare(query: string): D1Statement; }
interface Env {
  MIGRATION_DB: D1Database;
  MIGRATION_ENVIRONMENT?: string;
  PRODUCTION_DATA_IMPORTED?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  },
});

const notFound = () => json({ ok: false, error: 'NOT_FOUND' }, 404);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET') {
      return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'customs-os-migration-staging',
        environment: env.MIGRATION_ENVIRONMENT ?? 'staging',
        productionTraffic: false,
        productionDataImported: env.PRODUCTION_DATA_IMPORTED === 'true',
        capabilities: ['migration-health', 'migration-inventory'],
      });
    }

    if (url.pathname === '/health/db') {
      try {
        const row = await env.MIGRATION_DB.prepare(
          "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
        ).first<{ id: string; stage: string; schema_version: number; updated_at: string }>();
        if (!row) return json({ ok: false, error: 'MIGRATION_MANIFEST_MISSING' }, 503);
        return json({
          ok: true,
          database: 'customs-os-migration-staging',
          manifest: row,
          operationalDataImported: false,
        });
      } catch {
        return json({ ok: false, error: 'STAGING_DATABASE_UNAVAILABLE' }, 503);
      }
    }

    if (url.pathname === '/migration/status') {
      try {
        const [manifest, tableStates, archives] = await Promise.all([
          env.MIGRATION_DB.prepare(
            "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
          ).first<{ id: string; stage: string; schema_version: number; updated_at: string }>(),
          env.MIGRATION_DB.prepare(
            "SELECT status, COUNT(*) AS table_count FROM _migration_table_state GROUP BY status ORDER BY status",
          ).all<{ status: string; table_count: number }>(),
          env.MIGRATION_DB.prepare(
            "SELECT COUNT(*) AS function_count FROM supabase_edge_function_archive",
          ).first<{ function_count: number }>(),
        ]);
        if (!manifest) return json({ ok: false, error: 'MIGRATION_MANIFEST_MISSING' }, 503);
        return json({
          ok: true,
          manifest,
          trackedTables: tableStates.results.reduce((sum, item) => sum + item.table_count, 0),
          tableStates: tableStates.results,
          archivedFunctionSources: archives?.function_count ?? 0,
          gates: {
            sourcePostgres: 'blocked_57P03',
            authoritativeSchemaExport: 'not_verified',
            operationalRows: 'not_imported',
            authUsersAndSessions: 'not_imported',
            storageObjects: 'not_imported',
            edgeFunctions: 'source_archived_not_ported',
            productionCutover: 'blocked',
          },
        });
      } catch {
        return json({ ok: false, error: 'MIGRATION_STATUS_UNAVAILABLE' }, 503);
      }
    }

    if (url.pathname === '/migration/functions') {
      try {
        const result = await env.MIGRATION_DB.prepare(
          'SELECT slug, source_version, source_status, file_count, total_chars, deployed_sha256 FROM supabase_edge_function_archive ORDER BY slug',
        ).all<{
          slug: string;
          source_version: string;
          source_status: string;
          file_count: string;
          total_chars: string;
          deployed_sha256: string;
        }>();
        return json({
          ok: true,
          count: result.results.length,
          note: 'Source archive only; these functions are not deployed as Cloudflare replacements.',
          functions: result.results,
        });
      } catch {
        return json({ ok: false, error: 'FUNCTION_ARCHIVE_UNAVAILABLE' }, 503);
      }
    }

    return notFound();
  },
};
