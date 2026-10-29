import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const config = fs.readFileSync(path.resolve(__dirname, '../wrangler.jsonc'), 'utf8');
describe('mobile auth bridge worker routing', () => {
  it('routes the bridge through the worker before static asset handling', () => {
    expect(config).toContain('"/__auth-bridge.html"');
    expect(config).toContain('"run_worker_first"');
  });
});
