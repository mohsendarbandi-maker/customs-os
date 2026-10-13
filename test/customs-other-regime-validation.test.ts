import { describe, expect, it } from 'vitest';
import { validateAdditionalRegimeStage } from '../src/lib/customsOtherRegimeValidation';

const validState = () => ({
  documents: { goodsDescription: 'کالای آزمایشی', documentReferences: 'INV-100' },
  permits: { permitStatus: 'دریافت شد' },
  declaration: { declarationReference: 'K-100', declarationDate: '۱۴۰۵/۰۷/۱۰' },
  loading: { location: 'انبار بندر', movementDate: '۱۴۰۵/۰۷/۱۲' },
  exit: { dispositionStatus: 'تحویل شد', dispositionDate: '۱۴۰۵/۰۷/۱۳' },
  completed: { closureReference: 'REF-100' },
});

describe('additional customs regime evidence validation — phase 7', () => {
  it('requires evidence fields before a stage can advance', () => {
    expect(validateAdditionalRegimeStage('documents', { documents: {} })).toHaveLength(2);
    expect(validateAdditionalRegimeStage('permits', { permits: { permitStatus: '' } })).toHaveLength(1);
  });

  it('accepts Persian-digit Jalali dates and chronological stage data', () => {
    expect(validateAdditionalRegimeStage('exit', validState())).toEqual([]);
  });

  it('rejects impossible Jalali dates', () => {
    const state = validState();
    state.declaration.declarationDate = '۱۴۰۵/۱۳/۰۱';
    expect(validateAdditionalRegimeStage('declaration', state)).toContain(
      '«تاریخ ثبت» باید تاریخ شمسی معتبر به‌شکل سال/ماه/روز باشد.',
    );
  });

  it('blocks movement before declaration and disposition before movement', () => {
    const state = validState();
    state.loading.movementDate = '۱۴۰۵/۰۷/۰۹';
    state.exit.dispositionDate = '۱۴۰۵/۰۷/۰۸';
    const issues = validateAdditionalRegimeStage('exit', state);
    expect(issues).toContain('تاریخ جابه‌جایی نمی‌تواند قبل از تاریخ ثبت اظهار باشد.');
    expect(issues).toContain('تاریخ تعیین تکلیف نمی‌تواند قبل از تاریخ جابه‌جایی یا ثبت اظهار باشد.');
  });

  it('does not duplicate validation messages', () => {
    expect(new Set(validateAdditionalRegimeStage('documents', { documents: {} })).size).toBe(2);
  });
});
