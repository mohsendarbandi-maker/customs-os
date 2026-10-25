import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('large chat attachments use resumable Storage uploads', () => {
  const api = read('src/features/chat/api.ts');
  const page = read('src/features/chat/ChatPage.tsx');

  it('switches files larger than 6 MiB to chunked TUS uploads through the first-party proxy', () => {
    expect(api).toContain('TUS_THRESHOLD_BYTES = 6 * 1024 * 1024');
    expect(api).toContain('TUS_CHUNK_BYTES = 6 * 1024 * 1024');
    expect(api).toContain("new URL('/storage/v1/upload/resumable', baseUrl)");
    expect(api).toContain("'Tus-Resumable': '1.0.0'");
    expect(api).toContain("'Upload-Length': String(file.size)");
    expect(api).toContain("Content-Type', 'application/offset+octet-stream");
    expect(api).toContain("if (file.size > TUS_THRESHOLD_BYTES)");
    expect(api).toContain("supabase.storage.from('chat-files').upload");
  });

  it('reconciles interrupted chunks by server offset, retries transient errors and shows progress', () => {
    expect(api).toContain("method: 'HEAD'");
    expect(api).toContain('const retryDelays = [700, 1500, 3000, 5000, 8000]');
    expect(api).toContain('Upload-Offset');
    expect(api).toContain('onProgress?.(Math.min(99');
    expect(page).toContain('attachmentProgress');
    expect(page).toContain('Math.round(attachmentProgress)');
  });

  it('uploads chat attachments directly to their conversation path without quarantine', () => {
    expect(api).toContain('const storagePath = `${organizationId}/${conversationId}/${objectId}`;');
    expect(api).not.toContain('quarantine/${organizationId}/${conversationId}/${objectId}');
    expect(api).toContain("supabase.rpc('chat_register_attachment'");
    expect(api).toContain("supabase.storage.from('chat-files').remove([storagePath])");
  });
});

describe('chat attachment scanning is disabled', () => {
  const migration = read('supabase/migrations/20261026010000_disable_chat_attachment_scanning.sql');
  const scanner = read('supabase/functions/scan-chat-file/index.ts');

  it('removes the database scan triggers and scheduled scanner, defaulting new attachments to available', () => {
    expect(migration).toContain('drop trigger if exists trg_chat_attachment_scan');
    expect(migration).toContain('drop trigger if exists trg_chat_attachment_security_prepare');
    expect(migration).toContain("alter column security_status set default 'clean'");
    expect(migration).toContain("cron.unschedule");
    expect(migration).toContain('chat_files_insert_direct');
    expect(migration).toContain("'^'||v_org::text||'/'||p_conversation_id::text");
  });

  it('keeps the scan edge endpoint inert so residual invocations cannot inspect or block files', () => {
    expect(scanner).toContain('enabled:false');
    expect(scanner).not.toContain('scan(b,a.original_name,a.mime_type)');
    expect(scanner).not.toContain('.move(quarantinePath,finalPath)');
    expect(scanner).not.toContain("from('chat-files').download");
  });
});
