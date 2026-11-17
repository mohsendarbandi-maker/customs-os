import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../supabase/functions/send-reminders/index.ts"),
  "utf8",
);
const digestStart = source.indexOf("async function digest()");
const mainStart = source.indexOf("async function main", digestStart);
const digestSource = source.slice(digestStart, mainStart);
const mainSource = source.slice(mainStart);

describe("daily Customs OS push digest", () => {
  it("combines reminder counts with the canonical pending customs task collector", () => {
    expect(source).toContain('buildCustomsWorkflowPendingTasks');
    expect(digestSource).toContain("collectCustomsPendingDigest(profile.organization_id)");
    expect(digestSource).toContain("customs.total");
    expect(digestSource).toContain("customs.urgent");
    expect(digestSource).toContain('url:"/customs-pending"');
  });

  it("uses the user's configured timezone and exact daily digest time", () => {
    expect(digestSource).toContain("p.timezone||TZ");
    expect(digestSource).toContain("g.hour!==hh||g.minute!==mm");
  });

  it("counts a push as sent only when the provider did not reject it", () => {
    const rejected = digestSource.indexOf("if(accepted===false)");
    const success = digestSource.indexOf("await notePushSuccess(s.id)");
    const increment = digestSource.indexOf("summary.sent++");
    expect(rejected).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(rejected);
    expect(increment).toBeGreaterThan(success);
    expect(digestSource).toContain("summary.failed++");
    expect(digestSource).toContain("await notePushFailure(s.id)");
  });

  it("removes expired push endpoints and records transient device failures", () => {
    expect(digestSource).toContain("err.statusCode===404||err.statusCode===410");
    expect(digestSource).toContain('admin.from("push_subscriptions").delete().eq("id",s.id)');
    expect(digestSource).toContain("await notePushFailure(s.id)");
  });

  it("returns delivery counts separately from a top-level digest processing error", () => {
    expect(mainSource).toContain("let digestSummary:DailyDigestSummary");
    expect(mainSource).toContain("digestSummary=await digest()");
    expect(mainSource).toContain("digest:digestSummary,digestError");
  });
});
