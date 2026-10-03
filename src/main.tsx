import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './responsive.css';
import {startOfflineQueue} from './lib/offlineQueue';

try {
  startOfflineQueue();
} catch (err) {
  console.error('[boot] offline queue failed', err);
}

class BootErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) {
    return {error};
  }
  render() {
    if (this.state.error) {
      return (
        <div
          dir="rtl"
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: '#0b1220',
            color: '#e5edf8',
            padding: 24,
            fontFamily: 'system-ui,sans-serif',
            textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{marginBottom: 8}}>خطا در بارگذاری برنامه</h1>
            <p style={{color: '#91a1b8'}}>{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => location.reload()}
              style={{
                marginTop: 16,
                minHeight: 44,
                padding: '0 18px',
                border: 0,
                borderRadius: 12,
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700,
              }}
            >
              تلاش دوباره
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('root element missing');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>
  </React.StrictMode>,
);
