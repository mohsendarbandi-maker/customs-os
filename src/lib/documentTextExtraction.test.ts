import { describe, expect, it } from 'vitest';
import { normalizeDocumentText } from './documentTextExtraction';

describe('document extraction text preparation', () => {
  it('normalizes OCR line endings and whitespace without removing Persian text', () => {
    expect(normalizeDocumentText('  قبض انبار ۱۲۳۴۵\r\n\r\n  وزن خالص  ۴۵۰۰  ')).toBe('قبض انبار ۱۲۳۴۵\n\nوزن خالص ۴۵۰۰');
  });

  it('caps the document context before sending it to the AI provider', () => {
    expect(normalizeDocumentText('a'.repeat(20), 8)).toBe('a'.repeat(8));
  });
});
