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
  it('bridges external messengers into the canonical chat instead of a second inbox',()=>{
    const migration=read('supabase/migrations/20261011173500_messenger_unified_chat_bridge.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const integration=read('src/pages/MessengerIntegrationsPage.tsx');
    expect(migration).toContain('messenger_chats');
    expect(migration).toContain('conversation_id uuid references public.chat_conversations');
    expect(migration).toContain('external_message_id');
    expect(gateway).toContain('external_sender_name');
    expect(gateway).toContain('CORE_CHAT_MIRROR_FAILED');
    expect(integration).toContain('گفتگوی داخلی Customs OS');
    expect(integration).toContain('conversationId:conversationId||null');
  });

  it('does not deliver quarantined or unscanned chat attachments to external messengers',()=>{
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const scanner=read('supabase/functions/scan-chat-file/index.ts');
    expect(gateway).toContain('security_status==="clean"');
    expect(gateway).toContain('startsWith("quarantine/")');
    expect(gateway).toContain('ATTACHMENT_NOT_CLEAN_OR_NOT_READY');
    expect(scanner).toContain('security_status:"clean"');
    expect(scanner).toContain('from("chat-files").move(quarantinePath,finalPath)');
  });

  it('uses a durable retry queue for internal-to-external text and file delivery',()=>{
    const migration=read('supabase/migrations/20261011173500_messenger_unified_chat_bridge.sql');
    const scheduler=read('supabase/migrations/20261011174000_messenger_outbox_scheduler.sql');
    const mediaMigration=read('supabase/migrations/20261011175000_messenger_media_delivery.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(migration).toContain('messenger_delivery_outbox');
    expect(migration).toContain('for update skip locked');
    expect(scheduler).toContain('messenger-delivery-outbox-every-minute');
    expect(mediaMigration).toContain("('text','file','voice')");
    expect(gateway).toContain('messenger_claim_delivery_outbox');
    expect(gateway).toContain('ATTACHMENT_BLOCKED_BY_SECURITY_SCAN');
  });

});
