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

  it('keeps the HTML shell and authenticated APIs outside the static asset cache policy', () => {
    expect(worker).toContain("headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname.startsWith('/storage/')");
  });
});
