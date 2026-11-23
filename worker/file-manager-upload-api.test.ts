import { describe, expect, it } from 'vitest';
import {
  getFileManagerArchiveStatus,
  handleFileManagerUpload,
  type FileManagerD1Database,
  type FileManagerD1Statement,
} from './file-manager-upload-api';

type Folder = {
  id: string;
  organization_id: string;
  client_id: string | null;
  shipment_id: string | null;
  folder_type: string;
  display_name: string;
  relative_path: string | null;
};

type Job = {
  id: string;
  organization_id: string;
  idempotency_key: string;
  file_manager_file_id: string;
  folder_id: string;
  shipment_id: string | null;
  client_id: string | null;
  original_name: string;
  document_name: string;
  mime_type: string;
  size_bytes: number;
  document_type: string;
  tags: string;
  operation_sections: string;
  status: string;
  telegram_chat_id: string | null;
  telegram_connection_id: string | null;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  external_message_id: string | null;
  error_code: string | null;
  created_by: string;
};

class FakeStatement implements FileManagerD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.values);
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.values);
  }
  async run(): Promise<{ meta?: { changes?: number } }> {
    return this.db.run(this.sql, this.values);
  }
}

class FakeD1 implements FileManagerD1Database {
  destination: Record<string, unknown> = {
    eligible_records: 84,
    distinct_chat_ids: 1,
    distinct_connection_ids: 1,
    chat_id: '-1001234567890',
    connection_id: '11111111-1111-4111-8111-111111111111',
  };
  folder: Folder = {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: 'org-a',
    client_id: 'client-a',
    shipment_id: 'shipment-a',
    folder_type: 'other',
    display_name: 'اسناد محموله',
    relative_path: 'صاحب کالا/محموله/اسناد محموله',
  };
  job: Job | null = null;
  storedFile: Record<string, unknown> | null = null;
  runs: Array<{ sql: string; values: unknown[] }> = [];
  batches: Array<Array<{ sql: string; values: unknown[] }>> = [];

  prepare(sql: string) { return new FakeStatement(sql, this); }

  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('COUNT(DISTINCT')) return this.destination as T;
    if (sql.includes('FROM file_manager_folders WHERE id=?')) return this.folder as T;
    if (sql.includes('FROM file_manager_upload_jobs WHERE organization_id=?')) return this.job as T | null;
    if (sql.includes('FROM file_manager_files WHERE id=?')) return this.storedFile as T | null;
    throw new Error('Unexpected first query: ' + sql);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(sql: string, values: unknown[]): Promise<{ meta?: { changes?: number } }> {
    this.runs.push({ sql, values });
    if (sql.startsWith('INSERT OR IGNORE INTO file_manager_upload_jobs')) {
      if (this.job) return { meta: { changes: 0 } };
      const [
        id,organizationId,idempotencyKey,fileId,folderId,shipmentId,clientId,
        originalName,documentName,mimeType,sizeBytes,documentType,tags,operationSections,createdBy,
      ] = values;
      this.job = {
        id:String(id),organization_id:String(organizationId),idempotency_key:String(idempotencyKey),
        file_manager_file_id:String(fileId),folder_id:String(folderId),shipment_id:shipmentId as string|null,
        client_id:clientId as string|null,original_name:String(originalName),document_name:String(documentName),
        mime_type:String(mimeType),size_bytes:Number(sizeBytes),document_type:String(documentType),
        tags:String(tags),operation_sections:String(operationSections),status:'uploading',telegram_chat_id:null,telegram_connection_id:null,
        telegram_file_id:null,telegram_file_unique_id:null,external_message_id:null,error_code:null,
        created_by:String(createdBy),
      };
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE file_manager_upload_jobs SET status=\'receipt_recorded\'')) {
      if (!this.job) return { meta: { changes: 0 } };
      const [chatId,connectionId,fileId,uniqueId,messageId,_updatedAt] = values;
      Object.assign(this.job,{
        status:'receipt_recorded',telegram_chat_id:chatId,telegram_connection_id:connectionId,
        telegram_file_id:fileId,telegram_file_unique_id:uniqueId,external_message_id:messageId,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE file_manager_upload_jobs SET status=\'reconcile_required\'')) {
      if (this.job) this.job.status='reconcile_required';
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE file_manager_upload_jobs SET status=\'failed\'')) {
      if (this.job) this.job.status='failed';
      return { meta: { changes: 1 } };
    }
    throw new Error('Unexpected run query: ' + sql);
  }

  async batch(statements: FileManagerD1Statement[]): Promise<unknown[]> {
    const prepared = statements.map((statement) => {
      const item = statement as FakeStatement;
      return { sql:item.sql,values:item.values };
    });
    this.batches.push(prepared);
    const insert = prepared.find((item) => item.sql.includes('INSERT OR IGNORE INTO file_manager_files'));
    if (insert) {
      this.storedFile = {
        id:insert.values[0],
        file_asset_id:insert.values[4],
        external_message_id:insert.values[8],
        size_bytes:insert.values[7],
      };
    }
    if (this.job) this.job.status='stored';
    return [{ meta: { changes: 1 } },{ meta: { changes: 1 } },{ meta: { changes: 1 } }];
  }
}

const profile = { id:'user-a',organization_id:'org-a',role:'owner',is_active:true };
const makeRequest = (body: Uint8Array, options: { origin?: string; key?: string; name?: string } = {}) => {
  const url = new URL(
    'https://staging.example/api/file-manager/uploads?folder_id=22222222-2222-4222-8222-222222222222&shipment_id=shipment-a&document_type=bill_of_lading&tags=%5B%22بارنامه%22%5D',
  );
  return new Request(url, {
    method:'POST',
    headers:{
      origin:options.origin || url.origin,
      'sec-fetch-site':'same-origin',
      'content-type':'application/pdf',
      'x-file-name':encodeURIComponent(options.name || 'بارنامه-۱۲۳.pdf'),
      'x-file-size':String(body.byteLength),
      'idempotency-key':options.key || 'customs-os-upload-v1:' + 'a'.repeat(64),
    },
    body,
  });
};

describe('Cloudflare D1 Telegram File Manager upload', () => {
  it('streams a file to the unique legacy Telegram archive destination and records its D1 receipt', async () => {
    const db = new FakeD1();
    let telegramCalled = false;
    const fetcher: typeof fetch = async (input, init) => {
      telegramCalled = true;
      expect(String(input)).toContain('/botTEST_TOKEN/sendDocument');
      const form = init?.body as FormData;
      expect(form.get('chat_id')).toBe('-1001234567890');
      expect((form.get('document') as File).name).toBe('بارنامه-۱۲۳.pdf');
      expect(String(form.get('caption'))).toContain('#CustomsOS');
      return new Response(JSON.stringify({
        ok:true,
        result:{
          message_id:321,
          chat:{id:-1001234567890},
          document:{file_id:'telegram-file-a',file_unique_id:'telegram-unique-a'},
        },
      }),{status:200,headers:{'content-type':'application/json'}});
    };
    const response = await handleFileManagerUpload(
      makeRequest(new TextEncoder().encode('%PDF-test')),
      {MIGRATION_DB:db,TELEGRAM_BOT_TOKEN:'TEST_TOKEN'},
      new URL('https://staging.example/api/file-manager/uploads'),
      profile,
      fetcher,
    );
    const body = await response.json() as {ok:boolean;fileAssetId:string;externalMessageId:string;folderId:string};
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.fileAssetId).toBeDefined();
    expect(body.externalMessageId).toBe('321');
    expect(body.folderId).toBe(db.folder.id);
    expect(telegramCalled).toBe(true);
    expect(db.job?.status).toBe('stored');
    expect(db.job?.telegram_file_id).toBe('telegram-file-a');
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0].some((statement) => statement.sql.includes('INSERT INTO customs_os_audit_events'))).toBe(true);
    expect(db.storedFile?.file_asset_id).toBe(body.fileAssetId);
  });

  it('refuses an ambiguous legacy Telegram destination before sending any bytes', async () => {
    const db = new FakeD1();
    db.destination = {
      eligible_records:84,distinct_chat_ids:2,distinct_connection_ids:1,
      chat_id:'-1001',connection_id:'11111111-1111-4111-8111-111111111111',
    };
    let called = false;
    const response = await handleFileManagerUpload(
      makeRequest(new TextEncoder().encode('%PDF-test')),
      {MIGRATION_DB:db,TELEGRAM_BOT_TOKEN:'TEST_TOKEN'},
      new URL('https://staging.example/api/file-manager/uploads'),
      profile,
      async () => { called=true; throw new Error('must not send'); },
    );
    const body = await response.json() as {error:string};
    expect(response.status).toBe(409);
    expect(body.error).toBe('FILE_ARCHIVE_NOT_CONFIGURED_OR_AMBIGUOUS');
    expect(called).toBe(false);
    expect(db.runs.some((item) => item.sql.startsWith('INSERT OR IGNORE INTO file_manager_upload_jobs'))).toBe(false);
  });

  it('returns aggregate archive readiness without exposing Telegram identifiers', async () => {
    const db = new FakeD1();
    const response = await getFileManagerArchiveStatus(db,profile);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string,unknown>;
    expect(response.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.sourceRecords).toBe(84);
    expect(text).not.toContain('-1001234567890');
    expect(text).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('does not query D1 or Telegram for cross-origin uploads', async () => {
    const db = new FakeD1();
    let called = false;
    const response = await handleFileManagerUpload(
      makeRequest(new TextEncoder().encode('%PDF-test'),{origin:'https://evil.example'}),
      {MIGRATION_DB:db,TELEGRAM_BOT_TOKEN:'TEST_TOKEN'},
      new URL('https://staging.example/api/file-manager/uploads'),
      profile,
      async () => { called=true; throw new Error('must not send'); },
    );
    expect(response.status).toBe(403);
    expect(called).toBe(false);
    expect(db.runs).toHaveLength(0);
  });
});
