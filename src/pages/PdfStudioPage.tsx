import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, FileImage, FilePlus2, FileText, Files, Folder, Loader2, Minus, RotateCw, Scissors, ShieldCheck, Stamp, Trash2, Upload, Sparkles, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PDFDocument, degrees } from 'pdf-lib';
import { createWorker } from 'tesseract.js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { downloadTelegramArchivedFile } from '../lib/fileManager';
import { PDF_STUDIO_PRESETS, pageExpressionForMatches, parsePageSelection, suggestDocumentLabel } from '../lib/pdfStudioUtils';
import {
  buildDocumentPageFeatures, buildDocumentPageFeaturesFromText, estimateJpegBytesFromSamples,
  recognizeDocumentPage, type DocumentPageFeatures, type RecognitionSample,
} from '../lib/pdfRecognition';
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
  features: DocumentPageFeatures;
  pageArea: number;
};
type CompressionSettings = {
  mode: 'smart' | 'preserve' | 'raster';
  quality: number;
  dpi: number;
  grayscale: boolean;
};
type CompressionProfile = { id: string; name: string; settings: CompressionSettings };
type CompressionEstimate = {
  low: number; expected: number; high: number;
  preservedPages: number; rasterizedPages: number; sampledPages: number;
};
type ReadyOutput = {
  id: string;
  name: string;
  blob: Blob;
  size: number;
  description: string;
  createdAt: string;
  downloadedAt?: string;
};
type OutputTools = { merge: boolean; split: boolean; compression: boolean; stamp: boolean };
type FileManagerFolder = { id: string; parent_id: string | null; display_name: string; folder_type: string };
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
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  const sampleInputRef = useRef<HTMLInputElement>(null);
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
  const [studioTab, setStudioTab] = useState<'pages' | 'outputs' | 'recognition'>('pages');
  const [compressionSettings, setCompressionSettings] = useState<CompressionSettings>({
    mode: 'smart', quality: 0.9, dpi: 240, grayscale: false,
  });
  const [compressionProfiles, setCompressionProfiles] = useState<CompressionProfile[]>([]);
  const [compressionProfileName, setCompressionProfileName] = useState('اسناد خوانا');
  const [compressionEstimate, setCompressionEstimate] = useState<CompressionEstimate | null>(null);
  const [compressionEstimating, setCompressionEstimating] = useState(false);
  const [readyOutputs, setReadyOutputs] = useState<ReadyOutput[]>([]);
  const [outputTools, setOutputTools] = useState<OutputTools>({
    merge: false, split: false, compression: false, stamp: false,
  });
  const [compressionStorageReady, setCompressionStorageReady] = useState(false);
  const [recognitionSamples, setRecognitionSamples] = useState<RecognitionSample[]>([]);
  const [recognitionLoading, setRecognitionLoading] = useState(false);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [sampleDocumentType, setSampleDocumentType] = useState('اظهارنامه');
  const [sampleDisplayName, setSampleDisplayName] = useState('');
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState('');
  const [recognitionProgress, setRecognitionProgress] = useState('');
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileManagerLoading, setFileManagerLoading] = useState(false);
  const [fileManagerRows, setFileManagerRows] = useState<FileManagerRow[]>([]);
  const [fileManagerFolders, setFileManagerFolders] = useState<FileManagerFolder[]>([]);
  const [fileManagerCurrentFolderId, setFileManagerCurrentFolderId] = useState<string | null>(null);
  const [fileManagerSearch, setFileManagerSearch] = useState('');
  const [fileManagerSearchAll, setFileManagerSearchAll] = useState(false);
  const [selectedFileManagerIds, setSelectedFileManagerIds] = useState<Set<string>>(() => new Set());

  const selectedPages = useMemo(() => pages.filter((page) => page.selected), [pages]);
  const selectedCount = selectedPages.length;
  const totalBytes = useMemo(() => documents.reduce((sum, item) => sum + item.file.size, 0), [documents]);
  const compressionItems = useMemo(() => selectedCount ? selectedPages : pages, [selectedCount, selectedPages, pages]);

  const queueOutputs = (outputs: Array<{ blob: Blob; name: string; description: string }>) => {
    if (!outputs.length) return;
    const prepared: ReadyOutput[] = outputs.map((output) => ({
      id: crypto.randomUUID(),
      name: output.name,
      blob: output.blob,
      size: output.blob.size,
      description: output.description,
      createdAt: new Date().toISOString(),
    }));
    setReadyOutputs((previous) => [...prepared, ...previous]);
    setStatus(
      prepared.length === 1
        ? 'فایل «' + prepared[0].name + '» آماده است. برای دریافت، دکمه دانلود را بزنید؛ فایل‌های ورودی و تنظیمات حفظ می‌شوند.'
        : prepared.length + ' فایل آماده دانلود است. دکمه دانلود هر فایل را جداگانه بزنید؛ محیط کاری حفظ می‌شود.'
    );
  };

  const downloadReadyOutput = (output: ReadyOutput) => {
    downloadBlob(output.blob, output.name);
    setReadyOutputs((previous) => previous.map((item) =>
      item.id === output.id ? { ...item, downloadedAt: new Date().toISOString() } : item
    ));
    setStatus('دانلود «' + output.name + '» آغاز شد. فایل‌های فراخوانی‌شده، ترتیب صفحات و تنظیمات در PDF Studio باقی ماندند.');
  };
  const currentFileManagerFolder = useMemo(
    () => fileManagerFolders.find((folder) => folder.id === fileManagerCurrentFolderId) || null,
    [fileManagerFolders, fileManagerCurrentFolderId],
  );
  const fileManagerFolderPath = useMemo(() => {
    const path: FileManagerFolder[] = [];
    let current = currentFileManagerFolder;
    let hops = 0;
    while (current && hops < 30) {
      path.unshift(current);
      current = current.parent_id ? fileManagerFolders.find((folder) => folder.id === current!.parent_id) || null : null;
      hops += 1;
    }
    return path;
  }, [currentFileManagerFolder, fileManagerFolders]);
  const visibleFileManagerFolders = useMemo(
    () => fileManagerFolders.filter((folder) => folder.parent_id === fileManagerCurrentFolderId),
    [fileManagerFolders, fileManagerCurrentFolderId],
  );
  const visibleFileManagerRows = useMemo(() => {
    const query = fileManagerSearch.trim().toLocaleLowerCase();
    return fileManagerRows.filter((row) => {
      const folder = fileManagerFolders.find((item) => item.id === row.folder_id);
      const folderPath = folder ? folder.display_name.toLocaleLowerCase() : '';
      const inScope = fileManagerSearchAll || row.folder_id === fileManagerCurrentFolderId;
      const matches = !query || row.original_name.toLocaleLowerCase().includes(query) || folderPath.includes(query);
      return inScope && matches;
    });
  }, [fileManagerRows, fileManagerFolders, fileManagerCurrentFolderId, fileManagerSearch, fileManagerSearchAll]);

  useEffect(() => {
    if (!organizationId) return;
    try {
      const stored = localStorage.getItem('customs-os-pdfstudio-compression:' + organizationId);
      if (stored) {
        const parsed = JSON.parse(stored) as { settings?: CompressionSettings; profiles?: CompressionProfile[] };
        if (parsed.settings) setCompressionSettings(parsed.settings);
        if (Array.isArray(parsed.profiles)) setCompressionProfiles(parsed.profiles);
      }
    } catch {
      // Local settings are an enhancement; blocked storage must not stop PDF Studio.
    } finally {
      setCompressionStorageReady(true);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !compressionStorageReady) return;
    try {
      localStorage.setItem('customs-os-pdfstudio-compression:' + organizationId, JSON.stringify({
        settings: compressionSettings,
        profiles: compressionProfiles,
      }));
    } catch {
      // Settings remain active in the current session when browser storage is full or blocked.
    }
  }, [organizationId, compressionStorageReady, compressionSettings, compressionProfiles]);

  const loadRecognitionSamples = useCallback(async () => {
    if (!organizationId) return;
    if (!['owner', 'admin', 'broker', 'accountant', 'warehouse'].includes(String(profile?.role || ''))) {
      setRecognitionSamples([]);
      return;
    }
    setRecognitionLoading(true);
    try {
      const { data, error: samplesError } = await (supabase as any).from('pdf_document_recognition_samples')
        .select('id,document_type,sample_name,source_filename,page_count,features,created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (samplesError) throw samplesError;
      setRecognitionSamples((data || []) as RecognitionSample[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'دریافت الگوهای تشخیص ناموفق بود.');
    } finally {
      setRecognitionLoading(false);
    }
  }, [organizationId, profile?.role]);

  useEffect(() => { void loadRecognitionSamples(); }, [loadRecognitionSamples]);

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
          hasProtectedFeatures = /\/ByteRange\s*\[|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/AcroForm\b|\/XFA\b|\/EmbeddedFiles\b|\/Filespec\b|\/Outlines\b|\/StructTreeRoot\b|\/OutputIntents\b|\/AF\s*\[|\/Annots\b|\/PageLabels\b|\/OCProperties\b|\/OpenAction\b|\/JavaScript\b|\/Perms\b|\/Collection\b|\/Threads\b/i.test(pdfMarkers);
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
          let pageText = '';
          let pageFeatures: DocumentPageFeatures = { tokens: [], anchors: [], numericShapes: [], textLength: 0 };
          const unitViewport = page.getViewport({ scale: 1 });
          const pageArea = unitViewport.width * unitViewport.height;
          try {
            const textContent = await page.getTextContent();
            pageText = textContent.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' ');
            pageFeatures = buildDocumentPageFeatures(textContent.items as any[], unitViewport.width, unitViewport.height);
          } catch {
            // Image-only or unusual pages fall back to the source filename; do not block import.
          }
          const recognized = pageFeatures.tokens.length ? recognizeDocumentPage(pageFeatures, recognitionSamples) : null;
          nextPages.push({
            id: id + '-page-' + pageNumber,
            documentId: id,
            pageIndex: pageNumber - 1,
            thumbnail: canvas.toDataURL('image/jpeg', 0.72),
            rotation: 0,
            selected: false,
            label: recognized && recognized.confidence >= 0.2
              ? recognized.documentType
              : suggestDocumentLabel(pageText, file.name, pageNumber),
            features: pageFeatures,
            pageArea,
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
  }, [recognitionSamples]);

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

  const buildPdf = async (items: PageItem[], fileName: string, description: string) => {
    const bytes = await createPdfBytes(items);
    const outputName = fileName.endsWith('.pdf') ? fileName : fileName + '.pdf';
    queueOutputs([{ blob: new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }), name: outputName, description }]);
  };

  const renderPdfPageJpeg = async (pdfPage: any, item: PageItem, settings: CompressionSettings) => {
    const scale = settings.dpi / 72;
    const rotation = (pdfPage.rotate + item.rotation) % 360;
    const viewport = pdfPage.getViewport({ scale, rotation });
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('امکان بازسازی صفحه وجود ندارد.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = settings.grayscale ? 'grayscale(1)' : 'none';
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    context.filter = 'none';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('ساخت تصویر فشرده صفحه ناموفق بود.')), 'image/jpeg', settings.quality)
    );
    const area = viewport.width * viewport.height;
    canvas.width = 1;
    canvas.height = 1;
    return { blob, width: baseViewport.width, height: baseViewport.height, area };
  };

  const shouldPreservePageText = (page: PageItem) =>
    page.features.textLength >= 18 || page.features.tokens.length >= 5;

  const compressDocumentPages = async (
    items: PageItem[],
    settings: CompressionSettings,
    preserveDocumentIds: Set<string> = new Set(),
  ): Promise<{ blob: Blob; preservedPages: number; rasterizedPages: number }> => {
    if (!items.length) throw new Error('صفحه‌ای برای فشرده‌سازی انتخاب نشده است.');
    const output = await PDFDocument.create();
    const previewDocuments = new Map<string, any>();
    let preservedPages = 0;
    let rasterizedPages = 0;
    try {
      for (const item of items) {
        const source = sourcePdfs.current.get(item.documentId);
        if (!source) throw new Error('منبع یکی از صفحات در حافظه پیدا نشد.');
        const keepText = preserveDocumentIds.has(item.documentId) || settings.mode === 'preserve' || (settings.mode === 'smart' && shouldPreservePageText(item));
        if (keepText) {
          const [copied] = await output.copyPages(source, [item.pageIndex]);
          if (item.rotation) copied.setRotation(degrees((copied.getRotation().angle + item.rotation) % 360));
          output.addPage(copied);
          preservedPages += 1;
          continue;
        }

        let preview = previewDocuments.get(item.documentId);
        if (!preview) {
          const sourceBytes = await source.save();
          preview = await getDocument({ data: new Uint8Array(sourceBytes.slice(0)) }).promise;
          previewDocuments.set(item.documentId, preview);
        }
        const sourcePage = await preview.getPage(item.pageIndex + 1);
        const rendered = await renderPdfPageJpeg(sourcePage, item, settings);
        const embedded = await output.embedJpg(await rendered.blob.arrayBuffer());
        const targetPage = output.addPage([rendered.width, rendered.height]);
        targetPage.drawImage(embedded, { x: 0, y: 0, width: rendered.width, height: rendered.height });
        rasterizedPages += 1;
      }
      const bytes = await output.save({ useObjectStreams: true });
      return {
        blob: new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }),
        preservedPages,
        rasterizedPages,
      };
    } finally {
      await Promise.all([...previewDocuments.values()].map((preview) => preview.destroy().catch(() => undefined)));
    }
  };

  const compressPagesToTarget = async (items: PageItem[], targetBytes: number) => {
    const attempts = [
      { dpi: 240, quality: 0.9 },
      { dpi: 210, quality: 0.86 },
      { dpi: 180, quality: 0.82 },
      { dpi: 150, quality: 0.78 },
      { dpi: 120, quality: 0.72 },
    ];
    let smallest: Blob | null = null;
    let used = attempts[attempts.length - 1];
    for (const attempt of attempts) {
      setStatus('فشرده‌سازی برای سقف ۲ مگابایت: ' + attempt.dpi + ' DPI و کیفیت ' + Math.round(attempt.quality * 100) + '٪…');
      const result = await compressDocumentPages(items, {
        mode: 'raster',
        dpi: attempt.dpi,
        quality: attempt.quality,
        grayscale: compressionSettings.grayscale,
      });
      if (!smallest || result.blob.size < smallest.size) {
        smallest = result.blob;
        used = attempt;
      }
      if (result.blob.size <= targetBytes) return { blob: result.blob, scale: attempt.dpi / 72, quality: attempt.quality };
    }
    if (smallest && smallest.size <= targetBytes) return { blob: smallest, scale: used.dpi / 72, quality: used.quality };
    throw new Error('با کمترین تنظیمات قابل‌قبول هم خروجی زیر ۲ مگابایت نشد. کمترین حجم به‌دست‌آمده: ' + formatSize(smallest?.size || 0) + '؛ برای حفظ خوانایی اعداد، اسناد را به چند خروجی تقسیم کنید.');
  };

  const estimateCompression = async () => {
    if (!compressionItems.length) return setError('ابتدا فایل‌ها یا صفحه‌های موردنظر را انتخاب کنید.');
    setCompressionEstimating(true);
    setCompressionEstimate(null);
    setError('');
    try {
      const settings = { ...compressionSettings };
      const protectedIds = new Set(documents.filter((document) => document.hasProtectedFeatures).map((document) => document.id));
      const preserved = compressionItems.filter((item) =>
        protectedIds.has(item.documentId) || settings.mode === 'preserve' || (settings.mode === 'smart' && shouldPreservePageText(item))
      );
      const rasterPages = compressionItems.filter((item) => !preserved.includes(item));
      const pageAreas = rasterPages.map((item) => item.pageArea * (settings.dpi / 72) ** 2);
      const samples: Array<{ bytes: number; area: number }> = [];
      const grouped = new Map<string, PageItem[]>();
      for (const item of rasterPages) grouped.set(item.documentId, [...(grouped.get(item.documentId) || []), item]);
      const previewDocuments = new Map<string, any>();
      let preservedBytes = 0;
      for (const document of documents) {
        const items = compressionItems.filter((item) => item.documentId === document.id);
        if (!items.length) continue;
        const kept = items.filter((item) => preserved.includes(item));
        if (document.hasProtectedFeatures) {
          preservedBytes += document.file.size * (items.length / Math.max(1, document.pageCount));
        } else if (kept.length) {
          preservedBytes += document.file.size * (kept.length / Math.max(1, document.pageCount));
        }
      }
      try {
        for (const [documentId, items] of grouped) {
          const source = sourcePdfs.current.get(documentId);
          if (!source) continue;
          const sourceBytes = await source.save();
          const preview = await getDocument({ data: new Uint8Array(sourceBytes.slice(0)) }).promise;
          previewDocuments.set(documentId, preview);
          const sampleIndices = [...new Set([0, Math.floor((items.length - 1) / 2), items.length - 1])];
          for (const index of sampleIndices) {
            const item = items[index];
            const page = await preview.getPage(item.pageIndex + 1);
            const rendered = await renderPdfPageJpeg(page, item, settings);
            samples.push({ bytes: rendered.blob.size, area: rendered.area });
          }
        }
      } finally {
        await Promise.all([...previewDocuments.values()].map((preview) => preview.destroy().catch(() => undefined)));
      }
      const imageEstimate = estimateJpegBytesFromSamples(samples, pageAreas, rasterPages.length * 18_000);
      const overhead = compressionItems.length * 14_000;
      const expected = Math.round(imageEstimate.expected + preservedBytes + overhead);
      const low = Math.round(imageEstimate.low + preservedBytes + overhead * 0.75);
      const high = Math.round(imageEstimate.high + preservedBytes + overhead * 1.35);
      setCompressionEstimate({
        low: Math.max(0, low),
        expected: Math.max(0, expected),
        high: Math.max(0, high),
        preservedPages: preserved.length,
        rasterizedPages: rasterPages.length,
        sampledPages: samples.length,
      });
      setStatus('برآورد حجم با نمونه‌گیری از ' + samples.length + ' صفحه انجام شد؛ این عدد تخمینی است و حجم نهایی پس از ساخت PDF دقیق مشخص می‌شود.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'برآورد حجم خروجی ناموفق بود.');
    } finally {
      setCompressionEstimating(false);
    }
  };

  const compressActivePdf = async () => {
    if (!documents.length || !compressionItems.length) return setError('ابتدا فایل یا صفحه برای فشرده‌سازی انتخاب کنید.');

    const protectedDocumentIds = new Set(
      documents.filter((document) => document.hasProtectedFeatures && compressionItems.some((item) => item.documentId === document.id))
        .map((document) => document.id),
    );
    // Explicit raster mode means the user has accepted losing page-level PDF features.
    // Smart/preserve modes keep complex source documents vector-based where possible.
    const pagePreservationIds = compressionSettings.mode === 'raster' ? new Set<string>() : protectedDocumentIds;
    const warnings: string[] = [];
    if (compressionSettings.mode === 'raster') {
      warnings.push('در حالت فشرده‌سازی تصویری کامل، متن قابل جست‌وجو، فرم‌ها، لینک‌ها و لایه‌ها حفظ نمی‌شوند.');
    }
    if (protectedDocumentIds.size) {
      warnings.push('یکی از فایل‌ها ساختار محافظت‌شده‌ای مانند امضا، فرم، پیوند یا لایه دارد. ساخت PDF جدید ممکن است اعتبار امضای دیجیتال یا اجزای تعاملی را حفظ نکند؛ در حالت هوشمند این صفحات تا حد امکان برداری باقی می‌مانند.');
    }
    if (warnings.length && !window.confirm(warnings.join('\n\n') + '\n\nفایل‌های اصلی بدون تغییر باقی می‌مانند. ادامه می‌دهید؟')) return;

    setBusy(true);
    setError('');
    try {
      const originalBytes = await createPdfBytes(compressionItems);
      let candidate = await compressDocumentPages(compressionItems, compressionSettings, pagePreservationIds);
      let compressionMode = compressionSettings.mode;

      if (candidate.blob.size >= originalBytes.byteLength && compressionSettings.mode === 'smart') {
        const confirmed = window.confirm(
          'حالت هوشمند حجم این PDF را کاهش نداد؛ احتمالاً صفحات اسکن‌شده دارای لایه متن هستند. برای کاهش بیشتر می‌توان صفحات غیرمحافظت‌شده را به تصویر تبدیل کرد، اما متن آن صفحات دیگر قابل جست‌وجو یا انتخاب نخواهد بود. فایل اصلی دست‌نخورده می‌ماند. ادامه می‌دهید؟',
        );
        if (!confirmed) {
          setStatus('فشرده‌سازی هوشمند کاهش حجمی ایجاد نکرد؛ فایل اصلی و صفحات کاری بدون تغییر باقی ماندند.');
          return;
        }
        compressionMode = 'raster';
      }

      if (compressionMode === 'raster' && candidate.blob.size >= originalBytes.byteLength) {
        const rasterAttempts = [
          { dpi: compressionSettings.dpi, quality: compressionSettings.quality },
          { dpi: Math.min(compressionSettings.dpi, 180), quality: Math.min(compressionSettings.quality, 0.82) },
          { dpi: Math.min(compressionSettings.dpi, 150), quality: Math.min(compressionSettings.quality, 0.76) },
          { dpi: Math.min(compressionSettings.dpi, 120), quality: Math.min(compressionSettings.quality, 0.70) },
        ].filter((attempt, index, all) =>
          all.findIndex((item) => item.dpi === attempt.dpi && item.quality === attempt.quality) === index,
        );

        for (let index = 0; index < rasterAttempts.length; index += 1) {
          const attempt = rasterAttempts[index];
          if (compressionSettings.mode === 'raster' && index === 0) continue;
          setStatus('حجم هنوز کاهش نیافته؛ تلاش ' + (index + 1) + ' از ' + rasterAttempts.length +
            ' با ' + attempt.dpi + ' DPI و کیفیت ' + Math.round(attempt.quality * 100) + '٪…');
          const next = await compressDocumentPages(compressionItems, {
            ...compressionSettings,
            mode: 'raster',
            ...attempt,
          }, pagePreservationIds);
          if (next.blob.size < candidate.blob.size) candidate = next;
          if (candidate.blob.size < originalBytes.byteLength) break;
        }
      }

      if (candidate.blob.size >= originalBytes.byteLength) {
        const actualSize = formatSize(candidate.blob.size);
        if (compressionSettings.mode === 'preserve') {
          setStatus('حالت حفظ کامل متن، حجم فایل را کاهش نداد. برای کاهش واقعی حجم، حالت هوشمند یا تصویری را انتخاب کنید.');
        } else {
          setError('پس از چند سطح فشرده‌سازی، حجم فایل کمتر نشد. کمترین حجم به‌دست‌آمده: ' + actualSize +
            '. فایل اصلی تغییر نکرد و خروجی تکراری ساخته نشد؛ وضوح پایین‌تر یا تقسیم سند را امتحان کنید.');
        }
        return;
      }

      const savedPercent = Math.max(0, Math.round((1 - candidate.blob.size / originalBytes.byteLength) * 100));
      const profileName = compressionProfileName.trim() || 'تنظیمات فعلی';
      const outputName = 'PDF-Studio-' + safeName(profileName) + '-compressed.pdf';
      queueOutputs([{
        blob: candidate.blob,
        name: outputName,
        description: 'فشرده‌سازی با پروفایل «' + profileName + '» · از ' +
          formatSize(originalBytes.byteLength) + ' به ' + formatSize(candidate.blob.size) +
          ' (کاهش ' + savedPercent + '٪) · صفحات حفظشده: ' + candidate.preservedPages +
          ' · صفحات تصویری: ' + candidate.rasterizedPages +
          (pagePreservationIds.size ? ' · صفحات دارای ساختار محافظت‌شده برداری نگه داشته شدند.' : '') +
          (compressionMode === 'raster' && compressionSettings.mode === 'smart' ? ' · روش تصویری جایگزین اجرا شد.' : ''),
      }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'فشرده‌سازی فایل‌ها ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };
  const saveCompressionProfile = () => {
    const name = compressionProfileName.trim();
    if (!name) return setError('برای تنظیمات فشرده‌سازی نام وارد کنید.');
    setCompressionProfiles((previous) => [
      { id: crypto.randomUUID(), name, settings: { ...compressionSettings } },
      ...previous.filter((profile) => profile.name !== name),
    ]);
    setStatus('تنظیمات «' + name + '» ذخیره شد و با ساخت خروجی‌های بعدی از بین نمی‌رود.');
  };

  const applyCompressionProfile = (id: string) => {
    const profile = compressionProfiles.find((item) => item.id === id);
    if (!profile) return;
    setCompressionSettings({ ...profile.settings });
    setCompressionProfileName(profile.name);
    setCompressionEstimate(null);
  };

  const compressScans = async () => {
    await compressActivePdf();
  };

  const exportMerged = async (onlySelected = false) => {
    const items = onlySelected ? pages.filter((page) => page.selected) : pages;
    const signed = items.some((item) => documents.some((document) => document.id === item.documentId && document.hasProtectedFeatures));
    if (signed && !window.confirm('یک فایل دارای امضای دیجیتال یا فرم تعاملی است. استخراج/ادغام صفحات، امضای دیجیتال اصلی را معتبر نگه نمی‌دارد. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
    setBusy(true);
    setError('');
    try {
      await buildPdf(
        items,
        onlySelected ? 'PDF-Studio-Selected-Pages.pdf' : 'PDF-Studio-Merged.pdf',
        onlySelected ? 'استخراج صفحات انتخاب‌شده در یک PDF مستقل' : 'ادغام همه صفحات در یک PDF مستقل',
      );
      setStatus(items.length + ' صفحه ساخته شد؛ فایل در بخش «فایل‌های آماده دانلود» قرار گرفت. فایل‌های ورودی و تنظیمات حفظ شدند.');
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
        if (protectedIncluded && !window.confirm('بعضی صفحات امضای دیجیتال یا فرم محافظت‌شده دارند. ترکیب یا استخراج ممکن است اعتبار امضا را از بین ببرد؛ فایل‌های اصلی دست‌نخورده می‌مانند. فقط روی نسخه خروجی ادامه می‌دهید؟')) return;
        const sourceBytes = await createPdfBytes(pages);
        if (sourceBytes.byteLength <= 2 * 1024 * 1024) {
          queueOutputs([{
            blob: new Blob([toArrayBuffer(sourceBytes)], { type: 'application/pdf' }),
            name: safeName(packageName) + '.pdf',
            description: 'PDF استاندارد · ' + formatSize(sourceBytes.byteLength) + ' · زیر سقف ۲ مگابایت',
          }]);
          setStatus('خروجی استاندارد با حجم ' + formatSize(sourceBytes.byteLength) + ' آماده دانلود است؛ محیط کاری حفظ شد.');
          return;
        }
        if (!window.confirm('برای رساندن خروجی استاندارد به سقف ۲ مگابایت، صفحات به تصویر فشرده تبدیل می‌شوند؛ متن قابل جست‌وجو، فرم‌ها، لینک‌ها و لایه‌ها در نسخه خروجی حفظ نمی‌شوند. فایل‌های اصلی بدون تغییر می‌مانند. ادامه می‌دهید؟')) return;
        const result = await compressPagesToTarget(pages, 2 * 1024 * 1024);
        queueOutputs([{
          blob: result.blob,
          name: safeName(packageName) + '.pdf',
          description: 'PDF استاندارد فشرده · ' + formatSize(result.blob.size) +
            ' · وضوح ' + result.scale.toFixed(2) + ' · کیفیت ' + Math.round(result.quality * 100) + '٪',
        }]);
        setStatus('خروجی استاندارد آماده دانلود است: ' + formatSize(result.blob.size) + '؛ محیط کاری حفظ شد.');
        return;
      }

      if (protectedIncluded && !window.confirm('تقسیم فایل دارای امضای دیجیتال یا فرم تعاملی، اعتبار امضای اصلی را حفظ نمی‌کند. فقط روی نسخه کپی ادامه می‌دهید؟')) return;
      const outputFiles: Array<{ name: string; bytes: Uint8Array }> = [];
      const outputNames = new Set<string>();
      for (let index = 0; index < splitRows.length; index += 1) {
        const row = splitRows[index];
        if (!row.name.trim()) throw new Error('نام هر خروجی را وارد کنید.');
        const pageNumbers = parsePageSelection(row.pageExpression, pages.length);
        const items = pageNumbers.map((pageNumber) => pages[pageNumber - 1]);
        const fileName = safeName(row.name.trim()) + '.pdf';
        if (outputNames.has(fileName)) throw new Error('نام خروجی تکراری است: ' + row.name);
        outputNames.add(fileName);
        outputFiles.push({ name: fileName, bytes: await createPdfBytes(items) });
      }
      if (!outputFiles.length) throw new Error('حداقل یک بخش برای خروجی تعریف کنید.');
      queueOutputs(outputFiles.map((item) => ({
        name: item.name,
        blob: new Blob([toArrayBuffer(item.bytes)], { type: 'application/pdf' }),
        description: 'بخش تفکیک‌شده از بسته «' + packageName + '»',
      })));
      setStatus(outputFiles.length + ' فایل PDF جداگانه آماده دانلود است؛ هرکدام دکمه دانلود مستقل دارد. هیچ ZIP ساخته نشد و فایل‌های ورودی حفظ شدند.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ساخت خروجی‌ها ناموفق بود.');
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
        queueOutputs([{
          blob: new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }),
          name: safeName(fileName) + '-annotated.pdf',
          description: 'نسخه دارای متن یا مهر تصویری؛ فایل اصلی در محیط باقی ماند.',
        }]);
      }
      setStatus('نسخه‌های مهرشده آماده دانلود هستند؛ فایل‌های ورودی و صفحات فعلی در محیط باقی ماندند.');
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
        queueOutputs([{
          blob: new Blob([toArrayBuffer(outputBytes)], { type: 'application/pdf' }),
          name: safeName(fileName) + '-signed.pdf',
          description: 'نسخه دارای تصویر مهر یا امضا؛ فایل اصلی در محیط باقی ماند.',
        }]);
      }
      setStatus('نسخه‌های دارای مهر یا امضا آماده دانلود هستند؛ فایل‌های ورودی در محیط باقی ماندند.');
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
        .select('id,parent_id,display_name,folder_type')
        .eq('organization_id', organizationId)
        .order('display_name', { ascending: true });
      if (folderError) throw folderError;
      const folderRows = (folderData || []) as FileManagerFolder[];
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
        return type === 'application/pdf' || type === 'image/png' || type === 'image/jpeg' || /\.(pdf|png|jpe?g)$/i.test(row.original_name);
      }));
    } finally {
      setFileManagerLoading(false);
    }
  }, [organizationId]);

  const openFileManager = async () => {
    setFileManagerOpen(true);
    setFileManagerCurrentFolderId(null);
    setFileManagerSearch('');
    setFileManagerSearchAll(false);
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

  const analyzeAndSaveSample = async () => {
    if (!sampleFile) return setError('ابتدا یک PDF نمونه انتخاب کنید.');
    if (sampleDocumentType.trim().length < 2) return setError('نوع سند نمونه را مشخص کنید.');
    setTrainingBusy(true);
    setTrainingProgress('آماده‌سازی نمونه در همین دستگاه…');
    setError('');
    try {
      const sourceBytes = await sampleFile.arrayBuffer();
      const isImage = /^image\//i.test(sampleFile.type) || /\.(png|jpe?g)$/i.test(sampleFile.name);
      let pdfBytes: Uint8Array = new Uint8Array(sourceBytes.slice(0));
      if (isImage) {
        const imagePdf = await PDFDocument.create();
        const image = sampleFile.type === 'image/png' || /\.png$/i.test(sampleFile.name)
          ? await imagePdf.embedPng(sourceBytes)
          : await imagePdf.embedJpg(sourceBytes);
        const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
        const width = image.width * scale;
        const height = image.height * scale;
        const page = imagePdf.addPage([width, height]);
        page.drawImage(image, { x: 0, y: 0, width, height });
        pdfBytes = await imagePdf.save();
      }
      const pdf = await getDocument({ data: new Uint8Array(pdfBytes.slice(0)) }).promise;
      const samplePageCount = pdf.numPages;
      const pageFeatures: DocumentPageFeatures[] = [];
      let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          setTrainingProgress('تحلیل صفحه ' + pageNumber + ' از ' + pdf.numPages + '…');
          const page = await pdf.getPage(pageNumber);
          const unitViewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();
          let features = buildDocumentPageFeatures(textContent.items as any[], unitViewport.width, unitViewport.height);
          if (features.tokens.length < 4) {
            if (!worker) {
              setTrainingProgress('بارگذاری موتور OCR فارسی و انگلیسی…');
              worker = await createWorker('fas+eng');
            }
            const viewport = page.getViewport({ scale: Math.min(2.4, 1800 / Math.max(unitViewport.width, unitViewport.height)) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('امکان آماده‌سازی تصویر نمونه برای OCR وجود ندارد.');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, viewport }).promise;
            const result = await worker.recognize(canvas);
            const ocrData = result.data as any;
            const ocrWords = (ocrData.words || []).map((word: any) => ({
              text: word.text,
              bbox: word.bbox,
              confidence: word.confidence,
            }));
            features = buildDocumentPageFeaturesFromText(ocrData.text || '', ocrWords, canvas.width, canvas.height);
            canvas.width = 1;
            canvas.height = 1;
          }
          pageFeatures.push(features);
        }
      } finally {
        await worker?.terminate();
        await pdf.destroy();
      }
      const digest = await crypto.subtle.digest('SHA-256', sourceBytes);
      const sampleHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('نشست معتبر نیست؛ دوباره وارد سامانه شوید.');
      const sampleName = sampleDisplayName.trim() || sampleFile.name;
      const sampleRecord = {
        organization_id: organizationId,
        document_type: sampleDocumentType.trim(),
        sample_name: sampleName,
        source_filename: sampleFile.name,
        source_mime_type: sampleFile.type || 'application/pdf',
        sample_hash: sampleHash,
        page_count: samplePageCount,
        features: { version: 1, featureSource: 'local-text-and-ocr', pages: pageFeatures },
        created_by: authData.user.id,
      };
      const { data, error: saveError } = await (supabase as any).from('pdf_document_recognition_samples')
        .insert(sampleRecord)
        .select('id,document_type,sample_name,source_filename,page_count,features,created_at')
        .single();
      if (saveError && saveError.code !== '23505') throw saveError;
      let resultSample = data as RecognitionSample | null;
      if (saveError?.code === '23505') {
        const { data: existing, error: existingError } = await (supabase as any).from('pdf_document_recognition_samples')
          .select('id,document_type,sample_name,source_filename,page_count,features,created_at')
          .eq('organization_id', organizationId)
          .eq('document_type', sampleDocumentType.trim())
          .eq('sample_hash', sampleHash)
          .single();
        if (existingError) throw existingError;
        resultSample = existing as RecognitionSample;
      }
      if (!resultSample) throw new Error('نمونه ذخیره نشد.');
      const savedSample = resultSample;
      setRecognitionSamples((previous) => [savedSample!, ...previous.filter((item) => item.id !== savedSample!.id)]);
      setPages((previous) => previous.map((page) => {
        const match = recognizeDocumentPage(page.features, [savedSample]);
        return match && match.confidence >= 0.2
          ? { ...page, label: match.documentType }
          : page;
      }));
      setStatus('نمونه «' + sampleName + '» به الگوی «' + sampleDocumentType.trim() + '» اضافه شد. فقط ویژگی‌های متن و چیدمان ذخیره شدند؛ فایل نمونه روی سرور بارگذاری نشد.');
      setSampleDisplayName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تحلیل یا ذخیره نمونه ناموفق بود.');
    } finally {
      setTrainingBusy(false);
      setTrainingProgress('');
      if (sampleInputRef.current) sampleInputRef.current.value = '';
    }
  };

  const runWorkspaceRecognition = async (withOcr: boolean) => {
    if (!pages.length) return setError('ابتدا فایل‌های موردنظر را اضافه کنید.');
    if (!recognitionSamples.length) return setError('ابتدا چند نمونه برچسب‌گذاری‌شده در آزمایشگاه تشخیص ذخیره کنید.');
    setBusy(true);
    setRecognitionProgress('مقایسه با الگوهای ذخیره‌شده…');
    setError('');
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    const previewDocuments = new Map<string, any>();
    let matched = 0;
    try {
      const nextPages: PageItem[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const pageItem = pages[index];
        let features = pageItem.features;
        if (withOcr && features.tokens.length < 4) {
          if (!worker) {
            setRecognitionProgress('راه‌اندازی OCR فارسی/انگلیسی…');
            worker = await createWorker('fas+eng');
          }
          const source = sourcePdfs.current.get(pageItem.documentId);
          if (source) {
            let preview = previewDocuments.get(pageItem.documentId);
            if (!preview) {
              const bytes = await source.save();
              preview = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
              previewDocuments.set(pageItem.documentId, preview);
            }
            setRecognitionProgress('خواندن متن اسکن صفحه ' + (index + 1) + ' از ' + pages.length + '…');
            const sourcePage = await preview.getPage(pageItem.pageIndex + 1);
            const unitViewport = sourcePage.getViewport({ scale: 1 });
            const scale = Math.min(2.4, 1800 / Math.max(unitViewport.width, unitViewport.height));
            const viewport = sourcePage.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('امکان آماده‌سازی اسکن برای OCR وجود ندارد.');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            await sourcePage.render({ canvasContext: context, viewport }).promise;
            const result = await worker.recognize(canvas);
            const ocrData = result.data as any;
            const words = (ocrData.words || []).map((word: any) => ({
              text: word.text,
              bbox: word.bbox,
              confidence: word.confidence,
            }));
            features = buildDocumentPageFeaturesFromText(ocrData.text || '', words, canvas.width, canvas.height);
            canvas.width = 1;
            canvas.height = 1;
          }
        }
        const match = recognizeDocumentPage(features, recognitionSamples);
        if (match && match.confidence >= 0.2) matched += 1;
        nextPages.push({
          ...pageItem,
          features,
          ...(match && match.confidence >= 0.2 ? { label: match.documentType } : {}),
        });
      }
      setPages(nextPages);
      setStatus(matched + ' صفحه با الگوهای ذخیره‌شده تطبیق داده شد؛ ' + (withOcr ? 'OCR برای صفحات تصویری هم اجرا شد.' : 'صفحات اسکن‌شده OCR نشدند.'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تشخیص اسناد ناموفق بود.');
    } finally {
      await worker?.terminate();
      await Promise.all([...previewDocuments.values()].map((preview) => preview.destroy().catch(() => undefined)));
      setBusy(false);
      setRecognitionProgress('');
    }
  };

  const deleteRecognitionSample = async (sample: RecognitionSample) => {
    if (!window.confirm('الگوی «' + sample.document_type + '» حذف شود؟ فایل اصلی نمونه در هیچ‌جا ذخیره نشده است.')) return;
    setRecognitionLoading(true);
    try {
      const { error: deleteError } = await (supabase as any).from('pdf_document_recognition_samples')
        .delete().eq('id', sample.id).eq('organization_id', organizationId);
      if (deleteError) throw deleteError;
      setRecognitionSamples((previous) => previous.filter((item) => item.id !== sample.id));
      setStatus('الگوی تشخیص حذف شد.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'حذف الگو ناموفق بود.');
    } finally {
      setRecognitionLoading(false);
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

        <nav className="sticky top-0 z-20 grid grid-cols-3 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-sm" aria-label="بخش‌های PDF Studio">
          <button type="button" onClick={() => setStudioTab('pages')} className={'min-h-10 rounded-xl px-2 text-xs font-bold ' + (studioTab === 'pages' ? 'bg-blue-600 text-white' : 'text-[var(--muted)]')}>صفحات ({pages.length})</button>
          <button type="button" onClick={() => setStudioTab('outputs')} className={'min-h-10 rounded-xl px-2 text-xs font-bold ' + (studioTab === 'outputs' ? 'bg-blue-600 text-white' : 'text-[var(--muted)]')}>خروجی و فشرده‌سازی</button>
          {['owner', 'admin', 'broker', 'accountant', 'warehouse'].includes(String(profile?.role || '')) && (
            <button type="button" onClick={() => setStudioTab('recognition')} className={'min-h-10 rounded-xl px-2 text-xs font-bold ' + (studioTab === 'recognition' ? 'bg-blue-600 text-white' : 'text-[var(--muted)]')}>آزمایشگاه تشخیص</button>
          )}
        </nav>

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
            <button type="button" onClick={removeSelected} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-500/30 px-3 text-xs text-red-400 disabled:opacity-40"><Minus size={15}/> حذف صفحات</button>
            <button type="button" onClick={rotateSelected} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><RotateCw size={15}/> چرخش ۹۰ درجه</button>
            <button type="button" onClick={selectAll} disabled={busy || !pages.length} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><Check size={14}/> انتخاب همه</button>
            <button type="button" onClick={clearSelection} disabled={busy || !selectedCount} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40"><X size={14}/> لغو انتخاب</button>
          </div>
        </section>

        {fileManagerOpen && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-black">انتخاب از پوشه‌های فایل‌منیجر</h2><p className="mt-1 text-xs text-[var(--muted)]">پوشه‌ها را باز کنید و از چند پوشه فایل انتخاب کنید؛ انتخاب‌ها هنگام جابه‌جایی بین پوشه‌ها حفظ می‌شوند.</p></div>
              <button type="button" onClick={() => setFileManagerOpen(false)} className="rounded-lg border border-[var(--border)] p-2" aria-label="بستن"><X size={16}/></button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setFileManagerCurrentFolderId(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold">ریشه فایل‌منیجر</button>
              {fileManagerFolderPath.map((folder) => (
                <button key={folder.id} type="button" onClick={() => setFileManagerCurrentFolderId(folder.id)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">{folder.display_name}</button>
              ))}
              {currentFileManagerFolder?.parent_id && (
                <button type="button" onClick={() => setFileManagerCurrentFolderId(currentFileManagerFolder.parent_id)} className="mr-auto rounded-lg border border-[var(--border)] px-3 py-2 text-xs">بازگشت به پوشه بالاتر</button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {visibleFileManagerFolders.map((folder) => {
                const count = fileManagerRows.filter((row) => row.folder_id === folder.id).length;
                const nested = fileManagerFolders.some((item) => item.parent_id === folder.id);
                return (
                  <button key={folder.id} type="button" onClick={() => setFileManagerCurrentFolderId(folder.id)} className="flex min-h-16 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-right">
                    <Folder size={20} className="shrink-0 text-blue-400"/>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">{folder.display_name}</span>
                      <span className="mt-1 block text-[10px] text-[var(--muted)]">{count} فایل {nested ? '· زیرپوشه دارد' : ''}</span>
                    </span>
                    <ChevronLeft size={15} className="shrink-0 text-[var(--muted)]"/>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input value={fileManagerSearch} onChange={(event) => setFileManagerSearch(event.target.value)} placeholder="جست‌وجوی اختیاری در فایل‌های این پوشه…" className="min-h-10 min-w-[12rem] flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={fileManagerSearchAll} onChange={(event) => setFileManagerSearchAll(event.target.checked)} className="h-4 w-4"/>
                جست‌وجو در همه پوشه‌ها
              </label>
            </div>
            {fileManagerLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]"><Loader2 className="animate-spin" size={17}/> در حال دریافت فایل‌ها…</div>
            ) : (
              <div className="mt-3 max-h-[38dvh] space-y-1 overflow-y-auto overscroll-contain">
                {visibleFileManagerRows.map((row) => (
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
                {!visibleFileManagerFolders.length && !visibleFileManagerRows.length && <p className="py-5 text-center text-xs text-[var(--muted)]">در این پوشه فایل یا زیرپوشه‌ای نیست.</p>}
                {fileManagerSearchAll && fileManagerSearch && visibleFileManagerRows.length > 0 && <p className="px-2 py-1 text-[10px] text-[var(--muted)]">نمایش نتیجه از پوشه‌های مختلف؛ پوشه مبدأ کنار هر فایل آمده است.</p>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <span className="text-xs text-[var(--muted)]">{selectedFileManagerIds.size} فایل از پوشه‌های مختلف انتخاب شده</span>
              <button type="button" onClick={() => void loadSelectedFromFileManager()} disabled={busy || fileManagerLoading || !selectedFileManagerIds.size} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">افزودن فایل‌های انتخاب‌شده</button>
            </div>
          </section>
        )}

        {(studioTab === 'pages' || studioTab === 'outputs') && (
        <section className="grid gap-4">
          {studioTab === 'pages' && <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
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
                      <input value={page.label} onChange={(event) => updatePage(page.id, { label: event.target.value })} aria-label="نام پیشنهادی صفحه" className="mt-2 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px]" placeholder="نام سند این صفحه"/>
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
          </div>}

          {studioTab === 'outputs' && (
            <>
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-black">ابزارهای اختیاری خروجی</h2>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">فقط ابزارهایی را که لازم داری فعال کن. هیچ عملیات خروجی بدون انتخاب تو اجرا نمی‌شود.</p>
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">{Object.values(outputTools).filter(Boolean).length} ابزار فعال</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    { key: 'merge', label: 'ادغام و استخراج', detail: 'ساخت یک PDF از صفحات' },
                    { key: 'split', label: 'تفکیک صفحات', detail: 'چند PDF مستقل' },
                    { key: 'compression', label: 'فشرده‌سازی', detail: 'کاهش حجم PDF' },
                    { key: 'stamp', label: 'مهر و امضا', detail: 'افزودن متن یا تصویر' },
                  ] as const).map((tool) => (
                    <label key={tool.key} className={'flex min-h-[74px] cursor-pointer items-start gap-2 rounded-xl border p-3 transition ' + (outputTools[tool.key] ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--border)] bg-[var(--surface-2)]')}>
                      <input
                        type="checkbox"
                        checked={outputTools[tool.key]}
                        onChange={(event) => setOutputTools((previous) => ({ ...previous, [tool.key]: event.target.checked }))}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold">{tool.label}</span>
                        <span className="mt-1 block text-[10px] text-[var(--muted)]">{tool.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              {readyOutputs.length > 0 && (
                <section className="rounded-2xl border border-blue-500/30 bg-[var(--surface)] p-3 md:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-black">فایل‌های آماده دانلود</h2>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">فایل‌ها خودکار باز یا دانلود نمی‌شوند. دانلود هر خروجی را جداگانه بزن؛ فایل‌های ورودی و تنظیمات باقی می‌مانند.</p>
                    </div>
                    <span className="text-xs font-bold text-blue-400">{readyOutputs.length} خروجی</span>
                  </div>
                  <div className="space-y-2">
                    {readyOutputs.map((output) => (
                      <div key={output.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] p-3">
                        <FileText size={18} className="shrink-0 text-blue-400"/>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold">{output.name}</div>
                          <div className="mt-1 text-[10px] leading-5 text-[var(--muted)]">{output.description} · {formatSize(output.size)}</div>
                          <div className="mt-1 text-[10px] text-[var(--muted)]">{output.downloadedAt ? 'دانلود قبلی ثبت شد؛ امکان دانلود دوباره وجود دارد.' : 'هنوز دانلود نشده است.'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadReadyOutput(output)}
                          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white"
                        >
                          <FileText size={14}/>{output.downloadedAt ? 'دانلود دوباره' : 'دانلود فایل'}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <aside className="grid gap-3 md:grid-cols-2">
                {outputTools.merge && (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <h3 className="mb-2 font-black">ادغام و استخراج صفحات</h3>
                    <p className="text-[11px] leading-5 text-[var(--muted)]">صفحات را با ترتیب فعلی به یک PDF تبدیل کن. برای استخراج فقط صفحات انتخاب‌شده، ابتدا آن‌ها را در تب صفحات انتخاب کن.</p>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <button type="button" onClick={() => void exportMerged(false)} disabled={busy || !pages.length} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-40">
                        <Files size={15}/> ادغام همه صفحات ({pages.length})
                      </button>
                      <button type="button" onClick={() => void exportMerged(true)} disabled={busy || !selectedCount} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs disabled:opacity-40">
                        <Scissors size={15}/> استخراج صفحات انتخابی ({selectedCount})
                      </button>
                    </div>
                  </section>
                )}

                {outputTools.split && (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <h3 className="mb-3 font-black">تفکیک صفحات به PDFهای جداگانه</h3>
                    <label className="block text-xs text-[var(--muted)]">قالب تفکیک</label>
                    <select value={outputPreset} onChange={(event) => applyOutputPreset(event.target.value as 'custom' | 'shipPass' | 'guarantee' | 'standard')} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
                      <option value="custom">تفکیک دلخواه</option>
                      <option value="shipPass">پاس کشتی</option>
                      <option value="guarantee">درخواست ضمانتنامه</option>
                      <option value="standard">مدارک استاندارد - حداکثر ۲ مگابایت</option>
                    </select>
                    <label className="mt-3 block text-xs text-[var(--muted)]">نام مجموعه خروجی</label>
                    <input value={packageName} onChange={(event) => setPackageName(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
                    {outputPreset === 'standard' ? (
                      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-5 text-[var(--muted)]">
                        همه صفحات در یک PDF استاندارد قرار می‌گیرند. سقف ۲ مگابایت است؛ فشرده‌سازی تصویری فقط در صورت نیاز اجرا می‌شود و ممکن است متن قابل جست‌وجو، فرم‌ها و لینک‌ها را حذف کند.
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 space-y-2">
                          {splitRows.map((row, index) => (
                            <div key={row.id} className="rounded-xl border border-[var(--border)] p-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[var(--muted)]">{index + 1}.</span>
                                <input value={row.name} onChange={(event) => setSplitRows((previous) => previous.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs" placeholder="نام فایل PDF"/>
                                <button type="button" onClick={() => setSplitRows((previous) => previous.filter((item) => item.id !== row.id))} disabled={splitRows.length <= 1} className="rounded-lg border border-red-500/30 p-2 text-red-400 disabled:opacity-30" aria-label="حذف خروجی"><Trash2 size={13}/></button>
                              </div>
                              <label className="mt-2 block text-[10px] text-[var(--muted)]">شماره صفحه‌ها؛ نمونه: 1-2 یا 1,5 یا 1-2,5</label>
                              <input value={row.pageExpression} onChange={(event) => setSplitRows((previous) => previous.map((item) => item.id === row.id ? { ...item, pageExpression: event.target.value } : item))} dir="ltr" placeholder="1-2,5" className="mt-1 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm"/>
                            </div>
                          ))}
                        </div>
                        <button type="button" onClick={() => setSplitRows((previous) => [...previous, { id: crypto.randomUUID(), name: 'سند جدید', pageExpression: '' }])} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-xs">افزودن بخش تفکیک</button>
                      </>
                    )}
                    <button type="button" onClick={() => void splitPdf()} disabled={busy || !pages.length || !packageName.trim()} className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                      <Scissors className="ml-1 inline" size={15}/>{outputPreset === 'standard' ? 'ساخت PDF استاندارد' : 'ساخت PDFهای جداگانه'}
                    </button>
                    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">هر ردیف یک PDF مستقل خواهد بود و دکمه دانلود جداگانه می‌گیرد؛ فایل ZIP ساخته نمی‌شود.</p>
                  </section>
                )}

                {outputTools.stamp && (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <h3 className="mb-3 font-black">مهر، امضا و متن</h3>
                    <label className="block text-xs text-[var(--muted)]">متن فارسی یا انگلیسی</label>
                    <input value={selectedText} onChange={(event) => setSelectedText(event.target.value)} placeholder="مثلاً رونوشت برابر اصل است" className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
                    <button type="button" onClick={() => void addTextStamp()} disabled={busy || !pages.length} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-bold disabled:opacity-40"><Stamp className="ml-1 inline" size={15}/> درج متن روی صفحه</button>
                    <input ref={imageRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => void addImageStamp(event.currentTarget.files?.[0])}/>
                    <button type="button" onClick={() => imageRef.current?.click()} disabled={busy || !pages.length} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs disabled:opacity-40"><FileImage className="ml-1 inline" size={15}/> افزودن تصویر مهر یا امضا</button>
                    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">متن فارسی در این ابزار به‌شکل تصویر روی PDF قرار می‌گیرد؛ قابل جست‌وجو و ویرایش متنی نیست.</p>
                  </section>
                )}

                {outputTools.compression && (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-black">فشرده‌سازی هوشمند پیشرفته</h3>
                      <span className="text-[10px] text-emerald-500">پیش‌فرض: حفظ خوانایی اعداد</span>
                    </div>
                    <label className="mt-3 block text-xs text-[var(--muted)]">روش فشرده‌سازی</label>
                    <select value={compressionSettings.mode} onChange={(event) => { setCompressionSettings((old) => ({ ...old, mode: event.target.value as CompressionSettings['mode'] })); setCompressionEstimate(null); }} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
                      <option value="smart">هوشمند ترکیبی؛ متن حفظ شود، اسکن‌ها فشرده شوند</option>
                      <option value="preserve">ساختاری؛ حفظ کامل متن و صفحات</option>
                      <option value="raster">فشرده‌سازی تصویری کامل همه صفحات</option>
                    </select>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-[var(--muted)]">کیفیت تصویر: {Math.round(compressionSettings.quality * 100)}٪</label>
                        <input type="range" min="0.65" max="0.98" step="0.01" value={compressionSettings.quality} onChange={(event) => { setCompressionSettings((old) => ({ ...old, quality: Number(event.target.value) })); setCompressionEstimate(null); }} className="mt-2 w-full"/>
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--muted)]">وضوح: {compressionSettings.dpi} DPI</label>
                        <input type="range" min="120" max="300" step="15" value={compressionSettings.dpi} onChange={(event) => { setCompressionSettings((old) => ({ ...old, dpi: Number(event.target.value) })); setCompressionEstimate(null); }} className="mt-2 w-full"/>
                      </div>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
                      <input type="checkbox" checked={compressionSettings.grayscale} onChange={(event) => { setCompressionSettings((old) => ({ ...old, grayscale: event.target.checked })); setCompressionEstimate(null); }} className="h-4 w-4"/>
                      تبدیل صفحات تصویری به سیاه‌وسفید (برای متن؛ عکس و لیبل رنگی را خاموش بگذارید)
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input value={compressionProfileName} onChange={(event) => setCompressionProfileName(event.target.value)} placeholder="نام تنظیمات؛ مثلا اسکن خوانا" className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs"/>
                      <button type="button" onClick={saveCompressionProfile} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold">ذخیره تنظیمات</button>
                    </div>
                    <select defaultValue="" onChange={(event) => applyCompressionProfile(event.target.value)} className="mt-2 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs">
                      <option value="">بازیابی تنظیمات ذخیره‌شده…</option>
                      {compressionProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => void estimateCompression()} disabled={busy || compressionEstimating || !compressionItems.length} className="min-h-10 rounded-xl border border-[var(--border)] px-2 py-2 text-xs font-bold disabled:opacity-40">
                        {compressionEstimating ? 'در حال برآورد…' : 'برآورد حجم قبل از پردازش'}
                      </button>
                      <button type="button" onClick={() => void compressActivePdf()} disabled={busy || !compressionItems.length} className="min-h-10 rounded-xl bg-blue-600 px-2 py-2 text-xs font-bold text-white disabled:opacity-40">
                        {busy ? 'در حال فشرده‌سازی…' : 'ساخت PDF فشرده'}
                      </button>
                    </div>
                    {compressionEstimate && (
                      <div className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                        <div className="text-xs font-bold">حجم تخمینی فایل PDF</div>
                        <div className="mt-1 text-lg font-black tabular-nums">{formatSize(compressionEstimate.expected)}</div>
                        <div className="mt-1 text-[11px] text-[var(--muted)]">بازه احتمالی: {formatSize(compressionEstimate.low)} تا {formatSize(compressionEstimate.high)}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--muted)]">
                          <span>{compressionEstimate.preservedPages} صفحه متن‌محور حفظ‌شونده</span>
                          <span>{compressionEstimate.rasterizedPages} صفحه تصویری</span>
                          <span>نمونه‌گیری از {compressionEstimate.sampledPages} صفحه</span>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">این برآورد تقریبی است؛ پس از ساخت PDF، حجم واقعی در فایل‌های آماده دانلود نشان داده می‌شود.</p>
                      </div>
                    )}
                    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">خروجی فشرده یک PDF مستقل است. فایل ورودی، ترتیب صفحات، انتخاب‌ها و پروفایل‌های ذخیره‌شده پس از آماده‌سازی و دانلود پاک نمی‌شوند.</p>
                  </section>
                )}

                {!Object.values(outputTools).some(Boolean) && (
                  <section className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center md:col-span-2">
                    <div>
                      <div className="font-bold">هنوز ابزاری فعال نیست</div>
                      <p className="mt-1 text-xs leading-6 text-[var(--muted)]">از گزینه‌های بالا فقط عملیات موردنیازت را فعال کن. فایل‌های ورودی و صفحات تا وقتی خودت پاک‌سازی نکنی در محیط باقی می‌مانند.</p>
                    </div>
                  </section>
                )}
              </aside>
            </>
          )}
        </section>
        )}

        {studioTab === 'recognition' && (
          <section className="space-y-3">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-black">آزمایشگاه تشخیص اسناد</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">یک نمونه واقعی از نوع سند بده، نوع آن را مشخص کن و تحلیل را اجرا کن. سیستم متن، واژه‌های شاخص، الگوی اعداد و محل قرارگیری عبارت‌ها را یاد می‌گیرد تا نمونه‌های بعدی را بهتر بشناسد.</p>
                </div>
                <span className="rounded-lg border border-emerald-500/30 px-2 py-1 text-[10px] text-emerald-500">ویژه الگوهای سازمان</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-xs font-bold">فایل نمونه PDF یا تصویر</label>
                  <input ref={sampleInputRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => setSampleFile(event.currentTarget.files?.[0] || null)} className="block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-xs file:ml-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"/>
                  <div className="text-[11px] text-[var(--muted)]">{sampleFile ? sampleFile.name + ' · ' + formatSize(sampleFile.size) : 'نمونه را فقط برای تحلیل انتخاب کن؛ فایل اصلی به سرور ارسال نمی‌شود.'}</div>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-bold">نوع سندی که این نمونه نشان می‌دهد</label>
                  <input value={sampleDocumentType} onChange={(event) => setSampleDocumentType(event.target.value)} placeholder="مثلاً قبض انبار پشت" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
                  <label className="block text-xs font-bold">نام قابل نمایش نمونه (اختیاری)</label>
                  <input value={sampleDisplayName} onChange={(event) => setSampleDisplayName(event.target.value)} placeholder="مثلاً قبض انبار شرکت الف" className="min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"/>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void analyzeAndSaveSample()} disabled={!sampleFile || trainingBusy || busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-40">
                  {trainingBusy ? <Loader2 className="animate-spin" size={15}/> : <Sparkles size={15}/>}
                  تحلیل و ذخیره الگوی تشخیص
                </button>
                {trainingProgress && <span className="text-xs text-[var(--muted)]">{trainingProgress}</span>}
              </div>
              <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] leading-5 text-[var(--muted)]">
                فایل نمونه روی دستگاه پردازش می‌شود. اگر PDF اسکن‌شده باشد، OCR فارسی و انگلیسی در مرورگر اجرا می‌شود؛ فقط ویژگی‌های استخراج‌شده و مختصات نسبی کلمات در فضای خصوصی سازمان ذخیره می‌شوند، نه خود PDF و نه تصویر صفحات.
              </p>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-black">الگوهای ثبت‌شده</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">{recognitionSamples.length} نمونه در کتابخانه تشخیص این سازمان</p>
                </div>
                <button type="button" onClick={() => void loadRecognitionSamples()} disabled={recognitionLoading} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">به‌روزرسانی</button>
              </div>
              {recognitionLoading ? (
                <div className="py-5 text-center text-xs text-[var(--muted)]"><Loader2 className="ml-2 inline animate-spin" size={15}/> در حال دریافت الگوها…</div>
              ) : recognitionSamples.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {recognitionSamples.map((sample) => (
                    <div key={sample.id} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3">
                      <FileText size={18} className="shrink-0 text-blue-400"/>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold">{sample.document_type}</div>
                        <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{sample.sample_name} · {sample.page_count} صفحه · {sample.source_filename}</div>
                      </div>
                      <button type="button" onClick={() => void deleteRecognitionSample(sample)} disabled={recognitionLoading || trainingBusy} className="rounded-lg border border-red-500/30 px-2 py-2 text-[10px] text-red-400">حذف</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-[var(--muted)]">هنوز نمونه‌ای ذخیره نشده است. با یک نمونه از قبض انبار، اظهارنامه یا مانیفست شروع کن.</p>
              )}
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-black">تشخیص فایل‌های فعلی</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">برچسب‌های صفحات فعلی را با نمونه‌های ذخیره‌شده تطبیق بده.</p>
                </div>
                <span className="text-xs text-[var(--muted)]">{pages.length} صفحه در محیط کار</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => void runWorkspaceRecognition(false)} disabled={busy || !pages.length || !recognitionSamples.length} className="min-h-11 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-40">تشخیص بر اساس متن PDF</button>
                <button type="button" onClick={() => void runWorkspaceRecognition(true)} disabled={busy || !pages.length || !recognitionSamples.length} className="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">تشخیص اسکن‌ها با OCR</button>
              </div>
              {recognitionProgress && <p className="mt-2 text-xs text-[var(--muted)]">{recognitionProgress}</p>}
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">تشخیص متن PDF سریع‌تر است. OCR برای صفحات اسکن‌شده زمان بیشتری می‌گیرد و فقط با زدن دکمه جداگانه اجرا می‌شود تا روی سرعت کار روزمره اثر نگذارد.</p>
            </section>
          </section>
        )}

        {(status || error) && <div className={'rounded-xl border p-3 text-sm ' + (error ? 'border-red-500/30 bg-red-500/5 text-red-400' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-500')}>
          {error || status}
          {error && <button type="button" onClick={() => setError('')} className="mr-2 align-middle"><X size={15}/></button>}
        </div>}
      </div>
    </main>
  );
};
