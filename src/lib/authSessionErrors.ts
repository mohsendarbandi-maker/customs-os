/**
 * Distinguish revoked/invalid credentials from temporary auth transport failures.
 * A transient network failure must never delete the persisted Supabase session.
 */
export function isUnrecoverableAuthSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code ?? '').trim().toLowerCase();
  const message = String(candidate.message ?? '').trim().toLowerCase();

  const unrecoverableCodes = new Set([
    'refresh_token_not_found',
    'invalid_refresh_token',
    'invalid_grant',
    'session_not_found',
    'session_expired',
  ]);

  if (unrecoverableCodes.has(code)) return true;

  return (
    /invalid\s+refresh\s+token/.test(message) ||
    /refresh[\s_-]*token.{0,60}(not\s+found|invalid|expired|revoked|already\s+used)/.test(message) ||
    /invalid[\s_-]*grant/.test(message) ||
    /session.{0,40}(not\s+found|revoked|expired)/.test(message)
  );
}


/** True when a protected API response indicates an expired or invalid access JWT. */
export function isAuthTokenExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status = Number(candidate.status);
  const code = String(candidate.code ?? '').trim().toLowerCase();
  const message = String(candidate.message ?? '').trim().toLowerCase();

  if (status === 401) return true;
  if (['pgrst301', 'pgrst302', 'jwt_expired', 'invalid_jwt'].includes(code)) {
    return true;
  }

  return (
    /jwt.{0,30}(expired|invalid)/.test(message) ||
    /(expired|invalid).{0,30}jwt/.test(message) ||
    /no authorization header|authorization header required/.test(message)
  );
}

export const AUTH_SESSION_RETRY_MESSAGE =
  'ارتباط با سرویس احراز هویت موقتاً برقرار نشد. نشست ذخیره‌شده حذف نشده است؛ اتصال را بررسی کنید و دوباره تلاش کنید.';
