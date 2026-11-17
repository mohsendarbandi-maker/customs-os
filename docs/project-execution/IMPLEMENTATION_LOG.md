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
