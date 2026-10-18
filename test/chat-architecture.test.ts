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
    expect(scanner).toContain('security_status: "clean"');
    expect(scanner).toContain('from("chat-files").move(storagePath, finalPath)');
    expect(scanner).toContain('scanChatFile(bytes,');
    expect(scanner).toContain('/api/messenger/internal/scan-source/');
  });

  it('keeps new chat attachment binaries outside Supabase Storage',()=>{
    const migration=read('supabase/migrations/20261019170000_messenger_remote_only_chat_attachments.sql');
    const api=read('src/features/chat/api.ts');
    const types=read('src/features/chat/types.ts');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const scanner=read('supabase/functions/scan-chat-file/index.ts');
    expect(migration).toContain('drop policy if exists chat_files_insert_quarantine on storage.objects');
    expect(migration).toContain('file_asset_id');
    expect(api).not.toContain(".storage.from('chat-files').upload");
    expect(api).toContain('/api/messenger/internal-chat-files/');
    expect(api).toContain('/api/messenger/chat-attachments/');
    expect(types).toContain('file_asset_id: string | null');
    const inbound=gateway.slice(gateway.indexOf('async function inbound('),gateway.indexOf('async function processMessengerOutbox'));
    expect(inbound).not.toContain('response.arrayBuffer()');
    expect(inbound).not.toContain('.storage.from("chat-files").upload');
    expect(inbound).toContain('storage_path:null,file_asset_id:fileAssetId');
    expect(gateway).toContain('function internalScanSource');
    expect(gateway).toContain('function downloadChatAttachment');
    expect(gateway).toContain('a.file_asset_id');
    expect(scanner).toContain('scanChatFile');
    expect(scanner).toContain('remote-reference-and-legacy-storage');
  });

  it('scans uploaded files before sending them to the messenger archive',()=>{
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const scanner=read('supabase/functions/_shared/chat-file-scanner.ts');
    const api=read('src/features/chat/api.ts');
    expect(gateway).toContain('scanChatFile(bytes,name,mime)');
    expect(gateway).toContain('FILE_ARCHIVE_NOT_CONFIGURED');
    expect(gateway).toContain('TG_DOWNLOAD_LIMIT');
    expect(scanner).toContain('pdf_active:');
    expect(scanner).toContain('path_traversal');
    expect(api).toContain('FILE_ARCHIVE_NOT_CONFIGURED');
    expect(api).toContain('downloadExternalAttachment');
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

  it('streams external file downloads with platform size ceilings and no full-response buffering',()=>{
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    const start=gateway.indexOf('async function download(req:Request');
    const end=gateway.indexOf('async function transfer(',start);
    const download=gateway.slice(start,end);
    expect(download).toContain('const max=x.connection.platform==="whatsapp"?WA_DOCUMENT_LIMIT:TG_DOWNLOAD_LIMIT;');
    expect(download).toContain('new Response(bounded(f.response.body,max)');
    expect(download).toContain('SOURCE_FILE_OVER_DOWNLOAD_LIMIT');
    expect(download).not.toContain('arrayBuffer()');
    expect(download).not.toContain('readBinary(');
  });

  it('routes messenger provider egress through a signed Cloudflare allowlist proxy',()=>{
    const worker=read('worker/index.ts');
    const gateway=read('supabase/functions/messenger-gateway/index.ts');
    expect(worker).toContain("url.pathname === '/_internal/messenger-egress'");
    expect(worker).toContain('x-customs-messenger-proxy-key');
    expect(worker).toContain("host === 'api.telegram.org'");
    expect(worker).toContain("host === 'tapi.bale.ai'");
    expect(worker).toContain("host === 'graph.facebook.com'");
    expect(worker).toContain("target.protocol !== 'https:'");
    expect(worker).toContain('new Response(upstream.body');
    expect(gateway).toContain('CLOUDFLARE_MESSENGER_PROXY_URL');
    expect(gateway).toContain('CLOUDFLARE_MESSENGER_PROXY_SECRET');
    expect(gateway).toContain('async function providerFetch(');
    expect(gateway).toContain('providerFetch(graphBase(c)');
    expect(gateway).not.toContain('fetch(botBase(c,await accessToken(c))+endpoint');
  });

});
