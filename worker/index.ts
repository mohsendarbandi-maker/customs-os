export interface Env {
  ASSETS: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  SUPABASE_URL: string;
  TURN_API_TOKEN_V2?: string;
  TURN_KEY_ID_V2?: string;
}

const EDGE_FUNCTIONS = new Set([
  'ai-assistant', 'ai-core', 'ai-operator', 'ai-voice', 'knowledge-ai',
  'owner-console', 'scan-chat-file', 'send-chat-push', 'send-reminders',
  'sync-vessel-ais', 'sync-vessel-ais-v2', 'vessel-multi-source',
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);


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

        if (!env.TURN_API_TOKEN_V2 || !env.TURN_KEY_ID_V2) {
          return json({ error: 'سرویس ارتباط صوتی هنوز پیکربندی نشده است.' }, 503);
        }

        {
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
          if (!turnResponse.ok) {
            const detail = await turnResponse.text().catch(() => '');
            console.error('[WebRTC] TURN credential generation failed:', turnResponse.status, detail.slice(0, 500));
            return json({ error: 'سرویس ارتباط صوتی آماده نیست.' }, 503);
          }
          const turnData = await turnResponse.json() as { iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> };
          if (Array.isArray(turnData.iceServers)) iceServers.push(...turnData.iceServers);
        }

        return new Response(JSON.stringify({ iceServers, expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        console.error('[WebRTC] ICE endpoint failed:', error);
        return json({ error: 'سرویس ارتباط صوتی در دسترس نیست.' }, 503);
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
    const isManifestRequest =
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/manifest-chat.webmanifest' ||
      url.pathname === '/manifest-reminders.webmanifest';

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
    let response = isHtmlNavigation
      ? await env.ASSETS.fetch(new URL('/index.html', assetBase))
      : await env.ASSETS.fetch(assetRequest);

    // Give /chat its own application identity before the browser evaluates the page.
    if (isHtmlNavigation && url.pathname.startsWith('/chat') && response.ok) {
      const html = await response.text();
      const chatHtml = html
        .replace(/<title>[^<]*<\/title>/i, '<title>چت سازمانی | Customs OS</title>')
        .replace(/href="\/manifest\.webmanifest"/i, 'href="/manifest-chat.webmanifest?app=chat-v3"')
        .replace(/href="\/icon\.svg"/i, 'href="/chat-icon.svg"')
        .replace(/href="\/pwa\/apple-touch-icon-180\.png"/i, 'href="/chat-icon.svg"')
        .replace(/<meta name="theme-color" content="[^"]*"/i, '<meta name="theme-color" content="#0B7EA4"')
        .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"/i, '<meta name="apple-mobile-web-app-title" content="چت سازمانی"');
      response = new Response(chatHtml, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // Safari/iOS reads the manifest during page load. Keep manifests fresh and,
    // as a safety net, serve the chat manifest when the manifest request comes
    // from a /chat page even if an older HTML/manifest reference is cached.
    if (isManifestRequest && response.ok) {
      const manifestHeaders = new Headers(response.headers);
      manifestHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      manifestHeaders.set('Pragma', 'no-cache');
      manifestHeaders.set('Vary', 'Referer, Accept-Encoding');

      if (url.pathname === '/manifest.webmanifest' && referer.includes('/chat')) {
        const chatResponse = await env.ASSETS.fetch(new URL('/manifest-chat.webmanifest?from=chat', assetBase));
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

    // A custom hostname can temporarily hold a stale negative asset lookup at the edge.
    // Recover missing static assets from the canonical Worker hostname; this path never re-enters the fallback on itself.
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

    if (request.method === 'GET' && (url.pathname === '/' || accept.includes('text/html') || isHtmlNavigation)) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Vary', 'Accept-Encoding');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};