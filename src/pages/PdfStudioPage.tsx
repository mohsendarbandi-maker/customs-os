import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, FileImage, FilePlus2, FileText, Files, Loader2, Minus, RotateCw, Scissors, ShieldCheck, Stamp, Trash2, Upload, Sparkles, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PDFDocument, degrees } from 'pdf-lib';
import { zipSync } from 'fflate';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

type SourceDocument = { id: string; file: File; pageCount: number; hasProtectedFeatures: boolean };
type PageItem = {
  id: string;
  documentId: string;
  pageIndex: number;
  thumbnail: string;
  rotation: number;
  selected: boolean;
};
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_PDF_BYTES = 180 * 1024 * 1024;
const MAX_TOTAL_PAGES = 300;
const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? Math.round(bytes / 1024) + ' KB'
  : (bytes / 1024 / 1024).toFixed(1) + ' MB';
const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
};
const safeName = (name: string) => name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'document';

export const PdfStudioPage: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const sourcePdfs = useRef(new Map<string, PDFDocument>());
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [splitEvery, setSplitEvery] = useState('5');

  const selectedPages = useMemo(() => pages.filter((page) => page.selected), [pages]);
  const selectedCount = selectedPages.length;
  const totalBytes = useMemo(() => documents.reduce((sum, item) => sum + item.file.size, 0), [documents]);

  const loadFiles = useCallback(async (files: File[]) => {
    const pdfFiles = files.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (!pdfFiles.length) {
      setError('فقط فایل PDF پشتیبانی می‌شود.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('در حال خواندن فایل‌ها در مرورگر…');
    try {
      let plannedBytes = documents.reduce((total, item) => total + item.file.size, 0);
      let plannedPages = pages.length;
      for (const file of pdfFiles) {
        if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
          throw new Error('حجم هر PDF باید بین ۱ بایت تا ۱۰۰ مگابایت باشد: ' + file.name);
        }
        plannedBytes += file.size;
        if (plannedBytes > MAX_TOTAL_PDF_BYTES) throw new Error('مجموع حجم فایل‌های این نوبت حداکثر ۱۸۰ مگابایت است تا مرورگر روی موبایل پایدار بماند.');
        const bytes = await file.arrayBuffer();
        const pdfMarkers = new TextDecoder('latin1').decode(new Uint8Array(bytes));
        const hasProtectedFeatures = /\/ByteRange\s*\[|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/AcroForm\b|\/XFA\b|\/EmbeddedFiles\b|\/Filespec\b|\/Outlines\b|\/StructTreeRoot\b|\/OutputIntents\b|\/AF\s*\[/i.test(pdfMarkers);
        const pdfSource = await PDFDocument.load(bytes);
        plannedPages += pdfSource.getPageCount();
        if (plannedPages > MAX_TOTAL_PAGES) throw new Error('حداکثر ۳۰۰ صفحه در هر نوبت کاری قابل بارگذاری است. فایل‌های دیگر را در نوبت جداگانه اضافه کنید.');
        const previewDocument = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
        const id = 'pdf-' + crypto.randomUUID();
        sourcePdfs.current.set(id, pdfSource);
        const nextPages: PageItem[] = [];
        for (let pageNumber = 1; pageNumber <= previewDocument.numPages; pageNumber += 1) {
          const page = await previewDocument.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 0.22 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('امکان ساخت پیش‌نمایش صفحه وجود ندارد.');
          await page.render({ canvasContext: context, viewport }).promise;
          nextPages.push({
            id: id + '-page-' + pageNumber,
            documentId: id,
            pageIndex: pageNumber - 1,
            thumbnail: canvas.toDataURL('image/jpeg', 0.72),
            rotation: 0,
            selected: false,
          });
          canvas.width = 1;
          canvas.height = 1;
        }
        setDocuments((previous) => [...previous, { id, file, pageCount: previewDocument.numPages, hasProtectedFeatures }]);
        setPages((previous) => [...previous, ...nextPages]);
        await previewDocument.destroy();
      }
      setStatus(pdfFiles.length + ' فایل PDF به محیط کار اضافه شد. فایل‌ها برای این عملیات روی همین دستگاه پردازش می‌شوند.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خواندن PDF ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => () => { sourcePdfs.current.clear(); }, []);

  const updatePage = (id: string, patch: Partial<PageItem>) => {
    setPages((previous) => previous.map((page) => page.id === id ? { ...page, ...patch } : page));
  };
  const toggleSelection = (id: string) => {
    setPages((previous) => previous.map((page) => page.id === id ? { ...page, selected: !page.selected } : page));
  };
  const selectAll = () => setPages((previous) => previous.map((page) => ({ ...page, selected: true })));
  const clearSelection = () => setPages((previous) => previous.map((page) => ({ ...page, selected: false })));

  const removeSelected = () => {
    if (!selectedCount) return setError('ابتدا یک یا چند صفحه را انتخاب کنید.');
    setPages((previous) => previous.filter((page) => !page.selected));
    setStatus(selectedCount + ' صفحه از خروجی حذف شد؛ فایل اصلی تغییر نکرده است.');
  };
  const rotateSelected = () => {
    if (!selectedCount) return setError('صفحه‌هایی را که می‌خواهید بچرخانید انتخاب کنید.');
    setPages((previous) => previous.map((page) =>
      page.selected ? { ...page, rotation: (page.rotation + 90) % 360 } : page
    ));
    setStatus(selectedCount + ' صفحه ۹۰ درجه چرخانده شد.');
  };
  const movePage = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= pages.length) return;
    setPages((previous) => {
      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };
  const onDropPage = (event: React.DragEvent, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = Number(event.dataTransfer.getData('text/page-index'));
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= pages.length || sourceIndex === targetIndex) return;
    setPages((previous) => {
      const next = [...previous];
      const [item] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const createPdfBytes = async (items: PageItem[]) => {
    if (!items.length) throw new Error('برای خروجی هیچ صفحه‌ای باقی نمانده است.');
    const output = await PDFDocument.create();
    for (const item of items) {
      const source = sourcePdfs.current.get(item.documentId);
      if (!source) throw new Error('فایل اصلی یکی از صفحات در حافظه پیدا نشد؛ فایل PDF را دوباره اضافه کنید.');
      const [copied] = await output.copyPages(source, [item.pageIndex]);
      if (item.rotation) copied.setRotation(degrees((copied.getRotation().angle + item.rotation) % 360));
      output.addPage(copied);
    }
    return output.save({ useObjectStreams: true });
  };

  const buildPdf = async (items: PageItem[], fileName: string) => {
    const bytes = await createPdfBytes(items);
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName.endsWith('.pdf') ? fileName : fileName + '.pdf');
  };

  const exportMerged = async (onlySelected = false) => {
    const items = onlySelected ? pages.filter((page) => page.selected) : pages;
    const signed = items.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures));
    if (signed && !window.confirm('یک فایل دارای امضای دیجیتال یا فرم تعاملی است. استخراج/ادغام صفحات، امضای دیجیتال اصلی را معتبر نگه نمی‌دارد. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
    setBusy(true);
    setError('');
    try {
      await buildPdf(items, 'pdf-studio-output.pdf');
      setStatus(items.length + ' صفحه در یک PDF جدید ذخیره شد.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ساخت PDF ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const splitPdf = async () => {
    const every = Math.max(1, Math.min(100, Number(splitEvery) || 1));
    if (!pages.length) return setError('ابتدا فایل PDF اضافه کنید.');
    const signed = pages.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures));
    if (signed && !window.confirm('تقسیم فایل دارای امضای دیجیتال یا فرم تعاملی، اعتبار امضای اصلی را حفظ نمی‌کند. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
    setBusy(true);
    setError('');
    try {
      let part = 0;
      const parts: Record<string, Uint8Array> = {};
      for (let start = 0; start < pages.length; start += every) {
        part += 1;
        const name = 'pdf-part-' + String(part).padStart(2, '0') + '.pdf';
        parts[name] = await createPdfBytes(pages.slice(start, start + every));
      }
      const archive = zipSync(parts, { level: 6 });
      const archiveBytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([archiveBytes], { type: 'application/zip' }), 'pdf-parts.zip');
      setStatus(pages.length + ' صفحه در ' + part + ' فایل جدا شد و همه خروجی‌ها داخل یک ZIP دانلود شدند.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تقسیم PDF ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const compressActivePdf = async () => {
    if (!documents.length) return setError('ابتدا فایل PDF اضافه کنید.');
    setBusy(true);
    setError('');
    try {
      let totalSaved = 0;
      for (const source of documents) {
        if (source.hasProtectedFeatures) { totalSaved += 0; continue; }
        const pdf = sourcePdfs.current.get(source.id);
        if (!pdf) continue;
        const bytes = await pdf.save({ useObjectStreams: true });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const saved = Math.max(0, source.file.size - blob.size);
        totalSaved += saved;
        downloadBlob(blob.size < source.file.size
          ? blob
          : new Blob([await source.file.arrayBuffer()], { type: 'application/pdf' }),
        safeName(source.file.name) + '-optimized.pdf');
      }
      setStatus(totalSaved > 0
        ? 'بهینه‌سازی ساختاری انجام شد؛ مجموعاً ' + formatSize(totalSaved) + ' کاهش حجم داشت. فایل‌های دارای امضای دیجیتال یا فرم محافظت‌شده بدون تغییر باقی ماندند.'
        : 'کاهش حجم قابل‌توجهی به دست نیامد؛ نسخه اصلی حفظ شد. فایل‌های دارای امضای دیجیتال یا فرم محافظت‌شده نیز تغییر نکردند.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'بهینه‌سازی PDF ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const compressScans = async () => {
    if (!documents.length) return setError('ابتدا فایل PDF اضافه کنید.');
    const accepted = window.confirm(
      'این روش صفحات را به تصویر تبدیل می‌کند. فایل خروجی معمولاً کوچک‌تر می‌شود، اما متن دیگر قابل انتخاب و جست‌وجو نیست و فرم‌ها، لینک‌ها، لایه‌ها و امضاهای دیجیتال حذف یا نامعتبر می‌شوند. فقط روی نسخه کپی ادامه می‌دهید؟'
    );
    if (!accepted) return;
    setBusy(true);
    setError('');
    try {
      for (const source of documents) {
        const data = await source.file.arrayBuffer();
        const pdf = await getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
        const output = await PDFDocument.create();
        for (let number = 1; number <= pdf.numPages; number += 1) {
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: 1.55 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('امکان بازسازی صفحه وجود ندارد.');
          await page.render({ canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((value) => value ? resolve(value) : reject(new Error('ساخت تصویر صفحه ناموفق بود.')), 'image/jpeg', 0.88)
          );
          const image = await output.embedJpg(await blob.arrayBuffer());
          const size = page.getViewport({ scale: 1 });
          const outPage = output.addPage([size.width, size.height]);
          outPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
          canvas.width = 1;
          canvas.height = 1;
        }
        const bytes = await output.save({ useObjectStreams: true });
        const resultBlob = new Blob([bytes], { type: 'application/pdf' });
        const smaller = resultBlob.size < source.file.size;
        downloadBlob(smaller ? resultBlob : source.file, safeName(source.file.name) + (smaller ? '-scan-compressed.pdf' : '-original.pdf'));
        await pdf.destroy();
      }
      setStatus('خروجی تصویری ساخته شد؛ فقط فایل‌هایی که واقعاً کوچک‌تر شدند با نسخه فشرده ذخیره شدند. برای این نسخه‌ها متن، فرم‌ها، لینک‌ها، لایه‌ها و امضاهای دیجیتال حفظ نمی‌شوند.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'فشرده‌سازی تصویری ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const addTextStamp = async () => {
    const text = selectedText.trim();
    if (!text) return setError('متن مهر یا یادداشت را وارد کنید.');
    const targets = selectedPages.length ? selectedPages : pages;
    if (!targets.length) return setError('ابتدا PDF اضافه کنید.');
    if (targets.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures)) && !window.confirm('افزودن مهر یا متن به فایل دارای امضای دیجیتال یا فرم تعاملی، اعتبار امضای اصلی را حفظ نمی‌کند. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
    setBusy(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 220;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('ساخت متن تصویری ناموفق بود.');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.direction = 'rtl';
      context.textAlign = 'right';
      context.fillStyle = '#142b55';
      context.font = 'bold 62px Tahoma, Arial, sans-serif';
      context.fillText(text, 1160, 128, 1120);
      const imageBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) return reject(new Error('ساخت تصویر متن ناموفق بود.'));
          resolve(await blob.arrayBuffer());
        }, 'image/png');
      });
      const grouped = new Map<string, PageItem[]>();
      for (const item of targets) grouped.set(item.documentId, [...(grouped.get(item.documentId) || []), item]);
      for (const [documentId, items] of grouped) {
        const original = sourcePdfs.current.get(documentId);
        if (!original) continue;
        const source = await PDFDocument.load(await original.save());
        const png = await source.embedPng(imageBytes);
        for (const item of items) {
          const page = source.getPage(item.pageIndex);
          const size = page.getSize();
          page.drawImage(png, { x: 28, y: 28, width: Math.min(240, size.width - 56), height: Math.min(44, size.height - 56) });
        }
        const bytes = await source.save({ useObjectStreams: true });
        const fileName = documents.find((document) => document.id === documentId)?.file.name || 'document.pdf';
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), safeName(fileName) + '-annotated.pdf');
      }
      setStatus('یادداشت تصویری روی صفحات انتخاب‌شده درج شد. برای خروجی جدید، فایل اصلی را دوباره اضافه کنید.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'درج متن ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const addImageStamp = async (file?: File) => {
    if (!file) return;
    const targets = selectedPages.length ? selectedPages : pages;
    if (!targets.length) return setError('ابتدا PDF اضافه کنید.');
    if (targets.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures)) && !window.confirm('افزودن مهر یا امضا به فایل دارای امضای دیجیتال یا فرم تعاملی، اعتبار امضای اصلی را حفظ نمی‌کند. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
    setBusy(true);
    setError('');
    try {
      const bytes = await file.arrayBuffer();
      const groups = new Map<string, PageItem[]>();
      for (const item of targets) groups.set(item.documentId, [...(groups.get(item.documentId) || []), item]);
      for (const [documentId, items] of groups) {
        const original = sourcePdfs.current.get(documentId);
        if (!original) continue;
        const source = await PDFDocument.load(await original.save());
        const image = file.type === 'image/png' ? await source.embedPng(bytes) : await source.embedJpg(bytes);
        for (const item of items) {
          const page = source.getPage(item.pageIndex);
          const size = page.getSize();
          const ratio = Math.min(1, 150 / image.width, 76 / image.height);
          const width = image.width * ratio;
          const height = image.height * ratio;
          page.drawImage(image, { x: size.width - width - 24, y: 24, width, height });
        }
        const outputBytes = await source.save({ useObjectStreams: true });
        const fileName = documents.find((document) => document.id === documentId)?.file.name || 'document.pdf';
        downloadBlob(new Blob([outputBytes], { type: 'application/pdf' }), safeName(fileName) + '-signed.pdf');
      }
      setStatus('تصویر مهر یا امضا روی صفحات انتخاب‌شده قرار گرفت.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'افزودن تصویر ناموفق بود.');
    } finally {
      setBusy(false);
      if (imageRef.current) imageRef.current.value = '';
    }
  };

  const resetWorkspace = () => {
    sourcePdfs.current.clear();
    setDocuments([]);
    setPages([]);
    setStatus('محیط کار پاک شد. فایل‌های اصلی در دستگاه یا فضای ذخیره‌سازی تغییر نکردند.');
    setError('');
  };

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-[var(--bg)] text-[var(--text)] p-3 md:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-500/15 text-blue-400"><FileText size={23}/></div>
              <div>
                <h1 className="text-xl md:text-2xl font-black">PDF Studio</h1>
                <p className="mt-1 text-xs text-[var(--muted)]">مدیریت صفحات، ادغام، جداسازی، چرخش، مهر و بهینه‌سازی PDF در مرورگر</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/file-manager" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">فایل‌منیجر</Link>
            <Link to="/office" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">دبیرخانه</Link>
          </div>
        </header>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              <Upload size={17}/> افزودن PDF
            </button>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => {
              const chosen = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void loadFiles(chosen);
            }}/>
            <span className="text-xs text-[var(--muted)]">{documents.length} فایل · {pages.length} صفحه · {formatSize(totalBytes)}</span>
            <div className="flex-1"/>
            <button type="button" onClick={resetWorkspace} disabled={busy || !documents.length} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><Trash2 size={15}/> پاک‌سازی</button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportMerged(false)} disabled={busy || !pages.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-40"><Files size={15}/> ادغام و خروجی همه صفحات</button>
            <button type="button" onClick={() => void exportMerged(true)} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><Scissors size={15}/> استخراج صفحات انتخابی ({selectedCount})</button>
            <button type="button" onClick={removeSelected} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-500/30 px-3 text-xs text-red-400 disabled:opacity-40"><Minus size={15}/> حذف صفحات</button>
            <button type="button" onClick={rotateSelected} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><RotateCw size={15}/> چرخش ۹۰ درجه</button>
            <button type="button" onClick={selectAll} disabled={busy || !pages.length} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><Check size={14}/> انتخاب همه</button>
            <button type="button" onClick={clearSelection} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><X size={14}/> لغو انتخاب</button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-black">ترتیب صفحات</h2><p className="mt-1 text-xs text-[var(--muted)]">برای تغییر ترتیب، صفحه را بکشید یا از فلش‌های بالا و پایین استفاده کنید.</p></div>
              {busy && <span className="inline-flex items-center gap-2 text-xs text-blue-400"><Loader2 className="animate-spin" size={16}/> در حال پردازش…</span>}
            </div>
            {pages.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {pages.map((page, index) => {
                  const source = documents.find((document) => document.id === page.documentId);
                  return (
                    <article key={page.id} draggable={!busy} onDragStart={(event) => event.dataTransfer.setData('text/page-index', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropPage(event, index)}
                      className={'group overflow-hidden rounded-xl border p-2 transition ' + (page.selected ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30' : 'border-[var(--border)] bg-[var(--surface-2)]')}>
                      <button type="button" onClick={() => toggleSelection(page.id)} className="block w-full text-right" aria-pressed={page.selected}>
                        <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg bg-white">
                          <img src={page.thumbnail} alt={'پیش‌نمایش صفحه ' + (page.pageIndex + 1)} className="max-h-full max-w-full object-contain transition" style={{ transform: 'rotate(' + page.rotation + 'deg)' }}/>
                          <span className="absolute bottom-1 left-1 rounded-md bg-slate-950/80 px-2 py-1 text-[10px] text-white">صفحه اصلی {page.pageIndex + 1}</span>
                          {page.selected && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white"><Check size={14}/></span>}
                        </div>
                        <div className="mt-2 truncate text-xs font-bold">{source?.file.name || 'PDF'}</div>
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <span className="text-[10px] text-[var(--muted)]">ترتیب خروجی: {index + 1}</span>
                        <div className="flex gap-1">
                          <button type="button" title="بالا" onClick={() => movePage(index, -1)} disabled={busy || index === 0} className="rounded-md border border-[var(--border)] p-1 disabled:opacity-30"><ArrowUp size={13}/></button>
                          <button type="button" title="پایین" onClick={() => movePage(index, 1)} disabled={busy || index === pages.length - 1} className="rounded-md border border-[var(--border)] p-1 disabled:opacity-30"><ArrowDown size={13}/></button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-6 text-center">
                <div className="space-y-3">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-500/10 text-blue-400"><FilePlus2 size={26}/></div>
                  <div className="font-bold">فایل PDF را به این محیط اضافه کنید</div>
                  <p className="max-w-sm text-xs leading-6 text-[var(--muted)]">می‌توانید چند فایل را هم‌زمان انتخاب کنید، صفحات را مرتب کنید و در پایان یک PDF یا چند خروجی جداگانه بگیرید.</p>
                  <button type="button" onClick={() => inputRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">انتخاب فایل</button>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h3 className="mb-3 font-black">تقسیم PDF</h3>
              <label className="block text-xs text-[var(--muted)]">هر چند صفحه یک فایل ساخته شود؟</label>
              <input type="number" min="1" max="100" value={splitEvery} onChange={(event) => setSplitEvery(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3" dir="ltr"/>
              <button type="button" onClick={() => void splitPdf()} disabled={busy || !pages.length} className="mt-2 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Scissors className="ml-1 inline" size={15}/> تقسیم و دانلود چند فایل</button>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h3 className="mb-3 font-black">مهر، امضا و متن</h3>
              <label className="block text-xs text-[var(--muted)]">متن فارسی یا انگلیسی</label>
              <input value={selectedText} onChange={(event) => setSelectedText(event.target.value)} placeholder="مثلاً رونوشت برابر اصل است" className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
              <button type="button" onClick={() => void addTextStamp()} disabled={busy || !pages.length} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-bold disabled:opacity-40"><Stamp className="ml-1 inline" size={15}/> درج متن روی صفحه</button>
              <input ref={imageRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => void addImageStamp(event.currentTarget.files?.[0])}/>
              <button type="button" onClick={() => imageRef.current?.click()} disabled={busy || !pages.length} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs disabled:opacity-40"><FileImage className="ml-1 inline" size={15}/> افزودن تصویر مهر یا امضا</button>
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">متن فارسی در این ابزار به‌شکل تصویر روی PDF قرار می‌گیرد؛ قابل جست‌وجو و ویرایش متنی نیست.</p>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h3 className="mb-2 font-black">فشرده‌سازی</h3>
              <button type="button" onClick={() => void compressActivePdf()} disabled={busy || !documents.length} className="w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-bold disabled:opacity-40"><ShieldCheck className="ml-1 inline" size={15}/> بهینه‌سازی ساختاری و حفظ متن</button>
              <button type="button" onClick={() => void compressScans()} disabled={busy || !documents.length} className="mt-2 w-full rounded-xl border border-amber-500/30 px-3 py-2.5 text-xs font-bold text-amber-600 disabled:opacity-40"><Sparkles className="ml-1 inline" size={15}/> فشرده‌سازی تصویری اسکن‌ها</button>
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">فشرده‌سازی ساختاری متن، پیوند و ساختار PDF را حفظ می‌کند، اما همیشه حجم را کم نمی‌کند. فشرده‌سازی تصویری با هشدار و تأیید جداگانه انجام می‌شود.</p>
            </section>

            <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center gap-2 font-bold text-emerald-500"><ShieldCheck size={16}/> پردازش محلی</div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">فایل‌ها برای ویرایش صفحات به سرور ارسال نمی‌شوند. فقط هنگام ذخیره دستی در فایل‌منیجر، فایل خروجی را آپلود کنید.</p>
            </section>
          </aside>
        </section>

        {(status || error) && <div className={'rounded-xl border p-3 text-sm ' + (error ? 'border-red-500/30 bg-red-500/5 text-red-400' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-500')}>
          {error || status}
          {error && <button type="button" onClick={() => setError('')} className="mr-2 align-middle"><X size={15}/></button>}
        </div>}
      </div>
    </main>
  );
};
