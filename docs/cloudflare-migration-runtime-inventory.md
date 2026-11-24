# Customs OS — Cloudflare migration runtime dependency inventory

Evidence date: 2026-11-25
Source revision: 71f03bf63ad743eb4c649340f9eb1802504927f3
Method: read-only scanner, GitHub Actions run 45505899105.
Full machine-readable report: artifact customs-os-read-only-runtime-inventory (7-day retention).

## Executive result

The source tree is not ready for a Supabase-free production cutover.

| Measure | Static result |
|---|---:|
| Source files scanned (src/, worker/) | 204 |
| Files containing recognized dependencies | 90 |
| Recognized callsites | 727 |
| Distinct table names | 64 |
| Distinct RPC names | 76 |
| Edge Function names | 6 |
| Edge Function wrapper names | 5 |
| Storage bucket names | 4 |
| Realtime channel patterns | 7 |
| Auth method names | 6 |
| Supabase environment-variable names | 5 |
| Literal Supabase host references | 0 |

Static scan is not runtime telemetry. It can miss dynamically assembled names, indirect calls, generated code and dependencies outside src/ and worker/. Zero literal host references does not mean there are no Supabase requests: the production Worker still contains a proxy path and the frontend still has Supabase client usage.

## Functional migration matrix

| Area | Source evidence | Current Cloudflare/D1 evidence | Required work |
|---|---|---|---|
| Authentication | AuthContext, LoginPage, session lifecycle/management; six auth methods | Single-admin D1 login/session works on isolated staging; production Worker still uses legacy auth path | Wire production UI to D1 only after APIs are integrated; secure password/session lifecycle, logout, expiry, device management and origin/CSRF controls; keep exactly one admin |
| Shipment-first / operations | ShipmentFirstPage, OperationsPage, CaseOperationsPage; shipments, cases, clients, registration orders and workflow RPCs | D1 shipments, clients and registration-order APIs exist; cases API is read-only | Implement missing case/workflow/declaration/checklist/exit APIs and integrate without changing ShipmentFirst → PreDeclaration → Declaration → Checklist → Exit |
| Declarations and exit | PreDeclarationPage, DeclarationRegistrationPage, DeclarationOperationsChecklistPage, ExitPage and workflow components | End-to-end D1 parity not demonstrated | Port declaration, checklist, permits, ship-pass and exit transitions with transaction and authorization tests |
| File manager and documents | File Manager, document managers, PDF Studio, extraction pages; four buckets | D1 metadata partial; binary recovery/transfer not proven | Port metadata CRUD/search and binary upload/download/delete to Cloudflare storage; verify checksums, ownership, permissions, large-file retry and rollback |
| Chat and voice | src/features/chat; 22 distinct chat RPCs, attachments, voice calls and realtime patterns | No complete Cloudflare replacement demonstrated | Implement two-way messaging, receipts, reactions, pins, search, attachments, voice and push; replace realtime with explicit Worker/WebSocket or polling design |
| Finance | FinancePage, shipment costs, vouchers, payment requests; finance tables and RPCs | No complete D1 finance API parity demonstrated | Port financial workflows, permissions, invoices, receipts, vouchers, ledgers and print data; test totals and auditability |
| Reminders and notifications | Reminders pages/core/push; realtime and push RPCs | No complete D1 parity demonstrated | Port CRUD, completion, due precision, Jalali display data, push subscriptions and delivery; retain idempotency |
| AI and knowledge | AI workspace, Knowledge Center, PDF extraction; six Edge Functions plus wrappers | No complete Cloudflare AI/knowledge replacement demonstrated | Port function contracts, authorization, file access, model fallback, extraction state and error handling |
| Maritime and vessels | Maritime, vessel search/tracking, AIS pages | One maritime API family partially exists; external vessel/function parity not proven | Port shipping-line/contact/vessel CRUD, tracking, AIS and external-provider calls through Worker |
| Organization, settings and access | Settings, profiles, organization, permissions, integrations | Not fully ported | Port organization settings, role enforcement, profile and permission administration; enforce single-admin policy |

## Confirmed partial D1 APIs reviewed separately

- Shipments: collection/detail reads and create/update operations exist.
- Clients: CRUD API exists.
- Cases: read-only API only; stage transitions/workflow readiness are explicitly not included.
- Registration orders: read/create/update and external allocation operations exist, including capacity constraints.
- Authentication: staging single-admin session exists; it is not proof of production auth cutover.

Presence of these endpoints does not establish that existing React pages call them or that their data/authorization semantics match every workflow.

## Required execution order

1. Freeze production cutover. Do not change production Worker routes, production auth host switch, or remove the legacy proxy while any feature still depends on it.
2. Build an API contract map. For each table/RPC/Edge Function/bucket/realtime pattern, record calling page, request/response schema, role checks, organization scope, transaction boundaries and D1/R2/Worker replacement.
3. Complete operational APIs first. Cases, declarations, checklists, permits, workflow events and exit must be complete before wiring /operations.
4. Integrate the existing UI. Replace Supabase calls in-place; do not create parallel pages/modules. Keep /operations behavior and data ownership unchanged.
5. Port files and chat. Validate binary integrity and permissions, then all chat/voice/realtime behavior.
6. Port finance, reminders, AI/knowledge, maritime and settings.
7. Run staging regression gates: unit/typecheck/lint/build, D1 migrations, authorization-equivalent tests, operational lifecycle tests, binary tests, session tests and mobile smoke tests.
8. Verify data completeness. Existing snapshot is incomplete; no full schema/auth/session/storage/realtime/Edge Function parity has been established. Reconcile every source table and binary before cutover.
9. Production cutover only after explicit approval, with one controlled release, rollback plan and post-deploy verification.

## Safety and scope

The scanner and workflow log networkAccess=false, environmentVariablesRead=false and credentialValuesPrinted=false. The workflow has read-only repository permissions and no deployment or database steps. No Supabase connection was made; no production configuration or data was changed.

## Limitations

- Static counts are distinct literal references by category, not API endpoint counts or runtime request volume.
- Edge Function wrappers can overlap with direct function calls; do not add those categories as independent functions.
- Dynamic table/RPC/bucket/channel names may be missed.
- This is a migration inventory, not a claim of feature parity or cutover readiness.

## Deep contract finding: case management is not yet portable

A direct comparison of `src/pages/CaseOperationsPage.tsx` with `worker/cases-api.ts` and `worker/cases-api.test.ts` shows a concrete contract gap:

| Existing case page operation | Existing source contract | Current D1 case API |
|---|---|---|
| Case list | `case_display_context` view | `GET /api/cases` returns a narrower `cases` + `clients` projection |
| Case detail fields | Includes `warehouse_receipt_no`, `release_status`, `valuation_status`, shipment-derived display fields | These three columns exist in the staging `cases` table but are absent from the D1 `CaseRecord` projection |
| Linked documents | `customs_documents` | D1 returns a limited customs-document projection |
| Declaration | Latest `customs_declarations` row | D1 returns declaration rows, but response shape is not yet proven identical |
| Permits | Legacy page queries `permits` | No `permits` table exists in the inspected staging D1 schema; no D1 equivalent is demonstrated |
| Exit operations | Legacy page queries `case_exit_operations` | No `case_exit_operations` table exists in the inspected staging D1 schema; no D1 equivalent is demonstrated |
| Readiness | `get_case_completion_readiness(p_case_id)` RPC | No D1 replacement demonstrated |
| Edit case | `UPDATE cases` with case number, order/proforma, cargo, weight, warehouse receipt, release and valuation fields | D1 API deliberately rejects PATCH with HTTP 405 |
| Delete case | `delete_case_safely(p_case_id)` RPC | No D1 safe-delete equivalent demonstrated |

The existing D1 test explicitly asserts that PATCH returns 405 and executes no SQL. This is intentional fail-closed behavior, not a working edit feature.

### Verified staging D1 schema evidence (2026-11-24)

The isolated read-only schema workflow completed successfully:

- Workflow run: 45506810361 — `Customs OS Staging D1 Schema Inventory`, conclusion `success`.
- Artifact: `customs-os-staging-d1-schema`, artifact ID 14971529607, SHA-256 `66b6bc91d9e0bd4639e1bc68272d6439e8717ad967b09f5245f11a86a4e41cb1`.
- Database identity in response: `customs-os-migration-staging`.
- SQLite schema inspection found 45 tables and 2,084 counted rows; one count failed for Cloudflare's internal `_cf_KV` table. Therefore 44 table counts were verified; 2,084 is the sum of successful counts, not a guaranteed complete physical total.
- The schema artifact contains DDL and aggregate counts only; no row contents were queried.

Relevant verified table facts:

| D1 table | Rows | Verified fields / notes |
|---|---:|---|
| `cases` | 19 | Includes `warehouse_receipt_no`, `warehouse_receipt_date`, `release_status`, `valuation_status`, `cargo_count`, `cargo_description`, `net_weight_kg`, `gross_weight_kg`, `display_name`, `customs_regime` |
| `customs_declarations` | 19 | Includes `case_id`, `shipment_id`, `kottaj_number`, `declaration_date`, `workflow_stage`, `customs_regime`, declaration file metadata |
| `customs_documents` | 141 | Includes `case_id`, `shipment_id`, document metadata, archive state, storage backend, file asset and Telegram message references |
| `customs_offices` | 2 | Reference rows exist in staging |
| `shipments` | 22 | Includes `case_id`, release and ship-pass fields, shipment state and customs-office references |
| `customs_os_audit_events` | 0 | Audit table exists, but it is currently empty |
| `profiles` | 1 | One staging profile row |
| `organizations` | 1 | One staging organization row |
| `file_manager_folders` | 208 | Folder metadata rows exist |
| `file_manager_files` | 89 | File metadata rows exist; this does not prove binary availability |

No table named `permits` or `case_exit_operations` appears in the 45-table schema inventory. The source frontend's dependencies therefore cannot be satisfied by assuming those legacy tables were imported under the same names. Their data model and lifecycle must be mapped to existing D1 structures or deliberately redesigned with explicit business-rule approval.

### Safe implementation sequence for case parity

1. Use the captured staging D1 schema as the authoritative description of the current staging database only. It is not a complete source-schema export and does not prove production data parity.
2. Extend the D1 case read projection with the verified warehouse receipt, release and valuation columns, preserving organization scope and existing API response compatibility.
3. Map permits and exit-operation data from the original checked-in SQL/function definitions and actual source-page behavior. Do not create placeholder tables or infer replacement business rules.
4. Implement audited case PATCH with an explicit allowlist, numeric/date validation, same-origin protection, tenant scoping, and atomic audit insertion. Preserve status/workflow fields as immutable until the workflow API exists.
5. Implement safe delete only after checking every foreign-key/dependency table and porting the source RPC's exact business rules. Do not substitute a generic DELETE.
6. Port readiness calculation only after its source RPC definition and all required inputs are understood.
7. Replace the existing page's Supabase reads/writes in-place and add regression tests for each field and action. Do not switch the whole app auth host before this and other module contracts pass.

No case API code was changed as part of this audit because permit/exit contracts, source delete/readiness rules, and complete dependency semantics are still unverified.

## Deep contract finding: operational lifecycle still calls legacy tables and RPCs

A source-level scan of the four primary operational pages shows these exact contracts:

| Existing page | Direct table/view dependencies | RPC dependencies |
|---|---|---|
| `ShipmentFirstPage.tsx` | shipment_documents, clients, shipments, vessels, shipping_lines, registration_orders, cases, customs_offices, shipment_document_extractions, file_manager_files | create_case_workflow, link_shipment_to_case, set_shipment_tracking_status, set_shipment_ship_pass |
| `OperationsPage.tsx` | clients, cases, shipments, registration_orders, documents, permits | create_case_workflow, attach_registration_order, update_case_operational_data, update_shipment_maritime_data, calculate_case_valuation, register_declaration_workflow, delete_case_workflow |
| `DeclarationRegistrationPage.tsx` | shipments, customs_declarations, shipment_customs_data, customs_offices, customs_documents | register_shipment_declaration, set_declaration_file, initialize_declaration_checklist |
| `ExitPage.tsx` | shipment_customs_data | update_declaration_checklist_item, complete_customs_declaration_exit |

The existing `worker/shipments-api.ts` is not a substitute for these workflows: its collection/detail/create/update operations do not by themselves prove shipment-document extraction, case linking, tracking transitions, ship-pass, declaration registration, checklist initialization, or exit completion parity.

### Operational porting gates

- Build an explicit request/response contract for each listed RPC from the checked-in source migrations/functions and its current UI caller.
- Implement each contract as a D1 Worker operation with organization scoping, role authorization, input validation, audit history and atomic writes.
- For shipment/case/order links, verify cross-organization and cross-company allocation rules; never trust a client-supplied organization ID.
- Keep declaration registration and exit as guarded state transitions. Reject out-of-order transitions and duplicate completion; do not emulate them with unguarded row updates.
- Replace each caller in-place and test the complete ShipmentFirst → PreDeclaration → Declaration → Checklist → Exit path against staging data.
- Do not change `/operations` to use D1 until every operation it invokes has a tested D1 equivalent.

This page-level dependency inventory is based on the actual TypeScript source files on `main`; it is not evidence that the D1 APIs are wired into those pages.


## Case API read-projection implementation (PR317)

The D1 case read API now selects and returns the following fields that were verified in the captured staging schema and were previously omitted from `CaseRecord`:

- `warehouse_receipt_no`
- `warehouse_receipt_date`
- `release_status`
- `valuation_status`
- `unloading_date`
- `vessel_type`
- `customs_regime`

Both collection and detail queries share the same explicit projection. Existing organization-scoped predicates remain unchanged. Tests were extended to assert these values are present in list and detail responses. This is a read-only additive API change; PATCH/POST/DELETE remain rejected with HTTP 405. The existing React page has not yet been switched to this API, and no production or staging deployment was performed for this code change.

CI for the latest commit is still running at the time of this documentation update; do not treat the added tests as passed until the corresponding workflow run completes successfully.
