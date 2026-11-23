import { describe, expect, it } from 'vitest';
import { handleFileManagerApi, type FileManagerD1Database, type FileManagerD1Statement } from './file-manager-api';

type Folder = {
  id: string; parent_id: string | null; folder_key: string; folder_type: string;
  display_name: string; client_id: string | null; shipment_id: string | null;
  customs_office_id: string | null; is_system: number | boolean; created_at: string;
  organization_id: string; relative_path: string | null;
};
type FileRow = {
  id: string; folder_id: string; shipment_id: string | null; client_id: string | null;
  file_asset_id: string | null; original_name: string; mime_type: string; size_bytes: number;
  external_message_id: string | null; document_type: string; tags: string | string[] | null;
  metadata: string | Record<string, unknown> | null; shipment_document_id: string | null;
  customs_document_id: string | null; storage_path: string | null;
  operation_sections: string | string[] | null; is_archived: number | boolean;
  created_at: string; organization_id: string; relative_path: string | null;
};
class FakeStatement implements FileManagerD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return this.db.all<T>(this.sql, this.values); }
  async run(): Promise<{ meta?: { changes?: number } }> { return this.db.run(); }
}
class FakeD1 implements FileManagerD1Database {
  file: FileRow | null = null;
  folders: Folder[] = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];
  batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
  prepare(sql: string) { return new FakeStatement(sql, this); }
  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    this.queries.push({ sql, values });
    if (sql.includes('FROM file_manager_files WHERE id=?')) {
      return this.file && this.file.id === values[0] && this.file.organization_id === values[1] ? this.file as T : null;
    }
    if (sql.includes('FROM file_manager_folders WHERE id=?')) {
      const row = this.folders.find((item) => item.id === values[0] && item.organization_id === values[1]);
      return row ? row as T : null;
    }
    throw new Error('Unexpected query: ' + sql);
  }
  async all<T>(sql: string, values: unknown[]): Promise<{ results: T[] }> {
    this.queries.push({ sql, values });
    return { results: [] };
  }
  async run(): Promise<{ meta?: { changes?: number } }> { return { meta: { changes: 1 } }; }
  async batch(statements: FileManagerD1Statement[]): Promise<unknown[]> {
    this.batches.push(statements.map((statement) => {
      const prepared = statement as FakeStatement;
      return { sql: prepared.sql, values: prepared.values };
    }));
    return [];
  }
}
const owner = { id: 'user-a', organization_id: 'org-a', role: 'owner', is_active: true };
const storedFile: FileRow = {
  id: 'file-a', folder_id: 'folder-old', shipment_id: 'shipment-a', client_id: 'client-a',
  file_asset_id: 'asset-a', original_name: 'bill-of-lading.pdf', mime_type: 'application/pdf',
  size_bytes: 1024, external_message_id: 'telegram-message-a', document_type: 'bill_of_lading',
  tags: '[]', metadata: '{}', shipment_document_id: 'shipment-document-a',
  customs_document_id: 'customs-document-a', storage_path: 'telegram://archive-a/message-a',
  operation_sections: '[]', is_archived: 0, created_at: '2026-11-23T00:00:00.000Z',
  organization_id: 'org-a', relative_path: 'owner-a/shipment-a/bill-of-lading.pdf',
};
const folder = (id: string, shipmentId = 'shipment-a', clientId = 'client-a'): Folder => ({
  id, parent_id: 'parent-a', folder_key: 'custom:' + id, folder_type: 'custom',
  display_name: id, client_id: clientId, shipment_id: shipmentId, customs_office_id: null,
  is_system: 0, created_at: '2026-11-23T00:00:00.000Z', organization_id: 'org-a',
  relative_path: 'owner-a/' + id,
});
const makeRequest = (body: unknown, origin = 'https://staging.example') => new Request(
  'https://staging.example/api/file-manager/files/file-a/move',
  { method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) },
);

describe('Cloudflare D1 File Manager API', () => {
  it('moves a file through /files/:id/move and synchronizes linked documents', async () => {
    const db = new FakeD1();
    db.file = storedFile;
    db.folders = [folder('folder-target')];
    const url = new URL('https://staging.example/api/file-manager/files/file-a/move');
    const response = await handleFileManagerApi(makeRequest({ folder_id: 'folder-target' }), db, url, owner);
    const body = await response.json() as { ok: boolean; file?: { folder_id: string } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.file?.folder_id).toBe('folder-target');
    expect(db.batches).toHaveLength(1);
    const sql = db.batches[0].map((item) => item.sql);
    expect(sql.some((s) => s.includes('UPDATE file_manager_files SET folder_id=?'))).toBe(true);
    expect(sql.some((s) => s.includes('UPDATE shipment_documents SET folder_id=?'))).toBe(true);
    expect(sql.some((s) => s.includes('UPDATE customs_documents SET folder_id=?'))).toBe(true);
    expect(sql.some((s) => s.includes('INSERT INTO customs_os_audit_events'))).toBe(true);
  });

  it('blocks moving across shipment or client scopes', async () => {
    const db = new FakeD1();
    db.file = storedFile;
    db.folders = [folder('foreign-folder', 'shipment-b', 'client-a')];
    const url = new URL('https://staging.example/api/file-manager/files/file-a/move');
    const response = await handleFileManagerApi(makeRequest({ folder_id: 'foreign-folder' }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('FILE_MANAGER_SCOPE_MISMATCH');
    expect(db.batches).toHaveLength(0);
  });

  it('does not expose another organization file', async () => {
    const db = new FakeD1();
    db.file = { ...storedFile, organization_id: 'org-b' };
    db.folders = [folder('folder-target')];
    const url = new URL('https://staging.example/api/file-manager/files/file-a/move');
    const response = await handleFileManagerApi(makeRequest({ folder_id: 'folder-target' }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(404);
    expect(body.error).toBe('FILE_NOT_FOUND');
    expect(db.batches).toHaveLength(0);
    expect(db.queries[0].values).toEqual(['file-a', 'org-a']);
  });

  it('rejects cross-origin writes before querying D1', async () => {
    const db = new FakeD1();
    db.file = storedFile;
    db.folders = [folder('folder-target')];
    const url = new URL('https://staging.example/api/file-manager/files/file-a/move');
    const response = await handleFileManagerApi(makeRequest({ folder_id: 'folder-target' }, 'https://attacker.example'), db, url, owner);
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });

  it('denies client role from moving files', async () => {
    const db = new FakeD1();
    db.file = storedFile;
    db.folders = [folder('folder-target')];
    const url = new URL('https://staging.example/api/file-manager/files/file-a/move');
    const response = await handleFileManagerApi(makeRequest({ folder_id: 'folder-target' }), db, url, owner,);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
  });
});
