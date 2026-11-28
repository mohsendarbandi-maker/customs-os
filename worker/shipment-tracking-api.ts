export interface ShipmentTrackingStatement {
  bind(...values: unknown[]): ShipmentTrackingStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface ShipmentTrackingDatabase {
  prepare(sql: string): ShipmentTrackingStatement;
  batch(statements: ShipmentTrackingStatement[]): Promise<unknown[]>;
}
export interface ShipmentTrackingProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}

const BASE = '/api/shipments/';
const ALLOWED_ROLES = new Set(['owner', 'admin', 'broker', 'warehouse']);
const WRITE_ROLES = new Set(['owner', 'admin', 'broker']);
const STATUSES = new Set(['draft','booking_confirmed','loading','loaded','departed','in_transit','approaching_destination','anchorage','berthing','discharging','discharged','completed','delayed','cancelled']);
const STATUS_EVENT_CODES: Record<string, string> = { loading:'loading_start', loaded:'loading_complete', anchorage:'anchorage_arrived', discharging:'discharge_start', discharged:'discharge_complete' };
const EVENT_CODES = new Set([
  'draft', 'booking_confirmed', 'loading_start', 'loading_complete', 'departed',
  'in_transit', 'approaching_destination', 'anchorage_arrived', 'berthing',
  'discharge_start', 'discharge_complete', 'completed', 'delayed', 'cancelled',
]);
const TIME_TYPES = new Set(['estimated', 'requested', 'planned', 'actual']);

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' },
});
const fail = (error: string, status: number) => json({ ok: false, error }, status);
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const shipmentIdFromPath = (pathname: string, suffix: '/tracking-events' | '/ship-pass') => {
  if (!pathname.startsWith(BASE) || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice(BASE.length, -suffix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id && id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};
const readBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const body = await request.json() as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export const handleShipmentTrackingApi = async (
  request: Request,
  db: ShipmentTrackingDatabase,
  url: URL,
  profile: ShipmentTrackingProfile,
): Promise<Response> => {
  if (!profile.is_active || !profile.id || !profile.organization_id || !ALLOWED_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);

  const eventsShipmentId = shipmentIdFromPath(url.pathname, '/tracking-events');
  const shipPassShipmentId = shipmentIdFromPath(url.pathname, '/ship-pass');
  if (!eventsShipmentId && !shipPassShipmentId) return fail('NOT_FOUND', 404);

  try {
    const shipmentId = eventsShipmentId || shipPassShipmentId!;
    const shipment = await db.prepare(
      'SELECT id,organization_id,ship_passed,ship_passed_at,ship_passed_by FROM shipments WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(shipmentId, profile.organization_id).first<{
      id: string; organization_id: string; ship_passed: number | boolean | null;
      ship_passed_at: string | null; ship_passed_by: string | null;
    }>();
    if (!shipment) return fail('SHIPMENT_NOT_FOUND', 404);

    if (eventsShipmentId && request.method === 'GET') {
      const rows = await db.prepare(
        'SELECT id,organization_id,shipment_id,event_code,event_time,time_type,location,notes,source,created_by,created_at ' +
        'FROM shipment_tracking_events WHERE shipment_id=? AND organization_id=? ORDER BY event_time DESC,created_at DESC LIMIT 100',
      ).bind(shipmentId, profile.organization_id).all();
      return json({ ok: true, events: rows.results });
    }

    if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);

    if (eventsShipmentId && request.method === 'POST') {
      const body = await readBody(request);
      if (!body) return fail('INVALID_JSON', 400);
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      const eventCode = typeof body.eventCode === 'string' ? body.eventCode.trim() : (STATUS_EVENT_CODES[status] || status);
      const timeType = typeof body.timeType === 'string' ? body.timeType.trim() : 'actual';
      const eventTime = typeof body.eventTime === 'string' && body.eventTime.trim()
        ? body.eventTime.trim() : new Date().toISOString();
      const location = typeof body.location === 'string' ? body.location.trim().slice(0, 160) || null : null;
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null;
      const source = typeof body.source === 'string' ? body.source.trim().slice(0, 80) || 'Customs OS' : 'Customs OS';
      if (!STATUSES.has(status)) return fail('INVALID_SHIPMENT_STATUS', 400);
      if (!EVENT_CODES.has(eventCode)) return fail('INVALID_EVENT_CODE', 400);
      if (!TIME_TYPES.has(timeType)) return fail('INVALID_TIME_TYPE', 400);
      if (Number.isNaN(Date.parse(eventTime))) return fail('INVALID_EVENT_TIME', 400);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(
          'UPDATE shipments SET current_status=?,current_location=?,updated_at=? WHERE id=? AND organization_id=?',
        ).bind(status, location, now, shipmentId, profile.organization_id),
        db.prepare(
          'INSERT INTO shipment_tracking_events ' +
          '(id,organization_id,shipment_id,event_code,event_time,time_type,location,notes,source,created_by,created_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(id, profile.organization_id, shipmentId, eventCode, new Date(eventTime).toISOString(),
          timeType, location, notes, source, profile.id, now),
        db.prepare(
          'INSERT INTO customs_os_audit_events ' +
          '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
          'VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(crypto.randomUUID(), profile.organization_id, profile.id, 'create',
          'shipment_tracking_event', id, null,
          JSON.stringify({ shipment_id: shipmentId, status, event_code: eventCode, event_time: eventTime, time_type: timeType, location, notes }),
          request.headers.get('cf-ray') || crypto.randomUUID()),
      ]);
      const saved = await db.prepare(
        'SELECT id,organization_id,shipment_id,event_code,event_time,time_type,location,notes,source,created_by,created_at ' +
        'FROM shipment_tracking_events WHERE id=? AND organization_id=? LIMIT 1',
      ).bind(id, profile.organization_id).first();
      return saved ? json({ ok: true, event: saved }, 201) : fail('TRACKING_EVENT_WRITE_NOT_CONFIRMED', 500);
    }

    if (shipPassShipmentId && request.method === 'POST') {
      const body = await readBody(request);
      if (!body || typeof body.passed !== 'boolean') return fail('INVALID_SHIP_PASS_INPUT', 400);
      const passed = body.passed;
      const now = new Date().toISOString();
      const before = {
        ship_passed: Boolean(shipment.ship_passed),
        ship_passed_at: shipment.ship_passed_at,
        ship_passed_by: shipment.ship_passed_by,
      };
      await db.batch([
        db.prepare(
          'UPDATE shipments SET ship_passed=?,ship_passed_at=?,ship_passed_by=?,updated_at=? ' +
          'WHERE id=? AND organization_id=?',
        ).bind(passed ? 1 : 0, passed ? now : null, passed ? profile.id : null, now,
          shipmentId, profile.organization_id),
        db.prepare(
          'INSERT INTO customs_os_audit_events ' +
          '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
          'VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(crypto.randomUUID(), profile.organization_id, profile.id, 'update',
          'shipment_ship_pass', shipmentId, JSON.stringify(before),
          JSON.stringify({ ship_passed: passed, ship_passed_at: passed ? now : null, ship_passed_by: passed ? profile.id : null }),
          request.headers.get('cf-ray') || crypto.randomUUID()),
      ]);
      const saved = await db.prepare(
        'SELECT id,ship_passed,ship_passed_at,ship_passed_by FROM shipments WHERE id=? AND organization_id=? LIMIT 1',
      ).bind(shipmentId, profile.organization_id).first();
      if (!saved) return fail('SHIP_PASS_WRITE_NOT_CONFIRMED', 500);
      return json({ ok: true, shipment: saved });
    }

    return fail('METHOD_NOT_ALLOWED', 405);
  } catch {
    return fail('SHIPMENT_TRACKING_API_NOT_READY', 503);
  }
};
