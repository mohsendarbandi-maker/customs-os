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

## Next safety gate

Before any Staging D1 migration or Worker deployment, the owner must explicitly decide how the two production hostnames should be served. The current binding is inconsistent with the required isolation policy. Do not silently detach or rebind production hostnames as part of a Staging deployment workflow.
