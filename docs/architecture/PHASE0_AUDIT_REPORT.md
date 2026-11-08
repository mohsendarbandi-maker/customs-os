# Darbandi Commercial — Phase 0 Audit & Phase 1 Readiness Report

Audit date: 2026-11-09
Repository: `mohsendarbandi-maker/customs-os`
Working branch: `architecture/hybrid-p2p-offline`
Audited production project: `bjngfgiecvihofemptub` (EU West, PostgreSQL 17.6)
Scope: read-only repository, Supabase catalog, migrations, advisors, and Cloudflare Worker metadata. No production mutation performed.

## Executive status

- Phase 0: source and live-platform inventory substantially completed; migration and RLS/security findings require follow-up before implementation.
- Phase 1: BLOCKED. A recoverable backup and restore test could not be verified using the available connected interfaces. Staging creation is pending explicit cost approval.
- No P2P implementation is present yet. The architecture document is a proposal, not deployed functionality.
- Existing production Cloudflare Worker and Supabase database were not changed.

## Repository baseline

- Default branch: `main`; repository is public and connected GitHub permissions report admin/maintain/push.
- Dedicated branch exists: `architecture/hybrid-p2p-offline`.
- Branch head at audit: `b9b4186fb3a086ac0612e8c1e2fd1aa4e53ee369` (commit message: architecture proposal).
- Branch tree: 759 entries; React/Vite/TypeScript application, Supabase migrations/functions, Cloudflare Worker, tests and docs.
- package.json: React 18, Vite 6, TypeScript 5.2, Supabase JS 2.118, Vitest 1.2, Workbox PWA. Node engine >=22 <23.
- TypeScript currently has `strict: false`.
- No `src-tauri`, Rust peer daemon, SQLite runtime, mDNS/QUIC transport or device-to-device replication implementation found in the branch tree.
- Existing PWA/service worker and IndexedDB offline queue are not a substitute for a desktop P2P host.

## Existing offline behavior and modules

- `src/lib/offlineQueue.ts`: IndexedDB queue, session/user scoping and narrow RPC replay allowlist; not general offline CRUD or peer replication.
- `src/lib/supabase.ts`: Supabase client and restricted GET cache.
- `src/lib/fileManager.ts`: current File Manager workflows and file asset/location lookups.
- `src/lib/authStorage.ts`, `src/context/AuthContext.tsx`, `src/lib/deviceSessions.ts`: existing auth/session and device-session behavior. Preserve multi-device login.
- `src/components/CloudSyncStatus.tsx`, `OfflineQueueStatus.tsx`: existing cloud/offline status UI; these do not establish peer-sync status.
- `src/pages`: Dashboard, shipment/case/declaration, finance, registration orders, file manager, PDF Studio, maritime, office automation, reminders, CRM, settings and related workflows.
- Existing tests cover customs workflow, finance, sessions, PWA/offline queue, chat, file manager/Telegram archive, PDF Studio, security, reminders and mobile regression.
- `worker/index.ts` and `worker/supabaseAuthProxy.ts` provide the existing Cloudflare Worker/static assets and Supabase proxy path.
- Supabase Edge Functions in source: ai-assistant, ai-core, ai-operator, knowledge-ai, messenger-gateway, owner-console, scan-chat-file, send-chat-push, send-reminders.
- Live Edge Functions also include sync-vessel-ais, sync-vessel-ais-v2, vessel-multi-source, ai-voice and release-quarantined-chat-files. These live/source differences must be reconciled.

## Live Supabase baseline (read-only catalog)

- Project ACTIVE_HEALTHY; PostgreSQL 17.6.1.166; region eu-west-1.
- 132 public base tables; RLS enabled on all 132; 410 public policies.
- 402 public foreign keys; 224 non-internal triggers, none disabled.
- 280 routines across public/auth/storage; 158 SECURITY DEFINER in these schemas, 155 in public. Function inventory and privilege review required; do not blanket revoke because business workflows depend on guarded RPCs.
- 17 public tables have RLS enabled but no policies. Catalog ACL inspection shows these currently grant only postgres/service_role, including internal job/outbox/report/file metadata tables. Validate grants and intended server-only access in staging.
- Security advisor reports 93 SECURITY DEFINER routines callable by authenticated users, 17 RLS-enabled/no-policy tables, pg_net extension in public, and leaked-password protection disabled. These are findings to classify/review, not proof of an exploitable vulnerability. Remediation must be per-function with tests.
- Storage: 8 private buckets, 129 objects, approximately 238,475,399 bytes. Existing Storage paths and policies must be preserved.
- Storage buckets include case-documents, chat-files, customs_documents, customs_quarantine, customs-documents, customs-knowledge, finance-receipts and office-documents.
- Existing file-related tables include file_assets, file_locations, file_manager_files/folders, file_manager_upload_jobs, file_transfer_jobs, shipment_documents, shipment_files and chat_attachments. Several internal tables have service_role-only access/no direct user policies.
- Existing domain already has shipment/order reconciliation and `shipment_customs_data.sata_code`; the architecture must map to actual schema rather than recreate fields blindly.

## Migration drift — blocking issue

- Live migration history: 291 entries; latest version `20261108202141` (`file_manager_shipment_workflow_reports`).
- Branch contains 283 SQL files.
- 27 live migration versions are absent from this branch's migration filenames; 19 branch migration filenames are not present in live migration history. (Version matching performed by filename prefix.)
- Several differences relate to customs workflow rollback, finance archive/restore, Telegram/file-manager workflows, registration-order external allocations, and recent file-manager reports.
- Do not run `supabase db push`, rebase/reset, apply migrations or merge until exact migration drift is reconciled from canonical live definitions and the repository history is repaired in a non-production environment.

## Cloudflare baseline

- Connected Cloudflare account exposes Worker script `customs`.
- Latest observed deployment: 2026-11-08 20:58:03 UTC; 100% traffic on one version; 1,413 deployment records reported by API.
- Runtime settings: compatibility date 2026-09-26; ASSETS binding; Supabase URL and publishable key bindings; a secret-text binding named `SUPABASE_SECRET_KEY`.
- Secret value was not requested, retrieved, printed or copied. Keep privileged secrets server-side only; audit Worker source use and secret scope before any changes.
- wrangler.jsonc maps darbandicommercial.ir, chat, reminders and mobile subdomains to the Worker; preserve routes and bindings.
- No Worker deployment or secret mutation performed.

## Current branch and build verification

- GitHub Actions query for this branch returned zero workflow runs.
- Repository contains build.yml and verify-build.yml among other workflows, but no fresh passing run was verified in this audit.
- The connected GitHub fetch API allowed read/write repository operations; direct git clone/shell access from this execution environment failed due to DNS/network resolution. Therefore npm install, test, lint, typecheck and build were not executed here.
- Existing PHASE1_INVENTORY.md is explicitly a static inventory of an old 15-table schema and is not a valid live inventory.
- Existing PHASE1_VERIFICATION_STATUS.md already states no local shell, PostgreSQL execution, build, lint, test, RLS or trigger tests had been performed.

## Preliminary table-domain classification (not a replication allowlist)

| Domain | Candidate policy | Important constraints |
|---|---|---|
| organizations, profiles, user_device_sessions, org_connections | sensitive identity/control; limited device-scoped sync only | no bulk identity/session replication; revoke/expiry |
| registration_orders, shipments, cases, shipment_customs_data | cloud-synced business aggregates after domain adapter | strict conflict; base versions; order/shipment reconciliation |
| customs_declarations, customs_declaration_workflow | sensitive operational aggregates | approval/status transitions must remain command-validated |
| *_events, audit_logs, status/tracking histories | append-only event/history candidates | immutable; deduplicate; no overwrite |
| finance_* and financial_transactions | highly sensitive; initially cloud-only/read-only cache | no offline final posting without explicit accounting model |
| file_assets, file_locations, file_manager_* and document metadata | metadata sync candidate | preserve existing ACL, storage backend/path and Telegram archive |
| Storage object bytes | policy-driven content-addressed replication | SHA-256, chunk manifests, per-file ACL and retention |
| CRM, reminders, chat | per-feature policy; separate from customs aggregate replication | chat append-only; presence/push/voice are cloud-dependent |
| AI interactions, knowledge chunks, provider config, credentials/secrets | cloud-only or excluded | no provider secrets or vault values on peers |
| notifications, push subscriptions, webhooks, job queues, report runs | cloud-only/internal service state | do not replicate workers' transient jobs as business facts |
| reference tables (HS codes, customs offices, shipping lines, vessels) | read-only cache with versioned refresh | organization scope and source freshness |

This classification is a first-pass risk map, not a final per-table replication contract. Final inventory must be generated for all 132 tables, views, routines, policies, triggers and storage paths.

## Phase 1 readiness and blockers

1. Recoverable production backup: NOT VERIFIED. The connected tools exposed project metadata, migrations, catalog and advisors, but no backup inventory/download/restore verification action.
2. Schema and migration export: catalog and migration history read; a full portable schema dump plus canonical missing migration definitions has not been exported.
3. Staging: no staging branch/project created. Supabase quoted branch compute at $0.01344/hour (about $9.81 per 30-day continuous month). Explicit owner approval required before creating it.
4. Restore test: NOT RUN; no backup artifact or isolated restore target.
5. Baseline: project ID, region, Postgres version, live migration head, public table/policy/FK/trigger counts, Storage buckets/object count and Worker deployment metadata recorded here.
6. Rollback: retain current main/production cloud-only behavior; feature-flag desktop/P2P; do not delete outboxes or Storage objects; reverse only additive staging migrations with reviewed compensating migrations. Production rollback remains unapproved until backup/restore is proven.

## Required next actions

- Obtain explicit approval for staging cost: $0.01344/hour, approximately $9.81 per 30 days if continuously running.
- Obtain or create a Supabase-managed recoverable backup and test restore to an isolated environment; provide dashboard/backup access if not available through the current connector.
- Reconcile migration drift before any migration deployment.
- Run a complete static source scan for every Supabase `.from()`, `.rpc()`, `.storage`, Auth, Realtime, Functions and raw fetch endpoint; GitHub code-search API did not return usable code-search results in this connection.
- Review 93 SECURITY DEFINER advisor findings individually and 17 internal no-policy tables' ACLs; no bulk policy or grant change.
- Build the 132-table domain map with columns, FKs, triggers, policies, grants and data sensitivity; confirm business invariants against current live definitions.
- Only after Phase 1 gate passes, begin repository adapter contracts and desktop runtime behind disabled feature flags.

## Change log

- No production DB/schema/data/Auth changes.
- No Storage object changes.
- No Cloudflare Worker code, route, binding, secret or deployment changes.
- No GitHub default-branch changes.
- This report is the only Phase 0 audit artifact added to the dedicated architecture branch.
