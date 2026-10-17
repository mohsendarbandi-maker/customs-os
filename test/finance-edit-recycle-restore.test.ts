import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261018000100_finance_edit_archive_restore.sql'),
  'utf8',
);
const financePage = fs.readFileSync(path.join(root, 'src/pages/FinancePage.tsx'), 'utf8');
const shipmentPage = fs.readFileSync(path.join(root, 'src/pages/FinanceShipmentPage.tsx'), 'utf8');

describe('finance edit, archive, and restore invariants', () => {
  it('lets an unapproved expense be edited through a tenant-scoped RPC and resubmits it for approval', () => {
    expect(financePage).toContain("rpc('update_finance_expense'");
    expect(financePage).toContain("['DRAFT','SUBMITTED','REJECTED']");
    expect(migration).toContain("v.workflow_status NOT IN ('DRAFT', 'SUBMITTED', 'REJECTED')");
    expect(migration).toContain("approval_status = 'pending'");
    expect(migration).toContain("workflow_status = 'SUBMITTED'");
    expect(migration).toContain('public.user_org_id()');
  });

  it('archives and restores expenses without hard-deleting them or losing prior workflow status', () => {
    expect(financePage).toContain("rpc('archive_finance_shipment_cost'");
    expect(financePage).toContain("rpc('restore_finance_shipment_cost'");
    expect(financePage).toContain("['recycle','بایگانی و بازیابی',Archive]");
    expect(migration).toContain('deleted_previous_status = status');
    expect(migration).toContain('deleted_previous_approval_status = approval_status');
    expect(migration).toContain('deleted_previous_workflow_status = workflow_status');
    expect(migration).toContain('CREATE POLICY finance_cost_items_recycle_select');
    expect(migration).toContain("v.approval_status = 'approved'");
  });

  it('restricts invoice edit/archive to unissued drafts and computes totals server-side', () => {
    expect(financePage).toContain("rpc('update_finance_draft_invoice'");
    expect(financePage).toContain("rpc('archive_finance_invoice'");
    expect(financePage).toContain("rpc('restore_finance_invoice'");
    expect(migration).toContain("v.status <> 'draft' OR v.issued_at IS NOT NULL");
    expect(migration).toContain('total_amount = v.subtotal - v_discount + v.vat_amount');
    expect(migration).toContain("r.status NOT IN ('cancelled')");
    expect(migration).toContain('CREATE POLICY finance_invoices_delete');
    expect(migration).toContain('USING (false)');
  });

  it('prevents duplicate claims when restoring an archived invoice', () => {
    expect(migration).toContain('برای جلوگیری از مطالبهٔ تکراری');
    expect(migration).toContain('i2.deleted_at IS NULL');
    expect(migration).toContain("i2.status NOT IN ('void', 'cancelled')");
    expect(migration).toContain("SET status = 'invoiced'");
    expect(migration).toContain('guard_finance_invoice_child_mutation');
    expect(migration).toContain("v_status <> 'draft' OR v_deleted_at IS NOT NULL OR v_issued_at IS NOT NULL");
  });

  it('keeps archived invoices out of active shipment finance summaries', () => {
    expect(shipmentPage).toContain('finance_invoices(id,invoice_no,status,total_amount,currency,issue_date,deleted_at)');
    expect(shipmentPage).toContain('!x.deleted_at');
  });

  it('protects archive metadata from direct client writes', () => {
    expect(migration).toContain('guard_finance_recycle_metadata');
    expect(migration).toContain("WHERE (item.key = 'deleted_at' OR left(item.key, 8) = 'deleted_')");
    expect(migration).not.toContain("WHERE (item.key = 'deleted_at' OR left(item.key, 8) = 'deleted_'\n        AND");
    expect(migration).toContain("current_setting('app.finance_recycle_write', true) = 'true'");
    expect(migration).toContain("left(item.key, 8) = 'deleted_'");
    expect(migration).toContain('Recycle metadata can only be changed through the finance archive/restore actions');
  });
});
