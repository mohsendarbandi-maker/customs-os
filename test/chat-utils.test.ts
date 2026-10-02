import { describe, expect, it } from 'vitest';
import { extractMentions, normalizeSearchText, sanitizeFileName } from '../src/features/chat/utils';

describe('chat text normalization', () => {
  it('normalizes Arabic y and k and spaces', () => {
    expect(normalizeSearchText('ي ك  تست‌  مشتری')).toBe('ی ک تست مشتری');
  });

  it('removes bidi and path traversal characters from filenames', () => {
    const hostile = '../' + String.fromCharCode(0x202e) + 'script.exe';
    const cleaned = sanitizeFileName(hostile);
    expect(cleaned).not.toContain('..');
    expect(cleaned).not.toMatch(/[/\\]/);
  });
});

describe('mentions', () => {
  it('extracts UUID mentions uniquely', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(extractMentions('سلام @' + id + ' دوباره @' + id)).toEqual([id]);
  });
});
