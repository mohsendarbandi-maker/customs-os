import { describe, expect, it } from 'vitest';
import { isMigrationIntegrityHealthy, isMigrationParityHealthy } from '../worker/migration-diagnostics';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Cloudflare migration diagnostic result semantics', () => {
  it('marks parity unhealthy when required targets are missing, row counts fail, or counts mismatch', () => {
    expect(isMigrationParityHealthy({ missingRequiredTargets: 0, failedCounts: 0, mismatchedTables: 0 })).toBe(true);
    expect(isMigrationParityHealthy({ missingRequiredTargets: 1, failedCounts: 0, mismatchedTables: 0 })).toBe(false);
    expect(isMigrationParityHealthy({ missingRequiredTargets: 0, failedCounts: 1, mismatchedTables: 0 })).toBe(false);
    expect(isMigrationParityHealthy({ missingRequiredTargets: 0, failedCounts: 0, mismatchedTables: 1 })).toBe(false);
  });

  it('marks integrity unhealthy when any orphan reference or failed check exists', () => {
    const healthy = {
      failedChecks: 0,
      orphanTotal: 0,
      customsOfficeReferenceQueryFailed: false,
      orphanCustomsOfficeReferenceCount: 0,
    };
    expect(isMigrationIntegrityHealthy(healthy)).toBe(true);
    expect(isMigrationIntegrityHealthy({ ...healthy, orphanTotal: 1 })).toBe(false);
    expect(isMigrationIntegrityHealthy({ ...healthy, failedChecks: 1 })).toBe(false);
    expect(isMigrationIntegrityHealthy({ ...healthy, customsOfficeReferenceQueryFailed: true })).toBe(false);
    expect(isMigrationIntegrityHealthy({ ...healthy, orphanCustomsOfficeReferenceCount: 1 })).toBe(false);
  });
});

describe('Cloudflare migration foundation', () => {
  it('keeps staging Worker isolated from production routes and Supabase secrets', () => {
    const config = read('../wrangler.migration-staging.jsonc');
    expect(config).toContain('"name": "customs-os-migration-staging"');
    expect(config).toContain('"workers_dev": true');
    expect(config).toContain('"preview_urls": false');
    expect(config).not.toContain('"routes"');
    expect(config).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('serves the existing Vite/PWA build from isolated staging assets', () => {
    const config = read('../wrangler.migration-staging.jsonc');
    expect(config).toContain('"directory": "./dist"');
    expect(config).toContain('"binding": "ASSETS"');
    expect(config).toContain('"not_found_handling": "single-page-application"');
  });

  it('uses only resumable migration metadata tables in the initial D1 schema', () => {
    const sql = read('../supabase/migrations-cloudflare/0001_migration_control.sql');
    expect(sql).toContain('_migration_manifest');
    expect(sql).toContain('_migration_table_state');
    expect(sql).toContain('_migration_chunk_checkpoint');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
    expect(sql).not.toMatch(/\b(shipments|profiles|auth\.users|storage\.objects)\b/i);
  });

  it('exposes a read-only D1 schema and row-count inventory', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("url.pathname === '/migration/schema'");
    expect(worker).toContain("SELECT name, sql FROM sqlite_master WHERE type = 'table'");
    expect(worker).toContain('SELECT COUNT(*) AS row_count FROM ');
    expect(worker).toContain('schemaSql: table.sql');
    expect(worker).toContain('inspection: \'read_only_sqlite_master_and_count\'');
    expect(worker).toContain("request.method !== 'GET' && request.method !== 'HEAD'");
    expect(worker).toContain("SCHEMA_INSPECTION_UNAVAILABLE");
  });

  it('blocks unported application routes on the isolated workers.dev staging host', () => {
    const app = read('../src/App.tsx');
    const host = read('../src/lib/recoveryHost.ts');
    expect(host).toContain("startsWith('customs-os-migration-staging.')");
    expect(host).toContain("endsWith('.workers.dev')");
    expect(app).toContain('isCloudflareStagingHost() && location.pathname !==');
    expect(app).toContain('<StagingRouteBoundary><Routes>');
    expect(app).toContain('</Routes></StagingRouteBoundary>');
  });

  it('compares the migration import manifest with actual D1 table row counts', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("url.pathname === '/migration/parity'");
    expect(worker).toContain('FROM customs_os_import_table_status WHERE organization_id = ? ORDER BY table_name');
    expect(worker).toContain('SELECT COUNT(*) AS row_count FROM ');
    expect(worker).toContain('inspection: \'read_only_import_manifest_vs_d1_counts\'');
    expect(worker).toContain('missingEmptySourceTables');
    expect(worker).toContain('missingRequiredTargets');
    expect(worker).toContain("row.status === 'empty_in_source'");
    expect(worker).toContain('const rowCountParity = isMigrationParityHealthy({');
    expect(worker).toContain('ok: rowCountParity');
    expect(worker).toContain('MIGRATION_PARITY_UNAVAILABLE');
  });

  it('probes one bounded Telegram binary only behind a same-origin staging session', () => {
    const worker = read('../worker/migration-staging.ts');
    const config = read('../wrangler.migration-staging.jsonc');
    expect(worker).toContain("url.pathname === '/api/admin/migration/telegram-probe'");
    expect(worker).toContain('if (!isSameOrigin(request, url))');
    expect(worker).toContain('if (!await getSession(request, env))');
    expect(worker).toContain('TELEGRAM_BOT_TOKEN');
    expect(worker).toContain("json_extract(metadata, '$.telegramFileId')");
    expect(worker).toContain('MAX_TELEGRAM_PROBE_BYTES = 8 * 1024 * 1024');
    expect(worker).toContain('crypto.subtle.digest(\'SHA-256\', bytes)');
    expect(worker).toContain("stored: false");
    expect(worker).toContain("contentExposed: false");
    expect(config).toContain('"TELEGRAM_BOT_TOKEN"');
  });

  it('inspects file metadata key names and counts without returning metadata values', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("url.pathname === '/migration/file-metadata-keys'");
    expect(worker).toContain('json_each(');
    expect(worker).toContain('json_valid(f.metadata)');
    expect(worker).toContain('candidateIdentifierKeys');
    expect(worker).toContain('records_with_non_empty_metadata');
    expect(worker).toContain('recordsWithNonEmptyMetadata');
    expect(worker).not.toContain('Math.max(sum, row.record_count)');
    expect(worker).toContain('telegramFileIdAvailability');
    expect(worker).toContain('FILE_METADATA_KEY_INSPECTION_UNAVAILABLE');
  });

  it('reports file archive metadata counts without exposing content or identifiers', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("url.pathname === '/migration/files'");
    expect(worker).toContain("inspection: 'read_only_file_metadata_counts_only'");
    expect(worker).toContain('FROM file_manager_files');
    expect(worker).toContain('FROM customs_documents');
    expect(worker).toContain('FROM shipment_documents');
    expect(worker).toContain('storageBackendBreakdown');
    expect(worker).toContain('storagePathBreakdown');
    expect(worker).toContain("WHEN lower(storage_path) LIKE 'telegram://%' THEN 'telegram'");
    expect(worker).toContain("WHEN lower(storage_path) LIKE 'supabase://%' THEN 'supabase'");
    expect(worker).toContain("binaryVerification: 'not_performed'");
    expect(worker).toContain('FILE_METADATA_INSPECTION_UNAVAILABLE');
    expect(worker).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  it('exposes read-only orphan-reference diagnostics for operational tables', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("url.pathname === '/migration/integrity'");
    expect(worker).toContain("inspection: 'read_only_orphan_reference_counts'");
    expect(worker).toContain('cases.customs_office_id -> customs_offices.id');
    expect(worker).toContain('shipments.registration_order_id -> registration_orders.id');
    expect(worker).toContain('customs_documents.folder_id -> file_manager_folders.id');
    expect(worker).toContain('finance_cost_items.category_id -> finance_cost_categories.id');
    expect(worker).toContain('checksWithOrphans');
    expect(worker).toContain('orphanCustomsOfficeDistinctIds');
    expect(worker).toContain('orphanCustomsOfficeReferences');
    expect(worker).toContain("GROUP BY table_name, office_id ORDER BY office_id, table_name");
    expect(worker).toContain('failedChecks');
  });

  it('exposes read-only staging health and migration gates without claiming operational parity', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("request.method !== 'GET' && request.method !== 'HEAD'");
    expect(worker).toContain("url.pathname === '/health/db'");
    expect(worker).toContain("url.pathname === '/migration/status'");
    expect(worker).toContain("url.pathname === '/migration/functions'");
    expect(worker).toContain("sourcePostgres: 'blocked_57P03'");
    expect(worker).toContain('FROM customs_os_import_table_status WHERE organization_id = ? GROUP BY status ORDER BY status');
    expect(worker).toContain("operationalRows: rowCountParity ? 'row_count_parity_verified' : 'incomplete'");
    expect(worker).toContain('migrationTotals: { ...migrationTotals, rowCountParity }');
    expect(worker).toContain("productionCutover: 'blocked'");
    expect(worker).toContain("CUSTOMS_ADMIN_PASSWORD");
    expect(worker).toContain("customs_admin_sessions");
    expect(worker).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });

  it('keeps the free-first source and data preservation gates documented', () => {
    const plan = read('../docs/migration/CLOUDFLARE_MIGRATION.md');
    expect(plan).toContain('57P03');
    expect(plan).toContain('R2 was enabled by the owner');
    expect(plan).toContain('no objects have been uploaded');
    expect(plan).toContain('do not upload objects');
    expect(plan).toContain('500 MB per database');
    expect(plan).toContain('No DROP, TRUNCATE, DELETE');
  });
});
