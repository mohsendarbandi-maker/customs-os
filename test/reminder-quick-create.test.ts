import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/features/reminders/RemindersPage.tsx'), 'utf8');

describe('reminder quick-create shipment linking', () => {
  it('sends the selected shipment and its case through the tenant-validated create RPC payload', () => {
    expect(source).toContain("shipment_id:shipment?.id??null,case_id:shipment?.caseId??null");
    expect(source).toContain("rpcWithOfflineQueue('create_operational_reminder',{p_payload:payload})");
    expect(source).toContain(".eq('organization_id',profile.organization_id)");
  });

  it('persists the selected shipment with the composer draft and restores it after reopening', () => {
    expect(source).toContain('shipment:quickShipment,savedAt:Date.now()');
    expect(source).toContain('setQuickShipment(restoredShipment)');
    expect(source).toContain('if(!hasDraft){');
    expect(source).toContain('removeDraftValue(composerDraftKey)');
    expect(source).toContain("sessionStorage.removeItem('customs-os-reminder-composer-v1:");
  });

  it('keeps the composer draft when create fails and retains remaining lines in a multi-line submission', () => {
    expect(source).toContain('catch{setComposerOpen(true);return false;}');
    expect(source).toContain("setComposer(lines.slice(i).join('\\n'))");
    expect(source).toContain('setQuickShipment(quickShipment);setComposerOpen(true);return;');
  });

  it('shows an optional shipment picker without replacing the existing reminder composer', () => {
    expect(source).toContain('اتصال به محموله');
    expect(source).toContain('جستجوی محموله برای یادآور');
    expect(source).toContain('حذف پیوند محموله');
    expect(source).toContain('id="reminder-quick-input"');
  });
});
