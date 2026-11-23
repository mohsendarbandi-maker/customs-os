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


const PRODUCTION_TRAFFIC_HOSTS = new Set([
  'darbandicommercial.ir',
  'mobile.darbandicommercial.ir',
]);

/** Detects whether this request was served on a production application hostname. */
export const isProductionTrafficHost = (hostname: string): boolean =>
  PRODUCTION_TRAFFIC_HOSTS.has(hostname.trim().toLowerCase());
