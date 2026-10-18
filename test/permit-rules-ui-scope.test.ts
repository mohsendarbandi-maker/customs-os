import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const operationsUi = fs.readFileSync(path.resolve(__dirname, '../src/pages/DeclarationOperationsChecklistPage.tsx'), 'utf8');
const dedicatedRulesTab = fs.readFileSync(path.resolve(__dirname, '../src/pages/PermitRulesPage.tsx'), 'utf8');

describe('permit rules UI scope', () => {
  it('keeps rule-management and learned-rule explanations out of the declaration checklist UI', () => {
    expect(operationsUi).not.toContain('customs_operation_rules');
    expect(operationsUi).not.toContain('مشاهده قواعد');
    expect(operationsUi).not.toContain('پیشنهاد یادگیرنده');
    expect(operationsUi).not.toContain('قاعده یادگرفته‌شده');
    expect(operationsUi).not.toContain('قواعد یادگیرنده');
  });

  it('retains rule management in its dedicated tab', () => {
    expect(dedicatedRulesTab).toContain('قواعد مجوز');
    expect(dedicatedRulesTab).toContain('customs_operation_rules');
    expect(dedicatedRulesTab).toContain('permit_rules');
  });
});
