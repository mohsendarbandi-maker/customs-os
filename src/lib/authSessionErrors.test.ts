import { describe, expect, it } from 'vitest';
import { isAuthTokenExpiredError, isRetryableAuthSessionError, isUnrecoverableAuthSessionError } from './authSessionErrors';

describe('isAuthTokenExpiredError', () => {
  it('recognizes expired or invalid JWT responses', () => {
    expect(isAuthTokenExpiredError({ status: 401, message: 'JWT expired' })).toBe(true);
    expect(isAuthTokenExpiredError({ code: 'PGRST301', message: 'JWT is invalid' })).toBe(true);
    expect(isAuthTokenExpiredError({ code: 'PGRST303', message: 'JWT claims are invalid' })).toBe(true);
    expect(isAuthTokenExpiredError({ message: 'Invalid JWT' })).toBe(true);
  });

  it('does not refresh for generic 401s or a missing Authorization header', () => {
    expect(isAuthTokenExpiredError({ status: 401, message: 'Permission denied' })).toBe(false);
    expect(isAuthTokenExpiredError({ status: 401, code: 'PGRST302', message: 'No Authorization header' })).toBe(false);
    expect(isAuthTokenExpiredError({ status: 500, message: 'Database unavailable' })).toBe(false);
    expect(isAuthTokenExpiredError(new Error('Failed to fetch'))).toBe(false);
    expect(isAuthTokenExpiredError(null)).toBe(false);
  });
});

describe('isRetryableAuthSessionError', () => {
  it('treats Auth 429/rate-limit responses as temporary and preserves the local session', () => {
    expect(isRetryableAuthSessionError({ status: 429, message: 'Too Many Requests' })).toBe(true);
    expect(isRetryableAuthSessionError({ code: 'over_request_rate_limit' })).toBe(true);
    expect(isRetryableAuthSessionError(new Error('429: Request rate limit reached'))).toBe(true);
  });

  it('recognizes transient network failures but not unrelated API errors', () => {
    expect(isRetryableAuthSessionError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableAuthSessionError({ status: 403, message: 'Forbidden' })).toBe(false);
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
