import { describe, expect, it } from 'vitest';
import { createAuthStorageAdapter } from './authStorage';

describe('Supabase Auth storage adapter', () => {
  it('persists and retrieves sessions through the primary localStorage-compatible store', async () => {
    const values = new Map<string, string>();
    const local = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const storage = createAuthStorageAdapter({
      getLocalStorage: () => local,
      getIndexedDB: () => undefined,
    });

    await storage.setItem('customs-os-auth-v3', '{"refresh_token":"test-token"}');

    expect(await storage.getItem('customs-os-auth-v3')).toBe('{"refresh_token":"test-token"}');
    expect(values.get('customs-os-auth-v3')).toBe('{"refresh_token":"test-token"}');
  });

  it('keeps a transient in-memory session when Safari blocks both durable stores', async () => {
    const storage = createAuthStorageAdapter({
      getLocalStorage: () => { throw new Error('localStorage is unavailable'); },
      getIndexedDB: () => undefined,
    });

    await storage.setItem('customs-os-auth-v3', '{"refresh_token":"test-token"}');

    expect(await storage.getItem('customs-os-auth-v3')).toBe('{"refresh_token":"test-token"}');
    await storage.removeItem('customs-os-auth-v3');
    expect(await storage.getItem('customs-os-auth-v3')).toBeNull();
  });

  it('removes the stored session instead of allowing an explicit sign-out to restore it', async () => {
    const values = new Map<string, string>();
    const local = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const storage = createAuthStorageAdapter({
      getLocalStorage: () => local,
      getIndexedDB: () => undefined,
    });

    await storage.setItem('customs-os-auth-v3', 'session');
    await storage.removeItem('customs-os-auth-v3');

    expect(values.has('customs-os-auth-v3')).toBe(false);
    expect(await storage.getItem('customs-os-auth-v3')).toBeNull();
  });
  it('does not rewrite an existing localStorage session during reads', async () => {
    const values = new Map<string, string>([['customs-os-auth-v3', 'new-session']]);
    const local = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    let indexedDBOpenCount = 0;
    const storage = createAuthStorageAdapter({
      getLocalStorage: () => local,
      getIndexedDB: () => ({
        open: () => {
          indexedDBOpenCount += 1;
          throw new Error('IndexedDB must not be touched for a primary-store read');
        },
      } as unknown as IDBFactory),
    });

    expect(await storage.getItem('customs-os-auth-v3')).toBe('new-session');
    expect(indexedDBOpenCount).toBe(0);
  });

});