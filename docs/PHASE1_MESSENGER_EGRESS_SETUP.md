# Phase 1 — Signed Cloudflare Messenger Egress Setup

This phase routes Telegram, Bale, Rubika and Meta Graph/WhatsApp requests made by the Supabase Edge Function through the existing first-party Cloudflare Worker. The Worker is an allowlisted streaming proxy, not an open proxy. New Customs OS chat files are kept as remote messenger references plus metadata; legacy stored files are not deleted. Integration send/upload/transfer/file-download APIs require owner/admin. Normal chat attachment downloads require active conversation membership and a clean scan state.

## Required secrets

Generate one strong random value in a trusted terminal, for example with `openssl rand -base64 32`. Do not commit it or paste it into chat.

1. Set the Worker secret:
   ```sh
   npx wrangler secret put MESSENGER_EGRESS_SECRET
   ```
   Paste the generated value only into the Wrangler prompt.

2. Set the Supabase Edge Function secrets using the same value:
   ```sh
   supabase secrets set CLOUDFLARE_MESSENGER_PROXY_URL=https://darbandicommercial.ir/_internal/messenger-egress CLOUDFLARE_MESSENGER_PROXY_SECRET='<same-generated-value>'
   ```
   Run this against the already-linked production project only after reviewing the target project ID. Do not include the value in shell history where avoidable; use the dashboard secret editor if preferred.

3. Deploy the Worker and the `messenger-gateway` Edge Function from the reviewed phase-1 branch through the project's established release workflow. Do not deploy the branch to production before the checks pass.

## Proxy security contract

- The built-in HTTPS host allowlist includes `api.telegram.org`, `tapi.bale.ai`, `botapi.rubika.ir`, `graph.facebook.com`, and subdomains of `fbsbx.com`, `fbcdn.net`, and `whatsapp.net`.
- Rubika's official [`requestSendFile`](https://rubika.ir/botapi/methods) and [`getFile`](https://rubika.ir/botapi/methods) return `upload_url` and `download_url`; the official docs do not promise these URLs use `botapi.rubika.ir`. Do **not** assume that hostname. The documented upload body is `multipart/form-data` with a `file` part. After secrets/token are configured, use the connection's **آزمایش** action to reveal the upload hostname only (not the full URL). A real file download may reveal a separate hostname in the error code. If a returned host is not already allowed, add that exact hostname—no scheme, path, token, wildcard, IP address, or port—to both Worker variable `MESSENGER_EGRESS_EXTRA_HOSTS` and Supabase Edge variable `CLOUDFLARE_MESSENGER_PROXY_EXTRA_HOSTS`, comma-separated if more than one. The two lists must match. Only public DNS hostnames are accepted; localhost/local/internal/test/invalid names and IPv4 literals are rejected. The gateway and Worker validate HTTPS and exact hostnames, including every redirect hop; arbitrary URLs and wildcard host entries are rejected. Rubika's documented `File`/`Video` maximum is 50 MB; `Voice` is MP3-only ([official enum](https://rubika.ir/botapi/models)).
- Only GET and POST are accepted. GET media redirects are followed for at most three hops, with HTTPS and host allowlist validation on every hop; provider Authorization is stripped on unsafe cross-origin redirects.
- The shared secret is checked with a constant-time comparison and is never forwarded upstream.
- Request and response bodies are streamed; the Worker does not write message files to Assets, KV, D1, or R2.
- Responses are marked private/no-store and upstream cookies are removed.
- Supabase must have `CLOUDFLARE_MESSENGER_PROXY_URL` and `CLOUDFLARE_MESSENGER_PROXY_SECRET` configured. The optional exact-host variable `CLOUDFLARE_MESSENGER_PROXY_EXTRA_HOSTS` must match Worker `MESSENGER_EGRESS_EXTRA_HOSTS`. The Edge Function intentionally fails closed if either required proxy setting is missing or a destination host is not allowlisted.

## Production observations (checked 2026-10-19)

Read-only checks against the connected Supabase production project found:

- One enabled messenger connection, Telegram.
- One enabled `daily_report` destination linked to the canonical Customs OS conversation.
- Eight daily-report runs marked sent, with the latest recorded on 2026-10-18.
- Four outbox deliveries marked sent and one marked skipped.
- Recent Telegram webhook history contains one processed update.
- The production `messenger-gateway` is active at version 59. Its deployed source hash differs from the phase-1 branch source, so the branch code is not live.
- The production schema already contains `file_assets`, `file_locations`, `messenger_connections`, `messenger_report_runs`, and `chat_attachments`. Do not blindly recreate these objects.

These observations confirm that the existing Telegram daily-report path has recorded successful sends. They do **not** prove current end-to-end delivery, the new remote-only attachment path, or the new Cloudflare egress route.

## Verification checklist

1. Worker unauthenticated request returns 401.
2. Authenticated request to a non-allowlisted host returns 403.
3. Telegram `getMe` and `getFile` work through the proxy.
4. Upload/download a non-sensitive test document and confirm `X-Customs-OS-Proxy: cloudflare-messenger-egress` is returned from the proxy response.
5. Confirm the download is streamed, bounded to the platform limit, and no new binary object appears in Supabase Storage, Worker Assets, KV, D1, or R2.
6. Verify webhook authentication, tenant scoping, chat membership, RLS, and the existing chat flow.
7. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; deploy only if all required checks pass.

## Phase status

### Code and CI verified

- The phase-1 branch includes the signed Cloudflare egress endpoint, bounded remote downloads, remote-only attachment metadata, regression assertions, and this setup guide.
- The current PR includes regression checks for remote-only attachments, Rubika multipart upload/webhooks, exact media-host allowlists, streaming ceilings, and manager-only integration administration.
- Before merge, confirm that both required GitHub Actions workflows are green on the exact current PR head; older green results do not validate later commits.

### Not yet complete — production blockers

- The PR is still open and its changes have not been deployed.
- Production secret configuration for the Worker and Edge Function has not been verified or performed through the available tools.
- No live test has verified the new egress endpoint or remote-only attachment flow.
- The gateway now uses Rubika's official `https://botapi.rubika.ir/v3/{token}/{method}` API for text, inbound `ReceiveUpdate`/`ReceiveInlineMessage` webhooks, and bounded remote-reference file transfers. Inline-keypad callbacks are recorded as webhook interactions rather than being misrepresented as a new chat message. The “آزمایش” action reveals the upload hostname and whether the exact host is allowlisted, without exposing the full provider URL. Add a returned media hostname to both exact-host variables before live file transfers. Live token, webhook, media-host, and file round-trip tests remain required before calling Rubika production-ready.
- Bale and WhatsApp have code paths, but no enabled production connections were found during the read-only check; live provider tests remain pending.

Do not merge, apply the phase-1 migration, or deploy the Edge Function before the shared egress secret is set and a coordinated release is ready. The new function intentionally fails closed when proxy configuration is absent, and deploying it prematurely can interrupt current provider operations.

## Required release order

1. Configure the same high-entropy secret in Cloudflare Worker and Supabase Edge Function secrets without sharing it in chat or committing it.
2. Deploy the Worker code with the signed egress route and verify unauthenticated denial plus non-allowlisted-host denial.
3. Deploy the reviewed gateway and migration only after matching egress secrets are configured; verify the existing Telegram text/webhook flow remains healthy.
4. Configure/validate a Rubika bot. On the connection card, use **آزمایش** to discover the upload host; add the exact host to both allowlist variables if needed, redeploy/update the Worker setting, then re-run the test.
5. Run non-sensitive Telegram/Rubika text, inbound webhook, and file upload/download tests; confirm no new binary object is stored by Customs OS.
6. Confirm daily reports and outbox delivery still work.
7. Complete Bale and WhatsApp live checks when valid credentials are configured. Do not label any new provider path production-ready until live round-trips pass.
