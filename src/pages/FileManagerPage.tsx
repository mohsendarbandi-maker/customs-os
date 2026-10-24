import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CheckCircle2, ChevronLeft, Download, FileText, Folder,
  FolderOpen, Loader2, RefreshCw, Search, Upload, UploadCloud, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  downloadTelegramArchivedFile,
  FILE_ARCHIVE_MAX_BYTES,
  getFileArchiveDestination,
  uploadTelegramArchivedFile,
} from '../lib/fileManager';

type FolderRow = {
  id: string;
  parent_id: string | null;
  folder_key: string;
  folder_type: string;
  display_name: string;
  client_id: string | null;
  shipment_id: string | null;
  customs_office_id: string | null;
  is_system: boolean;
  created_at: string;
};
type FileRow = {
  id: string;
  folder_id: string;
  shipment_id: string | null;
  client_id: string | null;
  file_asset_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  external_message_id: string | null;
  document_type: string;
  tags: string[];
  metadata: Record<string, unknown>;
  shipment_document_id: string | null;
  customs_document_id: string | null;
  storage_path: string | null;
  is_archived: boolean;
  created_at: string;
};
type SearchHit = {
  entity_type: string;
  entity_id: string;
  title: string;
  details: string | null;
  folder_id: string | null;
  shipment_id: string | null;
  client_id: string | null;
};

const byteLabel = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'اندازه نامشخص';
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
};
// Windows disallows control characters in file and directory names.
const windowsName = (value: string) =>
  // eslint-disable-next-line no-control-regex -- Windows paths must exclude NUL and C0 control characters.
  value.normalize('NFKC').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || 'بدون نام';
const folderSlug = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 72) || crypto.randomUUID();

const roleCanModifyStructure = (role?: string | null) =>
  ['owner', 'admin', 'broker', 'accountant', 'warehouse'].includes(String(role || ''));

export const FileManagerPage: React.FC = () => {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const initialRoute = useRef({ folderId: params.get('folderId'), shipmentId: params.get('shipmentId') });
  const organizationId = profile?.organization_id || '';
  const role = profile?.role || '';
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(params.get('folderId') || '');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const uploadKeys = useRef(new Map<string, string>());
  const directoryInput = useRef<HTMLInputElement | null>(null);

  const currentFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) || null,
    [folders, selectedFolderId],
  );
  const childFolders = useMemo(
    () => folders.filter((folder) => folder.parent_id === selectedFolderId).sort((a, b) =>
      a.display_name.localeCompare(b.display_name, 'fa')),
    [folders, selectedFolderId],
  );
  const breadcrumbs = useMemo(() => {
    const result: FolderRow[] = [];
    let cursor = currentFolder;
    let hops = 0;
    while (cursor && hops < 30) {
      result.unshift(cursor);
      cursor = cursor.parent_id ? folders.find((folder) => folder.id === cursor!.parent_id) || null : null;
      hops += 1;
    }
    return result;
  }, [currentFolder, folders]);

  const loadFolders = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: folderError } = await supabase
        .from('file_manager_folders')
        .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
        .eq('organization_id', organizationId)
        .order('display_name', { ascending: true });
      if (folderError) throw folderError;
      const rows = (data || []) as FolderRow[];
      setFolders(rows);
      const requestedFolder = initialRoute.current.folderId;
      const requestedShipment = initialRoute.current.shipmentId;
      const requested =
        rows.find((folder) => folder.id === requestedFolder) ||
        rows.find((folder) => folder.shipment_id === requestedShipment && folder.folder_type === 'shipment') ||
        rows.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root') ||
        rows[0] || null;
      setSelectedFolderId((previous) => rows.some((folder) => folder.id === previous) ? previous : requested?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت ساختار پوشه‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]); // Route parameters are used only to choose the initial folder.

  const loadFiles = useCallback(async (folderId: string) => {
    if (!organizationId || !folderId) {
      setFiles([]);
      return;
    }
    const { data, error: filesError } = await supabase
      .from('file_manager_files')
      .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
      .eq('organization_id', organizationId)
      .eq('folder_id', folderId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });
    if (filesError) throw filesError;
    setFiles((data || []) as FileRow[]);
  }, [organizationId]);

  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => { if (selectedFolderId) setParams((previous) => { const next = new URLSearchParams(previous); next.set('folderId', selectedFolderId); return next; }, { replace: true }); }, [selectedFolderId, setParams]);
  useEffect(() => {
    if (!selectedFolderId) return;
    let cancelled = false;
    setLoading(true);
    void loadFiles(selectedFolderId).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'دریافت فایل‌ها ناموفق بود.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedFolderId, loadFiles]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: searchError } = await supabase.rpc('search_file_manager', {
          p_query: term,
          p_limit: 50,
        });
        if (searchError) throw searchError;
        if (!cancelled) setHits((data || []) as SearchHit[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'جست‌وجو ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const chooseFolder = (folder: FolderRow) => {
    setSelectedFolderId(folder.id);
    setQuery('');
    setHits([]);
    setError('');
    setMessage('');
    const next = new URLSearchParams(params);
    next.set('folderId', folder.id);
    if (folder.shipment_id) next.set('shipmentId', folder.shipment_id);
    setParams(next, { replace: true });
  };

  const getUploadTarget = async () => {
    if (!currentFolder) throw new Error('ابتدا یک پوشه را انتخاب کنید.');
    if (!currentFolder.shipment_id) {
      if (currentFolder.client_id && ['client', 'custom'].includes(currentFolder.folder_type)) return currentFolder;
      throw new Error('برای آپلود، پوشه صاحب کالا یا محموله را انتخاب کنید.');
    }
    if (currentFolder.folder_type !== 'shipment') return currentFolder;
    const preferred = folders.find((folder) =>
      folder.parent_id === currentFolder.id && folder.folder_type === 'other');
    if (!preferred) throw new Error('زیرپوشه «سایر اسناد» محموله پیدا نشد؛ ساختار پوشه‌ها را تازه‌سازی کنید.');
    return preferred;
  };

  const getOrCreateSubfolder = async (parent: FolderRow, name: string): Promise<FolderRow> => {
    const clean = windowsName(name);
    const key = `custom:${folderSlug(clean)}`;
    const existing = folders.find((folder) => folder.parent_id === parent.id && folder.folder_key === key);
    if (existing) return existing;
    const { data, error: insertError } = await supabase
      .from('file_manager_folders')
      .insert({
        organization_id: organizationId,
        parent_id: parent.id,
        folder_key: key,
        folder_type: 'custom',
        display_name: clean,
        client_id: parent.client_id,
        shipment_id: parent.shipment_id,
        customs_office_id: parent.customs_office_id,
        is_system: false,
      })
      .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
      .single();
    if (insertError) {
      // A concurrent creation can win the unique index; reuse that folder.
      const { data: raced } = await supabase
        .from('file_manager_folders')
        .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
        .eq('organization_id', organizationId).eq('parent_id', parent.id).eq('folder_key', key).maybeSingle();
      if (raced) return raced as FolderRow;
      throw insertError;
    }
    const folder = data as FolderRow;
    setFolders((previous) => previous.some((item) => item.id === folder.id) ? previous : [...previous, folder]);
    return folder;
  };

  const archiveFiles = async () => {
    if (!pendingFiles.length) return;
    setUploading(true);
    setError('');
    setMessage('');
    let completed = 0;
    try {
      const target = await getUploadTarget();
      const destination = await getFileArchiveDestination();
      for (const file of pendingFiles) {
        if (file.size > FILE_ARCHIVE_MAX_BYTES) {
          throw new Error(`فایل «${file.name}» بیشتر از ۲۰ مگابایت است؛ برای قابلیت بازیابی Bot API معمولی تلگرام، فعلاً فایل‌های بزرگ‌تر پذیرفته نمی‌شوند.`);
        }
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const segments = relativePath.split('/').filter(Boolean).slice(0, -1);
        let parent = target;
        for (const segment of segments) parent = await getOrCreateSubfolder(parent, segment);
        const keySource = `${parent.id}:${file.name}:${file.size}:${file.lastModified}`;
        let idempotencyKey = uploadKeys.current.get(keySource);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          uploadKeys.current.set(keySource, idempotencyKey);
        }
        await uploadTelegramArchivedFile(file, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
          destination,
          idempotencyKey,
        });
        uploadKeys.current.delete(keySource);
        completed += 1;
        setPendingFiles((previous) => previous.filter((candidate) => candidate !== file));
        setProgress(`ذخیره در تلگرام: ${completed} از ${pendingFiles.length}`);
        if (relativePath) {
          // Folder rows are created on demand; refresh once after the batch.
          void relativePath;
        }
      }
      await loadFolders();
      if (currentFolder?.folder_type === 'shipment') setSelectedFolderId(target.id);
      await loadFiles(currentFolder?.folder_type === 'shipment' ? target.id : selectedFolderId);
      setMessage(`${completed} فایل در تلگرام ذخیره و در پوشه انتخاب‌شده ثبت شد.`);
      setPendingFiles([]);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'آپلود ناموفق بود.');
      if (completed > 0) setMessage(`${completed} فایل ذخیره شد. فایل‌های باقی‌مانده در صف انتخاب‌شده باقی مانده‌اند.`);
    } finally {
      setUploading(false);
      setProgress('');
    }
  };

  const createFolder = async () => {
    if (!currentFolder || !(currentFolder.shipment_id || (currentFolder.client_id && ['client', 'custom'].includes(currentFolder.folder_type))) || !roleCanModifyStructure(role)) {
      setError('ساخت زیرپوشه برای این کاربر مجاز نیست یا پوشه محموله انتخاب نشده است.');
      return;
    }
    if (!folderName.trim()) return;
    setCreatingFolder(true);
    setError('');
    try {
      const folder = await getOrCreateSubfolder(currentFolder, folderName.trim());
      setFolderName('');
      await loadFolders();
      setSelectedFolderId(folder.id);
      setMessage('زیرپوشه ایجاد شد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ساخت پوشه ناموفق بود.');
    } finally {
      setCreatingFolder(false);
    }
  };

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = windowsName(name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const getFileBlob = async (file: FileRow): Promise<Blob> => {
    if (file.file_asset_id) return downloadTelegramArchivedFile(file.file_asset_id);
    if (file.storage_path) {
      const { data, error: storageError } = await supabase.storage.from('customs_documents').download(file.storage_path);
      if (storageError) throw storageError;
      return data;
    }
    throw new Error('مسیر بازیابی فایل ثبت نشده است.');
  };

  const downloadFile = async (file: FileRow) => {
    setError('');
    try {
      const blob = await getFileBlob(file);
      saveBlob(blob, file.original_name || 'document.bin');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت فایل ناموفق بود.');
    }
  };

  const exportFolderToWindows = async () => {
    if (!currentFolder) return;
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setError('مرورگر فعلی انتخاب پوشه ویندوز را پشتیبانی نمی‌کند؛ از Microsoft Edge یا Google Chrome روی ویندوز استفاده کنید.');
      return;
    }
    setExporting(true);
    setError('');
    setMessage('');
    let saved = 0;
    try {
      const destination = await picker({ mode: 'readwrite' });
      const base = await destination.getDirectoryHandle(windowsName(currentFolder.display_name), { create: true });
      const writeFolder = async (folder: FolderRow, handle: any): Promise<void> => {
        const { data: folderFiles, error: folderFilesError } = await supabase
          .from('file_manager_files')
          .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
          .eq('organization_id', organizationId).eq('folder_id', folder.id).eq('is_archived', false)
          .order('created_at', { ascending: true });
        if (folderFilesError) throw folderFilesError;
        for (const row of (folderFiles || []) as FileRow[]) {
          setProgress(`دریافت ${row.original_name}`);
          const blob = await getFileBlob(row);
          const fileHandle = await handle.getFileHandle(windowsName(row.original_name), { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          saved += 1;
        }
        const children = folders.filter((child) => child.parent_id === folder.id);
        for (const child of children) {
          const childHandle = await handle.getDirectoryHandle(windowsName(child.display_name), { create: true });
          await writeFolder(child, childHandle);
        }
      };
      await writeFolder(currentFolder, base);
      setMessage(`خروجی پوشه روی ویندوز آماده شد؛ ${saved} فایل نوشته شد. این عملیات انتقال دستی است و همگام‌سازی دائمی در پس‌زمینه نیست.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'انتقال پوشه به ویندوز کامل نشد.');
      if (saved) setMessage(`تا پیش از خطا، ${saved} فایل روی ویندوز ذخیره شد.`);
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  const openHit = (hit: SearchHit) => {
    const folder = hit.folder_id ? folders.find((item) => item.id === hit.folder_id) : null;
    const fallback = hit.shipment_id
      ? folders.find((item) => item.shipment_id === hit.shipment_id && item.folder_type === 'shipment')
      : hit.client_id ? folders.find((item) => item.client_id === hit.client_id && item.folder_type === 'client') : null;
    if (folder || fallback) chooseFolder((folder || fallback)!);
    else setError('برای این نتیجه هنوز پوشه مرتبط ثبت نشده است.');
  };

  const uploadEnabled = Boolean(currentFolder && (currentFolder.shipment_id || (currentFolder.client_id && ['client', 'custom'].includes(currentFolder.folder_type))));
  const directoryProps = { webkitdirectory: '', directory: '' } as any;

  return <main dir="rtl" className="min-h-screen p-4 md:p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--primary)]/10 p-3 text-[var(--primary)]"><FolderOpen size={24} /></div>
          <div>
            <div className="text-xs app-muted">CUSTOMS OS · DOCUMENTS</div>
            <h1 className="text-2xl font-black">فایل‌منیجر اسناد و مدارک</h1>
            <p className="mt-1 text-xs app-muted">پوشه‌بندی خودکار بر اساس صاحب کالا، محموله و گمرک؛ آرشیو فایل اصلی در تلگرام.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/operations" className="rounded-xl border app-border px-3 py-2 text-sm"><ArrowRight size={15} className="ml-1 inline" />عملیات</Link>
          <Link to="/settings/messengers" className="rounded-xl border app-border px-3 py-2 text-sm">تنظیم آرشیو تلگرام</Link>
          <button type="button" onClick={() => { void loadFolders(); if (selectedFolderId) void loadFiles(selectedFolderId); }} disabled={loading} className="rounded-xl border app-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className="ml-1 inline" />تازه‌سازی</button>
        </div>
      </header>

      <section className="rounded-2xl border app-border bg-[var(--surface)] p-3">
        <label className="relative block">
          <Search size={18} className="absolute right-3 top-3.5 app-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو در صاحب کالا، محموله، کشتی، گمرک، اظهارنامه، کوتاژ، تگ و نام فایل…" className="w-full rounded-xl border app-border bg-[var(--surface-2)] py-3 pr-10 pl-3 outline-none focus:border-[var(--primary)]" />
        </label>
        {query.trim().length >= 2 && <div className="mt-3 space-y-1">
          <div className="px-1 text-xs app-muted">{loading ? 'در حال جست‌وجو…' : `${hits.length} نتیجه`}</div>
          {hits.map((hit) => <button type="button" key={hit.entity_type + hit.entity_id} onClick={() => openHit(hit)} className="flex w-full items-start justify-between gap-3 rounded-xl border app-border p-3 text-right hover:bg-[var(--surface-2)]">
            <span className="min-w-0"><span className="block truncate font-bold">{hit.title}</span><span className="mt-1 block text-xs app-muted">{hit.details || hit.entity_type}</span></span>
            <span className="shrink-0 rounded-lg bg-[var(--surface-2)] px-2 py-1 text-[10px]">{({ client: 'صاحب کالا', shipment: 'محموله', vessel: 'کشتی', declaration: 'اظهارنامه', folder: 'پوشه', file: 'سند', document: 'سند', customs_document: 'سند گمرکی' } as Record<string, string>)[hit.entity_type] || hit.entity_type}</span>
          </button>)}
          {!loading && hits.length === 0 && <div className="p-4 text-center text-sm app-muted">نتیجه‌ای برای این عبارت پیدا نشد.</div>}
        </div>}
      </section>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm"><X size={17} className="mt-0.5 shrink-0 text-red-500" /><span>{error}</span></div>}
      {message && <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" /><span>{message}</span></div>}
      {progress && <div className="flex items-center gap-2 rounded-xl border app-border p-3 text-sm app-muted"><Loader2 size={16} className="animate-spin" />{progress}</div>}

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border app-border bg-[var(--surface)] p-3">
          <div className="flex items-center justify-between px-2 pb-2"><h2 className="font-black">ساختار پوشه‌ها</h2><span className="text-xs app-muted">{folders.length}</span></div>
          {folders.filter((folder) => folder.folder_type === 'root').map((root) => <div key={root.id} className="mb-1">
            <button type="button" onClick={() => chooseFolder(root)} className={`flex w-full items-center gap-2 rounded-xl p-3 text-right font-bold ${selectedFolderId === root.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--surface-2)]'}`}><FolderOpen size={17} />{root.display_name}</button>
            {folders.filter((child) => child.parent_id === root.id).map((client) => <div key={client.id} className="mr-3">
              <button type="button" onClick={() => chooseFolder(client)} className={`flex w-full items-center gap-2 rounded-xl p-2.5 text-right text-sm ${selectedFolderId === client.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--surface-2)]'}`}><Folder size={15} /> <span className="truncate">{client.display_name}</span></button>
              {folders.filter((child) => child.parent_id === client.id).map((shipment) => <button key={shipment.id} type="button" onClick={() => chooseFolder(shipment)} className={`mr-3 flex w-[calc(100%-0.75rem)] items-start gap-2 rounded-xl p-2.5 text-right text-xs ${selectedFolderId === shipment.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--surface-2)]'}`}><FolderOpen size={14} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{shipment.display_name}</span></button>)}
            </div>)}
          </div>)}
          {!folders.length && <div className="p-6 text-center text-sm app-muted">ساختار پوشه هنوز بارگذاری نشده است.</div>}
        </aside>

        <section className="min-w-0 rounded-2xl border app-border bg-[var(--surface)]">
          <div className="border-b app-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1 text-xs app-muted">
                  {breadcrumbs.map((crumb, index) => <React.Fragment key={crumb.id}>
                    {index > 0 && <ChevronLeft size={13} />}
                    <button type="button" onClick={() => chooseFolder(crumb)} className={index === breadcrumbs.length - 1 ? 'font-bold text-[var(--text)]' : 'hover:text-[var(--primary)]'}>{crumb.display_name}</button>
                  </React.Fragment>)}
                </div>
                <h2 className="mt-2 truncate text-lg font-black">{currentFolder?.display_name || 'فایل‌منیجر'}</h2>
                <p className="mt-1 text-xs app-muted">{currentFolder?.folder_type === 'shipment' ? 'محموله · برای دسته‌بندی دقیق، وارد یکی از زیرپوشه‌ها شوید.' : currentFolder?.shipment_id ? 'پوشه اسناد محموله' : currentFolder?.client_id ? 'اسناد ثابت صاحب کالا و شرکت' : 'پوشه سازمانی'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void exportFolderToWindows()} disabled={!currentFolder || exporting || loading} className="rounded-xl border app-border px-3 py-2 text-sm disabled:opacity-50"><Download size={15} className="ml-1 inline" />انتقال پوشه به ویندوز</button>
                {uploadEnabled && roleCanModifyStructure(role) && <form onSubmit={(e) => { e.preventDefault(); void createFolder(); }} className="flex gap-1">
                  <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="نام زیرپوشه" className="w-32 rounded-xl border app-border bg-[var(--surface-2)] px-2 py-2 text-sm" />
                  <button type="submit" disabled={creatingFolder || !folderName.trim()} className="rounded-xl border app-border px-3 py-2 text-sm disabled:opacity-50">{creatingFolder ? <Loader2 size={15} className="animate-spin" /> : 'ساخت پوشه'}</button>
                </form>}
              </div>
            </div>
          </div>

          {currentFolder && <div className="border-b app-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white">
                <UploadCloud size={16} /> انتخاب فایل
                <input type="file" multiple className="hidden" disabled={!uploadEnabled || uploading} onChange={(e) => { setPendingFiles((old) => [...old, ...Array.from(e.target.files || [])]); e.currentTarget.value = ''; }} />
              </label>
              <button type="button" onClick={() => directoryInput.current?.click()} disabled={!uploadEnabled || uploading} className="flex items-center gap-2 rounded-xl border app-border px-4 py-2.5 text-sm disabled:opacity-40"><FolderOpen size={16} />انتخاب پوشه ویندوز</button>
              <input ref={directoryInput} {...directoryProps} type="file" multiple className="hidden" disabled={!uploadEnabled || uploading} onChange={(e) => { setPendingFiles((old) => [...old, ...Array.from(e.target.files || [])]); e.currentTarget.value = ''; }} />
              <span className="text-xs app-muted">هر فایل حداکثر ۲۰ مگابایت؛ فایل اصلی مستقیماً به آرشیو تلگرام می‌رود.</span>
            </div>
            {pendingFiles.length > 0 && <div className="mt-3 rounded-xl border app-border bg-[var(--surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{pendingFiles.length} فایل در صف</b><button type="button" onClick={() => setPendingFiles([])} disabled={uploading} className="text-xs app-muted underline">پاک‌کردن صف</button></div>
              <div className="mt-2 max-h-36 space-y-1 overflow-auto">{pendingFiles.slice(0, 40).map((file, index) => <div key={file.name + file.size + file.lastModified + index} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}</span><span className="shrink-0 app-muted">{byteLabel(file.size)}</span></div>)}{pendingFiles.length > 40 && <div className="text-xs app-muted">و {pendingFiles.length - 40} فایل دیگر…</div>}</div>
              <button type="button" onClick={() => void archiveFiles()} disabled={uploading} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}آپلود در تلگرام و ثبت فراداده</button>
            </div>}
            {!uploadEnabled && <p className="mt-2 text-xs app-muted">برای آپلود، پوشه صاحب کالا یا محموله را انتخاب کنید.</p>}
          </div>}

          <div className="p-4">
            {childFolders.length > 0 && <div className="mb-5">
              <h3 className="mb-2 text-xs font-bold app-muted">پوشه‌ها ({childFolders.length})</h3>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{childFolders.map((folder) => <button type="button" key={folder.id} onClick={() => chooseFolder(folder)} className="flex min-w-0 items-center gap-3 rounded-xl border app-border p-3 text-right hover:bg-[var(--surface-2)]">
                <FolderOpen size={22} className="shrink-0 text-[var(--primary)]" />
                <span className="min-w-0"><span className="block truncate text-sm font-bold">{folder.display_name}</span><span className="mt-1 block text-[10px] app-muted">{folder.folder_type === 'accounting_finance' ? 'پوشه حسابداری مالی' : folder.is_system ? 'پوشه پیش‌فرض' : 'پوشه سفارشی'}</span></span>
              </button>)}</div>
            </div>}
            <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold app-muted">اسناد این پوشه ({files.length})</h3>{loading && <Loader2 size={15} className="animate-spin app-muted" />}</div>
            {files.length === 0 ? <div className="rounded-xl border border-dashed app-border p-8 text-center text-sm app-muted">در این پوشه سندی وجود ندارد.</div> : <div className="space-y-2">{files.map((file) => {
              const isTelegram = Boolean(file.file_asset_id);
              return <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border app-border p-3">
                <div className="flex min-w-0 items-center gap-3"><FileText size={20} className="shrink-0 text-[var(--primary)]" /><div className="min-w-0"><div className="truncate text-sm font-bold">{file.original_name}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] app-muted"><span>{byteLabel(file.size_bytes)}</span><span>·</span><span>{new Date(file.created_at).toLocaleDateString('fa-IR')}</span><span>·</span><span className={isTelegram ? 'text-emerald-600' : 'text-amber-600'}>{isTelegram ? 'آرشیو تلگرام' : 'بایگانی قبلی وب‌سایت'}</span></div></div></div>
                <button type="button" onClick={() => void downloadFile(file)} className="rounded-lg border app-border px-3 py-2 text-xs"><Download size={14} className="ml-1 inline" />دانلود</button>
              </div>;
            })}</div>}
          </div>
        </section>
      </section>
      <p className="text-xs app-muted">فایل‌های جدید بدون OCR، استخراج محتوا یا اسکن امنیتی محتوا ذخیره می‌شوند؛ کنترل دسترسی و جداسازی سازمانی حفظ می‌شود. «انتقال پوشه به ویندوز» و آپلود پوشه، انتقال دستی هستند و در این نسخه، همگام‌سازی دائمی پس‌زمینه نیستند.</p>
    </div>
  </main>;
};

export default FileManagerPage;
