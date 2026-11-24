import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCloudflareRecoveryHost, isCloudflareStagingHost } from './recoveryHost';

const setHostname = (hostname: string) => {
  vi.stubGlobal('window', { location: { hostname } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cloudflare staging authentication host gate', () => {
  it('uses the D1 recovery login only on the isolated staging Worker', () => {
    setHostname('customs-os-migration-staging.mohsen-darbandi.workers.dev');

    expect(isCloudflareStagingHost()).toBe(true);
    expect(isCloudflareRecoveryHost()).toBe(true);
  });

  it.each([
    'darbandicommercial.ir',
    'mobile.darbandicommercial.ir',
    'chat.darbandicommercial.ir',
    'reminders.darbandicommercial.ir',
    'customs.mohsen-darbandi.workers.dev',
    'localhost',
  ])('keeps %s outside the D1 staging login flow', (hostname) => {
    setHostname(hostname);

    expect(isCloudflareStagingHost()).toBe(false);
    expect(isCloudflareRecoveryHost()).toBe(false);
  });

  it('returns false when executed without a browser window', () => {
    vi.stubGlobal('window', undefined);

    expect(isCloudflareStagingHost()).toBe(false);
    expect(isCloudflareRecoveryHost()).toBe(false);
  });
});
