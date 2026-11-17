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
| CUST-02 | Independent activity entity with owner, due date, costs, attachments and history | NOT IMPLEMENTED | PR 292 explicitly lists full independent activity rows as remaining scope; current workflow uses JSONB stage columns | Existing workflow JSONB; reminders and finance tables are available for integration | No independent activity integration tests found in reviewed scope | Avoid duplicate finance/reminder/file systems; dependency/legal semantics need discovery | Design normalized activity aggregate reusing current reminders, finance_cost_items and file_assets |
| OPS-01 | Customs pending-work report and finance projection | PARTIALLY IMPLEMENTED | `CustomsPendingReportPage`; pending task helper; finance projection reads submitted/rejected costs | Existing workflow, checklists, permits, `finance_cost_items` | Unit tests exist for pending workflow rules; CI unit suite passed | Report is a projection, not yet a complete independent activity register | Integrate independent activities and assignee/due-date breakdown |
| OPS-02 | Daily digest idempotency | DONE & VERIFIED (database/CI evidence) | PR 292; migration `20261117140000`; PK `(user_id, local_date)`; service-role-only access | `customs_daily_digest_deliveries` | PR 292 reports SQL contract tests and live access checks | Need confirm deployed send-reminders function actually calls digest claim/finish RPCs | Inspect exact deployed function and prove end-to-end push delivery |
| REG-01 | Registration-order master and shipment capacity reconciliation | IMPLEMENTED, NOT VERIFIED (full business reconciliation) | Live migration history contains master, shipment reconciliation and external allocation migrations | `registration_orders`, `registration_order_external_allocations`, `shipments` | No live mutation or full reconciliation run performed | Must reconcile legacy and external allocations without guessing | Inspect schema/functions/tests and create staging fixtures |
| DOC-01 | PDF Studio page grouping/splitting and parent-child document model | PARTIALLY IMPLEMENTED | PDF Studio page, PDF utilities, shipment document and File Manager modules exist | `shipment_documents`, `file_assets`, `file_locations`, `file_manager_files` | Existing PDF utility tests; no end-to-end parent/child proof yet | Original file preservation and page-to-document lineage need proof | Trace actual page-grouping UI to persisted records and archive |
| DOC-02 | Telegram archive and File Manager transfer | PARTIALLY IMPLEMENTED | Existing archive API, idempotency helper, upload jobs, IndexedDB transfer | `file_assets`, `file_locations`, `file_transfer_jobs`, `file_manager_upload_jobs` | Unit coverage exists for utilities; full retry/ownership integration not proven | Do not add parallel storage or re-upload files unnecessarily | Verify mother/child file lineage, retry recovery and tenant ownership |
| SEC-01 | RLS, SECURITY DEFINER and tenant isolation | PARTIALLY IMPLEMENTED; security review required | Supabase security advisor on 2026-11-17 | 15 RLS-enabled/no-policy notices; 92 authenticated-callable SECURITY DEFINER findings; 1 public extension warning; leaked-password protection disabled | No complete tenant-isolation test matrix executed in this audit | Advisor findings require function-by-function authorization review; not all are necessarily exploitable | Prioritize exposed privileged functions and sensitive file/finance paths |
| CI-01 | CI test/type/lint/build on latest main | DONE & VERIFIED (latest run) | Run 44102021708 completed success | `.github/workflows/build.yml` | Unit tests, typecheck, lint, build succeeded; mobile smoke skipped | CI also deployed Worker automatically; production release boundary is not respected | Separate verification from deployment |
| CI-02 | Production readiness | BLOCKED | No release authorization requested or given | Main/Cloudflare production | No release regression or full manual acceptance | Production deployment and DB migration require explicit approval | Keep release disabled pending approval |

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
