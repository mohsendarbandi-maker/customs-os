import { describe, expect, it } from 'vitest';
import {
  CUSTOMS_OPERATION_SECTION_KEYS,
  CUSTOMS_OPERATION_SECTIONS,
  customsOperationFieldSchema,
  parseCustomsDocumentExtraction,
} from '../src/lib/customsDocumentAI';

describe('customs document AI operation scopes', () => {
  it('defines a separate extraction schema for each operation box', () => {
    expect(CUSTOMS_OPERATION_SECTION_KEYS).toEqual([
      'evaluation','expertise','cashier','loading_permit','exit','port_charges',
    ]);
    for (const section of CUSTOMS_OPERATION_SECTION_KEYS) {
      expect(customsOperationFieldSchema(section).length).toBeGreaterThan(0);
      expect(CUSTOMS_OPERATION_SECTIONS[section].label).toBeTruthy();
    }
  });

  it('keeps only fields belonging to the selected operation box', () => {
    const result = parseCustomsDocumentExtraction(
      '{"sata_code":"۱۲۳۴","payment_reference":"ignored","unknown":"ignored"}',
      'loading_permit',
    );
    expect(result).toEqual({ sata_code: '۱۲۳۴' });
  });

  it('accepts fenced JSON and ignores empty extracted values', () => {
    const result = parseCustomsDocumentExtraction(
      '```json\n{"evaluator_number":"EV-55","evaluation_result":"","assessed_value":null}\n```',
      'evaluation',
    );
    expect(result).toEqual({ evaluator_number: 'EV-55' });
  });

  it('rejects invalid JSON and non-object responses', () => {
    expect(() => parseCustomsDocumentExtraction('not json','cashier')).toThrow();
    expect(() => parseCustomsDocumentExtraction('[]','cashier')).toThrow();
  });
});
