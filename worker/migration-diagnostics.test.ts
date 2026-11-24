import { describe, expect, it } from 'vitest';
import { isProductionTrafficHost } from './migration-diagnostics';

describe('isProductionTrafficHost', () => {
  it('recognizes the exact production application hostnames', () => {
    expect(isProductionTrafficHost('darbandicommercial.ir')).toBe(true);
    expect(isProductionTrafficHost('mobile.darbandicommercial.ir')).toBe(true);
  });

  it('normalizes hostname casing and surrounding whitespace', () => {
    expect(isProductionTrafficHost(' DARbandiCommercial.IR ')).toBe(true);
  });

  it('does not classify staging or unrelated hosts as production', () => {
    expect(isProductionTrafficHost('customs-os-migration-staging.mohsen-darbandi.workers.dev')).toBe(false);
    expect(isProductionTrafficHost('darbandicommercial.ir.example.com')).toBe(false);
    expect(isProductionTrafficHost('example.com')).toBe(false);
  });
});
