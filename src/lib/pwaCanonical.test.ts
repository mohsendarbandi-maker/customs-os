import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('single canonical Customs OS PWA', () => {
  it('uses exactly one root-scoped standalone manifest and PNG install icons', () => {
    const html = read('index.html');
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };
    expect((html.match(/rel="manifest"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('href="/manifest.webmanifest?v=20261018-canonical-v1"');
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180"');
    expect(html).not.toContain('apple-touch-icon-precomposed');
    expect(html).not.toContain('mobile.darbandicommercial.ir');
    expect(html).not.toContain('chat-subdomain.webmanifest');
    expect(html).not.toContain('manifest-reminders.webmanifest');
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', theme_color: '#0A4D8C' });
    expect(manifest.icons.every((icon) => icon.type === 'image/png' && icon.src.endsWith('.png'))).toBe(true);
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/pwa/mobile-icon-180.png', sizes: '180x180' }),
      expect.objectContaining({ src: '/pwa/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/pwa/icon-512.png', sizes: '512x512' }),
      expect.objectContaining({ src: '/pwa/icon-192-maskable.png', purpose: 'maskable' }),
      expect.objectContaining({ src: '/pwa/icon-512-maskable.png', purpose: 'maskable' }),
    ]));
    expect(existsSync(resolve(process.cwd(), 'public/pwa/mobile-icon-180.png'))).toBe(true);
  });

  it('removes all duplicate public manifests and route-driven manifest mutation', () => {
    const manifests = readdirSync(resolve(process.cwd(), 'public')).filter((file) => file.endsWith('.webmanifest'));
    expect(manifests).toEqual(['manifest.webmanifest']);
    const lifecycle = read('src/features/reminders/PwaLifecycle.tsx');
    expect(lifecycle).not.toContain('link[rel="manifest"]');
    expect(lifecycle).not.toContain('manifestPath');
    expect(lifecycle).not.toContain('querySelectorAll<HTMLLinkElement>(\'link[rel*="apple-touch-icon"]\')');
    const app = read('src/App.tsx');
    expect(app).not.toContain("host==='reminders.darbandicommercial.ir'");
    expect(app).not.toContain("host==='chat.darbandicommercial.ir'");
    expect(read('src/main.tsx')).not.toContain('normalizeLegacyPwaLaunch');
  });

  it('permanently redirects legacy app domains and old manifests without Referer routing', () => {
    const worker = read('worker/index.ts');
    expect(worker).toContain("'chat.darbandicommercial.ir': '/chat'");
    expect(worker).toContain("'reminders.darbandicommercial.ir': '/reminders'");
    expect(worker).toContain("'mobile.darbandicommercial.ir': '/'");
    expect(worker).toContain("status: methodPreserving ? 308 : 301");
    expect(worker).toContain("url.pathname === '/manifest.webmanifest'");
    expect(worker).toContain("'/chat-app-v4.webmanifest'");
    expect(worker).toContain("'/mobile-subdomain.webmanifest'");
    expect(worker).not.toContain('referer.includes');
    expect(worker).not.toContain('const isMobileHost');
    expect(worker).not.toContain('const isChatHost');
    expect(worker).not.toContain('const isRemindersHost');
  });
});
