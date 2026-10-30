import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8');

describe('static asset cache headers', () => {
  it('gives fingerprinted assets long immutable browser caching', () => {
    expect(worker).toContain("finalHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')");
    expect(worker).toContain("url.pathname.startsWith('/assets/')");
  });

  it('uses the canonical asset origin only for the dedicated mobile host while preserving its browser URL', () => {
    expect(worker).toContain('const assetBase = new URL(request.url)');
    expect(worker).toContain("url.hostname.toLowerCase() === 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("assetBase.hostname = 'darbandicommercial.ir'");
    expect(worker).toContain('const assetRequest = new Request(assetBase, request)');
    expect(worker).not.toContain("assetBase.hostname = 'customs.mohsen-darbandi.workers.dev'");
  });

  it('keeps the HTML shell and authenticated APIs outside the static asset cache policy', () => {
    expect(worker).toContain("headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname.startsWith('/storage/')");
  });
});
