import { describe, expect, it } from 'vitest';
import {
  handleClientsApi,
  normalizeClientNationalId,
  type ClientD1Database,
  type ClientD1Statement,
  type ClientRecord,
} from './clients-api';

interface StoredClient extends ClientRecord {
  organization_id: string;
  file_manager_search_text: string;
}

class FakeStatement implements ClientD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return this.db.all<T>(this.sql, this.values); }
  async run() { return { meta: { changes: this.db.run(this.sql, this.values) } }; }
}

class FakeD1 implements ClientD1Database {
  clients: StoredClient[] = [];
  audit: Array<Record<string, unknown>> = [];
  dependencies: Record<string, number> = {
    cases: 0, shipments: 0, registration_orders: 0, customs_documents: 0,
    file_manager_files: 0, file_manager_folders: 0, finance_cost_items: 0,
    customs_accounting_vouchers: 0,
  };

  prepare(sql: string) { return new FakeStatement(sql, this); }

  async batch(statements: ClientD1Statement[]) {
    let changes = 0;
    for (const statement of statements as FakeStatement[]) {
      changes = this.run(statement.sql, statement.values, changes);
    }
    return [];
  }

  first<T>(sql: string, values: unknown[]): T | null {
    if (sql.includes('SELECT COUNT(*) AS total FROM clients')) {
      return { total: this.filtered(values, sql).length } as T;
    }
    if (sql.includes('SELECT id FROM clients WHERE organization_id = ? AND national_id = ?')) {
      const org = String(values[0]);
      const nationalId = String(values[1]);
      const exclude = sql.includes('id <> ?') ? String(values[2]) : '';
      const row = this.clients.find((item) =>
        item.organization_id === org && item.national_id === nationalId && (!exclude || item.id !== exclude)
      );
      return row ? { id: row.id } as T : null;
    }
    if (sql.includes('FROM clients WHERE id = ? AND organization_id = ?')) {
      const row = this.clients.find((item) =>
        item.id === String(values[0]) && item.organization_id === String(values[1])
      );
      return row ? this.publicRecord(row) as T : null;
    }
    if (sql.includes('AS customs_accounting_vouchers')) return { ...this.dependencies } as T;
    throw new Error('Unexpected first query: ' + sql);
  }

  all<T>(sql: string, values: unknown[]): { results: T[] } {
    const search = sql.includes('AND (name LIKE ? OR national_id LIKE ?)');
    const rows = this.filtered(values, sql);
    const limit = Number(values[search ? 3 : 1]);
    const offset = Number(values[search ? 4 : 2]);
    return { results: rows.slice(offset, offset + limit).map((row) => this.publicRecord(row) as T) };
  }

  private filtered(values: unknown[], sql: string) {
    const org = String(values[0]);
    const searchEnabled = sql.includes('AND (name LIKE ? OR national_id LIKE ?)');
    const search = searchEnabled ? String(values[1]).replace(/%/g, '') : '';
    return this.clients.filter((row) => row.organization_id === org)
      .filter((row) => !search || row.name.includes(search) || String(row.national_id).includes(search))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id.localeCompare(a.id));
  }

  private publicRecord(row: StoredClient): ClientRecord {
    return {
      id: row.id, name: row.name, national_id: row.national_id, notes: row.notes,
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  run(sql: string, values: unknown[], previousChanges = 0): number {
    if (sql.startsWith('INSERT INTO clients')) {
      const [id, orgId, name, nationalId, notes, createdAt, updatedAt, searchText, duplicateOrg, duplicateNationalId] = values;
      if (this.clients.some((row) => row.organization_id === duplicateOrg && row.national_id === duplicateNationalId)) return 0;
      this.clients.push({
        id: String(id), organization_id: String(orgId), name: String(name), national_id: String(nationalId),
        notes: notes as string | null, created_at: String(createdAt), updated_at: String(updatedAt),
        file_manager_search_text: String(searchText),
      });
      return 1;
    }
    if (sql.startsWith('UPDATE clients SET')) {
      const [name, nationalId, notes, updatedAt, searchText, id, orgId, duplicateOrg, duplicateNationalId, excludeId] = values;
      if (this.clients.some((row) => row.organization_id === duplicateOrg && row.national_id === duplicateNationalId && row.id !== excludeId)) return 0;
      const row = this.clients.find((item) => item.id === id && item.organization_id === orgId);
      if (!row) return 0;
      row.name = String(name);
      row.national_id = String(nationalId);
      row.notes = notes as string | null;
      row.updated_at = String(updatedAt);
      row.file_manager_search_text = String(searchText);
      return 1;
    }
    if (sql.startsWith('DELETE FROM clients')) {
      const [id, orgId] = values;
      if (Object.values(this.dependencies).some((count) => count > 0)) return 0;
      const index = this.clients.findIndex((item) => item.id === id && item.organization_id === orgId);
      if (index < 0) return 0;
      this.clients.splice(index, 1);
      return 1;
    }
    if (sql.startsWith('INSERT INTO customs_os_audit_events')) {
      if (!sql.includes('WHERE changes() > 0') || previousChanges > 0) {
        const [id, org, actor, action, type, entity, before, after, requestId, createdAt] = values;
        this.audit.push({ id, organization_id: org, actor_user_id: actor, action, entity_type: type,
          entity_id: entity, before_json: before, after_json: after, request_id: requestId, created_at: createdAt });
      }
      return 1;
    }
    throw new Error('Unexpected write query: ' + sql);
  }
}

const profile = { id: 'user-a', organization_id: 'org-a', role: 'owner', is_active: true };
const request = (method: string, path: string, body?: unknown, origin = 'https://staging.example') =>
  new Request('https://staging.example' + path, {
    method,
    headers: { ...(method === 'GET' ? {} : { origin }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('Cloudflare D1 clients API', () => {
  it('normalizes Persian and Arabic digits', () => {
    expect(normalizeClientNationalId('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(normalizeClientNationalId('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
  });

  it('lists only the authenticated organization with search and pagination', async () => {
    const db = new FakeD1();
    db.clients = [
      { id: 'a', organization_id: 'org-a', name: 'شرکت الف', national_id: '111', notes: null, created_at: '2026-01-01', updated_at: null, file_manager_search_text: '' },
      { id: 'b', organization_id: 'org-b', name: 'شرکت خصوصی', national_id: '222', notes: null, created_at: '2026-01-03', updated_at: null, file_manager_search_text: '' },
      { id: 'c', organization_id: 'org-a', name: 'شرکت ج', national_id: '333', notes: null, created_at: '2026-01-02', updated_at: null, file_manager_search_text: '' },
    ];
    const url = new URL('https://staging.example/api/clients?limit=1&offset=0&search=شرکت');
    const response = await handleClientsApi(request('GET', url.pathname + url.search), { MIGRATION_DB: db }, url, profile);
    const body = await response.json() as { items: ClientRecord[]; total: number };
    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual(['c']);
  });

  it('blocks a cross-origin write', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/clients');
    const response = await handleClientsApi(
      request('POST', url.pathname, { name: 'شرکت الف', nationalId: '12345', notes: '' }, 'https://evil.example'),
      { MIGRATION_DB: db }, url, profile,
    );
    expect(response.status).toBe(403);
    expect(db.clients).toHaveLength(0);
  });

  it('creates a tenant-owned record and an audit event in one D1 batch', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/clients');
    const response = await handleClientsApi(
      request('POST', url.pathname, { name: 'شرکت الف', nationalId: '۱۲۳۴۵۶', notes: 'یادداشت' }),
      { MIGRATION_DB: db }, url, profile,
    );
    const body = await response.json() as { client: ClientRecord };
    expect(response.status).toBe(201);
    expect(db.clients[0].organization_id).toBe('org-a');
    expect(db.clients[0].national_id).toBe('123456');
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0].action).toBe('create');
    expect(body.client.id).toBe(db.clients[0].id);
  });

  it('updates with before/after audit values and rejects duplicate national IDs', async () => {
    const db = new FakeD1();
    db.clients.push({ id: 'one', organization_id: 'org-a', name: 'قدیم', national_id: '12345', notes: null, created_at: null, updated_at: null, file_manager_search_text: '' });
    db.clients.push({ id: 'two', organization_id: 'org-a', name: 'دیگر', national_id: '67890', notes: null, created_at: null, updated_at: null, file_manager_search_text: '' });
    const url = new URL('https://staging.example/api/clients/one');
    const duplicate = await handleClientsApi(
      request('PATCH', url.pathname, { name: 'تغییر', nationalId: '67890', notes: '' }),
      { MIGRATION_DB: db }, url, profile,
    );
    expect(duplicate.status).toBe(409);
    expect(db.clients[0].name).toBe('قدیم');
    const updated = await handleClientsApi(
      request('PATCH', url.pathname, { name: 'جدید', nationalId: '54321', notes: 'تغییر' }),
      { MIGRATION_DB: db }, url, profile,
    );
    const body = await updated.json() as { client: ClientRecord };
    expect(updated.status).toBe(200);
    expect(body.client.name).toBe('جدید');
    expect(db.audit.some((entry) => entry.action === 'update')).toBe(true);
  });

  it('does not reveal a record belonging to another organization', async () => {
    const db = new FakeD1();
    db.clients.push({ id: 'private', organization_id: 'org-b', name: 'محرمانه', national_id: '12345', notes: null, created_at: null, updated_at: null, file_manager_search_text: '' });
    const url = new URL('https://staging.example/api/clients/private');
    const response = await handleClientsApi(request('GET', url.pathname), { MIGRATION_DB: db }, url, profile);
    expect(response.status).toBe(404);
  });

  it('blocks deletion when operational, archive or finance dependencies exist', async () => {
    const db = new FakeD1();
    db.clients.push({ id: 'client-a', organization_id: 'org-a', name: 'صاحب کالا', national_id: '12345', notes: null, created_at: null, updated_at: null, file_manager_search_text: '' });
    db.dependencies.file_manager_files = 1;
    const url = new URL('https://staging.example/api/clients/client-a');
    const response = await handleClientsApi(request('DELETE', url.pathname), { MIGRATION_DB: db }, url, profile);
    const body = await response.json() as { error: string; dependencies: Record<string, number> };
    expect(response.status).toBe(409);
    expect(body.error).toBe('CLIENT_HAS_DEPENDENCIES');
    expect(body.dependencies.file_manager_files).toBe(1);
    expect(db.clients).toHaveLength(1);
  });

  it('deletes an unreferenced client and records the delete audit event', async () => {
    const db = new FakeD1();
    db.clients.push({ id: 'client-a', organization_id: 'org-a', name: 'صاحب کالا', national_id: '12345', notes: null, created_at: null, updated_at: null, file_manager_search_text: '' });
    const url = new URL('https://staging.example/api/clients/client-a');
    const response = await handleClientsApi(request('DELETE', url.pathname), { MIGRATION_DB: db }, url, profile);
    expect(response.status).toBe(204);
    expect(db.clients).toHaveLength(0);
    expect(db.audit.some((entry) => entry.action === 'delete')).toBe(true);
  });

  it('rejects a non-management role', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/clients');
    const response = await handleClientsApi(request('GET', url.pathname), { MIGRATION_DB: db }, url, { ...profile, role: 'warehouse' });
    expect(response.status).toBe(403);
  });
});
