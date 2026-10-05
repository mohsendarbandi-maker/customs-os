import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './responsive.css';
import { startOfflineQueue } from './lib/offlineQueue';

type BoundaryState = { hasError: boolean; message: string };

const CHUNK_LOAD_PATTERN =
  /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|loading chunk|chunkloaderror/i;

const recoverFromStaleApp = () => {
  if (typeof window === 'undefined') return;

  let shouldRecover = true;
  try {
    const key = 'customs-os-chunk-recovery-at';
    const previous = Number(sessionStorage.getItem(key) || 0);
    const now = Date.now();
    if (previous && now - previous < 120_000) {
      shouldRecover = false;
    } else {
      sessionStorage.setItem(key, String(now));
    }
  } catch {
    // Continue with the recovery even when sessionStorage is unavailable.
  }

  if (!shouldRecover) return;

  void (async () => {
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((registrations || []).map((registration) => registration.unregister()));
    } catch (error) {
      console.warn('[Customs OS] Service worker cleanup failed:', error);
    }

    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    } catch (error) {
      console.warn('[Customs OS] Cache cleanup failed:', error);
    }

    try {
      window.location.reload();
    } catch {
      window.location.assign(window.location.href);
    }
  })();
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'خطای غیرمنتظره در اجرای برنامه',
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[Customs OS] Unhandled render error:', error, info);

    const message = error instanceof Error ? error.message : String(error);
    if (CHUNK_LOAD_PATTERN.test(message)) {
      recoverFromStaleApp();
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#f8fafc',
          fontFamily: 'Vazirmatn, sans-serif',
        }}
      >
        <div
          style={{
            width: 'min(100%, 520px)',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 20,
            padding: 24,
            textAlign: 'center',
            boxShadow: '0 16px 50px rgba(15,23,42,.08)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>
            سامانه با خطای غیرمنتظره متوقف شد
          </div>
          <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.9 }}>
            در حال بررسی و بازیابی نسخه جدید برنامه هستیم.
          </div>
          {this.state.message && (
            <div style={{ marginTop: 14, color: '#b91c1c', fontSize: 11, direction: 'ltr', wordBreak: 'break-word' }}>
              {this.state.message}
            </div>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              minHeight: 44,
              padding: '0 20px',
              border: 0,
              borderRadius: 12,
              background: '#0f4c81',
              color: '#fff',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            تازه‌سازی صفحه
          </button>
        </div>
      </div>
    );
  }
}

try {
  startOfflineQueue();
} catch (error) {
  console.error('[Customs OS] Offline queue initialization failed:', error);
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

const normalizeLegacyPwaLaunch = () => {
  if (typeof window === 'undefined') return false;

  try {
    const current = new URL(window.location.href);
    if (current.pathname !== '/' || current.searchParams.get('source') !== 'pwa') return false;

    current.pathname = '/chat';
    current.search = '';
    window.location.replace(current.toString());
    return true;
  } catch (error) {
    console.warn('[Customs OS] Legacy PWA launch normalization failed:', error);
    return false;
  }
};

if (!normalizeLegacyPwaLaunch()) {
  rootElement.replaceChildren();

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
