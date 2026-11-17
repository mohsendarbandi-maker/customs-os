# Customs OS — Implementation Log

## 2026-11-17 — Initial read-only audit

- Verified GitHub repository, default branch, permissions and current main commit.
- Verified PR 291 and PR 292 were merged.
- Verified Supabase project is ACTIVE_HEALTHY, PostgreSQL 17.6, with 113 public tables.
- Read-only schema and migration inspection confirmed atomic workflow and daily digest migrations are recorded in the live migration history.
- Verified latest main CI run 44102021708: unit tests, typecheck, lint, production build, Worker deploy and live smoke tests succeeded; mobile shell geometry smoke test was skipped.
- Verified Cloudflare Worker `customs` was modified at 2026-11-17 14:22 UTC.
- No production database writes, migrations, code deployment, main-branch writes or merges were performed by this audit.
- Created this execution ledger on an isolated feature branch.

## Next execution
1. Separate production deployment from verification in GitHub Actions.
2. Build the independent customs activity model, reusing reminders, finance costs and file asset lineage.
3. Verify actual daily digest invocation in deployed `send-reminders` Edge Function.
4. Complete PDF Studio parent/child and File Manager workflow integration.


## 2026-11-17 — Stage 2 independent customs activities

- Implemented a tenant-scoped `customs_activities` aggregate on feature branch `feature/customs-independent-activities-2026-11-17` and opened draft PR 294.
- Added explicit opt-in prerequisite edges, tenant serialization for dependency graph mutation, cycle prevention and database completion guards; no artificial stage chain is generated.
- Added immutable activity events via narrow trigger functions and version increment for compare-and-swap updates.
- Reused existing `finance_cost_items` records, `operational_reminders` and existing `file_assets` already present in File Manager; no new binary storage or duplicate cost/reminder ledger.
- Added an RTL page, route, menu entry, reminder creation link, file attachment link and finance reference controls.
- Added a dedicated PostgreSQL 15 fixture/test database to PR CI.
- CI run 44106707234: pre-existing workflow migration, RLS/rollback and two-session concurrency tests passed; new activity fixture failed because database roles are cluster-wide and already existed. Fixture was amended to conditionally create roles. Newer CI run for commit 12b45b37847c7164a35fb63de5594c8d62e43b61 was in progress when this ledger entry was written.
- No production DDL, data modification, merge or deployment was performed.
- Acceptance remains pending until latest CI and authenticated UI acceptance complete.


## 2026-11-17 — Stage 2 verification and production workflow incident

- PR 294 commit `62e1886d28e60da297ccbfea4d7f164487437743` passed the isolated PostgreSQL 15 activity fixture, candidate migration, RLS and tenant isolation, stale-version compare-and-swap, dependency cycle/completion, File Manager attachment, finance linkage, reminder linkage, immutable history privilege assertions, TypeScript, lint, production build, Deno checks and Cloudflare Worker dry-run.
- CI run 44109793070: success; Shipment Cost CI run 44109793175: success. Mobile viewport/keyboard smoke in the messenger workflow was skipped. No authenticated production UI test was performed.
- Activity-scoped rollback remains unimplemented; the current version column prevents stale writes but does not provide a revert action.
- PR 295 was created to separate routine validation from manual production deployment. The previous validation tests expected live smoke-script text in `build.yml`; those scripts were moved to `deploy-production.yml` and the tests redirected to the new workflow.
- A GitHub contents update call unexpectedly wrote commit `bdfec746` to main while the intended target was the feature branch. Main was restored to `968c58f` using a guarded ref update. This remains recorded as a repository write incident.
- Two automatic Worker deployments were observed: run 44108881420 on main and run 44109859363 after the initial `fix/**` branch push. Both Worker deploy steps reported success; the first live smoke failed on build signature and the second smoke was cancelled. Cloudflare Worker metadata showed modified time 2026-11-17 15:05:27 UTC. No Production database migration or data row update occurred.
- PR 295 now replaces the automatic main deploy with a manual workflow requiring dispatch from main and the exact confirmation string `DEPLOY CUSTOMS OS`. It remains Draft; latest validation run 44110782206 was pending at log update time.


## 2026-11-17 — Stage 3: PR292 live verification and PDF follow-through

- Audited PR292 merged implementation against the live Edge Function. Live `send-reminders` was version 72 and did not yet contain the merged digest claim/finish calls.
- Deployed the main implementation plus required shared modules as `send-reminders` version 73; retained the existing function slug and `verify_jwt=false`.
- Live evidence: pg_net invoked version 73 with HTTP 200; the 2026-11-17 digest ledger row reached `sent` with 18 successful deliveries and 0 failed; existing every-minute Cron remained active.
- Opened Draft PR296 for PDF source lineage and automatic Telegram archive, using existing File Manager records and archive gateway; no separate binary store or Production migration.
- First PR296 CI found one stale static test expectation after split-output provenance changed the output type. Updated the test contract and added source lineage tests. Latest run `44122485767`: Unit tests passed; the rest of the pipeline was still in progress.
- PR294 remains Draft and not in Production. No production migration/backfill, PR merge, main ref update or Cloudflare deployment in Stage 3.


## 2026-11-17 — PR296 full validation and targeted security review

- Latest PR296 head `092fed4dd611033e7b668515a41c4b941f169daf`, workflow `44123150742`: success. Unit tests, PostgreSQL fixture/migration contracts, RLS/concurrency, TypeScript, lint, production build, Deno checks and Cloudflare Worker dry-run passed. Mobile viewport smoke skipped by workflow conditions.
- Added File Manager display of parent source filenames for each PDF child.
- Read-only review sampled eight high-impact SECURITY DEFINER functions. All denied anon execution and showed authentication, org scope, relevant role/ownership guards and explicit search_path. Remaining advisor findings are still open.


## 2026-11-17 — Stage 4 security ACL review

- Audited the live SECURITY DEFINER inventory and the call graph for the exposed chat connection helpers, trigger functions and case-alert synchronizer.
- Opened Draft PR297 for direct RPC ACL removal on two internal organization/chat helpers plus direct execution revocation on SECURITY DEFINER trigger functions. Full CI `44144410862` and Shipment Cost CI `44144410705` succeeded; direct denial, nested trusted call paths and trigger execution were tested in isolated PostgreSQL.
- Found `sync_case_alert_reminders(uuid)` is callable by authenticated and lacks a client-role guard; it runs with definer rights and mutates system reminders across the caller organization's cases. Current UI is read-only and no other repository/database callsites were found.
- Opened Draft PR298 to restrict that synchronizer to service_role; CI runs `44145432402` and `44145432384` queued at ledger update.
- No production migration, merge or deployment occurred.


## 2026-11-17 — Stage 5: PR297–299 security follow-through

- PR297 chat helper/trigger ACL hardening: run `44144410862` success; Shipment Cost run `44144410705` success.
- PR298 case-alert synchronizer service-only access: run `44145432402` success; Shipment Cost run `44145432384` success.
- PR299 legacy role-unaware reminder overloads: run `44146345105` success; Shipment Cost run `44146345100` success.
- All three candidate migrations are still in Draft PRs and have only been tested in isolated PostgreSQL databases. No Production migration or merge took place.
- Live app call-site audit found current reminder creation uses only the JSONB payload overload with a staff-role allowlist; the two older positional overloads are not used by current source.
- Identified a separate AI Operator audit integrity gap: transition RPC allows the owner of a command record to supply result/executed attribution. It cannot execute the business action itself, but can create a false ledger state. No patch applied pending a proper server-authenticated proof design.


## 2026-11-17 — Stage 6: full SECURITY DEFINER and RLS privilege inventory

- Enumerated all 152 public SECURITY DEFINER functions in live Production.
- Confirmed zero anon-executable functions and zero missing explicit search_path settings. Fifteen use `search_path=''`; all are schema-qualified, restrictive function definitions.
- Counted 92 functions still callable by authenticated; call-graph review classified legitimate user-owned, organization-scoped, chat-member and owner-guarded cases separately from the PR297–299 candidates.
- Enumerated 15 RLS-enabled tables without policies. Production privileges show authenticated has no direct table-level SELECT/INSERT/UPDATE/DELETE on those tables; service_role has server access. Recorded these as intentional service-managed resources pending continued review, not direct authenticated exposure.
- Remaining Supabase advisor configuration warnings: pg_net installed in public (not changed because cron functions depend on net schema paths); leaked-password protection disabled (Auth settings not changed).
- Reviewed `ai_operator_transition_command` and its tamper trigger. Plan fields are immutable and executed rows frozen, but the owner of a command row can invoke the transition RPC directly to forge their own executed/result snapshot. This is an audit-integrity gap; business operations still require the Edge Function. Correct fix needs a server-signed capability or trusted transition boundary. No patch applied in this stage.
- PR297, PR298 and PR299 are all Draft and CI green. No Production migration, merge or deploy.


## 2026-11-17 — Stage 7: AI Operator ledger integrity hardening

- A deeper live Production check found authenticated users still had table-level INSERT on `ai_operator_commands`, with a same-user-only RLS insert policy. This allowed forged `executed` rows independently of the vulnerable transition RPC.
- Created Draft PR300 (`dd8e6484e8694e750af28336c5daca71b8d2e007`) to remove direct client ledger writes and put command creation/transition behind dedicated service-role-only RPCs. User history SELECT remains available under existing tenant/user policies.
- Edge Function was changed to keep all business operations on the caller-JWT client; the server-only client is limited to ledger RPCs. The existing global audit trigger is given the verified user id inside the trusted transaction so actor attribution is retained.
- Added isolated PostgreSQL ACL/audit-attribution/immutability tests, Vitest contract tests, and Deno validation to CI.
- CI run 44151721561 and Shipment Cost run 44151721617 were started. Await their conclusions. No Production migration, deploy or merge performed.


## 2026-11-17 — Stage 7 verification completed

- PR300 latest head: `3b1b69c5f58083bc62f862c6e89b0199ed25d168`.
- Full verify workflow run `44154127820`: success. Unit tests, ephemeral PostgreSQL workflow + digest + AI Operator ACL/audit contracts, TypeScript, ESLint, production build, Messenger gateway Deno, Supabase messenger/reminder/AI Operator Deno checks, Cloudflare Worker dry-run and AI Operator layout guard all passed.
- Shipment Cost workflow `44154127402`: success (tests, typecheck, lint, build, embedded Supabase client configuration).
- Mobile chat/reminders keyboard viewport smoke was skipped by existing workflow conditions and is not counted as passed.
- PR300 remains Draft and Production has not been migrated/deployed. Authenticated browser acceptance and explicit release approval remain outstanding.
