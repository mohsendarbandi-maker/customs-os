import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations-cloudflare/0004_cases_read_api_indexes.sql', import.meta.url), 'utf8');
describe('D1 case read API supporting indexes', () => {
  it('adds tenant lookup indexes without changing existing data', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS cases_org_created_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS cases_org_case_number_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS shipments_org_case_created_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS declarations_org_case_created_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS customs_documents_org_case_created_idx');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE cases|INSERT INTO cases)\b/i);
  });
});
