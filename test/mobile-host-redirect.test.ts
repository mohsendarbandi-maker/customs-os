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
    expect(html).toContain('const appleDesktopMode = /macintosh|mac os x/i.test(ua)');
    expect(html).toContain('navigator.userAgentData?.mobile === true');
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

  it('redirects phone page visits from the primary hostname and keeps the mobile hostname standalone', () => {
    const worker = read('worker/index.ts');
    const workflow = read('.github/workflows/build.yml');

    expect(worker).toContain("const isPrimaryDomain = legacyHost === 'darbandicommercial.ir' || legacyHost === 'www.darbandicommercial.ir'");
    expect(worker).toContain("const isPhoneOrTablet = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent)");
    expect(worker).toContain("request.headers.get('sec-ch-ua-mobile') === '?1'");
    expect(worker).toContain('const isMobileRequest = isPhoneOrTablet');
    expect(worker).toContain("mobileUrl.hostname = 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("status: 302");
    expect(worker).toContain("'X-Customs-OS-Mobile-Redirect': '1'");
    expect(worker).not.toContain('const isDesktopBrowser =');
    expect(workflow).toContain('Phone visits to the primary domain must redirect to the mobile alias');
    expect(workflow).toContain('Desktop requests to the mobile alias remain on the requested mobile hostname');
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
