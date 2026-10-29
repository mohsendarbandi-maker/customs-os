import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const page = fs.readFileSync(path.resolve(__dirname, 'ChatPage.tsx'), 'utf8');
const api = fs.readFileSync(path.resolve(__dirname, 'api.ts'), 'utf8');
describe('chat attachments and forwarding', () => {
  it('allows selecting multiple files of any type and captions per file', () => {
    expect(page).toContain('type="file" multiple className="hidden" accept="*/*"');
    expect(page).toContain('هر بار حداکثر ۱۰ فایل را انتخاب کنید');
    expect(page).toContain('item.caption.trim()||undefined');
    expect(page).toContain("ارسال '+pendingFiles.length+' فایل");
  });
  it('keeps special group destinations when the regular conversation list is empty', () => {
    const start = api.indexOf('export async function listConversations()');
    const end = api.indexOf('async function enrichMessages', start);
    const listing = api.slice(start, end);
    expect(listing).toContain('const hierarchy = await listChatHierarchy()');
    expect(listing).toContain('return mergeChatConversationSources(regular, hierarchyConversations)');
    expect(listing).not.toContain('if (!conversations.length) return conversations');
  });
  it('copies file attachments to the destination conversation when forwarding', () => {
    const start = api.indexOf('export async function forwardChatMessage(');
    const end = api.indexOf('\nexport async function shareShipmentUpdate', start);
    const forward = api.slice(start, end);
    expect(forward).toContain(".from('chat_attachments')");
    expect(forward).toContain("supabase.storage.from('chat-files').download(attachment.storage_path)");
    expect(forward).toContain('await uploadChatStorageObject(storagePath, file)');
    expect(forward).toContain("supabase.rpc('chat_register_attachment'");
    expect(forward).toContain('await deleteForAll(forwarded.id)');
    expect(forward).toContain('sourceAttachments.length === 0');
    expect(forward).toContain('if (!attachment.storage_path)');
  });
  it('shows forwarding success separately from errors', () => {
    expect(page).toContain("setSuccess('پیام و پیوست‌ها به گفتگو ارسال شدند.')");
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).not.toContain("setError('پیام ارسال شد.')");
  });
});
