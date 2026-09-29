export const FINANCE_CURRENCIES = ['IRR','USD','EUR','AED','CNY','RUB','GBP','CHF','TRY'] as const;
export type FinanceCurrency = typeof FINANCE_CURRENCIES[number];

export const formatCurrency = (value: number | string | null | undefined, currency = 'IRR') => {
  const n = Number(value ?? 0);
  const digits = currency === 'IRR' ? 0 : 2;
  return new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
};

export const currencyLabel = (currency: string) => currency === 'IRR' ? 'ریال' : currency;

export const formatMoney = (value: number | string | null | undefined, currency = 'IRR') =>
  `${formatCurrency(value, currency)} ${currencyLabel(currency)}`;

export const normalizeDigits = (value: string) =>
  value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,]/g, '');

export const parseFinanceNumber = (value: string | number | null | undefined) => {
  const normalized = normalizeDigits(String(value ?? ''));
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const paidByLabel = (value: string) =>
  value === 'our_company' ? 'شرکت ما' :
  value === 'client_direct' ? 'پرداخت مستقیم صاحب کالا' : value || '—';

export const approvalLabel = (value: string) =>
  value === 'pending' ? 'در انتظار تأیید' :
  value === 'approved' ? 'تأییدشده' :
  value === 'rejected' ? 'ردشده' : value || '—';

export const paymentRequestStatusLabel = (value: string) =>
  value === 'draft' ? 'پیش‌نویس' :
  value === 'sent' || value === 'issued' ? 'ارسال‌شده' :
  value === 'paid' ? 'پرداخت‌شده' :
  value === 'partially_paid' ? 'پرداخت جزئی' :
  value === 'cancelled' ? 'لغوشده' : value || '—';

export const triggerPointLabel = (value: string) =>
  value === 'at_registration' ? 'ابتدای ثبت محموله' :
  value === 'mid_process' ? 'میانه فرآیند' :
  value === 'final_settlement' ? 'تسویه نهایی' : value || '—';

export const calculateOutstanding = (ourCompanyCosts: number, profit: number, received: number) =>
  Math.max(0, Number(ourCompanyCosts || 0) + Number(profit || 0) - Number(received || 0));

export const pettyCashDirectionLabel = (value: string) =>
  value === 'allocated' ? 'تخصیص' :
  value === 'spent' ? 'هزینه‌کرد' :
  value === 'returned' ? 'عودت' : value || '—';
