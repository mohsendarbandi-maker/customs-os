import { describe, expect, it } from 'vitest';
import {
  handleCustomsDeclarationWorkflowApi,
  customsWorkflowCollectConflicts,
  customsWorkflowDefaults,
  customsWorkflowMergePatch,
  customsWorkflowUndoPatch,
  type CustomsWorkflowD1Database,
  type CustomsWorkflowD1Statement,
} from './customs-declaration-workflow-api';

type Row = Record<string, unknown>;
const jsonText = (value: unknown) => JSON.stringify(value);
const stateKeys = [
  'evaluation_state','expertise_state','cashier_state','loading_permit_state',
  'exit_state','port_charges_state','procedure_state',
] as const;
const makeWorkflow = (): Row => ({
  id: 'workflow-1', organization_id: 'org-1', declaration_id: 'decl-1',
  current_stage: 'evaluation',
  evaluation_state: jsonText({ status: 'required', evaluator_number: '', expert_requested: true, expert_request_note: '' }),
  expertise_state: jsonText({ appointment_status: 'not_requested', standard: { expert_review: 'pending' } }),
  cashier_state: jsonText({ method: 'pending' }),
  loading_permit_state: jsonText({ sata_code: '', central_bank_status: 'pending' }),
  exit_state: jsonText({ loading_permission_status: 'pending', financial_registration_status: 'pending' }),
  port_charges_state: jsonText({ warehouse_receipt_date: '', insurance_issue_date: '' }),
  procedure_state: '{}', notes: null, created_by: 'user-1', updated_by: 'user-1',
  last_event_type: 'saved', created_at: '2026-11-25T08:00:00.000Z',
  updated_at: '2026-11-25T08:00:00.000Z',
});
const declaration = {
  id: 'decl-1', organization_id: 'org-1', shipment_id: 'shipment-1',
  customs_path: 'red', customs_regime: 'import_definitive',
  vessel_type: 'foreign', cargo_description: 'ذرت دامی', tariff_code: '100590',
  sata_code: null,
};
const owner = { id: 'user-1', organization_id: 'org-1', role: 'owner', is_active: true };
const request = (method: string, pathname: string, body?: unknown) => new Request(
  'https://staging.example' + pathname,
  {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://staging.example' },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
);
class FakeStatement implements CustomsWorkflowD1Statement {
  private values: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Row>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T = Row>(): Promise<{ results: T[] }> { return this.db.all<T>(this.sql, this.values); }
  async run(): Promise<{ meta?: { changes?: number } }> { return this.db.run(this.sql, this.values); }
}
class FakeD1 implements CustomsWorkflowD1Database {
  declaration: Row | null = { ...declaration };
  workflow: Row | null = null;
  events: Row[] = [];
  queries: string[] = [];
  simulateUnrelatedConcurrentEdit = false;
  prepare(sql: string) { return new FakeStatement(this, sql); }
  async batch(statements: CustomsWorkflowD1Statement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push(sql);
    if (sql.includes('FROM customs_declarations d LEFT JOIN shipment_customs_data')) {
      return this.declaration && this.declaration.id === values[0] && this.declaration.organization_id === values[1]
        ? this.declaration as T : null;
    }
    if (sql.includes('FROM customs_declaration_workflow WHERE declaration_id')) {
      return this.workflow && this.workflow.declaration_id === values[0] && this.workflow.organization_id === values[1]
        ? { ...this.workflow } as T : null;
    }
    if (sql.includes('FROM customs_declaration_workflow_events WHERE workflow_id')) {
      return (this.events.slice().sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null) as T | null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }
  all<T>(sql: string, values: unknown[]): { results: T[] } {
    this.queries.push(sql);
    if (sql.includes('FROM customs_declaration_workflow_events')) {
      const rows = this.events.filter(event => event.declaration_id === values[0] && event.organization_id === values[1]);
      return { results: rows as T[] };
    }
    throw new Error('Unexpected all query: ' + sql);
  }
  run(sql: string, values: unknown[]): { meta?: { changes?: number } } {
    this.queries.push(sql);
    if (sql.includes('INSERT OR IGNORE INTO customs_declaration_workflow')) {
      if (!this.workflow) {
        const [
          id, organization_id, declaration_id, current_stage, evaluation_state, expertise_state,
          cashier_state, loading_permit_state, exit_state, port_charges_state, procedure_state,
          created_by, updated_by, created_at, updated_at,
        ] = values;
        this.workflow = {
          id, organization_id, declaration_id, current_stage, evaluation_state, expertise_state,
          cashier_state, loading_permit_state, exit_state, port_charges_state, procedure_state,
          created_by, updated_by, created_at, updated_at, notes: null, last_event_type: 'saved',
        } as Row;
        this.events.push({
          id: 'event-created', organization_id, declaration_id, workflow_id: id,
          event_type: 'created', previous_stage: null, current_stage,
          changed_fields: jsonText(['current_stage', ...stateKeys, 'notes']),
          previous_snapshot: null,
          snapshot: jsonText(Object.fromEntries(stateKeys.map(key => [key, JSON.parse(String(this.workflow?.[key]))]))),
          actor_id: created_by, created_at,
        });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.includes('UPDATE customs_declaration_workflow SET')) {
      if (!this.workflow) return { meta: { changes: 0 } };
      if (this.simulateUnrelatedConcurrentEdit) {
        const concurrentState = JSON.parse(String(this.workflow.expertise_state)) as Row;
        this.workflow.expertise_state = jsonText({ ...concurrentState, changedByOtherOperator: true });
        this.workflow.updated_at = '2026-11-25T08:00:00.001Z';
        this.simulateUnrelatedConcurrentEdit = false;
      }
      const where = values.slice(-3);
      const [id, organizationId, previousUpdatedAt] = where;
      if (this.workflow.id !== id || this.workflow.organization_id !== organizationId ||
          this.workflow.updated_at !== previousUpdatedAt) return { meta: { changes: 0 } };
      const setPart = sql.split(' SET ')[1]?.split(' WHERE ')[0] || '';
      const columns = setPart.split(',').map(entry => entry.split('=')[0].trim());
      const setValues = values.slice(0, columns.length);
      const before = { ...this.workflow };
      columns.forEach((column, index) => { this.workflow![column] = setValues[index]; });
      const currentSnapshot = Object.fromEntries(stateKeys.map(key => [key, JSON.parse(String(this.workflow?.[key]))]));
      const previousSnapshot = Object.fromEntries(stateKeys.map(key => [key, JSON.parse(String(before[key]))]));
      this.events.push({
        id: 'event-' + this.events.length, organization_id: organizationId,
        declaration_id: this.workflow.declaration_id, workflow_id: id,
        event_type: this.workflow.last_event_type === 'rollback' ? 'rollback'
          : before.current_stage !== this.workflow.current_stage ? 'stage_changed' : 'saved',
        previous_stage: before.current_stage, current_stage: this.workflow.current_stage,
        changed_fields: jsonText(columns.filter(column => column !== 'updated_by' && column !== 'updated_at' && column !== 'last_event_type')),
        previous_snapshot: jsonText({ ...previousSnapshot, notes: before.notes }),
        snapshot: jsonText({ ...currentSnapshot, notes: this.workflow.notes }),
        actor_id: this.workflow.updated_by, created_at: this.workflow.updated_at,
      });
      return { meta: { changes: 1 } };
    }
    throw new Error('Unexpected run query: ' + sql);
  }
}
const parse = async (response: Response) => response.json() as Promise<Row>;

describe('Cloudflare D1 customs declaration workflow API', () => {
  it('reads only a declaration in the active organization and returns no row before creation', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1');
    const response = await handleCustomsDeclarationWorkflowApi(request('GET', url.pathname), db, url, owner);
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.declaration).toMatchObject({ id: 'decl-1', shipment_id: 'shipment-1', customs_path: 'red' });
    expect(body.workflow).toBeNull();
    expect(db.queries[0]).toContain('d.organization_id=?');
  });

  it('does not reveal a declaration belonging to another organization', async () => {
    const db = new FakeD1();
    db.declaration = { ...declaration, organization_id: 'other-org' };
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1');
    const response = await handleCustomsDeclarationWorkflowApi(request('GET', url.pathname), db, url, owner);
    expect(response.status).toBe(404);
  });

  it('creates a workflow once with data-driven customs defaults and records its created event', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1');
    const response = await handleCustomsDeclarationWorkflowApi(request('POST', url.pathname, {}), db, url, owner);
    const body = await parse(response);
    expect(response.status).toBe(201);
    expect(body.workflow).toMatchObject({
      current_stage: 'evaluation',
      evaluation_state: { status: 'required' },
      expertise_state: { road_authority_status: 'pending', plant_quarantine_status: 'pending' },
      loading_permit_state: { sata_code: '' },
    });
    expect(db.events[0].event_type).toBe('created');
    expect(customsWorkflowDefaults(declaration).expertise.plant_quarantine_status).toBe('pending');
  });

  it('rejects cross-tenant writes and disallowed user roles', async () => {
    const db = new FakeD1();
    db.workflow = makeWorkflow();
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1/activity');
    const response = await handleCustomsDeclarationWorkflowApi(
      request('PATCH', url.pathname, {
        activity: 'evaluation', patch: { evaluator_number: '3' },
        baseState: { status: 'required', evaluator_number: '', expert_requested: true, expert_request_note: '' },
        expectedCurrentStage: 'evaluation',
      }),
      db, url, { ...owner, role: 'client' },
    );
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });

  it('rejects field-level conflicts rather than overwriting another operator edit', async () => {
    const db = new FakeD1();
    db.workflow = makeWorkflow();
    db.workflow.evaluation_state = jsonText({ status: 'required', evaluator_number: '8', expert_requested: true, expert_request_note: '' });
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1/activity');
    const response = await handleCustomsDeclarationWorkflowApi(
      request('PATCH', url.pathname, {
        activity: 'evaluation',
        patch: { evaluator_number: '3' },
        baseState: { status: 'required', evaluator_number: '', expert_requested: true, expert_request_note: '' },
        expectedCurrentStage: 'evaluation',
      }),
      db, url, owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(409);
    expect(body.error).toBe('CUSTOMS_WORKFLOW_CONFLICT');
    expect(body.conflicts).toEqual(['evaluator_number']);
  });

  it('updates only the selected activity state and keeps current stage monotonic under a parallel stage change', async () => {
    const db = new FakeD1();
    db.workflow = makeWorkflow();
    db.workflow.current_stage = 'expertise';
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1/activity');
    const response = await handleCustomsDeclarationWorkflowApi(
      request('PATCH', url.pathname, {
        activity: 'evaluation',
        patch: { evaluator_number: '3' },
        baseState: { status: 'required', evaluator_number: '', expert_requested: true, expert_request_note: '' },
        expectedCurrentStage: 'evaluation',
      }),
      db, url, owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.workflow.evaluation_state.evaluator_number).toBe('3');
    expect(body.workflow.current_stage).toBe('expertise');
    expect(db.events[0].event_type).toBe('saved');
  });

  it('retries a stale CAS after a disjoint activity edit without losing either operator update', async () => {
    const db = new FakeD1();
    db.workflow = makeWorkflow();
    db.simulateUnrelatedConcurrentEdit = true;
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1/activity');
    const response = await handleCustomsDeclarationWorkflowApi(
      request('PATCH', url.pathname, {
        activity: 'evaluation',
        patch: { evaluator_number: '3' },
        baseState: {
          status: 'required', evaluator_number: '', expert_requested: true, expert_request_note: '',
        },
        expectedCurrentStage: 'evaluation',
      }),
      db, url, owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.workflow.evaluation_state.evaluator_number).toBe('3');
    expect(body.workflow.expertise_state.changedByOtherOperator).toBe(true);
    expect(db.workflow?.current_stage).toBe('evaluation');
    expect(db.queries.filter(sql => sql.includes('UPDATE customs_declaration_workflow SET'))).toHaveLength(2);
  });

  it('keeps nested parallel edits when undoing a saved JSON patch', () => {
    const result = customsWorkflowUndoPatch(
      { standard: { expert_review: 'approved', inspection_fee: 100, sample_status: 'received' } },
      { standard: { expert_review: 'pending', inspection_fee: null, sample_status: 'not_sent' } },
      { standard: { expert_review: 'approved', inspection_fee: 100, sample_status: 'not_sent' } },
    ) as Row;
    expect(result.standard).toEqual({
      expert_review: 'pending',
      inspection_fee: null,
      sample_status: 'received',
    });
  });

  it('returns server-side final readiness issues without advancing an incomplete workflow', async () => {
    const db = new FakeD1();
    db.workflow = makeWorkflow();
    const url = new URL('https://staging.example/api/customs-declaration-workflows/decl-1/complete');
    const response = await handleCustomsDeclarationWorkflowApi(request('POST', url.pathname, {}), db, url, owner);
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(Array.isArray(body.issues)).toBe(true);
    expect((body.issues as unknown[]).length).toBeGreaterThan(0);
    expect(db.workflow?.current_stage).toBe('evaluation');
  });

  it('merges nested JSON patches without replacing untouched values', () => {
    expect(customsWorkflowMergePatch(
      { standard: { expert_review: 'pending', inspection_fee: null, inspection_paid: false } },
      { standard: { inspection_fee: 0 } },
    )).toEqual({ standard: { expert_review: 'pending', inspection_fee: 0, inspection_paid: false } });
  });

  it('reports conflicting nested leaves only', () => {
    expect(customsWorkflowCollectConflicts(
      { standard: { expert_review: 'approved', inspection_fee: null } },
      { standard: { expert_review: 'pending', inspection_fee: null } },
      { standard: { inspection_fee: 200 } },
    )).toEqual([]);
    expect(customsWorkflowCollectConflicts(
      { standard: { expert_review: 'approved', inspection_fee: null } },
      { standard: { expert_review: 'pending', inspection_fee: null } },
      { standard: { expert_review: 'rejected' } },
    )).toEqual(['standard.expert_review']);
  });
});
