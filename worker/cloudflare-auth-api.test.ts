import { describe, expect, it } from 'vitest';
import {
  createCloudflarePasswordCredential,
  handleCloudflareAuthApi,
  normalizeAuthEmail,
  verifyCloudflarePassword,
  type CloudflareAuthDatabase,
} from './cloudflare-auth-api';

const unusedDatabase = (): CloudflareAuthDatabase => ({
  prepare() { throw new Error('database should not be touched'); },
  async batch() { throw new Error('database should not be touched'); },
});

describe('Cloudflare D1 authentication primitives', () => {
  it('normalizes Unicode-compatible email casing and whitespace', () => {
    expect(normalizeAuthEmail('  OWNER@Example.COM  ')).toBe('owner@example.com');
  });

  it('creates salted PBKDF2-SHA-256 credentials and verifies only the matching password', async () => {
    const credential = await createCloudflarePasswordCredential('Strong-Password-2026!');
    expect(credential.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.password_salt).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.password_iterations).toBe(310_000);
    await expect(
      verifyCloudflarePassword(
        'Strong-Password-2026!',
        credential.password_hash,
        credential.password_salt,
        credential.password_iterations,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyCloudflarePassword(
        'Wrong-Password-2026!',
        credential.password_hash,
        credential.password_salt,
        credential.password_iterations,
      ),
    ).resolves.toBe(false);
  });

  it('rejects short passwords at credential creation time', async () => {
    await expect(createCloudflarePasswordCredential('short')).rejects.toThrow('PASSWORD_POLICY');
  });

  it('rejects weak or malformed stored PBKDF2 parameters without deriving a key', async () => {
    await expect(verifyCloudflarePassword('test', 'bad-hash', 'a'.repeat(64), 310_000)).resolves.toBe(false);
    await expect(verifyCloudflarePassword('test', 'a'.repeat(64), 'b'.repeat(64), 1)).resolves.toBe(false);
    await expect(verifyCloudflarePassword('test', 'a'.repeat(64), 'b'.repeat(64), 1_000_001)).resolves.toBe(false);
  });
});

describe('Cloudflare D1 authentication HTTP boundary', () => {
  it('rejects cross-origin login before accessing the database', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'owner@example.com', password: 'irrelevant' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: 'ORIGIN_FORBIDDEN' });
  });

  it('returns an unauthenticated session without querying D1 when no cookie exists', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/session');
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('does not expose internal D1 errors to the caller', async () => {
    const brokenDatabase: CloudflareAuthDatabase = {
      prepare() { throw new Error('private sql internals'); },
      async batch() { throw new Error('private sql internals'); },
    };
    const request = new Request('https://darbandicommercial.ir/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://darbandicommercial.ir', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct-horse-battery-staple' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      brokenDatabase,
      new URL(request.url),
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('AUTH_STORAGE_UNAVAILABLE');
    expect(body).not.toContain('private sql internals');
  });

  it('returns a 404 for unsupported auth routes', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/unexpected');
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(404);
  });
});
