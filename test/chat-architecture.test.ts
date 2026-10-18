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
    expect(page).toContain("area.querySelectorAll<HTMLElement>('[data-chat-message=\\\"true\\\"]')");
    expect(page).toContain('rect.top<bounds.bottom&&rect.bottom>bounds.top');
    expect(page).toContain('readIndexRef.current=-1;setError(err(error))');
    expect(page).toContain("document.addEventListener('visibilitychange',onVisibilityChange)");
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

  it('includes finance and operational reminder metrics in daily reports',()=>{
    const migration=read('supabase/migrations/20261011172442_messenger_report_finance_reminder_metrics.sql');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(migration).toContain("'overdue_invoices', v_overdue_invoices");
    expect(migration).toContain("'payments_received_total_irr', v_received_total_irr");
    expect(migration).toContain("'payments_paid_total_irr', v_paid_total_irr");
    expect(migration).toContain("'overdue_reminders', v_overdue_reminders");
    expect(migration).toContain("'urgent_reminders', v_urgent_reminders");
    expect(gateway).toContain('number(snapshot.overdue_invoices)');
    expect(gateway).toContain('number(snapshot.payments_received_total_irr)');
    expect(gateway).toContain('number(snapshot.payments_paid_total_irr)');
    expect(gateway).toContain('number(snapshot.overdue_reminders)');
    expect(gateway).toContain('const statusFa=(value:unknown)=>');
    expect(gateway).toContain('item.current_status?"وضعیت: "+statusFa(item.current_status):""');
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

});
