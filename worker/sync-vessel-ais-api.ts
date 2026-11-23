export interface VesselAisRow {
  id: string;
  name: string;
  imo_number: string | null;
  mmsi_number: string | null;
}

export interface VesselAisStatement {
  bind(...values: unknown[]): VesselAisStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface VesselAisDatabase {
  prepare(sql: string): VesselAisStatement;
}

export interface OpenWatersFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
}

export interface OpenWatersVessel {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  seen: string | null;
  type: string | null;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BBOXES = ['36,46,41.5,55.5', '41.5,46,47,55.5'] as const;
const MAX_FEATURES_PER_RESPONSE = 5000;
const PROVIDER_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MMSI_PATTERN = /^\d{9}$/;

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store, private' },
});

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validCoordinates = (lat: number | null, lon: number | null): lat is number =>
  lat !== null && lon !== null &&
  lat >= -90 && lat <= 90 &&
  lon >= -180 && lon <= 180;

const normalizedVessel = (feature: OpenWatersFeature): OpenWatersVessel | null => {
  const properties = feature?.properties ?? {};
  const coordinates = feature?.geometry?.coordinates;
  const mmsi = String(properties.mmsi ?? '').trim();

  if (!MMSI_PATTERN.test(mmsi) || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const lon = finiteNumber(coordinates[0]);
  const lat = finiteNumber(coordinates[1]);
  if (!validCoordinates(lat, lon)) return null;

  const speed = finiteNumber(properties.sog);
  const course = finiteNumber(properties.cog);
  const heading = finiteNumber(properties.heading);
  const seenValue = properties.seen;
  const seen = typeof seenValue === 'string' && Number.isFinite(Date.parse(seenValue))
    ? new Date(seenValue).toISOString()
    : null;

  return {
    mmsi,
    name: String(properties.name || 'MMSI ' + mmsi).slice(0, 160),
    lat,
    lon,
    sog: speed !== null && speed >= 0 && speed <= 100 ? speed : null,
    cog: course !== null && course >= 0 && course <= 360 ? course : null,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    seen,
    type: properties.type === undefined || properties.type === null
      ? null
      : String(properties.type).slice(0, 100),
  };
};

const fetchOpenWaters = async (
  url: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<{ features: OpenWatersFeature[] }> => {
  const headers = new Headers({ accept: 'application/geo+json, application/json' });
  if (token) headers.set('authorization', 'Bearer ' + token);

  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error('Open Waters AIS HTTP ' + response.status);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error('Open Waters AIS response exceeded the size limit');
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error('Open Waters AIS response exceeded the size limit');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Open Waters AIS returned invalid JSON');
  }

  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    throw new Error('Open Waters AIS response has no feature collection');
  }

  return { features: features.slice(0, MAX_FEATURES_PER_RESPONSE) as OpenWatersFeature[] };
};

const readMode = async (request: Request): Promise<Record<string, unknown>> => {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Query-string modes such as ?mode=health are also supported.
  }
  return {
    mode: url.searchParams.get('mode') || body.mode || 'tracked',
    mmsi: body.mmsi ?? url.searchParams.get('mmsi'),
  };
};

const changedRows = (result: unknown): number => {
  if (!result || typeof result !== 'object') return 0;
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
};

export const handleSyncVesselAisV2 = async (
  request: Request,
  db: VesselAisDatabase,
  token?: string,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const { mode: rawMode, mmsi: rawMmsi } = await readMode(request);
  const mode = String(rawMode || 'tracked');

  if (mode === 'health') {
    return json({
      ok: true,
      provider: 'Open Waters AIS',
      authenticated_provider: Boolean(token),
      timestamp: new Date().toISOString(),
    });
  }

  if (mode === 'lookup-mmsi') {
    const mmsi = String(rawMmsi ?? '').trim();
    if (!MMSI_PATTERN.test(mmsi)) {
      return json({
        ok: false,
        code: 'INVALID_MMSI',
        message: 'MMSI باید دقیقاً ۹ رقم باشد.',
      }, 400);
    }

    try {
      const payload = await fetchOpenWaters(
        'https://ais.openwaters.io/v1/vessels?mmsi=' + encodeURIComponent(mmsi),
        token,
        fetchImpl,
      );
      const vessel = payload.features.map(normalizedVessel).find(
        (item): item is OpenWatersVessel => item !== null && item.mmsi === mmsi,
      );

      if (!vessel) {
        return json({
          ok: true,
          provider: 'Open Waters AIS',
          mode,
          found: false,
          mmsi,
          code: 'NO_RECENT_AIS_POSITION',
          message: 'برای این MMSI در Open Waters طی ۳۰ دقیقه اخیر موقعیت AIS دریافت نشده است.',
        });
      }

      return json({
        ok: true,
        provider: 'Open Waters AIS',
        mode,
        found: true,
        vessel,
      });
    } catch (error) {
      return json({
        ok: false,
        code: 'AIS_PROVIDER_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'AIS provider failed',
      }, 502);
    }
  }

  if (mode === 'live-caspian') {
    try {
      const responses = await Promise.all(BBOXES.map((bbox) => fetchOpenWaters(
        'https://ais.openwaters.io/v1/vessels?bbox=' + encodeURIComponent(bbox),
        token,
        fetchImpl,
      )));
      const vesselsByMmsi = new Map<string, OpenWatersVessel>();
      for (const response of responses) {
        for (const feature of response.features) {
          const vessel = normalizedVessel(feature);
          if (vessel) vesselsByMmsi.set(vessel.mmsi, vessel);
        }
      }

      const vessels = [...vesselsByMmsi.values()];
      return json({
        ok: true,
        provider: 'Open Waters AIS',
        mode,
        bbox: BBOXES,
        vessels,
        count: vessels.length,
        generated_at: new Date().toISOString(),
      });
    } catch (error) {
      return json({
        ok: false,
        code: 'AIS_PROVIDER_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'AIS provider failed',
      }, 502);
    }
  }

  if (mode !== 'tracked') {
    return json({ ok: false, code: 'UNSUPPORTED_MODE' }, 400);
  }

  let targets: VesselAisRow[];
  try {
    const rows = await db.prepare(
      'SELECT id, name, imo_number, mmsi_number FROM vessels ' +
      'WHERE mmsi_number IS NOT NULL ORDER BY name LIMIT 50',
    ).all<VesselAisRow>();

    targets = rows.results
      .filter((vessel) => MMSI_PATTERN.test(String(vessel.mmsi_number ?? '')))
      .slice(0, 10);
  } catch {
    return json({ ok: false, code: 'VESSEL_LIST_UNAVAILABLE' }, 503);
  }

  if (!targets.length) {
    return json({
      ok: true,
      provider: 'Open Waters AIS',
      checked: 0,
      updated: [],
      failed: [],
      code: 'MMSI_REQUIRED',
      message: 'برای ردیابی کشتی ثبت‌شده، MMSI نه‌رقمی آن را در Master Data وارد کنید.',
    });
  }

  let positions: OpenWatersVessel[];
  try {
    const query = targets.map((vessel) => String(vessel.mmsi_number)).join(',');
    const payload = await fetchOpenWaters(
      'https://ais.openwaters.io/v1/vessels?mmsi=' + encodeURIComponent(query),
      token,
      fetchImpl,
    );
    positions = payload.features
      .map(normalizedVessel)
      .filter((item): item is OpenWatersVessel => item !== null);
  } catch (error) {
    return json({
      ok: false,
      code: 'AIS_PROVIDER_UNAVAILABLE',
      error: error instanceof Error ? error.message : 'AIS provider failed',
    }, 502);
  }

  const byMmsi = new Map(positions.map((vessel) => [vessel.mmsi, vessel]));
  const updated: Array<{ id: string; name: string; mmsi: string; lat: number; lon: number; seen: string | null }> = [];
  const failed: Array<{ id: string; name: string; mmsi: string; error: string }> = [];

  for (const target of targets) {
    const mmsi = String(target.mmsi_number);
    const position = byMmsi.get(mmsi);
    if (!position) {
      failed.push({
        id: target.id,
        name: target.name,
        mmsi,
        error: 'No recent AIS position',
      });
      continue;
    }

    const positionAt = position.seen || new Date().toISOString();
    const updates: string[] = [
      'last_latitude = ?',
      'last_longitude = ?',
      'last_position_at = ?',
      'last_position_source = ?',
    ];
    const values: unknown[] = [
      String(position.lat),
      String(position.lon),
      positionAt,
      'openwaters-ais',
    ];

    if (position.sog !== null) {
      updates.push('last_speed_knots = ?');
      values.push(String(position.sog));
    }
    if (position.cog !== null) {
      updates.push('last_course_deg = ?');
      values.push(String(position.cog));
    }
    values.push(target.id);

    try {
      const result = await db.prepare(
        'UPDATE vessels SET ' + updates.join(', ') + ' WHERE id = ?',
      ).bind(...values).run();

      if (changedRows(result) <= 0) {
        failed.push({
          id: target.id,
          name: target.name,
          mmsi,
          error: 'Vessel update did not change a row',
        });
        continue;
      }

      updated.push({
        id: target.id,
        name: target.name,
        mmsi,
        lat: position.lat,
        lon: position.lon,
        seen: positionAt,
      });
    } catch (error) {
      failed.push({
        id: target.id,
        name: target.name,
        mmsi,
        error: error instanceof Error ? error.message : 'D1 vessel update failed',
      });
    }
  }

  return json({
    ok: true,
    provider: 'Open Waters AIS',
    checked: targets.length,
    updated,
    failed,
    generated_at: new Date().toISOString(),
  });
};
