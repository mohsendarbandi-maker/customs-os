import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareAuthError,
  changeCloudflarePassword,
  getCloudflareAuthSession,
  getCloudflareDeviceSessions,
  revokeCloudflareDeviceSession,
  signInWithCloudflarePassword,
  signOutFromCloudflare,
} from './cloudflareAuthClient';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Cloudflare auth browser client', () => {
  it('uses a one-time proof and never sends the plaintext password to the Worker', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/challenge')) {
        return jsonResponse({
          challenge_id: '550e8400-e29b-41d4-a716-446655440000',
          challenge: 'a'.repeat(64),
          salt: 'b'.repeat(64),
          iterations: 600_000,
          expires_in: 120,
        });
      }
      return jsonResponse({
        authenticated: true,
        user: { id: 'owner-1', email: 'owner@example.com', full_name: 'مدیر' },
        profile: {
          id: 'owner-1', organization_id: 'org-1', role: 'owner',
          client_id: null, full_name: 'مدیر', phone: null, is_active: true,
        },
        session_id: '550e8400-e29b-41d4-a716-446655440000',
        password_reset_required: false,
      });
    }) as typeof fetch;

    const result = await signInWithCloudflarePassword(' OWNER@Example.com ', 'Strong-Password-2026!');
    expect(result.authenticated).toBe(true);
    expect(calls.map(call => call.url)).toEqual(['/api/auth/challenge', '/api/auth/login']);
    const loginBody = String(calls[1].init.body);
    expect(loginBody).not.toContain('Strong-Password-2026!');
    expect(loginBody).toContain('proof');
    expect(calls.every(call => call.init.credentials === 'same-origin')).toBe(true);
    expect(calls.every(call => call.init.cache === 'no-store')).toBe(true);
  });

  it('returns the HTTP-only session state using a same-origin request', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ authenticated: false })) as typeof fetch;
    await expect(getCloudflareAuthSession()).resolves.toEqual({ authenticated: false });
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('rethrows server error codes as typed CloudflareAuthError values', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'RATE_LIMITED' }, 429)) as typeof fetch;
    await expect(getCloudflareAuthSession()).rejects.toMatchObject({
      name: 'CloudflareAuthError',
      code: 'RATE_LIMITED',
      status: 429,
    } satisfies Partial<CloudflareAuthError>);
  });

  it('uses the authenticated session email for password-change proof and only sends a derived verifier', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/session')) {
        return jsonResponse({
          authenticated: true,
          user: { id: 'owner-1', email: 'owner@example.com', full_name: 'مدیر' },
        });
      }
      if (url.endsWith('/password/challenge')) {
        return jsonResponse({
          challenge_id: '550e8400-e29b-41d4-a716-446655440000',
          challenge: 'a'.repeat(64),
          salt: 'b'.repeat(64),
          iterations: 600_000,
          expires_in: 120,
        });
      }
      return jsonResponse({ ok: true, password_reset_required: false });
    }) as typeof fetch;

    const result = await changeCloudflarePassword(
      'Strong-Password-2026!',
      'Even-Stronger-Password-2026!',
    );
    expect(result.ok).toBe(true);
    expect(calls.map(call => call.url)).toEqual([
      '/api/auth/session',
      '/api/auth/password/challenge',
      '/api/auth/password/change',
    ]);
    const changeBody = String(calls[calls.length - 1].init.body);
    expect(changeBody).not.toContain('Strong-Password-2026!');
    expect(changeBody).not.toContain('Even-Stronger-Password-2026!');
    expect(changeBody).toContain('new_verifier');
  });

  it('supports logout and device-session listing/revocation', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/devices')) {
        return jsonResponse({ ok: true, sessions: [], limit: 50 });
      }
      return jsonResponse({ ok: true, revoked_count: 1 });
    }) as typeof fetch;
    await signOutFromCloudflare();
    await expect(getCloudflareDeviceSessions()).resolves.toEqual([]);
    await revokeCloudflareDeviceSession('550e8400-e29b-41d4-a716-446655440000');
    expect(calls.map(call => call.url)).toEqual([
      '/api/auth/logout',
      '/api/auth/devices',
      '/api/auth/devices/550e8400-e29b-41d4-a716-446655440000',
    ]);
  });

  it('rejects malformed device session ids before making a network request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(revokeCloudflareDeviceSession('not-a-uuid')).rejects.toThrow('INVALID_DEVICE_SESSION_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
