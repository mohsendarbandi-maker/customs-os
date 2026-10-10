import React from 'react';
import { CheckCircle2, Loader2, Save, ShieldCheck } from 'lucide-react';
import type { AutosavedDraftStatus } from '../hooks/useAutosavedDraft';

interface FormDraftIndicatorProps {
  status: AutosavedDraftStatus;
  onSave: () => boolean;
}

export const FormDraftIndicator: React.FC<FormDraftIndicatorProps> = ({ status, onSave }) => {
  const label = status === 'saving'
    ? 'در حال ذخیره پیش‌نویس…'
    : status === 'saved'
      ? 'پیش‌نویس ذخیره شد'
      : status === 'restored'
        ? 'پیش‌نویس قبلی بازیابی شد'
        : status === 'error'
          ? 'ذخیره خودکار ناموفق بود'
          : 'ذخیره خودکار فعال است';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs app-muted" role="status" aria-live="polite">
      {status === 'saving'
        ? <Loader2 size={14} className="animate-spin" />
        : status === 'saved' || status === 'restored'
          ? <CheckCircle2 size={14} className="text-emerald-500" />
          : <ShieldCheck size={14} />}
      <span>{label}</span>
      <button
        type="button"
        onClick={() => { onSave(); }}
        className="inline-flex items-center gap-1 rounded-lg border app-border px-2.5 py-1.5 font-bold text-[var(--text)] hover:bg-[var(--surface-2)]"
      >
        <Save size={13} />
        ذخیره پیش‌نویس
      </button>
      <span className="sr-only">ذخیره موقت فقط برای همین حساب و همین دستگاه است.</span>
    </div>
  );
};
