import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('index.html');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};
const worker = read('worker/index.ts');
const pwaLifecycle = read('src/features/reminders/PwaLifecycle.tsx');
const app = read('src/App.tsx');
const mainEntry = read('src/main.tsx');
const supabaseClient = read('src/lib/supabase.ts');
const authContext = read('src/context/AuthContext.tsx');

describe('one canonical Customs OS PWA', () => {
  it('declares exactly one static manifest and one PNG Apple touch icon in the HTML shell', () => {
    const links = html.match(/<link\b[^>]*rel="manifest"[^>]*>/g) ?? [];
    const appleIcons = html.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/g) ?? [];

    expect(links).toHaveLength(1);
    expect(links[0]).toContain('href="/manifest.webmanifest"');
    expect(appleIcons).toHaveLength(1);
    expect(appleIcons[0]).toContain('/pwa/mobile-icon-180.png');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).not.toContain('apple-touch-icon-precomposed');
    // The mobile hostname may appear only in the device-routing bootstrap, never in PWA identity links.
    expect(html).toContain("target.hostname = 'mobile.darbandicommercial.ir'");
    expect(html).toContain("type: 'customs-auth-sync'");
    expect(html).not.toContain('manifest-reminders.webmanifest');
    expect(html).not.toContain('chat-app-v4.webmanifest');
    expect(html).not.toContain('link.setAttribute(\'href\', manifest)');
  });

  it('redirects the old Vercel workspace to the canonical Cloudflare origin before auth starts', () => {
    expect(html).toContain("host === 'customs-os-me-a4f6.vercel.app'");
    expect(html).toContain("canonicalUrl.hostname = 'darbandicommercial.ir'");
    expect(html).toContain('window.location.replace(canonicalUrl.toString())');
    expect(html.indexOf("host === 'customs-os-me-a4f6.vercel.app'"))
      .toBeLessThan(html.indexOf('<script type="module" src="/src/main.tsx">'));
  });

  it('has one root-scoped standalone identity and every required PNG size', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0A4D8C');
    expect(manifest.icons.some((icon) => icon.sizes === '180x180' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png')).toBe(true);
    expect(manifest.icons.filter((icon) => icon.type !== 'image/png')).toHaveLength(0);
  });

  it('permanently redirects legacy app hosts and no longer varies the manifest by host or Referer', () => {
    expect(worker).toContain('status: 301');
    expect(worker).toContain("'chat.darbandicommercial.ir'");
    expect(worker).toContain("'reminders.darbandicommercial.ir'");
    // Mobile keeps its browser URL but fetches the shared app shell/assets from the canonical origin.
    expect(worker).toContain("url.hostname.toLowerCase() === 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("assetBase.hostname = 'darbandicommercial.ir'");
    const legacyBlock = worker.slice(worker.indexOf('const isLegacyAppOrigin'), worker.indexOf('const isLegacyIntegrationRequest'));
    expect(legacyBlock).not.toContain("'mobile.darbandicommercial.ir'");
    expect(worker).toContain("canonical.hostname = 'darbandicommercial.ir'");
    expect(worker).toContain("canonical.pathname = '/chat'");
    expect(worker).toContain("canonical.pathname = '/reminders'");
    expect(worker).toContain("if (/\\.webmanifest$/i.test(canonical.pathname)) canonical.pathname = '/manifest.webmanifest'");
    expect(worker).not.toContain("referer.includes('/chat')");
    expect(worker).not.toContain('chatManifestPath');
    expect(worker).not.toContain('reminders-subdomain.webmanifest?v=');
    expect(worker).not.toContain('mobile-subdomain.webmanifest?v=');
    expect(worker).toContain("legacyManifestPaths.has(url.pathname)");
    expect(worker).toContain("canonical.pathname = '/manifest.webmanifest'");
  });

  it('keeps PWA identity static while React Router decides which internal section to show', () => {
    expect(pwaLifecycle).not.toContain("document.querySelector<HTMLLinkElement>('link[rel=\"manifest\"]')");
    expect(pwaLifecycle).not.toContain("document.querySelectorAll<HTMLLinkElement>('link[rel*=\"apple-touch-icon\"]')");
    expect(pwaLifecycle).not.toContain("document.querySelector<HTMLMetaElement>('meta[name=\"theme-color\"]')");
    expect(app).not.toContain("host==='reminders.darbandicommercial.ir'");
    expect(app).not.toContain("host==='chat.darbandicommercial.ir'");
  });

  it('keeps the canonical PWA start URL on the home route', () => {
    expect(mainEntry).not.toContain('normalizeLegacyPwaLaunch');
    expect(mainEntry).not.toContain("searchParams.get('source') !== 'pwa'");
    expect(mainEntry).toContain('ReactDOM.createRoot(rootElement).render(');
  });

  it('bounds session and workspace-profile bootstrap so the desktop cannot spin forever', () => {
    expect(authContext).toContain("import { withTimeout } from '../lib/withTimeout'");
    expect(authContext).toContain("AUTH_SESSION_TIMEOUT_MS = 10_000");
    expect(authContext).toContain("AUTH_PROFILE_TIMEOUT_MS = 12_000");
    expect(authContext).toContain("AUTH_CACHE_TIMEOUT_MS = 2_500");
    expect(authContext).toContain("'loading the workspace profile'");
    expect(authContext).toContain("'reading the cached workspace profile'");
  });

  it('starts service-worker registration even when the load event has already fired', () => {
    expect(pwaLifecycle).toContain('registerSW({');
    expect(pwaLifecycle).toContain('immediate: true');
    expect(pwaLifecycle).toContain('    start();');
    expect(pwaLifecycle).not.toContain("else window.addEventListener('load', start, { once: true })");
  });

  it('preserves Supabase auto-refresh and performs throttled recovery on visibility, focus and pageshow', () => {
    expect(supabaseClient).toContain('persistSession: true');
    expect(supabaseClient).toContain('autoRefreshToken: true');
    expect(supabaseClient).toContain('storage: authSessionStorage');
    expect(authContext).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(authContext).toContain("window.addEventListener('focus', handleVisibilityChange)");
    expect(authContext).toContain("window.addEventListener('pageshow', handleVisibilityChange)");
    expect(authContext).toContain('lifecycleRecoveryInFlight');
    expect(authContext).toContain('authSessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY)');
  });
});
