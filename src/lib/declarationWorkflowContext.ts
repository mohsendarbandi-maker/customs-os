export type DeclarationRelationIds = { caseId: string | null; clientId: string | null };

export const resolveDeclarationRelationIds = (input: {
  declarationCaseId?: string | null;
  shipmentCaseId?: string | null;
  shipmentClientId?: string | null;
  caseClientId?: string | null;
}): DeclarationRelationIds => ({
  caseId: input.declarationCaseId || input.shipmentCaseId || null,
  clientId: input.shipmentClientId || input.caseClientId || null,
});
