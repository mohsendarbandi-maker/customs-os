import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Telegram-backed Customs OS file manager', () => {
  const migration = read('supabase/migrations/20261024130726_file_manager_logical_folders_telegram_archive.sql');
  const uploadJobs = read('supabase/migrations/20261024130735_file_manager_upload_jobs.sql');
  const reconciliationMigration = read('supabase/migrations/20261024170055_file_manager_upload_reconciliation_fields.sql');
  const unassignedMigration = read('supabase/migrations/20261024131814_file_manager_unassigned_legacy_documents.sql');
  const grantsMigration = read('supabase/migrations/20261024132221_file_manager_minimize_table_grants.sql');
  const folderCopyMigration = read('supabase/migrations/20261024174637_file_manager_folder_copy.sql');
  const gateway = read('supabase/functions/messenger-gateway/index.ts');
  const fileManager = read('src/pages/FileManagerPage.tsx');
  const globalCss = read('src/index.css');
  const documentReportsMigration = read('supabase/migrations/20261108185733_file_manager_document_workflow_reports.sql');
  const documentReportActorMigration = read('supabase/migrations/20261108185740_file_manager_document_report_actor_label.sql');
  const documentReportServerActorMigration = read('supabase/migrations/20261108191704_file_manager_document_report_server_actor.sql');
  const shipmentReportsMigration = read('supabase/migrations/20261108203000_file_manager_shipment_workflow_reports.sql');
  const fileManagerClient = read('src/lib/fileManager.ts');
  const shipmentPage = read('src/pages/ShipmentFirstPage.tsx');
  const documentPage = read('src/pages/CustomsDocumentManagerPage.tsx');
  const clientDocumentPage = read('src/pages/ClientDocumentManagerPage.tsx');
  const preDeclaration = read('src/pages/PreDeclarationPage.tsx');
  const app = read('src/App.tsx');
  const navigation = read('src/components/AppShell.tsx');

  it('creates owner and shipment folders idempotently, with required finance subfolder and customs name', () => {
    expect(migration).toContain("'owners-root', 'root', 'صاحبان کالا'");
    expect(migration).toContain("'accounting-finance', 'accounting_finance', 'حسابداری مالی'");
    expect(migration).toContain("v_shipment_name || ' - ' || v_office_name");
    expect(migration).toContain("'shipment:' || v_shipment::text");
    expect(migration).toContain('on conflict do nothing');
    expect(migration).toContain('trg_ensure_shipment_file_manager_folders');
  });

  it('keeps Telegram as the archive transport and never routes archives to daily-report chat', () => {
    expect(gateway).toContain('path==="/api/messenger/file-archive-destination"');
    expect(gateway).toContain('.eq("purpose","file_archive").eq("enabled",true)');
    expect(gateway).toContain('mapped.purpose!=="file_archive"');
    expect(gateway).toContain('FILE_ARCHIVE_NOT_CONFIGURED');
    expect(fileManagerClient).toContain('/api/messenger/file-archive-destination');
  });

  it('stores file metadata, Telegram message identity and durable upload idempotency state', () => {
    expect(migration).toContain('create table if not exists public.file_manager_files');
    expect(migration).toContain('external_message_id text null');
    expect(migration).toContain('file_asset_id uuid null');
    expect(uploadJobs).toContain('file_manager_upload_jobs_idempotency_uq');
    expect(uploadJobs).toContain("'reconcile_required'");
    expect(gateway).toContain('FILE_UPLOAD_RECONCILIATION_REQUIRED');
    expect(gateway).toContain('status:"stored"');
  });

  it('persists Telegram upload receipts and repairs interrupted metadata without re-uploading', () => {
    expect(reconciliationMigration).toContain('telegram_file_id text null');
    expect(reconciliationMigration).toContain('connection_id uuid null');
    expect(reconciliationMigration).toContain('archive_tags text[] not null default');
    expect(gateway).toContain('telegram_file_id:result.fileId');
    expect(gateway).toContain('async function reconcileTelegramArchiveMetadata');
    expect(gateway).toContain('reconciled:true');
    expect(gateway).toContain('FILE_UPLOAD_RECONCILIATION_REQUIRED');
    expect(gateway).toContain('if(existing&&existing.status!=="failed")');
    expect(gateway).toContain('uploadStream(c,chat,name,mime,size,req.body,"file",TG_DOWNLOAD_LIMIT,archiveCaption,ownerTopicId)');
  });

  it('uses content-bound upload keys for direct Telegram flows and durable queue keys for shipment documents', () => {
    expect(fileManagerClient).toContain("crypto.subtle.digest('SHA-256'");
    expect(fileManagerClient).toContain('input.destination.connectionId');
    expect(fileManagerClient).toContain('input.folderId');
    expect(fileManagerClient).toContain("return `customs-os-upload-v1:${keyHash}`");
    expect(fileManager).toContain('createTelegramArchiveIdempotencyKey(file');
    expect(gateway).toContain('customs-os-shipment-document-archive-v1:');
    expect(gateway).toContain('customs-os-legacy-archive-v1:');
    expect(shipmentPage).not.toContain('createTelegramArchiveIdempotencyKey(document.file');
    expect(clientDocumentPage).toContain('createTelegramArchiveIdempotencyKey(f');
    expect(fileManager).not.toContain('uploadKeys.current');
    expect(shipmentPage).not.toContain('uploadKeys.current');
    expect(clientDocumentPage).not.toContain('uploadKeys.current');
  });

  it('enforces the Telegram download-size limit while streaming at the server', () => {
    expect(gateway).toContain('maxOverride?:number');
    expect(gateway).toContain('uploadStream(c,chat,name,mime,size,req.body,"file",TG_DOWNLOAD_LIMIT,archiveCaption,ownerTopicId)');
    expect(fileManagerClient).toContain('FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES = 20 * 1024 * 1024');
    expect(fileManagerClient).toContain('FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES');
  });

  it('keeps upload archival background-only while allowing explicit stage-2 extraction of archived documents', () => {
    expect(fileManager).not.toContain('tesseract');
    expect(fileManager).not.toContain('ai-assistant');
    expect(fileManager).toContain('uploadTelegramArchivedFile');
    expect(documentPage).toContain("d.storage_backend === 'telegram' || d.file_asset_id");
    expect(preDeclaration).toContain('telegram_file_asset_id');
    expect(preDeclaration).toContain('document_storage_path');
    expect(preDeclaration).not.toContain("docs.filter(d=>d.storage_backend!=='telegram'&&!d.file_asset_id)");
  });

  it('prevents duplicate bill-of-lading shipments and directs the user to the existing shipment', () => {
    expect(shipmentPage).toContain('const sameShipmentUniqueKey=');
    expect(shipmentPage).toContain('rows.find(row=>sameShipmentUniqueKey(row,form,selected))');
    expect(shipmentPage).toContain("e?.code==='23505'");
    expect(shipmentPage).toContain("uq_shipments_bl_line_year");
    expect(shipmentPage).toContain("باز کردن محموله موجود");
    expect(shipmentPage).toContain('select(SHIPMENT_ROW_SELECT)');
    expect(shipmentPage).not.toContain('drop index uq_shipments_bl_line_year');
  });

  it('selects bill of lading files immediately, saves them securely, and queues Telegram after shipment creation', () => {
    expect(shipmentPage).toContain('URL.createObjectURL(file)');
    expect(shipmentPage).toContain('setPendingDocuments(previous=>[...previous,pending])');
    expect(shipmentPage).toContain("uploadStatus:'uploading'");
    expect(shipmentPage).toContain('void storePendingShipmentDocument(pending)');
    expect(shipmentPage).toContain('supabase.storage.from(BUCKET).upload(storagePath,document.file');
    expect(shipmentPage).toContain('setPreviewBillOfLadingUrl(previewUrl)');
    expect(shipmentPage).toContain('fileToBase64(document.file)');
    expect(shipmentPage).toContain('document_storage_path:document.storagePath');
    expect(shipmentPage).toContain("storage_path:staged.storagePath!,storage_backend:'supabase'");
    expect(shipmentPage).toContain('telegram_archive_requested:true');
    const pickerStart = shipmentPage.indexOf('const uploadStagedShipmentDocuments=');
    const pickerEnd = shipmentPage.indexOf('const previewPendingBillOfLading=', pickerStart);
    const pickerCode = shipmentPage.slice(pickerStart,pickerEnd);
    expect(pickerCode).toContain('void storePendingShipmentDocument(pending)');
    expect(pickerCode).not.toContain('archiveShipmentDocumentInBackground');
    expect(shipmentPage).toContain('supabase.storage.from(BUCKET).upload(storagePath,file');
    expect(shipmentPage).toContain('update({telegram_archive_requested:true})');
    expect(shipmentPage).not.toContain('createTelegramArchiveIdempotencyKey');
    expect(shipmentPage).not.toContain('uploadTelegramArchivedFile');
  });

  it('uploads shipment documents to secure browser Storage first and queues Telegram archival independently', () => {
    expect(documentPage).toContain("supabase.storage.from(BUCKET).upload");
    expect(documentPage).toContain("storage_backend: 'supabase'");
    expect(documentPage).toContain("telegram_archive_requested: true");
    expect(documentPage).toContain("getDefaultShipmentUploadFolder(current.id)");
    expect(documentPage).toContain("void upload(files)");
    expect(documentPage).toContain("آرشیو تلگرام به‌صورت مستقل در پس‌زمینه ادامه پیدا می‌کند");
    expect(documentPage).not.toContain("getFileArchiveDestination");
    expect(documentPage).not.toContain("uploadTelegramArchivedFile");
  });

  it('keeps retryable Telegram archival tied to the original shipment document and schedules a server backstop', () => {
    const backgroundMigration = read('supabase/migrations/20261030190000_shipment_document_background_telegram_archive.sql');
    const scopedArchiveMigration = read('supabase/migrations/20261030193000_scope_telegram_archive_to_requested_shipment_documents.sql');
    expect(backgroundMigration).toContain('shipment_document_id uuid');
    expect(backgroundMigration).toContain("customs-os-shipment-document-telegram-archive-every-minute");
    expect(backgroundMigration).toContain("x-messenger-path', '/api/messenger/archive/legacy/process'");
    expect(scopedArchiveMigration).toContain('telegram_archive_requested boolean not null default false');
    expect(scopedArchiveMigration).toContain('sd.telegram_archive_requested = true');
    expect(scopedArchiveMigration).toContain('join public.file_manager_files f');
    expect(gateway).toContain('async function archiveShipmentDocument(');
    expect(gateway).toContain('sourceShipmentDocumentId');
    expect(gateway).toContain('FILE_ARCHIVE_RECONCILIATION_SOURCE_DOCUMENT_MISSING');
    expect(gateway).toContain('SHIPMENT_DOCUMENT_ARCHIVE_UPDATE_FAILED');
    expect(gateway).toContain('shipment_document_id:sourceShipmentDocumentId||null');
    expect(gateway).toContain('eq("telegram_archive_requested",true)');
    expect(gateway).toContain('.in("shipment_document_id",queuedDocumentIds)');
    expect(shipmentPage).toMatch(/telegram_archive_requested\s*:\s*true/);
  });

  it('provides global business/document search, and preserves organization scoping in the RPC', () => {
    expect(migration).toContain('create or replace function public.search_file_manager');
    expect(migration).toContain('security invoker');
    expect(migration).toContain("user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')");
    expect(migration).toContain('public.user_org_id()');
    expect(migration).toContain('public.shipment_customs_data');
    expect(migration).toContain('public.customs_declarations');
    expect(migration).toContain('public.vessels');
    expect(migration).toContain('public.file_manager_files');
    expect(fileManager).toContain("supabase.rpc('search_file_manager'");
  });

  it('supports safe bidirectional Windows sync without overwriting or deleting conflicts', () => {
    expect(fileManager).toContain('webkitdirectory');
    expect(fileManager).toContain('showDirectoryPicker');
    expect(fileManager).toContain('syncWindowsFolder');
    expect(fileManager).toContain('همگام‌سازی همه اطلاعات با یک کلیک');
    expect(fileManager).toContain('const keyMaterial = [organizationId, parent.id, relativePath, local.file.size, localHash].join');
    expect(fileManager).toContain('هیچ سند اصلی حذف یا بازنویسی نشد');
    expect(fileManager).toContain('اطلاعات_عملیاتی.txt');
    expect(fileManager).toContain('if (file.storage_path && Number(file.size_bytes) > FILE_ARCHIVE_MAX_BYTES)');
    expect(fileManager).toContain('return downloadStorageCopy()');
    expect(fileManager).toContain("getSavedSyncDirectoryHandle()");
  });

  it('allows client-scoped users to create custom folders while RLS scopes their access', () => {
    expect(fileManager).toContain("['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'].includes(String(role || ''))");
    expect(migration).toContain("and public.user_role()::text = 'client'");
    expect(migration).toContain('parent.client_id = public.user_client_id()');
  });

  it('supports owner-level documents without a shipment and hides archived file metadata', () => {
    expect(migration).toContain('  shipment_id uuid null,');
    expect(migration).toContain('create or replace function public.ensure_client_file_manager_folder');
    expect(migration).toContain('create or replace function public.sync_customs_document_to_file_manager');
    expect(migration).toContain('and not coalesce(cd.is_archived, false)');
    expect(migration).toContain('and not fm.is_archived');
    expect(uploadJobs).toContain('  shipment_id uuid null,');
    expect(gateway).toContain('CUSTOMS_DOCUMENT_METADATA_SAVE_FAILED');
    expect(gateway).toContain('ownerFileError');
    expect(fileManager).toContain("['client', 'custom'].includes(currentFolder.folder_type)");
    expect(clientDocumentPage).toContain('is_archived:true');
    expect(clientDocumentPage).toContain('نسخه اصلی در آرشیو تلگرام حذف نخواهد شد');
  });

  it('keeps the existing shared-ID document mirror and avoids duplicate search entries', () => {
    expect(migration).toContain('create or replace function public.sync_shipment_document_to_customs_documents()');
    expect(migration).toContain('new.storage_backend, new.file_asset_id, new.folder_id');
    expect(migration).toContain('where sd.id=cd.id and sd.organization_id=cd.organization_id');
    expect(migration).toContain('where mirror.id = sd.id and mirror.organization_id = sd.organization_id');
    expect(migration).toContain('fm_file.customs_document_id = cd.id or fm_file.shipment_document_id = cd.id');
  });

  it('uses one file-manager row for shipment/customs documents sharing the same legacy ID', () => {
    expect(migration).toContain('customs_document_id,storage_path,created_by');
    expect(migration).toContain('case when exists (select 1 from public.customs_documents mirror');
    expect(migration).toContain('customs_document_id=coalesce(v_customs_mirror,customs_document_id)');
    expect(migration).toContain('shipment_document_id=coalesce(v_shipment_mirror,shipment_document_id)');
    expect(migration).toContain('or customs_document_id=new.id');
    expect(migration).toContain('or shipment_document_id=new.id');
    expect(migration).toContain('get diagnostics v_rows = row_count');
  });

  it('embeds searchable folder metadata in Telegram and follows owner changes', () => {
    expect(gateway).toContain('archiveMode:"telegram_file_archive"');
    expect(gateway).toContain('"صاحب کالا: "+ownerName.slice(0,90)');
    expect(gateway).toContain('"محموله: "+shipmentFolderName.slice(0,120)');
    expect(gateway).toContain('telegramTagTokens');
    expect(gateway).toContain('customsOfficeName');
    expect(gateway).toContain('kottajNumber');
    expect(migration).toContain('update public.file_manager_files\n  set client_id = v_client');
    expect(migration).toContain('update public.customs_documents\n  set client_id = v_client');
    expect(preDeclaration).toContain(".eq('is_archived',false)");
    expect(documentPage).toContain(".eq('is_archived', false)");
  });

  it('keeps orphan legacy documents visible without guessing their owner or moving bytes', () => {
    expect(unassignedMigration).toContain("'unassigned-documents'");
    expect(unassignedMigration).toContain("'اسناد نیازمند اتصال به محموله'");
    expect(unassignedMigration).toContain("'legacy_document_without_owner_or_shipment'");
    expect(unassignedMigration).toContain('new.organization_id');
    expect(unassignedMigration).toContain('on conflict do nothing');
  });

  it('removes default TRUNCATE and direct-write grants from archive tables', () => {
    expect(grantsMigration).toContain('revoke all on table public.file_manager_upload_jobs from public, anon, authenticated');
    expect(grantsMigration).toContain('grant select, insert, update on table public.file_manager_folders to authenticated');
    expect(grantsMigration).toContain('grant select, update on table public.file_manager_files to authenticated');
    expect(grantsMigration).toContain('grant all on table public.file_manager_folders, public.file_manager_files, public.file_manager_upload_jobs to service_role');
  });

  it('adds a safe copy-folder RPC that aliases bytes without moving storage', () => {
    expect(folderCopyMigration).toContain('copy_file_manager_folder');
    expect(folderCopyMigration).toContain('FILE_MANAGER_COPY_SCOPE_MISMATCH');
    expect(folderCopyMigration).toContain('FILE_MANAGER_COPY_CLIENT_SCOPE_FORBIDDEN');
    expect(folderCopyMigration).toContain('copyAliasFileAssetId');
    expect(folderCopyMigration).toContain("pg_get_functiondef('public.search_file_manager(text,integer)'::regprocedure)");
    expect(folderCopyMigration).toContain("FILE_MANAGER_SEARCH_FUNCTION_SHAPE_CHANGED");
    expect(folderCopyMigration).toContain("copyAliasSourceFileId");
  });

  it('adds searchable Persian Telegram archive captions with customs and kottaj details', () => {
    expect(gateway).toContain('📁 آرشیو فایل Customs OS');
    expect(gateway).toContain('customsOfficeName');
    expect(gateway).toContain('kottajNumber');
    expect(gateway).toContain('searchHashtags');
  });

  it('archives legacy Supabase documents through the private cron-gated Telegram path without deleting Storage originals', () => {
    expect(gateway).toContain('async function processLegacyFileArchive(req:Request)');
    expect(gateway).toContain('internal_get_reminder_secret",{p_name:"messenger_outbox_cron_secret"}');
    expect(gateway).toContain('path==="/api/messenger/archive/legacy/process"&&req.method==="POST"');
    expect(gateway).toContain('db.storage.from("customs_documents").download(path)');
    expect(gateway).toContain('legacyStoragePathPreserved:path');
    expect(gateway).toContain('patch.is_archived=true');
    expect(gateway).toContain('customs-os-legacy-archive-v1:');
  });

  it('only allows the private archive runner to archive ownerless legacy documents in the verified unassigned folder', () => {
    expect(gateway).toContain('async function upload(req:Request,p:Profile,user:string,cid:string,allowUnassignedLegacy=false)');
    expect(gateway).toContain('allowUnassignedLegacy&&folder.shipment_id===null&&!folder.client_id');
    expect(gateway).toContain('folder.folder_key==="unassigned-documents"');
    expect(gateway).toContain('parent.folder_key==="owners-root"');
    expect(gateway).toContain('LEGACY_UNASSIGNED_FOLDER_NOT_VERIFIED');
    expect(gateway).toContain('LEGACY_UNASSIGNED_PARENT_NOT_VERIFIED');
    expect(gateway).toContain('بدون اتصال به صاحب کالا');
    expect(gateway).toContain('بدون اتصال به محموله');
    expect(gateway).toContain('String(connection.id),isUnassignedLegacy');
  });

  it('keeps the mobile folder tree in a full-height scrollable drawer and avoids a tiny nested upload scroller', () => {
    expect(fileManager).toContain('fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)]');
    expect(fileManager).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(fileManager).toContain('p-0 lg:static lg:z-auto lg:flex lg:max-h-[calc(100dvh-10rem)] lg:overflow-visible');
    expect(fileManager).toContain('className="shrink-0 border-b app-border p-3 md:p-4"');
    expect(fileManager).toContain('min-h-[60dvh] max-h-none flex-col overflow-visible');
    expect(fileManager).toContain('whitespace-normal break-words leading-5');
  });

  it('keeps upload guidance reachable on mobile and shows complete folder-card labels', () => {
    expect(fileManager).toContain('disabled={!currentFolder} title={uploadEnabled?');
    expect(fileManager).toContain('whitespace-normal break-words text-sm font-bold leading-5');
  });

  it('renders the File Management workspace full-width with a collapsed sync disclosure', () => {
    expect(fileManager).toContain('w-full max-w-none');
    expect(fileManager).toContain('>مدیریت فایل</h1>');
    expect(fileManager).toContain('file-manager-sync-dropdown');
    expect(fileManager).toContain('<details className="file-manager-sync-dropdown');
    expect(fileManager).toContain('file-manager-flat-panel');
  });

  it('shows workflow reports only at shipment level, never on individual documents', () => {
    expect(fileManager).toContain('file_manager_shipment_reports');
    expect(fileManager).toContain('گزارش و پیگیری محموله‌ها');
    expect(fileManager).toContain('ثبت گزارش محموله');
    expect(fileManager).toContain('actor_name');
    expect(fileManager).toContain('action_required');
    expect(fileManager).not.toContain('گزارش و وضعیت سند');
    expect(fileManager).not.toContain('ویترین پیگیری و گزارش اسناد');
  });

  it('skips operating-system sidecar files and continues when a local folder cannot be created', () => {
    expect(fileManager).toContain('isSystemSyncEntry');
    expect(fileManager).toContain("lower.startsWith('._')");
    expect(fileManager).toContain('failedItems.push(folderPath');
    expect(fileManager).toContain('try { await ensureLocalFolder(folderPath);');
  });

  it('keeps desktop content width aligned with the expanded and collapsed sidebar', () => {
    expect(globalCss).toContain('.app-main.sidebar-compact{width:calc(100% - 82px)!important;margin-right:82px!important}');
    expect(globalCss).toContain('.app-main:not(.sidebar-compact){width:calc(100% - 230px)!important;margin-right:230px!important}');
    expect(globalCss).toContain('.app-sidebar.is-collapsed{width:82px!important}');
  });

  it('keeps document workflow report migrations append-only and tenant scoped', () => {
    expect(documentReportsMigration).toContain('enable row level security');
    expect(documentReportsMigration).toContain('file_manager_document_reports_insert');
    expect(documentReportsMigration).toContain('public.user_org_id()');
    expect(documentReportsMigration).toContain("array['owner','admin','broker','accountant','warehouse']");
    expect(documentReportsMigration).not.toContain('for update');
    expect(documentReportsMigration).not.toContain('for delete');
    expect(documentReportActorMigration).toContain('actor_name');
  });

  it('includes shipment workflow reports in organization and shipment metadata sync exports', () => {
    expect(fileManager).toContain("tableNames.push('file_manager_shipment_reports')");
    expect(fileManager).toContain("title: 'گزارش‌ها و گردش وضعیت محموله'");
    expect(fileManager).not.toContain('file_manager_document_reports');
  });

  it('does not paginate or render a document-centric report showcase', () => {
    expect(fileManager).not.toContain('workflowHasMore');
    expect(fileManager).not.toContain('loadMoreWorkflowFiles');
    expect(fileManager).not.toContain('بارگذاری اسناد قدیمی‌تر');
  });

  it('creates tenant-scoped append-only shipment report history with server-derived authorship', () => {
    expect(shipmentReportsMigration).toContain('create table if not exists public.file_manager_shipment_reports');
    expect(shipmentReportsMigration).toContain('shipment_id uuid not null references public.shipments(id)');
    expect(shipmentReportsMigration).toContain('enable row level security');
    expect(shipmentReportsMigration).toContain('public.user_org_id()');
    expect(shipmentReportsMigration).toContain('new.created_by := auth.uid()');
    expect(shipmentReportsMigration).toContain('new.created_at := now()');
    expect(shipmentReportsMigration).toContain('p.organization_id = new.organization_id');
    expect(shipmentReportsMigration).not.toContain('for delete');
  });

  it('derives document report authorship and timestamps from the authenticated server session', () => {
    expect(documentReportServerActorMigration).toContain('security definer');
    expect(documentReportServerActorMigration).toContain('new.created_by := auth.uid()');
    expect(documentReportServerActorMigration).toContain('new.created_at := now()');
    expect(documentReportServerActorMigration).toContain('p.organization_id = new.organization_id');
    expect(documentReportServerActorMigration).toContain('revoke all on function');
  });

  it('registers the page and exposes it from the main navigation', () => {
    expect(app).toContain('path="/file-manager"');
    expect(app).toContain("import('./pages/FileManagerPage')");
    expect(navigation).toContain("to: '/file-manager'");
  });
});
