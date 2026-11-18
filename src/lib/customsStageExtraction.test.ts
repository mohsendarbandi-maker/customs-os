import { describe, expect, it } from 'vitest';
import { CUSTOMS_DOCUMENT_TYPE_OPTIONS, CUSTOMS_OPERATION_STAGE_LABELS, DEFAULT_CUSTOMS_STAGE_FIELDS, normalizeCustomsExtractionAnswer } from './customsStageExtraction';

describe('customs per-file stage extraction', () => {
  it('normalizes JSON returned by the AI assistant', () => {
    expect(normalizeCustomsExtractionAnswer({ answer: '{"invoiceNo":"INV-42","netWeight":"1200"}' }))
      .toEqual({ invoiceNo: 'INV-42', netWeight: '1200' });
  });

  it('accepts fenced JSON and object responses', () => {
    const fenced = String.fromCharCode(96, 96, 96) + 'json\n{"hsCode":"080810"}\n' + String.fromCharCode(96, 96, 96);
    expect(normalizeCustomsExtractionAnswer({ answer: fenced })).toEqual({ hsCode: '080810' });
    expect(normalizeCustomsExtractionAnswer({ answer: { quantity: '24' } })).toEqual({ quantity: '24' });
  });

  it('rejects invalid or non-object AI responses', () => {
    expect(() => normalizeCustomsExtractionAnswer({ answer: 'not json' })).toThrow();
    expect(() => normalizeCustomsExtractionAnswer({ answer: '[1,2,3]' })).toThrow();
  });

  it('exposes an AI schema for every supported operation stage', () => {
    const stages = Object.keys(CUSTOMS_OPERATION_STAGE_LABELS);
    expect(stages).toContain('documents');
    expect(stages).toContain('evaluation');
    expect(stages).toContain('permits');
    expect(stages).toContain('exit');
    for (const stage of stages) expect(DEFAULT_CUSTOMS_STAGE_FIELDS[stage], stage).toBeDefined();
  });

  it('uses only supported customs document enum values', () => {
    expect(CUSTOMS_DOCUMENT_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'PROFORMA_INVOICE', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING',
      'DELIVERY_ORDER', 'EPL_DELIVERY_ORDER', 'WAREHOUSE_RECEIPT', 'IMPORT_LICENSE',
      'SATA_PAYMENT_DOC', 'INSURANCE_POLICY', 'CERTIFICATE_OF_ORIGIN',
      'INSPECTION_CERTIFICATE', 'TECHNICAL_SPEC_CATALOG', 'POWER_OF_ATTORNEY',
      'CUSTOMS_DECLARATION_PRINT',
    ]);
  });
});