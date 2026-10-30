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
    const main = fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8');
    const vite = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8');
    const appShell = fs.readFileSync(path.resolve(__dirname, '../src/components/AppShell.tsx'), 'utf8');
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
