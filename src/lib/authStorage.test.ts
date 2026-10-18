import { afterEach, describe, expect, it } from 'vitest';
import { authStorage } from './authStorage';

const testKey = 'customs-os-auth-storage-test';

afterEach(async () => {
  await authStorage.removeItem(testKey);
});

describe('Supabase auth storage fallback', () => {
  it('persists, reads and clears a session value', async () => {
    await authStorage.setItem(testKey, JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh' }));
    expect(await authStorage.getItem(testKey)).toBe(
      JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh' }),
    );
    await authStorage.removeItem(testKey);
    expect(await authStorage.getItem(testKey)).toBeNull();
  });

  it('supports async storage methods expected by Supabase Auth', async () => {
    const write = authStorage.setItem(testKey, 'session-value');
    expect(write).toBeInstanceOf(Promise);
    await write;
    expect(await authStorage.getItem(testKey)).toBe('session-value');
  });
});
