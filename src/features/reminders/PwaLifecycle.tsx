import React, { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useLocation } from 'react-router-dom';

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

export const PwaLifecycle: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosGuide, setIosGuide] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const updateSW = useRef<UpdateSW | null>(null);
  const updateAvailable = useRef(false);
  const updateInProgress = useRef(false);
  const updateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activateUpdateRef = useRef<() => Promise<void>>(async () => undefined);
  const location = useLocation();

  // The install identity is always Customs OS. Only the browser-tab title changes by route.
  const pwaArea = location.pathname.startsWith('/chat')
    ? 'chat'
    : location.pathname.startsWith('/reminders')
      ? 'reminders'
      : 'app';
  const reminderEnglish = (() => {
    try {
      return localStorage.getItem('customs-reminders-language-v1') === 'en';
    } catch {
      return false;
    }
  })();
  const areaLabel = 'Customs OS';

  useEffect(() => {
    // Intentionally do not mutate manifest href, Apple touch icon, app title, or theme per route.
    // All routes belong to the same installed app, with one manifest and one PNG Home Screen icon.
    if (pwaArea === 'reminders') {
      document.title = reminderEnglish ? 'Reminders | Customs OS' : 'یادآورها | Customs OS';
    } else if (pwaArea === 'chat') {
      document.title = 'چت سازمانی | Customs OS';
    } else if (location.pathname !== '/login' && location.pathname !== '/onboarding') {
      document.title = 'Customs OS | سیستم مدیریت گمرک';
    }
  }, [location.pathname, pwaArea, reminderEnglish]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        try {
          updateSW.current = registerSW({
            immediate: true,
            // Keep the update waiting until the user taps the small toolbar sync icon.
            // Never reload automatically: an open customs form or chat draft may be active.
            onNeedRefresh: () => {
              updateAvailable.current = true;
              window.dispatchEvent(new Event('customs-os:pwa-update-ready'));
            },
            onNeedReload: () => undefined,
            onOfflineReady: () => undefined,
            onRegisterError: (error) => console.warn('[PWA] service worker registration failed:', error),
          });
        } catch (error) {
          console.error('[PWA] service worker registration failed:', error);
        }
      }, 1500);
    };

    const onUpdateRequest = () => {
      void activateUpdateRef.current();
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    start();
    window.addEventListener('customs-os:pwa-update-request', onUpdateRequest);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (updateTimeout.current) clearTimeout(updateTimeout.current);
      window.removeEventListener('customs-os:pwa-update-request', onUpdateRequest);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const setKeyboardHeight = () => {
      document.documentElement.style.setProperty(
        '--reminder-keyboard-height',
        Math.max(0, window.innerHeight - visualViewport.height) + 'px',
      );
    };
    setKeyboardHeight();
    visualViewport.addEventListener('resize', setKeyboardHeight);
    visualViewport.addEventListener('scroll', setKeyboardHeight);
    return () => {
      visualViewport.removeEventListener('resize', setKeyboardHeight);
      visualViewport.removeEventListener('scroll', setKeyboardHeight);
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

  const activateUpdate = async () => {
    if (!updateAvailable.current || updateInProgress.current) return;
    const activate = updateSW.current;
    if (!activate || !('serviceWorker' in navigator)) {
      window.dispatchEvent(new Event('customs-os:pwa-update-failed'));
      return;
    }

    updateInProgress.current = true;
    window.dispatchEvent(new Event('customs-os:pwa-update-started'));
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      if (updateTimeout.current) clearTimeout(updateTimeout.current);
      updateTimeout.current = null;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    // A failed or unsupported activation must not leave the toolbar icon spinning forever.
    updateTimeout.current = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      updateTimeout.current = null;
      updateInProgress.current = false;
      window.dispatchEvent(new Event('customs-os:pwa-update-failed'));
    }, 12000);

    try {
      // Ask the waiting worker to activate; reload only after it controls this tab.
      await activate(false);
    } catch (error) {
      console.warn('[PWA] activating the new version failed:', error);
      if (updateTimeout.current) clearTimeout(updateTimeout.current);
      updateTimeout.current = null;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      updateInProgress.current = false;
      window.dispatchEvent(new Event('customs-os:pwa-update-failed'));
    }
  };
  activateUpdateRef.current = activateUpdate;

  return (
    <>
      {installEvent && !standalone() && (
        <div dir="rtl" className="pwa-install-prompt fixed bottom-4 right-4 left-4 md:left-auto md:w-[380px] z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب {areaLabel}</b>
          <p className="text-xs app-muted mt-1">برای دسترسی سریع به همهٔ بخش‌ها و دریافت اعلان‌ها، برنامهٔ Customs OS را به صفحهٔ اصلی اضافه کنید.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => void install()} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">نصب برنامه</button>
            <button onClick={() => setInstallEvent(null)} className="min-h-11 px-4 rounded-xl border app-border">بعداً</button>
          </div>
        </div>
      )}

      {iosGuide && !standalone() && (
        <div dir="rtl" className="pwa-ios-install-guide fixed inset-x-3 bottom-3 z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl">
          <b>نصب Customs OS در آیفون</b>
          <ol className="text-xs app-muted mt-2 space-y-1 pr-4 list-decimal">
            <li>دکمه «اشتراک‌گذاری» را در Safari بزنید.</li>
            <li>گزینه «افزودن به صفحه اصلی» را انتخاب کنید.</li>
            <li>برنامهٔ Customs OS را از صفحهٔ اصلی باز کنید؛ چت و یادآورها داخل همین برنامه هستند.</li>
          </ol>
          <div className="flex gap-2 mt-3">
            <button onClick={dismissIos} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">متوجه شدم</button>
            <button onClick={() => setIosGuide(false)} className="min-h-11 px-4 rounded-xl border app-border">بستن</button>
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
