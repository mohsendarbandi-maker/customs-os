import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const pushClient = read('src/features/reminders/push.ts');
const sender = read('supabase/functions/send-reminders/index.ts');
const remindersPage = read('src/features/reminders/RemindersPage.tsx');

describe('reminder push delivery reliability', () => {
  it('enables server-side push delivery only after explicit device subscription succeeds', () => {
    const subscription = pushClient.indexOf("supabase.rpc('upsert_push_subscription'");
    const optIn = pushClient.indexOf('setNotificationPreferences({push_enabled:true})');
    expect(subscription).toBeGreaterThan(-1);
    expect(optIn).toBeGreaterThan(subscription);
    expect(pushClient).toContain("setNotificationPreferences({push_enabled:false})");
  });

  it('lets previously granted browsers re-enable server delivery when the preference is off', () => {
    expect(remindersPage).toContain("select('push_enabled,hide_content,quiet_start,quiet_end')");
    expect(remindersPage).toContain('const pushActive=pushEnabled&&permission===\'granted\'');
    expect(remindersPage).toContain(">{pushActive?'غیرفعال‌سازی':'فعال‌سازی'}");
    expect(remindersPage).toContain('disabled={busy||!pushActive} onClick={()=>void test()}');
  });

  it('records successful device delivery and resets its failure counter', () => {
    expect(sender).toContain('async function notePushSuccess');
    expect(sender).toContain('last_success_at:new Date().toISOString()');
    expect(sender).toContain('failure_count:0,is_active:true');
    expect(sender).toContain('async function notePushFailure');
  });

  it('does not report a test notification as successful when every device send fails', () => {
    expect(sender).toContain('if(sent===0)return json({error:"ارسال اعلان آزمایشی به هیچ دستگاهی تأیید نشد",details:lastFailure},502)');
  });

  it('finalizes one delivery only after checking all devices, preventing mixed-result retries', () => {
    const loop = sender.indexOf('for(const s of devices)', sender.indexOf('async function deliver'));
    const finishSent = sender.indexOf('if(delivered)await finish', loop);
    expect(loop).toBeGreaterThan(-1);
    expect(finishSent).toBeGreaterThan(loop);
    expect(sender).toContain('else if(transientFailure){');
    expect(sender).toContain('else await finish(d.reminder_id,d.user_id,d.fire_at,"skipped",lastFailure??"no_active_device",null)');
  });

  it('removes expired device subscriptions and does not leave them pending forever', () => {
    expect(sender).toContain('err.statusCode===404||err.statusCode===410');
    expect(sender).toContain('else await finish(d.reminder_id,d.user_id,d.fire_at,"skipped",lastFailure??"no_active_device",null)');
  });
});
