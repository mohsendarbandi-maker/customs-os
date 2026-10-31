import { describe, expect, it } from 'vitest';
import { describeDevice, getSessionIdFromAccessToken } from './deviceSessions';

const encode = (value: unknown) => {
  const bytes = btoa(JSON.stringify(value));
  return bytes.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

describe('device session helpers', () => {
  it('reads a validated session id from a Supabase access token', () => {
    const id = '0d0a1b2c-3d4e-4f50-8a90-123456789abc';
    const token = `header.${encode({ session_id: id, sub: 'user-id' })}.signature`;

    expect(getSessionIdFromAccessToken(token)).toBe(id);
  });

  it('rejects malformed, missing, or non-session tokens', () => {
    expect(getSessionIdFromAccessToken(null)).toBeNull();
    expect(getSessionIdFromAccessToken('not-a-jwt')).toBeNull();
    expect(getSessionIdFromAccessToken(`header.${encode({ sub: 'user-id' })}.signature`)).toBeNull();
    expect(getSessionIdFromAccessToken(`header.${encode({ session_id: 'not-a-uuid' })}.signature`)).toBeNull();
  });

  it('labels common device and browser combinations', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1'))
      .toBe('آیفون · Safari');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'))
      .toBe('ویندوز · Chrome');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0'))
      .toBe('لینوکس · Firefox');
  });
});
