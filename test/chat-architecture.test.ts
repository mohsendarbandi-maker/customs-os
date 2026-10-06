import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

describe('chat architecture invariants',()=>{
  it('keeps one canonical settings implementation',()=>{
    const legacy=read('src/pages/SettingsPage.tsx');
    expect(legacy).toContain("export { SettingsEnterprisePage as SettingsPage }");
    expect(legacy).not.toContain("localStorage.setItem('customs-settings'");
  });

  it('opens member DMs from the canonical conversation id',()=>{
    const page=read('src/features/chat/ChatPage.tsx');
    expect(page).toContain('const conversationId=conversation.id;');
    expect(page).not.toContain("setSelectedId(c.conversation_id)");
  });

  it('uses one shared conversation dataset for hierarchy rendering',()=>{
    const hierarchy=read('src/features/chat/ChatHierarchyPanel.tsx');
    expect(hierarchy).toContain('conversations:ChatConversation[]');
    expect(hierarchy).not.toContain("from'./api'");
    expect(hierarchy).not.toContain('listChatHierarchy(');
  });

  it('does not expose duplicate owner/group directory logic',()=>{
    const quickNav=read('src/features/chat/ChatQuickNav.tsx');
    expect(quickNav).toContain("export type ChatDirectoryMode='calls'|'members';");
    expect(quickNav).not.toContain("mode==='groups'");
    expect(quickNav).not.toContain("mode==='owners'");
  });

  it('does not persist chat preferences in global localStorage keys',()=>{
    const settings=read('src/features/chat/ChatSettingsPanel.tsx');
    expect(settings).toContain('userChatPreferencesStorageKey(user.id)');
    expect(settings).not.toContain("localStorage.setItem('customs-chat-preferences'");
  });

  it('keeps the shared offline queue worker singleton',()=>{
    const queue=read('src/lib/supabase.ts');
    const status=read('src/components/OfflineQueueStatus.tsx');
    expect(queue).toContain('startOfflineQueue()');
    expect(status).not.toContain('startOfflineQueue()');
  });
});
