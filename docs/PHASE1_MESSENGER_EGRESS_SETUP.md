# Phase 1 — Signed Cloudflare Messenger Egress Setup

This phase routes Telegram, Bale and Meta Graph/media requests made by the Supabase Edge Function through the existing first-party Cloudflare Worker. The Worker is an allowlisted streaming proxy, not an open proxy.

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

- Only HTTPS requests to `api.telegram.org`, `tapi.bale.ai`, `graph.facebook.com`, and subdomains of `fbsbx.com`, `fbcdn.net`, and `whatsapp.net` are accepted.
- Only GET and POST are accepted. GET media redirects are followed for at most three hops, with HTTPS and host allowlist validation on every hop; provider Authorization is stripped on unsafe cross-origin redirects.
- The shared secret is checked with a constant-time comparison and is never forwarded upstream.
- Request and response bodies are streamed; the Worker does not write message files to Assets, KV, D1, or R2.
- Responses are marked private/no-store and upstream cookies are removed.
- Supabase must have both `CLOUDFLARE_MESSENGER_PROXY_URL` and `CLOUDFLARE_MESSENGER_PROXY_SECRET` configured. The Edge Function intentionally fails closed if either is missing.

## Verification checklist

1. Worker unauthenticated request returns 401.
2. Authenticated request to a non-allowlisted host returns 403.
3. Telegram `getMe` and `getFile` work through the proxy.
4. Upload/download a non-sensitive test document and confirm `X-Customs-OS-Proxy: cloudflare-messenger-egress` is returned from the proxy response.
5. Confirm the download is streamed, bounded to the platform limit, and no new binary object appears in Supabase Storage, Worker Assets, KV, D1, or R2.
6. Verify webhook authentication, tenant scoping, chat membership, RLS, and the existing chat flow.
7. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; deploy only if all required checks pass.

## Status

Code and regression assertions are committed to the phase-1 branch. Production secret configuration, deployment, live Telegram tests, and the full local test suite are not claimed as complete by this document.
