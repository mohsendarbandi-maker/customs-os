import {describe,it,expect} from'vitest';
import{approvalLabel,formatCurrency,normalizeDigits,paidByLabel,paymentRequestStatusLabel,triggerPointLabel}from'./finance';

describe('finance utilities',()=>{
 it('formats IRR without decimal noise',()=>expect(formatCurrency(1250000,'IRR')).toBe('۱٬۲۵۰٬۰۰۰'));
 it('formats foreign currency with two decimals',()=>expect(formatCurrency(1250.5,'USD')).toBe('۱٬۲۵۰٫۵۰'));
 it('normalizes Persian digits for finance inputs',()=>expect(normalizeDigits('۱۲۳٬۴۵۶')).toBe('123456'));
 it('keeps paid_by semantics explicit',()=>{
  expect(paidByLabel('our_company')).toContain('شرکت');
  expect(paidByLabel('client_direct')).toContain('مستقیم');
 });
 it('maps workflow statuses and trigger points',()=>{
  expect(approvalLabel('pending')).toBe('در انتظار تأیید');
  expect(paymentRequestStatusLabel('partially_paid')).toBe('پرداخت جزئی');
  expect(triggerPointLabel('final_settlement')).toBe('تسویه نهایی');
 });
});
