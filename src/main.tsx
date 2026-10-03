import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './responsive.css';
import { startOfflineQueue } from './lib/offlineQueue';

type BoundaryState = { hasError: boolean; message: string };

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
            صفحه را یک‌بار تازه‌سازی کنید. در صورت تکرار، نسخه فعلی برنامه یا داده‌های ذخیره‌شده مرورگر نیاز به بررسی دارد.
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

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
