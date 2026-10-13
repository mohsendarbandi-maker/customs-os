import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'src/components/CustomsDeclarationWorkflow.tsx'), 'utf8');
const auditMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013145845_customs_workflow_audit_history.sql'), 'utf8');
const snapshotMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013150033_customs_workflow_history_previous_snapshot.sql'), 'utf8');

describe('customs declaration workflow audit history', () => {
  it('logs creates, stage changes, and meaningful saves from the database trigger', () => {
    expect(auditMigration).toContain('AFTER INSERT OR UPDATE ON public.customs_declaration_workflow');
    expect(auditMigration).toContain("WHEN OLD.current_stage IS DISTINCT FROM NEW.current_stage THEN 'stage_changed'");
    expect(auditMigration).toContain("ELSE 'saved'");
    expect(auditMigration).toContain('changed_fields');
  });

  it('records before-and-after snapshots and prevents direct client writes to the audit log', () => {
    expect(snapshotMigration).toContain('previous_snapshot jsonb');
    expect(snapshotMigration).toContain('v_previous_snapshot := jsonb_build_object');
    expect(snapshotMigration).toContain('previous_snapshot, snapshot, actor_id');
    expect(auditMigration).toContain('SECURITY DEFINER');
    expect(auditMigration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  });

  it('shows the latest events for the active declaration in the workflow UI', () => {
    expect(component).toContain("from('customs_declaration_workflow_events')");
    expect(component).toContain(".eq('declaration_id',declarationId)");
    expect(component).toContain('سوابق تغییرات عملیات گمرکی');
    expect(component).toContain('changed_fields');
    expect(component).toContain('refreshHistory()');
  });
});
