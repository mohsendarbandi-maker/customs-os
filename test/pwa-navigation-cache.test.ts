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
});
