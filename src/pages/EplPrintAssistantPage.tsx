import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, FileUp,
  Printer, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { fitPdfToA4 } from '../lib/eplPrintUtils';

type BaleWebApp = {
  ready?: () => void;
  expand?: () => void;
  openLink?: (url: string) => void;
  isMiniAppSupported?: boolean;
};
declare global {
  interface Window {
    Bale?: { WebApp?: BaleWebApp };
  }
}

const EPL_URL = 'https://epl.irica.ir';

export const EplPrintAssistantPage: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [insideBale, setInsideBale] = useState(false);

  useEffect(() => {
    let active = true;
    const existing = document.querySelector<HTMLScriptElement>('script[data-bale-miniapp]');
    const initialize = () => {
      if (!active) return;
      const webApp = window.Bale?.WebApp;
      if (!webApp) return;
      setInsideBale(webApp.isMiniAppSupported === true);
      webApp.ready?.();
      webApp.expand?.();
    };

    if (window.Bale?.WebApp) {
      initialize();
    } else if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://tapi.bale.ai/miniapp.js';
      script.async = true;
      script.dataset.baleMiniapp = 'true';
      script.onload = initialize;
      script.onerror = () => setError('ارتباط با SDK مینی‌اپ بله برقرار نشد؛ صفحه در حالت مرورگر عادی قابل استفاده است.');
      document.head.appendChild(script);
    } else {
      existing.addEventListener('load', initialize, { once: true });
    }

    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  const openEpl = () => {
    setError('');
    setNotice('سامانه EPL در مرورگر داخلی بله باز می‌شود. پس از ذخیره PDF پروانه، به مینی‌اپ برگردید و فایل را انتخاب کنید.');
    const webApp = window.Bale?.WebApp;
    if (webApp?.openLink) {
      webApp.openLink(EPL_URL);
      return;
    }
    window.open(EPL_URL, '_blank', 'noopener,noreferrer');
  };

  const selectFile = (file?: File) => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl('');
    setPageCount(0);
    setError('');
    setNotice('');
    if (!file) {
      setSource(null);
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setSource(null);
      setError('فعلاً فقط فایل PDF پروانه پشتیبانی می‌شود.');
      return;
    }
    setSource(file);
  };

  const prepareA4 = async () => {
    if (!source || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const input = new Uint8Array(await source.arrayBuffer());
      const result = await fitPdfToA4(input, 18);
      const pdfBytes = new Uint8Array(result.bytes.byteLength);
      pdfBytes.set(result.bytes);
      const blob = new Blob([pdfBytes.buffer], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);
      setOutputUrl(nextUrl);
      setPageCount(result.pageCount);
      setNotice('نسخه مخصوص چاپ A4 آماده شد. فایل اصلی تغییر نکرده است.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'آماده‌سازی PDF ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!outputUrl) return;
    const anchor = document.createElement('a');
    anchor.href = outputUrl;
    anchor.download = (source?.name || 'EPL-Declaration').replace(/\.pdf$/i, '') + '-A4-print.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const openPdf = () => {
    if (outputUrl) window.open(outputUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <main dir="rtl" className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-3xl space-y-4 p-3 pb-10 sm:p-5">
      <header className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-[var(--surface-2)] p-3"><Printer size={23}/></span>
          <div className="min-w-0">
            <h1 className="text-xl font-black">چاپگر هوشمند EPL</h1>
            <p className="mt-1 text-xs app-muted">EPL Mobile Print Assistant · A4</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border app-border px-3 py-1">{insideBale ? 'مینی‌اپ بله فعال است' : 'حالت مرورگر'}</span>
          <span className="rounded-full border app-border px-3 py-1">بدون ذخیره رمز EPL</span>
        </div>
      </header>

      <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="font-extrabold">۱. ورود به سامانه EPL</h2>
        <p className="mt-2 text-sm leading-7 app-muted">
          با همان روش همیشگی وارد EPL شوید و پروانه را باز کنید. این ابزار رمز یا اطلاعات ورود شما را دریافت نمی‌کند.
        </p>
        <button type="button" onClick={openEpl} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white">
          <ExternalLink size={18}/> باز کردن سامانه EPL
        </button>
      </section>

      <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="font-extrabold">۲. بارگذاری PDF پروانه</h2>
        <p className="mt-2 text-sm leading-7 app-muted">
          از صفحه چاپ EPL، خروجی PDF را در Files گوشی ذخیره کنید؛ سپس آن را از این قسمت انتخاب کنید.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border app-border px-4 py-3 text-sm font-bold">
          <FileUp size={18}/> انتخاب فایل PDF
        </button>
        {source && (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-[var(--surface-2)] p-3">
            <FileText className="shrink-0" size={22}/>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{source.name}</p>
              <p className="mt-1 text-xs app-muted">{(source.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button type="button" onClick={() => selectFile(undefined)} className="text-xs app-muted">حذف</button>
          </div>
        )}
        <button type="button" disabled={!source || busy} onClick={() => void prepareA4()} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <RefreshCw className="animate-spin" size={18}/> : <Printer size={18}/>}
          {busy ? 'در حال آماده‌سازی…' : 'تنظیم و آماده‌سازی A4'}
        </button>
      </section>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600"><AlertTriangle size={18} className="mt-0.5 shrink-0"/>{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600"/>{notice}</div>}

      {outputUrl && (
        <section className="space-y-3 rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold">۳. خروجی آماده چاپ</h2>
              <p className="mt-1 text-xs app-muted">{pageCount} صفحه A4 · حاشیه امن ۶٫۳۵ میلی‌متر</p>
            </div>
            <ShieldCheck className="shrink-0 text-emerald-600" size={22}/>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={openPdf} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border app-border px-3 py-3 text-sm font-bold">
              <FileText size={18}/> باز کردن PDF برای چاپ
            </button>
            <button type="button" onClick={download} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 py-3 text-sm font-bold text-white">
              <Download size={18}/> ذخیره PDF
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border app-border bg-white">
            <iframe title="پیش‌نمایش PDF آماده چاپ" src={outputUrl} className="h-[65vh] min-h-80 w-full" />
          </div>
          <p className="text-xs leading-6 app-muted">
            فایل اصلی دست‌نخورده باقی می‌ماند. این نسخه فقط صفحه‌های موجود در PDF ورودی را متناسب با A4 می‌چیند.
          </p>
        </section>
      )}

      <aside className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-7">
        <div className="flex items-center gap-2 font-bold"><AlertTriangle size={18} className="text-amber-600"/> محدودیت مهم</div>
        اگر خود EPL بخشی از پروانه را در PDF یا صفحه چاپ تولید نکرده باشد، این ابزار نمی‌تواند اطلاعات حذف‌شده را بازسازی کند. این ابزار فقط برش ناشی از اندازه صفحه یا حاشیه چاپ را، در صورتی که محتوای کامل در PDF ورودی موجود باشد، اصلاح می‌کند. نسخه A4 جایگزین سند اصلی یا نسخه دارای امضای دیجیتال نیست.
      </aside>
    </main>
  );
};
