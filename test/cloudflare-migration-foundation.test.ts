import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

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

  it('exposes read-only staging health and migration gates without claiming operational parity', () => {
    const worker = read('../worker/migration-staging.ts');
    expect(worker).toContain("request.method !== 'GET' && request.method !== 'HEAD'");
    expect(worker).toContain("url.pathname === '/health/db'");
    expect(worker).toContain("url.pathname === '/migration/status'");
    expect(worker).toContain("url.pathname === '/migration/functions'");
    expect(worker).toContain("sourcePostgres: 'blocked_57P03'");
    expect(worker).toContain("operationalRows: 'imported_from_organization_export'");
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
