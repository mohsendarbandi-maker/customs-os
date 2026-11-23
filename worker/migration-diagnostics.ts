export interface MigrationParityDiagnostics {
  missingRequiredTargets: number;
  failedCounts: number;
  mismatchedTables: number;
}

export const isMigrationParityHealthy = ({
  missingRequiredTargets,
  failedCounts,
  mismatchedTables,
}: MigrationParityDiagnostics): boolean =>
  missingRequiredTargets === 0 && failedCounts === 0 && mismatchedTables === 0;

export interface MigrationIntegrityDiagnostics {
  failedChecks: number;
  orphanTotal: number;
  customsOfficeReferenceQueryFailed: boolean;
  orphanCustomsOfficeReferenceCount: number;
}

export const isMigrationIntegrityHealthy = ({
  failedChecks,
  orphanTotal,
  customsOfficeReferenceQueryFailed,
  orphanCustomsOfficeReferenceCount,
}: MigrationIntegrityDiagnostics): boolean =>
  failedChecks === 0 &&
  orphanTotal === 0 &&
  !customsOfficeReferenceQueryFailed &&
  orphanCustomsOfficeReferenceCount === 0;
