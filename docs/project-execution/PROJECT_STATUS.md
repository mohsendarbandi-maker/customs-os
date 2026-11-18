# Customs OS — Project Execution Status

Last audited: 2026-11-17  
Audit base: `main` at `968c58f2624c04f53cc98f094be888cd7e74dc72`  
Supabase project: `bjngfgiecvihofemptub` (read-only inspection)  
Production changes: none performed by this audit branch.

## Status definitions
- DONE & VERIFIED — implementation and relevant behavior are supported by executed tests or authoritative runtime evidence.
- IMPLEMENTED, NOT VERIFIED — implementation exists; behavior is not sufficiently demonstrated.
- PARTIALLY IMPLEMENTED — some requirements are implemented, important parts remain.
- NOT IMPLEMENTED — no implementation found.
- BLOCKED — requires access, safe test environment, or a business/legal decision.

## Capability ledger

| ID | Scope | Status | Evidence | Files / Database | Tests | Dependencies / Risks | Next action |
|---|---|---|---|---|---|---|---|
| INFRA-01 | GitHub repository and main branch | DONE & VERIFIED | Repository metadata; main SHA `968c58f`; push/admin permission available | GitHub repository | Read-only metadata retrieval | Main is unprotected per branch API; no required status checks | Establish protected review/release process; do not change main in this audit |
| INFRA-02 | Supabase connectivity and live schema inventory | DONE & VERIFIED (read-only) | Project ACTIVE_HEALTHY; PostgreSQL 17.6; 113 public tables | Supabase project `bjngfgiecvihofemptub` | Read-only schema and migration queries | No staging database branch created; no production writes | Use ephemeral PostgreSQL for all candidate migrations |
| INFRA-03 | Cloudflare Worker deployment inventory | PARTIALLY IMPLEMENTED | Worker `customs` exists; modified 2026-11-17 14:22 UTC; CI run shows successful deploy step | Worker `customs`; wrangler config | GitHub Actions deploy and smoke-test steps succeeded | CI currently couples main push to production deployment | Make deploy an explicit protected/manual release action |
| CUST-01 | Parallel customs workflow patching and conflict detection | DONE & VERIFIED (CI evidence) | PR 291 merged; PR 292 includes PostgreSQL fixture, concurrent sessions, rollback and exit gate checks | `customs_declaration_workflow`, workflow events; migration `20261117011900` | PR 292 reports PostgreSQL, concurrency, RLS, rollback and exit contract tests passed | Live UI role testing and all customs regimes remain unverified | Run authenticated role matrix and test all supported regimes in staging |
| CUST-02 | Independent customs activity aggregate and links to finance, reminders and existing files | IMPLEMENTED, NOT VERIFIED (automated contracts passed) | PR 294 at `62e1886`; tenant-scoped entities, version CAS, immutable history triggers, explicit dependency graph and cycle/completion guards; same-shipment File Manager attachment; optional finance/reminder links. | Migration `20261117150000_customs_independent_activities.sql`; `src/pages/CustomsActivitiesPage.tsx`; app route/menu; reminder type; 4 new tables and `finance_cost_items.customs_activity_id`. | CI 44109793070: isolated PostgreSQL fixture + candidate migration + activity RLS/tenant/concurrency/dependency/file/finance/reminder contracts, TypeScript, lint, build, Deno and Worker dry-run all passed. CI 44109793175 also passed. No production migration. | Authenticated browser acceptance still missing; rollback RPC/UI absent; edit title/description/type not complete; pending report/daily digest not yet connected to new activities. | Add safe per-activity rollback; integrate daily pending report and digest; perform authenticated UI acceptance. |
| OPS-01 | Customs pending-work report and finance projection | PARTIALLY IMPLEMENTED | `CustomsPendingReportPage`; workflow/checklist/permit/finance projection. New `customs_activities` are not yet included. | Existing workflow, checklists, permits, `finance_cost_items` | Unit tests exist for workflow pending rules; CI passed. | New activity assignee/due date is not in daily pending report. | Add new activity buckets: overdue, due today, unassigned, waiting. |
| OPS-02 | Daily digest idempotency | DONE & VERIFIED (database/CI evidence) | PR 292; migration `20261117140000`; PK `(user_id, local_date)`; service-role-only access | `customs_daily_digest_deliveries` | PR 292 reports SQL contract tests and live access checks | Need confirm deployed send-reminders function actually calls digest claim/finish RPCs | Inspect exact deployed function and prove end-to-end push delivery |
| REG-01 | Registration-order master and shipment capacity reconciliation | IMPLEMENTED, NOT VERIFIED (full business reconciliation) | Live migration history contains master, shipment reconciliation and external allocation migrations | `registration_orders`, `registration_order_external_allocations`, `shipments` | No live mutation or full reconciliation run performed | Must reconcile legacy and external allocations without guessing | Inspect schema/functions/tests and create staging fixtures |
| DOC-01 | PDF Studio page grouping/splitting and parent-child document model | PARTIALLY IMPLEMENTED | PDF Studio page, PDF utilities, shipment document and File Manager modules exist | `shipment_documents`, `file_assets`, `file_locations`, `file_manager_files` | Existing PDF utility tests; no end-to-end parent/child proof yet | Original file preservation and page-to-document lineage need proof | Trace actual page-grouping UI to persisted records and archive |
| DOC-02 | Telegram archive and File Manager transfer | PARTIALLY IMPLEMENTED | Existing archive API, idempotency helper, upload jobs, IndexedDB transfer | `file_assets`, `file_locations`, `file_transfer_jobs`, `file_manager_upload_jobs` | Unit coverage exists for utilities; full retry/ownership integration not proven | Do not add parallel storage or re-upload files unnecessarily | Verify mother/child file lineage, retry recovery and tenant ownership |
| SEC-01 | RLS, SECURITY DEFINER and tenant isolation | PARTIALLY IMPLEMENTED; security review required | Supabase security advisor on 2026-11-17 | 15 RLS-enabled/no-policy notices; 92 authenticated-callable SECURITY DEFINER findings; 1 public extension warning; leaked-password protection disabled | No complete tenant-isolation test matrix executed in this audit | Advisor findings require function-by-function authorization review; not all are necessarily exploitable | Prioritize exposed privileged functions and sensitive file/finance paths |
| CI-01 | Routine CI and production deployment separation | PARTIALLY IMPLEMENTED | PR 295 draft removes deployment from the validation workflow and introduces typed manual production dispatch. Not merged. | `.github/workflows/build.yml`, `.github/workflows/deploy-production.yml` on PR 295 | PR 295 latest validation run `44110782206` pending at last audit; earlier run `44110087676` failed because legacy tests still read moved smoke scripts; tests have now been redirected to the manual deployment workflow. | Old workflow remains active on main until PR 295 is reviewed and merged. | Verify PR 295 tests, merge only with explicit approval. |
| CUST-03 | Activity-scoped safe rollback with optimistic concurrency | NOT IMPLEMENTED | No activity rollback RPC or user-facing rollback action found in PR 294; version CAS prevents stale overwrites but is not rollback. | `customs_activities`, `customs_activity_events` | No rollback tests for independent activity events yet. | Rollback must restore only the selected event's field delta when it is still the latest compatible version. | Implement invoker-checked CAS rollback RPC and test same-field conflicts. |
| CI-02 | Production readiness | BLOCKED | Main CI run `44108881420` deployed Worker but failed the live Worker build-signature smoke test. Second run `44109859363` on the initial fix-branch push also deployed Worker, then was cancelled during smoke. Worker metadata updated `2026-11-17T15:05:27Z`. | Main is restored to `968c58f`; no Production DB migration or row update was performed. | Full production regression and manual authenticated UI acceptance not complete. | Two automatic Worker deployments occurred through pre-existing workflow triggers, without release approval. | Stop auto-deploy via PR 295; investigate build-signature/asset smoke failure; require explicit release authorization. |
| CI-03 | Manual-only Production deployment workflow | IMPLEMENTED, NOT VERIFIED | Draft PR 295; validation workflow no longer contains deploy step; separate workflow requires `workflow_dispatch`, main ref and exact confirmation phrase. Full existing live smoke scripts moved to manual workflow. | `.github/workflows/build.yml`, `.github/workflows/deploy-production.yml` on PR 295 | Latest PR 295 run `44110782206` pending at last audit; earlier run `44110087676` failed because legacy tests still read moved smoke scripts; tests have now been redirected to the manual deployment workflow. | PR not merged; GitHub Environment required reviewers still need to be configured. | Complete CI; verify no deploy is triggered by branch pushes; configure environment reviewers before merge. |

## 2026-11-17 Stage 2 and deployment incident update

- Independent activity implementation passed PostgreSQL 15 contracts, TypeScript, ESLint, Vite build, Deno checks and Worker dry-run on PR 294 commit `62e1886d28e60da297ccbfea4d7f164487437743` (runs 44109793070 and 44109793175).
- Mobile browser viewport smoke was skipped; authenticated UI review remains pending.
- Activity-scoped rollback RPC/UI and integration into the pending report/daily digest remain incomplete.
- Production deployment incident: an erroneous commit `bdfec746ec9dd5e89d11a8373ea0668eeba1bdb9` briefly moved main; main was restored to `968c58f2624c04f53cc98f094be888cd7e74dc72` with a guarded ref update. The original main workflow then deployed Worker (run 44108881420) and failed its live build-signature smoke check. Creating the initial PR 295 fix branch under `fix/**` also triggered the old workflow before its YAML was changed; that run (44109859363) deployed Worker again, then was cancelled during smoke. Cloudflare Worker metadata showed last modification at 2026-11-17 15:05:27 UTC. Main currently remains at `968c58f`.
- PR 295 now contains the deployment separation and moved smoke coverage; it remains Draft. Latest validation run 44110782206 was pending at last update.

## 2026-11-17 Stage 2 update

- New independent activity model and UI implemented on draft PR 294.
- Existing finance costs, operational reminders and File Manager assets are referenced; no second cost/reminder/file ledger is created.
- PR 294 CI first attempt (run 44106707234) passed existing workflow SQL tests and failed when the new fixture attempted to create cluster-global role `anon` that already existed. Fixture was corrected to create roles conditionally.
- Current CI run 44107198512 targets commit 12b45b37847c7164a35fb63de5594c8d62e43b61; final result not yet verified at update time.

## Live read-only record counts (audit snapshot)
- organizations: 2
- shipments: 22
- customs declarations: 19
- customs declaration workflows: 9
- operational reminders: 71
- shipment documents: 90
- file assets: 117
- file locations: 117
- File Manager files: 134
- registration orders: 3

Counts are a point-in-time inventory only; they do not prove data integrity or business reconciliation.


## Authoritative update — 2026-11-17, after Stage 3 verification

This section supersedes the earlier status rows above where they conflict with later evidence.

- Main is now `ca272524436a8135372e74c6f97f38ba195d5440`. PR295 is merged. Validation is separate from production release; deploy requires manual dispatch from main and exact phrase `DEPLOY CUSTOMS OS`. GitHub Environment required reviewers are not independently verified.
- PR292's daily digest runtime gap is DONE: `send-reminders` deployed as version 73 on 2026-11-17 15:57:29 UTC. Live pg_net invocation returned HTTP 200. Delivery ledger for 2026-11-17: `sent`, 18 successful and 0 failed. Existing cron remains active every minute.
- PR294 independent customs activity model remains Draft/open, head `db7c390574284b97ce80953912638d732e8613a5`. CI runs `44116762839`, `44116762892`, `44116763351` succeeded. The live `public.customs_activities` relation is absent; no Production migration/backfill has been applied. Authenticated browser acceptance is still required.
- PR296 PDF Studio/File Manager lineage and autoarchive remains Draft/open, latest head `ea2b3c446acee0c47d1d9185c38b35fcce599d0a`. It preserves source File Manager row/asset/folder type/shipment/client, maps each output page to its parent, autoarchives eligible same-shipment output using the existing Telegram archive gateway, persists `metadata.pdfStudioLineage`, and shows a lineage indicator in File Manager. Full CI run `44123150742` succeeded: unit tests, isolated PostgreSQL migrations/RLS/concurrency contracts, TypeScript, lint, production build, Deno checks and Worker dry-run. Mobile viewport smoke was skipped by workflow conditions. No merge, migration or deployment has occurred.
- No new production DB migration, data backfill, Cloudflare Worker deploy or website deploy was performed in Stage 3.


## Targeted SECURITY DEFINER review — 2026-11-17

A read-only review sampled eight high-impact functions: declaration exit stage, ship-pass control, maritime shipment update, finance shipment-cost archive/create, File Manager folder copy, owner profile insert and owner profile manage (via owner_console_guard).
- All sampled functions denied anon EXECUTE, authenticated the caller and bound operations to the caller's organization.
- Function-specific role/ownership constraints were observed; folder-copy also checked organization/client/shipment/customs-office scope and client ownership. owner_console_guard explicitly requires an authenticated organization owner.
- Fixed search_path values were present on the sampled functions. No immediate cross-tenant bypass was established in this sample.
- This is not a complete audit of the 92 advisor findings; continue function-by-function review rather than bulk privilege changes.
 

## Stage 4 — SECURITY DEFINER ACL review, 2026-11-17

### Audit coverage
- Production PostgreSQL currently reports 92 public SECURITY DEFINER routines executable by `authenticated`; all sampled routines had explicit `search_path` configuration, and the advisor reported anon execution denied for the sampled group.
- Read-only classification found 2 trigger-returning functions with unnecessary direct authenticated EXECUTE grants, 2 helper RPCs with no caller identity/org check, and several functions without explicit `user_org_id()` that instead derive authorization from `auth.uid()`, same-conversation membership, profile ownership or owner-only guard.
- Reviewed function definitions and call graph for chat helper routines, session/profile helpers, reminders, finance, File Manager, customs exit/ship-pass and owner operations. Eight high-impact functions were inspected previously; the current stage expanded the chat/reminder helper review.

### PR297 — internal chat helper and trigger ACL hardening
- Draft PR297 head `77dd4afc00b8d1fd865b0fc0af26a06304f6f396`.
- Revokes direct Data API execute for `orgs_are_connected(uuid,uuid)` and `chat_connection_allowed_for_conversation(uuid,uuid)` from PUBLIC/anon/authenticated; keeps service_role and owner access.
- Dynamically revokes direct API-role execute on public SECURITY DEFINER trigger functions. PostgreSQL still fires triggers because execute rights are checked when a trigger is created, not at trigger invocation.
- Live call graph confirms the two trusted orgs_are_connected callers (`chat_add_member`, `chat_storage_path_allowed`) are SECURITY DEFINER, owner postgres; no RLS policy, view or other routine directly calls the connection-allowed helper.
- CI run `44144410862` and Shipment Cost run `44144410705`: both succeeded. The isolated test proved direct authenticated/anon calls denied, trusted nested SECURITY DEFINER calls still succeed, and a trigger continues firing. Mobile viewport smoke skipped by workflow conditions.
- Not merged; no Production migration applied.

### PR298 — case-alert synchronizer role boundary
- Draft PR298 head `8a3b96b7365e19fd59467a272acdf6f2f66d02e0`; verification workflow `44145432402` and Shipment Cost workflow `44145432384` queued at the time of this update.
- Live `sync_case_alert_reminders(uuid)` is SECURITY DEFINER and directly executable by authenticated users, but contains no role restriction; it loops every case in the caller's organization and can create or close system reminders. SECURITY DEFINER bypasses the reminder table's normal client-role RLS restriction.
- Current Case Alerts UI calculates read-only alerts locally. No direct application/Edge Function callsite, other database routine, view or trigger reference was found for this RPC.
- Candidate migration revokes PUBLIC/anon/authenticated execution and retains service_role access. Isolated PostgreSQL tests cover client direct-call denial and trusted service-role execution.
- No Production change performed.

### Remaining security work
- PR297/298 remain Draft pending CI/review. No migration has been applied to Production.
- The other exposed SECURITY DEFINER routines still need a full call-site and role matrix; this stage does not claim all 92 warnings are resolved.
- Keep elevated functions and RLS findings open until representative cross-tenant negative tests and role-based UI acceptance are completed.


## Stage 5 — legacy reminder overloads and AI Operator audit boundary (2026-11-17)

### PR298 — case alert sync role boundary
- Draft PR298 head `8a3b96b7365e19fd59467a272acdf6f2f66d02e0`.
- Both required CI runs succeeded: `44145432402` (main verification) and `44145432384` (Shipment Cost CI).
- Isolated PostgreSQL test confirms authenticated/anon direct calls are denied, service_role execution remains, and trusted backend call succeeds.
- Live Production has **not** received the migration. `sync_case_alert_reminders(uuid)` remains currently callable by authenticated until an approved release/migration.

### PR299 — legacy reminder overloads
- Draft PR299 head `b6e5245da5417983818fbe58774c29009c2771f2`.
- Live function inventory confirmed old overloads `create_operational_reminder(text,text,timestamptz,text,uuid,uuid)` and `(...,uuid,uuid,text)` are SECURITY DEFINER and callable by authenticated but do not reject role client. The current UI calls only the JSONB overload, which has an explicit internal-role allowlist.
- Candidate migration revokes direct PUBLIC/anon/authenticated execution for the old overloads and retains service_role; current JSONB path remains callable.
- Full CI runs `44146345105` and `44146345100` both succeeded: unit tests, isolated PostgreSQL migration/ACL/JSONB compatibility tests, TypeScript, lint, build, Deno checks and Worker dry-run. Mobile viewport smoke skipped by workflow conditions.
- No Production migration/merge was performed; old overload access remains live until release approval.

### PR297 — internal chat helper and trigger ACL
- Draft PR297 head `77dd4afc00b8d1fd865b0fc0af26a06304f6f396`.
- Main verification `44144410862` and Shipment Cost `44144410705` succeeded.
- Direct authenticated/anon access to two internal helper RPCs is removed in the candidate migration, while postgres-owned SECURITY DEFINER parent paths are preserved. Direct execute grants on SECURITY DEFINER trigger functions are revoked; isolated test confirms a trigger still fires.
- No Production migration/merge performed.

### AI Operator command-ledger integrity — follow-up design required
- `ai_operator_transition_command` is a SECURITY DEFINER RPC callable by authenticated. It verifies `auth.uid()` owns the command row and enforces a status-transition graph, but accepts caller-supplied `p_executed_by`, `p_executed_at`, `p_result`, `p_before_data` and `p_after_data`. It does not independently prove that the Edge Function actually performed the business action.
- This is an audit-integrity weakness: a user can falsify the state/result of their own command row; it does not itself execute the underlying customs/finance operation.
- The current Edge Function uses the end-user JWT and tests explicitly prohibit embedding a service-role secret. Fixing this correctly needs a server-authenticated transition capability (for example, a dedicated signed transition token) or a trusted internal service boundary. Do not make a superficial `p_executed_by=auth.uid()` change and claim the issue resolved.
- Keep this finding open; design a signed proof and test both direct-RPC forgery denial and legitimate Edge Function transitions.

 

## Stage 6 — complete SECURITY DEFINER inventory and residual risk classification (2026-11-17)

### Live Production inventory
- 152 public `SECURITY DEFINER` functions in total.
- Zero functions are executable by `anon`.
- 92 remain executable by `authenticated`; the count includes legitimate user-scoped RPCs, chat-membership helpers, owner-guarded finance/admin functions and personal/session helpers, not only vulnerabilities.
- All 152 functions have an explicit `search_path` setting. Fifteen use an empty search_path, which is the restrictive form; sampled functions qualify objects by schema.
- 47 functions return `trigger`; 2 had unnecessary direct authenticated grants and are covered by PR297's revoke loop.
- Of the 15 RLS-enabled tables with no policies, Production privileges show no direct SELECT/INSERT/UPDATE/DELETE for authenticated users; service_role has the expected server access. These advisor INFO findings are not evidence of an authenticated table-access bypass.
- Security advisor still reports one `pg_net` extension-in-public warning and Auth leaked-password protection disabled. Moving pg_net can affect existing cron jobs, and Auth setting change needs separate controlled config access; neither was changed in this stage.

### AI Operator audit-integrity issue — mitigation candidate ready in PR300
- Production exposed two independent audit-forgery paths: direct authenticated INSERT into `ai_operator_commands`, and caller-controlled result/snapshot/actor fields in the SECURITY DEFINER transition RPC.
- Draft PR300 now addresses both paths with a server-only ledger writer, revoked client writes/legacy transition call, verified user/org binding, preserved history SELECT and audit-trigger attribution. The Edge Function keeps every business mutation on the caller JWT/RLS client.
- PR300 isolated PostgreSQL ACL/audit actor/terminal immutability tests pass; full CI and Shipment Cost CI also pass (runs 44154127820 and 44154127402). Deno check, Worker dry-run and production build passed. Mobile viewport smoke was skipped.
- This is a tested mitigation candidate, not a live Production fix: migration and Edge Function are not deployed. Release still needs review, authenticated acceptance, and explicit release approval.

## Stage 7 — AI Operator ledger integrity hardening (2026-11-17)

### PR300 — server-owned command ledger
- Live Production review established two distinct audit-forgery paths: authenticated users could call the SECURITY DEFINER transition RPC with fabricated result/snapshot/actor fields, and had direct INSERT privilege on `ai_operator_commands` where the RLS policy only checked row ownership.
- Draft PR300 `security/ai-operator-server-owned-ledger-2026-11-17` moves creation and transitions to two service_role-only RPCs, revokes browser INSERT/UPDATE/DELETE and the old client-callable transition RPC, while retaining authorized history reads.
- The AI Operator Edge Function's service-role client is confined to those two ledger RPCs. Customs/finance/document operations continue to use the caller JWT client and normal RLS. A PostgreSQL fixture validates ACL denial, trusted create/transition, actor attribution and terminal immutability.
- PR300 latest head `3b1b69c5f58083bc62f862c6e89b0199ed25d168`; full verification CI `44154127820` and Shipment Cost CI `44154127402` both succeeded. Deno Edge Function checks and Worker dry-run are green; mobile viewport smoke was skipped.
- No Production migration, Edge Function deploy, merge or data change. Runtime secret availability and authenticated UI acceptance remain release checks.

### Other security PRs and configuration
- PR297/298/299 remain Draft, with prior CI success recorded in Stage 6. Production grants have not yet been changed.
- Auth leaked-password protection remains disabled; pg_net-in-public remains an advisor warning. No supported config mutation was available from current project tools.



## Stage 8 — AI Operator signed transition proof (2026-11-18)

### PR301 — signed proof for all trusted command-state changes
- Draft PR301 head `c11de0b5df1f629d7b07797c429b4caa06379c43`.
- Replaced the earlier proposed service-role ledger-write approach with a narrower HMAC-SHA256 capability: the Edge Function signs create/begin/completion/failure proof payloads, while PostgreSQL verifies key parity against a dedicated Vault secret and binds every transition to `auth.uid()` and the command id.
- Direct browser INSERT on `ai_operator_commands` is revoked; command creation derives user and organization from the active profile. Direct unsigned transition to executing/failed/clarification/executed is rejected. Only signed RPCs can begin or complete a command.
- The Edge Function requires signer preflight before any business operation. A command left in `executing` after successful business execution but failed audit persistence is blocked from re-execution and marked for reconciliation.
- Isolated PostgreSQL signature/ACL/tenant/expiry/tamper/audit-attribution tests, Vitest HMAC tests, Deno check, main verification and Shipment Cost CI all passed (runs 44240033780, 44240033778 and 44240033773).
- PR301 remains Draft; no Production migration, HMAC secret, Edge Function deployment or merge has been applied.

## Stage 9 — legacy registration-order candidate matching (2026-11-18)

### PR302 — review-only legacy shipment candidates
- Draft PR302 latest development head `aae971fa03af13ddd58468d5c53d40fd2969236a`.
- Live read-only data audit found 17 shipments without a direct master-order FK; 14 have a customs-data registration number, of which 10 can be matched to a master record within same organization/owner. Four references have no corresponding master record. Three have no customs registration reference.
- The live audit also revealed historical over-capacity/conflicting reference risks. Therefore customs-data number matches are intentionally not added to authoritative capacity totals and are not auto-linked.
- PR302 adds `registration_order_legacy_match_candidates`, Persian/Arabic digit normalization, same-tenant/exact-owner uniqueness and ambiguity/conflicting-case exclusions. Existing direct FK and case-based allocation/capacity behavior remains authoritative.
- Registration Orders UI displays unresolved matches separately with their bill, net weight and invoice amount; it clearly states they do not count toward confirmed capacity and have not been auto-attached.
- Isolated PostgreSQL candidate contract run 44243008963 succeeded on the migration/test head. Full UI typecheck/lint/build and the broader main verify pipeline were still running at the latest update (44243373164/44243373100/44243373151, head `aae971fa03af13ddd58468d5c53d40fd2969236a`).
- No Production migration, data backfill, FK update, merge or deployment.
