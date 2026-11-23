import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Cloudflare D1 registration-order migration', () => {
  it('executes the versioned migration and enforces tenant, capacity and finalization invariants in SQLite', () => {
    const output = execFileSync(
      'python3',
      [resolve(process.cwd(), 'scripts/verify-registration-order-d1-migration.py')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(output).toContain('SQLite D1 registration-order migration checks passed.');
  });
});
