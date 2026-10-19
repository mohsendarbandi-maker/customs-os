export interface Env {
  ASSETS: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY?: string;
  TURN_API_TOKEN_V2?: string;
  TURN_KEY_ID_V2?: string;
  MESSENGER_EGRESS_SECRET?: string;
  /** Comma-separated exact HTTPS hostnames returned by provider media APIs, manually reviewed. No wildcards. */
  MESSENGER_EGRESS_EXTRA_HOSTS?: string;
}

const BUILD_SIGNATURE = '20261013-reminders-list-first-teal-theme';

const EDGE_FUNCTIONS = new Set([
  'ai-assistant', 'ai-core', 'ai-operator', 'ai-voice', 'knowledge-ai',
  'owner-console', 'scan-chat-file', 'send-chat-push', 'send-reminders',
  'sync-vessel-ais', 'sync-vessel-ais-v2', 'vessel-multi-source',
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const BASE_MESSENGER_HOSTS = new Set([
  'api.telegram.org', 'botapi.rubika.ir', 'tapi.bale.ai', 'graph.facebook.com',
]);
const isMetaMediaHost = (host: string) => host.endsWith('.fbsbx.com') ||
  host.endsWith('.fbcdn.net') || host.endsWith('.whatsapp.net');
function exactExtraMessengerHosts(env: Env): Set<string> {
  return new Set((env.MESSENGER_EGRESS_EXTRA_HOSTS || '').split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 0 && value.length <= 253 && value.includes('.') &&
      !/\.(?:localhost|local|internal|test|invalid)$/i.test(value) &&
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(value) &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)));
}
function allowedMessengerEgressHost(hostValue: string, env: Env): boolean {
  const host = hostValue.toLowerCase();
  if (host.endsWith('.')) return false;
  return BASE_MESSENGER_HOSTS.has(host) || isMetaMediaHost(host) || exactExtraMessengerHosts(env).has(host);
}


type ExternalJson = Record<string, any>;

async function fetchExternalJson(endpoint: string, provider: string): Promise<ExternalJson> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(7500),
      });
      if (!response.ok) {
        throw new Error(`${provider} HTTP ${response.status}`);
      }
      const payload = await response.json() as ExternalJson;
      if (payload && (payload.error === true || typeof payload.reason === 'string')) {
        throw new Error(`${provider} returned unavailable model data`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${provider} unavailable`);
}

function maritimeJson(payload: unknown, status = 200, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Customs-OS-Proxy': 'cloudflare',
    },
  });
}


// OpenStreetMap tiles are proxied only on demand (no prefetch). Preserve upstream
// cache directives, identify this application, and send a valid first-party Referer.
async function serveMapTile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  if (parts.length !== 7 || parts[1] !== 'api' || parts[2] !== 'map' || parts[3] !== 'tiles') {
    return json({ error: 'آدرس کاشی نقشه معتبر نیست.' }, 400);
  }
  const zRaw = parts[4], xRaw = parts[5], yRaw = parts[6].endsWith('.png') ? parts[6].slice(0, -4) : '';
  const isDigits = (value: string, maxLength: number) => value.length > 0 && value.length <= maxLength && [...value].every((character) => character >= '0' && character <= '9');
  if (!isDigits(zRaw, 2) || !isDigits(xRaw, 8) || !isDigits(yRaw, 8)) return json({ error: 'آدرس کاشی نقشه معتبر نیست.' }, 400);
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || z < 0 || z > 19) {
    return json({ error: 'بزرگ‌نمایی نقشه خارج از محدوده مجاز است.' }, 400);
  }
  const dimension = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= dimension || y >= dimension) {
    return json({ error: 'مختصات کاشی نقشه معتبر نیست.' }, 400);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const cacheKey = new Request(new URL(url.pathname, url.origin).toString(), { method: 'GET' });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Customs-Map-Cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
  } catch (error) {
    console.warn('[Map tile] cache read unavailable:', error instanceof Error ? error.message : String(error));
  }

  const tileUrl = 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
  const incomingReferrer = request.headers.get('Referer');
  let referrer = new URL('/marine-conditions', url.origin).toString();
  try {
    if (incomingReferrer && new URL(incomingReferrer).origin === url.origin) referrer = incomingReferrer;
  } catch { /* use the stable first-party referrer */ }

  try {
    const upstream = await fetch(tileUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/png,*/*;q=0.8',
        'User-Agent': 'Customs OS/1.0 (+https://darbandicommercial.ir)',
        Referer: referrer,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      console.error('[Map tile] upstream returned HTTP', upstream.status, 'z=' + z + ' x=' + x + ' y=' + y);
      return new Response('Map tiles are temporarily unavailable.', {
        status: upstream.status === 404 ? 404 : 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30', 'X-Customs-Map-Cache': 'BYPASS' },
      });
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      console.error('[Map tile] upstream returned a non-image response:', contentType);
      return new Response('Map tiles are temporarily unavailable.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    const headers = new Headers();
    for (const name of ['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Expires', 'Vary']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Follow origin cache directives; use 7 days only when neither Cache-Control nor Expires exists.
    if (!headers.has('Cache-Control') && !headers.has('Expires')) headers.set('Cache-Control', 'public, max-age=604800, s-maxage=604800');
    headers.set('X-Customs-Map-Cache', 'MISS');
    const response = new Response(upstream.body, { status: 200, headers });
    try { await caches.default.put(cacheKey, response.clone()); }
    catch (error) { console.warn('[Map tile] cache write unavailable:', error instanceof Error ? error.message : String(error)); }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    console.error('[Map tile] upstream request failed:', error instanceof Error ? error.message : String(error));
    return new Response('Map tiles are temporarily unavailable.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' },
    });
  }
}

async function serveMaritimeConditions(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const latitudeRaw = url.searchParams.get('latitude');
  const longitudeRaw = url.searchParams.get('longitude');
  const latitude = latitudeRaw === null ? NaN : Number(latitudeRaw);
  const longitude = longitudeRaw === null ? NaN : Number(longitudeRaw);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return maritimeJson({ success: false, error: 'مختصات جغرافیایی معتبر نیست.' }, 400);
  }

  // Round coordinates to limit duplicate public-cache entries without visibly
  // changing port-level forecasts (roughly a 100 m grid).
  const lat = Math.round(latitude * 1000) / 1000;
  const lon = Math.round(longitude * 1000) / 1000;
  const cacheUrl = new URL('https://customs.mohsen-darbandi.workers.dev/api/maritime/conditions');
  cacheUrl.searchParams.set('latitude', lat.toFixed(3));
  cacheUrl.searchParams.set('longitude', lon.toFixed(3));
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Customs-Data-Cache', 'HIT');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
  } catch (error) {
    console.warn('[Maritime API] cache read unavailable:', error instanceof Error ? error.message : String(error));
  }

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.searchParams.set('latitude', lat.toFixed(3));
  weatherUrl.searchParams.set('longitude', lon.toFixed(3));
  weatherUrl.searchParams.set('current', [
    'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
    'precipitation', 'weather_code', 'pressure_msl', 'wind_speed_10m',
    'wind_direction_10m', 'wind_gusts_10m',
  ].join(','));
  weatherUrl.searchParams.set('hourly', 'precipitation_probability');
  weatherUrl.searchParams.set('forecast_days', '2');
  weatherUrl.searchParams.set('timezone', 'auto');

  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.searchParams.set('latitude', lat.toFixed(3));
  marineUrl.searchParams.set('longitude', lon.toFixed(3));
  marineUrl.searchParams.set('current', [
    'wave_height', 'wave_direction', 'wave_period', 'wind_wave_height',
    'swell_wave_height', 'swell_wave_direction', 'sea_surface_temperature',
    'ocean_current_velocity', 'ocean_current_direction',
  ].join(','));
  marineUrl.searchParams.set('hourly', [
    'wave_height', 'wave_direction', 'wave_period', 'wind_wave_height',
    'swell_wave_height', 'sea_level_height_msl', 'ocean_current_velocity',
    'ocean_current_direction',
  ].join(','));
  marineUrl.searchParams.set('forecast_days', '2');
  marineUrl.searchParams.set('timezone', 'auto');

  const [weatherResult, marineResult] = await Promise.allSettled([
    fetchExternalJson(weatherUrl.toString(), 'Open-Meteo weather'),
    fetchExternalJson(marineUrl.toString(), 'Open-Meteo marine'),
  ]);
  const weatherPayload = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const marinePayload = marineResult.status === 'fulfilled' ? marineResult.value : null;

  if (!weatherPayload) {
    console.error('[Maritime API] weather source failed:', weatherResult.status === 'rejected'
      ? (weatherResult.reason instanceof Error ? weatherResult.reason.message : String(weatherResult.reason))
      : 'no payload');
  }
  if (!marinePayload) {
    console.error('[Maritime API] marine source failed:', marineResult.status === 'rejected'
      ? (marineResult.reason instanceof Error ? marineResult.reason.message : String(marineResult.reason))
      : 'no payload');
  }

  if (!weatherPayload && !marinePayload) {
    return maritimeJson({
      success: false,
      error: 'سرویس‌های دادهٔ آب‌وهوا و دریا موقتاً پاسخ نمی‌دهند.',
      warnings: ['weather_unavailable', 'marine_unavailable'],
    }, 503);
  }

  const warnings: string[] = [];
  if (!weatherPayload) warnings.push('weather_unavailable');
  if (!marinePayload) warnings.push('marine_unavailable');

  const payload = {
    success: true,
    partial: warnings.length > 0,
    updated_at: new Date().toISOString(),
    location: { latitude: lat, longitude: lon },
    weather: weatherPayload ? {
      current: weatherPayload.current ?? null,
      current_units: weatherPayload.current_units ?? null,
      hourly: weatherPayload.hourly ?? null,
      hourly_units: weatherPayload.hourly_units ?? null,
      timezone: weatherPayload.timezone ?? null,
    } : null,
    marine: marinePayload ? {
      current: marinePayload.current ?? null,
      current_units: marinePayload.current_units ?? null,
      hourly: marinePayload.hourly ?? null,
      hourly_units: marinePayload.hourly_units ?? null,
      minutely_15: marinePayload.minutely_15 ?? null,
      minutely_15_units: marinePayload.minutely_15_units ?? null,
      timezone: marinePayload.timezone ?? null,
    } : null,
    sources: ['Open-Meteo Weather Forecast API', 'Open-Meteo Marine API'],
    warnings,
  };

  const response = maritimeJson(payload, 200, 'public, max-age=120, s-maxage=300');
  try {
    await caches.default.put(cacheKey, response.clone());
  } catch (error) {
    console.warn('[Maritime API] cache write unavailable:', error instanceof Error ? error.message : String(error));
  }
  const headers = new Headers(response.headers);
  headers.set('X-Customs-Data-Cache', 'MISS');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Signed server-to-server egress for messenger provider APIs. This endpoint
    // is not a general-purpose proxy: only explicit provider hosts are allowed,
    // credentials are never forwarded to the destination except provider auth,
    // and responses are streamed without caching or binary buffering.
    if (url.pathname === '/_internal/messenger-egress') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }
      const expected = env.MESSENGER_EGRESS_SECRET || '';
      const supplied = request.headers.get('x-customs-messenger-proxy-key') || '';
      const equalSecret = (a: string, b: string) => {
        if (!a || a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
      };
      if (!expected || expected.length < 32 || !equalSecret(expected, supplied)) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const rawTarget = request.headers.get('x-customs-messenger-target-url') || '';
      let target: URL;
      try {
        target = new URL(rawTarget);
      } catch {
        return json({ error: 'Invalid provider URL' }, 400);
      }
      const host = target.hostname.toLowerCase();
      const allowedHost = allowedMessengerEgressHost(host, env);
      if (
        target.protocol !== 'https:' ||
        target.username || target.password || target.port ||
        target.hash || !allowedHost
      ) {
        return json({ error: 'Provider host is not allowed' }, 403);
      }
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('content-length');
      headers.delete('x-customs-messenger-proxy-key');
      headers.delete('x-customs-messenger-target-url');
      // Provider bearer credentials are only needed by Meta Graph/media; never forward them to bot APIs.
      if (!(host === 'graph.facebook.com' || isMetaMediaHost(host))) headers.delete('Authorization');
      headers.delete('cookie');
      headers.delete('origin');
      headers.delete('referer');
      try {
        let currentTarget = target;
        let upstream: Response | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          upstream = await fetch(new Request(currentTarget.toString(), {
            method: request.method,
            headers,
            body: request.method === 'GET' ? undefined : request.body,
            redirect: 'manual',
          }));
          const location = upstream.headers.get('Location');
          const isRedirect = [301, 302, 303, 307, 308].includes(upstream.status);
          // Only GET downloads may follow redirects, and every hop is revalidated.
          if (request.method !== 'GET' || !isRedirect || !location) break;
          if (attempt === 3) return json({ error: 'Provider redirect limit exceeded' }, 502);
          let next: URL;
          try { next = new URL(location, currentTarget); }
          catch { return json({ error: 'Invalid provider redirect' }, 502); }
          const nextHost = next.hostname.toLowerCase();
          const nextAllowed = allowedMessengerEgressHost(nextHost, env);
          if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash || !nextAllowed) {
            await upstream.body?.cancel().catch(() => {});
            return new Response(JSON.stringify({ error: 'Provider redirect host is not allowed' }), {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                ...(!nextAllowed ? { 'X-Customs-OS-Blocked-Host': nextHost } : {}),
              },
            });
          }
          if (next.origin !== currentTarget.origin) {
            const currentHost = currentTarget.hostname.toLowerCase();
            const currentMetaHost = currentHost === 'graph.facebook.com' ||
              currentHost.endsWith('.fbsbx.com') || currentHost.endsWith('.fbcdn.net') ||
              currentHost.endsWith('.whatsapp.net');
            const nextMetaHost = nextHost === 'graph.facebook.com' ||
              nextHost.endsWith('.fbsbx.com') || nextHost.endsWith('.fbcdn.net') ||
              nextHost.endsWith('.whatsapp.net');
            if (!(currentMetaHost && nextMetaHost)) headers.delete('Authorization');
          }
          currentTarget = next;
        }
        if (!upstream) return json({ error: 'Provider request failed' }, 502);
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Cache-Control', 'no-store, private');
        responseHeaders.set('X-Customs-OS-Proxy', 'cloudflare-messenger-egress');
        responseHeaders.delete('set-cookie');
        responseHeaders.delete('content-length');
        responseHeaders.delete('location');
        responseHeaders.delete('X-Customs-OS-Blocked-Host');
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        console.error('[Messenger egress] provider request failed:', host,
          error instanceof Error ? error.message : String(error));
        return json({ error: 'Messenger provider temporarily unavailable' }, 502);
      }
    }

    // Chat and Reminders remain aliases of the unified app. The mobile hostname
    // is intentionally NOT an alias: it is a dedicated mobile-first entry point
    // sharing the same authenticated app and same-origin Cloudflare/Supabase proxy.
    const legacyHost = url.hostname.toLowerCase();
    const isLegacyAppOrigin = [
      'chat.darbandicommercial.ir',
      'reminders.darbandicommercial.ir',
    ].includes(legacyHost);
    const isLegacyIntegrationRequest =
      /^\/(?:auth|rest|storage|realtime|functions|graphql|api|webhooks)(?:\/|$)/i.test(url.pathname);
    if (isLegacyAppOrigin && ['GET', 'HEAD'].includes(request.method) && !isLegacyIntegrationRequest) {
      const canonical = new URL(url.toString());
      canonical.protocol = 'https:';
      canonical.hostname = 'darbandicommercial.ir';
      canonical.port = '';
      if (canonical.pathname === '/') {
        if (legacyHost === 'chat.darbandicommercial.ir') canonical.pathname = '/chat';
        else if (legacyHost === 'reminders.darbandicommercial.ir') canonical.pathname = '/reminders';
      }
      // Old per-area manifests now resolve to the one canonical manifest.
      if (/\.webmanifest$/i.test(canonical.pathname)) canonical.pathname = '/manifest.webmanifest';
      return new Response(null, {
        status: 301,
        headers: {
          Location: canonical.toString(),
          'Cache-Control': 'public, max-age=3600',
          'X-Customs-OS-Canonical-Redirect': '1',
        },
      });
    }

    // Requests saved by older installed PWA versions on the primary host must
    // also resolve to the single manifest, rather than falling through to the SPA shell.
    const legacyManifestPaths = new Set([
      '/chat-app-v3.webmanifest',
      '/chat-app-v4.webmanifest',
      '/chat-manifest.webmanifest',
      '/chat-subdomain.webmanifest',
      '/manifest-chat.webmanifest',
      '/manifest-reminders.webmanifest',
      '/reminders-subdomain.webmanifest',
      '/mobile-subdomain.webmanifest',
    ]);
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      url.hostname.toLowerCase() === 'darbandicommercial.ir' &&
      legacyManifestPaths.has(url.pathname)
    ) {
      const canonical = new URL(url.toString());
      canonical.protocol = 'https:';
      canonical.hostname = 'darbandicommercial.ir';
      canonical.port = '';
      canonical.pathname = '/manifest.webmanifest';
      return new Response(null, {
        status: 301,
        headers: {
          Location: canonical.toString(),
          'Cache-Control': 'public, max-age=3600',
          'X-Customs-OS-Canonical-Redirect': '1',
        },
      });
    }

    // Old installed launch URLs open the unified home, not a separate chat PWA.
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      url.hostname.toLowerCase() === 'darbandicommercial.ir' &&
      url.pathname === '/' &&
      url.searchParams.get('source') === 'pwa'
    ) {
      const canonical = new URL(url.toString());
      canonical.protocol = 'https:';
      canonical.hostname = 'darbandicommercial.ir';
      canonical.port = '';
      canonical.searchParams.delete('source');
      return new Response(null, {
        status: 301,
        headers: {
          Location: canonical.toString(),
          'Cache-Control': 'public, max-age=3600',
          'X-Customs-OS-Canonical-Redirect': '1',
        },
      });
    }

    // First-party map URL keeps browser requests on the same path as the app.
    if (url.pathname.startsWith('/api/map/tiles/')) {
      return serveMapTile(request);
    }

    // Public weather/marine data is fetched server-side from Cloudflare so end
    // users' browsers never need direct access to third-party forecast APIs.
    if (url.pathname === '/api/maritime/conditions') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (request.method !== 'GET') return maritimeJson({ error: 'Method not allowed' }, 405);
      return serveMaritimeConditions(request);
    }
    // Route every browser-facing Supabase API through this Worker. Do not cache
    // authenticated API responses: each request may contain tenant-specific data.
    if (/^\/(?:auth|rest|storage|realtime|functions|graphql)\/v1(?:\/|$)/.test(url.pathname)) {
      const target = new URL(url.pathname + url.search, env.SUPABASE_URL);
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('content-length');
      if (!headers.has('apikey') && env.SUPABASE_ANON_KEY) {
        headers.set('apikey', env.SUPABASE_ANON_KEY);
      }
      headers.set('X-Customs-OS-Proxy', 'cloudflare');

      const isWebSocket = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
      try {
        const upstreamRequest = new Request(target.toString(), {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual',
        });
        const upstream = await fetch(upstreamRequest);

        // WebSocket upgrades must be returned untouched; rebuilding a 101
        // response breaks the Realtime handshake.
        if (isWebSocket || upstream.status === 101) return upstream;

        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Cache-Control', 'no-store, private');
        responseHeaders.delete('content-length');
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        console.error('[Supabase proxy] upstream request failed:', request.method, url.pathname,
          error instanceof Error ? error.message : String(error));
        return json({ error: 'ارتباط امن با سرویس داده برقرار نشد.' }, 502);
      }
    }
    if (url.pathname === '/api/webrtc/ice') {
      if (request.method !== 'GET') {
        return request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : json({ error: 'Method not allowed' }, 405);
      }

      const authorization = request.headers.get('Authorization') || request.headers.get('authorization') || '';
      const apikey = request.headers.get('apikey') || '';
      if (!authorization || !apikey) return json({ error: 'احراز هویت تماس انجام نشد.' }, 401);

      try {
        const authCheck = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
          headers: { Authorization: authorization, apikey },
        });
        if (!authCheck.ok) return json({ error: 'نشست کاربر معتبر نیست.' }, 401);

        const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
        ];

        let turnAvailable = false;

        if (env.TURN_API_TOKEN_V2 && env.TURN_KEY_ID_V2) {
          const turnResponse = await fetch(
            'https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(env.TURN_KEY_ID_V2) + '/credentials/generate-ice-servers',
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + env.TURN_API_TOKEN_V2,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ttl: 3600 }),
            },
          );
          if (turnResponse.ok) {
            const turnData = await turnResponse.json() as { iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> };
            if (Array.isArray(turnData.iceServers)) {
              iceServers.push(...turnData.iceServers);
              turnAvailable = turnData.iceServers.length > 0;
            }
          } else {
            const detail = await turnResponse.text().catch(() => '');
            console.error('[WebRTC] TURN credential generation failed:', turnResponse.status, detail.slice(0, 500));
          }
        }

        return new Response(JSON.stringify({ iceServers, turn_available: turnAvailable, expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        console.error('[WebRTC] ICE endpoint failed:', error);
        return json({ error: 'سرویس ارتباط صوتی در دسترس نیست.' }, 503);
      }
    }

    if (url.pathname.startsWith('/api/messenger/') || url.pathname.startsWith('/webhooks/messenger/')) {
      const target = env.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/messenger-gateway' + url.search;
      const headers = new Headers(request.headers);
      const originalLength = headers.get('content-length');
      if (originalLength && !headers.has('x-file-size')) headers.set('x-file-size', originalLength);
      headers.delete('host');
      headers.delete('content-length');
      if (!headers.has('apikey') && env.SUPABASE_ANON_KEY) headers.set('apikey', env.SUPABASE_ANON_KEY);
      headers.set('x-messenger-path', url.pathname);
      try {
        const upstream = await fetch(target, { method: request.method, headers, body: ['GET','HEAD','OPTIONS'].includes(request.method) ? undefined : request.body });
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Cache-Control', 'no-store, private');
        responseHeaders.delete('content-length');
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      } catch {
        return json({ error: 'درگاه پیام‌رسان در دسترس نیست.' }, 502);
      }
    }

    if (url.pathname.startsWith('/api/edge/')) {
      if (request.method !== 'POST') {
        return request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : json({ error: 'Method not allowed' }, 405);
      }

      const name = decodeURIComponent(url.pathname.slice('/api/edge/'.length)).replace(/\/$/, '');
      if (!EDGE_FUNCTIONS.has(name)) return json({ error: 'Edge Function not allowed' }, 404);

      const target = env.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/' + name + url.search;
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('content-length');
      headers.set('X-Customs-OS-Proxy', 'cloudflare');

      try {
        const upstream = await fetch(target, { method: 'POST', headers, body: request.body });
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.delete('content-length');
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      } catch (error) {
        return json({ error: 'ارتباط Cloudflare با Supabase برقرار نشد: ' + (error instanceof Error ? error.message : String(error)) }, 502);
      }
    }

    const accept = request.headers.get('Accept') || '';

    const isStaticAsset =
      url.pathname.startsWith('/assets/') ||
      /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|webmanifest|json|txt|woff2?|ttf|eot)$/i.test(url.pathname);
    const isHtmlNavigation =
      request.method === 'GET' &&
      !url.pathname.startsWith('/api/') &&
      !isStaticAsset &&
      (url.pathname === '/' || url.pathname.startsWith('/chat') || accept.includes('text/html'));
    const assetBase = new URL(request.url);
    assetBase.hostname = 'customs.mohsen-darbandi.workers.dev';
    const assetRequest = new Request(assetBase, request);
    const htmlAssetUrl = new URL('/__builds/' + encodeURIComponent(BUILD_SIGNATURE) + '/index.html', assetBase);
    let response = isHtmlNavigation
      ? await env.ASSETS.fetch(htmlAssetUrl)
      : await env.ASSETS.fetch(assetRequest);

    // All app areas share one HTML shell. Route labels are owned by React; manifest,
    // Apple touch icon, and theme-color stay canonical and never vary by host/Referer.

    if (
      response.status === 404 &&
      request.method === 'GET' &&
      url.pathname.startsWith('/assets/') &&
      url.hostname !== 'customs.mohsen-darbandi.workers.dev'
    ) {
      const canonical = new URL(request.url);
      canonical.hostname = 'customs.mohsen-darbandi.workers.dev';
      response = await fetch(new Request(canonical, request));
    }

    // Never let the SPA fallback return HTML for a fingerprinted static asset.
    if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const contentType = response.headers.get('content-type') || '';
      const javascriptPath = /\.(?:js|mjs)$/i.test(url.pathname);
      const cssPath = /\.css$/i.test(url.pathname);
      const invalidAsset = !response.ok ||
        /text\/html/i.test(contentType) ||
        (javascriptPath && !/(?:java|ecma)script/i.test(contentType)) ||
        (cssPath && !/text\/css/i.test(contentType));
      if (invalidAsset) {
        return new Response('Static asset not found in the active build.', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    }

    if (request.method === 'GET' && (url.pathname === '/' || accept.includes('text/html') || isHtmlNavigation)) {
      const headers = new Headers(response.headers);
      headers.set('X-Customs-OS-Build', BUILD_SIGNATURE);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Vary', 'Accept-Encoding');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const finalHeaders = new Headers(response.headers);
    finalHeaders.set('X-Customs-OS-Build', BUILD_SIGNATURE);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: finalHeaders });
  },
};
