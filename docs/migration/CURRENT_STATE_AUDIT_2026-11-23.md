# Customs OS — Current-State Migration Audit
Date: 2026-11-23
Branch: `rebuild/cloudflare-free-first`
Pull request: #314 (open; not merged)
Audited HEAD: `b5637087e827e818408abaf30778275644d2655c`

## Scope and safety
This is a source-and-export audit, not a live Cloudflare/D1 verification. The GitHub repository, PR metadata, branch tree, selected source files, migration configuration, workflow definitions, and the attached organization JSON export were inspected. No Cloudflare resource, D1 row, Production route, DNS record, Supabase database, or secret value was changed or read. No deployment was started by this audit.

The Cloudflare dashboard session was not yet available to the connected browser profile at audit time. Therefore Worker settings, current D1 schema/counts, deployed revision, and Secret presence remain **unverified live facts**, even where repository configuration describes them.

## GitHub state
- Repository: `mohsendarbandi-maker/customs-os` (default branch `main`).
- Migration branch exists: `rebuild/cloudflare-free-first`.
- PR #314 is open, targets `main`, and is not merged.
- PR head at audit time: `b5637087e827e818408abaf30778275644d2655c`.
- The PR describes the Cloudflare work as an isolated staging foundation and explicitly states that source archive preservation is not equivalent to porting functions or migrating PostgreSQL/Auth/Storage data.
- The latest observed PR workflow run was `45149625383`, workflow `verify-chat-modern-final`, conclusion `action_required`. Its Actions jobs endpoint returned zero jobs. It is not evidence of a successful build/test run. Earlier successful runs quoted in the PR description are historical and do not prove the current HEAD.

## Frontend source inventory (tree-level)
The audited branch tree contains:
- 59 files under `src/pages`
- 30 files under `src/components`
- 2 context files under `src/context`
- 2 hook files under `src/hooks`
- 70 files under `src/lib`
- 294 SQL migration files under `supabase/migrations`
- 3 Worker source files: `worker/index.ts`, `worker/migration-staging.ts`, and `worker/supabaseAuthProxy.ts`

The application route map in `src/App.tsx` includes operational areas for clients, cases, registration orders, shipments/operations, declarations, finance, customs offices, maritime, reminders, documents, File Manager, PDF Studio, knowledge, chat, messenger integrations, reports, and settings. This inventory is a path/entry-point inventory; the full per-page query/RPC dependency map still requires systematic analysis of every page and imported data module.

The existing `PHASE1_INVENTORY.md` is explicitly a **static** inventory based on the first ten historical SQL migrations. It is not the live PostgreSQL catalog and is not a complete inventory of all 294 migration files. `PHASE1_VERIFICATION_STATUS.md` correctly says Phase 1 was not ready because local commands and live database/RLS/trigger verification had not been completed.

## Supabase execution dependencies still present
Source inspection confirms the migration is not yet independent:
- `src/context/AuthContext.tsx` imports `@supabase/supabase-js` and the `supabase` client.
- `src/lib/edgeFunction.ts` obtains the Supabase session, constructs Supabase Functions endpoints, and uses the legacy Supabase API contract.
- `src/lib/supabase.ts` constructs the Supabase client and configures auth/session storage and a PostgREST cache layer.
- `package.json` still depends on `@supabase/supabase-js` and retains a Supabase type-generation command.
- The production Worker source `worker/index.ts` still contains Supabase URL/secret/anon bindings and compatibility routes for Auth, REST, Storage, Realtime, and Edge Functions.

The above files may remain as migration-era code until a replacement is complete, but they are active execution dependencies and cannot be considered removed.

## Current staging Worker implementation
`wrangler.migration-staging.jsonc` defines:
- Worker name `customs-os-migration-staging`
- D1 binding `MIGRATION_DB`
- Static Assets binding `ASSETS`
- staging flags `MIGRATION_ENVIRONMENT=staging` and `PRODUCTION_DATA_IMPORTED=false`
- assets directory `./dist`
- no Production domain route in this config

The staging Worker source `worker/migration-staging.ts` currently exposes:
- `/health`, `/health/db`
- read-only D1 diagnostics: `/migration/schema` (SQLite table DDL + row counts), `/migration/parity` (import manifest vs actual table row counts), and `/migration/integrity` (33 hard-coded orphan-reference checks)
- migration/archive diagnostics: `/migration/status`, `/migration/functions`
- staging bootstrap auth: `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`
- a preliminary Gemini endpoint at `/api/ai` and compatibility path at `/functions/v1/ai-assistant`

The migration diagnostic endpoints are GET/HEAD-only and execute fixed SQL plus quoted table identifiers originating from `sqlite_master` or the import manifest; they do not accept caller-provided SQL. The current automated test asserts their source structure and read-only intent, but it does not execute them against the live D1 database.

The Worker does **not** yet expose operational CRUD/API replacements for clients, cases, shipments, declarations, registration orders, finance, File Manager, document assets, knowledge, maritime, reminders, chat, or messenger connectors. Requests to legacy Supabase-compatible paths (`/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`, `/realtime/v1`) are explicitly returned as `503 BACKEND_MIGRATION_PENDING`; this is an honest staging boundary, not API parity.

The staging authentication source currently identifies a single hard-coded staging owner profile, uses a 12-hour session lifetime, and stores hashed session tokens in D1. This is a staging bootstrap, not the required multi-user identity/profile/role/device-session implementation.

The Gemini handler currently reports `context_loaded: false`. The inspected implementation does not persist document extraction results to D1, does not connect retrieval to the knowledge repository, and does not implement a guarded AI Operator workflow. The staging Worker type/config inspected here does not wire a Telegram Bot token or Telegram archive endpoints.

## D1 schema and migration gap
The only SQL file under `supabase/migrations-cloudflare` in the audited tree is `0001_migration_control.sql`. It creates the migration-control tables:
- `_migration_manifest`
- `_migration_table_state`
- `_migration_chunk_checkpoint`

It explicitly documents that it is **not** the operational Customs OS schema and contains no production data. The 294 PostgreSQL migrations under `supabase/migrations` are not automatically D1-compatible; RLS, functions, triggers, types, and PostgreSQL-specific features require a deliberate SQLite/D1 port.

The staging Worker queries additional migration/import/archive/session tables. Their live presence and row counts cannot be certified from this source file alone; the live D1 catalog must be read through the authenticated Cloudflare account before further D1 changes.

## Attached organization export audit
The attached JSON export reports schema version 1 and contains 24 table arrays with **371 records in total**. Table counts:

| Table | Exported rows |
|---|---:|
| clients | 7 |
| shipments | 22 |
| shipment_customs_data | 18 |
| cases | 19 |
| vessels | 14 |
| shipping_lines | 8 |
| customs_offices | 0 |
| registration_orders | 3 |
| customs_declarations | 19 |
| financial_transactions | 6 |
| customs_documents | 141 |
| shipment_documents | 90 |
| customs_accounting_vouchers | 2 |
| finance_cost_categories | 19 |
| finance_cost_items | 2 |
| finance_org_settings | 1 |
| finance_invoice_lines | 0 |
| finance_invoice_shipments | 0 |
| finance_invoices | 0 |
| finance_payment_allocations | 0 |
| finance_payment_request_lines | 0 |
| finance_payment_requests | 0 |
| finance_payments | 0 |
| petty_cash_ledger | 0 |
| **Total** | **371** |

The file does not contain `file_manager_folders` or `file_manager_files`. The stated reference counts for those tables (208 + 89 = 297) are therefore not represented in this attachment. This explains the 297-row difference between 371 rows in this export and the 668-row reference total, but it does not establish whether those records are present in live D1.

### Export relationship checks
Within this JSON export:
- Case-to-client references, shipment-to-case/client/vessel/registration-order references, shipment-customs-data-to-shipment references, declaration-to-shipment/case references, and the inspected document-to-client/case/shipment references resolve against the corresponding exported ID sets.
- `customs_offices` has zero exported rows, while 12 cases, 12 shipments, and 10 declarations contain a non-empty `customs_office_id` (34 references in total, using two distinct IDs). Those references cannot be verified against this export and must not be treated as valid until the customs-office source rows are recovered.
- These checks are limited to non-null IDs and the tables present in this JSON. They are not a D1 foreign-key/integrity check.

### Document metadata is not file-content proof
The export contains 141 `customs_documents` and 90 `shipment_documents` rows (231 metadata rows total). The metadata identifies 145 rows as Telegram-backed and 86 as Supabase-backed. Telegram message/file identifiers and storage paths are only metadata: successful retrieval, byte-length verification, MIME verification, and checksum verification have not been performed. The 86 Supabase-backed references cannot be considered migrated file content.

### Sensitive material in source export
Some client `notes` fields contain credential-like plaintext. No such values are copied into this audit or repository. Treat the export as sensitive, restrict its circulation, rotate the affected external credentials, and remove plaintext secrets from business notes after establishing a secure credential-management process.

## Workflow and deployment observations
- `.github/workflows/deploy-cloudflare-staging.yml` builds the app, runs tests/typecheck/lint, uploads a short-lived artifact, and then requires the GitHub environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; it exits with an error if either is missing.
- That workflow still injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time. This is another indication that the existing Frontend bundle is still Supabase-configured.
- `verify-build.yml` currently runs PostgreSQL fixture/migration tests and a Wrangler dry run, but a dry run is not a deployed Worker API test. It also checks archived Supabase Deno functions.
- The latest observed run `45149625383` has `action_required` and zero reported jobs; no new successful CI result is recorded by this audit.

## Phase status from this audit
| Area | Status | Evidence / blocking condition |
|---|---|---|
| GitHub migration branch and PR isolation | COMPLETED | Branch exists; PR #314 remains open and unmerged |
| Frontend path inventory | PARTIAL | Tree-level file counts and route entry points recorded; every module's imports/query/RPC contract not yet exhaustively mapped |
| Historical Postgres schema inventory | PARTIAL | 294 migration files counted; current live catalog and full semantic port not verified |
| D1 operational schema | NOT_STARTED / UNVERIFIED | Cloudflare D1 schema was not read live; checked-in D1 migration is migration-control only |
| Operational data parity | BLOCKED | Attached export has 371 rows; File Manager tables absent; customs-office references unresolved; live D1 counts inaccessible |
| Independent backend API | NOT_STARTED | Staging Worker has only health/migration/auth bootstrap/preliminary AI endpoints |
| Independent authentication | PARTIAL | Single staging owner bootstrap only; no real D1 users/profiles and multi-device controls verified |
| File content migration | BLOCKED | Metadata only; Telegram retrieval and bytes/checksums not verified; Supabase-backed rows remain |
| AI + knowledge + AI Operator | PARTIAL | Preliminary Gemini endpoint; no D1 retrieval/persistence; `context_loaded=false` |
| Supabase execution dependency removal | NOT_STARTED | Frontend, production Worker, package and function compatibility paths still reference Supabase |
| Production cutover | NOT_STARTED (correctly isolated) | No Production changes were made |

## Required next verification gates
1. Read Cloudflare account state and Worker bindings without exposing Secret values.
2. Read-only query the actual staging D1 schema, migration manifest, imported table states, exact row counts, and referential checks. Take a D1 backup before any schema write.
3. Reconcile the JSON export against D1 and the missing File Manager export; do not import this JSON blindly or double-import its rows.
4. Verify real Telegram retrieval for representative old file IDs and verify bytes/checksums before marking any file recoverable.
5. Complete a full Frontend dependency inventory and map every old query/RPC/Function/Storage/Realtime call to a versioned Worker API contract.
6. Only then add an operational D1 migration and port a vertical slice with automated tests. Keep Production untouched and do not merge PR #314 without explicit authorization.
