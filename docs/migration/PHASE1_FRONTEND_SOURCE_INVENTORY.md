# Customs OS — Frontend Source Inventory (Phase 1)
Audit date: 2026-11-23
Branch: `rebuild/cloudflare-free-first`
Audited source HEAD before this inventory commit: `141bc7a205aa22283f0eeeba9cbb6ac1ff69e699`

## Scope and classification
All 59 files under `src/pages` were enumerated and opened for source-level review. The audit also enumerated the 30 files under `src/components`, 47 non-test TypeScript modules under `src/lib`, 2 contexts, and 2 hooks. The broader `src/lib` directory contains 70 TypeScript files including tests. Chat and reminder feature modules were reviewed separately.

This is a source inventory. It is not proof of production behavior, live database schema, deployed D1 contents, or endpoint parity. Literal Supabase table/RPC/storage/channel references are recorded in `FRONTEND_API_DEPENDENCY_MATRIX.md`. Dynamic query construction, imported helper call graphs, environment-specific branches, and all transitive dependencies still require executable tracing and test contracts.

## Page inventory — 59/59 source files
### Operational cases, shipments, declarations, permits, and customs documents
- `src/pages/CaseAlertPanel.tsx`
- `src/pages/CaseAlertsPage.tsx`
- `src/pages/CaseDeletePage.tsx`
- `src/pages/CaseDocumentManagementPage.tsx`
- `src/pages/CaseHistoryPage.tsx`
- `src/pages/CaseOperationsPage.tsx`
- `src/pages/CaseRegistryPage.tsx`
- `src/pages/CaseStagePage.tsx`
- `src/pages/CustomsDocumentManagerPage.tsx`
- `src/pages/CustomsOfficesPage.tsx`
- `src/pages/CustomsPendingReportPage.tsx`
- `src/pages/DeclarationChecklistPage.tsx`
- `src/pages/DeclarationOperationsChecklistPage.tsx`
- `src/pages/DeclarationRegistrationPage.tsx`
- `src/pages/DocumentExtractionPage.tsx`
- `src/pages/DutiesCalculationPage.tsx`
- `src/pages/ExitPage.tsx`
- `src/pages/OperationsPage.tsx`
- `src/pages/PreDeclarationPage.tsx`
- `src/pages/PermitRulesPage.tsx`
- `src/pages/RegistrationOrdersPage.tsx`
- `src/pages/ShipmentCaseLinkPage.tsx`
- `src/pages/ShipmentFirstPage.tsx`
- `src/pages/ShipmentReportsPage.tsx`
- `src/pages/ShipmentShowcasePage.tsx`
- `src/pages/ValuationPage.tsx`

### Finance, accounting, and ERP
- `src/pages/CustomsAccountingVoucherPage.tsx`
- `src/pages/CustomsAccountingVoucherPrintPage.tsx`
- `src/pages/EnterpriseERPPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/FinanceShipmentPage.tsx`
- `src/pages/PaymentRequestPrintPage.tsx`

### Documents, File Manager, PDF, and knowledge
- `src/pages/ClientDocumentManagerPage.tsx`
- `src/pages/FileManagerPage.tsx`
- `src/pages/KnowledgeCenterPage.tsx`
- `src/pages/KnowledgeCenterV2Page.tsx`
- `src/pages/PdfStudioPage.tsx`
- `src/pages/ShareImportPage.tsx`

### Maritime, vessels, and shipping
- `src/pages/CaspianMaritimePage.tsx`
- `src/pages/MaritimePage.tsx`
- `src/pages/ShippingManagementPage.tsx`
- `src/pages/VesselMultiSourcePage.tsx`
- `src/pages/VesselSearchPage.tsx`
- `src/pages/VesselTrackingPage.tsx`

### Clients, dashboards, settings, communications, and reminders
- `src/pages/AdvancedSettingsPage.tsx`
- `src/pages/ClientRegistryPage.tsx`
- `src/pages/ControlCenterPage.tsx`
- `src/pages/ControlCenterWithAlertsPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/DesktopHomePage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/MainMenuPage.tsx`
- `src/pages/MessengerIntegrationsPage.tsx`
- `src/pages/OfficeAutomationPage.tsx`
- `src/pages/OrgConnectionsPage.tsx`
- `src/pages/RemindersPage.tsx`
- `src/pages/SettingsEnterprisePage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/StagingWorkspacePage.tsx`

## Shared components — 30/30
- `AIOperatorPanel.tsx`, `AIWorkspace.tsx`, `AIWorkspaceUploadQueue.tsx`
- `AppShell.tsx`, `CloudSyncStatus.tsx`, `CustomsDeclarationWorkflow.tsx`
- `CustomsExportWorkflow.tsx`, `CustomsLogo.tsx`, `CustomsOtherRegimeWorkflow.tsx`
- `CustomsStageDocumentAI.tsx`, `CustomsTemporaryImportWorkflow.tsx`, `CustomsTransitReimportWorkflow.tsx`
- `CustomsWorkflowAuditHistory.tsx`, `FormDraftIndicator.tsx`, `LatestShipmentStatuses.tsx`
- `MaritimeDirectoryPanel.tsx`, `MaritimeTab.tsx`, `MobileCommandDashboard.tsx`
- `OfflineQueueStatus.tsx`, `OperationalAlertsDropdown.tsx`, `PdfDocumentViewer.tsx`
- `ProtectedRoute.tsx`, `QueryCachePersistence.tsx`, `SessionLifecycle.tsx`
- `SessionManagementPanel.tsx`, `SettingsPersistenceBridge.tsx`
- `ui/index.ts`, `ui/overlays.tsx`, `ui/primitives.tsx`
- `appShellMobileRegression.test.ts`

## Context and hooks — 4/4
Contexts:
- `src/context/AppearanceContext.tsx`
- `src/context/AuthContext.tsx`

Hooks:
- `src/hooks/useAutosavedDraft.ts`
- `src/hooks/useCaseSelectorData.ts`

## Library modules — 47 non-test TypeScript files
- `appFileTransfer.ts`
- `authSessionErrors.ts`, `authStorage.ts`
- `cargoNaming.ts`, `caseAlerts.ts`, `caseWorkflow.ts`, `clientFileOptimizer.ts`, `clientId.ts`, `companyBranding.ts`
- `customsChecklistStatus.ts`, `customsDeclarationWorkflow.ts`, `customsDocumentAI.ts`, `customsDocumentExtraction.ts`, `customsFinancePendingTasks.ts`, `customsOtherRegimeValidation.ts`, `customsPendingTasks.ts`, `customsWorkflowPatch.ts`
- `declarationWorkflowContext.ts`, `deviceSessions.ts`, `displayNames.ts`, `documentTextExtraction.ts`, `draftStorage.ts`, `edgeFunction.ts`
- `fileManager.ts`, `fileManagerExplorer.ts`, `fileManagerLocalIndex.ts`, `fileManagerPortableSync.ts`, `fileManagerPortableSyncService.ts`, `fileManagerSync.ts`
- `finance.ts`, `financeReceiptExtraction.ts`, `jalali.ts`
- `offlineQueue.ts`, `ownerConsole.ts`
- `pdfRecognition.ts`, `pdfStudioUtils.ts`, `recoveryHost.ts`
- `registrationOrderAllocations.ts`, `registrationOrderLookup.ts`
- `safeStorageFilename.ts`, `safeWindowsFileName.ts`
- `shared/case-display.ts`, `shared/jalali.ts`
- `supabase.ts`, `supabaseAuthFetch.ts`
- `userSettingsStorage.ts`, `withTimeout.ts`

The 70-file `src/lib` total includes test modules. Unit test files are not runtime dependencies and must not be used as a substitute for implementation inventory.

## Feature areas outside the page directory
### Chat
`src/features/chat` contains the UI, API abstraction, message/conversation models, realtime protocol, push notifications, attachment forwarding, and voice-call support. Static dependency scan found 10 core chat tables, 22 chat RPC operations, `chat-files` Storage bucket, push subscription RPCs, `chat_voice_calls` and `start_chat_voice_call`, plus existing realtime channels in the chat page.

### Reminders
`src/features/reminders` contains Jalali calendar/date picker, recurrence, editor, parser, selection/bulk actions, offline queue, push delivery, and reminder UI. Static scan found `operational_reminders`, `reminder_checklist_items`, `notification_preferences`, `push_subscriptions`, `complete_operational_reminder`, VAPID subscription RPCs, `send-reminders` Edge Function, and `reminders-live` realtime channel.

## Directly observed examples of business-critical contracts
- Customs declaration: `register_shipment_declaration`, `set_declaration_file`, `initialize_declaration_checklist`.
- Declaration checklist and exit: `update_declaration_checklist_item`, `set_declaration_checklist_note`, `add_declaration_checklist_item`, `set_declaration_checklist_item_active`, `advance_declaration_to_exit_stage`, `complete_customs_declaration_exit`.
- Customs workflow history/rollback: `complete_customs_declaration_workflow`, `rollback_customs_declaration_workflow`, `patch_customs_declaration_workflow_activity`.
- Case/shipment: `create_case_workflow`, `link_shipment_to_case`, `set_shipment_tracking_status`, `set_shipment_ship_pass`, `delete_case_safely`.
- Finance: `create_finance_expense`, `approve_finance_expense`, `record_petty_cash_entry`, invoice/payment/voucher operations, and financial reporting RPCs.
- Registration-order integrity: `registration_order_reconciliation`, `registration_order_external_allocations` are used as data sources; external allocations must participate in the aggregate cap checks.
- AI: `ai-assistant`, `ai-operator`, `ai-core` Edge Function contracts and document extraction rows.
- File handling: separate Storage namespaces for customs documents, knowledge, chat, and finance receipts; File Manager, shipment-document and extracted-document references must converge on a canonical asset model.

## Legacy execution dependencies confirmed
The frontend still has active Supabase execution dependencies. Confirmed examples include:
- `src/context/AuthContext.tsx` imports Supabase Auth and the Supabase client.
- `src/lib/supabase.ts` constructs `@supabase/supabase-js`, configures Auth persistence, and targets same-origin Worker proxy paths outside local development.
- `src/lib/edgeFunction.ts` reads the Supabase session and sends authenticated requests to the legacy Edge Function proxy (with direct local-development fallback).
- `src/features/chat/api.ts` uses Supabase PostgREST/RPC/Storage for chat data and files.
- `src/features/reminders/RemindersPage.tsx` uses PostgREST, RPC, and Realtime for reminders.
- `worker/index.ts` still defines Supabase URL/Anon/Secret bindings and compatibility routing for Auth, REST, Storage, Realtime, and Edge Functions.
- `package.json` still includes `@supabase/supabase-js` and a Supabase type-generation script.

This is not an endorsement to delete those files now. They remain necessary to the current Production runtime and cannot be removed until full replacements are deployed and proven on staging.

## Inventory completion status
- Page file enumeration and review: **COMPLETED (source-level)** — 59/59.
- Shared component enumeration and review: **COMPLETED (source-level)** — 30/30.
- Context and Hook enumeration and review: **COMPLETED (source-level)** — 4/4.
- Library path enumeration: **COMPLETED (source-level)** — 47/47 non-test modules.
- Static table/RPC/storage/realtime/edge dependency extraction: **PARTIAL** — key operational modules mapped in `FRONTEND_API_DEPENDENCY_MATRIX.md`; dynamic/imported/transitive call graph and every edge case still need executable validation.
- Live PostgreSQL schema/migration state: **BLOCKED** — source SQL and repository migrations do not prove the live schema while PostgreSQL returns 57P03.
- Live D1 schema/counts: **UNVERIFIED** — requires authenticated Cloudflare account read access.
- Functional API parity: **NOT_STARTED** — staging Worker still exposes only migration/health/auth bootstrap/initial AI endpoints.
