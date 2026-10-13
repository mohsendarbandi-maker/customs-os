import { describe, expect, it } from 'vitest';
import { resolveDeclarationRelationIds } from '../src/lib/declarationWorkflowContext';

describe('declaration shipment/case/client context — phase 8', () => {
  it('prefers explicit declaration case and shipment owner links', () => {
    expect(resolveDeclarationRelationIds({
      declarationCaseId: 'case-declaration',
      shipmentCaseId: 'case-shipment',
      shipmentClientId: 'client-shipment',
      caseClientId: 'client-case',
    })).toEqual({ caseId: 'case-declaration', clientId: 'client-shipment' });
  });

  it('falls back to the shipment case and its owner when direct links are absent', () => {
    expect(resolveDeclarationRelationIds({
      declarationCaseId: null,
      shipmentCaseId: 'case-shipment',
      shipmentClientId: null,
      caseClientId: 'client-case',
    })).toEqual({ caseId: 'case-shipment', clientId: 'client-case' });
  });

  it('returns null rather than inventing missing links', () => {
    expect(resolveDeclarationRelationIds({})).toEqual({ caseId: null, clientId: null });
  });
});
