import {
  createCloudflareAuthProof,
  deriveCloudflarePasswordVerifier,
  type CloudflareAuthChallenge,
} from './cloudflareAuthCrypto';

export interface CloudflareAuthProfile {
  id: string;
  organization_id: string;
  role: 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client';
  client_id: string | null;
  full_name: string;
  phone: string | null;
  is_active: boolean;
}
export interface CloudflareAuthSession {
  authenticated: true;
  user: { id: string; email: string; full_name: string };
  profile: CloudflareAuthProfile;
  session_id: string;
  password_reset_required: boolean;
}
export interface CloudflareDeviceSession {
  session_id: string;
  device_label: string;
  app_origin: string | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}
export class CloudflareAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = 'CloudflareAuthError';
    this.code = code;
    this.status = status;
  }
}

type ChallengeResponse = CloudflareAuthChallenge;

async function authRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/auth${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : 'AUTH_REQUEST_FAILED';
    throw new CloudflareAuthError(code, response.status);
  }
  return body as T;
}

const post = (body: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export async function getCloudflareAuthSession() {
  return authRequest<CloudflareAuthSession | { authenticated: false }>('/session', {
    method: 'GET',
  });
}

export async function signInWithCloudflarePassword(emailInput: string, password: string) {
  const email = emailInput.normalize('NFKC').trim().toLowerCase();
  const challenge = await authRequest<ChallengeResponse>('/challenge', post({ email }));
  const proof = await createCloudflareAuthProof(email, 'login', challenge, password);
  return authRequest<CloudflareAuthSession>('/login', post({
    email,
    challenge_id: challenge.challenge_id,
    challenge: challenge.challenge,
    proof,
  }));
}

export async function signOutFromCloudflare() {
  return authRequest<{ ok: true }>('/logout', post({}));
}

export async function changeCloudflarePassword(currentPassword: string, newPassword: string) {
  const challenge = await authRequest<ChallengeResponse>('/password/challenge', post({}));
  const proof = await createCloudflareAuthProof(
    challenge.email ?? '',
    'password_change',
    challenge,
    currentPassword,
  ).catch(async () => {
    // The Worker binds password-change challenges to the active session email;
    // fetch the session rather than accepting an email from caller input.
    const session = await getCloudflareAuthSession();
    if (!session.authenticated) throw new CloudflareAuthError('UNAUTHORIZED', 401);
    return createCloudflareAuthProof(session.user.email, 'password_change', challenge, currentPassword);
  });
  const replacement = await deriveCloudflarePasswordVerifier(newPassword);
  return authRequest<{ ok: true; password_reset_required: false }>('/password/change', post({
    challenge_id: challenge.challenge_id,
    challenge: challenge.challenge,
    proof,
    new_verifier: replacement.verifier,
    new_salt: replacement.salt,
    new_iterations: replacement.iterations,
  }));
}

export async function getCloudflareDeviceSessions() {
  const response = await authRequest<{ ok: true; sessions: CloudflareDeviceSession[]; limit: number }>(
    '/devices',
    { method: 'GET' },
  );
  return response.sessions;
}

export async function revokeCloudflareDeviceSession(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('INVALID_DEVICE_SESSION_ID');
  return authRequest<{ ok: true; revoked_count: number }>(
    `/devices/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
}

export async function revokeOtherCloudflareDeviceSessions() {
  return authRequest<{ ok: true; revoked_count: number }>('/devices/revoke-others', post({}));
}
