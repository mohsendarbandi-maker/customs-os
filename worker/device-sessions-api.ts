export interface DeviceSessionsStatement {
  bind(...values: unknown[]): DeviceSessionsStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface DeviceSessionsDatabase {
  prepare(sql: string): DeviceSessionsStatement;
  batch(statements: DeviceSessionsStatement[]): Promise<unknown[]>;
}

export interface AuthenticatedStageSession {
  user_id: string;
  token_hash: string;
  session_id: string;
}

interface DeviceSessionRow {
  session_id: string;
  device_label: string | null;
  app_origin: string | null;
  created_at: string;
  last_active_at: string | null;
  is_current: number | boolean;
}

const COLLECTION = '/api/auth/devices';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});
const fail = (code: string, status: number) => json({ ok: false, error: code }, status);
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
};
const readSessionId = (pathname: string): string | null | Response => {
  if (pathname === COLLECTION) return null;
  const prefix = COLLECTION + '/';
  if (!pathname.startsWith(prefix)) return fail('NOT_FOUND', 404);
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes('/')) return fail('INVALID_SESSION_ID', 400);
  try {
    const value = decodeURIComponent(raw);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value
      : fail('INVALID_SESSION_ID', 400);
  } catch {
    return fail('INVALID_SESSION_ID', 400);
  }
};
const changedRows = (result: unknown) => {
  if (typeof result !== 'object' || result === null) return 0;
  const meta = (result as { meta?: { changes?: number } }).meta;
  return Number(meta?.changes || 0);
};

export const handleDeviceSessionsApi = async (
  request: Request,
  db: DeviceSessionsDatabase,
  url: URL,
  current: AuthenticatedStageSession,
): Promise<Response> => {
  if (!current.user_id || !current.token_hash || !current.session_id) {
    return fail('INVALID_SESSION_CONTEXT', 401);
  }
  const targetId = readSessionId(url.pathname);
  if (targetId instanceof Response) return targetId;

  if (request.method === 'GET' && targetId === null) {
    try {
      const rows = await db.prepare(
        'SELECT session_id, device_label, app_origin, created_at, ' +
        'last_seen_at AS last_active_at, ' +
        'CASE WHEN token_hash = ? THEN 1 ELSE 0 END AS is_current, ' +
        'NULL AS user_agent, NULL AS revoke_requested_at ' +
        'FROM customs_admin_sessions ' +
        'WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ' +
        'ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC LIMIT 50',
      ).bind(current.token_hash, current.user_id, new Date().toISOString()).all<DeviceSessionRow>();
      return json({
        ok: true,
        sessions: rows.results.map((row) => ({
          session_id: row.session_id,
          created_at: row.created_at,
          last_active_at: row.last_active_at || row.created_at,
          user_agent: null,
          device_label: row.device_label || 'دستگاه نامشخص',
          app_origin: row.app_origin,
          is_current: Boolean(row.is_current),
          revoke_requested_at: null,
        })),
        limit: 50,
      });
    } catch {
      return fail('DEVICE_SESSIONS_NOT_READY', 503);
    }
  }

  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);

  if (request.method === 'POST' && url.pathname === COLLECTION + '/revoke-others') {
    const revokedAt = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
    try {
      const results = await db.batch([
        db.prepare(
          'UPDATE customs_admin_sessions SET revoked_at = ? ' +
          'WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL AND expires_at > ?',
        ).bind(revokedAt, current.user_id, current.token_hash, revokedAt),
        db.prepare(
          'INSERT INTO customs_os_auth_events ' +
          '(id, actor_user_id, target_user_id, event_type, session_id, request_id, details_json, created_at) ' +
          'SELECT ?, ?, ?, ?, NULL, ?, ?, ? WHERE changes() > 0',
        ).bind(
          eventId,
          current.user_id,
          current.user_id,
          'other_sessions_revoked',
          requestId,
          JSON.stringify({ scope: 'all_other_active_sessions' }),
          revokedAt,
        ),
      ]);
      return json({ ok: true, revoked_count: changedRows(results[0]) });
    } catch {
      return fail('DEVICE_SESSIONS_REVOKE_FAILED', 500);
    }
  }

  if (request.method === 'DELETE' && targetId !== null) {
    if (targetId === current.session_id) return fail('CANNOT_REVOKE_CURRENT_SESSION', 409);
    const revokedAt = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
    try {
      const target = await db.prepare(
        'SELECT session_id FROM customs_admin_sessions ' +
        'WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1',
      ).bind(current.user_id, targetId, revokedAt).first<{ session_id: string }>();
      if (!target) return fail('DEVICE_SESSION_NOT_FOUND', 404);

      const results = await db.batch([
        db.prepare(
          'UPDATE customs_admin_sessions SET revoked_at = ? ' +
          'WHERE user_id = ? AND session_id = ? AND session_id <> ? ' +
          'AND revoked_at IS NULL AND expires_at > ?',
        ).bind(revokedAt, current.user_id, targetId, current.session_id, revokedAt),
        db.prepare(
          'INSERT INTO customs_os_auth_events ' +
          '(id, actor_user_id, target_user_id, event_type, session_id, request_id, details_json, created_at) ' +
          'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0',
        ).bind(
          eventId,
          current.user_id,
          current.user_id,
          'session_revoked',
          targetId,
          requestId,
          JSON.stringify({ scope: 'single_device' }),
          revokedAt,
        ),
      ]);
      const changes = changedRows(results[0]);
      return changes > 0
        ? json({ ok: true, revoked_count: changes })
        : fail('DEVICE_SESSION_NOT_FOUND', 404);
    } catch {
      return fail('DEVICE_SESSIONS_REVOKE_FAILED', 500);
    }
  }

  return fail('METHOD_NOT_ALLOWED', 405);
};
