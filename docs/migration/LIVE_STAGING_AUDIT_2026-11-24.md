# Customs OS — Live Staging Audit

Audit evidence collected: 2026-11-23 20:42 UTC  
Recorded on branch: `rebuild/cloudflare-free-first`  
Pull request: [#314](https://github.com/mohsendarbandi-maker/customs-os/pull/314)  
Read-only Staging diagnostics run: [45261792736](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45261792736)  
Read-only diagnostics job: `137998186126`

## Scope and safety

This report records the live, read-only Worker and D1 diagnostics and Cloudflare account API results collected by the Staging GitHub Actions workflow. It does not assert application-wide acceptance or migration completion.

No Cloudflare secret values were read or printed. No production route, DNS record, Worker setting, D1 row, D1 migration, or production data was changed. The workflow stopped before its D1 migration and Worker deployment steps.

## Cloudflare custom-domain bindings observed

The Cloudflare account API returned these enabled custom domains in the `production` environment:

| Hostname | Worker service |
|---|---|
| `darbandicommercial.ir` | `customs-os-migration-staging` |
| `mobile.darbandicommercial.ir` | `customs-os-migration-staging` |
| `chat.darbandicommercial.ir` | `customs` |
| `reminders.darbandicommercial.ir` | `customs` |

The zone Worker Routes API returned zero route entries. The Worker Domains API returned the four custom-domain bindings above.

This is a production-isolation blocker: the root and mobile hostnames are attached to the migration Staging Worker. The workflow intentionally refuses to run D1 migrations or deploy while this condition remains. No route or domain was changed during this audit.

The Worker Scripts API listed `customs`, `customs-os-migration-staging`, and `long-cell-b587`. The Staging Worker reported usage model `standard`; this report does not infer a billing tier or remaining quota from that field.

## Live D1 inventory

The Staging Worker `/migration/schema` endpoint reported 34 tables. 33 tables were countable, with 1,097 rows in the sum of those countable tables. One Cloudflare system table, `_cf_KV`, could not be counted; therefore 1,097 is not a claim that every physical row in the database has been counted.

| Table | Rows |
|---|---:|
| `_migration_chunk_checkpoint` | 0 |
| `_migration_manifest` | 1 |
| `_migration_table_state` | 0 |
| `cases` | 19 |
| `clients` | 7 |
| `customs_accounting_vouchers` | 2 |
| `customs_admin_credentials` | 0 |
| `customs_admin_login_attempts` | 0 |
| `customs_admin_sessions` | 2 |
| `customs_declarations` | 19 |
| `customs_documents` | 141 |
| `customs_offices` | 0 |
| `customs_os_import_table_status` | 26 |
| `customs_os_organization_imports` | 1 |
| `file_manager_files` | 89 |
| `file_manager_folders` | 208 |
| `finance_cost_categories` | 19 |
| `finance_cost_items` | 2 |
| `finance_org_settings` | 1 |
| `financial_transactions` | 6 |
| `organizations` | 1 |
| `profiles` | 1 |
| `registration_orders` | 3 |
| `shipment_customs_data` | 18 |
| `shipment_documents` | 90 |
| `shipments` | 22 |
| `shipping_lines` | 8 |
| `supabase_edge_function_archive` | 16 |
| `supabase_edge_function_file_archive` | 27 |
| `supabase_export_manifest` | 1 |
| `supabase_function_dependency_inventory` | 350 |
| `supabase_public_project_config` | 3 |
| `vessels` | 14 |

The `_cf_KV` row count was unavailable. It is excluded from the 1,097 countable-row sum.

## Import manifest and parity

The live `/migration/status` response reported:

- Source tables tracked: 26
- Tables imported: 17
- Tables empty in source: 9
- Expected source rows: 668
- Imported rows: 668
- Row-count parity: true
- Archived Edge Function records: 16

This confirms row-count parity for the imported set recorded in the current manifest. It does not establish authoritative source-schema parity, business-rule parity, or relational integrity.

The same response reported these remaining gates:

- Source PostgreSQL: `blocked_57P03`
- Authoritative schema export: `not_verified`
- Auth users and sessions: `not_imported`
- Storage objects: `not_imported`
- Edge Functions: `source_archived_not_ported`
- Production cutover: `blocked`

## Referential integrity

The live `/migration/integrity` endpoint returned:

- 34 relationship checks
- 0 failed SQL checks
- 155 orphan references
- 5 checks with orphan records
- 2 distinct orphan customs-office IDs
- Customs-office reference query: successful

The live `customs_offices` table contains zero rows. This is a known relationship-integrity defect and must be reconciled by a versioned, additive migration after the production-domain isolation issue is resolved. The existing migration source includes restoration of two referenced customs-office rows; its execution was not verified by this run.

## File and archive metadata

The `/migration/files` endpoint explicitly reported `binaryVerification: not_performed`.

| Source table | Total | Telegram path | Other path | Records with Telegram message/file-asset identifiers |
|---|---:|---:|---:|---:|
| `file_manager_files` | 89 | 75 | 14 | 84 |
| `customs_documents` | 141 | 73 | 68 | 84 |
| `shipment_documents` | 90 | 50 | 40 | 61 |

Storage-backend metadata further reported:

- `customs_documents`: 84 marked Telegram, 57 marked Supabase.
- `shipment_documents`: 61 marked Telegram, 29 marked Supabase.
- `file_manager_files`: 84 records have external-message IDs and file-asset IDs.

Identifiers, paths, metadata, and positive file sizes do not prove that file bytes can be downloaded and match the recorded size or checksum. No binary was verified in this run. The Telegram binary probe was skipped because the workflow stopped at the production-domain safety gate.

## CI and deployment result for the audited commit

For commit `6e79b697d32082ccb2d43cc9034079464ee08b8e`:

- Unit tests: passed
- TypeScript: passed
- ESLint: passed
- Frontend build: passed
- Staging Worker and D1 read-only diagnostics: passed as a diagnostic step
- Production-domain safety gate: failed intentionally because the root and mobile custom domains target the Staging Worker
- D1 migrations: skipped
- Staging Worker deployment: skipped
- Post-deploy D1 verification: skipped
- Telegram binary verification: skipped
- Worker secret-name inventory: skipped

The later `github-actions[bot]` commit `ad5a75036e6911f929763168e66c4bcfb8dae74b` only republishes generated `staging-dist/` assets from the audited code build. It does not indicate a Cloudflare Worker deployment.

## Source-level Supabase dependency status

The migration is not Supabase-independent yet. In particular:

- `src/context/AuthContext.tsx` still imports Supabase Auth and the Supabase client.
- `src/lib/supabase.ts` and `src/lib/edgeFunction.ts` remain part of the source runtime path.
- `package.json` still includes `@supabase/supabase-js` and a Supabase type-generation command.
- The production Worker source retains Supabase proxy/compatibility logic.
- Several Frontend domains still depend on Supabase tables, RPCs, Storage, Realtime, and Edge Functions without complete D1 replacements.

The Staging Worker currently has only a limited subset of domain APIs. A successful build or 668-row import is not evidence that all Frontend modules are operational on D1.

## Current production-domain recovery and remaining deployment gate

The root and mobile production domains were explicitly reassigned to the existing `customs` Worker through the controlled Cloudflare custom-domain API workflow. No DNS records, Worker script, production D1 database, or Production application data were changed by that operation.

A subsequent read-only Cloudflare API audit verified all four custom domains enabled on the existing `customs` Worker:

- `darbandicommercial.ir`
- `mobile.darbandicommercial.ir`
- `chat.darbandicommercial.ir`
- `reminders.darbandicommercial.ir`

All four hosts returned the current Customs OS HTML and the app JavaScript/CSS assets with HTTP 200. The post-cutover audit is recorded in GitHub Actions run [45270314080](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45270314080). This proves page/asset delivery, not a full interactive login or every business workflow.

The current `customs` Worker still has `ASSETS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SECRET_KEY` bindings. A runtime audit of the currently served JavaScript found the existing Supabase password-grant flow, not the D1 staging login endpoints. The production website therefore continues using its current Supabase-backed authentication path. The staging-only recovery gate is now restricted to `customs-os-migration-staging.*.workers.dev`.

The Staging D1 migration workflow is currently blocked before applying migrations because the Preview environment's `CLOUDFLARE_D1_API_TOKEN` resolves to an empty value. The existing Worker/domain API token successfully reads Worker settings and reassigns custom domains, but the D1 read-permission probe with that token returned HTTP 401 / Cloudflare error 10000. The D1-specific write token is deliberately separate from the Worker deployment token. Do not remove this gate or bypass the D1 migration step: migration `0005_auth_device_sessions.sql` adds columns used by the D1 session code, so deploying that code before applying the schema could break staging authentication.



## Additional Frontend dependency scan

The read-only static scanner ran as part of the same Staging workflow against 192 source files. It found 727 recognized literal callsites, with 91 files containing direct literal dependency references.

| Dependency type | Distinct literal references |
|---|---:|
| Supabase SDK imports | 1 |
| Database tables | 64 |
| RPC names | 76 |
| Edge Function slugs | 6 |
| Edge Function wrappers | 5 |
| Storage buckets | 4 |
| Realtime channels | 7 |
| Auth methods | 6 |
| Literal Supabase hosts | 0 |
| Supabase environment-variable names | 5 |

The scan itself made no network requests, read no environment-variable values, and printed no credential values. Zero literal Supabase host strings does not mean there are no runtime Supabase dependencies: the Frontend imports the SDK, the Worker reads its configured Supabase URL, and the scanner found 727 callsites across the categories above. This is a static inventory, not a proof of complete discovery of dynamic or indirect use.

The staging-only recovery-host helper now returns true only for `customs-os-migration-staging.*.workers.dev`. Production root/mobile domains therefore stay on the existing Worker/Supabase login flow until multi-user D1 Auth is complete. The currently served production JS was inspected read-only and contains the Supabase password-grant flow; a GET to `/api/auth/session` returned the SPA HTML fallback rather than a JSON session response, confirming that route is not the active production auth contract.

The live Staging D1 schema contains 34 tables and 1,097 countable rows (one system table count is unavailable). Auth-related inventory:

- `profiles`: 1 row
- `customs_admin_credentials`: 0 rows
- `customs_admin_sessions`: 2 rows

The Staging `profiles` table is not a migrated copy of all Supabase users, and its fixed owner/session model is not equivalent to the production roles and tenant-scoped access. Source PostgreSQL access remained blocked by `57P03` during the direct schema/user export attempt; no user records or password hashes have been imported. This is not yet a complete D1-backed multi-user authentication system.


## Additional work completed after the first audit

### Production domain restoration

- Root and mobile domains now target the original `customs` Worker.
- Chat and reminders remain on `customs`.
- Read-only post-cutover verification succeeded for the domain bindings and frontend static assets.
- The production Worker code and its current Supabase bindings were not redeployed or modified.

### First Supabase Edge Function port in the migration branch

The source for `vessel-multi-source` was retrieved from the live Supabase project (version 8). It reads VesselFinder, MyShipTracking, Maritime Optima, and MagicPort public pages and performs no Supabase table or RPC operations. A compatible Worker implementation now exists at:

- `worker/vessel-multi-source-api.ts`
- `worker/vessel-multi-source-api.test.ts`
- `worker/vessel-multi-source-route.test.ts`

The staging Worker branch registers `POST /functions/v1/vessel-multi-source`, verifies the same-origin D1 session cookie before making outbound provider requests, and returns no-store JSON. The existing Frontend SDK invocation path is compatible with same-origin Worker routing because production/staging hosts use their own origin as the Supabase-compatible API base. The function port is branch code only; it has not been deployed to the Staging Worker because the D1 migration gate is still blocked. The original 16 Supabase Edge Functions remain active in Supabase until each replacement is deployed and verified; this one port does not imply their removal.

### CI evidence

For branch commit `fe575093ace56ee1b4c41034295f476ca2d29186`, the following completed successfully:

- [Customs OS Build](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45273008375)
- [Chat and full verification](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45273021718)
- [Shipment Cost CI](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45273021634)
- [Independent shipment document metadata](https://github.com/mohsendarbandi-maker/customs-os/actions/runs/45273021590)

The matching Staging workflow passed its earlier tests and read-only D1 diagnostics, but stopped at `Apply versioned migrations to the isolated Staging D1` because `CLOUDFLARE_D1_API_TOKEN` was empty. No D1 migration or Worker deployment was performed by that run. The later `1e2120de` branch-head commit only published generated `staging-dist/` assets; it did not deploy the Worker.

### Current remaining migration gates

- Add a narrowly scoped Cloudflare D1 API token to the GitHub `Preview – customs-os` environment as `CLOUDFLARE_D1_API_TOKEN` with Account D1 Write permission. Do not send its value in chat.
- Restore/read the authoritative Supabase schema and user/session inventory once the source Postgres service accepts connections; the last direct read attempt was blocked by `57P03`.
- Design and verify D1 multi-user authentication, roles, tenant scoping, and session lifecycle. Do not enable the single-admin staging login on production domains.
- Reconcile 155 D1 orphan references, including the two missing customs-office IDs.
- Port and test the remaining active Edge Functions, Storage, Realtime, scheduled work, and all data APIs.
- Verify file bytes and checksums for both Telegram-backed and Supabase-backed objects.
- Keep Production cutover blocked until all parity, authorization, operational regression, and rollback gates pass.
