import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const readMigration = (name: string) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const workflowScope = readMigration('20261013142058_customs_workflow_client_scope.sql');
const auditMigration = readMigration('20261013145845_customs_workflow_audit_history.sql');
const procedureSnapshotMigration = readMigration('20261013180308_customs_workflow_procedure_state_audit.sql');

describe('customs workflow security regression — phase 11', () => {
  it('scopes workflow reads to the active organization', () => {
    expect(workflowScope).toContain('organization_id = public.user_org_id()');
    expect(workflowScope).toContain("public.user_role() = 'client'::public.user_role");
    expect(workflowScope).toContain('s.client_id = public.user_client_id()');
    expect(workflowScope).toContain('c.client_id = public.user_client_id()');
  });

  it('scopes audit history by organization and the client-owned declaration', () => {
    expect(auditMigration).toContain('ALTER TABLE public.customs_declaration_workflow_events ENABLE ROW LEVEL SECURITY');
    expect(auditMigration).toContain('organization_id = public.user_org_id()');
    expect(auditMigration).toContain('customs_declaration_workflow_events.declaration_id');
    expect(auditMigration).toContain('customs_declaration_workflow_events.organization_id');
    expect(auditMigration).toContain('FOREIGN KEY (declaration_id, organization_id)');
  });

  it('prevents direct audit-log mutation by application roles', () => {
    expect(auditMigration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
    expect(auditMigration).toContain('REVOKE ALL ON FUNCTION public.log_customs_declaration_workflow_event() FROM PUBLIC, anon, authenticated');
  });

  it('keeps the trigger safe and captures before/after state for procedure-specific workflows', () => {
    expect(procedureSnapshotMigration).toContain('SECURITY DEFINER');
    expect(procedureSnapshotMigration).toContain('SET search_path = public');
    expect(procedureSnapshotMigration).toContain("'procedure_state', OLD.procedure_state");
    expect(procedureSnapshotMigration).toContain("'procedure_state', NEW.procedure_state");
    expect(procedureSnapshotMigration).toContain('previous_snapshot, snapshot, actor_id');
  });
});
