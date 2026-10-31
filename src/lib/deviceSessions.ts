const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getSessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;

  try {
    const encodedPayload = accessToken.split('.')[1];
    if (!encodedPayload) return null;

    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof payload.session_id === 'string' && SESSION_ID_PATTERN.test(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent || '';

  const device = /iPhone/i.test(ua)
    ? 'آیفون'
    : /iPad/i.test(ua)
      ? 'آیپد'
      : /Android/i.test(ua)
        ? 'اندروید'
        : /Windows/i.test(ua)
          ? 'ویندوز'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'مک'
            : /CrOS/i.test(ua)
              ? 'کروم‌بوک'
              : /Linux/i.test(ua)
                ? 'لینوکس'
                : 'دستگاه دیگر';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Firefox\//i.test(ua)
      ? 'Firefox'
      : /OPR\//i.test(ua)
        ? 'Opera'
        : /Chrome\//i.test(ua) && !/Edg\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'مرورگر';

  return `${device} · ${browser}`;
}
