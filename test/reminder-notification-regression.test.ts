import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/send-reminders/index.ts'), 'utf8');
const digestStart = source.search(/async function digest\(\)/);
const digest = source.slice(digestStart, source.indexOf('async function main(req:Request){', digestStart));
const delivery = source.slice(source.indexOf('async function deliver(){'), source.indexOf('async function digest(){'));

describe('reminder push delivery safety', () => {
  it('keeps explicit user opt-in as a hard delivery gate', () => {
    expect(delivery).toContain('if(!d.push_enabled)');
    expect(delivery).toContain('"skipped","push_disabled"');
    expect(delivery).toContain('select("quiet_start,quiet_end,hide_content,timezone,push_enabled")');
    expect(delivery).toContain("if(!pref?.push_enabled)");
    expect(delivery).toContain('"preference_lookup_failed"');
  });

  it('does not advance a recurring reminder before its due occurrence', () => {
    expect(delivery).toContain("const advanced=new Set<string>()");
    expect(delivery).toContain("advanced.has(d.reminder_id)");
    expect(delivery).toContain("await advanceFinalOccurrence(d)");
    expect(delivery).not.toContain('if(new Date(d.fire_at)<=new Date(d.due_at))await advance(d.reminder_id)');
    expect(delivery).toContain('mark("deferred",why)');
  });

  it('retries transient VAPID setup failures instead of abandoning claimed deliveries', () => {
    expect(delivery).toContain('let vapid:Awaited<ReturnType<typeof ensureVapid>>|null=null');
    expect(delivery).toContain('"pending","vapid_configuration_failed",retryAt');
    expect(delivery).toContain('"failed","vapid_configuration_failed",null');
  });

  it('records delivery outcomes and reason counters for scheduler diagnostics', () => {
    expect(delivery).toContain('claimed:rows.length,sent:0,skipped:0,failed:0,deferred:0');
    expect(delivery).toContain('summary.reasons[why]=(summary.reasons[why]??0)+1');
    expect(source).toContain('delivery,digest:digestSummary,digestError');
    expect(digest).toContain('const summary:DailyDigestSummary={eligible:0,sent:0,failed:0,skipped:0}');
    expect(digest).toContain('if(accepted===false)');
    expect(digest).toContain('await notePushSuccess(device.id)');
    expect(digest).toContain('await notePushFailure(device.id)');
    expect(source).not.toContain('await digest().catch(()=>0)');
  });

  it('claims a single daily digest per user and local calendar date before sending', () => {
    expect(digest).toContain('claim_customs_daily_digest');
    expect(digest).toContain('finish_customs_daily_digest');
    expect(digest).toContain('p_local_date:localDate');
    expect(digest).toContain('currentMinute<targetMinute');
    expect(digest).toContain('tag:"customs-daily-"+localDate');
    expect(source).not.toContain('if(g.hour!==hh||g.minute!==mm)continue');
  });

  it('reads pending finance from the canonical finance_cost_items source', () => {
    expect(source).toContain('from("finance_cost_items")');
    expect(source).toContain('هزینه در انتظار تأیید مالی');
  });

  it('scopes morning digest counts to active, non-client users and reminders they can see', () => {
    expect(digest).toContain('select("organization_id,role,is_active")');
    expect(digest).toContain('profile.role==="client"');
    expect(digest).toContain('.eq("organization_id",profile.organization_id)');
    expect(digest).toContain('.is("deleted_at",null)');
    expect(digest).toContain('assignee_id.eq."+p.user_id+",created_by.eq."+p.user_id+",visibility.eq.team');
    expect(digest).toContain('.not("due_at","is",null)');
  });
});
