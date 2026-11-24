export interface VesselMultiSourceResult {
  source: string;
  url: string;
  ok: boolean;
  name?: string | null;
  mmsi?: string | null;
  imo?: string;
  lat?: number | null;
  lon?: number | null;
  positionAt?: string | null;
  speed?: number | null;
  course?: number | null;
  region?: string | null;
  rawPosition?: string | null;
  error?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ParsedCoordinates = { lat: number; lon: number };

const MAX_SOURCE_HTML_BYTES = 1_500_000;
const SOURCE_TIMEOUT_MS = 12_000;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 CustomsOS Vessel Research',
  Accept: 'text/html,application/xhtml+xml',
};

const clean = (value: string): string => value
  .replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_match, code: string) => {
    const character = Number(code);
    return Number.isFinite(character) && character >= 0 && character <= 0x10ffff
      ? String.fromCodePoint(character)
      : '';
  })
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const num = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const first = (pattern: RegExp, text: string): string | null => text.match(pattern)?.[1] ?? null;

const fetchText = async (url: string, fetchImpl: FetchLike): Promise<string> => {
  const response = await fetchImpl(url, {
    headers: REQUEST_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_SOURCE_HTML_BYTES) throw new Error('Source page exceeds size limit');

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_HTML_BYTES) {
    throw new Error('Source page exceeds size limit');
  }
  return text;
};

const parseCoordinates = (text: string): ParsedCoordinates | null => {
  const patterns = [
    /(?:latitude|lat)["'\s:=]+(-?\d{1,3}\.\d{3,})[^\n]{0,180}?(?:longitude|lon)["'\s:=]+(-?\d{1,3}\.\d{3,})/i,
    /(?:longitude|lon)["'\s:=]+(-?\d{1,3}\.\d{3,})[^\n]{0,180}?(?:latitude|lat)["'\s:=]+(-?\d{1,3}\.\d{3,})/i,
    /(-?\d{2}\.\d{4,})\s*[,/]\s*(-?\d{2}\.\d{4,})/,
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const match = text.match(patterns[index]);
    if (!match) continue;
    const firstValue = num(match[1]);
    const secondValue = num(match[2]);
    if (firstValue === null || secondValue === null) continue;
    if (index === 1) {
      if (Math.abs(secondValue) <= 90 && Math.abs(firstValue) <= 180) {
        return { lat: secondValue, lon: firstValue };
      }
    } else if (Math.abs(firstValue) <= 90 && Math.abs(secondValue) <= 180) {
      return { lat: firstValue, lon: secondValue };
    }
  }
  return null;
};

const parseSource = (
  source: string,
  url: string,
  html: string,
  imo: string,
  mmsi: string | null,
): VesselMultiSourceResult => {
  const text = clean(html);
  const coordinates = parseCoordinates(html);
  const name = first(
    /(?:<title[^>]*>\s*)?([^<]{2,60}?)\s*(?:,\s*(?:General Cargo|Dry bulk|Reserved for future use)|\s*-\s*Details)/i,
    html,
  ) || first(/(?:vesselName|SHIPNAME|shipname)["'\s:=]+["']([^"']+)/i, html);

  const foundMmsi = first(/(?:MMSI|mmsi)[^0-9]{0,30}(\d{9})/i, text) || mmsi;
  const speed = first(/(?:Speed|speed)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:Knots|kn|knot)/i, text);
  const course = first(/(?:Course|course)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:º|°|deg)/i, text);
  const positionAt = first(
    /(?:Position received|Position Received|Last Position Update|last update)[^0-9]{0,40}((?:20\d\d[-/]\d\d[-/]\d\d[^|<]{0,25})|(?:\d+\s+(?:hours?|days?|minutes?)\s+ago))/i,
    text,
  );

  let region: string | null = null;
  for (const pattern of [
    /current position[^.]{0,120}\b(?:in|at)\s+([^.;]{3,80})/i,
    /currently in the\s+([^,.;]{3,80})/i,
    /position[^.]{0,100}\b(Caspian Sea|Russian 12 NM|Caspian)/i,
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) {
      region = match[1].trim();
      break;
    }
  }

  return {
    source,
    url,
    ok: true,
    name: name ? clean(name) : null,
    imo,
    mmsi: foundMmsi,
    lat: coordinates?.lat ?? null,
    lon: coordinates?.lon ?? null,
    positionAt: positionAt ? clean(positionAt) : null,
    speed: num(speed),
    course: num(course),
    region,
    rawPosition: coordinates ? coordinates.lat + ', ' + coordinates.lon : null,
  };
};

const positionTime = (value?: string | null): number => {
  if (!value) return 0;
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return absolute;
  const relative = value.match(/(\d+)\s+(hours?|days?|minutes?)\s+ago/i);
  if (!relative) return 0;
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const multiplier = unit.startsWith('day') ? 86_400_000
    : unit.startsWith('hour') ? 3_600_000
      : 60_000;
  return Date.now() - amount * multiplier;
};

const failedSource = (
  source: string,
  url: string,
  imo: string,
  mmsi: string | null,
  error: unknown,
): VesselMultiSourceResult => ({
  source,
  url,
  ok: false,
  imo,
  mmsi,
  error: error instanceof Error ? error.message : String(error),
});

const slugify = (value: string | null): string => (value || '')
  .trim()
  .replace(/[^A-Za-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase();

export const handleVesselMultiSourceLookup = async (
  request: Request,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  }

  let body: { imo?: unknown };
  try {
    body = await request.json() as { imo?: unknown };
  } catch {
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const imo = String(body?.imo ?? '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(imo)) {
    return Response.json({ error: 'IMO باید ۷ رقم باشد' }, { status: 400 });
  }

  const vesselFinderUrl = 'https://www.vesselfinder.com/vessels/details/' + imo;
  let vesselFinderHtml = '';
  let vesselFinderError: unknown = null;
  try {
    vesselFinderHtml = await fetchText(vesselFinderUrl, fetchImpl);
  } catch (error) {
    vesselFinderError = error;
  }

  const vesselFinderText = clean(vesselFinderHtml);
  const mmsiPattern = new RegExp(
    '(?:IMO\\s*\\/?\\s*MMSI|IMO\\s*\\/\\s*MMSI)[^0-9]{0,20}' + imo + '\\s*\\/\\s*(\\d{9})',
    'i',
  );
  const mmsi = first(mmsiPattern, vesselFinderText)
    || first(/MMSI[^0-9]{0,20}(\d{9})/i, vesselFinderText);
  const name = first(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i, vesselFinderHtml)
    || first(/#\s*([^\n]{2,60})/i, vesselFinderText);
  const slug = slugify(name);

  const myShipTrackingUrl = 'https://www.myshiptracking.com/vessels/' + slug +
    '-mmsi-' + (mmsi || 'unknown') + '-imo-' + imo;
  const maritimeOptimaUrl = 'https://maritimeoptima.com/public/vessels/pages/imo%3A' + imo +
    (mmsi ? '/mmsi%3A' + mmsi : '') + '/' + (slug.toUpperCase() || 'VESSEL') + '.html';
  const magicPortUrl = 'https://magicport.ai/vessels/general-cargo/' + slug + '-mmsi-' + (mmsi || 'unknown');

  const definitions = [
    {
      source: 'VesselFinder',
      url: vesselFinderUrl,
      load: async () => {
        if (vesselFinderError) throw vesselFinderError;
        return vesselFinderHtml;
      },
    },
    {
      source: 'MyShipTracking',
      url: myShipTrackingUrl,
      load: async () => fetchText(myShipTrackingUrl, fetchImpl),
    },
    {
      source: 'Maritime Optima',
      url: maritimeOptimaUrl,
      load: async () => fetchText(maritimeOptimaUrl, fetchImpl),
    },
    {
      source: 'MagicPort',
      url: magicPortUrl,
      load: async () => fetchText(magicPortUrl, fetchImpl),
    },
  ];

  const results = await Promise.all(definitions.map(async (definition) => {
    try {
      const html = await definition.load();
      return parseSource(definition.source, definition.url, html, imo, mmsi || null);
    } catch (error) {
      return failedSource(definition.source, definition.url, imo, mmsi || null, error);
    }
  }));

  const withCoordinates = results.filter(
    (item): item is VesselMultiSourceResult & { lat: number; lon: number } =>
      item.ok && item.lat !== null && item.lat !== undefined &&
      item.lon !== null && item.lon !== undefined,
  );

  let selected: {
    lat: number;
    lon: number;
    sourceCount: number;
    sourceNames: string[];
    confidence: 'cross-source' | 'single-source';
  } | null = null;

  if (withCoordinates.length > 0) {
    const sorted = [...withCoordinates].sort(
      (a, b) => positionTime(b.positionAt) - positionTime(a.positionAt),
    );
    const reference = sorted[0];
    const nearby = withCoordinates.filter(
      (item) => Math.abs(item.lat - reference.lat) < 0.8 &&
        Math.abs(item.lon - reference.lon) < 1.2,
    );
    const pool = nearby.length > 0 ? nearby : withCoordinates;
    selected = {
      lat: pool.reduce((sum, item) => sum + item.lat, 0) / pool.length,
      lon: pool.reduce((sum, item) => sum + item.lon, 0) / pool.length,
      sourceCount: pool.length,
      sourceNames: pool.map((item) => item.source),
      confidence: pool.length >= 2 ? 'cross-source' : 'single-source',
    };
  }

  return Response.json({
    imo,
    mmsi: mmsi || null,
    name: name?.trim() || null,
    sources: results.sort((a, b) => a.source.localeCompare(b.source)),
    selected,
    checkedAt: new Date().toISOString(),
  }, {
    headers: { 'cache-control': 'no-store, private' },
  });
};
