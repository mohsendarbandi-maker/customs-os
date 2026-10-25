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

  it('keeps the existing quarantine and attachment registration flow after upload', () => {
    expect(api).toContain('quarantine/${organizationId}/${conversationId}/${objectId}');
    expect(api).toContain("supabase.rpc('chat_register_attachment'");
    expect(api).toContain("supabase.storage.from('chat-files').remove([storagePath])");
  });
});
