const faDigits = (value: string) => value.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Unified human-readable name for both shipment and case.
 * Format: تعداد واحد صاحب کالا کشتی
 * Example: ۸۸ رول ارس تارلا امین بیگی
 */
export const buildCargoName = (count: number | string | null | undefined, unit: string | null | undefined, owner: string | null | undefined, vessel: string | null | undefined) => {
  const parts = [
    count === null || count === undefined || String(count).trim() === '' ? '' : faDigits(clean(count)),
    clean(unit),
    clean(owner),
    clean(vessel),
  ].filter(Boolean);

  return parts.join(' ') || 'محموله بدون عنوان';
};

export const formatCount = (count: number | string | null | undefined) =>
  count === null || count === undefined || String(count).trim() === '' ? '—' : faDigits(clean(count));
