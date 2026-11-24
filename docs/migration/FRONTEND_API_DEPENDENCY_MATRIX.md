# Customs OS — Frontend API Dependency Matrix
Audit date: 2026-11-23
Source branch: `rebuild/cloudflare-free-first`
Source HEAD reviewed: `c47d4a59d1304a4cc2d4e31d21affe2e30c55cb6`

## Method and limits
This is a **static source dependency scan** of selected critical vertical slices and their data modules. It records literal Supabase table/RPC/storage/channel names found in the source. It does not include dynamically constructed names, every imported hook/helper, or every page in `src/pages`; therefore it is a high-confidence partial map, not a certified exhaustive inventory. No Supabase request was made during this scan.

The map is intended to prevent blind endpoint creation: each listed database operation must be replaced with equivalent D1 semantics, validation, tenant scoping, permissions, audit behavior, and transaction boundaries. A PostgreSQL RPC is a business operation, not merely a query to be translated line-by-line.

## Operational workflow
| Frontend module | Tables / resources observed | RPC / function calls observed | Other dependencies |
|---|---|---|---|
| `ShipmentFirstPage` | `shipment_documents`, `clients`, `shipments`, `vessels`, `shipping_lines`, `registration_orders`, `cases`, `customs_offices`, `shipment_document_extractions`, `file_manager_files` | `create_case_workflow`, `link_shipment_to_case`, `set_shipment_tracking_status`, `set_shipment_ship_pass` | Edge Function `ai-assistant` |
| `PreDeclarationPage` | `profiles`, `shipments`, `shipment_documents`, `customs_documents`, `shipment_customs_data`, `customs_offices`, `registration_orders`, `cases`, `clients`, `shipment_document_extractions` | — | Storage bucket `customs_documents` |
| `DeclarationRegistrationPage` | `shipments`, `customs_declarations`, `shipment_customs_data`, `customs_offices`, `customs_documents` | `register_shipment_declaration`, `set_declaration_file`, `initialize_declaration_checklist` | Storage bucket `customs_documents` |
| `DeclarationOperationsChecklistPage` | `customs_declarations`, `shipments`, `cases`, `clients`, `customs_offices`, `shipment_customs_data`, `registration_orders`, `customs_declaration_workflow`, `declaration_checklist_items` | `initialize_declaration_checklist`, `update_declaration_checklist_item`, `set_declaration_checklist_note`, `add_declaration_checklist_item`, `set_declaration_checklist_item_active`, `advance_declaration_to_exit_stage` | Checklist state and workflow history must be atomic |
| `ExitPage` | `profiles`, `customs_declarations`, `shipment_customs_data`, `shipments`, `declaration_exit_checklist_items`, `declaration_checklist_items`, `customs_documents`, `customs_declaration_workflow` | `update_declaration_checklist_item`, `complete_customs_declaration_exit` | Exit gate must be enforced server-side |

## Customers, cases, orders, and controls
| Frontend module | Tables / resources observed | RPC / function calls observed | Notes |
|---|---|---|---|
| `ClientRegistryPage` | `clients` | `create_client_workflow`, `delete_client_workflow` | Preserve no-delete/audit semantics from existing policies |
| `CaseHistoryPage` | `cases`, `case_status_history`, `audit_logs` | — | History is read/audit data, not just current case status |
| `CaseAlertsPage` | `cases`, `customs_documents`, `customs_declarations`, `permits` | — | Depends on document/declaration/permit completeness |
| `RegistrationOrdersPage` | `registration_orders`, `clients`, `cases`, `registration_order_reconciliation`, `registration_order_external_allocations` | — | External allocations must remain in weight/value over-allocation checks |
| `PermitRulesPage` | `permit_rules`, `customs_operation_rules` | — | Ruleset reads/writes require role controls |
| `OfficeAutomationPage` | `organizations`, `clients` | — | Generated documents/automation dependencies require additional scan |

## Finance and accounting
| Frontend module | Tables / resources observed | RPC / function calls observed | Other dependencies |
|---|---|---|---|
| `FinancePage` | `finance_cost_items`, `finance_cost_categories`, `finance_invoices`, `finance_payment_requests`, `finance_payments`, `petty_cash_ledger`, `finance_org_settings`, `financial_permissions`, `profiles`, `customs_accounting_vouchers`, `voucher_line_items`, `voucher_line_profit`, `finance_invoice_lines`, `finance_invoice_shipments`, `finance_payment_request_lines` | `finance_organization_summary`, `finance_shipment_position`, `create_finance_expense`, `update_finance_expense`, `archive_finance_shipment_cost`, `restore_finance_shipment_cost`, `archive_finance_invoice`, `restore_finance_invoice`, `update_finance_draft_invoice`, `approve_finance_expense`, `record_petty_cash_entry` | Storage bucket `finance-receipts` |
| `FinanceShipmentPage` | `shipments`, `finance_invoice_shipments`, `finance_payment_requests`, `finance_payments`, `customs_accounting_vouchers`, `clients`, `cases` | — | Shipment cost and payment allocation views |
| `CustomsAccountingVoucherPage` | `finance_cost_categories`, `customs_accounting_vouchers`, `voucher_line_items`, `finance_cost_items` | `create_customs_accounting_voucher`, `save_customs_accounting_voucher`, `void_customs_voucher_line` | Voucher writes require transaction and audit guarantees |

All amounts, rates and allocations need integer-safe minor units or explicit decimal-string arithmetic. Do not replace the financial RPCs with disconnected client-side mutations.

## Documents, files, PDF, and knowledge
| Frontend module | Tables / resources observed | RPC / function calls observed | Other dependencies |
|---|---|---|---|
| `FileManagerPage` | `file_manager_folders`, `file_manager_files`, `knowledge_sources` | `copy_file_manager_folder`, `search_file_manager` | File Manager includes knowledge sources |
| `src/lib/fileManager.ts` | `profiles`, `file_manager_folders` | — | Worker messenger routes for archive destination, uploads, archive, and download |
| `src/lib/fileManagerPortableSyncService.ts` | `file_manager_folders`, `file_manager_files` | — | Portable sync / reconciliation |
| `PdfStudioPage` | `file_manager_folders`, `file_manager_files` | — | Storage bucket `customs_documents`; PDF output must create a new asset/version |
| `CustomsDocumentManagerPage` | `profiles`, `shipments`, `cases`, `vessels`, `clients`, `shipment_customs_data`, `customs_offices`, `shipment_documents`, `customs_documents`, `file_manager_files`, `shipment_document_extractions` | — | Document ownership and references span shipment/case/client |
| `DocumentExtractionPage` | `profiles`, `shipments`, `customs_documents`, `shipment_document_extractions` | — | Storage bucket `customs_documents` |
| `KnowledgeCenterV2Page` | `knowledge_sources`, `profiles` | — | Storage bucket `customs-knowledge` |

File content is not represented by a Storage path or Telegram file ID alone. The replacement must return authenticated bytes and verify MIME/size/checksum before marking an asset recoverable.

## Chat, reminders, maritime, and notifications
| Frontend module | Tables / resources observed | RPC / function calls observed | Other dependencies |
|---|---|---|---|
| `src/features/chat/api.ts` | `chat_conversation_members`, `profiles`, `chat_attachments`, `chat_message_reactions`, `chat_message_pins`, `chat_message_user_states`, `chat_message_receipts`, `chat_messages`, `org_connections`, `chat_conversations` | `chat_conversation_list`, `chat_list_messages`, `chat_set_message_mentions`, `chat_mark_read`, `chat_mark_delivered`, `chat_mark_played`, `chat_mark_focus`, `chat_clear_focus`, `chat_create_conversation`, `chat_delete_message_for_me`, `chat_delete_message_for_all`, `chat_search`, `chat_list_org_connections`, `chat_add_member`, `chat_register_attachment`, `chat_hierarchy_list`, `chat_edit_message`, `chat_forward_message`, `chat_share_shipment_update`, `chat_toggle_reaction`, `chat_toggle_pin`, `chat_toggle_star` | Storage bucket `chat-files` |
| `ChatPage` | `profiles` | — | Realtime channels `chat:` and `chat-inbox-user:`; actual message data contract is in `src/features/chat/api.ts` |
| `src/features/chat/push.ts` | Push subscription operations | `get_push_vapid_public_key`, `upsert_push_subscription` | Push delivery |
| `src/features/chat/voiceCall.ts` | `profiles`, `chat_voice_calls` | `start_chat_voice_call` | `/api/webrtc/ice` |
| `src/features/reminders/RemindersPage.tsx` | `operational_reminders`, `shipments`, `profiles`, `reminder_checklist_items`, `cases`, `customs_documents`, `shipment_documents`, `documents`, `finance_invoices`, `clients`, `notification_preferences` | `complete_operational_reminder` | Realtime channel `reminders-live` |
| `src/features/reminders/push.ts` | `push_subscriptions`, `notification_preferences` | `get_reminder_vapid_public_key`, `upsert_push_subscription` | Edge Function `send-reminders` |
| `MaritimePage` | `clients`, `shipments`, `vessels`, `shipping_lines`, `shipping_line_contacts`, `profiles` | `update_shipment_maritime_data`, `delete_shipment_workflow`, `set_shipment_tracking_status` | Vessel/maritime data also depends on Edge Function archive; exact AIS source parity still requires review |

## Direct migration implications
1. Build a typed Worker repository/API layer per domain, retaining each RPC's transactional semantics rather than emulating it as a sequence of unrelated requests.
2. Enforce organization and row ownership inside Worker handlers; never rely on UI route guards or client-provided `organization_id`.
3. Keep file assets reference-based across File Manager, shipment docs, PDF Studio, knowledge, and chat, with one canonical asset record and independent version records.
4. Preserve chat receipts, message state, mentions, forwarding, reactions, pins, push subscriptions, and channel/event semantics. D1 polling is an implementation option, not permission to drop those behaviors.
5. Preserve reminder linkage, checklist completion, notifications, push preferences, and daily digest idempotency.
6. Preserve customs workflow preconditions (especially declaration exit) in a single atomic backend transition with immutable history/audit.
7. Apply the same financial constraints to internal and cross-company/external registration-order allocations.


## Page-by-page source map — all 59 page files reviewed
Literal table/RPC references below are those found directly in each page source. A dash means no direct literal `.from()`/`.rpc()` match in that page file; it does **not** mean the page is backend-independent, because data may be delegated to imported components/hooks/helpers or constructed dynamically.

| Page source | Directly observed tables / backend contracts |
|---|---|
| `AdvancedSettingsPage` | profiles |
| `CaseAlertPanel` | cases, customs_documents, customs_declarations, permits |
| `CaseAlertsPage` | cases, customs_documents, customs_declarations, permits |
| `CaseDeletePage` | shipments, cases, vessels, clients; RPC `delete_case_safely` |
| `CaseDocumentManagementPage` | shipments, vessels, clients, cases |
| `CaseHistoryPage` | cases, case_status_history, audit_logs |
| `CaseOperationsPage` | case_display_context, customs_documents, customs_declarations, permits, case_exit_operations, cases; RPCs `get_case_completion_readiness`, `delete_case_safely` |
| `CaseRegistryPage` | customs_declarations, declaration_checklist_items |
| `CaseStagePage` | case_display_context, shipments, shipment_customs_data, customs_declarations |
| `CaspianMaritimePage` | vessels, shipments |
| `ClientDocumentManagerPage` | profiles, clients, customs_documents |
| `ClientRegistryPage` | clients; RPCs `create_client_workflow`, `delete_client_workflow` |
| `ControlCenterPage` | cases, clients, permits, case_exit_operations, financial_transactions, operational_reminders; RPCs `get_control_center_shipments`, `create_operational_reminder` |
| `ControlCenterWithAlertsPage` | no direct literal query found; inspect imported control/alert components |
| `CustomsAccountingVoucherPage` | finance_cost_categories, customs_accounting_vouchers, voucher_line_items, finance_cost_items; RPCs `create_customs_accounting_voucher`, `save_customs_accounting_voucher`, `void_customs_voucher_line` |
| `CustomsAccountingVoucherPrintPage` | customs_accounting_vouchers, voucher_line_items, organizations |
| `CustomsDocumentManagerPage` | profiles, shipments, cases, vessels, clients, shipment_customs_data, customs_offices, shipment_documents, customs_documents, file_manager_files, shipment_document_extractions |
| `CustomsOfficesPage` | customs_offices |
| `CustomsPendingReportPage` | customs_declaration_workflow, customs_declarations, shipments, cases, declaration_checklist_items, declaration_exit_checklist_items, clients, permits, finance_cost_items |
| `DashboardPage` | RPCs `create_case_workflow`, `attach_registration_order`, `update_case_operational_data`, `register_shipment_workflow`, `calculate_case_valuation`, `register_declaration_workflow` |
| `DeclarationChecklistPage` | cases, customs_declarations; RPC `register_declaration_workflow` |
| `DeclarationOperationsChecklistPage` | customs_declarations, shipments, cases, clients, customs_offices, shipment_customs_data, registration_orders, customs_declaration_workflow, declaration_checklist_items; checklist/stage RPCs |
| `DeclarationRegistrationPage` | shipments, customs_declarations, shipment_customs_data, customs_offices, customs_documents; RPCs `register_shipment_declaration`, `set_declaration_file`, `initialize_declaration_checklist`; Storage `customs_documents` |
| `DesktopHomePage` | shipments, clients, cases |
| `DocumentExtractionPage` | profiles, shipments, customs_documents, shipment_document_extractions; Storage `customs_documents` |
| `DutiesCalculationPage` | cases; RPC `complete_case_duties` |
| `EnterpriseERPPage` | shipments, clients, finance_invoices, finance_payments |
| `ExitPage` | profiles, customs_declarations, shipment_customs_data, shipments, declaration_exit_checklist_items, declaration_checklist_items, customs_documents, customs_declaration_workflow; RPCs `update_declaration_checklist_item`, `complete_customs_declaration_exit` |
| `FileManagerPage` | file_manager_folders, file_manager_files, knowledge_sources; RPCs `copy_file_manager_folder`, `search_file_manager` |
| `FinancePage` | finance cost, invoice, payment, voucher, petty-cash, permissions and settings tables; 11 Finance RPCs; Storage `finance-receipts` |
| `FinanceShipmentPage` | shipments, finance_invoice_shipments, finance_payment_requests, finance_payments, customs_accounting_vouchers, clients, cases |
| `KnowledgeCenterPage` | knowledge_sources, profiles, knowledge_chunks; Storage `customs-knowledge` |
| `KnowledgeCenterV2Page` | knowledge_sources, profiles; Storage `customs-knowledge` |
| `LoginPage` | Supabase Auth import; no direct table/RPC literal |
| `MainMenuPage` | cases, shipments, permits, case_exit_operations, financial_transactions |
| `MaritimePage` | clients, shipments, vessels, shipping_lines, shipping_line_contacts, profiles; RPCs `update_shipment_maritime_data`, `delete_shipment_workflow`, `set_shipment_tracking_status` |
| `MessengerIntegrationsPage` | no direct literal table/RPC; integration API/worker calls require imported dependency review |
| `OfficeAutomationPage` | organizations, clients |
| `OperationsPage` | clients, cases, shipments, registration_orders, documents, permits; workflow/valuation/declaration RPCs; Storage `customs_documents` |
| `OrgConnectionsPage` | no direct literal table/RPC; inspect feature API and connection modules |
| `PaymentRequestPrintPage` | finance_payment_requests, organizations, clients, shipments, finance_payment_request_lines |
| `PdfStudioPage` | file_manager_folders, file_manager_files; Storage `customs_documents` |
| `PermitRulesPage` | permit_rules, customs_operation_rules |
| `PreDeclarationPage` | profiles, shipments, shipment_documents, customs_documents, shipment_customs_data, customs_offices, registration_orders, cases, clients, shipment_document_extractions; Storage `customs_documents` |
| `RegistrationOrdersPage` | registration_orders, clients, cases, registration_order_reconciliation, registration_order_external_allocations |
| `RemindersPage` | operational_reminders, shipments, profiles, reminder_checklist_items, cases, customs_documents, shipment_documents, documents, finance_invoices, clients, notification_preferences; RPC `complete_operational_reminder`; Realtime `reminders-live` |
| `SettingsEnterprisePage` | user_settings, organization_settings, profiles, organizations |
| `SettingsPage` | no direct literal table/RPC |
| `ShareImportPage` | file_manager_folders |
| `ShipmentCaseLinkPage` | cases; RPCs `get_control_center_shipments`, `link_shipment_to_case` |
| `ShipmentFirstPage` | shipment_documents, clients, shipments, vessels, shipping_lines, registration_orders, cases, customs_offices, shipment_document_extractions, file_manager_files; shipment/case/tracking/ship-pass RPCs; Edge Function `ai-assistant` |
| `ShipmentReportsPage` | shipments |
| `ShipmentShowcasePage` | shipments, operational_reminders |
| `ShippingManagementPage` | shipping_lines, vessels, shipments |
| `StagingWorkspacePage` | no direct literal table/RPC |
| `ValuationPage` | cases; RPC `complete_case_valuation` |
| `VesselMultiSourcePage` | Supabase import observed; no direct literal table/RPC |
| `VesselSearchPage` | Supabase import observed; no direct literal table/RPC |
| `VesselTrackingPage` | vessels |

### Page-map caveats
- Several pages import a common Supabase client even when table calls live in shared components, feature modules, or hooks. Those imports remain operational dependencies.
- The full set of dynamic table names, constructed RPC names, Edge Function invocations, shared hooks, Storage policies, and trigger side effects still requires call-graph tracing and integration tests.
- The page map must be joined with the component/library/feature inventory; it is not a backend implementation contract on its own.
- Static route/page presence does not prove the route is enabled for every role or responsive layout, and does not prove CRUD acceptance.

## Completion gate
This file only captures statically visible dependencies in the named critical modules. Phase 1 is not complete until all 59 page modules, all 30 components, all 70 library modules, all hooks/contexts/features, all archived functions, and all historical migrations have been traversed and reconciled into a complete inventory with acceptance tests. No D1 schema migration or Supabase removal is authorized merely by the presence of this map.


## Shared workflow / AI / session components
Static literal calls in the following shared components add further backend requirements:

| Component | Tables / resources observed | RPC / function calls observed | Other dependencies |
|---|---|---|---|
| `CustomsDeclarationWorkflow` | `customs_declaration_workflow_events`, `customs_declarations`, `shipment_customs_data`, `customs_declaration_workflow` | `rollback_customs_declaration_workflow`, `complete_customs_declaration_workflow`, `patch_customs_declaration_workflow_activity` | Workflow event history and rollback are part of the same backend contract |
| Regime workflow components | `customs_declaration_workflow` | — | Export, other regime, temporary import, and transit/re-import components share workflow-state persistence |
| `CustomsStageDocumentAI` | `shipment_documents`, `file_manager_files`, `customs_document_extractions` | Edge Function `ai-assistant` | Must use a canonical reusable file reference |
| `AIOperatorPanel` | `shipments` | Edge Function `ai-operator` | Storage bucket `customs_documents`; operations need server-side action authorization |
| `AIWorkspace` | `shipment_documents`, `shipment_document_extractions`, `shipment_customs_data`, `profiles`, `ai_evidence` | Edge Functions `ai-assistant`, `ai-operator`, `ai-core` | Storage bucket `customs_documents` |
| `SessionManagementPanel` | `user_device_sessions` | `list_my_auth_sessions` | Staging token sessions are not a substitute for the existing multi-device UI contract |
| `SessionLifecycle` | `user_device_sessions` | — | Requires session registration/rotation/revocation lifecycle |
| `LatestShipmentStatuses` | `shipments`, `vessels`, `clients`, `customs_declarations`, `declaration_checklist_items`, `declaration_exit_checklist_items` | — | Dashboard summaries must be sourced from D1 |
| `OperationalAlertsDropdown` | `cases`, `customs_documents`, `customs_declarations`, `permits` | — | Alerts must reflect backend-computed missing/overdue state |
| `MaritimeTab` | `shipments`, `vessels`, `shipment_tracking_events` | `update_shipment_maritime_data`, `set_shipment_tracking_status` | Tracking history must remain auditable |
| `ShipmentCostsPanel` | `finance_cost_items`, `finance_cost_categories`, `financial_permissions` | `submit_finance_shipment_cost`, `create_finance_shipment_cost`, `approve_finance_expense`, `archive_finance_shipment_cost` | Storage bucket `finance-receipts` |
| `RemindersHomeCard` | `operational_reminders` | — | Reads from the same reminder records as the full reminders page |
| `FileManagerFilePicker` | `file_manager_files`, `file_manager_folders` | — | Selection must pass references, not force re-upload |

## Expanded static scan coverage
All 59 files under `src/pages` were inspected for literal Supabase table/RPC/Storage/Realtime/Edge Function calls. The high-risk shared workflow, AI, session, maritime, dashboard, and alert components were also inspected. This is still not a full transitive import/dataflow analysis: some helper modules, dynamically built names, messenger connector internals, and the full set of feature components remain to be traversed.

The key cross-cutting contracts that cannot be omitted are:
- `customs_declaration_workflow` + `customs_declaration_workflow_events` and their complete/patch/rollback RPC semantics.
- `user_device_sessions` and `list_my_auth_sessions` for the multi-device UI.
- `ai_evidence`, document extraction records, and the three AI functions used by AIWorkspace/AI Operator.
- `shipment_tracking_events` and maritime update RPCs.
- Finance receipt Storage, shipment cost approval/archive RPCs, and voucher line relations.
- Shared File Manager references used by customs docs, PDF Studio, knowledge, chat, and shipment forms.


## Shared components, session lifecycle, and helper modules (supplemental static scan)
| Source module | Observed data / RPC dependencies | Notes |
|---|---|---|
| `AuthContext` | `profiles` | Directly imports Supabase Auth/session client; uses persisted session and profile resolution |
| `SessionLifecycle`, `SessionManagementPanel` | `user_device_sessions`; RPC `list_my_auth_sessions` | Device session UI currently depends on the old auth/data service; staging Worker has only its separate bootstrap session table |
| `useCaseSelectorData` | `clients`, `shipments`, `vessels`, `cases` | Shared selectors feed operational forms |
| `CloudSyncStatus` | `profiles` | Profile-dependent sync status |
| `LatestShipmentStatuses` | `shipments`, `vessels`, `clients`, `customs_declarations`, `declaration_checklist_items`, `declaration_exit_checklist_items` | Cross-domain summary component |
| `OperationalAlertsDropdown` | `cases`, `customs_documents`, `customs_declarations`, `permits` | Shared alert aggregation |
| `MaritimeDirectoryPanel` | `shipping_lines`, `vessels`, `shipping_line_contacts`, `profiles` | Directory and permission-aware editing |
| `MaritimeTab` | `shipments`, `vessels`, `shipment_tracking_events`; RPC `update_shipment_maritime_data`, `set_shipment_tracking_status` | Maritime status update contract |
| `AIWorkspaceUploadQueue` | `profiles`, `shipment_documents`; Storage `customs_documents` | Upload queue references existing document storage |
| `CustomsDeclarationWorkflow` | `customs_declaration_workflow_events`, `customs_declarations`, `shipment_customs_data`, `customs_declaration_workflow`; RPC `rollback_customs_declaration_workflow`, `complete_customs_declaration_workflow`, `patch_customs_declaration_workflow_activity` | Must preserve atomic state transition and immutable workflow events |
| `CustomsWorkflowAuditHistory` | `customs_declaration_workflow_events` | Historical activity display |
| `CustomsStageDocumentAI` | `shipment_documents`, `file_manager_files`, `customs_document_extractions`; Edge Function `ai-assistant` | Per-file extraction linked into operational stage |
| `AIOperatorPanel` | `shipments`; Edge Function `ai-operator`; Storage `customs_documents` | AI actions must be authorization-checked server-side |
| `AIWorkspace` | `shipment_documents`, `shipment_document_extractions`, `shipment_customs_data`, `profiles`, `ai_evidence`; Edge Functions `ai-assistant`, `ai-operator`, `ai-core`; Storage `customs_documents` | Additional AI evidence and workflow context dependencies |
| `SettingsPersistenceBridge` | `user_settings` | Profile-scoped preference persistence |
| `src/lib/fileManagerPortableSyncService.ts` | `file_manager_folders`, `file_manager_files` | Portable import/export synchronization must keep conflict and duplicate semantics |
| `src/lib/ownerConsole.ts` | Edge Function `owner-console` | Administrative operations require strict owner authorization |
| `src/lib/fileManager.ts` | `profiles`, `file_manager_folders` | Worker routes include messenger archive destination, upload, archive, and file download |
| `src/lib/offlineQueue.ts` | Uses Supabase client contract | Offline RPC queue is coupled to legacy RPC replay semantics; must be redesigned around explicit idempotent Worker commands |

## Additional operational RPC contracts found in selected pages
The static scan found these further named operations that must be ported only after their exact SQL definitions, grants, RLS interactions, and dependent callers are reviewed:
- Case: `delete_case_safely`, `get_case_completion_readiness`
- Control center / shipment: `get_control_center_shipments`, `create_operational_reminder`
- Dashboard and shipment intake: `attach_registration_order`, `update_case_operational_data`, `register_shipment_workflow`, `calculate_case_valuation`, `register_declaration_workflow`
- Exit/checklist: `advance_declaration_to_exit_stage`, `complete_customs_declaration_exit`
- Workflow history and transitions: `rollback_customs_declaration_workflow`, `complete_customs_declaration_workflow`, `patch_customs_declaration_workflow_activity`
- Finance: the RPC set listed above, including `approve_finance_expense`, `record_petty_cash_entry`, and voucher/expense archive/restore operations
- Chat: 22 named RPC contracts listed under `src/features/chat/api.ts`
- Push: `get_push_vapid_public_key`, `upsert_push_subscription`, `get_reminder_vapid_public_key`
- Sessions: `list_my_auth_sessions`

## Interpretation
These results reveal shared data-service contracts across pages and components. A complete Worker migration therefore needs a typed API and repository layer for each bounded context, not a generic table proxy. It must also port authorization decisions and transaction rules from PostgreSQL functions, triggers, and RLS. The existing static source inventory of 15 initial tables is insufficient to define this API or schema.

## Scan boundary
The tree lists 59 page files, 30 component files, 70 library files, 2 context files, and 2 hooks. The static checks above inspected the critical modules named in this document and many additional shared components. Import-based/dynamic access patterns, generated SQL, string-built queries, all archive source references, and the full behavior of every non-listed library/component have not been proven exhaustively. This matrix remains a partial dependency inventory until all callers are traced and each API is linked to acceptance tests.
