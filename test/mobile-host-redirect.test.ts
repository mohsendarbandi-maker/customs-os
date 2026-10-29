import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
describe('mobile hostname handoff', () => {
  it('routes phone browsers to the mobile host and preserves the route', () => {
    const html = read('index.html');
    expect(html).toContain('mobile.darbandicommercial.ir');
    expect(html).toContain('window.location.replace(target.toString())');
    expect(html).toContain('const target = new URL(window.location.href)');
    expect(html).toContain('navigator.maxTouchPoints');
  });
  it('transfers auth only via nonce-scoped postMessage and never via URL parameters', () => {
    const html = read('index.html');
    const bridge = read('public/__auth-bridge.html');
    expect(html).toContain("event.origin !== mobileOrigin");
    expect(html).toContain('event.source !== frame.contentWindow');
    expect(html).toContain("type: 'customs-auth-sync'");
    expect(bridge).toContain("event.origin !== MAIN_ORIGIN");
    expect(bridge).toContain("event.source !== window.parent");
    expect(bridge).toContain("window.localStorage.setItem(STORAGE_KEY, event.data.value)");
    expect(html).not.toContain('target.searchParams.set(\'token\'');
  });
  it('serves the bridge as a private non-cached document with a narrow frame allowlist', () => {
    const worker = read('worker/index.ts');
    expect(worker).toContain("url.pathname === '/__auth-bridge.html'");
    expect(worker).toContain("headers.set('Cache-Control', 'no-store, private')");
    expect(worker).toContain('frame-ancestors https://darbandicommercial.ir');
    expect(worker).not.toContain("headers.set('X-Frame-Options', 'SAMEORIGIN')");
  });
});
