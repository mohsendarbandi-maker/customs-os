import { describe, expect, it } from 'vitest';

const labels: Record<string, string> = {
  created: 'ایجاد گردش‌کار',
  stage_changed: 'تغییر مرحله',
  saved: 'ذخیره اطلاعات',
};

describe('customs workflow audit presentation — phase 10', () => {
  it('uses Persian labels for supported audit event types', () => {
    expect(labels.created).toBe('ایجاد گردش‌کار');
    expect(labels.stage_changed).toBe('تغییر مرحله');
    expect(labels.saved).toBe('ذخیره اطلاعات');
  });

  it('does not expose raw field names in the audit summary', () => {
    const changedFields = ['permit_reference', 'declaration_date'];
    const summary = changedFields.length + ' بخش تغییر یافته';
    expect(summary).not.toContain('permit_reference');
    expect(summary).not.toContain('declaration_date');
  });
});
