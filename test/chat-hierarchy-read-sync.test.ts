import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261029215715_optimize_chat_hierarchy_read_sync.sql'),
  'utf8',
);

describe('chat hierarchy read performance', () => {
  it('runs the hierarchy repair only when expected groups or active membership are missing', () => {
    expect(migration).toContain('v_needs_sync boolean := false');
    expect(migration).toContain("owner_room.hierarchy_kind = 'owner_group'");
    expect(migration).toContain("shipment_room.hierarchy_kind = 'shipment_group'");
    expect(migration).toContain('m.deleted_at IS NULL AND m.left_at IS NULL');
    expect(migration).toContain('IF v_needs_sync THEN');
    expect(migration).toContain('PERFORM public.chat_sync_shipment_hierarchy();');
    expect(migration).toContain('END IF;');
    expect(migration).not.toMatch(/PERFORM public\.chat_sync_shipment_hierarchy\(\);\s*RETURN QUERY/);
  });

  it('preserves authenticated scope, security definer search path, and hierarchy result shape', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'public', 'pg_catalog', 'pg_temp'");
    expect(migration).toContain('IF v_user IS NULL OR v_org IS NULL THEN');
    expect(migration).toContain("c.hierarchy_kind IN ('owner_group', 'shipment_group')");
    expect(migration).toContain('LIMIT greatest(1, least(coalesce(p_limit, 200), 200))');
  });
});
