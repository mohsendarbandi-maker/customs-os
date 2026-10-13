import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('contextual reminder actions', () => {
  it('offers reminder creation from shipment registration and finance detail', () => {
    expect(read('src/pages/ShipmentFirstPage.tsx')).toContain('entityType="shipments" entityId={selected}');
    expect(read('src/pages/FinanceShipmentPage.tsx')).toContain('entityType="shipments" entityId={s.id}');
  });

  it('links reminders to the actual source document table', () => {
    expect(read('src/pages/CustomsDocumentManagerPage.tsx')).toContain('entityType={d.source} entityId={d.id}');
    expect(read('src/pages/CustomsDocumentManagerPage.tsx')).toContain("source: 'shipment_documents' | 'customs_documents'");
  });

  it('offers case-aware reminders and invoice-specific reminders', () => {
    expect(read('src/pages/CaseRegistryPage.tsx')).toContain("entityType={s.case_id?'cases':'shipments'}");
    expect(read('src/pages/FinancePage.tsx')).toContain('entityType="finance_invoices" entityId={x.id}');
  });

  it('reuses the existing AddReminderButton and does not add another create path', () => {
    for (const file of [
      'src/pages/ShipmentFirstPage.tsx',
      'src/pages/FinanceShipmentPage.tsx',
      'src/pages/CustomsDocumentManagerPage.tsx',
      'src/pages/CaseRegistryPage.tsx',
      'src/pages/FinancePage.tsx',
    ]) {
      expect(read(file)).toContain("features/reminders/AddReminderButton");
    }
  });
});
