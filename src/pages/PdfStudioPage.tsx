import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, FileImage, FilePlus2, FileText, Files, Loader2, Minus, RotateCw, Scissors, ShieldCheck, Stamp, Trash2, Upload, Sparkles, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PDFDocument, degrees } from 'pdf-lib';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { downloadTelegramArchivedFile } from '../lib/fileManager';
import { PDF_STUDIO_PRESETS, pageExpressionForMatches, parsePageSelection, suggestDocumentLabel } from '../lib/pdfStudioUtils';
import { zipSync } from 'fflate';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

type SourceDocument = { id: string; file: File; pageCount: number; hasProtectedFeatures: boolean; convertedFromImage: boolean };
type SplitRow = { id: string; name: string; pageExpression: string };
type FileManagerRow = {
  id: string;
  folder_id: string;
  file_asset_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type PageItem = {
  id: string;
  documentId: string;
  pageIndex: number;
  thumbnail: string;
  rotation: number;
  selected: boolean;
  label: string;
};
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
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const PdfStudioPage: React.FC = () => {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id || '';
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const sourcePdfs = useRef(new Map<string, PDFDocument>());
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ id: crypto.randomUUID(), name: 'سند خروجی', pageExpression: '' }]);
  const [packageName, setPackageName] = useState('اسناد خروجی');
  const [outputPreset, setOutputPreset] = useState<'custom' | 'shipPass' | 'guarantee' | 'standard'>('custom');
  const [compressionQuality, setCompressionQuality] = useState(0.72);
  const [compressionScale, setCompressionScale] = useState(1.2);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileManagerLoading, setFileManagerLoading] = useState(false);
  const [fileManagerRows, setFileManagerRows] = useState<FileManagerRow[]>([]);
  const [fileManagerFolders, setFileManagerFolders] = useState<Array<{ id: string; display_name: string }>>([]);
  const [fileManagerSearch, setFileManagerSearch] = useState('');
  const [selectedFileManagerIds, setSelectedFileManagerIds] = useState<Set<string>>(() => new Set());

  const selectedPages = useMemo(() => pages.filter((page) => page.selected), [pages]);
  const selectedCount = selectedPages.length;
  const totalBytes = useMemo(() => documents.reduce((sum, item) => sum + item.file.size, 0), [documents]);

  const loadFiles = useCallback(async (files: File[]) => {
    const acceptedFiles = files.filter((file) => {
      const type = (file.type || '').toLowerCase();
      return type === 'application/pdf' || /\.pdf$/i.test(file.name) || type === 'image/png' || type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name);
    });
    if (!acceptedFiles.length) {
      setError('فقط PDF و تصویرهای JPG یا PNG پشتیبانی می‌شوند.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('در حال خواندن فایل‌ها و ساخت پیشنهاد نام صفحات…');
    try {
      for (const file of acceptedFiles) {
        if (file.size <= 0) throw new Error('فایل خالی است: ' + file.name);
        const fileBytes = await file.arrayBuffer();
        const type = (file.type || '').toLowerCase();
        const isImage = type === 'image/png' || type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name);
        let pdfSource: PDFDocument;
        let previewBytes: Uint8Array;
        let hasProtectedFeatures = false;

        if (isImage) {
          pdfSource = await PDFDocument.create();
          const image = type === 'image/png' || /\.png$/i.test(file.name)
            ? await pdfSource.embedPng(fileBytes)
            : await pdfSource.embedJpg(fileBytes);
          const naturalWidth = image.width * 0.75;
          const naturalHeight = image.height * 0.75;
          const imageScale = Math.min(1, 1440 / Math.max(naturalWidth, naturalHeight));
          const width = Math.max(1, naturalWidth * imageScale);
          const height = Math.max(1, naturalHeight * imageScale);
          const page = pdfSource.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });
          previewBytes = await pdfSource.save();
        } else {
          const pdfMarkers = new TextDecoder('latin1').decode(new Uint8Array(fileBytes));
          hasProtectedFeatures = /\/ByteRange\s*\[|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/AcroForm\b|\/XFA\b|\/EmbeddedFiles\b|\/Filespec\b|\/Outlines\b|\/StructTreeRoot\b|\/OutputIntents\b|\/AF\s*\[|\/Annots\b|\/Metadata\b|\/PageLabels\b|\/OCProperties\b|\/OpenAction\b|\/JavaScript\b|\/Perms\b|\/Collection\b|\/Threads\b/i.test(pdfMarkers);
          pdfSource = await PDFDocument.load(fileBytes);
          previewBytes = new Uint8Array(fileBytes.slice(0));
        }

        const previewDocument = await getDocument({ data: new Uint8Array(previewBytes.slice(0)) }).promise;
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
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' ');
          nextPages.push({
            id: id + '-page-' + pageNumber,
            documentId: id,
            pageIndex: pageNumber - 1,
            thumbnail: canvas.toDataURL('image/jpeg', 0.72),
            rotation: 0,
            selected: false,
            label: suggestDocumentLabel(pageText, file.name, pageNumber),
          });
          canvas.width = 1;
          canvas.height = 1;
        }
        setDocuments((previous) => [...previous, { id, file, pageCount: previewDocument.numPages, hasProtectedFeatures, convertedFromImage: isImage }]);
        setPages((previous) => [...previous, ...nextPages]);
        await previewDocument.destroy();
      }
      setStatus(acceptedFiles.length + ' فایل PDF یا تصویر به محیط کار اضافه شد؛ پیشنهاد نام فقط از متن قابل انتخاب PDF استفاده می‌کند و OCR انجام نمی‌شود.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خواندن فایل ناموفق بود.');
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
    downloadBlob(new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }), fileName.endsWith('.pdf') ? fileName : fileName + '.pdf');
  };

  const rasterizePages = async (items: PageItem[], scale: number, quality: number): Promise<Blob> => {
    if (!items.length) throw new Error('برای فشرده‌سازی هیچ صفحه‌ای انتخاب نشده است.');
    const previewDocuments = new Map<string, any>();
    const output = await PDFDocument.create();
    try {
      for (const item of items) {
        const source = sourcePdfs.current.get(item.documentId);
        if (!source) throw new Error('منبع یکی از صفحات در حافظه پیدا نشد.');
        let preview = previewDocuments.get(item.documentId);
        if (!preview) {
          const bytes = await source.save();
          preview = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
          previewDocuments.set(item.documentId, preview);
        }
        const sourcePage = await preview.getPage(item.pageIndex + 1);
        const rotation = (sourcePage.rotate + item.rotation) % 360;
        const viewport = sourcePage.getViewport({ scale, rotation });
        const baseViewport = sourcePage.getViewport({ scale: 1, rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('امکان فشرده‌سازی صفحه وجود ندارد.');
        await sourcePage.render({ canvasContext: context, viewport }).promise;
        const imageBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error('ساخت تصویر فشرده صفحه ناموفق بود.')), 'image/jpeg', quality)
        );
        const image = await output.embedJpg(await imageBlob.arrayBuffer());
        const targetPage = output.addPage([baseViewport.width, baseViewport.height]);
        targetPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
        canvas.width = 1;
        canvas.height = 1;
      }
      const bytes = await output.save({ useObjectStreams: true });
      return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
    } finally {
      await Promise.all([...previewDocuments.values()].map((preview) => preview.destroy().catch(() => undefined)));
    }
  };

  const compressPagesToTarget = async (items: PageItem[], targetBytes: number) => {
    let bestSize = Number.POSITIVE_INFINITY;
    const initialScale = Math.max(0.7, Math.min(1.8, compressionScale));
    const initialQuality = Math.max(0.35, Math.min(0.9, compressionQuality));
    for (let scale = initialScale; scale >= 0.69; scale = Math.round((scale - 0.15) * 100) / 100) {
      for (let quality = initialQuality; quality >= 0.34; quality = Math.round((quality - 0.1) * 100) / 100) {
        setStatus('فشرده‌سازی تطبیقی: وضوح ' + scale.toFixed(2) + ' و کیفیت ' + Math.round(quality * 100) + '٪…');
        const blob = await rasterizePages(items, scale, quality);
        bestSize = Math.min(bestSize, blob.size);
        if (blob.size <= targetBytes) return { blob, scale, quality };
      }
    }
    throw new Error('با تنظیمات فعلی رسیدن به سقف ۲ مگابایت ممکن نشد. کمترین حجم تولیدشده ' + formatSize(bestSize) + ' بود؛ وضوح یا کیفیت ورودی را کاهش دهید یا اسناد را به چند بخش تقسیم کنید.');
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

  const applyOutputPreset = (preset: 'custom' | 'shipPass' | 'guarantee' | 'standard') => {
    setOutputPreset(preset);
    if (preset === 'shipPass') {
      setPackageName('پاس کشتی');
      setSplitRows(PDF_STUDIO_PRESETS.shipPass.map((item) => ({
        id: crypto.randomUUID(), name: item.name, pageExpression: pageExpressionForMatches(pages, [...item.patterns]),
      })));
    } else if (preset === 'guarantee') {
      setPackageName('درخواست ضمانتنامه');
      setSplitRows(PDF_STUDIO_PRESETS.guarantee.map((item) => ({
        id: crypto.randomUUID(), name: item.name, pageExpression: pageExpressionForMatches(pages, [...item.patterns]),
      })));
    } else if (preset === 'standard') {
      setPackageName('مدارک استاندارد');
      setSplitRows([{ id: crypto.randomUUID(), name: 'مدارک استاندارد', pageExpression: pages.length ? '1-' + pages.length : '' }]);
    } else {
      setPackageName('اسناد خروجی');
      setSplitRows([{ id: crypto.randomUUID(), name: 'سند خروجی', pageExpression: '' }]);
    }
  };

  const splitPdf = async () => {
    if (!pages.length) return setError('ابتدا فایل یا تصویر اضافه کنید.');
    const protectedIncluded = pages.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures));
    setBusy(true);
    setError('');
    try {
      if (outputPreset === 'standard') {
        const sourceBytes = await createPdfBytes(pages);
        if (sourceBytes.byteLength <= 2 * 1024 * 1024) {
          downloadBlob(new Blob([toArrayBuffer(sourceBytes)], { type: 'application/pdf' }), safeName(packageName) + '.pdf');
          setStatus('خروجی استاندارد با حجم ' + formatSize(sourceBytes.byteLength) + ' آماده شد و زیر سقف ۲ مگابایت است.');
          return;
        }
        if (!window.confirm('برای رساندن خروجی استاندارد به سقف ۲ مگابایت، صفحات به تصویر فشرده تبدیل می‌شوند؛ متن قابل جست‌وجو، فرم‌ها، لینک‌ها، لایه‌ها و امضاهای دیجیتال در نسخه خروجی حفظ نمی‌شوند. فایل‌های اصلی بدون تغییر می‌مانند. ادامه می‌دهید؟')) return;
        const result = await compressPagesToTarget(pages, 2 * 1024 * 1024);
        downloadBlob(result.blob, safeName(packageName) + '.pdf');
        setStatus('خروجی استاندارد آماده شد: ' + formatSize(result.blob.size) + '، وضوح ' + result.scale.toFixed(2) + '، کیفیت ' + Math.round(result.quality * 100) + '٪. سقف ۲ مگابایت رعایت شد.');
        return;
      }

      if (protectedIncluded && !window.confirm('تقسیم فایل دارای امضای دیجیتال یا فرم تعاملی، اعتبار امضای اصلی را حفظ نمی‌کند. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
      const outputFiles: Record<string, Uint8Array> = {};
      for (let index = 0; index < splitRows.length; index += 1) {
        const row = splitRows[index];
        if (!row.name.trim()) throw new Error('نام هر خروجی را وارد کنید.');
        const pageNumbers = parsePageSelection(row.pageExpression, pages.length);
        const items = pageNumbers.map((pageNumber) => pages[pageNumber - 1]);
        const fileName = safeName(row.name.trim()) + '.pdf';
        if (outputFiles[fileName]) throw new Error('نام خروجی تکراری است: ' + row.name);
        outputFiles[fileName] = await createPdfBytes(items);
      }
      if (!Object.keys(outputFiles).length) throw new Error('حداقل یک بخش برای خروجی تعریف کنید.');
      const archive = zipSync(outputFiles, { level: 6 });
      const archiveBytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([archiveBytes], { type: 'application/zip' }), safeName(packageName) + '.zip');
      setStatus(Object.keys(outputFiles).length + ' خروجی مستقل در بسته «' + packageName + '» ساخته شد. هر ردیف می‌تواند بازه یا چند صفحه پراکنده داشته باشد.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ساخت خروجی‌ها ناموفق بود.');
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
        const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
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
    if (!documents.length) return setError('ابتدا فایل PDF یا تصویر اضافه کنید.');
    const accepted = window.confirm(
      'این روش صفحات را به تصویر تبدیل می‌کند. کیفیت و وضوح با تنظیمات زیر کنترل می‌شوند؛ متن، فرم‌ها، لینک‌ها، لایه‌ها و امضاهای دیجیتال در نسخه خروجی حفظ نمی‌شوند. فایل اصلی تغییر نمی‌کند. ادامه می‌دهید؟'
    );
    if (!accepted) return;
    setBusy(true);
    setError('');
    try {
      let totalBefore = 0;
      let totalAfter = 0;
      for (const source of documents) {
        const items = pages.filter((page) => page.documentId === source.id);
        const originalPdf = await createPdfBytes(items);
        const resultBlob = await rasterizePages(items, compressionScale, compressionQuality);
        const smaller = resultBlob.size < originalPdf.byteLength;
        const output = smaller ? resultBlob : new Blob([toArrayBuffer(originalPdf)], { type: 'application/pdf' });
        downloadBlob(output, safeName(source.file.name) + (smaller ? '-compressed.pdf' : '-optimized.pdf'));
        totalBefore += originalPdf.byteLength;
        totalAfter += output.size;
      }
      setStatus('فشرده‌سازی با وضوح ' + compressionScale.toFixed(2) + ' و کیفیت ' + Math.round(compressionQuality * 100) + '٪ انجام شد؛ حجم مجموعه از ' + formatSize(totalBefore) + ' به ' + formatSize(totalAfter) + ' رسید. فایل‌های اصلی حفظ شدند.');
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
        downloadBlob(new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }), safeName(fileName) + '-annotated.pdf');
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
        downloadBlob(new Blob([toArrayBuffer(outputBytes)], { type: 'application/pdf' }), safeName(fileName) + '-signed.pdf');
      }
      setStatus('تصویر مهر یا امضا روی صفحات انتخاب‌شده قرار گرفت.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'افزودن تصویر ناموفق بود.');
    } finally {
      setBusy(false);
      if (imageRef.current) imageRef.current.value = '';
    }
  };

  const loadFileManagerRows = useCallback(async () => {
    if (!organizationId) throw new Error('سازمان کاربر برای دسترسی به فایل‌منیجر مشخص نیست.');
    setFileManagerLoading(true);
    try {
      const { data: folderData, error: folderError } = await supabase.from('file_manager_folders')
        .select('id,display_name')
        .eq('organization_id', organizationId)
        .order('display_name', { ascending: true });
      if (folderError) throw folderError;
      const folderRows = (folderData || []) as Array<{ id: string; display_name: string }>;
      setFileManagerFolders(folderRows);
      const allRows: FileManagerRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: filesError } = await supabase.from('file_manager_files')
          .select('id,folder_id,file_asset_id,original_name,mime_type,size_bytes,storage_path,metadata,created_at')
          .eq('organization_id', organizationId)
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
          .range(offset, offset + 499);
        if (filesError) throw filesError;
        const batch = (data || []) as FileManagerRow[];
        allRows.push(...batch);
        if (batch.length < 500) break;
      }
      setFileManagerRows(allRows.filter((row) => {
        const type = (row.mime_type || '').toLowerCase();
        return type === 'application/pdf' || type.startsWith('image/') || /\.(pdf|png|jpe?g)$/i.test(row.original_name);
      }));
    } finally {
      setFileManagerLoading(false);
    }
  }, [organizationId]);

  const openFileManager = async () => {
    setFileManagerOpen(true);
    setError('');
    try {
      await loadFileManagerRows();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'دریافت فهرست فایل‌منیجر ناموفق بود.');
    }
  };

  const loadSelectedFromFileManager = async () => {
    const selected = fileManagerRows.filter((row) => selectedFileManagerIds.has(row.id));
    if (!selected.length) return setError('حداقل یک فایل از فایل‌منیجر انتخاب کنید.');
    setBusy(true);
    setError('');
    setStatus('در حال دریافت فایل‌های انتخاب‌شده از فایل‌منیجر…');
    try {
      const imported: File[] = [];
      for (const row of selected) {
        let blob: Blob;
        const aliasId = typeof row.metadata?.copyAliasFileAssetId === 'string' ? row.metadata.copyAliasFileAssetId : '';
        if (aliasId || row.file_asset_id) {
          blob = await downloadTelegramArchivedFile(aliasId || row.file_asset_id!);
        } else if (row.storage_path) {
          const { data, error: storageError } = await supabase.storage.from('customs_documents').download(row.storage_path);
          if (storageError) throw storageError;
          blob = data;
        } else {
          throw new Error('مسیر بازیابی فایل «' + row.original_name + '» ثبت نشده است.');
        }
        imported.push(new File([blob], row.original_name, { type: row.mime_type || blob.type || 'application/pdf', lastModified: Date.now() }));
      }
      setFileManagerOpen(false);
      setSelectedFileManagerIds(new Set());
      await loadFiles(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'فراخوانی فایل‌ها ناموفق بود.');
      setBusy(false);
    }
  };

  const toggleFileManagerSelection = (id: string) => {
    setSelectedFileManagerIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
              <Upload size={17}/> افزودن فایل یا تصویر
            </button>
            <button type="button" onClick={() => void openFileManager()} disabled={busy || !organizationId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-50">
              <Files size={17}/> فراخوانی از فایل‌منیجر
            </button>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg" multiple className="hidden" onChange={(event) => {
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

        {fileManagerOpen && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-black">فراخوانی چندفایلی از فایل‌منیجر</h2><p className="mt-1 text-xs text-[var(--muted)]">فایل‌های PDF و تصویر را از پوشه‌های مجاز سازمان انتخاب کنید. می‌توانید این کار را هر چند بار تکرار کنید.</p></div>
              <button type="button" onClick={() => setFileManagerOpen(false)} className="rounded-lg border border-[var(--border)] p-2" aria-label="بستن"><X size={16}/></button>
            </div>
            <input value={fileManagerSearch} onChange={(event) => setFileManagerSearch(event.target.value)} placeholder="جست‌وجو بر اساس نام فایل یا پوشه…" className="mt-3 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
            {fileManagerLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]"><Loader2 className="animate-spin" size={17}/> در حال دریافت فهرست…</div>
            ) : (
              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                {fileManagerRows.filter((row) => {
                  const folderName = fileManagerFolders.find((folder) => folder.id === row.folder_id)?.display_name || '';
                  const query = fileManagerSearch.trim().toLocaleLowerCase();
                  return !query || row.original_name.toLocaleLowerCase().includes(query) || folderName.toLocaleLowerCase().includes(query);
                }).map((row) => (
                  <label key={row.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] p-2 text-xs">
                    <input type="checkbox" checked={selectedFileManagerIds.has(row.id)} onChange={() => toggleFileManagerSelection(row.id)} className="h-4 w-4"/>
                    <FileText size={16} className="shrink-0 text-blue-400"/>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{row.original_name}</span>
                      <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{fileManagerFolders.find((folder) => folder.id === row.folder_id)?.display_name || 'پوشه'} · {formatSize(Number(row.size_bytes) || 0)}</span>
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">{row.mime_type}</span>
                  </label>
                ))}
                {!fileManagerRows.length && <p className="py-5 text-center text-xs text-[var(--muted)]">فایل PDF یا تصویر قابل فراخوانی پیدا نشد.</p>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted)]">{selectedFileManagerIds.size} فایل انتخاب شده</span>
              <button type="button" onClick={() => void loadSelectedFromFileManager()} disabled={busy || fileManagerLoading || !selectedFileManagerIds.size} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">افزودن فایل‌های انتخاب‌شده به محیط کار</button>
            </div>
          </section>
        )}

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
                        <input value={page.label} onClick={(event) => event.stopPropagation()} onChange={(event) => updatePage(page.id, { label: event.target.value })} aria-label="نام پیشنهادی صفحه" className="mt-2 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px]" placeholder="نام سند این صفحه"/>
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
                  <p className="max-w-sm text-xs leading-6 text-[var(--muted)]">می‌توانید PDF و تصویرهای کالا یا لیبل را بارگذاری کنید، یا چند فایل را در چند نوبت از فایل‌منیجر فراخوانی کنید.</p>
                  <button type="button" onClick={() => inputRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">انتخاب فایل</button>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h3 className="mb-3 font-black">قالب خروجی و جداسازی چندبخشی</h3>
              <label className="block text-xs text-[var(--muted)]">نوع بسته خروجی</label>
              <select value={outputPreset} onChange={(event) => applyOutputPreset(event.target.value as 'custom' | 'shipPass' | 'guarantee' | 'standard')} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
                <option value="custom">جداسازی دلخواه</option>
                <option value="shipPass">پاس کشتی</option>
                <option value="guarantee">درخواست ضمانتنامه</option>
                <option value="standard">مدارک استاندارد - حداکثر ۲ مگابایت</option>
              </select>
              <label className="mt-3 block text-xs text-[var(--muted)]">نام بسته یا فایل نهایی</label>
              <input value={packageName} onChange={(event) => setPackageName(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
              {outputPreset === 'standard' ? (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-5 text-[var(--muted)]">
                  تمام صفحات فعلی (از جمله اسناد، لیبل، عکس کالا، پروانه بهره‌برداری، تمدید پروانه و علامت استاندارد) در یک PDF جمع می‌شوند. سقف ۲ مگابایت اجباری است؛ در صورت نیاز، فشرده‌سازی تصویری تطبیقی اجرا می‌شود.
                </div>
              ) : (
                <>
                  <div className="mt-3 space-y-2">
                    {splitRows.map((row, index) => (
                      <div key={row.id} className="rounded-xl border border-[var(--border)] p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--muted)]">{index + 1}.</span>
                          <input value={row.name} onChange={(event) => setSplitRows((previous) => previous.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs" placeholder="نام فایل خروجی"/>
                          <button type="button" onClick={() => setSplitRows((previous) => previous.filter((item) => item.id !== row.id))} disabled={splitRows.length <= 1} className="rounded-lg border border-red-500/30 p-2 text-red-400 disabled:opacity-30" aria-label="حذف خروجی"><Trash2 size={13}/></button>
                        </div>
                        <label className="mt-2 block text-[10px] text-[var(--muted)]">شماره صفحه‌ها؛ نمونه: 1-2 یا 1,5 یا 1-2,5</label>
                        <input value={row.pageExpression} onChange={(event) => setSplitRows((previous) => previous.map((item) => item.id === row.id ? { ...item, pageExpression: event.target.value } : item))} dir="ltr" placeholder="1-2,5" className="mt-1 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm"/>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setSplitRows((previous) => [...previous, { id: crypto.randomUUID(), name: 'سند جدید', pageExpression: '' }])} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-xs">افزودن بخش جداسازی</button>
                </>
              )}
              <button type="button" onClick={() => void splitPdf()} disabled={busy || !pages.length || !packageName.trim()} className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                <Scissors className="ml-1 inline" size={15}/>{outputPreset === 'standard' ? 'ساخت PDF استاندارد زیر ۲ مگابایت' : 'ساخت همه خروجی‌ها و دانلود ZIP'}
              </button>
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">هر ردیف یک فایل جداست. شماره‌ها بر اساس ترتیب فعلی صفحات هستند؛ یک صفحه می‌تواند در چند خروجی استفاده شود.</p>
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
              <h3 className="mb-2 font-black">فشرده‌سازی قابل تنظیم</h3>
              <label className="block text-xs text-[var(--muted)]">کیفیت تصویر: {Math.round(compressionQuality * 100)}٪</label>
              <input type="range" min="0.35" max="0.9" step="0.05" value={compressionQuality} onChange={(event) => setCompressionQuality(Number(event.target.value))} className="mt-2 w-full"/>
              <label className="mt-3 block text-xs text-[var(--muted)]">وضوح بازسازی: {compressionScale.toFixed(1)}×</label>
              <input type="range" min="0.7" max="1.8" step="0.1" value={compressionScale} onChange={(event) => setCompressionScale(Number(event.target.value))} className="mt-2 w-full"/>
              <button type="button" onClick={() => void compressActivePdf()} disabled={busy || !documents.length} className="mt-3 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-bold disabled:opacity-40"><ShieldCheck className="ml-1 inline" size={15}/> بهینه‌سازی ساختاری و حفظ متن</button>
              <button type="button" onClick={() => void compressScans()} disabled={busy || !documents.length} className="mt-2 w-full rounded-xl border border-amber-500/30 px-3 py-2.5 text-xs font-bold text-amber-600 disabled:opacity-40"><Sparkles className="ml-1 inline" size={15}/> فشرده‌سازی تصویری با تنظیمات بالا</button>
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">کاهش وضوح یا کیفیت، حجم را کمتر و کیفیت چاپ را پایین‌تر می‌آورد. فایل اصلی همیشه حفظ می‌شود؛ نسخه تصویری متن قابل جست‌وجو و امضای دیجیتال را نگه نمی‌دارد.</p>
            </section>

            <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center gap-2 font-bold text-emerald-500"><ShieldCheck size={16}/> پردازش محلی</div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">فایل‌ها هنگام ویرایش محلی می‌مانند. پیشنهاد نام صفحه فقط از لایه متن قابل انتخاب PDF ساخته می‌شود و برای اسکن‌های تصویری OCR فعال نمی‌شود تا سرعت و حریم خصوصی حفظ شود.</p>
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
