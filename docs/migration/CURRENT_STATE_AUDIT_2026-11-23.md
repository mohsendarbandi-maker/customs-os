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
- read-only D1 diagnostics: `/migration/schema` (SQLite table DDL + row counts), `/migration/parity` (import manifest vs actual table row counts), and `/migration/integrity` (34 hard-coded orphan-reference checks)
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
- `customs_offices` has zero exported rows, while 12 cases, 12 shipments, 12 `shipment_customs_data` rows, and 10 declarations contain a non-empty `customs_office_id` (**46 references in total**, using two distinct IDs). Those references cannot be verified against this export and must not be treated as valid until the customs-office source rows are recovered. `file_manager_folders` is absent from the JSON, so any folder-level customs-office references are additionally unobservable in this export.
- These checks are limited to non-null IDs and the tables present in this JSON. They are not a D1 foreign-key/integrity check.

### Document metadata is not file-content proof
The export contains 141 `customs_documents` and 90 `shipment_documents` rows (231 metadata rows total). The metadata identifies 145 rows as Telegram-backed and 86 as Supabase-backed. Telegram message/file identifiers and storage paths are only metadata: successful retrieval, byte-length verification, MIME verification, and checksum verification have not been performed. The 86 Supabase-backed references cannot be considered migrated file content.

### Sensitive material in source export
Some client `notes` fields contain credential-like plaintext. No such values are copied into this audit or repository. Treat the export as sensitive, restrict its circulation, rotate the affected external credentials, and remove plaintext secrets from business notes after establishing a secure credential-management process.

## Workflow and deployment observations
- `.github/workflows/deploy-cloudflare-staging.yml` builds the app, runs tests/typecheck/lint, uploads a short-lived artifact, and then requires the GitHub environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; it exits with an error if either is missing.
- That workflow still injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time. This is another indication that the existing Frontend bundle is still Supabase-configured.
- `verify-build.yml` currently runs PostgreSQL fixture/migration tests and a Wrangler dry run, but a dry run is not a deployed Worker API test. It also checks archived Supabase Deno functions.
- Staging Worker `customs-os-migration-staging` successfully deployed from commit `e4e639d81128c16db64b71fd3fb88f605855601b` in GitHub Actions run `45156784280`; Cloudflare reported version ID `987e72b9-450e-48d9-a09a-05f9d6062d66` and URL `https://customs-os-migration-staging.mohsen-darbandi.workers.dev`. The deployment log confirmed D1 binding `MIGRATION_DB`, Static Assets binding `ASSETS`, and staging flags `MIGRATION_ENVIRONMENT=staging`, `PRODUCTION_DATA_IMPORTED=false`.
- The same run passed Unit Tests, TypeScript, ESLint, Vite Build, asset upload, the Worker deployment step, a read-only GET diagnostic step through the Worker, and a Secret-name-only listing. The schema endpoint was required to return HTTP 200 with `.ok=true`. The diagnostic output was written to GitHub Step Summary, but the connected read-only GitHub interface did not expose the Step Summary values in the job log, so exact D1 table counts, parity totals, orphan totals, and file-metadata counts are not copied into this audit as verified numbers.
- Direct `wrangler d1 info` previously failed with Cloudflare API authentication error code `10000` because the GitHub Actions API token lacks D1 read permission. No token permissions or Secret values were changed. The read-only Worker diagnostics avoid that account-level D1 API permission.
- Secret names were listed successfully without values: `CUSTOMS_ADMIN_PASSWORD`, `GEMINI_API_KEY`, and `TELEGRAM_BOT_TOKEN`.

## Phase status from this audit
| Area | Status | Evidence / blocking condition |
|---|---|---|
| GitHub migration branch and PR isolation | COMPLETED | Branch exists; PR #314 remains open and unmerged |
| Frontend path inventory | PARTIAL | Tree-level file counts and route entry points recorded; every module's imports/query/RPC contract not yet exhaustively mapped |
| Historical Postgres schema inventory | PARTIAL | 294 migration files counted; current live catalog and full semantic port not verified |
| D1 operational schema | PARTIAL | Deployed Worker read-only `/migration/schema` returned `.ok=true`; exact table counts/DDL could not be captured from the Step Summary through the connected GitHub interface; checked-in D1 migration is still migration-control only |
| Operational data parity | BLOCKED / UNVERIFIED | The Worker successfully executed the read-only parity and integrity diagnostics, but their exact summary values were not available for this audit; attached export has 371 rows, File Manager tables absent, and 46 customs-office references cannot be resolved within the export |
| Independent backend API | NOT_STARTED | Staging Worker has only health/migration/auth bootstrap/preliminary AI endpoints |
| Independent authentication | PARTIAL | Single staging owner bootstrap only; no real D1 users/profiles and multi-device controls verified |
| File content migration | BLOCKED | Metadata only; Telegram retrieval and bytes/checksums not verified; Supabase-backed rows remain |
| AI + knowledge + AI Operator | PARTIAL | Preliminary Gemini endpoint; no D1 retrieval/persistence; `context_loaded=false` |
| Supabase execution dependency removal | NOT_STARTED | Frontend, production Worker, package and function compatibility paths still reference Supabase |
| Production cutover | NOT_STARTED (correctly isolated) | No Production changes were made |

## Required next verification gates
1. Capture the read-only D1 diagnostic Step Summary values (table counts, parity, integrity, and file metadata) from the next staging workflow run; the Worker endpoint itself has now been exercised successfully.
2. Reconcile the diagnostic counts against the complete source export and recover the missing File Manager export; take a D1 backup before any schema write.
3. Reconcile the JSON export against D1 and the missing File Manager export; do not import this JSON blindly or double-import its rows.
4. Verify real Telegram retrieval for representative old file IDs and verify bytes/checksums before marking any file recoverable.
5. Complete a full Frontend dependency inventory and map every old query/RPC/Function/Storage/Realtime call to a versioned Worker API contract.
6. Only then add an operational D1 migration and port a vertical slice with automated tests. Keep Production untouched and do not merge PR #314 without explicit authorization.

## Live Staging verification addendum — 2026-11-23 10:49 UTC
This addendum supersedes the earlier **unverified** D1 counts and the export-only estimate of broken customs-office references above. All figures below came from the deployed Worker’s read-only D1 diagnostics, not from assumptions or test fixtures.

### Deployed Staging revision and isolation
- Latest verified source application revision deployed by Workflow run `45159263529`: branch source commit `d296b5b9f4ef1c9e93204e27a35a36afcf3bf685` was not recorded here; the exact Worker version returned by Wrangler is `89b2df0e-5dc7-400e-a4fc-c76c488c5fd3`.
- Worker URL: `https://customs-os-migration-staging.mohsen-darbandi.workers.dev`.
- Wrangler uploaded 86 static assets (41 already uploaded), then deployed the Worker; reported startup time was 8 ms.
- The live `/health` response reports `environment=staging`, `database=d1`, `productionTraffic=false`, and `productionDataImported=false`.
- PR #314 is still open and unmerged. No `main` merge, Production Worker change, custom-domain route, DNS change, or Production data write was performed.
- An Actions-generated artifact-only commit `187c4495112674b43b34e27a35a36afcfaf20b30` subsequently advanced the PR head by publishing `staging-dist`; it does not represent an operational backend migration. Its PR check run returned `action_required` with no jobs reported by the read-only GitHub interface. The last source-code test/deploy run for revision `d296b5b9f4ef1c9e93204e27a35a36afcf3bf685` completed successfully.

### D1 import row-count parity — verified
The live `GET /migration/parity` result was:
- `ok=true`, `sourceTableCount=26`
- `expectedTotal=668`, `actualTotal=668`
- `missingTargets=8`, all `missingEmptySourceTables=8`
- `missingRequiredTargets=0`, `failedCounts=0`, `mismatchedTables=0`
- `rowCountParity=true`

All 17 source tables containing records matched their imported counts exactly. Nine source tables were empty; eight of those did not need a target table to be created. No imported rows were missing or duplicated according to these count checks. This verifies **row-count parity only**; it is not a byte-for-byte source checksum or a financial/weight aggregate comparison.

The live `/migration/schema` response lists 34 application/migration tables and 1,097 rows across those countable tables. The internal Cloudflare `_cf_KV` table was visible but its BLOB-backed row count was not queryable by this diagnostic, so it is excluded from 1,097. This count includes import-control/archive/staging-support rows in addition to the 668 imported business rows; do not interpret 1,097 as imported operational records.

### Referential integrity — verified with unresolved data defects
The live `GET /migration/integrity` result reports:
- 34 relation checks executed; `failedChecks=0`
- 29 checks have zero orphan rows.
- Five checks have orphan rows, totaling **155**.
- All 155 are references to `customs_offices`, whose D1 table currently has zero rows.
- Two distinct missing office IDs account for the orphans:
  - `3aa9da26-3ded-40e4-8772-51c5f4d8385b`: 103 references (8 cases, 8 shipments, 8 shipment-customs-data rows, 6 declarations, 73 File Manager folders).
  - `faa23eed-35f3-49e4-be70-7d880edf3f07`: 52 references (4 cases, 4 shipments, 4 shipment-customs-data rows, 4 declarations, 36 File Manager folders).

The earlier 46-reference figure applied only to tables present in the attached JSON export and did not include the 109 folder references because File Manager folders were absent from that export. The live D1 result is the authoritative current count. Neither missing office row has been fabricated or recreated.

### File archive metadata — verified; binary content still unverified
The live `GET /migration/files` and `GET /migration/file-metadata-keys` results report:
- File Manager: 89 rows; 84 have an external message ID, 84 have a `file_asset_id`, 75 have a `telegram://` path, and 14 paths classify as other.
- Customs documents: 141 rows; 84 are marked Telegram-backed (with Telegram message ID and file asset ID); 57 remain Supabase-backed. The path breakdown is 73 Telegram and 68 other.
- Shipment documents: 90 rows; 61 are marked Telegram-backed; 29 remain Supabase-backed. The path breakdown is 50 Telegram and 40 other.
- Metadata key names/counts show `telegramFileId`, `telegramFileUniqueId`, `telegramChatId`, and `telegramMessageId` present on 84 File Manager records. The diagnostic returned key names and counts only; it did not expose identifier values.

The mismatches between Telegram backend flags and Telegram path classifications (11 Customs documents and 11 Shipment documents) remain unresolved metadata cases. **No binary was marked recovered**: actual retrieval, downloaded-byte length, MIME validation, and content checksum against a trusted source remain unverified.

### Bounded Telegram binary probe
- The migration Worker now contains `POST /api/admin/migration/telegram-probe`. It requires same-origin and a valid Staging admin session, selects one smallest eligible Telegram-backed File Manager record up to 8 MiB, downloads in memory with a 15-second timeout, computes SHA-256 in memory, and returns only byte-size comparisons and booleans. It does not store or return file bytes or identifiers.
- The Staging Workspace includes a one-shot button visible only to the Staging `owner` role. After one attempt it disables itself for that page session.
- The latest successful deployment includes this UI and Worker route. The automated GitHub Actions probe was **skipped**, not executed, because `CUSTOMS_ADMIN_PASSWORD` is not configured in the GitHub Preview Environment. The Worker Secret name exists, and the Worker’s Telegram bot token Secret name exists; no Secret value was read or printed.
- Therefore the next binary verification action must be initiated by an authenticated Staging owner in the Staging Workspace. Until that one-shot action returns a successful download and size comparison, old Telegram metadata must not be counted as recovered file content.

### CI, cost and security observations
- The Staging deploy run `45159263529` completed successfully: Unit Tests, TypeScript, ESLint, Vite Build, asset upload, Wrangler deployment, read-only Worker diagnostics, and Secret-name-only listing all succeeded.
- The GitHub Actions control-plane command `wrangler d1 info` still fails with Cloudflare API error `10000` because the connected deploy token lacks D1 read permission. The workflow marks this optional diagnostic non-blocking; it does not alter D1. D1 database size/quota therefore remains unverified.
- Secret names observed without values: `CUSTOMS_ADMIN_PASSWORD`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`.
- No paid add-on or paid Worker plan was enabled by these changes.

### Updated phase status
| Area | Updated status | Evidence / remaining condition |
|---|---|---|
| GitHub branch / PR isolation | COMPLETED | PR #314 remains open and unmerged; changes stayed on the migration branch |
| Static Frontend dependency map | PARTIAL | Critical modules mapped; full dynamic/import-based scan and all callsites not certified exhaustive |
| D1 imported row-count parity | COMPLETED | 668/668 rows across 17 populated source tables; 8 missing targets are empty-source tables |
| D1 referential integrity | PARTIAL / BLOCKED | 29/34 checks clean; 155 orphan references to 2 missing customs-office IDs |
| D1 quota/capacity verification | BLOCKED | Wrangler control-plane read fails with error 10000; no DB size result |
| Independent operational API | NOT_STARTED | Health/migration/auth bootstrap/diagnostics only; no full operational CRUD surface |
| Authentication | PARTIAL | Single Staging admin session only; real multi-user Auth and device-session parity absent |
| Telegram metadata migration | PARTIAL | Telegram IDs and metadata keys present; 11+11 backend/path mismatches require review |
| Telegram binary retrieval | BLOCKED / NOT_VERIFIED | One-shot owner probe deployed, but automated probe skipped due missing GitHub Preview admin password; no binary yet verified |
| Supabase execution dependency removal | NOT_STARTED | Frontend, legacy production Worker, package and function compatibility paths still depend on Supabase |
| AI + knowledge + AI Operator | PARTIAL | Preliminary Gemini endpoint only; no D1 retrieval, evidence persistence, knowledge integration, or guarded operator parity |
| Production cutover | NOT_STARTED (correctly isolated) | No Production route, DNS, Worker, or data mutation |

