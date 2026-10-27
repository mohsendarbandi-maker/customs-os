import { describe, expect, it } from 'vitest';
import { shipmentSearchVariants } from './reminderCore';

describe('shipment search variants', () => {
  it('matches Latin, Persian and Arabic digit spellings', () => {
    const variants = shipmentSearchVariants('بارنامه ۱۲۳');
    expect(variants).toContain('بارنامه 123');
    expect(variants).toContain('بارنامه ۱۲۳');
    expect(variants).toContain('بارنامه ١٢٣');
  });

  it('matches Persian and Arabic yeh/kaf spellings', () => {
    const variants = shipmentSearchVariants('يكي');
    expect(variants).toContain('یکی');
    expect(variants).toContain('يکي');
    expect(shipmentSearchVariants('x')).toEqual([]);
  });
});
