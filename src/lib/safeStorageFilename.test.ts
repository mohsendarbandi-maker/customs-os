import { describe, expect, it } from 'vitest';
import { safeStorageFilename } from './safeStorageFilename';

describe('safeStorageFilename', () => {
  it('keeps a safe ASCII filename and extension readable', () => {
    expect(safeStorageFilename('invoice final.V2.pdf')).toBe('invoice_final_V2.pdf');
  });

  it('replaces non-ASCII filenames while preserving a safe extension', () => {
    expect(safeStorageFilename('مدارک ترخیص بارمان.pdf')).toBe('document.pdf');
  });

  it('removes path segments and prevents path traversal', () => {
    expect(safeStorageFilename('../../invoice.pdf')).toBe('invoice.pdf');
    expect(safeStorageFilename('folder\\\u0645\u062f\u0627\u0631\u06a9.png')).toBe('document.png');
  });

  it('returns a safe fallback when the filename has no usable ASCII base', () => {
    expect(safeStorageFilename('مدارک فارسی')).toBe('document');
  });

  it('always returns an ASCII-only storage key segment', () => {
    for (const name of ['تست🚢.pdf', 'résumé #1.png', '...///']) {
      expect(safeStorageFilename(name)).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
  });
});
