import { describe, expect, it } from 'vitest';
import { isAuthTokenExpiredError, isUnrecoverableAuthSessionError } from './authSessionErrors';

describe('isAuthTokenExpiredError', () => {
  it('recognizes expired JWT and unauthorized profile responses', () => {
    expect(isAuthTokenExpiredError({ status: 401, message: 'JWT expired' })).toBe(true);
    expect(isAuthTokenExpiredError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthTokenExpiredError({ message: 'Invalid JWT' })).toBe(true);
  });

  it('does not mistake ordinary profile or network errors for an expired JWT', () => {
    expect(isAuthTokenExpiredError({ status: 500, message: 'Database unavailable' })).toBe(false);
    expect(isAuthTokenExpiredError(new Error('Failed to fetch'))).toBe(false);
    expect(isAuthTokenExpiredError(null)).toBe(false);
  });
});

describe('isUnrecoverableAuthSessionError', () => {
  it('identifies revoked or invalid refresh tokens', () => {
    expect(
      isUnrecoverableAuthSessionError({
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      }),
    ).toBe(true);
    expect(isUnrecoverableAuthSessionError({ code: 'refresh_token_not_found' })).toBe(true);
    expect(isUnrecoverableAuthSessionError({ code: 'invalid_grant' })).toBe(true);
  });

  it('does not treat temporary network errors as logout', () => {
    expect(isUnrecoverableAuthSessionError(new Error('Failed to fetch'))).toBe(false);
    expect(
      isUnrecoverableAuthSessionError({
        message: 'Network error while requesting refresh token',
      }),
    ).toBe(false);
    expect(isUnrecoverableAuthSessionError({ message: 'Gateway timeout' })).toBe(false);
  });

  it('handles missing or unrelated errors safely', () => {
    expect(isUnrecoverableAuthSessionError(null)).toBe(false);
    expect(isUnrecoverableAuthSessionError('offline')).toBe(false);
    expect(isUnrecoverableAuthSessionError({ message: 'Database unavailable' })).toBe(false);
  });
});
