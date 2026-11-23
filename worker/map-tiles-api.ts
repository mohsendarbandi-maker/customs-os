type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface MapTileCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

const TILE_HOST = 'https://tile.openstreetmap.org';
const TILE_TIMEOUT_MS = 8_000;
const TILE_USER_AGENT = 'Customs OS/1.0 (+https://darbandicommercial.ir)';

const textError = (message: string, status: number, headers: HeadersInit = {}) =>
  new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

const parseTileCoordinates = (pathname: string) => {
  const parts = pathname.split('/');
  if (
    parts.length !== 7 ||
    parts[1] !== 'api' ||
    parts[2] !== 'map' ||
    parts[3] !== 'tiles'
  ) return null;

  const zRaw = parts[4];
  const xRaw = parts[5];
  const yRaw = parts[6].endsWith('.png') ? parts[6].slice(0, -4) : '';
  const digits = (value: string, maxLength: number) =>
    value.length > 0 && value.length <= maxLength &&
    [...value].every((character) => character >= '0' && character <= '9');

  if (!digits(zRaw, 2) || !digits(xRaw, 8) || !digits(yRaw, 8)) return null;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || z < 0 || z > 19) return null;
  const dimension = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x >= dimension || y >= dimension) return null;
  return { z, x, y };
};

export const serveMapTile = async (
  request: Request,
  fetchImpl: FetchLike = fetch,
  cache?: MapTileCache,
): Promise<Response> => {
  const url = new URL(request.url);
  const coordinates = parseTileCoordinates(url.pathname);
  if (!coordinates) return jsonError('آدرس کاشی نقشه معتبر نیست.', 400);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return jsonError('Method not allowed', 405);
  }

  const { z, x, y } = coordinates;
  const cacheKey = new Request(new URL(url.pathname, url.origin), { method: 'GET' });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('x-customs-map-cache', 'HIT');
        return new Response(request.method === 'HEAD' ? null : cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        });
      }
    } catch {
      // Cache is only an optimization; continue to the map provider.
    }
  }

  let referer = new URL('/marine-conditions', url.origin).toString();
  try {
    const incoming = request.headers.get('referer');
    if (incoming && new URL(incoming).origin === url.origin) referer = incoming;
  } catch {
    // Use the stable first-party referer for invalid or cross-origin headers.
  }

  const tileUrl = TILE_HOST + '/' + z + '/' + x + '/' + y + '.png';
  try {
    const upstream = await fetchImpl(tileUrl, {
      method: 'GET',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/png,*/*;q=0.8',
        'user-agent': TILE_USER_AGENT,
        referer,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      return textError(
        'Map tiles are temporarily unavailable.',
        upstream.status === 404 ? 404 : 503,
        { 'retry-after': '30', 'x-customs-map-cache': 'BYPASS' },
      );
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return textError('Map tiles are temporarily unavailable.', 502);
    }

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > 1_500_000) {
      return textError('Map tile response exceeded the size limit.', 502);
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 1_500_000) {
      return textError('Map tile response exceeded the size limit.', 502);
    }

    const headers = new Headers();
    for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'expires', 'vary']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('cache-control') && !headers.has('expires')) {
      headers.set('cache-control', 'public, max-age=604800, s-maxage=604800');
    }
    headers.set('x-customs-map-cache', 'MISS');

    const response = new Response(bytes, { status: 200, headers });
    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        // Do not fail a successful tile response on cache-write issues.
      }
    }

    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return textError('Map tiles are temporarily unavailable.', 503, { 'retry-after': '30' });
  }
};
