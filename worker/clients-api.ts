export interface ClientD1Statement {
  bind(...values: unknown[]): ClientD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface ClientD1Database {
  prepare(sql: string): ClientD1Statement;
  batch(statements: ClientD1Statement[]): Promise<unknown[]>;
}

export interface ClientApiEnvironment {
  MIGRATION_DB: ClientD1Database;
}

export interface ClientApiProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  national_id: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ClientInput {
  name: string;
  nationalId: string;
  notes: string | null;
}

const COLUMNS = 'id, name, national_id, notes, created_at, updated_at';
const COLLECTION = '/api/clients';
const BODY_LIMIT = 16 * 1024;
const DEPENDENCIES = [
  'cases',
  'shipments',
  'registration_orders',
  'customs_documents',
  'file_manager_files',
  'file_manager_folders',
  'finance_cost_items',
  'customs_accounting_vouchers',
] as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});

const fail = (code: string, status: number, details: Record<string, unknown> = {}) =>
  json({ ok: false, error: code, ...details }, status);

const normalizeDigits = (value: string) =>
  Array.from(value.normalize('NFKC'), (character) => {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0x06f0 && point <= 0x06f9) return String(point - 0x06f0);
    if (point >= 0x0660 && point <= 0x0669) return String(point - 0x0660);
    return character;
  }).join('');

export const normalizeClientNationalId = (value: string) =>
  normalizeDigits(value).replace(/[^0-9]/g, '');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseInput = (value: unknown): ClientInput | null => {
  if (!isObject(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const nationalIdValue = typeof value.nationalId === 'string'
    ? value.nationalId
    : typeof value.national_id === 'string' ? value.national_id : '';
  const nationalId = normalizeClientNationalId(nationalIdValue);
  const notesValue = typeof value.notes === 'string' ? value.notes : '';
  if (!name || name.length > 200 || !nationalId || nationalId.length > 32 || notesValue.length > 5000) {
    return null;
  }
  return { name, nationalId, notes: notesValue.trim() ? notesValue : null };
};

const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};

const readInput = async (request: Request): Promise<ClientInput | Response> => {
  if (Number(request.headers.get('content-length') || 0) > BODY_LIMIT) {
    return fail('REQUEST_TOO_LARGE', 413);
  }
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) return fail('REQUEST_TOO_LARGE', 413);
    raw = JSON.parse(text);
  } catch {
    return fail('INVALID_JSON', 400);
  }
  const input = parseInput(raw);
  return input ?? fail('INVALID_CLIENT_INPUT', 422, {
    fields: ['name', 'nationalId', 'notes'],
    limits: { name: 200, nationalId: 32, notes: 5000 },
  });
};

const getClient = (db: ClientD1Database, id: string, organizationId: string) =>
  db.prepare('SELECT ' + COLUMNS + ' FROM clients WHERE id = ? AND organization_id = ? LIMIT 1')
    .bind(id, organizationId)
    .first<ClientRecord>();

const audit = (
  db: ClientD1Database,
  request: Request,
  profile: ClientApiProfile,
  action: 'create' | 'update' | 'delete',
  entityId: string,
  before: ClientRecord | null,
  after: ClientRecord | null,
  createdAt: string,
) => db.prepare(
  'INSERT INTO customs_os_audit_events ' +
  '(id, organization_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at) ' +
  'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0',
).bind(
  crypto.randomUUID(),
  profile.organization_id,
  profile.id,
  action,
  'client',
  entityId,
  before ? JSON.stringify(before) : null,
  after ? JSON.stringify(after) : null,
  request.headers.get('cf-ray') || crypto.randomUUID(),
  createdAt,
);

const dependenciesSql = 'SELECT ' + DEPENDENCIES.map((table) =>
  '(SELECT COUNT(*) FROM ' + table + ' WHERE client_id = ?) AS ' + table
).join(', ');

const getDependencies = (db: ClientD1Database, id: string) =>
  db.prepare(dependenciesSql).bind(...DEPENDENCIES.map(() => id))
    .first<Record<string, number>>();

const dependencyTotal = (value: Record<string, number>) =>
  Object.values(value).reduce((total, count) => total + Number(count || 0), 0);

const routeId = (pathname: string): string | null | Response => {
  if (pathname === COLLECTION) return null;
  if (!pathname.startsWith(COLLECTION + '/')) return fail('NOT_FOUND', 404);
  const raw = pathname.slice(COLLECTION.length + 1);
  if (!raw || raw.includes('/')) return fail('INVALID_CLIENT_ID', 400);
  try {
    const id = decodeURIComponent(raw);
    return id && id.length <= 128 && !id.includes('/') ? id : fail('INVALID_CLIENT_ID', 400);
  } catch {
    return fail('INVALID_CLIENT_ID', 400);
  }
};

const pageNumber = (value: string | null, fallback: number, min: number, max: number) => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
};

export const handleClientsApi = async (
  request: Request,
  env: ClientApiEnvironment,
  url: URL,
  profile: ClientApiProfile,
): Promise<Response> => {
  if (!profile.is_active || !['owner', 'admin', 'broker'].includes(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);

  const id = routeId(url.pathname);
  if (id instanceof Response) return id;
  const db = env.MIGRATION_DB;

  if (request.method === 'GET' && id === null) {
    const limit = pageNumber(url.searchParams.get('limit'), 30, 1, 100);
    const offset = pageNumber(url.searchParams.get('offset'), 0, 0, 1000000);
    const search = normalizeDigits((url.searchParams.get('search') || '').trim()).slice(0, 100);
    const where = search ? 'organization_id = ? AND (name LIKE ? OR national_id LIKE ?)' : 'organization_id = ?';
    const bindings: unknown[] = search
      ? [profile.organization_id, '%' + search + '%', '%' + search + '%']
      : [profile.organization_id];
    try {
      const count = await db.prepare('SELECT COUNT(*) AS total FROM clients WHERE ' + where)
        .bind(...bindings).first<{ total: number }>();
      const rows = await db.prepare(
        'SELECT ' + COLUMNS + ' FROM clients WHERE ' + where +
        ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      ).bind(...bindings, limit, offset).all<ClientRecord>();
      return json({ ok: true, items: rows.results, total: Number(count?.total || 0), limit, offset });
    } catch {
      return fail('CLIENTS_API_NOT_READY', 503);
    }
  }

  if (request.method === 'GET' && id !== null) {
    try {
      const client = await getClient(db, id, profile.organization_id);
      return client ? json({ ok: true, client }) : fail('CLIENT_NOT_FOUND', 404);
    } catch {
      return fail('CLIENTS_API_NOT_READY', 503);
    }
  }

  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    return fail('METHOD_NOT_ALLOWED', 405, {
      allowed: id === null ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE'],
    });
  }
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);

  if (request.method === 'POST') {
    if (id !== null) return fail('NOT_FOUND', 404);
    const input = await readInput(request);
    if (input instanceof Response) return input;
    const clientId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: ClientRecord = {
      id: clientId,
      name: input.name,
      national_id: input.nationalId,
      notes: input.notes,
      created_at: now,
      updated_at: now,
    };
    try {
      await db.batch([
        db.prepare(
          'INSERT INTO clients ' +
          '(id, organization_id, name, national_id, notes, created_at, updated_at, file_manager_search_text) ' +
          'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS ' +
          '(SELECT 1 FROM clients WHERE organization_id = ? AND national_id = ?)',
        ).bind(
          clientId, profile.organization_id, input.name, input.nationalId, input.notes, now, now,
          input.name + ' ' + input.nationalId, profile.organization_id, input.nationalId,
        ),
        audit(db, request, profile, 'create', clientId, null, record, now),
      ]);
      const saved = await getClient(db, clientId, profile.organization_id);
      if (saved) return json({ ok: true, client: saved }, 201);
      const duplicate = await db.prepare(
        'SELECT id FROM clients WHERE organization_id = ? AND national_id = ? LIMIT 1',
      ).bind(profile.organization_id, input.nationalId).first();
      return duplicate ? fail('CLIENT_NATIONAL_ID_EXISTS', 409) : fail('CLIENT_CREATE_NOT_CONFIRMED', 500);
    } catch {
      return fail('CLIENT_CREATE_FAILED', 500);
    }
  }

  if (id === null) return fail('CLIENT_ID_REQUIRED', 400);

  if (request.method === 'PATCH') {
    const input = await readInput(request);
    if (input instanceof Response) return input;
    try {
      const before = await getClient(db, id, profile.organization_id);
      if (!before) return fail('CLIENT_NOT_FOUND', 404);
      const now = new Date().toISOString();
      const after: ClientRecord = {
        ...before,
        name: input.name,
        national_id: input.nationalId,
        notes: input.notes,
        updated_at: now,
      };
      await db.batch([
        db.prepare(
          'UPDATE clients SET name = ?, national_id = ?, notes = ?, updated_at = ?, file_manager_search_text = ? ' +
          'WHERE id = ? AND organization_id = ? AND NOT EXISTS ' +
          '(SELECT 1 FROM clients WHERE organization_id = ? AND national_id = ? AND id <> ?)',
        ).bind(
          input.name, input.nationalId, input.notes, now, input.name + ' ' + input.nationalId,
          id, profile.organization_id, profile.organization_id, input.nationalId, id,
        ),
        audit(db, request, profile, 'update', id, before, after, now),
      ]);
      const saved = await getClient(db, id, profile.organization_id);
      if (!saved) return fail('CLIENT_NOT_FOUND', 404);
      if (saved.national_id !== input.nationalId) return fail('CLIENT_NATIONAL_ID_EXISTS', 409);
      return json({ ok: true, client: saved });
    } catch {
      return fail('CLIENT_UPDATE_FAILED', 500);
    }
  }

  if (request.method === 'DELETE') {
    try {
      const before = await getClient(db, id, profile.organization_id);
      if (!before) return fail('CLIENT_NOT_FOUND', 404);
      const dependencies = await getDependencies(db, id);
      if (!dependencies) return fail('CLIENT_DEPENDENCIES_UNAVAILABLE', 503);
      if (dependencyTotal(dependencies) > 0) {
        return fail('CLIENT_HAS_DEPENDENCIES', 409, { dependencies });
      }
      const noReferences = DEPENDENCIES.map((table) =>
        'NOT EXISTS (SELECT 1 FROM ' + table + ' WHERE client_id = ?)'
      ).join(' AND ');
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(
          'DELETE FROM clients WHERE id = ? AND organization_id = ? AND ' + noReferences,
        ).bind(id, profile.organization_id, ...DEPENDENCIES.map(() => id)),
        audit(db, request, profile, 'delete', id, before, null, now),
      ]);
      const remaining = await getClient(db, id, profile.organization_id);
      if (remaining) {
        const currentDependencies = await getDependencies(db, id);
        return fail('CLIENT_DELETE_BLOCKED', 409, { dependencies: currentDependencies || {} });
      }
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store, private' } });
    } catch {
      return fail('CLIENT_DELETE_FAILED', 500);
    }
  }

  return fail('METHOD_NOT_ALLOWED', 405);
};
