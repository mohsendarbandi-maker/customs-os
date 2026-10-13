import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../src/features/reminders/RemindersPage.tsx'), 'utf8');

describe('reminder source navigation', () => {
  it('maps each linked source type to its existing application route', () => {
    expect(source).toContain("if(type==='shipments')return '/operations?shipmentId='+encoded");
    expect(source).toContain("if(type==='cases')return '/cases?caseId='+encoded");
    expect(source).toContain("if(type==='finance_invoices')return '/finance/invoices/'+encoded");
    expect(source).toContain("if(type==='clients')return '/clients?clientId='+encoded");
    expect(source).toContain("if(type==='customs_documents'||type==='shipment_documents'||type==='documents')return '/documents?documentId='+encoded");
  });

  it('falls back to the existing shipment/case foreign keys and safely encodes identifiers', () => {
    expect(source).toContain("if(r.shipment_id)return '/operations?shipmentId='+encodeURIComponent(r.shipment_id)");
    expect(source).toContain("if(r.case_id)return '/cases?caseId='+encodeURIComponent(r.case_id)");
    expect(source).toContain('encodeURIComponent(id)');
  });

  it('makes linked-source navigation an explicit accessible action, not a destructive reminder action', () => {
    expect(source).toContain('aria-label="رفتن به مورد مرتبط"');
    expect(source).toContain('disabled={!reminderEntityHref(r)}');
    expect(source).toContain('e.stopPropagation();const href=reminderEntityHref(r);if(href)navigate(href);');
  });
});
