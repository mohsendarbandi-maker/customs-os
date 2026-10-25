import React, { useEffect, useState } from 'react';
import { FileText, Loader2, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export type FileManagerFileReference = {
  id: string;
  folder_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  file_asset_id: string | null;
  storage_path: string | null;
  created_at: string;
  folder_name?: string;
};

type FileRow = FileManagerFileReference & {
  shipment_id: string | null;
  client_id: string | null;
};

type Props = {
  open: boolean;
  organizationId: string;
  shipmentId: string;
  clientId?: string | null;
  onClose: () => void;
  onSelect: (file: FileManagerFileReference) => void;
};

const supported = (file: Pick<FileRow, 'original_name' | 'mime_type'>) => {
  const name = file.original_name.toLowerCase();
  const mime = file.mime_type.toLowerCase();
  return mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png' ||
    /\.(pdf|jpe?g|png)$/.test(name);
};

const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'اندازه نامشخص';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FileManagerFilePicker: React.FC<Props> = ({
  open, organizationId, shipmentId, clientId, onClose, onSelect,
}) => {
  const [files, setFiles] = useState<FileManagerFileReference[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !organizationId || !shipmentId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const columns = 'id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,storage_path,created_at';
        const requests = [
          supabase.from('file_manager_files').select(columns)
            .eq('organization_id', organizationId).eq('shipment_id', shipmentId)
            .eq('is_archived', false).order('created_at', { ascending: false }).limit(150),
        ];
        if (clientId) {
          requests.push(
            supabase.from('file_manager_files').select(columns)
              .eq('organization_id', organizationId).eq('client_id', clientId)
              .is('shipment_id', null).eq('is_archived', false)
              .order('created_at', { ascending: false }).limit(100),
          );
        }
        const results = await Promise.all(requests);
        const failure = results.find((result) => result.error);
        if (failure?.error) throw failure.error;
        const unique = new Map<string, FileRow>();
        for (const result of results) {
          for (const row of (result.data || []) as FileRow[]) {
            if ((row.file_asset_id || row.storage_path) && supported(row) && !unique.has(row.id)) unique.set(row.id, row);
          }
        }
        const rows = [...unique.values()];
        const folderIds = [...new Set(rows.map((row) => row.folder_id))];
        const folderNames = new Map<string, string>();
        if (folderIds.length) {
          const { data, error: folderError } = await supabase.from('file_manager_folders')
            .select('id,display_name').eq('organization_id', organizationId).in('id', folderIds);
          if (folderError) throw folderError;
          for (const folder of data || []) folderNames.set(folder.id, folder.display_name);
        }
        if (!cancelled) {
          setFiles(rows.map((row) => ({ ...row, folder_name: folderNames.get(row.folder_id) || 'فایل‌منیجر' })));
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'خواندن فایل‌منیجر ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, organizationId, shipmentId, clientId]);

  if (!open) return null;
  const filtered = files.filter((file) =>
    `${file.original_name} ${file.folder_name || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="file-manager-picker-title"
        dir="rtl" className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border app-border bg-[var(--surface)] shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b app-border p-4">
          <div>
            <h2 id="file-manager-picker-title" className="font-black">انتخاب سند از فایل‌منیجر</h2>
            <p className="mt-1 text-xs app-muted">سند موجود به اظهار متصل می‌شود؛ دوباره آپلود نمی‌شود.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border app-border p-2" aria-label="بستن"><X size={18}/></button>
        </header>
        <div className="border-b app-border p-3">
          <label className="flex items-center gap-2 rounded-xl border app-border bg-[var(--surface-2)] px-3">
            <Search size={16} className="app-muted"/>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو نام سند…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"/>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="flex items-center justify-center gap-2 p-8 text-sm app-muted"><Loader2 size={18} className="animate-spin"/>در حال دریافت اسناد…</div>}
          {error && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-500">{error}</div>}
          {!loading && !error && filtered.length === 0 && <p className="p-8 text-center text-sm app-muted">در پوشه محموله یا پوشه صاحب کالا سند PDF/JPG/PNG پیدا نشد.</p>}
          <div className="space-y-2">
            {filtered.map((file) => (
              <button key={file.id} type="button" onClick={() => onSelect(file)}
                className="flex w-full items-center gap-3 rounded-xl border app-border p-3 text-right transition hover:border-[var(--primary)]">
                <span className="rounded-lg bg-[var(--surface-2)] p-2"><FileText size={20}/></span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-bold">{file.original_name}</span>
                  <span className="mt-1 block text-xs app-muted">{file.folder_name} · {formatSize(Number(file.size_bytes))}</span>
                </span>
                <span className="shrink-0 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs font-bold">انتخاب</span>
              </button>
            ))}
          </div>
        </div>
        <footer className="border-t app-border p-3 text-left">
          <button type="button" onClick={onClose} className="rounded-xl border app-border px-4 py-2 text-sm font-bold">انصراف</button>
        </footer>
      </section>
    </div>
  );
};
