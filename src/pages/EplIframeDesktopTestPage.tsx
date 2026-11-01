import React, { useState } from 'react';
import { ExternalLink, Maximize2, Monitor, Minus, Plus, RotateCw } from 'lucide-react';

const EPL_URL = 'https://epl.irica.ir';
const DESKTOP_WIDTH = 1280;

export const EplIframeDesktopTestPage: React.FC = () => {
  const [zoom, setZoom] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  const openFullscreen = async () => {
    const frame = document.getElementById('epl-desktop-frame');
    try {
      await frame?.requestFullscreen?.();
    } catch {
      // Fullscreen is not supported by every in-app browser (notably iOS WebViews).
    }
  };

  return (
    <main dir="rtl" className="flex min-h-[calc(100dvh-4rem)] flex-col bg-[var(--bg)]">
      <header className="z-10 flex flex-wrap items-center justify-between gap-2 border-b app-border bg-[var(--surface)] p-2 sm:p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Monitor size={19} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-black">آزمایش EPL در قاب دسکتاپ</h1>
            <p className="text-[11px] app-muted">عرض داخلی ثابت: ۱۲۸۰ پیکسل · بدون واسطه‌گر سرور</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="کوچک‌نمایی" onClick={() => setZoom(v => Math.max(.4, +(v - .1).toFixed(2)))} className="rounded-lg border app-border p-2"><Minus size={16}/></button>
          <span className="min-w-12 text-center text-xs font-bold" dir="ltr">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="بزرگ‌نمایی" onClick={() => setZoom(v => Math.min(1, +(v + .1).toFixed(2)))} className="rounded-lg border app-border p-2"><Plus size={16}/></button>
          <button type="button" aria-label="بارگذاری مجدد" onClick={() => setReloadKey(v => v + 1)} className="rounded-lg border app-border p-2"><RotateCw size={16}/></button>
          <button type="button" onClick={openFullscreen} className="rounded-lg border app-border p-2"><Maximize2 size={16}/></button>
          <a href={EPL_URL} target="_blank" rel="noreferrer" className="rounded-lg bg-[var(--primary)] p-2 text-white" aria-label="بازکردن EPL جداگانه"><ExternalLink size={16}/></a>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-200" id="epl-desktop-frame">
        <div style={{ width: DESKTOP_WIDTH * zoom, minHeight: '100%', zoom: zoom as unknown as number }}>
          <iframe
            key={reloadKey}
            title="سامانه EPL در نمای دسکتاپ"
            src={EPL_URL}
            width={DESKTOP_WIDTH}
            className="block border-0 bg-white"
            style={{ width: DESKTOP_WIDTH, height: 'calc(100dvh - 8rem)', minHeight: 640 }}
            allow="clipboard-read; clipboard-write; fullscreen"
            allowFullScreen
          />
        </div>
      </div>
      <footer className="border-t app-border bg-[var(--surface)] px-3 py-2 text-[11px] leading-5 app-muted">
        این آزمایش فقط عرض صفحه داخل قاب را دسکتاپی می‌کند؛ User-Agent واقعی بله را تغییر نمی‌دهد. اگر EPL نمایش نداد یا پیام منع نمایش در قاب داد، محدودیت از سمت EPL یا WebView است. ورود و چاپ را داخل همین قاب آزمایش کنید.
      </footer>
    </main>
  );
};
