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
