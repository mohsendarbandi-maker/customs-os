import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const wrangler = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')) as {
  assets?: { run_worker_first?: string[] };
};
const worker = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');

describe('PWA manifest requests pass through the canonical Worker', () => {
  it('routes canonical and previously installed per-area manifest URLs to Worker before ASSETS', () => {
    const paths = new Set(wrangler.assets?.run_worker_first ?? []);
    for (const path of [
      '/manifest.webmanifest',
      '/chat-app-v3.webmanifest',
      '/chat-app-v4.webmanifest',
      '/chat-manifest.webmanifest',
      '/chat-subdomain.webmanifest',
      '/manifest-chat.webmanifest',
      '/manifest-reminders.webmanifest',
      '/reminders-subdomain.webmanifest',
      '/mobile-subdomain.webmanifest',
    ]) {
      expect(paths.has(path), `run_worker_first must include ${path}`).toBe(true);
    }
  });

  it('keeps the permanent canonical redirects for legacy chat/reminders aliases', () => {
    expect(worker).toContain("if (/\\.webmanifest$/i.test(canonical.pathname)) canonical.pathname = '/manifest.webmanifest'");
    expect(worker).toContain("canonical.hostname = 'darbandicommercial.ir'");
    expect(worker).toContain('status: 301');
    expect(worker).toContain("'chat.darbandicommercial.ir'");
    expect(worker).toContain("'reminders.darbandicommercial.ir'");
  });

  it('redirects primary-domain phone navigations to mobile and keeps the mobile hostname standalone', () => {
    expect(worker).toContain("const isPrimaryDomain = legacyHost === 'darbandicommercial.ir' || legacyHost === 'www.darbandicommercial.ir'");
    expect(worker).toContain("const isPhoneOrTablet = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent)");
    expect(worker).toContain("mobileUrl.hostname = 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("status: 302");
    expect(worker).not.toContain('const isDesktopBrowser =');
    expect(workflow).toContain('Phone visits to the primary domain must redirect to the mobile alias');
    expect(workflow).toContain('Desktop requests to the mobile alias remain on the requested mobile hostname');
    expect(workflow).toContain('Phone UA remains on mobile host');
  });

  it('does not abort before diagnostics when a response lacks a Location header', () => {
    expect(workflow).toContain("sed -E 's/^[^:]*:[[:space:]]*//' || true)");
    expect(workflow).toContain('Legacy manifest redirect check: attempt=');
    expect(workflow).toContain('Expected HTTP 301 from');
  });
});
