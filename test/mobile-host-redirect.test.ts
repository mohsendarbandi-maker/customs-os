import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('mobile hostname routing without cross-origin session sharing', () => {
  it('routes genuine phones to mobile while refusing the old viewport-size heuristic', () => {
    const html = read('index.html');

    expect(html).toContain("target.hostname = 'mobile.darbandicommercial.ir'");
    expect(html).toContain('const mobileDevice = /android|iphone|ipad|ipod|mobile/i.test(ua) || appleTablet;');
    expect(html).toContain('navigator.maxTouchPoints');
    expect(html).toContain("window.matchMedia('(display-mode: standalone)').matches");
    expect(html).toContain('navigator.standalone === true');
    expect(html).not.toContain('touchSmall');
    expect(html).not.toContain("window.matchMedia('(pointer: coarse)')");
  });

  it('does not copy rotating Auth tokens through a cross-origin postMessage bridge', () => {
    const html = read('index.html');

    expect(html).not.toContain("type: 'customs-auth-sync'");
    expect(html).not.toContain('event.origin !== mobileOrigin');
    expect(html).not.toContain('postMessage');
    expect(html).not.toContain("target.searchParams.set('token'");
    expect(html).toContain("target.hostname = 'mobile.darbandicommercial.ir'");
  });

  it('redirects desktop browsers off the mobile hostname while keeping real phones there', () => {
    const worker = read('worker/index.ts');
    const workflow = read('.github/workflows/build.yml');

    expect(worker).toContain("const isMobileHost = legacyHost === 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("const isDesktopBrowser = /Windows NT|X11|CrOS/i.test(userAgent)");
    expect(worker).toContain("canonical.hostname = 'darbandicommercial.ir'");
    const legacyBlock = worker.slice(
      worker.indexOf('const isLegacyAppOrigin'),
      worker.indexOf('const isLegacyIntegrationRequest'),
    );
    expect(legacyBlock).not.toContain("'mobile.darbandicommercial.ir'");
    expect(workflow).toContain('Desktop visits to mobile alias must redirect');
    expect(workflow).toContain('Phone UA remains on mobile host');
  });

  it('keeps the retired bridge endpoint private although the app no longer invokes it', () => {
    const html = read('index.html');
    const worker = read('worker/index.ts');

    expect(html).not.toContain('__auth-bridge.html');
    expect(worker).toContain("url.pathname === '/__auth-bridge.html'");
    expect(worker).toContain("headers.set('Cache-Control', 'no-store, private')");
    expect(worker).toContain('frame-ancestors https://darbandicommercial.ir');
    expect(worker).not.toContain("headers.set('X-Frame-Options', 'SAMEORIGIN')");
  });
});
