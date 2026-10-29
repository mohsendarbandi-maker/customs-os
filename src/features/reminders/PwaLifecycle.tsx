import React, { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useLocation } from 'react-router-dom';

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const hasUnsavedWork = () => {
  if (document.querySelector('[data-unsaved="true"], [data-pending-save="true"]')) return true;
  const active = document.activeElement;
  if (active instanceof HTMLElement &&
      active.matches('input:not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]')) {
    return true;
  }
  const chatDraft = document.querySelector<HTMLTextAreaElement>('.chat-composer textarea');
  if (chatDraft?.value.trim()) return true;
  const reminderDraft = document.querySelector<HTMLInputElement>('#reminder-quick-input');
  if (reminderDraft?.value.trim()) return true;
  return false;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

export const PwaLifecycle: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosGuide, setIosGuide] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateSW = useRef<UpdateSW | null>(null);
  const pendingUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdate = useRef(false);
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
            onNeedRefresh: () => {
              // Automatically activate a new build on a safe, idle app open so installed
              // PWAs cannot remain stuck on old CSS/JS indefinitely. When a composer or
              // form contains active work, keep the visible manual update notice instead.
              pendingUpdate.current = true;
              setNewVersionAvailable(true);
              if (pendingUpdateTimer.current) clearTimeout(pendingUpdateTimer.current);
              pendingUpdateTimer.current = setTimeout(() => {
                pendingUpdateTimer.current = null;
                if (document.visibilityState !== 'visible' || !navigator.onLine || hasUnsavedWork()) return;
                const activate = updateSW.current;
                if (!activate || !pendingUpdate.current) return;
                pendingUpdate.current = false;
                setUpdating(true);
                void activate(true).catch((error) => {
                  console.warn('[PWA] automatic safe update failed:', error);
                  setUpdating(false);
                  pendingUpdate.current = true;
                });
              }, 1800);
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

    // Start independently of the load event: this component can mount after
    // window.load has already fired, in which case waiting for that event hangs
    // registration forever. A delayed registration still keeps startup lightweight.
    start();

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
      if (pendingUpdateTimer.current) clearTimeout(pendingUpdateTimer.current);
      pendingUpdateTimer.current = null;
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
    pendingUpdate.current = false;
    if (pendingUpdateTimer.current) clearTimeout(pendingUpdateTimer.current);
    const activate = updateSW.current;
    if (!activate) {
      window.location.reload();
      return;
    }
    setUpdating(true);
    try {
      await activate(true);
    } catch (error) {
      console.warn('[PWA] activating the new version failed:', error);
      setUpdating(false);
    }
  };

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

      {newVersionAvailable && (
        <div dir="rtl" className="pwa-version-notice fixed inset-x-3 bottom-3 z-[510] rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">↻</span>
            <div className="min-w-0 flex-1">
              <b className="block text-sm">نسخهٔ جدید آماده است</b>
              <span className="block text-xs app-muted mt-1">برای جلوگیری از بسته‌شدن فرم یا گفت‌وگوی باز، زمان به‌روزرسانی با شماست.</span>
            </div>
            <button disabled={updating} onClick={() => void activateUpdate()} className="min-h-10 shrink-0 rounded-xl bg-[var(--primary)] px-3 text-xs font-bold text-white disabled:opacity-60">
              {updating ? 'در حال به‌روزرسانی…' : 'به‌روزرسانی'}
            </button>
            <button onClick={() => setNewVersionAvailable(false)} aria-label="بعداً به‌روزرسانی می‌کنم" className="min-h-10 min-w-10 rounded-xl border app-border">×</button>
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
