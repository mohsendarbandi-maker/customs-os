import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = (name: string) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const scopeMigration = migration('20261014140105_workspace_reminder_team_scope_hardening.sql');
const completionMigration = migration('20261014141346_workspace_complete_reminder_team_scope.sql');

describe('reminder explicit-scope security regression', () => {
  it('does not grant row access solely because visibility is team', () => {
    expect(scopeMigration).toContain('CREATE POLICY operational_reminders_select');
    expect(scopeMigration).toContain('OR created_by = (SELECT auth.uid())');
    expect(scopeMigration).toContain('OR assignee_id = (SELECT auth.uid())');
    expect(scopeMigration).not.toContain("visibility = 'team'");
  });

  it('limits reminder delivery to the responsible assignee until explicit shares exist', () => {
    expect(scopeMigration).toContain('v_recipients := ARRAY[NEW.assignee_id]');
    expect(scopeMigration).not.toContain('array_agg(p.id)');
  });

  it('does not allow complete RPC to bypass reminder scope via team visibility', () => {
    expect(completionMigration).toContain('r.assignee_id = v_actor');
    expect(completionMigration).toContain('r.created_by = v_actor');
    expect(completionMigration).not.toContain("r.visibility = 'team'");
    expect(completionMigration).not.toContain('reminder_entity_is_visible(r.organization_id');
  });
});
