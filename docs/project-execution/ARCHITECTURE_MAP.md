# Customs OS — Architecture Map (observed)

Audit base: `main@968c58f2624c04f53cc98f094be888cd7e74dc72`

## Runtime topology

- Browser application: React 18 + TypeScript + Vite.
- Data/API: Supabase JS 2.118.0, Supabase Auth, PostgREST, PostgreSQL 17.6, Supabase Edge Functions.
- Edge proxy and static assets: Cloudflare Worker `customs`, Wrangler configuration `wrangler.jsonc`.
- Document archive: Telegram integration through the existing messenger gateway; metadata in PostgreSQL.
- Client-side document transfer: IndexedDB utility `src/lib/appFileTransfer.ts`.

## Observed modules

- Customs declarations and workflow: `src/components/CustomsDeclarationWorkflow.tsx`, `src/lib/customsDeclarationWorkflow.ts`, `src/lib/customsWorkflowPatch.ts`.
- Pending operations: `src/pages/CustomsPendingReportPage.tsx`, `src/lib/customsPendingTasks.ts`, `supabase/functions/_shared/customsPendingTasks.ts`.
- Reminders: `src/features/reminders/*`, `src/pages/RemindersPage.tsx`, Edge Function `send-reminders`.
- Registration orders: `src/pages/RegistrationOrdersPage.tsx`, `src/lib/registrationOrderAllocations.ts`, `src/lib/registrationOrderLookup.ts`.
- Finance: `src/features/finance/*`, `src/pages/FinancePage.tsx`, `finance_cost_items`, `finance_payments`, invoices and allocations.
- PDF Studio: `src/pages/PdfStudioPage.tsx`, `src/lib/pdfStudioUtils.ts`.
- File Manager: `src/pages/FileManagerPage.tsx`, `src/lib/fileManager.ts`, `src/lib/appFileTransfer.ts`.
- Archive and extraction: `shipment_documents`, `file_assets`, `file_locations`, `file_transfer_jobs`, `file_manager_upload_jobs`, `extraction_jobs`; Edge Function `messenger-gateway`.
- AI: `ai-assistant`, `ai-core`, `ai-operator`, `knowledge-ai`.

## Current Source-of-Truth candidates (must be confirmed per field)

| Domain | Observed authoritative candidate | Avoid treating as authoritative |
|---|---|---|
| Organization and roles | `organizations`, `profiles`, membership/role helpers | Client-side profile metadata alone |
| Shipment identity | `shipments` | Display labels or copied form values |
| Customs declaration | `customs_declarations` | Workflow UI local state |
| Existing customs stage state | `customs_declaration_workflow` | Derived checklist display |
| Workflow audit | `customs_declaration_workflow_events` | Mutable current-state JSON alone |
| Reminders | `operational_reminders` | Duplicate reminder rows generated in reports |
| Finance costs | `finance_cost_items` | Duplicated cost entries in workflow JSON |
| Payments | `finance_payments` and allocation tables | Cost status inferred from UI |
| Registration order | `registration_orders` plus external allocation table | Repeated copied values on each shipment |
| File identity | `file_assets` | Telegram message ID as sole identity |
| External file locations | `file_locations` | Re-uploaded file copies |
| File Manager placement | `file_manager_files` and folders | Folder name parsing |
| PDF grouping | Not yet proven as persisted authoritative model | In-memory PDF page labels |

## Architectural gaps

1. Customs stage JSONB is atomically patched but is not a normalized independent activity entity.
2. Reminder and workflow entities are linked through generic entity fields; complete lifecycle synchronization needs explicit contracts.
3. PDF page groups and output documents need verified parent/child lineage persisted through file assets and File Manager.
4. Production CI deploys Cloudflare Worker on main push; verification and release must be separated.
5. SECURITY DEFINER and RLS advisor findings require a function-by-function authorization audit.
