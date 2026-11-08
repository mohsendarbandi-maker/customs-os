import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('one-click file manager synchronization', () => {
  const page = read('src/pages/FileManagerPage.tsx');
  const sync = read('src/lib/fileManagerSync.ts');
  const smb = read('public/setup-iphone-files-share.ps1');

  it('remembers one selected local root folder and reuses it on later sync clicks', () => {
    expect(page).toContain('getSavedSyncDirectoryHandle()');
    expect(page).toContain('saveSyncDirectoryHandle(selectedHandle)');
    expect(page).toContain("getDirectoryHandle('Darbandi Commercial', { create: true })");
    expect(page).toContain('همگام‌سازی همه اطلاعات با یک کلیک');
    expect(sync).toContain("const ROOT_HANDLE_KEY = 'organization-root-directory'");
    expect(sync).toContain('requestSyncDirectoryPermission');
  });

  it('starts from the organization owners root, not the currently selected folder', () => {
    expect(page).toContain("folder.folder_key === 'owners-root'");
    expect(page).toContain('const queue: FolderRow[] = [cloudRoot]');
    expect(page).toContain('.in(\'folder_id\', folderIds)');
  });

  it('exports operational, shipping, customs, order, bank, and finance data as readable text beside each document', () => {
    for (const table of ['shipments', 'shipment_customs_data', 'vessels', 'shipping_lines', 'customs_declarations', 'registration_orders', 'financial_transactions', 'finance_invoices', 'finance_payments', 'finance_cost_items', 'customs_accounting_vouchers']) {
      expect(page).toContain("'" + table + "'");
    }
    expect(sync).toContain('buildFolderMetadataText');
    expect(sync).toContain('buildDocumentMetadataText');
    expect(page).toContain("'اطلاعات_عملیاتی.txt'");
    expect(page).toContain("fileName + '.اطلاعات.txt'");
    expect(sync).toContain('شماره کوتاژ');
    expect(sync).toContain('گردش حساب و تراکنش‌های مالی');
  });

  it('does not overwrite or delete original files and ignores its own generated text manifests on the next sync', () => {
    expect(page).toContain('conflicts += 1');
    expect(page).toContain('isManagedSyncMetadataFile(name)');
    expect(page).toContain('هیچ سند اصلی حذف یا بازنویسی نشد');
    expect(sync).toContain("name.endsWith('.اطلاعات.txt')");
  });

  it('prepares LAN-only SMB access for the iPhone Files app without exposing SMB to the internet', () => {
    expect(page).toContain('setup-iphone-files-share.ps1');
    expect(page).toContain('smb://');
    expect(smb).toContain('-RemoteAddress LocalSubnet');
    expect(smb).toContain('-Profile Private,Domain');
    expect(smb).toContain("$_.NetworkCategory -eq 'Public'");
    expect(smb).toContain('Set-NetConnectionProfile -InterfaceIndex');
    expect(smb).toContain('هیچ اتصال Private یا Domain معتبر پیدا نشد');
    expect(smb).toContain('-EnableSMB1Protocol $false');
    expect(smb).toContain('DarbandiFiles');
    expect(smb).toContain("$activeProfiles = @(Get-NetConnectionProfile");
    expect(smb.indexOf('$trustedProfiles.Count -eq 0')).toBeLessThan(smb.indexOf("$shareName = 'DarbandiCommercial'"));
  });

  it('uses a bounded breadcrumb container and keeps the folder label inside the content card', () => {
    expect(page).toContain('file-manager-breadcrumbs flex min-w-0 flex-1');
    expect(page).toContain("currentFolder?.display_name || 'فایل‌منیجر'");
    expect(page).toContain("font-normal app-muted");
    expect(page).not.toContain("currentFolder?.display_name||'پوشه'");
  });
});
