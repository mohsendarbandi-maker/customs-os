import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013181000_customs_workflow_procedure_state_audit.sql'), 'utf8');

describe('customs procedure-state audit snapshots — phase 10', () => {
  it('records procedure_state when a workflow is first created', () => {
    expect(migration).toContain("'port_charges_state','procedure_state'");
  });

  it('stores both previous and current procedure_state snapshots', () => {
    expect(migration).toContain("'procedure_state', OLD.procedure_state");
    expect(migration).toContain("'procedure_state', NEW.procedure_state");
    expect(migration).toContain('previous_snapshot, snapshot, actor_id');
  });

  it('keeps audit writes trigger-only for authenticated users', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.log_customs_declaration_workflow_event() FROM PUBLIC, anon, authenticated');
  });
});
