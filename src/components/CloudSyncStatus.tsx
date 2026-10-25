import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import {
  flushOfflineQueue,
  listQueue,
  retryQueuedRpc,
  subscribeOfflineQueue,
  type QueuedRpc,
} from '../lib/offlineQueue';

type CloudSyncStatusProps = {
  online: boolean;
  enabled: boolean;
};

export const CloudSyncStatus: React.FC<CloudSyncStatusProps> = ({ online, enabled }) => {
  const [items, setItems] = useState<QueuedRpc[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return undefined;
    }

    const unsubscribe = subscribeOfflineQueue(setItems);
    const refresh = () => {
      void listQueue().then(setItems).catch(() => undefined);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    refresh();

    return () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled]);

  const failedCount = items.filter((item) => item.state === 'failed').length;
  const queuedCount = items.length - failedCount;

  const syncNow = async () => {
    if (!enabled || !online || busy) return;

    const confirmed = window.confirm(
      'Customs OS از فضای ابری مشترک استفاده می‌کند. تغییرات منتظر ارسال ارسال می‌شوند و صفحه برای دریافت آخرین داده‌ها دوباره بارگذاری می‌شود. قبل از ادامه، فرم‌های در حال ویرایش را ذخیره کنید. ادامه می‌دهید؟',
    );
    if (!confirmed) return;

    setBusy(true);
    setFeedback('');
    try {
      // Failed chat items can be retried by their stable client UUID.
      const queued = await listQueue();
      for (const item of queued) {
        if (item.state === 'failed') {
          try {
            await retryQueuedRpc(item.id);
          } catch {
            // Keep unresolved items visible; never clear local work silently.
          }
        }
      }

      await flushOfflineQueue();
      const remaining = await listQueue();
      setItems(remaining);

      if (remaining.length > 0) {
        setFeedback(
          remaining.length === 1
            ? 'یک تغییر هنوز ارسال نشده است؛ اطلاعات محلی حفظ شد.'
            : remaining.length.toLocaleString('fa-IR') + ' تغییر هنوز ارسال نشده‌اند؛ اطلاعات محلی حفظ شد.',
        );
        return;
      }

      window.location.reload();
    } catch {
      const remaining = await listQueue().catch(() => items);
      setItems(remaining);
      setFeedback('همگام‌سازی کامل نشد؛ تغییرات محلی حفظ شدند. دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  const label = !online
    ? 'آفلاین'
    : failedCount > 0
      ? failedCount.toLocaleString('fa-IR') + ' مورد با خطا'
      : queuedCount > 0
        ? queuedCount.toLocaleString('fa-IR') + ' تغییر در صف'
        : 'ابر متصل';

  return (
    <div className="flex items-center gap-2 min-w-0" title="داده‌ها بین دستگاه‌هایی که با یک حساب و سازمان وارد شده‌اند از فضای ابری مشترک می‌شوند.">
      <span className={`app-online-chip ${online ? 'is-online' : 'is-offline'}`}>
        {online ? <Cloud size={13} /> : <CloudOff size={13} />}
        <span>{label}</span>
      </span>
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={!online || busy}
        className="theme-cycle-btn flex items-center gap-1.5 disabled:opacity-50"
        title="ارسال تغییرات آفلاین و دریافت تازه‌ترین اطلاعات از ابر"
        aria-label="همگام‌سازی داده‌ها با فضای ابری"
      >
        <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        <span className="hidden xl:inline">{busy ? 'در حال همگام‌سازی' : 'همگام‌سازی'}</span>
      </button>
      {feedback && <span role="status" aria-live="polite" className="text-[10px] text-amber-600 max-w-44">{feedback}</span>}
    </div>
  );
};
