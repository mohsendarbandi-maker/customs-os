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
