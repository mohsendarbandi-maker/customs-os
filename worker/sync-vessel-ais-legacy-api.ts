export interface LegacyAisVesselRow {
  id: string;
  name: string;
  imo_number: string | null;
  mmsi_number: string | null;
}
export interface LegacyAisStatement {
  bind(...values: unknown[]): LegacyAisStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface LegacyAisDatabase {
  prepare(sql: string): LegacyAisStatement;
}
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store, private' },
});
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const validPosition = (lat: number | null, lon: number | null): lat is number =>
  lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
const changedRows = (value: unknown) => {
  if (!value || typeof value !== 'object') return 0;
  const changes = (value as { meta?: { changes?: unknown } }).meta?.changes;
  return typeof changes === 'number' ? changes : 0;
};

const fetchPosition = async (
  url: string,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> => {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('AISFriends HTTP ' + response.status);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_BODY_BYTES) throw new Error('AISFriends response too large');
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('AISFriends response too large');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('AISFriends returned invalid JSON');
  }
  const row = Array.isArray(payload)
    ? payload[0]
    : (payload as Record<string, unknown>)?.data ??
      (payload as Record<string, unknown>)?.vessel ??
      payload;
  if (!row || typeof row !== 'object') throw new Error('AISFriends returned no vessel position');
  return row as Record<string, unknown>;
};

export const handleLegacySyncVesselAis = async (
  request: Request,
  db: LegacyAisDatabase,
  organizationId: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!organizationId) return json({ error: 'ORGANIZATION_SCOPE_REQUIRED' }, 403);

  let targets: LegacyAisVesselRow[];
  try {
    const result = await db.prepare(
      'SELECT id, name, imo_number, mmsi_number FROM vessels ' +
      'WHERE organization_id = ? AND (imo_number IS NOT NULL OR mmsi_number IS NOT NULL) ' +
      'ORDER BY name LIMIT 100',
    ).bind(organizationId).all<LegacyAisVesselRow>();

    targets = result.results
      .filter((vessel) => Boolean(String(vessel.imo_number || '').trim()) ||
        /^\d{9}$/.test(String(vessel.mmsi_number || '')))
      .slice(0, 10);
  } catch {
    return json({ ok: false, error: 'VESSEL_LIST_UNAVAILABLE' }, 503);
  }

  if (!targets.length) {
    return json({ ok: true, provider: 'AISFriends', checked: 0, updated: [], failed: [] });
  }

  const updated: Array<{ id: string; name: string; lat: number; lon: number }> = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];

  for (const vessel of targets) {
    const identifier = vessel.imo_number
      ? 'imo=' + encodeURIComponent(vessel.imo_number)
      : 'mmsi=' + encodeURIComponent(String(vessel.mmsi_number));
    try {
      const row = await fetchPosition(
        'https://www.aisfriends.com/api/vessels/latest-position?' + identifier + '&format=json',
        fetchImpl,
      );
      const lat = finite(row.latitude ?? row.LAT ?? row.lat);
      const lon = finite(row.longitude ?? row.LON ?? row.lon);
      if (!validPosition(lat, lon)) throw new Error('AISFriends returned invalid coordinates');

      const speed = finite(row.speed ?? row.SPEED);
      const course = finite(row.course ?? row.COURSE);
      const timestampRaw = row.timestamp ?? row.TIMESTAMP;
      const parsedTime = typeof timestampRaw === 'string' || typeof timestampRaw === 'number'
        ? Date.parse(String(timestampRaw))
        : NaN;
      const positionAt = Number.isFinite(parsedTime)
        ? new Date(parsedTime).toISOString()
        : new Date().toISOString();
      const patch: string[] = [
        'last_latitude = ?',
        'last_longitude = ?',
        'last_position_at = ?',
        'last_position_source = ?',
      ];
      const values: unknown[] = [String(lat), String(lon), positionAt, 'aisfriends'];
      if (speed !== null && speed >= 0 && speed <= 100) {
        patch.push('last_speed_knots = ?');
        values.push(String(speed));
      }
      if (course !== null && course >= 0 && course <= 360) {
        patch.push('last_course_deg = ?');
        values.push(String(course));
      }

      values.push(vessel.id, organizationId);
      const result = await db.prepare(
        'UPDATE vessels SET ' + patch.join(', ') + ' WHERE id = ? AND organization_id = ?',
      ).bind(...values).run();
      if (changedRows(result) <= 0) throw new Error('Vessel update did not change a row');

      updated.push({ id: vessel.id, name: vessel.name, lat, lon });
    } catch (error) {
      failed.push({
        id: vessel.id,
        name: vessel.name,
        error: error instanceof Error ? error.message.slice(0, 300) : 'AIS update failed',
      });
    }
  }

  return json({
    ok: true,
    provider: 'AISFriends',
    checked: targets.length,
    updated,
    failed,
    generated_at: new Date().toISOString(),
  });
};
