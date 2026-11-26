import { describe, expect, it } from 'vitest';
import {
  handleCloudflareAuthRoute,
  isCloudflareAuthRoute,
} from './cloudflare-auth-route';

describe('Cloudflare authentication Worker route boundary', () => {
  it('matches only the dedicated /api/auth namespace', () => {
    expect(isCloudflareAuthRoute('/api/auth')).toBe(true);
    expect(isCloudflareAuthRoute('/api/auth/login')).toBe(true);
    expect(isCloudflareAuthRoute('/api/auth/devices/abc')).toBe(true);
    expect(isCloudflareAuthRoute('/api/authentication')).toBe(false);
    expect(isCloudflareAuthRoute('/api/messenger/send')).toBe(false);
  });

  it('does not intercept unrelated application API requests', async () => {
    const request = new Request('https://darbandicommercial.ir/api/shipments');
    await expect(
      handleCloudflareAuthRoute(request, new URL(request.url), {}),
    ).resolves.toBeNull();
  });

  it('fails closed until both a dedicated D1 binding and Worker secret exist', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/session');
    const response = await handleCloudflareAuthRoute(
      request,
      new URL(request.url),
      {},
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({
      ok: false,
      error: 'AUTH_NOT_CONFIGURED',
    });
  });
});
