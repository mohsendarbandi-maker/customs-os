import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const sw = fs.readFileSync(path.resolve(__dirname, '../src/sw.ts'), 'utf8');
describe('PWA navigation cache', () => {
  it('does not persist OAuth callback URLs containing authorization or error parameters', () => {
    expect(sw).toContain("!['code','error','error_description','access_token','refresh_token','type'].some(key=>url.searchParams.has(key))");
    expect(sw).toContain("cacheName:'customs-os-navigation-v2'");
    expect(sw).toContain('networkTimeoutSeconds:1');
  });
  it('registers the custom injectManifest service worker and keeps updates user-confirmed', () => {
    const main = read('src/main.tsx');
    const vite = read('vite.config.ts');
    const appShell = read('src/components/AppShell.tsx');
    expect(vite).toContain("strategies:'injectManifest'");
    expect(vite).toContain('injectRegister:false');
    expect(main).toContain("import { registerSW } from 'virtual:pwa-register'");
    expect(main).toContain('immediate: true');
    expect(main).toContain("customs-os:pwa-update-ready");
    expect(main).toContain("customs-os:pwa-update-request");
    expect(appShell).toContain("customs-os:pwa-update-request");
    expect(main).not.toContain("registerType: 'autoUpdate'");
  });

});
