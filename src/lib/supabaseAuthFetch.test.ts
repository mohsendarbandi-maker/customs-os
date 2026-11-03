import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_REFRESH_COOLDOWN_STORAGE_KEY,
  createAuthRefreshResilientFetch,
} from './supabaseAuthFetch';

const refreshRequest = () => new Request(
  'https://darbandicommercial.ir/auth/v1/token?grant_type=refresh_token',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: 'synthetic-refresh-token' }) },
);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Supabase refresh transient-error protection', () => {
  it.each([408, 409, 429])('normalizes refresh HTTP %i to a retryable service response', async (status) => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: status === 429 ? 'over_request_rate_limit' : 'temporary_error' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fetcher = createAuthRefreshResilientFetch(upstream, 30_000);

    const response = await fetcher(refreshRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Customs-OS-Auth-Refresh')).toBe('temporary-backoff');
    expect(response.headers.get('Retry-After')).toBe('30');
    expect((await response.json()).code).toBe('auth_refresh_temporarily_unavailable');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('backs off repeated refresh calls across tabs without hitting the upstream again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => { store.delete(key); },
      },
    });

    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'over_request_rate_limit' }), { status: 429 }),
    );
    const fetcher = createAuthRefreshResilientFetch(upstream, 30_000);

    const first = await fetcher(refreshRequest());
    const second = await fetcher(refreshRequest());

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(store.has(AUTH_REFRESH_COOLDOWN_STORAGE_KEY)).toBe(true);

    await vi.advanceTimersByTimeAsync(30_001);
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-token' }), { status: 200 }));
    const afterCooldown = await fetcher(refreshRequest());

    expect(afterCooldown.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(store.has(AUTH_REFRESH_COOLDOWN_STORAGE_KEY)).toBe(false);
  });

  it('does not mask password-login rate limits or failures from unrelated endpoints', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'over_request_rate_limit' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fetcher = createAuthRefreshResilientFetch(upstream, 30_000);

    const passwordLogin = new Request(
      'https://darbandicommercial.ir/auth/v1/token?grant_type=password',
      { method: 'POST', body: JSON.stringify({ email: 'test@example.com', password: 'synthetic' }) },
    );
    const otherAuthEndpoint = new Request(
      'https://darbandicommercial.ir/auth/v1/user',
      { method: 'GET' },
    );

    expect((await fetcher(passwordLogin)).status).toBe(429);
    expect((await fetcher(otherAuthEndpoint)).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('preserves credential errors such as invalid refresh tokens unchanged', async () => {
    const errorBody = { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' };
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fetcher = createAuthRefreshResilientFetch(upstream, 30_000);

    const response = await fetcher(refreshRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(errorBody);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
