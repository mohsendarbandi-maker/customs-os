import { describe, expect, it } from 'vitest';
import { pageExpressionForMatches, parsePageSelection, suggestDocumentLabel } from './pdfStudioUtils';

describe('PDF Studio page selection', () => {
  it('supports ranges and explicit page lists in one field', () => {
    expect(parsePageSelection('1-2,5', 8)).toEqual([1, 2, 5]);
    expect(parsePageSelection('۱-۲،۵'.replace('،', ','), 8)).toEqual([1, 2, 5]);
    expect(parsePageSelection('1,5,2-3', 8)).toEqual([1, 2, 3, 5]);
  });

  it('rejects invalid, descending and out-of-bounds ranges', () => {
    expect(() => parsePageSelection('', 4)).toThrow();
    expect(() => parsePageSelection('3-1', 4)).toThrow();
    expect(() => parsePageSelection('1-5', 4)).toThrow();
    expect(() => parsePageSelection('1,,2', 4)).toThrow();
  });

  it('suggests document labels from page text without OCR', () => {
    expect(suggestDocumentLabel('مانیفست الکترونیک کالا', 'scan.pdf', 3)).toBe('مانیفست الکترونیک');
    expect(suggestDocumentLabel('Customs declaration', 'document.pdf', 1)).toBe('اظهارنامه');
    expect(suggestDocumentLabel('', 'permit.pdf', 2)).toBe('permit - صفحه 2');
  });

  it('maps named page labels to page numbers for a prepared split', () => {
    expect(pageExpressionForMatches([
      { label: 'اظهارنامه' },
      { label: 'قبض انبار پشت' },
      { label: 'مانیفست الکترونیک' },
    ], [/قبض انبار/])).toBe('2');
  });
});
