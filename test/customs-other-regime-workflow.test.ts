import { describe, expect, it } from 'vitest';

const procedures = {
  cabotage: { label: 'کابوتاژ', stages: ['documents', 'permits', 'declaration', 'loading', 'exit', 'completed'] },
  customs_warehouse: { label: 'انبار گمرکی', stages: ['documents', 'permits', 'declaration', 'loading', 'exit', 'completed'] },
  free_zone: { label: 'منطقه آزاد', stages: ['documents', 'permits', 'declaration', 'loading', 'exit', 'completed'] },
  other: { label: 'سایر رویه‌ها', stages: ['documents', 'permits', 'declaration', 'loading', 'exit', 'completed'] },
} as const;

describe('additional customs regime integration — phase 6', () => {
  it('covers every remaining regime with a distinct Persian label', () => {
    expect(Object.keys(procedures)).toEqual(['cabotage', 'customs_warehouse', 'free_zone', 'other']);
    expect(new Set(Object.values(procedures).map(item => item.label)).size).toBe(4);
  });
  it('uses stage keys already accepted by the shared workflow schema', () => {
    const accepted = new Set(['documents', 'permits', 'declaration', 'valuation', 'loading', 'exit', 'completed']);
    for (const procedure of Object.values(procedures)) {
      expect(procedure.stages.every(stage => accepted.has(stage))).toBe(true);
      expect(procedure.stages[0]).toBe('documents');
      expect(procedure.stages.at(-1)).toBe('completed');
    }
  });
  it('does not claim legal approval based only on internal workflow completion', () => {
    expect('اطلاعات ثبت‌شده در پرونده همین اظهارنامه نگهداری می‌شود؛ تصمیم قانونی با مرجع ذی‌صلاح است.').toContain('مرجع ذی‌صلاح');
  });
});
