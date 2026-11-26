/**
 * Browser-side password KDF and one-time challenge proof for Cloudflare Auth.
 * PBKDF2 is intentionally performed by the browser, never inside a Worker.
 * The Worker encrypts the derived verifier with its private AUTH_PEPPER before
 * persisting it; D1-only disclosure therefore does not expose a pass-the-hash key.
 */

const PASSWORD_ITERATIONS = 310_000;
const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

const fromHex = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('INVALID_AUTH_CHALLENGE');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const normalizeCloudflareAuthEmail = (email: string) =>
  email.normalize('NFKC').trim().toLowerCase();

export interface CloudflareAuthChallenge {
  challenge_id: string;
  challenge: string;
  salt: string;
  iterations: number;
  expires_in: number;
}

export interface CloudflarePasswordVerifier {
  verifier: string;
  salt: string;
  iterations: number;
}

export async function deriveCloudflarePasswordVerifier(
  password: string,
  saltHex?: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<CloudflarePasswordVerifier> {
  if (password.length < 12 || password.length > 256) throw new Error('PASSWORD_POLICY');
  if (!Number.isInteger(iterations) || iterations !== PASSWORD_ITERATIONS) {
    throw new Error('UNSUPPORTED_PASSWORD_KDF');
  }

  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(32));
  if (salt.length !== 32) throw new Error('INVALID_PASSWORD_SALT');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const verifier = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    keyMaterial,
    256,
  ));
  return {
    verifier: toHex(verifier),
    salt: toHex(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function createCloudflareAuthProof(
  email: string,
  purpose: 'login' | 'password_change',
  challenge: CloudflareAuthChallenge,
  password: string,
): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challenge.challenge_id) ||
      !/^[0-9a-f]{64}$/i.test(challenge.challenge) ||
      !Number.isInteger(challenge.iterations) ||
      challenge.iterations !== PASSWORD_ITERATIONS) {
    throw new Error('INVALID_AUTH_CHALLENGE');
  }

  const verifier = await deriveCloudflarePasswordVerifier(
    password,
    challenge.salt,
    challenge.iterations,
  );
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    fromHex(verifier.verifier),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = [
    'customs-os-auth-proof-v1',
    purpose,
    normalizeCloudflareAuthEmail(email),
    challenge.challenge_id.toLowerCase(),
    challenge.challenge.toLowerCase(),
  ].join('\n');
  const signature = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

export async function createCloudflarePasswordVerifier(password: string) {
  return deriveCloudflarePasswordVerifier(password);
}
