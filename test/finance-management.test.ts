import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { calculateOutstanding, formatCurrency, paidByLabel } from '../src/lib/finance';

const root = path.resolve(process.cwd());
const financeMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260930000000_finance_management_module.sql'),
  'utf8',
);
const financePage = fs.readFileSync(
  path.join(root, 'src/pages/FinancePage.tsx'),
  'utf8',
);
const voucherPage = fs.readFileSync(
  path.join(root, 'src/pages/CustomsAccountingVoucherPage.tsx'),
  'utf8',
);
const paymentPrint = fs.readFileSync(
  path.join(root, 'src/pages/PaymentRequestPrintPage.tsx'),
  'utf8',
);

describe('Finance management invariants', () => {
  it('calculates outstanding claim from company costs + profit - received', () => {
    expect(calculateOutstanding(100_000, 20_000, 30_000)).toBe(90_000);
    expect(calculateOutstanding(100_000, 20_000, 130_000)).toBe(0);
  });

  it('keeps direct client payments out of the claim and labels payment sources', () => {
    expect(paidByLabel('our_company')).toBe('شرکت ما');
    expect(paidByLabel('client_direct')).toBe('پرداخت مستقیم صاحب کالا');
    expect(financePage).toContain("paid_by==='our_company'");
    expect(financePage).toContain("paid_by==='client_direct'");
  });

  it('uses the shared financial number formatter', () => {
    expect(formatCurrency(1234567, 'IRR')).toContain('۱٬۲۳۴٬۵۶۷');
    expect(financePage).toContain('formatMoney');
  });

  it('enforces pending-only editing and approval workflow in SQL', () => {
    expect(financeMigration).toContain("approval_status='pending'");
    expect(financeMigration).toContain("Rejected expense requires reason");
    expect(financeMigration).toContain("approve_finance_expense");
    expect(financeMigration).toContain("create policy finance_ci_update");
    expect(financeMigration).toContain("Expense creator cannot approve or reject their own expense");
  });

  it('binds client-role expense creation to that client identity', () => {
    expect(financeMigration).toContain("public.user_role()) <> 'client'::public.user_role");
    expect(financeMigration).toContain("client_id=(select public.user_client_id())");
  });

  it('protects personal finance visibility through configurable permissions', () => {
    expect(financeMigration).toContain("finance_has_permission('view_own_expenses')");
    expect(financeMigration).toContain("finance_has_permission('view_own_petty_cash')");
    expect(financeMigration).toContain("finance_has_permission('view_own_receipts')");
    expect(financeMigration).toContain("finance_has_permission('view_profit')");
  });

  it('supports three payment-request trigger points and server-side claim position', () => {
    expect(financeMigration).toContain('at_registration');
    expect(financeMigration).toContain('mid_process');
    expect(financeMigration).toContain('final_settlement');
    expect(financeMigration).toContain('finance_shipment_position');
    expect(financePage).toContain("supabase.rpc('finance_shipment_position'");
  });

  it('links approved costs to existing accounting voucher lines without rebuilding the voucher module', () => {
    expect(voucherPage).toContain('source_cost_item_id');
    expect(voucherPage).toContain('loadApprovedCosts');
    expect(voucherPage).toContain('importApprovedCosts');
    expect(financeMigration).toContain('uq_active_voucher_line_source_cost');
  });

  it('never prints hidden profit in the payment-request or accounting-voucher outputs', () => {
    expect(paymentPrint).not.toContain('voucher_line_profit');
    expect(paymentPrint).not.toContain('profit_amount');
    const voucherPrint = fs.readFileSync(
      path.join(root, 'src/pages/CustomsAccountingVoucherPrintPage.tsx'),
      'utf8',
    );
    expect(voucherPrint).not.toContain('voucher_line_profit');
    expect(voucherPrint).not.toContain('profit_amount');
  });

  it('uses camera capture for mobile expense receipts', () => {
    expect(financePage).toContain('capture="environment"');
    expect(financePage).toContain('accept="image/*,application/pdf"');
  });
});
