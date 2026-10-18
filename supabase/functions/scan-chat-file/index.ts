import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { scanChatFile } from "../_shared/chat-file-scanner.ts";

const SB = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLIC_BASE = (Deno.env.get("CUSTOMS_PUBLIC_BASE_URL") || "https://darbandicommercial.ir").replace(/\/+$/, "");
const admin = createClient(SB, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const MAX_SCAN_BYTES = 50 * 1024 * 1024;

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function expectedSecret() {
  const { data, error } = await admin.rpc("internal_get_reminder_secret", { p_name: "file_scan_cron_secret" });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

async function readBounded(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new Error("SOURCE_FILE_OVER_SCANNER_LIMIT");
      }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function markBlocked(scanId: string, attachment: any, provider: string, reasons: string[]) {
  const now = new Date().toISOString();
  await admin.from("chat_attachments").update({
    security_status: "blocked",
    security_checked_at: now,
    security_error: JSON.stringify(reasons).slice(0, 4000),
  }).eq("id", attachment.id).eq("organization_id", attachment.organization_id);
  await admin.from("file_scans").update({
    status: "blocked", provider, local_result: { clean: false, reasons },
    completed_at: now,
  }).eq("id", scanId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const expected = await expectedSecret();
    if (!expected || req.headers.get("x-file-scan-cron-secret") !== expected) {
      return json({ error: "unauthorized" }, 401);
    }

    const { data: scans, error: scansError } = await admin.from("file_scans")
      .select("id,attachment_id").eq("status", "scanning").order("created_at").limit(20);
    if (scansError) throw scansError;

    let processed = 0, blocked = 0, unavailable = 0;
    for (const scan of scans ?? []) {
      const { data: attachment, error: attachmentError } = await admin.from("chat_attachments")
        .select("id,organization_id,conversation_id,storage_path,file_asset_id,original_name,mime_type,size_bytes,security_status")
        .eq("id", scan.attachment_id).maybeSingle();
      if (attachmentError) {
        unavailable++;
        continue;
      }
      if (!attachment) {
        await admin.from("file_scans").update({
          status: "blocked", provider: "local_static",
          local_result: { clean: false, reasons: ["attachment_missing"] },
          completed_at: new Date().toISOString(),
        }).eq("id", scan.id);
        blocked++;
        continue;
      }
      if (attachment.security_status === "clean") {
        await admin.from("file_scans").update({
          status: "clean", provider: "local_static",
          local_result: { clean: true, reasons: ["already_scanned_at_ingress"] },
          completed_at: new Date().toISOString(),
        }).eq("id", scan.id);
        processed++;
        continue;
      }
      if (attachment.security_status === "blocked") {
        await admin.from("file_scans").update({
          status: "blocked", provider: "local_static",
          local_result: { clean: false, reasons: ["attachment_already_blocked"] },
          completed_at: new Date().toISOString(),
        }).eq("id", scan.id);
        blocked++;
        continue;
      }

      let bytes: Uint8Array;
      let isStoredQuarantine = false;
      const storagePath = String(attachment.storage_path || "");
      try {
        if (storagePath.startsWith("quarantine/")) {
          isStoredQuarantine = true;
          const { data: file, error: fileError } = await admin.storage.from("chat-files").download(storagePath);
          if (fileError || !file) throw new Error("QUARANTINE_FILE_UNAVAILABLE");
          if (file.size > MAX_SCAN_BYTES) throw new Error("SOURCE_FILE_OVER_SCANNER_LIMIT");
          bytes = new Uint8Array(await file.arrayBuffer());
          if (bytes.byteLength > MAX_SCAN_BYTES) throw new Error("SOURCE_FILE_OVER_SCANNER_LIMIT");
        } else if (attachment.file_asset_id && storagePath === "") {
          // Remote file payload is streamed through the first-party Cloudflare Worker.
          // The provider's media URL and token never reach the browser or database.
          const source = await fetch(PUBLIC_BASE + "/api/messenger/internal/scan-source/" + encodeURIComponent(String(attachment.file_asset_id)), {
            method: "GET",
            headers: { "x-file-scan-cron-secret": expected },
            redirect: "manual",
            cache: "no-store",
          });
          if (!source.ok || !source.body) {
            const code = source.status === 413 ? "SOURCE_FILE_OVER_SCANNER_LIMIT" :
              source.status === 404 ? "SOURCE_ATTACHMENT_UNAVAILABLE" :
              "REMOTE_SCAN_SOURCE_UNAVAILABLE";
            await markBlocked(scan.id, attachment, "local_static", [code]);
            blocked++;
            continue;
          }
          const length = Number(source.headers.get("content-length") || 0);
          if (length > MAX_SCAN_BYTES) {
            await source.body.cancel();
            await markBlocked(scan.id, attachment, "local_static", ["SOURCE_FILE_OVER_SCANNER_LIMIT"]);
            blocked++;
            continue;
          }
          bytes = await readBounded(source.body, MAX_SCAN_BYTES);
        } else {
          await markBlocked(scan.id, attachment, "local_static", ["invalid_attachment_source"]);
          blocked++;
          continue;
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "SOURCE_READ_FAILED";
        await markBlocked(scan.id, attachment, "local_static", [code]);
        blocked++;
        continue;
      }

      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
      const result = scanChatFile(bytes, String(attachment.original_name || "document.bin"), String(attachment.mime_type || "application/octet-stream"));
      const now = new Date().toISOString();

      if (result.clean && isStoredQuarantine) {
        const finalPath = storagePath.replace(/^quarantine\//, "");
        const moved = await admin.storage.from("chat-files").move(storagePath, finalPath);
        if (moved.error) {
          await markBlocked(scan.id, attachment, "local_static", ["quarantine_commit_failed"]);
          blocked++;
          continue;
        }
        const { error: updateError } = await admin.from("chat_attachments").update({
          storage_path: finalPath, security_status: "clean", security_checked_at: now, security_error: null,
        }).eq("id", attachment.id);
        if (updateError) {
          await admin.storage.from("chat-files").move(finalPath, storagePath);
          await markBlocked(scan.id, attachment, "local_static", ["attachment_security_state_update_failed"]);
          blocked++;
          continue;
        }
      } else if (result.clean) {
        const { error: updateError } = await admin.from("chat_attachments").update({
          security_status: "clean", security_checked_at: now, security_error: null,
        }).eq("id", attachment.id).eq("organization_id", attachment.organization_id);
        if (updateError) {
          await markBlocked(scan.id, attachment, "local_static", ["attachment_security_state_update_failed"]);
          blocked++;
          continue;
        }
        if (attachment.file_asset_id) {
          const { error: hashError } = await admin.from("file_assets")
            .update({ sha256, metadata: { securityScan: { provider: "local_static", clean: true, reasons: result.reasons, magic: result.magic } } })
            .eq("id", attachment.file_asset_id).eq("organization_id", attachment.organization_id);
          if (hashError) console.error("[scan-chat-file] metadata hash update failed", hashError.message);
        }
      } else {
        await markBlocked(scan.id, attachment, "local_static", result.reasons);
        blocked++;
        await admin.from("file_scans").update({ sha256, local_result: result }).eq("id", scan.id);
        processed++;
        continue;
      }

      const { error: scanUpdateError } = await admin.from("file_scans").update({
        status: "clean", sha256, provider: "local_static", local_result: result, completed_at: now,
      }).eq("id", scan.id);
      if (scanUpdateError) {
        // Fail closed: attachment must not remain available if the audit row did not commit.
        await admin.from("chat_attachments").update({
          security_status: "scanning", security_checked_at: null, security_error: "scan_audit_commit_failed",
        }).eq("id", attachment.id);
        unavailable++;
        continue;
      }
      processed++;
    }
    return json({ ok: true, processed, blocked, unavailable, mode: "remote-reference-and-legacy-storage" });
  } catch (error) {
    console.error("[scan-chat-file] failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "scan_failed" }, 500);
  }
});
