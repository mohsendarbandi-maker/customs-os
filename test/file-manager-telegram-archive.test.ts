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
  const folderCopyMigration = read('supabase/migrations/20261024172000_file_manager_folder_copy.sql');
  const gateway = read('supabase/functions/messenger-gateway/index.ts');
  const fileManager = read('src/pages/FileManagerPage.tsx');
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
    expect(gateway).toContain('uploadStream(c,chat,name,mime,size,req.body,"file",TG_DOWNLOAD_LIMIT,archiveCaption)');
  });

  it('uses content-bound deterministic upload keys across all browser upload flows', () => {
    expect(fileManagerClient).toContain("crypto.subtle.digest('SHA-256'");
    expect(fileManagerClient).toContain('input.destination.connectionId');
    expect(fileManagerClient).toContain('input.folderId');
    expect(fileManagerClient).toContain("return `customs-os-upload-v1:${keyHash}`");
    expect(fileManager).toContain('createTelegramArchiveIdempotencyKey(file');
    expect(shipmentPage).toContain('createTelegramArchiveIdempotencyKey(f');
    expect(clientDocumentPage).toContain('createTelegramArchiveIdempotencyKey(f');
    expect(fileManager).not.toContain('uploadKeys.current');
    expect(shipmentPage).not.toContain('uploadKeys.current');
    expect(clientDocumentPage).not.toContain('uploadKeys.current');
  });

  it('enforces the Telegram download-size limit while streaming at the server', () => {
    expect(gateway).toContain('maxOverride?:number');
    expect(gateway).toContain('uploadStream(c,chat,name,mime,size,req.body,"file",TG_DOWNLOAD_LIMIT,archiveCaption)');
    expect(fileManagerClient).toContain('FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES = 20 * 1024 * 1024');
    expect(fileManagerClient).toContain('FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES');
  });

  it('does not OCR, inspect or send new Telegram-backed file contents to AI', () => {
    expect(fileManager).not.toContain('tesseract');
    expect(fileManager).not.toContain('ai-assistant');
    expect(fileManager).toContain('uploadTelegramArchivedFile');
    expect(documentPage).toContain("d.storage_backend === 'telegram' || d.file_asset_id");
    expect(preDeclaration).toContain("docs.filter(d=>d.storage_backend!=='telegram'&&!d.file_asset_id)");
  });

  it('shares one Telegram upload path between shipment creation and document manager', () => {
    expect(shipmentPage).toContain('uploadTelegramArchivedFile');
    expect(shipmentPage).toContain('getDefaultShipmentUploadFolder(selected)');
    expect(shipmentPage).not.toMatch(/storage\.from\(BUCKET\)\.upload\(/);
    expect(documentPage).toContain('uploadTelegramArchivedFile');
    expect(documentPage).not.toMatch(/storage\.from\(BUCKET\)\.upload\(/);
    expect(clientDocumentPage).toContain('uploadTelegramArchivedFile');
    expect(clientDocumentPage).not.toMatch(/storage\.from\(BUCKET\)\.upload\(/);
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
    expect(fileManager).toContain('همگام‌سازی ویندوز');
    expect(fileManager).toContain("crypto.subtle.digest('SHA-256', bytes)");
    expect(fileManager).toContain('const keyMaterial = [organizationId, parent.id, relativePath, local.file.size, localHash].join');
    expect(fileManager).toContain('هیچ فایلی از هیچ‌کدام از دو طرف حذف یا بازنویسی نشد.');
    expect(fileManager).toContain('remote.file_asset_id && Number(remote.size_bytes) > FILE_ARCHIVE_MAX_BYTES');
    expect(fileManager).toContain('همگام‌سازی خودکار پس‌زمینه در این نسخه وجود ندارد');
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
    expect(folderCopyMigration).toContain("and not (fm.metadata ? 'copyAliasSourceFileId')");
  });

  it('adds searchable Persian Telegram archive captions with customs and kottaj details', () => {
    expect(gateway).toContain('📁 آرشیو فایل Customs OS');
    expect(gateway).toContain('customsOfficeName');
    expect(gateway).toContain('kottajNumber');
    expect(gateway).toContain('searchHashtags');
  });

  it('registers the page and exposes it from the main navigation', () => {
    expect(app).toContain('path="/file-manager"');
    expect(app).toContain("import('./pages/FileManagerPage')");
    expect(navigation).toContain("to: '/file-manager'");
  });
});
