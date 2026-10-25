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

  it('marks visible messages read within the active conversation and exposes receipt failures',()=>{
    const page=read('src/features/chat/ChatPage.tsx');
    expect(page).toContain(`area.querySelectorAll<HTMLElement>('[data-chat-message="true"]')`);
    expect(page).toContain('rect.top<bounds.bottom&&rect.bottom>bounds.top');
    expect(page).toContain('readIndexRef.current=-1;setError(err(error))');
    expect(page).toContain("document.addEventListener('visibilitychange',onVisibilityChange)");
  });

  it("excludes a user's own messages from the unread counter",()=>{
    const migration=read('supabase/migrations/20261018201149_fix_chat_unread_count_own_messages.sql');
    expect(migration).toContain('and (m.sender_id is null or m.sender_id <> auth.uid())');
    expect(migration).toContain('public.chat_user_is_member(p_conversation_id)');
    expect(migration).toContain('SET search_path TO');
  });

  it('keeps reminder creation simple and collapses optional shipment linking',()=>{
    const page=read('src/features/reminders/RemindersPage.tsx');
    expect(page).toContain('<details className="mt-2 rounded-xl border app-border bg-[var(--surface-2)] p-2.5">');
    expect(page).toContain("{quickShipment?quickShipment.label:'اختیاری'}");
    expect(page).toContain('<details className="rounded-2xl border app-border p-3"><summary');
  });

  it('uses the Jalali picker for the active kotaj registration screen',()=>{
    const page=read('src/pages/DeclarationRegistrationPage.tsx');
    expect(page).toContain('JalaliDateTimePicker');
    expect(page).toContain('تاریخ کوتاژ / اظهار');
    expect(page).not.toContain('type="datetime-local"');
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
    const migration=read('supabase/migrations/20261011164146_messenger_unified_chat_bridge.sql');
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

  it('requires routed messenger destinations to link to a canonical conversation',()=>{
    const migration=read('supabase/migrations/20261018203000_messenger_routed_destination_requires_conversation.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const integration=read('src/pages/MessengerIntegrationsPage.tsx');
    expect(migration).toContain("purpose not in ('inbox','shipment_notifications','shipment')");
    expect(migration).toContain('conversation_id is not null');
    expect(gateway).toContain('["inbox","shipment_notifications","shipment"].includes(purpose)');
    expect(integration).toContain('required={['+'"inbox","shipment_notifications","shipment"'+'].includes(purpose)}');
    expect(integration).toContain('(["inbox","shipment_notifications","shipment"].includes(purpose)&&!conversationId)');
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
    const migration=read('supabase/migrations/20261011164146_messenger_unified_chat_bridge.sql');
    const scheduler=read('supabase/migrations/20261011164554_messenger_outbox_scheduler.sql');
    const mediaMigration=read('supabase/migrations/20261011165430_messenger_media_delivery.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(migration).toContain('messenger_delivery_outbox');
    expect(migration).toContain('for update skip locked');
    expect(scheduler).toContain('messenger-delivery-outbox-every-minute');
    expect(mediaMigration).toContain("('text','file','voice')");
    expect(gateway).toContain('messenger_claim_delivery_outbox');
    expect(gateway).toContain('ATTACHMENT_BLOCKED_BY_SECURITY_SCAN');
  });

  it('sends one real daily report per Tehran-local date and skips duplicates',()=>{
    const migration=read('supabase/migrations/20261011170619_messenger_daily_reports_and_dual_role.sql');
    const retryMigration=read('supabase/migrations/20261011171230_messenger_daily_report_retry_cap.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(migration).toContain('messenger_report_snapshot');
    expect(migration).toContain('unique (messenger_chat_id, report_date)');
    expect(migration).toContain("p_timezone text default 'Asia/Tehran'");
    expect(migration).toContain('messenger-daily-report-retry-every-15-minutes');
    expect(retryMigration).toContain('attempt_count < 8');
    expect(gateway).toContain('path==="/api/messenger/reports/daily"');
    expect(gateway).toContain('messenger_claim_daily_report');
    expect(gateway).toContain('payload_summary:{source:"daily_report"');
    expect(gateway).toContain('function formatDailyReport');
  });

  it('keeps existing daily-report destinations eligible for two-way linked chat delivery',()=>{
    const migration=read('supabase/migrations/20261011170619_messenger_daily_reports_and_dual_role.sql');
    expect(migration).toContain("mc.purpose in ('inbox','daily_report','shipment_notifications','shipment')");
    expect(migration).toMatch(/and\s+mc\.conversation_id\s*=\s*new\.conversation_id/i);
  });

  it('separates the daily report time from retry-only processing',()=>{
    const schedule=read('supabase/migrations/20261011171840_messenger_daily_report_schedule.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(schedule).toContain("'0 15 * * *'");
    expect(schedule).toContain('"mode":"scheduled"');
    expect(schedule).toContain('"mode":"retry"');
    expect(schedule).toContain('messenger-daily-report-every-day-1830-tehran');
    expect(gateway).toContain('requestBody.mode==="retry"?"retry":"scheduled"');
    expect(gateway).toContain('previousStatus!=="failed"&&!staleSending');
  });

  it('refreshes the canonical open chat when attachment security status changes',()=>{
    const migration=read('supabase/migrations/20261011172209_chat_attachment_realtime_refresh.sql');
    const page=read('src/features/chat/ChatPage.tsx');
    expect(migration).toContain('trg_chat_attachment_realtime_update');
    expect(migration).toContain("'attachment:update'");
    expect(migration).toContain("security_status, security_checked_at, security_error");
    expect(page).toContain("event:'attachment:update'");
    expect(page).toContain('void loadConversation(selectedId,false)');
  });

  it('focuses daily reports on shipment status, completed work, pending tasks and recorded changes',()=>{
    const snapshotMigration=read('supabase/migrations/20261024221001_improve_messenger_daily_report_content.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(snapshotMigration).toContain("'shipment_statuses', v_shipment_statuses");
    expect(snapshotMigration).toContain("'completed_work', v_completed_work");
    expect(snapshotMigration).toContain("'pending_work', v_pending_work");
    expect(snapshotMigration).toContain("'pending_ship_passes', v_pending_ship_passes");
    expect(snapshotMigration).toContain("'recent_changes', v_recent_changes");
    expect(gateway).toContain('Array.isArray(snapshot.shipment_statuses)');
    expect(gateway).toContain('Array.isArray(snapshot.completed_work)');
    expect(gateway).toContain('Array.isArray(snapshot.pending_work)');
    expect(gateway).toContain('Array.isArray(snapshot.recent_changes)');
    expect(gateway).toContain('کارهای انجام‌شده');
    expect(gateway).toContain('کارهای باقیمانده و نیازمند پیگیری');
    expect(gateway).toContain('تغییرات ثبت‌شده');
    expect(gateway).toContain('const statusFa=(value:unknown)=>');
    expect(gateway).not.toContain('number(snapshot.overdue_invoices)');
    expect(gateway).not.toContain('number(snapshot.payments_received_total_irr)');
    expect(gateway).not.toContain('number(snapshot.payments_paid_total_irr)');
  });

  it('does not retry terminally ineligible messenger deliveries',()=>{
    const migration=read('supabase/migrations/20261014153000_messenger_outbox_terminal_skip.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(migration).toContain("'skipped'::text");
    expect(migration).toContain("'MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY'");
    expect(migration).toContain("'DESTINATION_NO_LONGER_LINKED'");
    expect(gateway).toContain('const terminal=code==="MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY"||code==="DESTINATION_NO_LONGER_LINKED";');
    expect(gateway).toContain('status:terminal?"skipped":"failed"');
    expect(gateway).toContain('claimed:rows.length,sent,failed,skipped');
  });

  it('discovers Bale private chat IDs and explains that phone numbers are not chat IDs',()=>{
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const page=read('src/pages/MessengerIntegrationsPage.tsx');
    expect(gateway).toContain('BALE_CHAT_DISCOVERY_SAVE_FAILED');
    expect(gateway).toContain('شناسهٔ گفت‌وگوی بله (Chat ID) شما:');
    expect(gateway).toContain('BALE_CHAT_ID_NOT_FOUND');
    expect(page).toContain('شناسهٔ گفت‌وگو (Chat ID)');
    expect(page).toContain('شمارهٔ موبایل را وارد نکنید');
  });

});