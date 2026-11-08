import { describe, expect, it } from 'vitest';
import { applySupabaseAuthForwardedFor } from '../worker/supabaseAuthProxy';

describe('Supabase Auth proxy client-IP forwarding', () => {
  it('uses the Worker-only secret key, forwards the verified IP, and replaces the browser User-Agent', () => {
    const headers = new Headers({
      apikey: 'sb_publishable_test',
      Authorization: 'Bearer user-access-token',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    });

    expect(
      applySupabaseAuthForwardedFor(
        headers,
        '/auth/v1/token',
        '203.0.113.10',
        'sb_secret_test',
      ),
    ).toBe(true);
    expect(headers.get('apikey')).toBe('sb_secret_test');
    expect(headers.get('Sb-Forwarded-For')).toBe('203.0.113.10');
    expect(headers.get('Authorization')).toBe('Bearer user-access-token');
    expect(headers.get('User-Agent')).toBe('CustomsOS-Cloudflare-Worker/1.0');
    expect(headers.get('User-Agent')).not.toMatch(/Mozilla|Safari|Chrome|Firefox/i);
  });

  it('never forwards the secret key or Worker User-Agent to non-token endpoints', () => {
    const headers = new Headers({
      apikey: 'sb_publishable_test',
      'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0',
    });

    expect(
      applySupabaseAuthForwardedFor(
        headers,
        '/rest/v1/profiles',
        '203.0.113.10',
        'sb_secret_test',
      ),
    ).toBe(false);
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    expect(headers.has('Sb-Forwarded-For')).toBe(false);
    expect(headers.get('User-Agent')).toBe('Mozilla/5.0 Chrome/130.0.0.0');
  });

  it('keeps existing proxy behavior when the secret or client IP is unavailable', () => {
    const headers = new Headers({
      apikey: 'sb_publishable_test',
      'User-Agent': 'Mozilla/5.0',
    });

    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', null, 'sb_secret_test')).toBe(false);
    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', '203.0.113.10')).toBe(false);
    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', 'not-an-ip', 'sb_secret_test')).toBe(false);
    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', '203.0.113.10', 'service_role_legacy')).toBe(false);
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    expect(headers.has('Sb-Forwarded-For')).toBe(false);
    expect(headers.get('User-Agent')).toBe('Mozilla/5.0');
  });
});
