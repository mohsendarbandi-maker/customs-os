import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Telegram-backed Customs OS file manager', () => {
  const migration = read('supabase/migrations/20261024130000_file_manager_logical_folders_telegram_archive.sql');
  const uploadJobs = read('supabase/migrations/20261024130100_file_manager_upload_jobs.sql');
  const gateway = read('supabase/functions/messenger-gateway/index.ts');
  const fileManager = read('src/pages/FileManagerPage.tsx');
  const fileManagerClient = read('src/lib/fileManager.ts');
  const shipmentPage = read('src/pages/ShipmentFirstPage.tsx');
  const documentPage = read('src/pages/CustomsDocumentManagerPage.tsx');
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

  it('enforces the Telegram download-size limit while streaming at the server', () => {
    expect(gateway).toContain('maxOverride?:number');
    expect(gateway).toContain('archive?TG_DOWNLOAD_LIMIT:undefined');
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
  });

  it('provides global business/document search, and preserves organization scoping in the RPC', () => {
    expect(migration).toContain('create or replace function public.search_file_manager');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('public.user_org_id()');
    expect(migration).toContain('public.shipment_customs_data');
    expect(migration).toContain('public.customs_declarations');
    expect(migration).toContain('public.vessels');
    expect(migration).toContain('public.file_manager_files');
    expect(fileManager).toContain("supabase.rpc('search_file_manager'");
  });

  it('provides manual Windows folder import/export while being explicit that this is not background sync', () => {
    expect(fileManager).toContain('webkitdirectory');
    expect(fileManager).toContain('showDirectoryPicker');
    expect(fileManager).toContain('ساختار پوشه‌ها');
    expect(fileManager).toContain('همگام‌سازی دائمی در پس‌زمینه نیست');
  });

  it('registers the page and exposes it from the main navigation', () => {
    expect(app).toContain('path="/file-manager"');
    expect(app).toContain("import('./pages/FileManagerPage')");
    expect(navigation).toContain("to: '/file-manager'");
  });
});
