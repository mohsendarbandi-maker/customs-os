import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('single-origin Customs OS session routing', () => {
  it('does not route touch-sized Windows windows or phones to a second auth origin', () => {
    const html = read('index.html');
    const worker = read('worker/index.ts');

    expect(html).not.toContain('mobile.darbandicommercial.ir');
    expect(html).not.toContain('touchSmall');
    expect(html).not.toContain('navigator.maxTouchPoints');
    expect(html).toContain("canonicalUrl.hostname = 'darbandicommercial.ir'");

    const legacyHosts = worker.slice(
      worker.indexOf('const isLegacyAppOrigin'),
      worker.indexOf('const isLegacyIntegrationRequest'),
    );
    expect(legacyHosts).toContain("'mobile.darbandicommercial.ir'");
    expect(worker).toContain('status: 301');
  });

  it('does not copy rotating auth tokens through a cross-origin postMessage bridge', () => {
    const html = read('index.html');

    expect(html).not.toContain("type: 'customs-auth-sync'");
    expect(html).not.toContain('event.origin !== mobileOrigin');
    expect(html).not.toContain('postMessage');
    expect(html).not.toContain("target.searchParams.set('token'");
  });

  it('keeps the retired bridge endpoint private while the app no longer depends on it', () => {
    const html = read('index.html');
    const worker = read('worker/index.ts');

    expect(html).not.toContain('__auth-bridge.html');
    expect(worker).toContain("url.pathname === '/__auth-bridge.html'");
    expect(worker).toContain("headers.set('Cache-Control', 'no-store, private')");
    expect(worker).toContain('frame-ancestors https://darbandicommercial.ir');
    expect(worker).not.toContain("headers.set('X-Frame-Options', 'SAMEORIGIN')");
  });
});
