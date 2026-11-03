/**
 * Keep Supabase's saved session when a refresh request is temporarily rejected.
 *
 * auth-js 2.118.0 treats HTTP 429/408 (and refresh-token 409 conflicts) as
 * non-retryable AuthApiError responses. Once the access JWT has expired, its
 * refresh path can then remove the still-valid refresh token and emit SIGNED_OUT.
 *
 * Convert only transient failures from the refresh-token grant into 503, which
 * auth-js already classifies as infrastructure-retryable. A short same-origin
 * cooldown prevents the SDK's bounded backoff and sibling tabs from repeatedly
 * hitting the already-throttled upstream endpoint. Password sign-in and all
 * other Auth endpoints retain their original status and error payload.
 */
export const AUTH_REFRESH_COOLDOWN_MS = 30_000;
export const AUTH_REFRESH_COOLDOWN_STORAGE_KEY = 'customs-os-auth-refresh-cooldown-v1';

const TRANSIENT_REFRESH_STATUSES = new Set([408, 409, 429]);

function isRefreshTokenRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const request = new Request(input, init);
    const url = new URL(request.url);
    return (
      request.method.toUpperCase() === 'POST' &&
      /\/auth\/v1\/token\/?$/i.test(url.pathname) &&
      url.searchParams.get('grant_type') === 'refresh_token'
    );
  } catch {
    return false;
  }
}

function readCooldownUntil(memoryCooldownUntil: number): number {
  let persistedCooldownUntil = 0;
  try {
    if (typeof window !== 'undefined') {
      const rawValue = window.localStorage.getItem(AUTH_REFRESH_COOLDOWN_STORAGE_KEY);
      const parsed = rawValue ? Number(rawValue) : 0;
      if (Number.isFinite(parsed) && parsed > 0) persistedCooldownUntil = parsed;
    }
  } catch {
    // A disabled browser store must not prevent the network request.
  }
  return Math.max(memoryCooldownUntil, persistedCooldownUntil);
}

function persistCooldownUntil(until: number): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_REFRESH_COOLDOWN_STORAGE_KEY, String(until));
    }
  } catch {
    // The in-memory guard remains active for this page.
  }
}

function clearPersistedCooldown(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(AUTH_REFRESH_COOLDOWN_STORAGE_KEY);
    }
  } catch {
    // The in-memory guard is still cleared by the caller.
  }
}

function temporaryRefreshUnavailable(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      code: 'auth_refresh_temporarily_unavailable',
      message: 'The authentication service temporarily throttled session refresh. The saved session was preserved.',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(Math.max(1, retryAfterSeconds)),
        'X-Customs-OS-Auth-Refresh': 'temporary-backoff',
      },
    },
  );
}

export function createAuthRefreshResilientFetch(
  fetchImpl: typeof fetch,
  cooldownMs = AUTH_REFRESH_COOLDOWN_MS,
): typeof fetch {
  let memoryCooldownUntil = 0;

  return async (input, init) => {
    if (!isRefreshTokenRequest(input, init)) {
      return fetchImpl(input, init);
    }

    const now = Date.now();
    const activeCooldownUntil = readCooldownUntil(memoryCooldownUntil);
    if (activeCooldownUntil > now) {
      return temporaryRefreshUnavailable(Math.ceil((activeCooldownUntil - now) / 1000));
    }

    // Clear expired cross-tab state before allowing a fresh upstream attempt.
    if (activeCooldownUntil > 0) clearPersistedCooldown();
    memoryCooldownUntil = 0;

    const response = await fetchImpl(input, init);
    if (TRANSIENT_REFRESH_STATUSES.has(response.status)) {
      memoryCooldownUntil = Date.now() + Math.max(1, cooldownMs);
      persistCooldownUntil(memoryCooldownUntil);
      return temporaryRefreshUnavailable(Math.ceil(cooldownMs / 1000));
    }

    if (response.ok) {
      memoryCooldownUntil = 0;
      clearPersistedCooldown();
    }

    return response;
  };
}
