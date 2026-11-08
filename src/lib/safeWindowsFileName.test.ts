import { describe, expect, it } from 'vitest';
import { safeWindowsFileName } from './safeWindowsFileName';

describe('safeWindowsFileName', () => {
  it('replaces characters forbidden in Windows path components', () => {
    expect(safeWindowsFileName('گزارش: نهایی?.pdf')).toBe('گزارش_ نهایی_.pdf');
    expect(safeWindowsFileName('folder/name\\subfolder')).toBe('folder_name_subfolder');
  });

  it('protects reserved Windows device names, including names with extensions', () => {
    for (const name of ['CON', 'con.txt', 'PRN', 'AUX.pdf', 'NUL.tar.gz', 'COM1', 'LPT9', 'COM¹.log']) {
      expect(safeWindowsFileName(name)).toMatch(/^_/);
    }
  });

  it('renames extensions blocked by Chromium File System Access', () => {
    for (const name of ['shortcut.lnk', 'internet.scf', 'website.url']) {
      expect(safeWindowsFileName(name)).toMatch(/_file$/);
    }
  });

  it('renames a CLSID extension that Chromium rejects', () => {
    const name = 'document.{01234567-89ab-cdef-0123-456789abcdef}';
    expect(safeWindowsFileName(name)).toBe('document._clsid_01234567-89ab-cdef-0123-456789abcdef');
  });

  it('removes trailing dots and spaces and never returns an empty or dot path component', () => {
    expect(safeWindowsFileName('report. ')).toBe('report');
    expect(safeWindowsFileName('.')).toBe('بدون نام');
    expect(safeWindowsFileName('..')).toBe('بدون نام');
    expect(safeWindowsFileName('')).toBe('بدون نام');
  });

  it('allows ordinary Persian names and dot-prefixed files', () => {
    expect(safeWindowsFileName('اسناد گمرکی')).toBe('اسناد گمرکی');
    expect(safeWindowsFileName('.env')).toBe('.env');
  });
});
