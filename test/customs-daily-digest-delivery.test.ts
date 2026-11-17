import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../supabase/functions/send-reminders/index.ts"), "utf8");
const digestStart = source.indexOf("async function digest():Promise<DailyDigestSummary>");
const mainStart = source.indexOf("async function main(req:Request)", digestStart);
const digest = source.slice(digestStart, mainStart);
const collectorStart = source.indexOf("async function collectCustomsPendingDigest");
const collectorEnd = source.indexOf("type DailyDigestSummary", collectorStart);
const collector = source.slice(collectorStart, collectorEnd);

describe("daily Customs OS digest", () => {
  it("claims once per user and local date even when cron runs every minute", () => {
    expect(digest).toContain("claim_customs_daily_digest");
    expect(digest).toContain("finish_customs_daily_digest");
    expect(digest).toContain("p_local_date:localDate");
    expect(digest).toContain('tag:"customs-daily-"+localDate');
  });

  it("catches up after the configured time without exact-minute duplicates", () => {
    expect(digest).toContain("currentMinute<targetMinute");
    expect(digest).not.toContain("g.hour!==hh||g.minute!==mm");
  });

  it("includes operation, checklist, permits and canonical pending finance costs", () => {
    expect(collector).toContain('from("customs_declaration_workflow")');
    expect(collector).toContain('from("declaration_checklist_items")');
    expect(collector).toContain('from("permits")');
    expect(collector).toContain('from("finance_cost_items")');
    expect(collector).toContain("هزینه در انتظار تأیید مالی");
  });

  it("respects timezone, content privacy and active staff status", () => {
    expect(digest).toContain('select("user_id,morning_digest_time,timezone,hide_content")');
    expect(digest).toContain('select("organization_id,role,is_active")');
    expect(digest).toContain('profile.role==="client"');
    expect(digest).toContain("p.hide_content");
  });

  it("records accepted and failed device outcomes independently", () => {
    expect(digest).toContain("let sentDevices=0,failedDevices=0");
    expect(digest).toContain("p_sent_devices:sentDevices");
    expect(digest).toContain("p_failed_devices:failedDevices");
  });
});
