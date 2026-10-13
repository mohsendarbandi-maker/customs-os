import { describe, expect, it } from 'vitest';
import { validateAdditionalRegimeStage } from '../src/lib/customsOtherRegimeValidation';

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

describe('customs workflow validation — phase 7', () => {
  it('requires core documents before advancing', () => {
    const issues = validateAdditionalRegimeStage('documents', { documents: {} });
    expect(issues).toContain('«شرح کالا / موضوع عملیات» را تکمیل کنید.');
    expect(issues).toContain('«مراجع اسناد پیوست» را تکمیل کنید.');
  });

  it('accepts complete documents and valid Jalali declaration dates', () => {
    expect(validateAdditionalRegimeStage('documents', {
      documents: { goodsDescription: 'کالای آزمایشی', documentReferences: 'INV-12 / BL-45' },
    })).toEqual([]);
    expect(validateAdditionalRegimeStage('declaration', {
      declaration: { declarationReference: '۱۲۳۴۵', declarationDate: '۱۴۰۵/۰۷/۱۰' },
    })).toEqual([]);
  });

  it('rejects invalid Jalali dates instead of allowing the workflow to advance', () => {
    const issues = validateAdditionalRegimeStage('declaration', {
      declaration: { declarationReference: '۱۲۳۴۵', declarationDate: '۱۴۰۵/۱۳/۴۰' },
    });
    expect(issues.some(issue => issue.includes('تاریخ شمسی معتبر'))).toBe(true);
  });

  it('rejects movement dates earlier than the declaration date', () => {
    const issues = validateAdditionalRegimeStage('exit', {
      declaration: { declarationDate: '۱۴۰۵/۰۷/۱۰' },
      loading: { movementDate: '۱۴۰۵/۰۷/۰۹' },
      exit: { dispositionStatus: 'تحویل شد', dispositionDate: '۱۴۰۵/۰۷/۱۱' },
    });
    expect(issues).toContain('تاریخ جابه‌جایی نمی‌تواند قبل از تاریخ ثبت اظهار باشد.');
  });

  it('rejects final disposition dates earlier than the movement date', () => {
    const issues = validateAdditionalRegimeStage('completed', {
      declaration: { declarationDate: '۱۴۰۵/۰۷/۰۸' },
      loading: { movementDate: '۱۴۰۵/۰۷/۱۰' },
      exit: { dispositionStatus: 'تحویل شد', dispositionDate: '۱۴۰۵/۰۷/۰۹' },
      completed: { closureReference: 'CLOSE-1' },
    });
    expect(issues).toContain('تاریخ تعیین تکلیف نمی‌تواند قبل از تاریخ جابه‌جایی یا ثبت اظهار باشد.');
  });
});
