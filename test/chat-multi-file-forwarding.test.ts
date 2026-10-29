import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('chat attachment workflows', () => {
  it('supports selecting multiple files and adding a separate caption to each', () => {
    const page = read('src/features/chat/ChatPage.tsx');
    const api = read('src/features/chat/api.ts');
    expect(page).toContain('type="file" multiple');
    expect(page).toContain('pendingFiles');
    expect(page).toContain('توضیح این فایل (اختیاری)');
    expect(page).toContain('pendingFiles.length');
    expect(api).toContain('caption?: string');
    expect(api).toContain('p_body: caption?.trim() || null');
  });

  it('restores conversations and message history from a user-scoped cache without persisting signed attachment URLs', () => {
    const page = read('src/features/chat/ChatPage.tsx');
    expect(page).toContain("readOfflineQueryCache<ChatConversation[]>('chat-conversations'");
    expect(page).toContain("saveOfflineQueryCache('chat-conversations'");
    expect(page).toContain("`chat-messages:${id}`");
    expect(page).toContain("attachments:message.attachments?.map(attachment=>({...attachment,url:null}))");
    expect(page).toContain('readOfflineQueryCache<ChatMessage[]>');
    expect(page).toContain('saveOfflineQueryCache(`chat-messages:${id}`');
  });

  it('copies source attachments into the destination conversation when forwarding', () => {
    const api = read('src/features/chat/api.ts');
    expect(api).toContain("from('chat_attachments')");
    expect(api).toContain("from('chat-files').download(attachment.storage_path)");
    expect(api).toContain('uploadChatStorageObject(storagePath, file)');
    expect(api).toContain("rpc('chat_register_attachment'");
    expect(api).toContain('p_conversation_id: targetConversationId');
  });
});
