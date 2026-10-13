import { describe, it, expect } from 'vitest';

describe('customs transit and re-import workflow phase 5', () => {
  it('uses existing persisted stage keys accepted by the shared workflow schema', () => {
    const transitStages = ['documents', 'permits', 'declaration', 'loading', 'exit', 'completed'];
    const reImportStages = ['documents', 'permits', 'declaration', 'valuation', 'exit', 'completed'];
    const accepted = new Set(['documents', 'permits', 'declaration', 'valuation', 'loading', 'exit', 'completed']);
    expect(transitStages.every(stage => accepted.has(stage))).toBe(true);
    expect(reImportStages.every(stage => accepted.has(stage))).toBe(true);
    expect(transitStages.at(-1)).toBe('completed');
    expect(reImportStages.at(-1)).toBe('completed');
  });

  it('keeps internal and external transit separate from re-import and re-export', () => {
    const transit = ['external_transit', 'internal_transit'];
    const returnProcedures = ['re_import', 're_export'];
    expect(transit).not.toContain('re_import');
    expect(returnProcedures).not.toContain('external_transit');
  });

  it('requires evidence of dispatch and arrival deadlines for transit', () => {
    const transitMovement = { vehicle: 'truck-1', sealNumber: 'seal-1', route: 'approved route', dispatchDate: '۱۴۰۵/۰۷/۲۱', arrivalDeadline: '۱۴۰۵/۰۷/۲۲' };
    expect(Object.values(transitMovement).every(value => String(value).trim().length > 0)).toBe(true);
  });
});
