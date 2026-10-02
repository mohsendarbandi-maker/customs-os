import React, { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const isIos = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await registration.update();
    return registration;
  } catch {
    return null;
  }
};

export const PwaLifecycle: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [iosGuide, setIosGuide] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    void registerServiceWorker().then((registration) => {
      if (!registration) return;

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    });

    const onInstall = (event: Event): void => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);

    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (isIos() && !standalone() && localStorage.getItem('customs-os-ios-install-dismissed') !== '1') {
      setIosGuide(true);
    }
  }, []);

  const install = async (): Promise<void> => {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  };

  const dismissIos = (): void => {
    localStorage.setItem('customs-os-ios-install-dismissed', '1');
    setIosGuide(false);
  };

  return (
    <>
      {installEvent && !standalone() && (
        <div dir="rtl" className="fixed bottom-4 right-4 left-4 md:left-auto md:w-[380px] z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب برنامه</b>
          <p className="text-xs app-muted mt-1">برای اعلان‌های واقعی و دسترسی سریع، برنامه را روی گوشی یا رایانه نصب کنید.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => void install()} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">نصب برنامه</button>
            <button onClick={() => setInstallEvent(null)} className="min-h-11 px-4 rounded-xl border app-border">بعداً</button>
          </div>
        </div>
      )}

      {iosGuide && !standalone() && (
        <div dir="rtl" className="fixed inset-x-3 bottom-3 z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب در آیفون</b>
          <ol className="text-xs app-muted mt-2 space-y-1 pr-4 list-decimal">
            <li>در Safari دکمه «اشتراک‌گذاری» را بزنید.</li>
            <li>«افزودن به صفحه اصلی» را انتخاب کنید.</li>
            <li>برنامه را از صفحه اصلی باز کنید؛ سپس اعلان‌ها را فعال کنید.</li>
          </ol>
          <div className="flex gap-2 mt-3">
            <button onClick={dismissIos} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">متوجه شدم</button>
            <button onClick={() => setIosGuide(false)} className="min-h-11 px-4 rounded-xl border app-border">بستن</button>
          </div>
        </div>
      )}

      {!online && (
        <div dir="rtl" className="fixed top-[calc(66px+env(safe-area-inset-top))] inset-x-3 z-[300] rounded-xl bg-[var(--surface)] border app-border px-3 py-2 text-xs shadow-lg">
          اتصال اینترنت قطع است؛ تغییرات پشتیبانی‌شده پس از اتصال همگام می‌شوند.
        </div>
      )}

      {updateReady && (
        <div dir="rtl" className="fixed bottom-4 left-4 z-[500] rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl">
          <div className="text-sm font-bold">نسخه جدید آماده است</div>
          <button onClick={() => window.location.reload()} className="mt-2 min-h-10 rounded-xl bg-[var(--primary)] px-4 text-white font-bold">به‌روزرسانی</button>
        </div>
      )}
    </>
  );
};

export const isPwaInstalled = standalone;
