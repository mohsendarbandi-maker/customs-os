import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'src/components/CustomsDeclarationWorkflow.tsx'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261017070000_customs_workflow_rollback.sql'), 'utf8');

describe('customs workflow rollback', () => {
  it('uses the existing workflow snapshot audit trail instead of a parallel history store', () => {
    expect(component).toContain("from('customs_declaration_workflow_events')");
    expect(component).toContain('previous_snapshot');
    expect(component).toContain("rpc('rollback_customs_declaration_workflow'");
    expect(migration).toContain('public.customs_declaration_workflow_events');
    expect(migration).toContain('previous_snapshot');
  });

  it('records rollback as its own history event and prevents immediate repeated rollback', () => {
    expect(migration).toContain("'rollback'");
    expect(migration).toContain("current_setting('app.customs_workflow_rollback', true) = 'true'");
    expect(migration).toContain("v_event.event_type IN ('created', 'rollback')");
  });

  it('restricts rollback to authenticated operational roles within their own organization', () => {
    expect(migration).toContain('Authentication required');
    expect(migration).toContain("v_role NOT IN ('owner', 'admin', 'broker', 'warehouse')");
    expect(migration).toContain('organization_id = v_org_id');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.rollback_customs_declaration_workflow(uuid) TO authenticated');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.rollback_customs_declaration_workflow(uuid) FROM PUBLIC, anon');
  });

  it('exposes rollback only when the latest saved change has a previous snapshot', () => {
    expect(component).toContain('const canRollback=!!history[0]?.previous_snapshot');
    expect(component).toContain('بازگردانی آخرین تغییر');
    expect(component).toContain("history[0].event_type!=='rollback'");
  });
});
