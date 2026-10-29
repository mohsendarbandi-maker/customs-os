import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const lifecycle = read('src/features/reminders/PwaLifecycle.tsx');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  id: string; start_url: string; scope: string; display: string;
  icons: Array<{src:string;sizes:string;type:string}>;
};
const html = read('index.html');

describe('free cross-platform Customs OS PWA', () => {
  it('uses one canonical standalone app identity with install icons for iOS and Android', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some(icon => icon.sizes === '180x180' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some(icon => icon.sizes === '512x512' && icon.type === 'image/png')).toBe(true);
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('viewport-fit=cover');
  });

  it('provides an Android manual install fallback when beforeinstallprompt is unavailable', () => {
    expect(lifecycle).toContain('const isAndroid = () => /android/i.test(navigator.userAgent);');
    expect(lifecycle).toContain('pwa-android-install-guide');
    expect(lifecycle).toContain('Install app / نصب برنامه');
    expect(lifecycle).toContain('Add to Home screen / افزودن به صفحهٔ اصلی');
    expect(lifecycle).toContain('customs-os-android-install-dismissed');
    expect(lifecycle).toContain('setAndroidGuide(false)');
  });

  it('keeps iOS Home Screen install instructions and persists dismissal', () => {
    expect(lifecycle).toContain('pwa-ios-install-guide');
    expect(lifecycle).toContain('customs-os-ios-install-dismissed');
    expect(lifecycle).toContain('Safari');
    expect(lifecycle).toContain('افزودن به صفحه اصلی');
  });

  it('keeps one service-worker registration and does not add a native-only dependency', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(lifecycle.match(/registerSW\(/g)).toHaveLength(1);
    expect(pkg.dependencies).not.toHaveProperty('@capacitor/core');
    expect(pkg.dependencies).not.toHaveProperty('cordova');
  });
});
