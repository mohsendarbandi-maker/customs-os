# Customs OS — Risks and Blockers

Audit date: 2026-11-17

## Critical

### RISK-CI-01 — Production deploy coupled to main push
Evidence: latest main GitHub Actions run 44102021708 includes a successful "Deploy Worker to Cloudflare" step and live smoke tests. The workflow file is `.github/workflows/build.yml`; its current trigger includes push to main and the job is assigned to environment `production`.

Impact: a merge/push can publish production without a separate explicit release action, contrary to the execution safety policy.

Mitigation: split verification and deployment; deploy only via explicit protected workflow dispatch with environment approval. Do not alter production in this audit.

## High

### RISK-SEC-01 — Privileged SQL surface
Supabase security advisor snapshot reports 92 SECURITY DEFINER functions callable by authenticated users, 15 RLS-enabled tables without policies, and leaked-password protection disabled. These are review findings, not proof that every function is vulnerable.

Mitigation: inspect definitions, grants, search_path, auth.uid(), organization checks, and RLS semantics per function. Prioritize finance, file, customs exit, organization administration and messaging.

### RISK-CUST-01 — No independent customs activity aggregate
The workflow stores stage data in JSONB columns. Atomic patching and history exist, but separate activity rows with assignment, due date, attachments, cost references, dependency semantics and lifecycle events are not implemented.

Mitigation: reuse existing reminders, finance costs and file asset records; do not duplicate them.

## Medium

### RISK-DOC-01 — PDF parent/child lineage not verified
PDF utility code and file tables exist, but full workflow from page classification to independent PDFs, persisted lineage and File Manager linkage has not been proven end-to-end.

### RISK-DOC-02 — Archive runtime integration not proven
Archive infrastructure and idempotency helpers exist. Need prove deployed gateway, retry recovery, file ownership and no duplicate uploads.

### RISK-REG-01 — Registration order reconciliation needs staging tests
Migration history shows master-order and allocation work. Do not backfill or infer missing commercial data from totals without source evidence.

## Blocked by safety boundary
- Any production database migration.
- Any production data rewrite or backfill.
- Merge to `main`.
- Cloudflare or website deployment.
- Any legal/business rule not determinable from existing code, records or source documents.


### RISK-CUST-02 — Independent activity candidate awaiting contract acceptance

PR 294 adds a normalized activity model, but it remains a draft until the dedicated ephemeral PostgreSQL migration/tests and frontend CI complete. Initial CI failed before applying the new migration because the fixture recreated cluster-global roles already created by the previous fixture; this was corrected by making role creation conditional. Do not apply the candidate migration to live Supabase before CI passes and authenticated UI acceptance is complete.


## Critical — 2026-11-17 production deployment incident

- Main briefly advanced to `bdfec746ec9dd5e89d11a8373ea0668eeba1bdb9` due a contents-API branch targeting failure; it was restored to `968c58f2624c04f53cc98f094be888cd7e74dc72` with an expected-SHA guarded ref update.
- Main workflow run 44108881420 deployed Worker successfully, then its live smoke test failed because the live Worker served a different build signature.
- Initial `fix/manual-production-deployment-2026-11-17` branch creation triggered the old `fix/**` build workflow before the updated YAML was committed; run 44109859363 also deployed Worker successfully and was cancelled during smoke.
- Cloudflare Worker metadata reports last modification 2026-11-17 15:05:27 UTC. These were automated workflow deployments, not an explicit user-approved release.
- Main is currently back on `968c58f`; no Production database migrations or data writes were performed.

Mitigation in Draft PR 295: validation workflow has no deploy command; deployment is moved to a manual-only workflow dispatch from main with exact confirmation phrase `DEPLOY CUSTOMS OS`. Full smoke tests are retained in the manual deployment workflow. PR must be reviewed and merged with explicit permission; GitHub Environment required reviewers should be configured.

## High — activity rollback gap

Independent activity versioning and immutable event history are implemented and tested, but activity-scoped rollback is not. Do not treat optimistic concurrency as a rollback substitute.


## Stage 3 evidence update — 2026-11-17

- Production auto-deploy risk is mitigated in main: PR295 merged; production deployment now requires manual workflow dispatch from main and exact phrase `DEPLOY CUSTOMS OS`. Environment-level required reviewers remain unverified.
- Daily digest execution gap is resolved: `send-reminders` version 73 returned HTTP 200; ledger for 2026-11-17 recorded 18 successful and 0 failed deliveries.
- PDF source lineage and automatic archive are implemented on Draft PR296 only. Authenticated real-shipment Telegram upload, retry/reconciliation and reload acceptance remain open.
- Independent customs activity model and pending/digest integration are implemented on Draft PR294. Production `customs_activities` table is absent and migration has not been applied; authenticated acceptance and release approval remain open.
- Security advisor findings remain open for function-by-function review; do not apply blanket grants/revokes without inspecting each function and its tenant boundary.


## Targeted SECURITY DEFINER review — 2026-11-17

Eight sensitive functions were read from live PostgreSQL definitions and execute privileges: declaration exit stage, ship-pass control, maritime shipment update, finance cost archive/create, File Manager folder copy, owner profile insert and owner profile manage.
- All denied anon execution and authenticated callers before mutation, then scoped actions to the caller's organization.
- Role/ownership controls were present; owner profile management delegates to owner_console_guard, which explicitly requires an authenticated organization owner. Folder copy also enforces same organization/client/shipment/customs-office scope and client-owned folder restrictions.
- Sampled functions use fixed search_path settings. No immediate bypass was established in this sample.
- This does not resolve all 92 advisor findings; remaining functions require per-function analysis.


## Stage 4 — Security findings (2026-11-17)

- Confirmed unnecessary direct authenticated execution on two internal chat helper RPCs and two SECURITY DEFINER trigger functions. Candidate ACL removal and ephemeral PostgreSQL tests are in PR297; CI green, not merged.
- Confirmed a higher-risk role gap in `sync_case_alert_reminders(uuid)`: authenticated client accounts can call a SECURITY DEFINER routine with no internal role check. It can create/close system reminders across all cases in the same organization, bypassing the row-level insert/update role guard. Candidate service_role-only ACL is PR298; CI pending. No production changes.
- `ai_operator_transition_command` permits the owner of a personal command row to set transition/result fields; this may permit self-owned ledger forgery but it does not itself execute the underlying business operation. Needs a separate audit-integrity review of its Edge Function call contract and organization-visible history before changes.
- Remaining SECURITY DEFINER functions require function-by-function review; do not blanket revoke authenticated grants where RPCs are used by the app or RLS policies.


## Stage 5 — findings as of 2026-11-17

- PR297 (chat helper and trigger direct RPC ACL): CI green, Draft, not live. Production grants remain until authorized migration.
- PR298 (case-alert sync): CI green, Draft, not live. Production `sync_case_alert_reminders(uuid)` remains authenticated-callable until an approved migration is applied.
- PR299 (legacy reminder creation overloads): CI green, Draft, not live. Production old overloads remain authenticated-callable until approved migration; current UI uses only the safer JSONB overload.
- AI Operator audit integrity: production remains exposed until PR300 migration + Edge Function are released. Draft PR300 now removes direct authenticated ledger INSERT/UPDATE/DELETE and legacy transition RPC, routes audit writes through two service-role-only functions, and preserves user-scoped business execution. PR300 CI and Shipment Cost CI are green; authenticated browser acceptance and release are still outstanding.


## Stage 6 — residual security inventory

- Production audit: 152 public SECURITY DEFINER functions; 0 anon-executable; 92 authenticated-executable; all have explicit search_path, with 15 using empty path. The number 92 is an inventory count, not a count of confirmed vulnerabilities.
- 15 RLS-enabled/no-policy tables expose no direct authenticated table privileges (no SELECT/INSERT/UPDATE/DELETE); they are service-managed. Keep reviewed as informational unless a new privilege path is found.
- Remaining Supabase advisor warnings: pg_net extension in public (migration could break cron if moved without path adjustment); leaked-password protection disabled (Auth config). No changes made.
- AI Operator command ledger can be self-forged via the authenticated transition RPC. This is an audit-integrity weakness; the caller cannot execute the underlying operation through the RPC. Needs server-signed transition proof while preserving no-service-role-key-in-browser/AI-Operator client invariant.


## Stage 7 — AI Operator ledger integrity mitigation candidate

- PR300 removes two Production audit-forgery paths in a tested candidate: direct authenticated INSERT on `ai_operator_commands` and authenticated execution of `ai_operator_transition_command`.
- PR300 is Draft; until its migration is approved/applied, Production remains vulnerable to misleading AI Operator command history for a user's own rows. This does not, by itself, permit the direct RPC to execute the underlying customs/finance business action.
- Candidate server-only ledger RPCs derive organization/user from active profile and require service_role; terminal attribution is checked against the user authenticated by the Edge Function. Actual business actions remain on the user's JWT client.
- Release checks: successful CI; verify service-role env availability in the deployed Edge runtime without revealing it; authenticated plan/confirm/execute/history acceptance; apply Production migration only within explicitly authorized release.


## Stage 7 — AI Operator candidate verified; Production release outstanding

- PR300 head `3b1b69c5f58083bc62f862c6e89b0199ed25d168` is Draft/open/mergeable. Automated verify CI `44154127820` and Shipment Cost CI `44154127402` succeeded.
- Unit tests, isolated PostgreSQL ACL and audit attribution, immutable terminal-state tests, TypeScript, ESLint, build, Deno checks and Cloudflare Worker dry-run passed. Mobile viewport smoke was skipped.
- Production vulnerability remains until the matching migration and Edge Function are released together. No Production schema/function/site/Worker change was made.
- Release checks: code review; confirm service-role env variable is available in deployed Edge runtime without exposing it; exercise AI Operator plan/confirm/execute/history with authenticated browser; apply migration and deploy function only under explicit release approval.



## Stage 8 — AI Operator signed proof rollout gate (2026-11-18)

- PR301 is a tested candidate, not a live fix. Production remains exposed until its migration and Edge Function are released together.
- Required Edge runtime secret: `AI_OPERATOR_TRANSITION_HMAC_SECRET` (random, at least 32 characters). Required Vault secret name: `ai_operator_transition_hmac_v1`; values must match byte-for-byte.
- Neither secret has been provisioned by this change. No Supabase secret/Vault config was altered. Do not apply the migration before both secrets are created and signer preflight is verified.
- If an operation succeeds but signed completion cannot be persisted, command remains `executing` and is deliberately non-retryable. This prevents duplicate business writes but requires a reconciliation process before an operator can safely resolve it.
- PR301 requires authenticated Edge invocation acceptance (safe / confirmation-required / destructive flows, signed begin, successful completion, failure and history) before Production release.

## Stage 9 — registration-order legacy candidates (2026-11-18)

- Customs-data registration numbers are historical evidence, not an automatically trusted foreign key. Live rows include cross-cargo-owner references, conflicting case references, unknown master numbers and apparent order-capacity conflicts.
- PR302 therefore exposes only uniquely matched, same-organization/same-owner candidates and never auto-updates `shipments.registration_order_id`.
- Candidate rows are separate from confirmed master totals and do not consume/release capacity. A future explicit attach action must use the normal shipment update path and allow the existing database capacity/owner trigger to reject an invalid allocation.
- Ambiguous normalized parent numbers, conflicting case references, direct-FK rows and already case-linked rows are excluded from the candidate list.
- Production has not been migrated, backfilled or mutated. PR302 remains Draft pending full CI and authenticated browser acceptance.



## Stage 10 — document identity release gate (2026-11-18)

- PR303 migration is additive and verified only on isolated PostgreSQL. Production schema remains unchanged until explicit release approval.
- Existing legacy document rows already have their own metadata columns; the new columns are for canonical `shipment_documents` uploads. The UI supports a staged fallback while the migration is absent, but authenticated browser acceptance before/after migration is still required.
- Extracted values are suggestions, not writes to master registration order or shipment totals. Calendar text is preserved; no silent Jalali/Gregorian conversion is performed.
- Legacy `customs_documents` extraction suggestions are not inserted into `shipment_document_extractions`, since its FK points only to canonical `shipment_documents`. The UI shows suggestions, but a future explicit legacy extraction store would require separate schema/ownership review; not needed for this stage.
- PR303 tests and full CI are green; PR remains Draft pending code review and authenticated test of document upload, OCR/PDF extraction, manual edit, refresh/reload and File Manager type synchronization.
