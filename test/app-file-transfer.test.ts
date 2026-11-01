import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('cross-workspace file handoff', () => {
  it('stores file bytes in IndexedDB and consumes a transfer only for its intended destination', () => {
    const transfer = read('src/lib/appFileTransfer.ts');
    expect(transfer).toContain("indexedDB.open(DATABASE_NAME");
    expect(transfer).toContain("createObjectStore(STORE_NAME, { keyPath: 'id' })");
    expect(transfer).toContain('file.slice(0, file.size');
    expect(transfer).toContain('value.target !== expectedTarget');
    expect(transfer).toContain('store.delete(id)');
    expect(transfer).toContain('TRANSFER_TTL_MS');
  });

  it('connects Chat, PDF Studio and File Manager in both directions', () => {
    const chat = read('src/features/chat/ChatPage.tsx');
    const studio = read('src/pages/PdfStudioPage.tsx');
    const manager = read('src/pages/FileManagerPage.tsx');

    expect(chat).toContain("consumeAppFileTransfer(incomingFileTransferId,'chat')");
    expect(chat).toContain("transferMessageAttachments('pdf-studio')");
    expect(chat).toContain("transferMessageAttachments('file-manager')");
    expect(chat).toContain("from('chat-files').download(attachment.storage_path)");

    expect(studio).toContain("consumeAppFileTransfer(incomingTransferId, 'pdf-studio')");
    expect(studio).toContain("transferReadyOutput(output, 'file-manager')");
    expect(studio).toContain("transferReadyOutput(output, 'chat')");

    expect(manager).toContain("consumeAppFileTransfer(incomingTransferId, 'file-manager')");
    expect(manager).toContain("transferFileFromManager(file,'pdf-studio')");
    expect(manager).toContain("transferFileFromManager(file,'chat')");
    expect(manager).toContain('uploadTelegramArchivedFile');
  });

  it('keeps the existing chat-to-chat forward operation intact', () => {
    const chat = read('src/features/chat/ChatPage.tsx');
    const api = read('src/features/chat/api.ts');
    expect(chat).toContain('await forwardChatMessage(forwardId,targetId,operationId)');
    expect(api).toContain('uploadChatForwardAttachment(storagePath, file)');
    expect(api).toContain("rpc('chat_register_attachment'");
  });
});
