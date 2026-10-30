import { describe, expect, it } from 'vitest';
import {
  buildDocumentPageFeatures,
  buildDocumentPageFeaturesFromText,
  estimateJpegBytesFromSamples,
  normalizeRecognitionText,
  recognizeDocumentPage,
  scoreRecognitionSample,
} from './pdfRecognition';

describe('PDF document recognition features', () => {
  it('normalizes Persian characters and Persian/Arabic digits', () => {
    expect(normalizeRecognitionText('كالاى ۱۲۳٤٥')).toContain('کالای 12345');
  });

  it('extracts tokens, numeric patterns and normalized text positions', () => {
    const features = buildDocumentPageFeatures([
      { str: 'قبض انبار', transform: [1, 0, 0, 1, 100, 700] },
      { str: 'شماره ۱۲۳۴۵۶', transform: [1, 0, 0, 1, 300, 250] },
    ], 600, 800);
    expect(features.tokens).toContain('قبض');
    expect(features.numericShapes).toContain('digits_6');
    expect(features.anchors[0].x).toBeCloseTo(100 / 600);
    expect(features.anchors[0].y).toBeCloseTo(1 - 700 / 800);
  });

  it('builds OCR-based features from local OCR text and word boxes', () => {
    const features = buildDocumentPageFeaturesFromText('مانیفست الکترونیک', [
      { text: 'مانیفست', bbox: { x0: 10, y0: 20, x1: 100, y1: 40 }, confidence: 90 },
    ], 200, 400);
    expect(features.tokens).toContain('مانیفست');
    expect(features.anchors[0].x).toBeCloseTo(55 / 200);
  });

  it('scores document samples from words and page layout', () => {
    const expected = buildDocumentPageFeatures([
      { str: 'مانیفست الکترونیک گمرکی', transform: [1, 0, 0, 1, 100, 700] },
      { str: 'شماره سفر کشتی 12345', transform: [1, 0, 0, 1, 240, 280] },
    ], 600, 800);
    const actual = buildDocumentPageFeatures([
      { str: 'مانیفست الکترونیک گمرکی', transform: [1, 0, 0, 1, 104, 698] },
      { str: 'شماره سفر کشتی 98765', transform: [1, 0, 0, 1, 242, 282] },
    ], 600, 800);
    const sample = { id: 'sample-1', document_type: 'مانیفست الکترونیک', sample_name: 'نمونه', source_filename: 'sample.pdf', page_count: 1, features: { pages: [expected] } };
    expect(scoreRecognitionSample(actual, sample)).toBeGreaterThan(0.6);
    expect(recognizeDocumentPage(actual, [sample])?.documentType).toBe('مانیفست الکترونیک');
  });

  it('provides a conservative three-point preflight size estimate', () => {
    const estimate = estimateJpegBytesFromSamples(
      [{ bytes: 10_000, area: 100 }, { bytes: 12_000, area: 100 }, { bytes: 11_000, area: 100 }],
      [100, 100, 100],
      1_000,
    );
    expect(estimate.expected).toBe(33_000);
    expect(estimate.low).toBeLessThan(estimate.expected);
    expect(estimate.high).toBeGreaterThan(estimate.expected);
  });
});
