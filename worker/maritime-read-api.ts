export interface MaritimeReadStatement {
  bind(...values: unknown[]): MaritimeReadStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface MaritimeReadDatabase {
  prepare(sql: string): MaritimeReadStatement;
}

export interface MaritimeReadProfile {
  organization_id: string;
}

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
  },
});

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeVessel = (row: Record<string, unknown>) => ({
  ...row,
  last_latitude: nullableNumber(row.last_latitude),
  last_longitude: nullableNumber(row.last_longitude),
  last_speed_knots: nullableNumber(row.last_speed_knots),
  last_course_deg: nullableNumber(row.last_course_deg),
});

const VESSELS_SQL =
  'SELECT id, name, imo_number, mmsi_number, flag_code, last_latitude, last_longitude, ' +
  'last_position_at, last_position_source, last_speed_knots, last_course_deg ' +
  'FROM vessels WHERE organization_id = ? ORDER BY name LIMIT 200';

const SHIPMENTS_SQL =
  'SELECT id, vessel_id, shipping_line, bill_of_lading_no, current_status, ' +
  'origin_port, destination_port, created_at ' +
  'FROM shipments WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100';

export const handleMaritimeReadApi = async (
  request: Request,
  db: MaritimeReadDatabase,
  url: URL,
  profile: MaritimeReadProfile,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }
  if (!profile.organization_id) {
    return json({ ok: false, error: 'ORGANIZATION_REQUIRED' }, 403);
  }

  if (url.pathname === '/api/maritime/vessels') {
    try {
      const rows = await db.prepare(VESSELS_SQL)
        .bind(profile.organization_id)
        .all();
      return json({
        ok: true,
        count: rows.results.length,
        vessels: rows.results.map((row) => normalizeVessel(row as Record<string, unknown>)),
      });
    } catch {
      return json({ ok: false, error: 'MARITIME_VESSELS_UNAVAILABLE' }, 503);
    }
  }

  if (url.pathname === '/api/maritime/shipments') {
    try {
      const rows = await db.prepare(SHIPMENTS_SQL)
        .bind(profile.organization_id)
        .all();
      return json({
        ok: true,
        count: rows.results.length,
        shipments: rows.results,
      });
    } catch {
      return json({ ok: false, error: 'MARITIME_SHIPMENTS_UNAVAILABLE' }, 503);
    }
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
};
