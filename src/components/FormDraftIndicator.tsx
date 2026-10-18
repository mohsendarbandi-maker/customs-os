import React from 'react';
import { CheckCircle2, Loader2, Save, ShieldCheck } from 'lucide-react';
import type { AutosavedDraftStatus } from '../hooks/useAutosavedDraft';
import { Badge, Button, type BadgeTone } from './ui';

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
          : status === 'restoring'
            ? 'در حال بازیابی پیش‌نویس…'
            : 'ذخیره خودکار فعال است';

  const tone: BadgeTone =
    status === 'saved' || status === 'restored' ? 'success' :
    status === 'saving' || status === 'restoring' ? 'warning' :
    status === 'error' ? 'danger' : 'neutral';

  const icon = status === 'saving' || status === 'restoring'
    ? <Loader2 size={14} className="ds-spin" />
    : status === 'saved' || status === 'restored'
      ? <CheckCircle2 size={14} />
      : <ShieldCheck size={14} />;

  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <Badge tone={tone} icon={icon}>{label}</Badge>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={status === 'restoring'}
        onClick={() => { onSave(); }}
        startIcon={<Save size={14} />}
      >
        ذخیره پیش‌نویس
      </Button>
      <span className="sr-only">ذخیره موقت فقط برای همین حساب و همین دستگاه است.</span>
    </div>
  );
};
