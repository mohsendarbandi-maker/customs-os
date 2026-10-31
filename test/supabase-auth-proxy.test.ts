import { describe, expect, it } from 'vitest';
import { applySupabaseAuthForwardedFor } from '../worker/supabaseAuthProxy';

describe('Supabase Auth proxy client-IP forwarding', () => {
  it('uses the Worker-only secret key and forwards the verified IP on token requests', () => {
    const headers = new Headers({
      apikey: 'sb_publishable_test',
      Authorization: 'Bearer user-access-token',
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
  });

  it('never forwards the secret key to non-token endpoints', () => {
    const headers = new Headers({ apikey: 'sb_publishable_test' });

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
  });

  it('keeps existing proxy behavior when the secret or client IP is unavailable', () => {
    const headers = new Headers({ apikey: 'sb_publishable_test' });

    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', null, 'sb_secret_test')).toBe(false);
    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', '203.0.113.10')).toBe(false);
    expect(applySupabaseAuthForwardedFor(headers, '/auth/v1/token', 'not-an-ip', 'sb_secret_test')).toBe(false);
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    expect(headers.has('Sb-Forwarded-For')).toBe(false);
  });
});
