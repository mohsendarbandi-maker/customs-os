# Customs OS — Release Readiness

Status: NOT READY FOR RELEASE APPROVAL

## Verified
- GitHub main CI run 44102021708 succeeded for unit tests, typecheck, lint and Vite production build.
- PostgreSQL fixture/migration and concurrency contract tests are reported successful in PR 292.
- Supabase project is active and live schema includes the two customs workflow/daily digest migrations.
- Main Worker deployment step succeeded in run 44108881420, but the live build-signature smoke test failed. A second automated Worker deploy occurred in run 44109859363 and its smoke step was cancelled. Worker metadata last modified at 2026-11-17 15:05:27 UTC.

## Not yet verified
- Full authenticated UI acceptance across owner/admin/broker/warehouse roles.
- Tenant isolation across all operational, financial and file resources.
- Function-by-function review of SECURITY DEFINER functions.
- End-to-end daily digest push invocation and retry behavior.
- Authenticated UI acceptance for independent activity lifecycle; SQL/TypeScript/Build CI passed on PR 294 but manual UI review remains untested.
- Activity-scoped rollback action (not implemented yet).
- PDF page classification, splitting, parent/child lineage and archive recovery.
- Registration-order capacity reconciliation with representative staging data.
- Mobile smoke test in PR 294 latest verification (skipped).
- Root-cause confirmation and clean live build-signature smoke test after automatic Worker deployments.

## Explicitly prohibited without new approval
- Production migrations or data backfills.
- Merge to main.
- Cloudflare Worker deployment or website release.


## Stage 2 status (PR 294)

- Independent activity schema, RLS, trigger history, dependency graph, reminder/cost/file references and RTL workspace are implemented on a feature branch.
- Initial test run failed during fixture setup only (duplicate cluster-wide role); corrected fixture has been pushed.
- Latest CI at the time of this entry was still running. This PR is not yet release-ready or accepted.
- No production migration, merge or deployment was performed.


## Deployment incident status

- Main ref restored to `968c58f2624c04f53cc98f094be888cd7e74dc72`.
- Two automated Cloudflare Worker deployment steps were observed in runs 44108881420 and 44109859363; live runtime verification did not pass cleanly.
- PR 295 is Draft and separates validation from explicit manual deployment. It is not merged, so the old main workflow remains active until approval/merge.
- No Production database migration, backfill or data mutation was performed.


## 2026-11-17 — Stage 3 release readiness update

### Verified in Production
- PR295 merged. Routine validation no longer deploys. Production deploy requires manual dispatch from main and exact phrase `DEPLOY CUSTOMS OS`. No Worker/site deployment was triggered in this stage.
- PR292 digest runtime is live: `send-reminders` version 73; live Cron invocation HTTP 200; 2026-11-17 ledger: `sent`, 18 successful, 0 failed.
- No new Production database migration or backfill was applied.

### Candidate work, not released
- PR294 independent customs activities: Draft/open, CI green; `public.customs_activities` absent from Production; authenticated UI acceptance pending.
- PR296 PDF Studio lineage/autoarchive: Draft/open; unit tests passed in run `44122485767`; full CI was still running at update time; no merge, migration or deployment. Authenticated real-shipment archive/retry test remains pending.

### Remaining release blockers
- Authenticated role-based UI acceptance across owner/admin/broker/warehouse/client.
- Full PDF Studio → Telegram archive → File Manager parent/child and retry/reload test on a dedicated non-sensitive shipment.
- PR294 activity migration review and authenticated acceptance.
- Function-by-function review of SECURITY DEFINER/RLS findings.
- Verify GitHub production Environment reviewer approvals.
- Clean browser/live build-marker smoke after explicit release authorization.


## 2026-11-17 — latest CI and security review

- PR296 latest head `092fed4dd611033e7b668515a41c4b941f169daf` passed CI run `44123150742`; the mobile chat/keyboard viewport smoke step was skipped. PR296 remains Draft pending authenticated real-shipment Telegram archive/retry acceptance.
- Eight sensitive SECURITY DEFINER functions were sampled in live PostgreSQL. Authentication, tenant scope, relevant role/ownership checks, fixed search_path and no anon execution were present in those samples. The full 92-function advisor backlog is not resolved.


## 2026-11-17 — Stage 4 security release gate

- PR297: Draft; CI `44144410862` and `44144410705` succeeded. Only isolated PostgreSQL tests, no Production migration. Direct chat helper and trigger ACL hardening candidate.
- PR298: Draft; service-role-only case-alert sync ACL. CI runs `44145432402` and `44145432384` queued at last update. No Production migration.
- The case-alert function is still directly executable by authenticated in current Production until an approved migration is applied; do not claim it is fixed live.
- Remaining 92-function review and AI Operator command-ledger audit remain open.


## 2026-11-17 — Stage 5 release checklist

- PR297, PR298 and PR299 have green automated CI and remain Draft. Their ACL migrations were applied only to separate ephemeral PostgreSQL databases.
- Live Production grants remain unchanged until authorized migration approval:
  - `orgs_are_connected`, `chat_connection_allowed_for_conversation`, trigger helper execute grants (PR297).
  - `sync_case_alert_reminders(uuid)` authenticated grant (PR298).
  - two legacy positional `create_operational_reminder` authenticated grants (PR299).
- Current JSONB reminder creation remains the app path and is not revoked.
- AI Operator transition ledger proof design remains open. Do not claim immutable audit integrity until a server-authenticated transition proof is implemented and tested.
- No Worker/site deploy, main merge or Production DB migration performed in Stage 5.


## 2026-11-17 — Stage 6 security evidence

- 152 public SECURITY DEFINER functions inventoried; 0 anon access; 92 authenticated grants; every function has an explicit search_path.
- 15 RLS-enabled tables without policies deny all direct authenticated table operations via table grants; service_role remains the server actor.
- PR297, PR298 and PR299 green CI, Draft only; their Production grants remain unchanged pending approved migration.
- AI Operator command result/status can be falsified by a user for their own record through a direct authenticated transition RPC. Business writes remain Edge Function-gated, but the owner-visible audit log can be misleading. Requires server-authenticated transition proof before calling audit history trustworthy.
- pg_net-in-public and leaked-password-protection warnings remain open. No Production changes from this audit.


## 2026-11-17 — Stage 7 AI Operator audit integrity

- Draft PR300 moves AI Operator ledger writes behind server-only RPCs and revokes authenticated direct table writes / legacy transition calls. It retains user-scoped history reads and keeps business operations on the caller JWT.
- Isolated PostgreSQL ACL, audit-actor and immutable-terminal-state test suite is added to CI; main verification run 44151721561 and Shipment Cost run 44151721617 are pending at this ledger revision.
- Production remains unchanged. Do not treat the audit weakness as resolved in Production until PR300 is reviewed, CI green, runtime configuration checked, and its migration applied under an explicit release approval.
- Auth leaked-password protection and the pg_net-in-public advisor warning remain open. Authenticated browser acceptance for PR294 and PR296 remains outstanding.


## 2026-11-17 — Stage 7 verification result

- PR300 latest head `3b1b69c5f58083bc62f862c6e89b0199ed25d168`; both main verify CI `44154127820` and Shipment Cost CI `44154127402` succeeded.
- PostgreSQL AI Operator server-owned ledger ACL/audit tests, all workflow/digest contracts, Vitest, TypeScript, ESLint, build, Deno checks and Worker dry-run passed. Mobile viewport smoke was skipped.
- Do not mark Production fixed: migration and Edge Function remain Draft/unreleased. Confirm runtime secret availability and complete authenticated plan/confirmation/execution/history acceptance before a release. Production migration, Edge deploy, site/Worker deployment and PR merge require explicit approval.
- Open configuration warnings: Auth leaked-password protection disabled and pg_net installed in public schema. Authenticated acceptance for PR294 independent activities and PR296 PDF Studio lineage remains outstanding.



## 2026-11-18 — Stage 8 signed proof and Stage 9 reconciliation candidates

### Candidate verification
- PR301 signed AI Operator command-state proof: full CI, dedicated PostgreSQL contract and Shipment Cost CI passed (44240033780, 44240033778, 44240033773). Draft only.
- PR302 legacy registration-order candidate contract passed in isolated PostgreSQL (44243008963). UI integration is committed in the PR branch; broad TypeScript/lint/build pipelines were still running at head `aae971fa03af13ddd58468d5c53d40fd2969236a` in runs 44243373100 and 44243373151.
- Main branch remains at the previously reported Production SHA unless separately rechecked; no merge occurred in these stages.

### Release blockers
- PR301: provision matching Edge HMAC secret and Vault secret; complete authenticated end-to-end acceptance before migration/function release.
- PR302: finish all CI; review candidate list against a controlled real shipment set; decide and implement an explicit authorized attach workflow only where supported by business evidence.
- Complete authenticated real-shipment PDF Studio → archive → File Manager parent/child/retry/reload acceptance for PR296.
- Complete authenticated independent activity workflow acceptance for PR294.
- Security PR297–299 and AI Operator PR301 are candidate migrations/functions, not Production fixes.
- No Production migration/backfill, PR merge, Edge Function deploy, Worker/site deploy or real business-data edit was performed.
