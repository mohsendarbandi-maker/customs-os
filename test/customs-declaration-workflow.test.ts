import { describe, expect, it } from 'vitest';
import {
  addJalaliMonths,
  compareJalaliDates,
  getAbandonedGoodsWarnings,
  getWorkflowStageIssues,
  getInitialCustomsWorkflowStage,
  shouldShowAssessmentStage,
  isJalaliDeadlinePassed,
  parseJalaliDate,
} from '../src/lib/customsDeclarationWorkflow';

describe('customs workflow Jalali dates', () => {
  it('accepts Persian and Arabic digits and normalizes separators', () => {
    expect(parseJalaliDate('۱۴۰۵/۰۷/۲۱')).toEqual({ year: 1405, month: 7, day: 21 });
    expect(parseJalaliDate('١٤٠٥-٠٧-٢١')).toEqual({ year: 1405, month: 7, day: 21 });
    expect(addJalaliMonths('۱۴۰۵.۰۶.۳۱', 1)).toBe('1405/07/30');
    expect(parseJalaliDate('1405/12/29')).toEqual({ year: 1405, month: 12, day: 29 });
    expect(addJalaliMonths('1405/12/29', 1)).toBe('1406/01/29');
  });

  it('rejects impossible Jalali dates instead of silently treating them as valid', () => {
    expect(parseJalaliDate('1405/13/01')).toBeNull();
    expect(parseJalaliDate('1405/07/31')).toBeNull();
    expect(parseJalaliDate('not-a-date')).toBeNull();
    expect(addJalaliMonths('1405/13/01', 1)).toBeNull();
  });

  it('treats the one-month anniversary as due and avoids a false warning before it', () => {
    expect(isJalaliDeadlinePassed('1405/06/31', 1, new Date('2026-10-21T12:00:00Z'))).toBe(false);
    expect(isJalaliDeadlinePassed('1405/06/31', 1, new Date('2026-10-22T12:00:00Z'))).toBe(true);
  });

  it('compares valid Jalali dates and returns null when either date is invalid', () => {
    expect(compareJalaliDates('1405/07/20', '1405/07/21')).toBe(-1);
    expect(compareJalaliDates('1405/07/21', '1405/07/21')).toBe(0);
    expect(compareJalaliDates('1405/07/22', '1405/07/21')).toBe(1);
    expect(compareJalaliDates('1405/07/31', '1405/07/21')).toBeNull();
  });

  it('raises the correct abandoned-goods warnings and clears a warning when its event is recorded', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(getAbandonedGoodsWarnings({
      loadingFormReceivedAt: '1405/06/31',
      warehouseReceiptAt: '1405/04/31',
    }, now)).toEqual({ loadingFormExpired: true, receiptExpired: true, any: true });

    expect(getAbandonedGoodsWarnings({
      loadingFormReceivedAt: '1405/06/31',
      loadingCompletedAt: '1405/07/20',
      warehouseReceiptAt: '1405/04/31',
      loadingStartedAt: '1405/07/15',
    }, now)).toEqual({ loadingFormExpired: false, receiptExpired: false, any: false });
  });
});

const readyWorkflow = () => ({
  customsPath: 'green',
  evaluation: { status: 'not_required', expert_requested: false },
  expertise: {
    appointment_status: 'scheduled',
    road_authority_status: 'not_required',
    plant_quarantine_status: 'not_required',
    standard: { expert_review: 'not_required' },
  },
  cashier: { method: 'cash', cash_paid_irr: '0' },
  loadingPermit: { tax_permission_status: 'not_required', central_bank_status: 'not_required' },
  exit: {
    loading_permission_status: 'approved',
    financial_registration_status: 'registered',
    weighbridge_required: false,
    loading_completed_at: '1405/07/20',
  },
  port: {
    warehouse_receipt_date: '1405/07/20',
    insurance_issue_date: '1405/07/19',
    insurance_followup_status: 'pending',
    initial_invoice_status: 'received',
    transport_power_of_attorney_status: 'received',
    loading_form_received_at: '1405/07/20',
    last_truck_loaded_at: '',
    supplemental_invoice_status: 'not_required',
  },
});

describe('route-aware assessment stage visibility', () => {
  it('does not show assessment for green/yellow routes until a customs request or active status exists', () => {
    const optional = { status: 'not_required', expert_requested: false };
    expect(shouldShowAssessmentStage('green', optional)).toBe(false);
    expect(shouldShowAssessmentStage('yellow', optional)).toBe(false);
    expect(shouldShowAssessmentStage('red', optional)).toBe(true);
    expect(shouldShowAssessmentStage('green', { ...optional, expert_requested: true })).toBe(true);
    expect(shouldShowAssessmentStage('green', { status: 'required', expert_requested: false })).toBe(true);
    expect(shouldShowAssessmentStage('green', { status: 'completed', expert_requested: false })).toBe(true);
  });

  it('skips a stale default assessment stage for green/yellow routes without modifying assessment data', () => {
    expect(getInitialCustomsWorkflowStage('evaluation', 'green', { status: 'not_required', expert_requested: false })).toBe('expertise');
    expect(getInitialCustomsWorkflowStage('evaluation', 'yellow', { status: 'not_required', expert_requested: false })).toBe('expertise');
    expect(getInitialCustomsWorkflowStage('evaluation', 'red', { status: 'required', expert_requested: false })).toBe('evaluation');
    expect(getInitialCustomsWorkflowStage('port_charges', 'green', { status: 'not_required', expert_requested: false })).toBe('port_charges');
  });
});

describe('customs workflow stage prerequisites', () => {
  it('skips evaluation on green but requires a completed evaluation on red', () => {
    const state = readyWorkflow();
    expect(getWorkflowStageIssues('evaluation', state)).toEqual([]);
    state.customsPath = 'red';
    expect(getWorkflowStageIssues('evaluation', state)).toHaveLength(1);
    state.evaluation.status = 'completed';
    state.evaluation.evaluator_number = '2';
    expect(getWorkflowStageIssues('evaluation', state)).toEqual([]);
  });

  it('requires the evaluator number when an evaluation is completed', () => {
    const state = readyWorkflow();
    state.customsPath = 'red';
    state.evaluation.status = 'completed';
    expect(getWorkflowStageIssues('evaluation', state)).toContain('شماره ارزیاب را ثبت کنید.');
    state.evaluation.evaluator_number = '3';
    expect(getWorkflowStageIssues('evaluation', state)).toEqual([]);
  });

  it('requires assessment when a customs officer requests it on a green route', () => {
    const state = readyWorkflow();
    state.customsPath = 'green';
    state.evaluation.expert_requested = true;
    expect(getWorkflowStageIssues('evaluation', state)).toContain(
      'ارزیابی الزامی است؛ نتیجه ارزیابی را تکمیل کنید.',
    );
    state.evaluation.status = 'completed';
    state.evaluation.evaluator_number = '1';
    expect(getWorkflowStageIssues('evaluation', state)).toEqual([]);
  });

  it('blocks standards release until inspection, lab results, fee and notification are recorded', () => {
    const state = readyWorkflow();
    state.expertise.standard = {
      expert_review: 'approved',
      inspection_status: 'sampled',
      inspection_paid: true,
      inspection_invoice_status: 'received',
      sample_status: 'sent_to_lab',
      results_uploaded: false,
      standard_fee_paid: false,
      standard_notified: false,
    };
    const issues = getWorkflowStageIssues('expertise', state);
    expect(issues).toContain('نتیجه آزمایش نمونه باید دریافت شود یا صریحاً غیرلازم ثبت شود.');
    expect(issues).toContain('نتایج آزمایش باید در سامانه استاندارد بارگذاری شود.');
    expect(issues).toContain('پرداخت کارمزد استاندارد باید ثبت شود.');
    expect(issues).toContain('اطلاع‌رسانی پرداخت به استاندارد باید ثبت شود.');
    state.expertise.standard = {
      expert_review: 'approved',
      inspection_status: 'completed',
      inspection_paid: true,
      inspection_invoice_status: 'received',
      sample_status: 'received',
      results_uploaded: true,
      standard_fee_paid: true,
      standard_notified: true,
    };
    expect(getWorkflowStageIssues('expertise', state)).toEqual([]);
  });

  it('requires cashier payment details and a selected central-bank route', () => {
    const state = readyWorkflow();
    state.cashier.method = 'pending';
    expect(getWorkflowStageIssues('cashier', state)).toHaveLength(1);
    state.loadingPermit.central_bank_status = 'awaiting_sata';
    state.loadingPermit.clause2_request_status = 'pending';
    expect(getWorkflowStageIssues('loading_permit', state)).toContain('درخواست تبصره ۲ منطقه آزاد باید تأیید یا صریحاً غیرلازم ثبت شود.');
    expect(getWorkflowStageIssues('loading_permit', state)).toHaveLength(2);
    state.loadingPermit.clause2_request_status = 'not_required';
    state.loadingPermit.clearance_90_percent_requested = true;
    state.loadingPermit.comment = 'درخواست ترخیص باقیمانده بدون کد ساتا';
    expect(getWorkflowStageIssues('loading_permit', state)).toEqual([]);
  });

  it('flags insurance issued on/after warehouse receipt until follow-up is completed', () => {
    const state = readyWorkflow();
    state.port.insurance_issue_date = '1405/07/20';
    expect(getWorkflowStageIssues('port_charges', state)).toContain(
      'بیمه‌نامه قبل از قبض انبار نیست؛ پیگیری بیمه/پوشش تکمیلی را تکمیل کنید.',
    );
    state.port.insurance_followup_status = 'completed';
    expect(getWorkflowStageIssues('port_charges', state)).not.toContain(
      'بیمه‌نامه قبل از قبض انبار نیست؛ پیگیری بیمه/پوشش تکمیلی را تکمیل کنید.',
    );
  });

  it('allows an explicitly documented insurance follow-up waiver when the policy date is not before warehouse receipt', () => {
    const state = readyWorkflow();
    state.port.insurance_issue_date = '1405/07/20';
    state.port.insurance_followup_status = 'not_required';
    expect(getWorkflowStageIssues('port_charges', state)).not.toContain(
      'بیمه‌نامه قبل از قبض انبار نیست؛ پیگیری بیمه/پوشش تکمیلی را تکمیل کنید.',
    );
  });

  it('requires a supplemental invoice when the last truck has been loaded', () => {
    const state = readyWorkflow();
    state.port.last_truck_loaded_at = '1405/07/21';
    expect(getWorkflowStageIssues('port_charges', state)).toContain(
      'با ثبت بارگیری کامیون آخر، دریافت یا پرداخت صورتحساب متمم را ثبت کنید.',
    );
    state.port.supplemental_invoice_status = 'received';
    expect(getWorkflowStageIssues('port_charges', state)).not.toContain(
      'با ثبت بارگیری کامیون آخر، دریافت یا پرداخت صورتحساب متمم را ثبت کنید.',
    );
  });
});
