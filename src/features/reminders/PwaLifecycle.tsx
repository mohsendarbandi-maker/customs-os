import React, { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useLocation } from 'react-router-dom';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

export const PwaLifecycle: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosGuide, setIosGuide] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const updaterRef = useRef<UpdateSW | null>(null);
  const location = useLocation();

  // One manifest and one icon belong to the canonical app. Routes only change the
  // document title; they must never mutate install identity or theme/icon metadata.
  const areaLabel = 'Customs OS';
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) document.title = 'چت سازمانی | Customs OS';
    else if (location.pathname.startsWith('/reminders')) document.title = 'یادآورها | Customs OS';
    else if (location.pathname !== '/login' && location.pathname !== '/onboarding') {
      document.title = 'Customs OS | سیستم مدیریت گمرک';
    }
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        try {
          updaterRef.current = registerSW({
            immediate: true,
            // Never reload a page just because an update was found: an operational
            // form/chat composer may contain unsaved text. Ask the user first.
            onNeedRefresh: () => setUpdateReady(true),
            onNeedReload: () => undefined,
            onOfflineReady: () => undefined,
            onRegisterError: (error) => console.warn('[PWA] service worker registration failed:', error),
          });
        } catch (error) {
          console.error('[PWA] service worker registration failed:', error);
        }
      }, 1500);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('load', start);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const updateKeyboardHeight = () => {
      document.documentElement.style.setProperty(
        '--reminder-keyboard-height',
        Math.max(0, window.innerHeight - visualViewport.height) + 'px',
      );
    };
    updateKeyboardHeight();
    visualViewport.addEventListener('resize', updateKeyboardHeight);
    visualViewport.addEventListener('scroll', updateKeyboardHeight);
    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardHeight);
      visualViewport.removeEventListener('scroll', updateKeyboardHeight);
    };
  }, []);

  useEffect(() => {
    try {
      if (isIos() && !standalone() && localStorage.getItem('customs-os-ios-install-dismissed') !== '1') {
        setIosGuide(true);
      }
    } catch (error) {
      console.warn('[PWA] localStorage unavailable:', error);
    }
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  };

  const dismissIos = () => {
    try {
      localStorage.setItem('customs-os-ios-install-dismissed', '1');
    } catch (error) {
      console.warn('[PWA] unable to persist iOS guide state:', error);
    }
    setIosGuide(false);
  };

  const applyUpdate = async () => {
    const updater = updaterRef.current;
    if (!updater || applyingUpdate) return;
    setApplyingUpdate(true);
    try {
      // This is a deliberate user action; tell users to save any in-progress form
      // before confirming because activation may reload this tab.
      await updater(true);
    } catch (error) {
      console.warn('[PWA] update activation failed:', error);
      setApplyingUpdate(false);
    }
  };

  return (
    <>
      {installEvent && !standalone() && (
        <div dir="rtl" className="pwa-install-prompt fixed bottom-4 right-4 left-4 md:left-auto md:w-[380px] z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب {areaLabel}</b>
          <p className="text-xs app-muted mt-1">برای دسترسی سریع، اجرای مستقیم برنامه و اعلان‌های واقعی، آن را به صفحه اصلی اضافه کنید.</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => void install()} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">نصب برنامه</button>
            <button type="button" onClick={() => setInstallEvent(null)} className="min-h-11 px-4 rounded-xl border app-border">بعداً</button>
          </div>
        </div>
      )}
      {iosGuide && !standalone() && (
        <div dir="rtl" className="pwa-ios-install-guide fixed inset-x-3 bottom-3 z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب {areaLabel} در آیفون</b>
          <ol className="text-xs app-muted mt-2 space-y-1 pr-4 list-decimal">
            <li>دکمه «اشتراک‌گذاری» را در Safari بزنید.</li>
            <li>گزینه «افزودن به صفحه اصلی» را انتخاب کنید.</li>
            <li>برنامه را از صفحه اصلی باز کنید تا در حالت مستقل اجرا شود.</li>
          </ol>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={dismissIos} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">متوجه شدم</button>
            <button type="button" onClick={() => setIosGuide(false)} className="min-h-11 px-4 rounded-xl border app-border">بستن</button>
          </div>
        </div>
      )}
      {updateReady && (
        <div dir="rtl" role="status" aria-live="polite" className="pwa-update-prompt fixed inset-x-3 z-[510] rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl">
          <b className="block text-sm">نسخهٔ جدید آماده است</b>
          <p className="mt-1 text-xs app-muted">برای جلوگیری از ازدست‌رفتن فرم یا پیام نیمه‌کاره، ابتدا اطلاعات در حال ویرایش را ذخیره کنید؛ سپس برنامه را به‌روز کنید.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={applyingUpdate} onClick={() => void applyUpdate()} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-white disabled:opacity-60">
              {applyingUpdate ? 'در حال به‌روزرسانی…' : 'ذخیره کردم؛ به‌روزرسانی'}
            </button>
            <button type="button" disabled={applyingUpdate} onClick={() => setUpdateReady(false)} className="min-h-11 rounded-xl border app-border px-3 text-sm font-bold disabled:opacity-60">بعداً</button>
          </div>
        </div>
      )}
      {!online && (
        <div dir="rtl" className="fixed top-[calc(66px+env(safe-area-inset-top))] inset-x-3 z-[300] rounded-xl bg-[var(--surface)] border app-border px-3 py-2 text-xs shadow-lg">
          آفلاین · داده‌های ذخیره‌شده ممکن است قدیمی باشند؛ ثبت جدید صف می‌شود، ویرایش و تغییر وضعیت نیازمند اینترنت است.
        </div>
      )}
    </>
  );
};

export const isPwaInstalled = standalone;
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> };
