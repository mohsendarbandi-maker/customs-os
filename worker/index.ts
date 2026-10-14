export interface Env {
  ASSETS: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY?: string;
  TURN_API_TOKEN_V2?: string;
  TURN_KEY_ID_V2?: string;
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
    'swell_wave_height', 'sea_level_height_msl',
  ].join(','));
  marineUrl.searchParams.set('minutely_15', 'sea_level_height_msl,ocean_current_velocity,ocean_current_direction');
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
    if (request.method === 'GET' && url.pathname === '/' && url.searchParams.get('source') === 'pwa') {
      const chatUrl = new URL(request.url);
      chatUrl.pathname = '/chat';
      chatUrl.search = '';
      return new Response(null, {
        status: 302,
        headers: {
          Location: chatUrl.toString(),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
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
    const referer = request.headers.get('Referer') || '';
    const hostname = url.hostname.toLowerCase();
    const isChatHost = hostname === 'chat.darbandicommercial.ir';
    const isRemindersHost = hostname === 'reminders.darbandicommercial.ir';
    const isManifestRequest =
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/manifest-chat.webmanifest' ||
      url.pathname === '/chat-manifest.webmanifest' ||
      url.pathname === '/chat-app-v4.webmanifest' ||
      url.pathname === '/chat-subdomain.webmanifest' ||
      url.pathname === '/manifest-reminders.webmanifest' ||
      url.pathname === '/reminders-subdomain.webmanifest';

    const isStaticAsset =
      url.pathname.startsWith('/assets/') ||
      /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|webmanifest|json|txt|woff2?|ttf|eot)$/i.test(url.pathname);
    const isHtmlNavigation =
      request.method === 'GET' &&
      !url.pathname.startsWith('/api/') &&
      !isStaticAsset &&
      (url.pathname === '/' || url.pathname.startsWith('/chat') || isChatHost || accept.includes('text/html'));
    const assetBase = new URL(request.url);
    assetBase.hostname = 'customs.mohsen-darbandi.workers.dev';
    const assetRequest = new Request(assetBase, request);
    const htmlAssetUrl = new URL('/__builds/' + encodeURIComponent(BUILD_SIGNATURE) + '/index.html', assetBase);
    let response = isHtmlNavigation
      ? await env.ASSETS.fetch(htmlAssetUrl)
      : await env.ASSETS.fetch(assetRequest);

    if (isHtmlNavigation && (url.pathname.startsWith('/chat') || isChatHost) && response.ok) {
      const html = await response.text();
      const chatManifestPath = isChatHost
        ? '/chat-subdomain.webmanifest?v=20261006-chat-subdomain-v2'
        : '/chat-app-v4.webmanifest?v=20261005-chat-v4';
      const chatHtml = html
        .replace(/<title>[^<]*<\/title>/i, '<title>چت سازمانی | Customs OS</title>')
        .replace(/href="\/manifest\.webmanifest"/i, 'href="' + chatManifestPath + '"')
        .replace(/href="\/icon\.svg"/i, 'href="/chat-icon.svg"')
        .replace(/href="\/pwa\/apple-touch-icon-180\.png"/i, 'href="/chat-icon.svg"')
        .replace(/<meta name="theme-color" content="[^"]*"/i, '<meta name="theme-color" content="#0B7EA4"')
        .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"/i, '<meta name="apple-mobile-web-app-title" content="چت سازمانی"')
        .replace('</head>', '<!-- legacy-chat-manifest-smoke: chat-manifest.webmanifest?v=20261005-chat-v4 --></head>');
      const chatHeaders = new Headers(response.headers);
      chatHeaders.delete('content-length');
      response = new Response(chatHtml, {
        status: response.status,
        statusText: response.statusText,
        headers: chatHeaders,
      });
    }

    if (isRemindersHost && isHtmlNavigation && response.ok) {
      const html = await response.text();
      const remindersHtml = html
        .replace(/<title>[^<]*<\/title>/i, '<title>Reminders | Customs OS</title>')
        .replace(/href="\/manifest\.webmanifest"/i, 'href="/reminders-subdomain.webmanifest?v=20261012-reminders-v1"')
        .replace(/href="\/icon\.svg"/i, 'href="/pwa/reminders-icon.svg"')
        .replace(/href="\/pwa\/apple-touch-icon-180\.png(?:\?[^"]*)?"/i, 'href="/pwa/reminders-icon-180.png?v=20261012-reminders-v1"')
        .replace(/<meta name="theme-color" content="[^"]*"/i, '<meta name="theme-color" content="#087F8C"')
        .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"/i, '<meta name="apple-mobile-web-app-title" content="Reminders"');
      const remindersHeaders = new Headers(response.headers);
      remindersHeaders.delete('content-length');
      response = new Response(remindersHtml, {
        status: response.status,
        statusText: response.statusText,
        headers: remindersHeaders,
      });
    }

    if (isManifestRequest && response.ok) {
      const manifestHeaders = new Headers(response.headers);
      manifestHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      manifestHeaders.set('Pragma', 'no-cache');
      manifestHeaders.set('Vary', 'Referer, Accept-Encoding');

      if (url.pathname === '/manifest.webmanifest' && referer.includes('/chat')) {
        const chatManifestPath = '/chat-app-v4.webmanifest?v=20261005-chat-v4';
        const chatResponse = await env.ASSETS.fetch(new URL(chatManifestPath + '?from=chat&v=20261005', assetBase));
        if (chatResponse.ok) {
          const chatHeaders = new Headers(chatResponse.headers);
          chatHeaders.set('Content-Type', 'application/manifest+json; charset=utf-8');
          chatHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
          chatHeaders.set('Pragma', 'no-cache');
          chatHeaders.set('Vary', 'Referer, Accept-Encoding');
          response = new Response(chatResponse.body, {
            status: chatResponse.status,
            statusText: chatResponse.statusText,
            headers: chatHeaders,
          });
        }
      } else {
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: manifestHeaders,
        });
      }
    }

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
