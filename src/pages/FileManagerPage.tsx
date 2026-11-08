import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, Copy, ClipboardPaste,
  Download, Eye, FileText, Folder, FolderOpen, Loader2, MessageCircle,
  RefreshCw, Search, Upload, UploadCloud, X, HardDrive, Smartphone, ShieldCheck,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createAppFileTransfer, consumeAppFileTransfer } from '../lib/appFileTransfer';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  downloadTelegramArchivedFile,
  FILE_ARCHIVE_MAX_BYTES,
  createTelegramArchiveIdempotencyKey,
  getFileArchiveDestination,
  uploadTelegramArchivedFile,
} from '../lib/fileManager';
import { folderToneClass, getFolderSubtreeCounts, isCopyableFolder } from '../lib/fileManagerExplorer';
import { optimizeFileForUpload } from '../lib/clientFileOptimizer';
import { safeWindowsFileName } from '../lib/safeWindowsFileName';
import { createPortableSyncArchive, readPortableSyncArchive, PORTABLE_SYNC_ROOT_NAME } from '../lib/fileManagerPortableSync';
import {
  buildDocumentMetadataText,
  buildFolderMetadataText,
  clearSavedSyncDirectoryHandle,
  getSavedSyncDirectoryHandle,
  isManagedSyncMetadataFile,
  requestSyncDirectoryPermission,
  saveSyncDirectoryHandle,
} from '../lib/fileManagerSync';

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

type WindowsSyncProgress = {
  percent: number;
  phase: string;
  currentItem: string;
  foldersCreated: number;
  downloaded: number;
  uploaded: number;
  identical: number;
  metadataWritten: number;
  bytesSaved: number;
  failed: number;
  conflicts: number;
  oversized: number;
};

const byteLabel = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'اندازه نامشخص';
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
};
// Use the same Chromium-safe name mapping for every synced file and folder.
const windowsName = safeWindowsFileName;
const folderSlug = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 72) || crypto.randomUUID();

const roleCanModifyStructure = (role?: string | null) =>
  ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'].includes(String(role || ''));

export const FileManagerPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const handledTransferIds = useRef(new Set<string>());
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
  const [syncing, setSyncing] = useState(false);
  const [syncDirectoryName, setSyncDirectoryName] = useState('');
  const [syncProgress, setSyncProgress] = useState<WindowsSyncProgress | null>(null);
  const [portableSyncOpen, setPortableSyncOpen] = useState(false);
  const portableDirectoryInput = useRef<HTMLInputElement | null>(null);
  const portableArchiveInput = useRef<HTMLInputElement | null>(null);
  const [smbAddress, setSmbAddress] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const uploadTags = useMemo(() => [...new Set(tagInput.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20), [tagInput]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [treeOpen, setTreeOpen] = useState(false);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [folderFileCounts, setFolderFileCounts] = useState<Record<string, number>>({});
  const [archiveDestination, setArchiveDestination] = useState<{ connectionId:string; chatId:string; displayName:string } | null>(null);
  const [archiveDestinationStatus, setArchiveDestinationStatus] = useState<'checking'|'ready'|'unavailable'>('checking');
  const [clipboardFolderId, setClipboardFolderId] = useState<string | null>(null);
  const [copyingFolder, setCopyingFolder] = useState(false);
  const [folderCopyAvailable, setFolderCopyAvailable] = useState(false);
  const [preview, setPreview] = useState<{url:string; name:string; mime:string} | null>(null);
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
  const folderChildrenByParent = useMemo(() => {
    const index = new Map<string, FolderRow[]>();
    for (const folder of folders) {
      if (!folder.parent_id) continue;
      const list = index.get(folder.parent_id) || [];
      list.push(folder); index.set(folder.parent_id, list);
    }
    for (const list of index.values()) list.sort((a,b) => a.display_name.localeCompare(b.display_name,'fa'));
    return index;
  }, [folders]);
  const folderDescendantCounts = useMemo(() => getFolderSubtreeCounts(folders, folderFileCounts), [folders, folderFileCounts]);
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
      try {
        const counts: Record<string,number> = {};
        for (let offset=0; ; offset+=500) {
          const {data:fileRows,error:countError}=await supabase.from('file_manager_files').select('id,folder_id')
            .eq('organization_id',organizationId).eq('is_archived',false).order('id',{ascending:true}).range(offset,offset+499);
          if(countError) throw countError;
          for(const row of fileRows||[]) counts[row.folder_id]=(counts[row.folder_id]||0)+1;
          if((fileRows||[]).length<500) break;
        }
        setFolderFileCounts(counts);
      } catch { setFolderFileCounts({}); }
      const requestedFolder = initialRoute.current.folderId;
      const requestedShipment = initialRoute.current.shipmentId;
      const requested =
        rows.find((folder) => folder.id === requestedFolder) ||
        rows.find((folder) => folder.shipment_id === requestedShipment && folder.folder_type === 'shipment') ||
        rows.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root') ||
        rows[0] || null;
      setSelectedFolderId((previous) => rows.some((folder) => folder.id === previous) ? previous : requested?.id || '');
      if(requested){
        const expand=new Set<string>(); let cursor:FolderRow|undefined=requested; let hops=0;
        while(cursor&&hops<30){if(rows.some(folder=>folder.parent_id===cursor!.id))expand.add(cursor.id);cursor=cursor.parent_id?rows.find(folder=>folder.id===cursor!.parent_id):undefined;hops++;}
        setExpandedFolders(old=>new Set([...old,...expand]));
      }
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
  useEffect(() => {
    let active = true;
    void getSavedSyncDirectoryHandle().then((handle) => {
      if (active) setSyncDirectoryName(handle?.name || '');
    }).catch(() => { if (active) setSyncDirectoryName(''); });
    return () => { active = false; };
  }, []);

  const incomingTransferId = params.get('fileTransfer');
  useEffect(() => {
    if (!incomingTransferId || handledTransferIds.current.has(incomingTransferId)) return;
    handledTransferIds.current.add(incomingTransferId);
    void consumeAppFileTransfer(incomingTransferId, 'file-manager')
      .then((transferredFiles) => {
        setPendingFiles((previous) => [...previous, ...transferredFiles]);
        setUploadPanelOpen(true);
        setMessage(transferredFiles.length + ' فایل از بخش دیگر دریافت شد. پوشه صاحب کالا یا محموله را انتخاب و سپس «ارسال به آرشیو تلگرام» را بزنید.');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'دریافت فایل انتقالی ناموفق بود.'))
      .finally(() => {
        const next = new URLSearchParams(params);
        next.delete('fileTransfer');
        setParams(next, { replace: true });
      });
  }, [incomingTransferId, params, setParams]);
  useEffect(() => {
    if(!folders.length) return;
    const routeFolder=params.get('folderId');
    if(routeFolder&&folders.some(folder=>folder.id===routeFolder)&&routeFolder!==selectedFolderId)setSelectedFolderId(routeFolder);
  },[params,folders,selectedFolderId]);
  useEffect(() => {
    let cancelled=false;
    void getFileArchiveDestination().then(destination=>{if(!cancelled){setArchiveDestination(destination);setArchiveDestinationStatus('ready');}})
      .catch(()=>{if(!cancelled){setArchiveDestination(null);setArchiveDestinationStatus('unavailable');}});
    return ()=>{cancelled=true;};
  },[]);
  useEffect(() => {
    let cancelled=false;
    void (async()=>{
      try {
        const {error:rpcError}=await supabase.rpc('copy_file_manager_folder',{p_source_folder_id:null,p_target_parent_id:null,p_new_display_name:null});
        if(!cancelled)setFolderCopyAvailable(Boolean(rpcError&&rpcError.message.includes('FILE_MANAGER_COPY_INVALID_INPUT')));
      } catch {
        if(!cancelled)setFolderCopyAvailable(false);
      }
    })();
    return ()=>{cancelled=true;};
  },[]);
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

  const chooseFolder = (folder:FolderRow) => {
    setSelectedFolderId(folder.id);
    setExpandedFolders(previous=>{const next=new Set(previous);next.add(folder.id);let c:FolderRow|undefined=folder;let n=0;while(c&&n<30){if(c.parent_id)next.add(c.parent_id);c=c.parent_id?folders.find(item=>item.id===c!.parent_id):undefined;n++;}return next;});
    setTreeOpen(false);setQuery('');setHits([]);setError('');setMessage('');
    const next=new URLSearchParams(params);next.set('folderId',folder.id);
    if(folder.shipment_id)next.set('shipmentId',folder.shipment_id);else next.delete('shipmentId');
    setParams(next);
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
    let attemptingFile = '';
    setProgress('در حال بررسی مقصد آرشیو تلگرام…');
    try {
      const target = await getUploadTarget();
      const destination = await getFileArchiveDestination();
      setProgress('مقصد «' + destination.displayName + '» آماده است؛ فایل‌ها آماده‌سازی می‌شوند.');
      for (const file of pendingFiles) {
        attemptingFile = file.name;
        setProgress('در حال بهینه‌سازی فایل در همین دستگاه: ' + file.name);
        const optimized = await optimizeFileForUpload(file);
        const fileToUpload = optimized.file;
        if (fileToUpload.size > FILE_ARCHIVE_MAX_BYTES) {
          throw new Error(`فایل «${file.name}» پس از بهینه‌سازی هنوز بیشتر از ۲۰ مگابایت است؛ مقصد فعلی آرشیو تلگرام این محدودیت را دارد.`);
        }
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const segments = relativePath.split('/').filter(Boolean).slice(0, -1);
        let parent = target;
        for (const segment of segments) parent = await getOrCreateSubfolder(parent, segment);
        const documentType = parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG';
        const idempotencyKey = await createTelegramArchiveIdempotencyKey(fileToUpload, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType,
          documentName: fileToUpload.name,
          destination,
        });
        setProgress(
          optimized.optimized
            ? `حجم فایل ${optimized.savedPercent}٪ کاهش یافت؛ در حال ارسال: ${fileToUpload.name}`
            : 'در حال ارسال به تلگرام: ' + file.name
        );
        await uploadTelegramArchivedFile(fileToUpload, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType,
          tags: uploadTags,
          destination,
          idempotencyKey,
        });
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
      setMessage(completed + ' فایل به گفت‌وگوی تلگرام «' + destination.displayName + '» ارسال شد و در همین پوشه ثبت شد. برای یافتن، نام فایل یا برچسب را در همان گفتگو جست‌وجو کنید.');
      setPendingFiles([]);
      setProgress('');
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'آپلود ناموفق بود.';
      setError(attemptingFile ? `فایل «${attemptingFile}»: ${reason}` : reason);
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
    const copyAliasAssetId = typeof file.metadata?.copyAliasFileAssetId === 'string' ? file.metadata.copyAliasFileAssetId : '';
    const downloadStorageCopy = async (): Promise<Blob> => {
      if (!file.storage_path) throw new Error('نسخه پشتیبان فایل در Supabase Storage ثبت نشده است.');
      const { data, error: storageError } = await supabase.storage.from('customs_documents').download(file.storage_path);
      if (storageError) throw storageError;
      return data;
    };

    // Telegram Bot API download is limited to 20 MB. Prefer the original Storage
    // copy for larger files, and fall back to it if Telegram retrieval fails.
    if (file.storage_path && Number(file.size_bytes) > FILE_ARCHIVE_MAX_BYTES) {
      return downloadStorageCopy();
    }
    const assetId = copyAliasAssetId || file.file_asset_id;
    if (assetId) {
      try {
        return await downloadTelegramArchivedFile(assetId);
      } catch (telegramError) {
        if (file.storage_path) return downloadStorageCopy();
        throw telegramError;
      }
    }
    if (file.storage_path) return downloadStorageCopy();
    throw new Error('مسیر بازیابی فایل ثبت نشده است.');
  };

  const downloadFile = async (file:FileRow) => {
    setError('');
    try {const blob=await getFileBlob(file);saveBlob(blob,file.original_name||'document.bin');}
    catch(e){setError(e instanceof Error?e.message:'دریافت فایل ناموفق بود.');}
  };
  const previewDocument=async(file:FileRow)=>{
    const mime=(file.mime_type||'').toLowerCase();
    if(!(mime.startsWith('image/')||mime==='application/pdf'||mime==='text/plain')){setError('پیش‌نمایش این نوع فایل پشتیبانی نمی‌شود؛ از دانلود استفاده کنید.');return;}
    setError('');
    try{const blob=await getFileBlob(file);setPreview({url:URL.createObjectURL(blob),name:file.original_name||'document.bin',mime});}
    catch(e){setError(e instanceof Error?e.message:'نمایش فایل ناموفق بود.');}
  };
  const transferFileFromManager=async(file:FileRow,target:'chat'|'pdf-studio')=>{
    const mime=(file.mime_type||'').toLowerCase();
    if(target==='pdf-studio'&&!(mime==='application/pdf'||mime==='image/png'||mime==='image/jpeg'||/\.(pdf|png|jpe?g)$/i.test(file.original_name))){
      setError('PDF Studio فقط PDF و تصویرهای JPG یا PNG را می‌پذیرد.');return;
    }
    setError('');setMessage('در حال آماده‌سازی فایل برای انتقال…');
    try{
      const blob=await getFileBlob(file);
      const transferred=new File([blob],file.original_name||'document', {type:file.mime_type||blob.type||'application/octet-stream',lastModified:Date.now()});
      const transferId=await createAppFileTransfer([transferred],target);
      navigate(target==='pdf-studio'?'/pdf-studio?fileTransfer='+encodeURIComponent(transferId):'/chat?fileTransfer='+encodeURIComponent(transferId));
    }catch(e){setError(e instanceof Error?e.message:'انتقال فایل ناموفق بود.');setMessage('');}
  };
  const copyFileNameForTelegram=async(name:string)=>{
    try{await navigator.clipboard.writeText(name);setMessage('نام فایل کپی شد؛ آن را در گفت‌وگوی آرشیو تلگرام جست‌وجو کنید.');}
    catch{setError('کپی نام فایل پشتیبانی نمی‌شود؛ نام را دستی انتخاب کنید.');}
  };
  const beginCopyFolder=(folder:FolderRow)=>{
    if(!isCopyableFolder(folder)){setError('پوشه‌های ریشه، صاحب کالا و محموله کپی نمی‌شوند.');return;}
    if(!folderCopyAvailable){setError('کپی کامل پوشه نیازمند migration دیتابیس است؛ فعلاً هیچ فایلی تغییر نکرد.');return;}
    setClipboardFolderId(folder.id);setError('');setMessage('پوشه برای کپی انتخاب شد؛ مقصد را باز کنید و «چسباندن پوشه» را بزنید.');
  };
  const pasteCopiedFolder=async()=>{
    if(!clipboardFolderId||!currentFolder||currentFolder.folder_type==='root')return;
    setCopyingFolder(true);setError('');setMessage('');
    try{
      const {data,error:copyError}=await supabase.rpc('copy_file_manager_folder',{p_source_folder_id:clipboardFolderId,p_target_parent_id:currentFolder.id,p_new_display_name:null});
      if(copyError)throw copyError;
      const newId=typeof data==='string'?data:(Array.isArray(data)?data[0]?.copy_file_manager_folder:null);
      if(!newId)throw new Error('شناسه پوشهٔ کپی‌شده دریافت نشد.');
      await loadFolders();const next=new URLSearchParams(params);next.set('folderId',newId);next.delete('shipmentId');setParams(next);setSelectedFolderId(newId);
      setMessage('ساختار پوشه کپی شد؛ فایل اصلی در تلگرام/Storage دوباره آپلود یا حذف نشد.');
    }catch(e){
      const m=e instanceof Error?e.message:String(e);
      setError(m.includes('FILE_MANAGER_COPY_SCOPE_MISMATCH')?'فقط در همان صاحب کالا/محموله کپی کنید تا مالکیت تغییر نکند.':m.includes('PGRST202')||m.toLowerCase().includes('schema cache')?'قابلیت کپی هنوز در دیتابیس فعال نیست؛ هیچ فایلی تغییر نکرد.':m);
    }finally{setCopyingFolder(false);await loadFolders().catch(()=>undefined);}
  };
  useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview?.url]);


  const fetchPortableFolderTree = async () => {
    const { data, error: folderError } = await supabase
      .from('file_manager_folders')
      .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
      .eq('organization_id', organizationId)
      .order('display_name', { ascending: true });
    if (folderError) throw folderError;
    const folderRows = (data || []) as FolderRow[];
    const cloudRoot = folderRows.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root');
    if (!cloudRoot) throw new Error('پوشه اصلی «صاحبان کالا» پیدا نشد؛ ابتدا ساختار فایل‌منیجر را تازه‌سازی کنید.');

    const folderPathById = new Map<string, string>([[cloudRoot.id, '']]);
    const folderByPath = new Map<string, FolderRow>([['', cloudRoot]]);
    const childrenByParent = new Map<string, FolderRow[]>();
    for (const folder of folderRows) {
      if (!folder.parent_id) continue;
      const siblings = childrenByParent.get(folder.parent_id) || [];
      siblings.push(folder);
      childrenByParent.set(folder.parent_id, siblings);
    }
    const queue: FolderRow[] = [cloudRoot];
    const conflicts = new Set<string>();
    while (queue.length) {
      const parent = queue.shift()!;
      const parentPath = folderPathById.get(parent.id) ?? '';
      for (const child of childrenByParent.get(parent.id) || []) {
        const segment = windowsName(child.display_name);
        const childPath = parentPath ? parentPath + '/' + segment : segment;
        if (folderByPath.has(childPath)) {
          conflicts.add(childPath);
          continue;
        }
        folderByPath.set(childPath, child);
        folderPathById.set(child.id, childPath);
        queue.push(child);
      }
    }
    return { folderRows, cloudRoot, folderPathById, folderByPath, folderConflicts: conflicts };
  };

  const fetchPortableFileRows = async (folderIds: string[]): Promise<FileRow[]> => {
    const all: FileRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error: fileError } = await supabase
        .from('file_manager_files')
        .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
        .eq('organization_id', organizationId)
        .in('folder_id', folderIds)
        .eq('is_archived', false)
        .order('created_at', { ascending: true })
        .range(offset, offset + 499);
      if (fileError) throw fileError;
      const batch = (data || []) as FileRow[];
      all.push(...batch);
      if (batch.length < 500) break;
    }
    return all;
  };

  const fetchPortableOrganizationTables = async () => {
    const tableNames = [
      'clients', 'shipments', 'shipment_customs_data', 'cases', 'vessels',
      'shipping_lines', 'customs_offices', 'registration_orders',
      'customs_declarations', 'financial_transactions', 'customs_documents',
      'shipment_documents', 'customs_accounting_vouchers', 'finance_cost_categories',
      'finance_cost_items', 'finance_invoice_lines', 'finance_invoice_shipments',
      'finance_invoices', 'finance_org_settings', 'finance_payment_allocations',
      'finance_payment_request_lines', 'finance_payment_requests', 'finance_payments',
      'petty_cash_ledger',
    ];
    const fetchRows = async (table: string): Promise<Record<string, any>[]> => {
      const collected: Record<string, any>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: queryError } = await (supabase as any).from(table)
          .select('*').eq('organization_id', organizationId).range(offset, offset + 499);
        if (queryError) throw new Error('خواندن اطلاعات جدول ' + table + ' ناموفق بود: ' + queryError.message);
        const rows = (data || []) as Record<string, any>[];
        collected.push(...rows);
        if (rows.length < 500) break;
      }
      return collected;
    };
    const rows = await Promise.all(tableNames.map((table) => fetchRows(table)));
    return Object.fromEntries(tableNames.map((table, index) => [table, rows[index]])) as Record<string, Record<string, any>[]>;
  };

  const exportPortableSyncArchive = async (manageSyncState = true): Promise<{ downloaded: number; failed: number; archiveBytes: number }> => {
    if (manageSyncState) {
      setSyncing(true);
      setError('');
      setMessage('');
      setProgress('آماده‌سازی بسته ZIP قابل‌بازیابی…');
    }
    let downloaded = 0;
    let failed = 0;
    let archiveBytes = 0;
    let metadataWritten = 0;
    let bytesProcessed = 0;
    const failures: string[] = [];
    const progressState: WindowsSyncProgress = {
      percent: 0, phase: 'آماده‌سازی نسخه قابل‌حمل', currentItem: '',
      foldersCreated: 0, downloaded: 0, uploaded: 0, identical: 0,
      metadataWritten: 0, bytesSaved: 0, failed: 0, conflicts: 0, oversized: 0,
    };
    if (manageSyncState) setSyncProgress(progressState);
    const publish = (patch: Partial<WindowsSyncProgress>) => {
      Object.assign(progressState, patch);
      setSyncProgress({ ...progressState });
    };

    try {
      const tree = await fetchPortableFolderTree();
      const folderIds = [...tree.folderPathById.keys()];
      if (!folderIds.length) throw new Error('هیچ پوشه‌ای برای تهیه نسخه قابل‌حمل پیدا نشد.');
      publish({
        phase: 'دریافت فهرست اسناد سازمان',
        percent: 5,
        foldersCreated: tree.folderByPath.size,
        currentItem: tree.cloudRoot.display_name,
      });
      const [latestFiles, tables] = await Promise.all([
        fetchPortableFileRows(folderIds),
        fetchPortableOrganizationTables(),
      ]);
      const entries: Array<{ path: string; data: Uint8Array }> = [];
      const usedPaths = new Set<string>();
      const rootPath = PORTABLE_SYNC_ROOT_NAME + '/' + windowsName(tree.cloudRoot.display_name);
      const folderPaths = [...tree.folderByPath.entries()]
        .sort((a, b) => a[0].split('/').length - b[0].split('/').length);

      const addEntry = (entryPath: string, data: Uint8Array) => {
        let finalPath = entryPath;
        if (usedPaths.has(finalPath.toLocaleLowerCase())) {
          const slash = finalPath.lastIndexOf('/');
          const parent = slash >= 0 ? finalPath.slice(0, slash + 1) : '';
          const leaf = slash >= 0 ? finalPath.slice(slash + 1) : finalPath;
          const dot = leaf.lastIndexOf('.');
          const base = dot > 0 ? leaf.slice(0, dot) : leaf;
          const ext = dot > 0 ? leaf.slice(dot) : '';
          let suffix = 2;
          while (usedPaths.has((parent + base + '__' + suffix + ext).toLocaleLowerCase())) suffix += 1;
          finalPath = parent + base + '__' + suffix + ext;
        }
        usedPaths.add(finalPath.toLocaleLowerCase());
        entries.push({ path: finalPath, data });
      };

      const totalTasks = latestFiles.length + folderPaths.length;
      for (let index = 0; index < latestFiles.length; index += 1) {
        const file = latestFiles[index];
        const parentPath = tree.folderPathById.get(file.folder_id);
        if (parentPath === undefined) continue;
        const relativeFolder = parentPath ? rootPath + '/' + parentPath : rootPath;
        const filename = windowsName(file.original_name || 'document');
        try {
          const blob = await getFileBlob(file);
          if (Number(file.size_bytes) > 0 && blob.size !== Number(file.size_bytes)) {
            throw new Error('حجم فایل دریافتی با اندازه ثبت‌شده مطابقت ندارد.');
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          addEntry(relativeFolder + '/' + filename, bytes);
          downloaded += 1;
          bytesProcessed += bytes.byteLength;
        } catch (reason) {
          failed += 1;
          failures.push((parentPath ? parentPath + '/' : '') + filename + ': ' + (reason instanceof Error ? reason.message : 'دریافت فایل ناموفق بود.'));
        }
        publish({
          phase: 'دریافت فایل‌های اصلی از آرشیو',
          percent: 8 + Math.round(((index + 1) / Math.max(totalTasks, 1)) * 65),
          currentItem: relativeFolder + '/' + filename,
          downloaded,
          failed,
          bytesSaved: bytesProcessed,
        });
      }

      const byId = (rows: Record<string, any>[], id: unknown) => rows.find((row) => row.id === id) || null;
      for (let index = 0; index < folderPaths.length; index += 1) {
        const [relativePath, folder] = folderPaths[index];
        const shipment = byId(tables.shipments, folder.shipment_id);
        const caseRecord = byId(tables.cases, shipment?.case_id);
        const client = byId(tables.clients, folder.client_id || shipment?.client_id || caseRecord?.client_id);
        const declarations = tables.customs_declarations.filter((row) =>
          (folder.shipment_id && row.shipment_id === folder.shipment_id) ||
          (caseRecord && row.case_id === caseRecord.id));
        const declarationIds = declarations.map((row) => row.id);
        const transactions = tables.financial_transactions.filter((row) =>
          (row.case_id && caseRecord && row.case_id === caseRecord.id) ||
          (row.source_id && (row.source_id === folder.shipment_id || declarationIds.includes(row.source_id))));
        const order = tables.registration_orders.find((row) =>
          (shipment?.registration_order_id && row.id === shipment.registration_order_id) ||
          (caseRecord && row.case_id === caseRecord.id)) || null;
        const vessel = byId(tables.vessels, shipment?.vessel_id);
        const shippingLine = byId(tables.shipping_lines, vessel?.shipping_line_id);
        const customsOffice = byId(tables.customs_offices, folder.customs_office_id || shipment?.customs_office_id || caseRecord?.customs_office_id);
        const customsData = tables.shipment_customs_data.find((row) => row.shipment_id === folder.shipment_id) || null;
        const folderFiles = latestFiles.filter((row) => row.folder_id === folder.id);
        const customsDocuments = tables.customs_documents.filter((row) =>
          row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const shipmentDocuments = tables.shipment_documents.filter((row) =>
          row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const folderText = buildFolderMetadataText({
          folder,
          client,
          shipment,
          customsData,
          caseRecord,
          vessel,
          shippingLine,
          customsOffice,
          registrationOrder: order,
          declarations,
          financialTransactions: transactions,
          documents: [
            ...folderFiles.map((row) => row as unknown as Record<string, unknown>),
            ...customsDocuments,
            ...shipmentDocuments,
          ],
          relatedSections: [
            { title: 'پرونده و ثبت سفارش‌های مرتبط', records: caseRecord ? [caseRecord, ...tables.registration_orders.filter((row) => row.case_id === caseRecord.id)] : [] },
            { title: 'هزینه‌ها و فاکتورهای مرتبط', records: tables.finance_cost_items.filter((row) =>
              (folder.shipment_id && row.shipment_id === folder.shipment_id) ||
              (caseRecord && row.case_id === caseRecord.id) ||
              (folder.client_id && row.client_id === folder.client_id)) },
            { title: 'پرداخت‌ها و اسناد حسابداری', records: [
              ...tables.finance_payments.filter((row) =>
                (folder.shipment_id && row.shipment_id === folder.shipment_id) ||
                (caseRecord && row.case_id === caseRecord.id) ||
                (folder.client_id && row.client_id === folder.client_id)),
              ...tables.customs_accounting_vouchers.filter((row) =>
                (caseRecord && row.case_id === caseRecord.id) ||
                (folder.client_id && row.client_id === folder.client_id)),
            ] },
          ],
          generatedAt: new Date().toISOString(),
        });
        const relativeFolder = relativePath ? rootPath + '/' + relativePath : rootPath;
        addEntry(relativeFolder + '/اطلاعات_عملیاتی.txt', new TextEncoder().encode(folderText));
        metadataWritten += 1;
        for (const file of folderFiles) {
          const fileName = windowsName(file.original_name || 'document');
          addEntry(
            relativeFolder + '/' + windowsName(fileName + '.اطلاعات.txt'),
            new TextEncoder().encode(buildDocumentMetadataText(file as unknown as Record<string, unknown>, folderText)),
          );
          metadataWritten += 1;
        }
        publish({
          phase: 'ساخت اطلاعات عملیاتی و فراداده',
          percent: 73 + Math.round(((index + 1) / Math.max(folderPaths.length, 1)) * 17),
          currentItem: relativeFolder,
          downloaded,
          metadataWritten,
          failed,
          bytesSaved: bytesProcessed,
        });
      }

      const snapshot = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        organizationId,
        tables,
        fileManager: {
          folders: folderPaths.map(([relativePath, folder]) => ({ relativePath, ...folder })),
          files: latestFiles,
        },
      };
      publish({
        phase: 'فشرده‌سازی نسخه قابل‌حمل ZIP',
        percent: 93,
        currentItem: 'اطلاعات_کامل_سازمان.json',
        downloaded,
        metadataWritten: metadataWritten + 1,
        failed,
        bytesSaved: bytesProcessed,
      });
      const zipBytes = createPortableSyncArchive(entries, snapshot);
      archiveBytes = zipBytes.byteLength;
      const dateStamp = new Date().toISOString().slice(0, 10);
      saveBlob(new Blob([zipBytes], { type: 'application/zip' }), 'CustomsOS-Backup-' + dateStamp + '.zip');
      publish({
        phase: 'بسته پشتیبان آماده دانلود شد',
        percent: 100,
        currentItem: 'CustomsOS-Backup-' + dateStamp + '.zip',
        foldersCreated: tree.folderByPath.size,
        downloaded,
        uploaded: progressState.uploaded,
        identical: progressState.identical,
        metadataWritten: metadataWritten + 1,
        bytesSaved: archiveBytes,
        failed,
        conflicts: tree.folderConflicts.size,
        oversized: 0,
      });
      setMessage(
        'بسته ZIP سازمان آماده دانلود شد: ' + downloaded + ' فایل اصلی، ' +
        (metadataWritten + 1) + ' فایل اطلاعاتی و ' + byteLabel(archiveBytes) +
        '. آن را در برنامه Files ذخیره و برای انتقال به دستگاه دیگر نگهداری کنید.'
      );
      if (failed) setError(failed + ' فایل از آرشیو دریافت نشد: ' + failures.slice(0, 3).join(' | '));
      return { downloaded, failed, archiveBytes };
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : 'تهیه بسته ZIP ناموفق بود.';
      setError(messageText);
      publish({ phase: 'تهیه بسته ZIP ناموفق بود', currentItem: messageText, failed: failed + 1 });
      return { downloaded, failed: failed + 1, archiveBytes };
    } finally {
      if (manageSyncState) {
        setSyncing(false);
        setProgress('');
      }
    }
  };

  const portableMimeType = (name: string) => {
    const extension = name.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zip: 'application/zip',
    };
    return mimeTypes[extension] || 'application/octet-stream';
  };

  const normalizePortableFolderPath = (rawPath: string, ownerRootName: string) => {
    const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts[0]?.toLocaleLowerCase() === PORTABLE_SYNC_ROOT_NAME.toLocaleLowerCase()) parts.shift();
    if (parts[0]?.toLocaleLowerCase() === ownerRootName.toLocaleLowerCase()) parts.shift();
    if (parts[0]?.toLocaleLowerCase() === 'صاحبان کالا') parts.shift();
    const safeParts = parts.map(windowsName);
    if (!safeParts.length) return '';
    const name = safeParts[safeParts.length - 1].toLocaleLowerCase();
    if (
      name === 'desktop.ini' || name === 'thumbs.db' || name === '.ds_store' ||
      name.startsWith('~
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setPortableSyncOpen(true);
      setError('');
      setMessage('این مرورگر از نوشتن مستقیم در پوشه پشتیبانی نمی‌کند؛ روش پوشه/ZIP را انتخاب کنید تا فایل‌ها با آرشیو سازمان هماهنگ شوند.');
      return;
    }
    try {
      const handle = await picker({ mode: 'readwrite', id: 'customs-os-file-manager-sync' });
      await saveSyncDirectoryHandle(handle);
      setSyncDirectoryName(handle.name || '');
      setMessage('محل ذخیره ثبت شد. از این پس با یک کلیک همه اطلاعات و فایل‌های سازمان همگام‌سازی می‌شوند.');
      setError('');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'ذخیره محل همگام‌سازی ناموفق بود.');
    }
  };

  const forgetSyncDirectory = async () => {
    try {
      await clearSavedSyncDirectoryHandle();
      setSyncDirectoryName('');
      setMessage('محل ذخیره قبلی فراموش شد. هنگام همگام‌سازی بعدی یک پوشه جدید انتخاب کنید.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'حذف محل ذخیره ناموفق بود.');
    }
  };

  const copySmbAddress = async () => {
    const value = smbAddress.trim();
    if (!value || !/^[a-zA-Z0-9.-]+$/.test(value)) {
      setError('IP یا نام شبکه معتبر وارد کنید؛ مثال: 192.168.1.20');
      return;
    }
    try {
      await navigator.clipboard.writeText('smb://' + value);
      setMessage('آدرس SMB کپی شد. آن را در Files آیفون، بخش Connect to Server وارد کنید.');
    } catch {
      setError('کپی آدرس ممکن نشد؛ آدرس smb://' + value + ' را دستی وارد کنید.');
    }
  };

  // One-time folder selection followed by one-click, organization-wide safe sync.
  // Existing document bytes are never overwritten or deleted; changed paths become conflicts.
  const syncWindowsFolder = async () => {
    if (!organizationId || !roleCanModifyStructure(role)) {
      setError('برای همگام‌سازی کامل سازمان، دسترسی فایل‌منیجر لازم است.');
      return;
    }
    const cloudRoot = folders.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root');
    if (!cloudRoot) {
      setError('پوشه اصلی «صاحبان کالا» در فایل‌منیجر پیدا نشد؛ ساختار پوشه‌ها را تازه‌سازی کنید.');
      return;
    }
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setPortableSyncOpen(true);
      setError('');
      setMessage('روش سازگار با این مرورگر فعال شد. پوشه یا نسخه ZIP دستگاه را انتخاب کنید؛ سپس نسخه کامل آرشیو برای ذخیره در Files آماده می‌شود.');
      return;
    }

    setSyncing(true);
    setError('');
    setMessage('');
    setProgress('آماده‌سازی محل ذخیره و دریافت اطلاعات سازمان…');
    let uploaded = 0;
    let downloaded = 0;
    let identical = 0;
    let conflicts = 0;
    let oversized = 0;
    let failed = 0;
    let foldersCreated = 0;
    let metadataWritten = 0;
    let bytesSaved = 0;
    let transferCompleted = 0;
    let transferTotal = 0;
    let archiveDestination: Awaited<ReturnType<typeof getFileArchiveDestination>> | null = null;
    const failedItems: string[] = [];
    let progressSnapshot: WindowsSyncProgress = {
      percent: 0,
      phase: 'آماده‌سازی همگام‌سازی',
      currentItem: '',
      foldersCreated: 0,
      downloaded: 0,
      uploaded: 0,
      identical: 0,
      metadataWritten: 0,
      bytesSaved: 0,
      failed: 0,
      conflicts: 0,
      oversized: 0,
    };
    const publishSyncProgress = (patch: Partial<WindowsSyncProgress>) => {
      progressSnapshot = { ...progressSnapshot, ...patch };
      setSyncProgress(progressSnapshot);
    };
    setSyncProgress(progressSnapshot);

    try {
      let selectedHandle = await getSavedSyncDirectoryHandle().catch(() => null);
      if (!selectedHandle) {
        selectedHandle = await picker({ mode: 'readwrite', id: 'customs-os-file-manager-sync' });
        await saveSyncDirectoryHandle(selectedHandle);
        setSyncDirectoryName(selectedHandle.name || '');
      }
      const permissionGranted = await requestSyncDirectoryPermission(selectedHandle);
      if (!permissionGranted) {
        throw new Error('اجازه نوشتن در پوشه ذخیره داده نشد. یک‌بار «تغییر محل ذخیره» را بزنید و پوشه را دوباره انتخاب کنید.');
      }
      // Keep the user's chosen directory clean and make the exact folder shareable over SMB.
      const localRoot = await selectedHandle.getDirectoryHandle('Darbandi Commercial', { create: true });
      setProgress('بررسی ساختار کامل صاحبان کالا، محموله‌ها و زیرپوشه‌ها…');

      const folderPathById = new Map<string, string>([[cloudRoot.id, '']]);
      const serverFolderByPath = new Map<string, FolderRow>([['', cloudRoot]]);
      const ambiguousPaths = new Set<string>();
      const queue: FolderRow[] = [cloudRoot];
      while (queue.length) {
        const parent = queue.shift()!;
        const parentPath = folderPathById.get(parent.id) ?? '';
        for (const child of folders.filter((item) => item.parent_id === parent.id)) {
          const segment = windowsName(child.display_name);
          const childPath = parentPath ? parentPath + '/' + segment : segment;
          if (serverFolderByPath.has(childPath)) {
            ambiguousPaths.add(childPath);
            continue;
          }
          folderPathById.set(child.id, childPath);
          serverFolderByPath.set(childPath, child);
          queue.push(child);
        }
      }

      const canonicalPath = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');
      const ambiguousFileKeys = new Set<string>();
      const localDirectories = new Map<string, any>([['', localRoot]]);
      const localFiles = new Map<string, { file: File; parentPath: string; relativePath: string }>();
      const walkLocal = async (directory: any, relative: string): Promise<void> => {
        for await (const [entryName, entry] of directory.entries()) {
          const name = windowsName(String(entryName));
          const relativePath = relative ? relative + '/' + name : name;
          if (entry.kind === 'directory') {
            if (localDirectories.has(relativePath)) {
              ambiguousPaths.add(relativePath);
              continue;
            }
            localDirectories.set(relativePath, entry);
            await walkLocal(entry, relativePath);
          } else if (entry.kind === 'file') {
            const lower = name.toLowerCase();
            if (['desktop.ini', 'thumbs.db', '.ds_store'].includes(lower) || lower.startsWith('~$') || isManagedSyncMetadataFile(name)) continue;
            const key = canonicalPath(relativePath);
            if (localFiles.has(key)) {
              ambiguousFileKeys.add(key);
              continue;
            }
            localFiles.set(key, { file: await entry.getFile(), parentPath: relative, relativePath });
          }
        }
      };
      await walkLocal(localRoot, '');

      const folderIds = [...folderPathById.keys()];
      const serverFiles: FileRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: listError } = await supabase
          .from('file_manager_files')
          .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
          .eq('organization_id', organizationId)
          .in('folder_id', folderIds)
          .eq('is_archived', false)
          .order('created_at', { ascending: true })
          .range(offset, offset + 499);
        if (listError) throw listError;
        const batch = (data || []) as FileRow[];
        serverFiles.push(...batch);
        if (batch.length < 500) break;
      }

      const serverFilesByPath = new Map<string, { file: FileRow; relativePath: string }>();
      for (const file of serverFiles) {
        const parentPath = folderPathById.get(file.folder_id);
        if (parentPath === undefined) continue;
        const relativePath = parentPath ? parentPath + '/' + windowsName(file.original_name) : windowsName(file.original_name);
        const key = canonicalPath(relativePath);
        if (serverFilesByPath.has(key)) ambiguousFileKeys.add(key);
        else serverFilesByPath.set(key, { file, relativePath });
      }

      const ensureServerFolder = async (relativePath: string): Promise<FolderRow> => {
        const existing = serverFolderByPath.get(relativePath);
        if (existing) return existing;
        const parts = relativePath.split('/').filter(Boolean);
        const parentPath = parts.slice(0, -1).join('/');
        const parent = await ensureServerFolder(parentPath);
        const segment = parts[parts.length - 1];
        const matching = folders.find((item) => item.parent_id === parent.id && windowsName(item.display_name) === segment);
        const folder = matching || await getOrCreateSubfolder(parent, segment);
        serverFolderByPath.set(relativePath, folder);
        folderPathById.set(folder.id, relativePath);
        return folder;
      };

      const ensureLocalFolder = async (relativePath: string): Promise<any> => {
        if (localDirectories.has(relativePath)) return localDirectories.get(relativePath);
        const parts = relativePath.split('/').filter(Boolean);
        let path = '';
        let handle = localRoot;
        for (const part of parts) {
          path = path ? path + '/' + part : part;
          if (localDirectories.has(path)) handle = localDirectories.get(path);
          else {
            handle = await handle.getDirectoryHandle(part, { create: true });
            localDirectories.set(path, handle);
          }
        }
        return handle;
      };

      const folderPathsToPrepare = [...serverFolderByPath.keys()]
        .filter(Boolean)
        .sort((a, b) => a.split('/').length - b.split('/').length);
      for (let index = 0; index < folderPathsToPrepare.length; index += 1) {
        const folderPath = folderPathsToPrepare[index];
        if (!ambiguousPaths.has(folderPath)) {
          await ensureLocalFolder(folderPath);
          foldersCreated += 1;
        }
        publishSyncProgress({
          phase: 'آماده‌سازی پوشه‌ها',
          percent: folderPathsToPrepare.length ? Math.round(((index + 1) / folderPathsToPrepare.length) * 10) : 10,
          currentItem: folderPath,
          foldersCreated,
        });
      }

      const digest = async (blob: Blob): Promise<string> => {
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
      };
      transferTotal = localFiles.size + [...serverFilesByPath.keys()].filter((key) => !localFiles.has(key)).length;
      const publishTransferProgress = (currentItem: string) => {
        transferCompleted += 1;
        publishSyncProgress({
          phase: 'انتقال و بررسی فایل‌ها',
          percent: 10 + Math.round((transferCompleted / Math.max(transferTotal, 1)) * 60),
          currentItem,
          downloaded,
          uploaded,
          identical,
          bytesSaved,
          failed,
          conflicts,
          oversized,
        });
      };

      for (const [relativeKey, local] of localFiles) {
        const relativePath = local.relativePath;
        try {
          if (ambiguousPaths.has(local.parentPath) || ambiguousFileKeys.has(relativeKey)) {
            conflicts += 1;
            continue;
          }
          const remoteEntry = serverFilesByPath.get(relativeKey);
          if (remoteEntry) {
            const remote = remoteEntry.file;
            if (Number(remote.size_bytes) !== local.file.size) {
              conflicts += 1;
              continue;
            }
            setProgress('مقایسهٔ محتوا: ' + relativePath);
            const remoteBlob = await getFileBlob(remote);
            if (await digest(local.file) === await digest(remoteBlob)) identical += 1;
            else conflicts += 1;
            continue;
          }
          if (local.file.size <= 0 || local.file.size > FILE_ARCHIVE_MAX_BYTES) {
            oversized += 1;
            failedItems.push(relativePath + ': فایل محلی برای آرشیو تلگرام باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
            continue;
          }
          const parent = await ensureServerFolder(local.parentPath);
          const localHash = await digest(local.file);
          const keyMaterial = [organizationId, parent.id, relativePath, local.file.size, localHash].join('|');
          const idempotencyKey = 'windows-sync:' + await digest(new Blob([keyMaterial]));
          archiveDestination ??= await getFileArchiveDestination();
          setProgress('ارسال فایل جدید به آرشیو: ' + relativePath);
          await uploadTelegramArchivedFile(local.file, {
            folderId: parent.id,
            ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
            documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
            tags: [],
            destination: archiveDestination,
            idempotencyKey,
          });
          uploaded += 1;
        } catch (reason) {
          failed += 1;
          failedItems.push(relativePath + ': ' + (reason instanceof Error ? reason.message : 'انتقال ناموفق بود.'));
        } finally {
          publishTransferProgress(relativePath);
        }
      }

      for (const [relativeKey, remoteEntry] of serverFilesByPath) {
        if (localFiles.has(relativeKey)) continue;
        const relativePath = remoteEntry.relativePath;
        const remote = remoteEntry.file;
        try {
          if (ambiguousFileKeys.has(relativeKey)) {
            conflicts += 1;
            continue;
          }
          const slash = relativePath.lastIndexOf('/');
          const parentPath = slash >= 0 ? relativePath.slice(0, slash) : '';
          const filename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
          setProgress('دریافت از آرشیو: ' + relativePath);
          const blob = await getFileBlob(remote);
          if (Number(remote.size_bytes) > 0 && blob.size !== Number(remote.size_bytes)) {
            throw new Error('حجم فایل دریافتی با اندازه ثبت‌شده در آرشیو مطابقت ندارد.');
          }
          const directory = await ensureLocalFolder(parentPath);
          const fileHandle = await directory.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          const savedFile = await fileHandle.getFile();
          if (savedFile.size !== blob.size) {
            throw new Error('تأیید ذخیره روی دیسک ناموفق بود؛ اندازه فایل نوشته‌شده صحیح نیست.');
          }
          downloaded += 1;
          bytesSaved += savedFile.size;
        } catch (reason) {
          failed += 1;
          failedItems.push(relativePath + ': ' + (reason instanceof Error ? reason.message : 'دریافت یا ذخیره فایل ناموفق بود.'));
        } finally {
          publishTransferProgress(relativePath);
        }
      }
      publishSyncProgress({
        phase: 'دریافت اطلاعات سازمانی و مالی',
        percent: 72,
        currentItem: 'خواندن اطلاعات کشتیرانی، گمرک، ثبت سفارش و حسابداری…',
        downloaded,
        uploaded,
        identical,
        bytesSaved,
        failed,
        conflicts,
        oversized,
      });
      setProgress('تجمیع اطلاعات کشتیرانی، گمرک، ثبت سفارش و حساب مالی…');
      const fetchOrgRows = async (table: string): Promise<Record<string, any>[]> => {
        const collected: Record<string, any>[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error: queryError } = await (supabase as any).from(table)
            .select('*').eq('organization_id', organizationId).range(offset, offset + 499);
          if (queryError) throw new Error('خواندن اطلاعات جدول ' + table + ' ناموفق بود: ' + queryError.message);
          const rows = (data || []) as Record<string, any>[];
          collected.push(...rows);
          if (rows.length < 500) break;
        }
        return collected;
      };
      const tableNames = [
        'clients', 'shipments', 'shipment_customs_data', 'cases', 'vessels',
        'shipping_lines', 'customs_offices', 'registration_orders',
        'customs_declarations', 'financial_transactions', 'customs_documents',
        'shipment_documents', 'customs_accounting_vouchers', 'finance_cost_categories',
        'finance_cost_items', 'finance_invoice_lines', 'finance_invoice_shipments',
        'finance_invoices', 'finance_org_settings', 'finance_payment_allocations',
        'finance_payment_request_lines', 'finance_payment_requests', 'finance_payments',
        'petty_cash_ledger',
      ];
      const tableRows = await Promise.all(tableNames.map((table) => fetchOrgRows(table)));
      const data = Object.fromEntries(tableNames.map((table, index) => [table, tableRows[index]])) as Record<string, Record<string, any>[]>;
      const byId = (rows: Record<string, any>[], id: unknown) => rows.find((row) => row.id === id) || null;

      const latestFiles: FileRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: rows, error: fileError } = await supabase
          .from('file_manager_files')
          .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
          .eq('organization_id', organizationId)
          .in('folder_id', [...folderPathById.keys()])
          .eq('is_archived', false)
          .order('created_at', { ascending: true })
          .range(offset, offset + 499);
        if (fileError) throw fileError;
        const rowsBatch = (rows || []) as FileRow[];
        latestFiles.push(...rowsBatch);
        if (rowsBatch.length < 500) break;
      }

      const exportedAt = new Date().toISOString();
      const organizationSnapshot = {
        schemaVersion: 1,
        exportedAt,
        organizationId,
        tables: data,
        fileManager: {
          folders: [...serverFolderByPath.entries()].map(([relativePath, folder]) => ({ relativePath, ...folder })),
          files: latestFiles,
        },
      };
      const organizationJson = JSON.stringify(organizationSnapshot, null, 2);
      const organizationSnapshotHandle = await localRoot.getFileHandle('اطلاعات_کامل_سازمان.json', { create: true });
      const organizationSnapshotWritable = await organizationSnapshotHandle.createWritable();
      await organizationSnapshotWritable.write(organizationJson);
      await organizationSnapshotWritable.close();
      const savedSnapshot = await organizationSnapshotHandle.getFile();
      if (savedSnapshot.size !== new TextEncoder().encode(organizationJson).byteLength) {
        throw new Error('ذخیره فایل اطلاعات کامل سازمان تأیید نشد.');
      }
      metadataWritten += 1;
      bytesSaved += savedSnapshot.size;
      publishSyncProgress({
        phase: 'ذخیره نسخه کامل اطلاعات سازمان',
        percent: 80,
        currentItem: 'اطلاعات_کامل_سازمان.json',
        metadataWritten,
        bytesSaved,
        failed,
      });

      let metadataTasksDone = 1;
      const metadataTasksTotal = 1 + serverFolderByPath.size + latestFiles.length;
      for (const [relativePath, folder] of serverFolderByPath) {
        const shipment = byId(data.shipments, folder.shipment_id);
        const caseRecord = byId(data.cases, shipment?.case_id);
        const client = byId(data.clients, folder.client_id || shipment?.client_id || caseRecord?.client_id);
        const relevantCases = data.cases.filter((row) => caseRecord ? row.id === caseRecord.id : Boolean(folder.client_id && row.client_id === folder.client_id));
        const caseIds = relevantCases.map((row) => row.id);
        const relevantShipments = data.shipments.filter((row) => shipment ? row.id === shipment.id : Boolean(folder.client_id && row.client_id === folder.client_id));
        const relevantShipmentIds = relevantShipments.map((row) => row.id);
        const declarationRows = data.customs_declarations.filter((row) =>
          (folder.shipment_id && row.shipment_id === folder.shipment_id) || (row.case_id && caseIds.includes(row.case_id)));
        const declarationIds = declarationRows.map((row) => row.id);
        const transactions = data.financial_transactions.filter((row) =>
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.source_id && (relevantShipmentIds.includes(row.source_id) || declarationIds.includes(row.source_id))));
        const relevantCostItems = data.finance_cost_items.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const costItemIds = relevantCostItems.map((row) => row.id);
        const invoiceShipmentLinks = data.finance_invoice_shipments.filter((row) => relevantShipmentIds.includes(row.shipment_id));
        const linkedInvoiceIds = invoiceShipmentLinks.map((row) => row.invoice_id);
        const invoices = data.finance_invoices.filter((row) =>
          linkedInvoiceIds.includes(row.id) || (folder.client_id && row.client_id === folder.client_id));
        const invoiceIds = invoices.map((row) => row.id);
        const invoiceLines = data.finance_invoice_lines.filter((row) =>
          invoiceIds.includes(row.invoice_id) || (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)));
        const paymentRequests = data.finance_payment_requests.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const paymentRequestIds = paymentRequests.map((row) => row.id);
        const paymentRequestLines = data.finance_payment_request_lines.filter((row) => paymentRequestIds.includes(row.request_id));
        const payments = data.finance_payments.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const paymentIds = payments.map((row) => row.id);
        const paymentAllocations = data.finance_payment_allocations.filter((row) =>
          paymentIds.includes(row.payment_id) || invoiceIds.includes(row.invoice_id));
        const accountingVouchers = data.customs_accounting_vouchers.filter((row) =>
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id) ||
          (row.declaration_id && declarationIds.includes(row.declaration_id)));
        const pettyCashEntries = data.petty_cash_ledger.filter((row) =>
          (folder.parent_id === null) || (row.related_expense_id && costItemIds.includes(row.related_expense_id)));
        const costCategoryIds = relevantCostItems.map((row) => row.category_id).filter(Boolean);
        const costCategories = data.finance_cost_categories.filter((row) =>
          folder.parent_id === null || costCategoryIds.includes(row.id));
        const organizationFinanceSettings = folder.parent_id === null ? data.finance_org_settings : [];
        const order = data.registration_orders.find((row) =>
          (shipment?.registration_order_id && row.id === shipment.registration_order_id) ||
          (caseRecord && row.case_id === caseRecord.id)) || null;
        const relatedOrders = data.registration_orders.filter((row) =>
          (order && row.id === order.id) || caseIds.includes(row.case_id) ||
          (folder.client_id && row.client_id === folder.client_id));
        const vessel = byId(data.vessels, shipment?.vessel_id);
        const shippingLine = byId(data.shipping_lines, vessel?.shipping_line_id);
        const customsOffice = byId(data.customs_offices, folder.customs_office_id || shipment?.customs_office_id || caseRecord?.customs_office_id);
        const customsData = data.shipment_customs_data.find((row) => row.shipment_id === folder.shipment_id) || null;
        const folderFileRows = latestFiles.filter((row) => row.folder_id === folder.id);
        const customsDocumentRows = data.customs_documents.filter((row) => row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const shipmentDocumentRows = data.shipment_documents.filter((row) => row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const text = buildFolderMetadataText({
          folder,
          client,
          shipment,
          customsData,
          caseRecord,
          vessel,
          shippingLine,
          customsOffice,
          registrationOrder: order,
          declarations: declarationRows,
          financialTransactions: transactions,
          documents: [
            ...folderFileRows.map((row) => row as unknown as Record<string, unknown>),
            ...customsDocumentRows,
            ...shipmentDocumentRows,
          ],
          relatedSections: [
            { title: 'پرونده‌های مرتبط صاحب کالا', records: relevantCases },
            { title: 'سایر محموله‌های مرتبط صاحب کالا', records: relevantShipments.filter((row) => row.id !== shipment?.id) },
            { title: 'سایر ثبت سفارش‌های مرتبط', records: relatedOrders.filter((row) => row.id !== order?.id) },
            { title: 'هزینه‌های مستقیم و غیرمستقیم محموله', records: relevantCostItems },
            { title: 'فاکتورهای مالی', records: invoices },
            { title: 'ردیف‌های فاکتور', records: invoiceLines },
            { title: 'ارتباط فاکتور با محموله', records: invoiceShipmentLinks },
            { title: 'پرداخت‌ها و دریافت‌ها', records: payments },
            { title: 'تخصیص پرداخت به فاکتورها', records: paymentAllocations },
            { title: 'درخواست‌های پرداخت', records: paymentRequests },
            { title: 'ردیف‌های درخواست پرداخت', records: paymentRequestLines },
            { title: 'اسناد حسابداری گمرک', records: accountingVouchers },
            { title: 'تنخواه و صندوق', records: pettyCashEntries },
            { title: 'دسته‌بندی هزینه‌ها', records: costCategories },
            { title: 'تنظیمات مالی و اطلاعات بانکی سازمان', records: organizationFinanceSettings },
          ],
          generatedAt: new Date().toISOString(),
        });
        const directory = await ensureLocalFolder(relativePath);
        const infoHandle = await directory.getFileHandle('اطلاعات_عملیاتی.txt', { create: true });
        const infoWritable = await infoHandle.createWritable();
        await infoWritable.write(text);
        await infoWritable.close();
        const savedInfo = await infoHandle.getFile();
        if (savedInfo.size !== new TextEncoder().encode(text).byteLength) {
          throw new Error('ذخیره اطلاعات پوشه «' + folder.display_name + '» تأیید نشد.');
        }
        metadataWritten += 1;
        bytesSaved += savedInfo.size;
        metadataTasksDone += 1;
        publishSyncProgress({
          phase: 'ذخیره اطلاعات پرونده‌ها و محموله‌ها',
          percent: 80 + Math.round((metadataTasksDone / metadataTasksTotal) * 20),
          currentItem: relativePath || 'ریشه سازمان',
          metadataWritten,
          bytesSaved,
          failed,
        });

        for (const file of folderFileRows) {
          const fileName = windowsName(file.original_name || 'document');
          const companionName = windowsName(fileName + '.اطلاعات.txt');
          const companionText = buildDocumentMetadataText(file as unknown as Record<string, unknown>, text);
          const companionHandle = await directory.getFileHandle(companionName, { create: true });
          const companionWritable = await companionHandle.createWritable();
          await companionWritable.write(companionText);
          await companionWritable.close();
          const savedCompanion = await companionHandle.getFile();
          if (savedCompanion.size !== new TextEncoder().encode(companionText).byteLength) {
            throw new Error('ذخیره فراداده سند «' + fileName + '» تأیید نشد.');
          }
          metadataWritten += 1;
          bytesSaved += savedCompanion.size;
          metadataTasksDone += 1;
          publishSyncProgress({
            phase: 'ذخیره اطلاعات اسناد',
            percent: 80 + Math.round((metadataTasksDone / metadataTasksTotal) * 20),
            currentItem: relativePath ? relativePath + '/' + companionName : companionName,
            metadataWritten,
            bytesSaved,
            failed,
          });
        }
      }

      setProgress('ثبت نتیجه و تازه‌سازی فهرست فایل‌ها…');
      await loadFolders();
      await loadFiles(selectedFolderId);
      const parts = [
        'همگام‌سازی سازمان به پایان رسید.',
        uploaded + ' فایل از ویندوز به آرشیو ارسال شد',
        downloaded + ' فایل از آرشیو روی دیسک ذخیره و تأیید شد',
        identical + ' فایل بدون تغییر بود',
        conflicts + ' تعارض برای بررسی دستی حفظ شد',
        foldersCreated + ' پوشه آماده شد',
        metadataWritten + ' فایل اطلاعاتی/فراداده ذخیره شد',
        latestFiles.length + ' سند در فهرست آرشیو بررسی شد',
        'حجم کل نوشته‌شده روی دیسک: ' + byteLabel(bytesSaved),
      ];
      if (oversized) parts.push(oversized + ' فایل محلی به علت محدودیت ۲۰ مگابایت برای آپلود تلگرام ارسال نشد');
      if (failed) parts.push(failed + ' فایل با خطا مواجه شد');
      parts.push('هیچ سند اصلی حذف یا بازنویسی نشد؛ اسناد اصلی بدون اجازه تغییر نمی‌کنند.');
      setMessage(parts.join('؛ '));
      if (failed) {
        setError('همگام‌سازی کامل نیست؛ ' + failed + ' مورد ذخیره نشد. ' + failedItems.slice(0, 4).join(' | '));
      }
      publishSyncProgress({
        phase: failed ? 'پایان با موارد ناموفق' : 'همگام‌سازی کامل شد',
        percent: 100,
        currentItem: failed ? failedItems.slice(0, 2).join(' | ') : 'تمام فایل‌ها و اطلاعات قابل دسترس بررسی و ذخیره شدند.',
        foldersCreated,
        downloaded,
        uploaded,
        identical,
        metadataWritten,
        bytesSaved,
        failed,
        conflicts,
        oversized,
      });
    } catch (reason) {
      const failureMessage = reason instanceof Error ? reason.message : 'همگام‌سازی کامل سازمان ناموفق بود.';
      setError(failureMessage);
      publishSyncProgress({
        phase: 'همگام‌سازی متوقف شد',
        currentItem: failureMessage,
        downloaded,
        uploaded,
        identical,
        metadataWritten,
        bytesSaved,
        failed: failed + 1,
        conflicts,
        oversized,
      });
      if (uploaded || downloaded) setMessage('تا پیش از خطا: ' + uploaded + ' فایل ارسال و ' + downloaded + ' فایل دریافت شد. اجرای بعدی می‌تواند ادامه دهد.');
    } finally {
      setSyncing(false);
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

  const toggleFolderExpansion=(id:string)=>setExpandedFolders(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const renderFolderNode=(folder:FolderRow,depth=0):React.ReactNode=>{
    const children=folderChildrenByParent.get(folder.id)||[],expanded=expandedFolders.has(folder.id),count=folderDescendantCounts[folder.id]||0,selected=selectedFolderId===folder.id;
    return <div key={folder.id} className="select-none">
      <div className={'flex items-start gap-1 rounded-lg '+(selected?'bg-[var(--primary)]/10':'hover:bg-[var(--surface-2)]')} style={{paddingInlineStart:Math.min(depth,4)*8}}>
        <button type="button" onClick={()=>toggleFolderExpansion(folder.id)} disabled={!children.length} aria-expanded={expanded} aria-label={expanded?'بستن زیرپوشه‌ها':'بازکردن زیرپوشه‌ها'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md app-muted disabled:opacity-20">{children.length?(expanded?<ChevronDown size={14}/>:<ChevronLeft size={14}/>):<span className="h-1 w-1 rounded-full bg-[var(--border)]"/>}</button>
        <button type="button" onClick={()=>chooseFolder(folder)} title={folder.display_name} className={'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-right text-sm '+(selected?'font-bold text-[var(--primary)]':'')}>
          <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border '+folderToneClass(folder.folder_type)}>{count>0?<FolderOpen size={16}/>:<Folder size={16}/>}</span>
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{folder.display_name}</span>{count>0&&<span className="mt-0.5 shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px]">{count}</span>}
        </button>
      </div>
      {expanded&&children.map(child=>renderFolderNode(child,depth+1))}
    </div>;
  };
  const uploadEnabled = Boolean(currentFolder && (currentFolder.shipment_id || (currentFolder.client_id && ['client', 'custom'].includes(currentFolder.folder_type))));
  const directoryProps = { webkitdirectory: '', directory: '' } as any;

  return <main dir="rtl" className="mobile-app-page file-manager-page min-h-screen px-3 py-3 sm:p-4 md:p-6" style={{ color: 'var(--text)' }}>
    <div className="mx-auto max-w-7xl space-y-3 sm:space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--primary)]/10 p-3 text-[var(--primary)]"><FolderOpen size={24} /></div>
          <div>
            <div className="hidden text-xs app-muted sm:block">CUSTOMS OS · DOCUMENTS</div>
            <h1 className="text-xl sm:text-2xl font-black">فایل‌منیجر اسناد و مدارک</h1>
          </div>
        </div>
        <div className="file-manager-page-actions flex flex-wrap gap-2">
          <Link to="/operations" className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm"><ArrowRight size={15} className="ml-1 inline" />عملیات</Link>
          <Link to="/settings/messengers" className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm">تنظیم آرشیو</Link>
          <button type="button" onClick={() => { void loadFolders(); if (selectedFolderId) void loadFiles(selectedFolderId); }} disabled={loading} className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm disabled:opacity-50"><RefreshCw size={15} className="ml-1 inline" />تازه‌سازی</button>
        </div>
      </header>

      <section className="file-manager-archive-status flex flex-wrap items-center justify-between gap-2 rounded-2xl border app-border bg-[var(--surface)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><MessageCircle size={18}/></span>
          <div className="min-w-0">
            <div className="text-sm font-bold">آرشیو تلگرام: {archiveDestinationStatus==='checking'?'در حال بررسی…':archiveDestination?.displayName||'در دسترس نیست'}</div>
          </div>
        </div>
        {['owner','admin'].includes(role)&&<Link to="/settings/messengers" className="shrink-0 rounded-lg border app-border px-3 py-2 text-xs">تنظیم مقصد</Link>}
        {archiveDestinationStatus==='unavailable'&&<span className="text-xs text-amber-600">مقصد فعال پیدا نشد</span>}
      </section>
      <details className="file-manager-archive-help text-xs app-muted"><summary>دربارهٔ اسناد قدیمی</summary><p>اسناد قدیمی به‌صورت خودکار به تلگرام منتقل نمی‌شوند. فایل‌های جدیدی که از مسیر آرشیو آپلود شوند در گفت‌وگوی تلگرام ثبت می‌شوند.</p></details>

<section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-[var(--surface)] to-cyan-500/5 p-4 shadow-sm sm:p-5">
          <div className="pointer-events-none absolute -left-8 -top-8 h-36 w-36 rounded-full bg-sky-500/10 blur-2xl"/>
          <div className="relative flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10 text-sky-600"><HardDrive size={24}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold tracking-wide text-sky-700 dark:text-sky-300">ONE-CLICK COMPANY SYNC</div>
              <h2 className="mt-1 text-base font-black sm:text-lg">همگام‌سازی کامل فایل‌منیجر</h2>
              <p className="mt-1 text-xs leading-6 app-muted">همه صاحبان کالا، محموله‌ها، زیرپوشه‌ها، اسناد، اطلاعات کشتیرانی، گمرک، ثبت سفارش و حساب مالی در یک پوشه ذخیره می‌شوند.</p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2 rounded-xl border app-border bg-[var(--surface)]/80 p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><ShieldCheck size={17}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] app-muted">محل ذخیره متصل</div>
              <div className="truncate text-xs font-bold">{syncDirectoryName ? syncDirectoryName + ' / Darbandi Commercial' : (typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker !== 'function') ? 'روش سازگار مرورگر: انتخاب پوشه یا ZIP و ذخیره در Files' : 'هنوز انتخاب نشده؛ بار اول یک پوشه انتخاب می‌کنید'}</div>
            </div>
            {syncDirectoryName && <button type="button" onClick={()=>void forgetSyncDirectory()} className="shrink-0 rounded-lg border app-border px-2.5 py-2 text-[10px]">قطع اتصال</button>}
          </div>
          <div className="relative mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={()=>void syncWindowsFolder()} disabled={syncing||uploading||loading}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white shadow-lg shadow-sky-900/10 transition hover:brightness-110 disabled:opacity-50">
              {syncing?<Loader2 size={17} className="animate-spin"/>:<RefreshCw size={17}/>}
              {syncing?'در حال همگام‌سازی همه داده‌ها…':syncDirectoryName?'همگام‌سازی همه اطلاعات با یک کلیک':'انتخاب پوشه و شروع همگام‌سازی'}
            </button>
            <button type="button" onClick={()=>void chooseSyncDirectory()} disabled={syncing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">
              <FolderOpen size={15}/>تغییر محل ذخیره
            </button>
          </div>
          <p className="relative mt-2 text-[10px] leading-5 app-muted">فایل‌های اصلی حذف یا بی‌اجازه بازنویسی نمی‌شوند؛ تغییرات متعارض جداگانه گزارش می‌شوند. در مرورگرهای فاقد دسترسی مستقیم پوشه، از روش ZIP/Files استفاده می‌شود.</p>
          {portableSyncOpen && <div className="relative mt-3 space-y-3 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
            <div>
              <div className="text-sm font-black">همگام‌سازی سازگار با Safari، Firefox و موبایل</div>
              <p className="mt-1 text-xs leading-5 app-muted">برای ارسال تغییرات دستگاه، پوشه «Darbandi Commercial» یا فایل ZIP قبلی را انتخاب کنید. بعد از بررسی و ارسال فایل‌های جدید، یک ZIP تازه از کل آرشیو و اطلاعات سازمان ساخته می‌شود تا آن را در Files ذخیره کنید.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={()=>portableDirectoryInput.current?.click()} disabled={syncing||uploading}
                className="flex min-h-10 items-center justify-center gap-2 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">
                <FolderOpen size={15}/>انتخاب پوشه از دستگاه
              </button>
              <button type="button" onClick={()=>portableArchiveInput.current?.click()} disabled={syncing||uploading}
                className="flex min-h-10 items-center justify-center gap-2 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">
                <Upload size={15}/>وارد کردن ZIP قبلی
              </button>
              <button type="button" onClick={()=>void exportPortableSyncArchive()} disabled={syncing||uploading||loading}
                className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-black text-white disabled:opacity-50 sm:col-span-2">
                <Download size={15}/>دریافت ZIP کامل سازمان برای Files
              </button>
            </div>
            <input ref={portableDirectoryInput} {...directoryProps} type="file" multiple className="hidden" disabled={syncing||uploading}
              onChange={event=>{
                const picked=Array.from(event.currentTarget.files||[]);
                if(picked.length) void importPortableSyncEntries(picked.map(file=>({file,relativePath:(file as File & {webkitRelativePath?:string}).webkitRelativePath||file.name})));
                event.currentTarget.value='';
              }}/>
            <input ref={portableArchiveInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" disabled={syncing||uploading}
              onChange={event=>{
                const picked=event.currentTarget.files?.[0];
                if(picked) void importPortableZip(picked);
                event.currentTarget.value='';
              }}/>
            <div className="text-[10px] leading-5 app-muted">در Safari آیفون، انتخاب پوشه در iOS 18.4 به بعد موجود است. در نسخه‌های قدیمی‌تر، ZIP را از Files انتخاب کنید. مرورگر اجازه نمی‌دهد وب‌سایت بی‌واسطه فایل‌ها را در هر پوشه دلخواه بازنویسی کند.</div>
          </div>}
        </div>

        <div className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600"><Smartphone size={24}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold tracking-wide text-emerald-700 dark:text-emerald-300">APPLE FILES · SMB</div>
              <h2 className="mt-1 text-base font-black">اتصال آیفون به پوشه شرکت</h2>
              <p className="mt-1 text-xs leading-6 app-muted">یک‌بار اشتراک‌گذاری امن SMB را روی ویندوز فعال کنید؛ سپس آیفون با IP کامپیوتر و حساب اختصاصی وارد پوشه می‌شود.</p>
            </div>
          </div>
          <a href="/setup-iphone-files-share.ps1" download="Darbandi-Commercial-iPhone-SMB.ps1"
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <Download size={15}/>دانلود راه‌انداز امن ویندوز (PowerShell)
          </a>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-bold">IP کامپیوتر شرکت</span>
            <div className="flex gap-2">
              <input value={smbAddress} onChange={event=>setSmbAddress(event.target.value)} placeholder="مثلاً 192.168.1.20" inputMode="decimal" dir="ltr"
                className="min-w-0 flex-1 rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"/>
              <button type="button" onClick={()=>void copySmbAddress()} disabled={!smbAddress.trim()}
                className="shrink-0 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">کپی آدرس</button>
            </div>
          </label>
          <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 text-[11px] leading-6">
            <div className="font-bold">مراحل اتصال در آیفون</div>
            <ol className="mr-4 mt-1 list-decimal space-y-0.5 app-muted">
              <li>اسکریپت دانلودشده را در ویندوز با Run as administrator اجرا کنید.</li>
              <li>در Files آیفون: Browse ← سه‌نقطه ← Connect to Server.</li>
              <li>آدرس smb://IP را وارد و Registered User را انتخاب کنید.</li>
              <li>نام کاربری COMPUTERNAME\DarbandiFiles و رمز ساخته‌شده را وارد کنید.</li>
            </ol>
          </div>
          <div className="mt-2 flex items-start gap-2 text-[10px] leading-5 text-amber-700 dark:text-amber-300">
            <ShieldCheck size={14} className="mt-0.5 shrink-0"/>
            <span>فقط شبکه داخلی یا VPN امن؛ پورت 445 را روی مودم به اینترنت باز نکنید. آیفون و ویندوز باید به یک شبکه دسترسی داشته باشند.</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border app-border bg-[var(--surface)] p-3">
        <label className="relative block">
          <Search size={18} className="absolute right-3 top-3.5 app-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی صاحب کالا، محموله یا سند…" className="w-full rounded-xl border app-border bg-[var(--surface-2)] py-3 pr-10 pl-3 outline-none focus:border-[var(--primary)]" />
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
      {syncProgress && <section className="rounded-xl border app-border bg-[var(--surface)] p-3 sm:p-4" aria-label="پیشرفت همگام‌سازی">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black">{syncProgress.phase}</div>
            <div className="mt-1 break-all text-[10px] app-muted">{syncProgress.currentItem}</div>
          </div>
          <div className="shrink-0 text-xl font-black tabular-nums">{syncProgress.percent}٪</div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress.percent} aria-label="درصد پیشرفت ذخیره‌سازی">
          <div className="h-full rounded-full bg-[var(--primary)] transition-all duration-300" style={{ width: syncProgress.percent + '%' }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.foldersCreated}</b><div className="app-muted">پوشه آماده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.downloaded}</b><div className="app-muted">فایل ذخیره‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.uploaded}</b><div className="app-muted">فایل ارسال‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.metadataWritten}</b><div className="app-muted">فایل اطلاعاتی</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{byteLabel(syncProgress.bytesSaved)}</b><div className="app-muted">حجم ذخیره‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b className={syncProgress.failed ? 'text-red-500' : ''}>{syncProgress.failed}</b><div className="app-muted">ناموفق</div></div>
        </div>
      </section>}

      <section className="grid items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
        {treeOpen&&<button type="button" aria-label="بستن فهرست پوشه‌ها" onClick={()=>setTreeOpen(false)} className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden" />}
        <aside className={(treeOpen?'fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex flex-col overflow-hidden':'hidden')+' rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl lg:static lg:z-auto lg:flex lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:shadow-none'}>
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1"><h2 className="font-black">پوشه‌ها</h2><div className="flex items-center gap-2"><span className="text-xs app-muted">{folders.length} پوشه</span><button type="button" onClick={()=>setTreeOpen(false)} className="rounded-lg border app-border p-2 lg:hidden" aria-label="بستن فهرست"><X size={16}/></button></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-0.5 lg:flex-none lg:overflow-visible">{folders.filter(folder=>folder.parent_id===null).map(root=>renderFolderNode(root))}
            {!folders.length&&<div className="p-5 text-center text-sm app-muted">ساختار پوشه هنوز بارگذاری نشده است.</div>}
          </div>
          
        </aside>
        <section className="flex min-w-0 min-h-[60dvh] max-h-none flex-col overflow-visible rounded-2xl border app-border bg-[var(--surface)] lg:max-h-[calc(100dvh-15rem)] lg:min-h-[380px] lg:overflow-hidden">
          <div className="shrink-0 border-b app-border p-3 md:p-4">
            <div className="mb-3 flex min-w-0 items-center gap-2">
              <button type="button" onClick={()=>setTreeOpen(v=>!v)} className="shrink-0 rounded-lg border app-border px-2.5 py-2 text-xs lg:hidden">{treeOpen?'بستن فهرست':'فهرست پوشه‌ها'}</button>
              <nav aria-label="مسیر پوشه" className="file-manager-breadcrumbs flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-xl border app-border bg-[var(--surface-2)] px-2.5 py-2 text-xs">
                <FolderOpen size={14} className="shrink-0 text-[var(--primary)]"/>
                {breadcrumbs.length === 0 && <span className="min-w-0 truncate font-semibold">فایل‌منیجر</span>}
                {breadcrumbs.map((crumb,i)=><React.Fragment key={crumb.id}>
                  {i>0&&<ChevronLeft size={13} className="shrink-0 app-muted"/>}
                  <button type="button" onClick={()=>chooseFolder(crumb)} title={crumb.display_name}
                    className={i===breadcrumbs.length-1?'min-w-0 flex-1 truncate rounded-lg bg-[var(--primary)]/10 px-2 py-1 font-bold text-[var(--primary)]':'max-w-24 shrink truncate rounded-md px-1 py-1 hover:bg-[var(--surface)] hover:text-[var(--primary)]'}>
                    {crumb.display_name}
                  </button>
                </React.Fragment>)}
              </nav>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1"><h2 className="truncate text-base sm:text-lg font-black">{currentFolder?.display_name||'فایل‌منیجر'}</h2></div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={()=>setUploadPanelOpen(v=>!v)} disabled={!currentFolder} title={uploadEnabled?'آپلود و آرشیو در تلگرام':'برای مشاهدهٔ علت محدودیت، پنل آپلود را باز کنید و پوشهٔ صاحب کالا یا محموله را انتخاب کنید'} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><UploadCloud size={14} className="ml-1 inline"/>{uploadPanelOpen?'بستن آپلود':'آپلود فایل'}</button>
                {currentFolder&&isCopyableFolder(currentFolder)&&<button type="button" onClick={()=>beginCopyFolder(currentFolder)} disabled={!folderCopyAvailable||copyingFolder} title={folderCopyAvailable?'کپی پوشه همراه با زیرپوشه‌ها':'برای کپی کامل، migration دیتابیس لازم است'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40"><Copy size={14} className="ml-1 inline"/>کپی</button>}
                {clipboardFolderId&&<button type="button" onClick={()=>void pasteCopiedFolder()} disabled={!folderCopyAvailable||copyingFolder||!currentFolder||currentFolder.folder_type==='root'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40">{copyingFolder?<Loader2 size={14} className="ml-1 inline animate-spin"/>:<ClipboardPaste size={14} className="ml-1 inline"/>}چسباندن</button>}
                {uploadEnabled&&roleCanModifyStructure(role)&&<form onSubmit={e=>{e.preventDefault();void createFolder();}} className="flex gap-1"><input value={folderName} onChange={e=>setFolderName(e.target.value)} placeholder="نام زیرپوشه" aria-label="نام زیرپوشه جدید" className="w-28 rounded-lg border app-border bg-[var(--surface-2)] px-2 py-2 text-xs"/><button type="submit" disabled={creatingFolder||!folderName.trim()} className="rounded-lg border app-border px-2.5 py-2 text-xs disabled:opacity-50">{creatingFolder?<Loader2 size={14} className="animate-spin"/>:'ساخت پوشه'}</button></form>}
              </div>
            </div>
          </div>
          {currentFolder&&uploadPanelOpen&&<div className="max-h-none shrink-0 border-b app-border p-3 md:p-4 lg:max-h-none lg:overflow-visible">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white"><UploadCloud size={16}/>انتخاب فایل<input type="file" multiple className="hidden" disabled={!uploadEnabled||uploading||syncing} onChange={e=>{const picked=Array.from(e.target.files||[]);if(picked.length){setPendingFiles(old=>[...old,...picked]);setUploadPanelOpen(true);setMessage(`${picked.length} فایل انتخاب شد؛ برای شروع، دکمه «ارسال به آرشیو تلگرام» را بزنید.`);setError('');}e.currentTarget.value='';}}/></label>
              <button type="button" onClick={()=>directoryInput.current?.click()} disabled={!uploadEnabled||uploading} className="flex items-center gap-2 rounded-xl border app-border px-4 py-2.5 text-sm disabled:opacity-40"><FolderOpen size={16}/>انتخاب پوشه ویندوز</button>
              <input ref={directoryInput} {...directoryProps} type="file" multiple className="hidden" disabled={!uploadEnabled||uploading} onChange={e=>{const picked=Array.from(e.target.files||[]);if(picked.length){setPendingFiles(old=>[...old,...picked]);setUploadPanelOpen(true);setMessage(`${picked.length} فایل از پوشه انتخاب شد؛ برای شروع، دکمه «ارسال به آرشیو تلگرام» را بزنید.`);setError('');}e.currentTarget.value='';}}/>
              <span className="text-xs app-muted">حداکثر ۲۰ مگابایت برای بازیابی از Bot API فعلی تلگرام.</span>
            </div>
            <label className="mt-3 block"><span className="mb-1 block text-xs font-bold app-muted">برچسب‌ها</span><input value={tagInput} onChange={e=>setTagInput(e.target.value)} disabled={uploading} placeholder="فاکتور، قبض انبار، بیمه…" className="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2 text-sm"/></label>
            {pendingFiles.length>0&&<div className="mt-3 rounded-xl border app-border bg-[var(--surface-2)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{pendingFiles.length} فایل در صف</b><button type="button" onClick={()=>setPendingFiles([])} disabled={uploading} className="text-xs app-muted underline">پاک‌کردن صف</button></div><div className="mt-2 max-h-28 space-y-1 overflow-auto">{pendingFiles.slice(0,40).map((file,index)=><div key={file.name+file.size+file.lastModified+index} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{(file as File&{webkitRelativePath?:string}).webkitRelativePath||file.name}</span><span className="shrink-0 app-muted">{byteLabel(file.size)}</span></div>)}{pendingFiles.length>40&&<div className="text-xs app-muted">و {pendingFiles.length-40} فایل دیگر…</div>}</div><button type="button" onClick={()=>void archiveFiles()} disabled={uploading} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{uploading?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>}ارسال به آرشیو تلگرام و ثبت فراداده</button></div>}
            {!uploadEnabled&&<p className="mt-2 text-xs app-muted">برای آپلود، پوشه صاحب کالا یا محموله را انتخاب کنید.</p>}
          </div>}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b app-border bg-[var(--surface-2)] px-3 py-2.5 text-xs"><b className="min-w-0 truncate">{currentFolder?.display_name || 'فایل‌منیجر'} <span className="font-normal app-muted">· {files.length} سند</span></b><span className="shrink-0 rounded-full border app-border px-2 py-1">{childFolders.length} زیرپوشه</span></div>
          <div className="min-h-0 flex-none overflow-visible p-3 md:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {childFolders.length>0&&<div className="mb-4"><div className="mb-2"><h3 className="text-xs font-bold app-muted">پوشه‌ها</h3></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{childFolders.map(folder=>{const count=folderDescendantCounts[folder.id]||0;return <div key={folder.id} className="flex min-w-0 items-stretch gap-1 rounded-xl border app-border p-1.5 hover:bg-[var(--surface-2)]"><button type="button" onClick={()=>chooseFolder(folder)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-right"><span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border '+folderToneClass(folder.folder_type)}>{count>0?<FolderOpen size={24}/>:<Folder size={24}/>}</span><span className="min-w-0 flex-1"><span className="block whitespace-normal break-words text-sm font-bold leading-5">{folder.display_name}</span><span className="mt-1 block text-[10px] app-muted">{folder.folder_type==='accounting_finance'?'حسابداری مالی':folder.is_system?'پوشه پیش‌فرض':'پوشه سفارشی'}</span><span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] '+(count>0?'bg-emerald-500/10 text-emerald-600':'bg-[var(--surface-2)] app-muted')}>{count>0?count+' سند فعال':'خالی'}</span></span></button>{isCopyableFolder(folder)&&<button type="button" onClick={()=>beginCopyFolder(folder)} disabled={!folderCopyAvailable} aria-label={'کپی پوشه '+folder.display_name} className="self-center rounded-lg border app-border p-2 disabled:opacity-35"><Copy size={15}/></button>}</div>;})}</div></div>}
            {files.length>0&&<div className="overflow-hidden rounded-xl border app-border"><div className="hidden grid-cols-[minmax(0,1fr)_94px_118px_210px] items-center gap-2 bg-[var(--surface-2)] px-3 py-2 text-[10px] font-bold app-muted sm:grid"><span>نام و اطلاعات سند</span><span>حجم</span><span>تاریخ</span><span className="text-left">عملیات</span></div>{files.map(file=>{const isTelegram=Boolean(file.file_asset_id || file.metadata?.copyAliasFileAssetId);const displayName=typeof file.metadata?.documentName==='string'?file.metadata.documentName:file.original_name;const tags=Array.isArray(file.tags)?file.tags.slice(0,6):[];return <div key={file.id} className="grid gap-2 border-t app-border px-3 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_94px_118px_210px] sm:items-center sm:gap-2"><div className="flex min-w-0 items-start gap-3"><FileText size={20} className={isTelegram?'mt-0.5 shrink-0 text-emerald-600':'mt-0.5 shrink-0 text-[var(--primary)]'}/><div className="min-w-0"><div className="break-words text-sm font-bold">{displayName}</div>{displayName!==file.original_name&&<div className="mt-0.5 break-words text-[10px] app-muted">نام اصلی: {file.original_name}</div>}{tags.length>0&&<div className="mt-1 flex flex-wrap gap-1">{tags.map(tag=><span key={tag} className="rounded-full border app-border px-2 py-0.5 text-[10px] app-muted">{tag}</span>)}</div>}<div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] app-muted"><span className={isTelegram?'text-emerald-600':'text-amber-600'}>{isTelegram?'آرشیو تلگرام':'بایگانی قبلی وب‌سایت'}</span><span>·</span><span>{file.mime_type||'نوع نامشخص'}</span></div></div></div><span className="text-xs app-muted">{byteLabel(file.size_bytes)}</span><span className="text-xs app-muted">{new Date(file.created_at).toLocaleDateString('fa-IR')}</span><div className="flex flex-wrap items-center gap-1 sm:justify-end"><button type="button" onClick={()=>void previewDocument(file)} disabled={!(file.mime_type||'').startsWith('image/')&&file.mime_type!=='application/pdf'&&file.mime_type!=='text/plain'} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="نمایش"><Eye size={13}/>نمایش</button><button type="button" onClick={()=>void copyFileNameForTelegram(displayName)} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="کپی نام برای جست‌وجو در تلگرام"><Copy size={13}/>نام</button><button type="button" onClick={()=>void transferFileFromManager(file,'pdf-studio')} disabled={!((file.mime_type||'').toLowerCase()==='application/pdf'||(file.mime_type||'').toLowerCase()==='image/jpeg'||(file.mime_type||'').toLowerCase()==='image/png'||/\.(pdf|png|jpe?g)$/i.test(file.original_name))} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="بازکردن در PDF Studio"><FileText size={13}/>PDF</button><button type="button" onClick={()=>void transferFileFromManager(file,'chat')} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="انتقال به چت"><MessageCircle size={13}/>چت</button><button type="button" onClick={()=>void downloadFile(file)} className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-xs font-bold text-white" title="دانلود"><Download size={13}/>دانلود</button></div></div>;})}</div>}
            {childFolders.length===0&&files.length===0&&<div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed app-border p-6 text-center"><FolderOpen size={30} className="mb-2 text-[var(--primary)]"/><b className="text-sm">این پوشه خالی است</b><p className="mt-1 text-xs app-muted">از «آپلود فایل» برای ثبت سند استفاده کنید.</p></div>}
          </div>
        </section>
      </section>
      <p className="text-xs app-muted">همگام‌سازی کامل سازمان با یک کلیک و پس از انتخاب یک‌باره پوشه ذخیره انجام می‌شود. کنار هر سند فایل متنی اطلاعات عملیاتی و مالی ساخته می‌شود؛ اسناد اصلی بدون اجازه حذف یا بازنویسی نمی‌شوند.</p>
      {preview&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={'پیش‌نمایش '+preview.name}><section className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border app-border bg-[var(--surface)] shadow-2xl"><header className="flex shrink-0 items-center justify-between gap-3 border-b app-border px-4 py-3"><b className="min-w-0 truncate text-sm">{preview.name}</b><button type="button" onClick={()=>setPreview(null)} className="rounded-lg border app-border p-2" aria-label="بستن پیش‌نمایش"><X size={17}/></button></header><div className="min-h-0 flex-1 overflow-auto p-2">{preview.mime.startsWith('image/')?<img src={preview.url} alt={preview.name} className="mx-auto max-h-[82dvh] max-w-full object-contain"/>:preview.mime==='application/pdf'?<iframe src={preview.url} title={preview.name} className="h-[82dvh] w-full rounded-lg bg-white"/>:<iframe src={preview.url} title={preview.name} sandbox="" className="h-[82dvh] w-full rounded-lg bg-white"/>}</div></section></div>}
    </div>
  </main>;
};

export default FileManagerPage;
) || isManagedSyncMetadataFile(safeParts[safeParts.length - 1]) ||
      safeParts.includes('__MACOSX')
    ) return '';
    return safeParts.join('/');
  };

  const importPortableSyncEntries = async (inputs: Array<{ file: File; relativePath: string }>) => {
    if (!organizationId || !roleCanModifyStructure(role)) {
      setError('برای وارد کردن نسخه پشتیبان سازمان، دسترسی فایل‌منیجر لازم است.');
      return;
    }
    setSyncing(true);
    setPortableSyncOpen(true);
    setError('');
    setMessage('');
    setProgress('بررسی فایل‌های انتخاب‌شده و ساختار محموله‌ها…');
    let uploaded = 0;
    let identical = 0;
    let conflicts = 0;
    let oversized = 0;
    let failed = 0;
    let foldersCreated = 0;
    let transferDone = 0;
    const failures: string[] = [];
    const publish = (phase: string, percent: number, currentItem: string) => {
      setSyncProgress({
        percent, phase, currentItem, foldersCreated, downloaded: 0, uploaded,
        identical, metadataWritten: 0, bytesSaved: 0, failed, conflicts, oversized,
      });
    };

    try {
      const tree = await fetchPortableFolderTree();
      const normalized = inputs
        .map((item) => ({
          file: item.file,
          relativePath: normalizePortableFolderPath(item.relativePath || item.file.name, tree.cloudRoot.display_name),
        }))
        .filter((item) => item.relativePath);
      if (!normalized.length) throw new Error('در پوشه یا ZIP انتخاب‌شده، سند اصلی قابل واردکردن پیدا نشد.');
      const localPathCounts = new Map<string, number>();
      for (const item of normalized) {
        const key = item.relativePath.normalize('NFKC').toLocaleLowerCase('en-US');
        localPathCounts.set(key, (localPathCounts.get(key) || 0) + 1);
      }
      const folderIds = [...tree.folderPathById.keys()];
      const existingFiles = await fetchPortableFileRows(folderIds);
      const serverFilesByPath = new Map<string, FileRow>();
      for (const file of existingFiles) {
        const parentPath = tree.folderPathById.get(file.folder_id);
        if (parentPath === undefined) continue;
        const keyPath = (parentPath ? parentPath + '/' : '') + windowsName(file.original_name);
        serverFilesByPath.set(keyPath.normalize('NFKC').toLocaleLowerCase('en-US'), file);
      }

      const ensureRemoteFolder = async (relativePath: string): Promise<FolderRow> => {
        const existing = tree.folderByPath.get(relativePath);
        if (existing) return existing;
        const parts = relativePath.split('/').filter(Boolean);
        if (!parts.length) return tree.cloudRoot;
        const parentPath = parts.slice(0, -1).join('/');
        const parent = await ensureRemoteFolder(parentPath);
        const segment = parts[parts.length - 1];
        const matching = folders.find((folder) =>
          folder.parent_id === parent.id && windowsName(folder.display_name) === segment);
        const folder = matching || await getOrCreateSubfolder(parent, segment);
        tree.folderByPath.set(relativePath, folder);
        tree.folderPathById.set(folder.id, relativePath);
        foldersCreated += matching ? 0 : 1;
        return folder;
      };

      const digest = async (blob: Blob): Promise<string> => {
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
      };
      const destination = await getFileArchiveDestination();
      for (let index = 0; index < normalized.length; index += 1) {
        const item = normalized[index];
        const relativePath = item.relativePath;
        const key = relativePath.normalize('NFKC').toLocaleLowerCase('en-US');
        const slash = relativePath.lastIndexOf('/');
        const parentPath = slash >= 0 ? relativePath.slice(0, slash) : '';
        const filename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
        transferDone += 1;
        publish('مقایسه و ارسال اسناد از دستگاه', 5 + Math.round((transferDone / normalized.length) * 65), relativePath);

        try {
          if (localPathCounts.get(key) !== 1) {
            conflicts += 1;
            continue;
          }
          const remote = serverFilesByPath.get(key);
          if (remote) {
            if (Number(remote.size_bytes) !== item.file.size) {
              conflicts += 1;
              continue;
            }
            const [localHash, remoteBlob] = await Promise.all([digest(item.file), getFileBlob(remote)]);
            if (localHash === await digest(remoteBlob)) identical += 1;
            else conflicts += 1;
            continue;
          }
          if (item.file.size <= 0 || item.file.size > FILE_ARCHIVE_MAX_BYTES) {
            oversized += 1;
            failures.push(relativePath + ': حجم فایل برای آرشیو تلگرام باید حداکثر ۲۰ مگابایت باشد.');
            continue;
          }
          const parent = await ensureRemoteFolder(parentPath);
          const uploadFile = item.file.name === filename ? item.file : new File([item.file], filename, {
            type: item.file.type || portableMimeType(filename),
            lastModified: item.file.lastModified,
          });
          const idempotencyKey = await createTelegramArchiveIdempotencyKey(uploadFile, {
            folderId: parent.id,
            ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
            documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
            documentName: filename,
            destination,
          });
          await uploadTelegramArchivedFile(uploadFile, {
            folderId: parent.id,
            ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
            documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
            tags: [],
            destination,
            idempotencyKey,
          });
          uploaded += 1;
        } catch (reason) {
          failed += 1;
          failures.push(relativePath + ': ' + (reason instanceof Error ? reason.message : 'ارسال فایل ناموفق بود.'));
        } finally {
          publish('مقایسه و ارسال اسناد از دستگاه', 5 + Math.round((transferDone / normalized.length) * 65), relativePath);
        }
      }

      await loadFolders();
      publish('به‌روزرسانی نسخه کامل از آرشیو', 72, 'آماده‌سازی بسته خروجی ZIP…');
      const exported = await exportPortableSyncArchive(false);
      const summary = [
        'همگام‌سازی سازگار با این مرورگر انجام شد.',
        uploaded + ' فایل جدید به آرشیو ارسال شد',
        identical + ' فایل از قبل یکسان بود',
        conflicts + ' تعارض بدون بازنویسی حفظ شد',
        foldersCreated + ' پوشه جدید ساخته شد',
        oversized + ' فایل بیش از ۲۰ مگابایت ارسال نشد',
        failed + ' خطای انتقال',
        exported.downloaded + ' فایل از آرشیو در بسته ZIP قرار گرفت',
      ];
      setMessage(summary.join('؛ '));
      if (failed || oversized || conflicts || exported.failed) {
        setError(
          'بخشی از همگام‌سازی نیازمند بررسی است. ' +
          failures.slice(0, 4).join(' | ') +
          (exported.failed ? '؛ ' + exported.failed + ' فایل در نسخه ZIP دریافت نشد.' : '')
        );
      }
      setSyncProgress((previous) => previous ? {
        ...previous,
        phase: 'همگام‌سازی سازگار پایان یافت',
        percent: 100,
        currentItem: 'نسخه ZIP برای ذخیره در Files آماده شد.',
        foldersCreated,
        uploaded,
        identical,
        failed: failed + oversized + exported.failed,
        conflicts,
        oversized,
      } : previous);
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : 'همگام‌سازی سازگار ناموفق بود.';
      setError(messageText);
      publish('همگام‌سازی سازگار متوقف شد', 100, messageText);
    } finally {
      setSyncing(false);
      setProgress('');
    }
  };

  const importPortableZip = async (file: File) => {
    try {
      const tree = await fetchPortableFolderTree();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = readPortableSyncArchive(bytes, tree.cloudRoot.display_name);
      const inputs = entries.map((entry) => {
        const buffer = entry.data.buffer.slice(
          entry.data.byteOffset,
          entry.data.byteOffset + entry.data.byteLength,
        ) as ArrayBuffer;
        return {
          file: new File([buffer], entry.name, { type: portableMimeType(entry.name), lastModified: file.lastModified }),
          relativePath: entry.relativePath,
        };
      });
      await importPortableSyncEntries(inputs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خواندن بسته ZIP ناموفق بود.');
    }
  };

  const chooseSyncDirectory = async () => {
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setError('انتخاب محل ذخیره در این مرورگر پشتیبانی نمی‌شود؛ برای همگام‌سازی از Microsoft Edge یا Google Chrome روی ویندوز استفاده کنید.');
      return;
    }
    try {
      const handle = await picker({ mode: 'readwrite', id: 'customs-os-file-manager-sync' });
      await saveSyncDirectoryHandle(handle);
      setSyncDirectoryName(handle.name || '');
      setMessage('محل ذخیره ثبت شد. از این پس با یک کلیک همه اطلاعات و فایل‌های سازمان همگام‌سازی می‌شوند.');
      setError('');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'ذخیره محل همگام‌سازی ناموفق بود.');
    }
  };

  const forgetSyncDirectory = async () => {
    try {
      await clearSavedSyncDirectoryHandle();
      setSyncDirectoryName('');
      setMessage('محل ذخیره قبلی فراموش شد. هنگام همگام‌سازی بعدی یک پوشه جدید انتخاب کنید.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'حذف محل ذخیره ناموفق بود.');
    }
  };

  const copySmbAddress = async () => {
    const value = smbAddress.trim();
    if (!value || !/^[a-zA-Z0-9.-]+$/.test(value)) {
      setError('IP یا نام شبکه معتبر وارد کنید؛ مثال: 192.168.1.20');
      return;
    }
    try {
      await navigator.clipboard.writeText('smb://' + value);
      setMessage('آدرس SMB کپی شد. آن را در Files آیفون، بخش Connect to Server وارد کنید.');
    } catch {
      setError('کپی آدرس ممکن نشد؛ آدرس smb://' + value + ' را دستی وارد کنید.');
    }
  };

  // One-time folder selection followed by one-click, organization-wide safe sync.
  // Existing document bytes are never overwritten or deleted; changed paths become conflicts.
  const syncWindowsFolder = async () => {
    if (!organizationId || !roleCanModifyStructure(role)) {
      setError('برای همگام‌سازی کامل سازمان، دسترسی فایل‌منیجر لازم است.');
      return;
    }
    const cloudRoot = folders.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root');
    if (!cloudRoot) {
      setError('پوشه اصلی «صاحبان کالا» در فایل‌منیجر پیدا نشد؛ ساختار پوشه‌ها را تازه‌سازی کنید.');
      return;
    }
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setError('همگام‌سازی مستقیم پوشه فقط در Microsoft Edge یا Google Chrome روی ویندوز پشتیبانی می‌شود.');
      return;
    }

    setSyncing(true);
    setError('');
    setMessage('');
    setProgress('آماده‌سازی محل ذخیره و دریافت اطلاعات سازمان…');
    let uploaded = 0;
    let downloaded = 0;
    let identical = 0;
    let conflicts = 0;
    let oversized = 0;
    let failed = 0;
    let foldersCreated = 0;
    let metadataWritten = 0;
    let bytesSaved = 0;
    let transferCompleted = 0;
    let transferTotal = 0;
    let archiveDestination: Awaited<ReturnType<typeof getFileArchiveDestination>> | null = null;
    const failedItems: string[] = [];
    let progressSnapshot: WindowsSyncProgress = {
      percent: 0,
      phase: 'آماده‌سازی همگام‌سازی',
      currentItem: '',
      foldersCreated: 0,
      downloaded: 0,
      uploaded: 0,
      identical: 0,
      metadataWritten: 0,
      bytesSaved: 0,
      failed: 0,
      conflicts: 0,
      oversized: 0,
    };
    const publishSyncProgress = (patch: Partial<WindowsSyncProgress>) => {
      progressSnapshot = { ...progressSnapshot, ...patch };
      setSyncProgress(progressSnapshot);
    };
    setSyncProgress(progressSnapshot);

    try {
      let selectedHandle = await getSavedSyncDirectoryHandle().catch(() => null);
      if (!selectedHandle) {
        selectedHandle = await picker({ mode: 'readwrite', id: 'customs-os-file-manager-sync' });
        await saveSyncDirectoryHandle(selectedHandle);
        setSyncDirectoryName(selectedHandle.name || '');
      }
      const permissionGranted = await requestSyncDirectoryPermission(selectedHandle);
      if (!permissionGranted) {
        throw new Error('اجازه نوشتن در پوشه ذخیره داده نشد. یک‌بار «تغییر محل ذخیره» را بزنید و پوشه را دوباره انتخاب کنید.');
      }
      // Keep the user's chosen directory clean and make the exact folder shareable over SMB.
      const localRoot = await selectedHandle.getDirectoryHandle('Darbandi Commercial', { create: true });
      setProgress('بررسی ساختار کامل صاحبان کالا، محموله‌ها و زیرپوشه‌ها…');

      const folderPathById = new Map<string, string>([[cloudRoot.id, '']]);
      const serverFolderByPath = new Map<string, FolderRow>([['', cloudRoot]]);
      const ambiguousPaths = new Set<string>();
      const queue: FolderRow[] = [cloudRoot];
      while (queue.length) {
        const parent = queue.shift()!;
        const parentPath = folderPathById.get(parent.id) ?? '';
        for (const child of folders.filter((item) => item.parent_id === parent.id)) {
          const segment = windowsName(child.display_name);
          const childPath = parentPath ? parentPath + '/' + segment : segment;
          if (serverFolderByPath.has(childPath)) {
            ambiguousPaths.add(childPath);
            continue;
          }
          folderPathById.set(child.id, childPath);
          serverFolderByPath.set(childPath, child);
          queue.push(child);
        }
      }

      const canonicalPath = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');
      const ambiguousFileKeys = new Set<string>();
      const localDirectories = new Map<string, any>([['', localRoot]]);
      const localFiles = new Map<string, { file: File; parentPath: string; relativePath: string }>();
      const walkLocal = async (directory: any, relative: string): Promise<void> => {
        for await (const [entryName, entry] of directory.entries()) {
          const name = windowsName(String(entryName));
          const relativePath = relative ? relative + '/' + name : name;
          if (entry.kind === 'directory') {
            if (localDirectories.has(relativePath)) {
              ambiguousPaths.add(relativePath);
              continue;
            }
            localDirectories.set(relativePath, entry);
            await walkLocal(entry, relativePath);
          } else if (entry.kind === 'file') {
            const lower = name.toLowerCase();
            if (['desktop.ini', 'thumbs.db', '.ds_store'].includes(lower) || lower.startsWith('~$') || isManagedSyncMetadataFile(name)) continue;
            const key = canonicalPath(relativePath);
            if (localFiles.has(key)) {
              ambiguousFileKeys.add(key);
              continue;
            }
            localFiles.set(key, { file: await entry.getFile(), parentPath: relative, relativePath });
          }
        }
      };
      await walkLocal(localRoot, '');

      const folderIds = [...folderPathById.keys()];
      const serverFiles: FileRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: listError } = await supabase
          .from('file_manager_files')
          .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
          .eq('organization_id', organizationId)
          .in('folder_id', folderIds)
          .eq('is_archived', false)
          .order('created_at', { ascending: true })
          .range(offset, offset + 499);
        if (listError) throw listError;
        const batch = (data || []) as FileRow[];
        serverFiles.push(...batch);
        if (batch.length < 500) break;
      }

      const serverFilesByPath = new Map<string, { file: FileRow; relativePath: string }>();
      for (const file of serverFiles) {
        const parentPath = folderPathById.get(file.folder_id);
        if (parentPath === undefined) continue;
        const relativePath = parentPath ? parentPath + '/' + windowsName(file.original_name) : windowsName(file.original_name);
        const key = canonicalPath(relativePath);
        if (serverFilesByPath.has(key)) ambiguousFileKeys.add(key);
        else serverFilesByPath.set(key, { file, relativePath });
      }

      const ensureServerFolder = async (relativePath: string): Promise<FolderRow> => {
        const existing = serverFolderByPath.get(relativePath);
        if (existing) return existing;
        const parts = relativePath.split('/').filter(Boolean);
        const parentPath = parts.slice(0, -1).join('/');
        const parent = await ensureServerFolder(parentPath);
        const segment = parts[parts.length - 1];
        const matching = folders.find((item) => item.parent_id === parent.id && windowsName(item.display_name) === segment);
        const folder = matching || await getOrCreateSubfolder(parent, segment);
        serverFolderByPath.set(relativePath, folder);
        folderPathById.set(folder.id, relativePath);
        return folder;
      };

      const ensureLocalFolder = async (relativePath: string): Promise<any> => {
        if (localDirectories.has(relativePath)) return localDirectories.get(relativePath);
        const parts = relativePath.split('/').filter(Boolean);
        let path = '';
        let handle = localRoot;
        for (const part of parts) {
          path = path ? path + '/' + part : part;
          if (localDirectories.has(path)) handle = localDirectories.get(path);
          else {
            handle = await handle.getDirectoryHandle(part, { create: true });
            localDirectories.set(path, handle);
          }
        }
        return handle;
      };

      const folderPathsToPrepare = [...serverFolderByPath.keys()]
        .filter(Boolean)
        .sort((a, b) => a.split('/').length - b.split('/').length);
      for (let index = 0; index < folderPathsToPrepare.length; index += 1) {
        const folderPath = folderPathsToPrepare[index];
        if (!ambiguousPaths.has(folderPath)) {
          await ensureLocalFolder(folderPath);
          foldersCreated += 1;
        }
        publishSyncProgress({
          phase: 'آماده‌سازی پوشه‌ها',
          percent: folderPathsToPrepare.length ? Math.round(((index + 1) / folderPathsToPrepare.length) * 10) : 10,
          currentItem: folderPath,
          foldersCreated,
        });
      }

      const digest = async (blob: Blob): Promise<string> => {
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
      };
      transferTotal = localFiles.size + [...serverFilesByPath.keys()].filter((key) => !localFiles.has(key)).length;
      const publishTransferProgress = (currentItem: string) => {
        transferCompleted += 1;
        publishSyncProgress({
          phase: 'انتقال و بررسی فایل‌ها',
          percent: 10 + Math.round((transferCompleted / Math.max(transferTotal, 1)) * 60),
          currentItem,
          downloaded,
          uploaded,
          identical,
          bytesSaved,
          failed,
          conflicts,
          oversized,
        });
      };

      for (const [relativeKey, local] of localFiles) {
        const relativePath = local.relativePath;
        try {
          if (ambiguousPaths.has(local.parentPath) || ambiguousFileKeys.has(relativeKey)) {
            conflicts += 1;
            continue;
          }
          const remoteEntry = serverFilesByPath.get(relativeKey);
          if (remoteEntry) {
            const remote = remoteEntry.file;
            if (Number(remote.size_bytes) !== local.file.size) {
              conflicts += 1;
              continue;
            }
            setProgress('مقایسهٔ محتوا: ' + relativePath);
            const remoteBlob = await getFileBlob(remote);
            if (await digest(local.file) === await digest(remoteBlob)) identical += 1;
            else conflicts += 1;
            continue;
          }
          if (local.file.size <= 0 || local.file.size > FILE_ARCHIVE_MAX_BYTES) {
            oversized += 1;
            failedItems.push(relativePath + ': فایل محلی برای آرشیو تلگرام باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
            continue;
          }
          const parent = await ensureServerFolder(local.parentPath);
          const localHash = await digest(local.file);
          const keyMaterial = [organizationId, parent.id, relativePath, local.file.size, localHash].join('|');
          const idempotencyKey = 'windows-sync:' + await digest(new Blob([keyMaterial]));
          archiveDestination ??= await getFileArchiveDestination();
          setProgress('ارسال فایل جدید به آرشیو: ' + relativePath);
          await uploadTelegramArchivedFile(local.file, {
            folderId: parent.id,
            ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
            documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
            tags: [],
            destination: archiveDestination,
            idempotencyKey,
          });
          uploaded += 1;
        } catch (reason) {
          failed += 1;
          failedItems.push(relativePath + ': ' + (reason instanceof Error ? reason.message : 'انتقال ناموفق بود.'));
        } finally {
          publishTransferProgress(relativePath);
        }
      }

      for (const [relativeKey, remoteEntry] of serverFilesByPath) {
        if (localFiles.has(relativeKey)) continue;
        const relativePath = remoteEntry.relativePath;
        const remote = remoteEntry.file;
        try {
          if (ambiguousFileKeys.has(relativeKey)) {
            conflicts += 1;
            continue;
          }
          const slash = relativePath.lastIndexOf('/');
          const parentPath = slash >= 0 ? relativePath.slice(0, slash) : '';
          const filename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
          setProgress('دریافت از آرشیو: ' + relativePath);
          const blob = await getFileBlob(remote);
          if (Number(remote.size_bytes) > 0 && blob.size !== Number(remote.size_bytes)) {
            throw new Error('حجم فایل دریافتی با اندازه ثبت‌شده در آرشیو مطابقت ندارد.');
          }
          const directory = await ensureLocalFolder(parentPath);
          const fileHandle = await directory.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          const savedFile = await fileHandle.getFile();
          if (savedFile.size !== blob.size) {
            throw new Error('تأیید ذخیره روی دیسک ناموفق بود؛ اندازه فایل نوشته‌شده صحیح نیست.');
          }
          downloaded += 1;
          bytesSaved += savedFile.size;
        } catch (reason) {
          failed += 1;
          failedItems.push(relativePath + ': ' + (reason instanceof Error ? reason.message : 'دریافت یا ذخیره فایل ناموفق بود.'));
        } finally {
          publishTransferProgress(relativePath);
        }
      }
      publishSyncProgress({
        phase: 'دریافت اطلاعات سازمانی و مالی',
        percent: 72,
        currentItem: 'خواندن اطلاعات کشتیرانی، گمرک، ثبت سفارش و حسابداری…',
        downloaded,
        uploaded,
        identical,
        bytesSaved,
        failed,
        conflicts,
        oversized,
      });
      setProgress('تجمیع اطلاعات کشتیرانی، گمرک، ثبت سفارش و حساب مالی…');
      const fetchOrgRows = async (table: string): Promise<Record<string, any>[]> => {
        const collected: Record<string, any>[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error: queryError } = await (supabase as any).from(table)
            .select('*').eq('organization_id', organizationId).range(offset, offset + 499);
          if (queryError) throw new Error('خواندن اطلاعات جدول ' + table + ' ناموفق بود: ' + queryError.message);
          const rows = (data || []) as Record<string, any>[];
          collected.push(...rows);
          if (rows.length < 500) break;
        }
        return collected;
      };
      const tableNames = [
        'clients', 'shipments', 'shipment_customs_data', 'cases', 'vessels',
        'shipping_lines', 'customs_offices', 'registration_orders',
        'customs_declarations', 'financial_transactions', 'customs_documents',
        'shipment_documents', 'customs_accounting_vouchers', 'finance_cost_categories',
        'finance_cost_items', 'finance_invoice_lines', 'finance_invoice_shipments',
        'finance_invoices', 'finance_org_settings', 'finance_payment_allocations',
        'finance_payment_request_lines', 'finance_payment_requests', 'finance_payments',
        'petty_cash_ledger',
      ];
      const tableRows = await Promise.all(tableNames.map((table) => fetchOrgRows(table)));
      const data = Object.fromEntries(tableNames.map((table, index) => [table, tableRows[index]])) as Record<string, Record<string, any>[]>;
      const byId = (rows: Record<string, any>[], id: unknown) => rows.find((row) => row.id === id) || null;

      const latestFiles: FileRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: rows, error: fileError } = await supabase
          .from('file_manager_files')
          .select('id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at')
          .eq('organization_id', organizationId)
          .in('folder_id', [...folderPathById.keys()])
          .eq('is_archived', false)
          .order('created_at', { ascending: true })
          .range(offset, offset + 499);
        if (fileError) throw fileError;
        const rowsBatch = (rows || []) as FileRow[];
        latestFiles.push(...rowsBatch);
        if (rowsBatch.length < 500) break;
      }

      const exportedAt = new Date().toISOString();
      const organizationSnapshot = {
        schemaVersion: 1,
        exportedAt,
        organizationId,
        tables: data,
        fileManager: {
          folders: [...serverFolderByPath.entries()].map(([relativePath, folder]) => ({ relativePath, ...folder })),
          files: latestFiles,
        },
      };
      const organizationJson = JSON.stringify(organizationSnapshot, null, 2);
      const organizationSnapshotHandle = await localRoot.getFileHandle('اطلاعات_کامل_سازمان.json', { create: true });
      const organizationSnapshotWritable = await organizationSnapshotHandle.createWritable();
      await organizationSnapshotWritable.write(organizationJson);
      await organizationSnapshotWritable.close();
      const savedSnapshot = await organizationSnapshotHandle.getFile();
      if (savedSnapshot.size !== new TextEncoder().encode(organizationJson).byteLength) {
        throw new Error('ذخیره فایل اطلاعات کامل سازمان تأیید نشد.');
      }
      metadataWritten += 1;
      bytesSaved += savedSnapshot.size;
      publishSyncProgress({
        phase: 'ذخیره نسخه کامل اطلاعات سازمان',
        percent: 80,
        currentItem: 'اطلاعات_کامل_سازمان.json',
        metadataWritten,
        bytesSaved,
        failed,
      });

      let metadataTasksDone = 1;
      const metadataTasksTotal = 1 + serverFolderByPath.size + latestFiles.length;
      for (const [relativePath, folder] of serverFolderByPath) {
        const shipment = byId(data.shipments, folder.shipment_id);
        const caseRecord = byId(data.cases, shipment?.case_id);
        const client = byId(data.clients, folder.client_id || shipment?.client_id || caseRecord?.client_id);
        const relevantCases = data.cases.filter((row) => caseRecord ? row.id === caseRecord.id : Boolean(folder.client_id && row.client_id === folder.client_id));
        const caseIds = relevantCases.map((row) => row.id);
        const relevantShipments = data.shipments.filter((row) => shipment ? row.id === shipment.id : Boolean(folder.client_id && row.client_id === folder.client_id));
        const relevantShipmentIds = relevantShipments.map((row) => row.id);
        const declarationRows = data.customs_declarations.filter((row) =>
          (folder.shipment_id && row.shipment_id === folder.shipment_id) || (row.case_id && caseIds.includes(row.case_id)));
        const declarationIds = declarationRows.map((row) => row.id);
        const transactions = data.financial_transactions.filter((row) =>
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.source_id && (relevantShipmentIds.includes(row.source_id) || declarationIds.includes(row.source_id))));
        const relevantCostItems = data.finance_cost_items.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const costItemIds = relevantCostItems.map((row) => row.id);
        const invoiceShipmentLinks = data.finance_invoice_shipments.filter((row) => relevantShipmentIds.includes(row.shipment_id));
        const linkedInvoiceIds = invoiceShipmentLinks.map((row) => row.invoice_id);
        const invoices = data.finance_invoices.filter((row) =>
          linkedInvoiceIds.includes(row.id) || (folder.client_id && row.client_id === folder.client_id));
        const invoiceIds = invoices.map((row) => row.id);
        const invoiceLines = data.finance_invoice_lines.filter((row) =>
          invoiceIds.includes(row.invoice_id) || (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)));
        const paymentRequests = data.finance_payment_requests.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const paymentRequestIds = paymentRequests.map((row) => row.id);
        const paymentRequestLines = data.finance_payment_request_lines.filter((row) => paymentRequestIds.includes(row.request_id));
        const payments = data.finance_payments.filter((row) =>
          (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id));
        const paymentIds = payments.map((row) => row.id);
        const paymentAllocations = data.finance_payment_allocations.filter((row) =>
          paymentIds.includes(row.payment_id) || invoiceIds.includes(row.invoice_id));
        const accountingVouchers = data.customs_accounting_vouchers.filter((row) =>
          (row.case_id && caseIds.includes(row.case_id)) ||
          (row.client_id && folder.client_id === row.client_id) ||
          (row.declaration_id && declarationIds.includes(row.declaration_id)));
        const pettyCashEntries = data.petty_cash_ledger.filter((row) =>
          (folder.parent_id === null) || (row.related_expense_id && costItemIds.includes(row.related_expense_id)));
        const costCategoryIds = relevantCostItems.map((row) => row.category_id).filter(Boolean);
        const costCategories = data.finance_cost_categories.filter((row) =>
          folder.parent_id === null || costCategoryIds.includes(row.id));
        const organizationFinanceSettings = folder.parent_id === null ? data.finance_org_settings : [];
        const order = data.registration_orders.find((row) =>
          (shipment?.registration_order_id && row.id === shipment.registration_order_id) ||
          (caseRecord && row.case_id === caseRecord.id)) || null;
        const relatedOrders = data.registration_orders.filter((row) =>
          (order && row.id === order.id) || caseIds.includes(row.case_id) ||
          (folder.client_id && row.client_id === folder.client_id));
        const vessel = byId(data.vessels, shipment?.vessel_id);
        const shippingLine = byId(data.shipping_lines, vessel?.shipping_line_id);
        const customsOffice = byId(data.customs_offices, folder.customs_office_id || shipment?.customs_office_id || caseRecord?.customs_office_id);
        const customsData = data.shipment_customs_data.find((row) => row.shipment_id === folder.shipment_id) || null;
        const folderFileRows = latestFiles.filter((row) => row.folder_id === folder.id);
        const customsDocumentRows = data.customs_documents.filter((row) => row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const shipmentDocumentRows = data.shipment_documents.filter((row) => row.folder_id === folder.id || (folder.shipment_id && row.shipment_id === folder.shipment_id && row.folder_id == null));
        const text = buildFolderMetadataText({
          folder,
          client,
          shipment,
          customsData,
          caseRecord,
          vessel,
          shippingLine,
          customsOffice,
          registrationOrder: order,
          declarations: declarationRows,
          financialTransactions: transactions,
          documents: [
            ...folderFileRows.map((row) => row as unknown as Record<string, unknown>),
            ...customsDocumentRows,
            ...shipmentDocumentRows,
          ],
          relatedSections: [
            { title: 'پرونده‌های مرتبط صاحب کالا', records: relevantCases },
            { title: 'سایر محموله‌های مرتبط صاحب کالا', records: relevantShipments.filter((row) => row.id !== shipment?.id) },
            { title: 'سایر ثبت سفارش‌های مرتبط', records: relatedOrders.filter((row) => row.id !== order?.id) },
            { title: 'هزینه‌های مستقیم و غیرمستقیم محموله', records: relevantCostItems },
            { title: 'فاکتورهای مالی', records: invoices },
            { title: 'ردیف‌های فاکتور', records: invoiceLines },
            { title: 'ارتباط فاکتور با محموله', records: invoiceShipmentLinks },
            { title: 'پرداخت‌ها و دریافت‌ها', records: payments },
            { title: 'تخصیص پرداخت به فاکتورها', records: paymentAllocations },
            { title: 'درخواست‌های پرداخت', records: paymentRequests },
            { title: 'ردیف‌های درخواست پرداخت', records: paymentRequestLines },
            { title: 'اسناد حسابداری گمرک', records: accountingVouchers },
            { title: 'تنخواه و صندوق', records: pettyCashEntries },
            { title: 'دسته‌بندی هزینه‌ها', records: costCategories },
            { title: 'تنظیمات مالی و اطلاعات بانکی سازمان', records: organizationFinanceSettings },
          ],
          generatedAt: new Date().toISOString(),
        });
        const directory = await ensureLocalFolder(relativePath);
        const infoHandle = await directory.getFileHandle('اطلاعات_عملیاتی.txt', { create: true });
        const infoWritable = await infoHandle.createWritable();
        await infoWritable.write(text);
        await infoWritable.close();
        const savedInfo = await infoHandle.getFile();
        if (savedInfo.size !== new TextEncoder().encode(text).byteLength) {
          throw new Error('ذخیره اطلاعات پوشه «' + folder.display_name + '» تأیید نشد.');
        }
        metadataWritten += 1;
        bytesSaved += savedInfo.size;
        metadataTasksDone += 1;
        publishSyncProgress({
          phase: 'ذخیره اطلاعات پرونده‌ها و محموله‌ها',
          percent: 80 + Math.round((metadataTasksDone / metadataTasksTotal) * 20),
          currentItem: relativePath || 'ریشه سازمان',
          metadataWritten,
          bytesSaved,
          failed,
        });

        for (const file of folderFileRows) {
          const fileName = windowsName(file.original_name || 'document');
          const companionName = windowsName(fileName + '.اطلاعات.txt');
          const companionText = buildDocumentMetadataText(file as unknown as Record<string, unknown>, text);
          const companionHandle = await directory.getFileHandle(companionName, { create: true });
          const companionWritable = await companionHandle.createWritable();
          await companionWritable.write(companionText);
          await companionWritable.close();
          const savedCompanion = await companionHandle.getFile();
          if (savedCompanion.size !== new TextEncoder().encode(companionText).byteLength) {
            throw new Error('ذخیره فراداده سند «' + fileName + '» تأیید نشد.');
          }
          metadataWritten += 1;
          bytesSaved += savedCompanion.size;
          metadataTasksDone += 1;
          publishSyncProgress({
            phase: 'ذخیره اطلاعات اسناد',
            percent: 80 + Math.round((metadataTasksDone / metadataTasksTotal) * 20),
            currentItem: relativePath ? relativePath + '/' + companionName : companionName,
            metadataWritten,
            bytesSaved,
            failed,
          });
        }
      }

      setProgress('ثبت نتیجه و تازه‌سازی فهرست فایل‌ها…');
      await loadFolders();
      await loadFiles(selectedFolderId);
      const parts = [
        'همگام‌سازی سازمان به پایان رسید.',
        uploaded + ' فایل از ویندوز به آرشیو ارسال شد',
        downloaded + ' فایل از آرشیو روی دیسک ذخیره و تأیید شد',
        identical + ' فایل بدون تغییر بود',
        conflicts + ' تعارض برای بررسی دستی حفظ شد',
        foldersCreated + ' پوشه آماده شد',
        metadataWritten + ' فایل اطلاعاتی/فراداده ذخیره شد',
        latestFiles.length + ' سند در فهرست آرشیو بررسی شد',
        'حجم کل نوشته‌شده روی دیسک: ' + byteLabel(bytesSaved),
      ];
      if (oversized) parts.push(oversized + ' فایل محلی به علت محدودیت ۲۰ مگابایت برای آپلود تلگرام ارسال نشد');
      if (failed) parts.push(failed + ' فایل با خطا مواجه شد');
      parts.push('هیچ سند اصلی حذف یا بازنویسی نشد؛ اسناد اصلی بدون اجازه تغییر نمی‌کنند.');
      setMessage(parts.join('؛ '));
      if (failed) {
        setError('همگام‌سازی کامل نیست؛ ' + failed + ' مورد ذخیره نشد. ' + failedItems.slice(0, 4).join(' | '));
      }
      publishSyncProgress({
        phase: failed ? 'پایان با موارد ناموفق' : 'همگام‌سازی کامل شد',
        percent: 100,
        currentItem: failed ? failedItems.slice(0, 2).join(' | ') : 'تمام فایل‌ها و اطلاعات قابل دسترس بررسی و ذخیره شدند.',
        foldersCreated,
        downloaded,
        uploaded,
        identical,
        metadataWritten,
        bytesSaved,
        failed,
        conflicts,
        oversized,
      });
    } catch (reason) {
      const failureMessage = reason instanceof Error ? reason.message : 'همگام‌سازی کامل سازمان ناموفق بود.';
      setError(failureMessage);
      publishSyncProgress({
        phase: 'همگام‌سازی متوقف شد',
        currentItem: failureMessage,
        downloaded,
        uploaded,
        identical,
        metadataWritten,
        bytesSaved,
        failed: failed + 1,
        conflicts,
        oversized,
      });
      if (uploaded || downloaded) setMessage('تا پیش از خطا: ' + uploaded + ' فایل ارسال و ' + downloaded + ' فایل دریافت شد. اجرای بعدی می‌تواند ادامه دهد.');
    } finally {
      setSyncing(false);
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

  const toggleFolderExpansion=(id:string)=>setExpandedFolders(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const renderFolderNode=(folder:FolderRow,depth=0):React.ReactNode=>{
    const children=folderChildrenByParent.get(folder.id)||[],expanded=expandedFolders.has(folder.id),count=folderDescendantCounts[folder.id]||0,selected=selectedFolderId===folder.id;
    return <div key={folder.id} className="select-none">
      <div className={'flex items-start gap-1 rounded-lg '+(selected?'bg-[var(--primary)]/10':'hover:bg-[var(--surface-2)]')} style={{paddingInlineStart:Math.min(depth,4)*8}}>
        <button type="button" onClick={()=>toggleFolderExpansion(folder.id)} disabled={!children.length} aria-expanded={expanded} aria-label={expanded?'بستن زیرپوشه‌ها':'بازکردن زیرپوشه‌ها'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md app-muted disabled:opacity-20">{children.length?(expanded?<ChevronDown size={14}/>:<ChevronLeft size={14}/>):<span className="h-1 w-1 rounded-full bg-[var(--border)]"/>}</button>
        <button type="button" onClick={()=>chooseFolder(folder)} title={folder.display_name} className={'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-right text-sm '+(selected?'font-bold text-[var(--primary)]':'')}>
          <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border '+folderToneClass(folder.folder_type)}>{count>0?<FolderOpen size={16}/>:<Folder size={16}/>}</span>
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{folder.display_name}</span>{count>0&&<span className="mt-0.5 shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px]">{count}</span>}
        </button>
      </div>
      {expanded&&children.map(child=>renderFolderNode(child,depth+1))}
    </div>;
  };
  const uploadEnabled = Boolean(currentFolder && (currentFolder.shipment_id || (currentFolder.client_id && ['client', 'custom'].includes(currentFolder.folder_type))));
  const directoryProps = { webkitdirectory: '', directory: '' } as any;

  return <main dir="rtl" className="mobile-app-page file-manager-page min-h-screen px-3 py-3 sm:p-4 md:p-6" style={{ color: 'var(--text)' }}>
    <div className="mx-auto max-w-7xl space-y-3 sm:space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--primary)]/10 p-3 text-[var(--primary)]"><FolderOpen size={24} /></div>
          <div>
            <div className="hidden text-xs app-muted sm:block">CUSTOMS OS · DOCUMENTS</div>
            <h1 className="text-xl sm:text-2xl font-black">فایل‌منیجر اسناد و مدارک</h1>
          </div>
        </div>
        <div className="file-manager-page-actions flex flex-wrap gap-2">
          <Link to="/operations" className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm"><ArrowRight size={15} className="ml-1 inline" />عملیات</Link>
          <Link to="/settings/messengers" className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm">تنظیم آرشیو</Link>
          <button type="button" onClick={() => { void loadFolders(); if (selectedFolderId) void loadFiles(selectedFolderId); }} disabled={loading} className="rounded-xl border app-border px-2.5 sm:px-3 py-2 text-xs sm:text-sm disabled:opacity-50"><RefreshCw size={15} className="ml-1 inline" />تازه‌سازی</button>
        </div>
      </header>

      <section className="file-manager-archive-status flex flex-wrap items-center justify-between gap-2 rounded-2xl border app-border bg-[var(--surface)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><MessageCircle size={18}/></span>
          <div className="min-w-0">
            <div className="text-sm font-bold">آرشیو تلگرام: {archiveDestinationStatus==='checking'?'در حال بررسی…':archiveDestination?.displayName||'در دسترس نیست'}</div>
          </div>
        </div>
        {['owner','admin'].includes(role)&&<Link to="/settings/messengers" className="shrink-0 rounded-lg border app-border px-3 py-2 text-xs">تنظیم مقصد</Link>}
        {archiveDestinationStatus==='unavailable'&&<span className="text-xs text-amber-600">مقصد فعال پیدا نشد</span>}
      </section>
      <details className="file-manager-archive-help text-xs app-muted"><summary>دربارهٔ اسناد قدیمی</summary><p>اسناد قدیمی به‌صورت خودکار به تلگرام منتقل نمی‌شوند. فایل‌های جدیدی که از مسیر آرشیو آپلود شوند در گفت‌وگوی تلگرام ثبت می‌شوند.</p></details>

<section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-[var(--surface)] to-cyan-500/5 p-4 shadow-sm sm:p-5">
          <div className="pointer-events-none absolute -left-8 -top-8 h-36 w-36 rounded-full bg-sky-500/10 blur-2xl"/>
          <div className="relative flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10 text-sky-600"><HardDrive size={24}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold tracking-wide text-sky-700 dark:text-sky-300">ONE-CLICK COMPANY SYNC</div>
              <h2 className="mt-1 text-base font-black sm:text-lg">همگام‌سازی کامل فایل‌منیجر</h2>
              <p className="mt-1 text-xs leading-6 app-muted">همه صاحبان کالا، محموله‌ها، زیرپوشه‌ها، اسناد، اطلاعات کشتیرانی، گمرک، ثبت سفارش و حساب مالی در یک پوشه ذخیره می‌شوند.</p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2 rounded-xl border app-border bg-[var(--surface)]/80 p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><ShieldCheck size={17}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] app-muted">محل ذخیره متصل</div>
              <div className="truncate text-xs font-bold">{syncDirectoryName ? syncDirectoryName + ' / Darbandi Commercial' : 'هنوز انتخاب نشده؛ بار اول یک پوشه انتخاب می‌کنید'}</div>
            </div>
            {syncDirectoryName && <button type="button" onClick={()=>void forgetSyncDirectory()} className="shrink-0 rounded-lg border app-border px-2.5 py-2 text-[10px]">قطع اتصال</button>}
          </div>
          <div className="relative mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={()=>void syncWindowsFolder()} disabled={syncing||uploading||loading}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white shadow-lg shadow-sky-900/10 transition hover:brightness-110 disabled:opacity-50">
              {syncing?<Loader2 size={17} className="animate-spin"/>:<RefreshCw size={17}/>}
              {syncing?'در حال همگام‌سازی همه داده‌ها…':syncDirectoryName?'همگام‌سازی همه اطلاعات با یک کلیک':'انتخاب پوشه و شروع همگام‌سازی'}
            </button>
            <button type="button" onClick={()=>void chooseSyncDirectory()} disabled={syncing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">
              <FolderOpen size={15}/>تغییر محل ذخیره
            </button>
          </div>
          <p className="relative mt-2 text-[10px] leading-5 app-muted">پوشه فقط یک‌بار انتخاب می‌شود. فایل‌های اصلی حذف یا بی‌اجازه بازنویسی نمی‌شوند؛ تغییرات متعارض جداگانه گزارش می‌شوند.</p>
        </div>

        <div className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600"><Smartphone size={24}/></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold tracking-wide text-emerald-700 dark:text-emerald-300">APPLE FILES · SMB</div>
              <h2 className="mt-1 text-base font-black">اتصال آیفون به پوشه شرکت</h2>
              <p className="mt-1 text-xs leading-6 app-muted">یک‌بار اشتراک‌گذاری امن SMB را روی ویندوز فعال کنید؛ سپس آیفون با IP کامپیوتر و حساب اختصاصی وارد پوشه می‌شود.</p>
            </div>
          </div>
          <a href="/setup-iphone-files-share.ps1" download="Darbandi-Commercial-iPhone-SMB.ps1"
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <Download size={15}/>دانلود راه‌انداز امن ویندوز (PowerShell)
          </a>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-bold">IP کامپیوتر شرکت</span>
            <div className="flex gap-2">
              <input value={smbAddress} onChange={event=>setSmbAddress(event.target.value)} placeholder="مثلاً 192.168.1.20" inputMode="decimal" dir="ltr"
                className="min-w-0 flex-1 rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"/>
              <button type="button" onClick={()=>void copySmbAddress()} disabled={!smbAddress.trim()}
                className="shrink-0 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">کپی آدرس</button>
            </div>
          </label>
          <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 text-[11px] leading-6">
            <div className="font-bold">مراحل اتصال در آیفون</div>
            <ol className="mr-4 mt-1 list-decimal space-y-0.5 app-muted">
              <li>اسکریپت دانلودشده را در ویندوز با Run as administrator اجرا کنید.</li>
              <li>در Files آیفون: Browse ← سه‌نقطه ← Connect to Server.</li>
              <li>آدرس smb://IP را وارد و Registered User را انتخاب کنید.</li>
              <li>نام کاربری COMPUTERNAME\DarbandiFiles و رمز ساخته‌شده را وارد کنید.</li>
            </ol>
          </div>
          <div className="mt-2 flex items-start gap-2 text-[10px] leading-5 text-amber-700 dark:text-amber-300">
            <ShieldCheck size={14} className="mt-0.5 shrink-0"/>
            <span>فقط شبکه داخلی یا VPN امن؛ پورت 445 را روی مودم به اینترنت باز نکنید. آیفون و ویندوز باید به یک شبکه دسترسی داشته باشند.</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border app-border bg-[var(--surface)] p-3">
        <label className="relative block">
          <Search size={18} className="absolute right-3 top-3.5 app-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی صاحب کالا، محموله یا سند…" className="w-full rounded-xl border app-border bg-[var(--surface-2)] py-3 pr-10 pl-3 outline-none focus:border-[var(--primary)]" />
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
      {syncProgress && <section className="rounded-xl border app-border bg-[var(--surface)] p-3 sm:p-4" aria-label="پیشرفت همگام‌سازی">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black">{syncProgress.phase}</div>
            <div className="mt-1 break-all text-[10px] app-muted">{syncProgress.currentItem}</div>
          </div>
          <div className="shrink-0 text-xl font-black tabular-nums">{syncProgress.percent}٪</div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress.percent} aria-label="درصد پیشرفت ذخیره‌سازی">
          <div className="h-full rounded-full bg-[var(--primary)] transition-all duration-300" style={{ width: syncProgress.percent + '%' }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.foldersCreated}</b><div className="app-muted">پوشه آماده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.downloaded}</b><div className="app-muted">فایل ذخیره‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.uploaded}</b><div className="app-muted">فایل ارسال‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{syncProgress.metadataWritten}</b><div className="app-muted">فایل اطلاعاتی</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b>{byteLabel(syncProgress.bytesSaved)}</b><div className="app-muted">حجم ذخیره‌شده</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] p-2"><b className={syncProgress.failed ? 'text-red-500' : ''}>{syncProgress.failed}</b><div className="app-muted">ناموفق</div></div>
        </div>
      </section>}

      <section className="grid items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
        {treeOpen&&<button type="button" aria-label="بستن فهرست پوشه‌ها" onClick={()=>setTreeOpen(false)} className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden" />}
        <aside className={(treeOpen?'fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex flex-col overflow-hidden':'hidden')+' rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-2xl lg:static lg:z-auto lg:flex lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:shadow-none'}>
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1"><h2 className="font-black">پوشه‌ها</h2><div className="flex items-center gap-2"><span className="text-xs app-muted">{folders.length} پوشه</span><button type="button" onClick={()=>setTreeOpen(false)} className="rounded-lg border app-border p-2 lg:hidden" aria-label="بستن فهرست"><X size={16}/></button></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-0.5 lg:flex-none lg:overflow-visible">{folders.filter(folder=>folder.parent_id===null).map(root=>renderFolderNode(root))}
            {!folders.length&&<div className="p-5 text-center text-sm app-muted">ساختار پوشه هنوز بارگذاری نشده است.</div>}
          </div>
          
        </aside>
        <section className="flex min-w-0 min-h-[60dvh] max-h-none flex-col overflow-visible rounded-2xl border app-border bg-[var(--surface)] lg:max-h-[calc(100dvh-15rem)] lg:min-h-[380px] lg:overflow-hidden">
          <div className="shrink-0 border-b app-border p-3 md:p-4">
            <div className="mb-3 flex min-w-0 items-center gap-2">
              <button type="button" onClick={()=>setTreeOpen(v=>!v)} className="shrink-0 rounded-lg border app-border px-2.5 py-2 text-xs lg:hidden">{treeOpen?'بستن فهرست':'فهرست پوشه‌ها'}</button>
              <nav aria-label="مسیر پوشه" className="file-manager-breadcrumbs flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-xl border app-border bg-[var(--surface-2)] px-2.5 py-2 text-xs">
                <FolderOpen size={14} className="shrink-0 text-[var(--primary)]"/>
                {breadcrumbs.length === 0 && <span className="min-w-0 truncate font-semibold">فایل‌منیجر</span>}
                {breadcrumbs.map((crumb,i)=><React.Fragment key={crumb.id}>
                  {i>0&&<ChevronLeft size={13} className="shrink-0 app-muted"/>}
                  <button type="button" onClick={()=>chooseFolder(crumb)} title={crumb.display_name}
                    className={i===breadcrumbs.length-1?'min-w-0 flex-1 truncate rounded-lg bg-[var(--primary)]/10 px-2 py-1 font-bold text-[var(--primary)]':'max-w-24 shrink truncate rounded-md px-1 py-1 hover:bg-[var(--surface)] hover:text-[var(--primary)]'}>
                    {crumb.display_name}
                  </button>
                </React.Fragment>)}
              </nav>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1"><h2 className="truncate text-base sm:text-lg font-black">{currentFolder?.display_name||'فایل‌منیجر'}</h2></div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={()=>setUploadPanelOpen(v=>!v)} disabled={!currentFolder} title={uploadEnabled?'آپلود و آرشیو در تلگرام':'برای مشاهدهٔ علت محدودیت، پنل آپلود را باز کنید و پوشهٔ صاحب کالا یا محموله را انتخاب کنید'} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><UploadCloud size={14} className="ml-1 inline"/>{uploadPanelOpen?'بستن آپلود':'آپلود فایل'}</button>
                {currentFolder&&isCopyableFolder(currentFolder)&&<button type="button" onClick={()=>beginCopyFolder(currentFolder)} disabled={!folderCopyAvailable||copyingFolder} title={folderCopyAvailable?'کپی پوشه همراه با زیرپوشه‌ها':'برای کپی کامل، migration دیتابیس لازم است'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40"><Copy size={14} className="ml-1 inline"/>کپی</button>}
                {clipboardFolderId&&<button type="button" onClick={()=>void pasteCopiedFolder()} disabled={!folderCopyAvailable||copyingFolder||!currentFolder||currentFolder.folder_type==='root'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40">{copyingFolder?<Loader2 size={14} className="ml-1 inline animate-spin"/>:<ClipboardPaste size={14} className="ml-1 inline"/>}چسباندن</button>}
                {uploadEnabled&&roleCanModifyStructure(role)&&<form onSubmit={e=>{e.preventDefault();void createFolder();}} className="flex gap-1"><input value={folderName} onChange={e=>setFolderName(e.target.value)} placeholder="نام زیرپوشه" aria-label="نام زیرپوشه جدید" className="w-28 rounded-lg border app-border bg-[var(--surface-2)] px-2 py-2 text-xs"/><button type="submit" disabled={creatingFolder||!folderName.trim()} className="rounded-lg border app-border px-2.5 py-2 text-xs disabled:opacity-50">{creatingFolder?<Loader2 size={14} className="animate-spin"/>:'ساخت پوشه'}</button></form>}
              </div>
            </div>
          </div>
          {currentFolder&&uploadPanelOpen&&<div className="max-h-none shrink-0 border-b app-border p-3 md:p-4 lg:max-h-none lg:overflow-visible">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white"><UploadCloud size={16}/>انتخاب فایل<input type="file" multiple className="hidden" disabled={!uploadEnabled||uploading||syncing} onChange={e=>{const picked=Array.from(e.target.files||[]);if(picked.length){setPendingFiles(old=>[...old,...picked]);setUploadPanelOpen(true);setMessage(`${picked.length} فایل انتخاب شد؛ برای شروع، دکمه «ارسال به آرشیو تلگرام» را بزنید.`);setError('');}e.currentTarget.value='';}}/></label>
              <button type="button" onClick={()=>directoryInput.current?.click()} disabled={!uploadEnabled||uploading} className="flex items-center gap-2 rounded-xl border app-border px-4 py-2.5 text-sm disabled:opacity-40"><FolderOpen size={16}/>انتخاب پوشه ویندوز</button>
              <input ref={directoryInput} {...directoryProps} type="file" multiple className="hidden" disabled={!uploadEnabled||uploading} onChange={e=>{const picked=Array.from(e.target.files||[]);if(picked.length){setPendingFiles(old=>[...old,...picked]);setUploadPanelOpen(true);setMessage(`${picked.length} فایل از پوشه انتخاب شد؛ برای شروع، دکمه «ارسال به آرشیو تلگرام» را بزنید.`);setError('');}e.currentTarget.value='';}}/>
              <span className="text-xs app-muted">حداکثر ۲۰ مگابایت برای بازیابی از Bot API فعلی تلگرام.</span>
            </div>
            <label className="mt-3 block"><span className="mb-1 block text-xs font-bold app-muted">برچسب‌ها</span><input value={tagInput} onChange={e=>setTagInput(e.target.value)} disabled={uploading} placeholder="فاکتور، قبض انبار، بیمه…" className="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2 text-sm"/></label>
            {pendingFiles.length>0&&<div className="mt-3 rounded-xl border app-border bg-[var(--surface-2)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{pendingFiles.length} فایل در صف</b><button type="button" onClick={()=>setPendingFiles([])} disabled={uploading} className="text-xs app-muted underline">پاک‌کردن صف</button></div><div className="mt-2 max-h-28 space-y-1 overflow-auto">{pendingFiles.slice(0,40).map((file,index)=><div key={file.name+file.size+file.lastModified+index} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{(file as File&{webkitRelativePath?:string}).webkitRelativePath||file.name}</span><span className="shrink-0 app-muted">{byteLabel(file.size)}</span></div>)}{pendingFiles.length>40&&<div className="text-xs app-muted">و {pendingFiles.length-40} فایل دیگر…</div>}</div><button type="button" onClick={()=>void archiveFiles()} disabled={uploading} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{uploading?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>}ارسال به آرشیو تلگرام و ثبت فراداده</button></div>}
            {!uploadEnabled&&<p className="mt-2 text-xs app-muted">برای آپلود، پوشه صاحب کالا یا محموله را انتخاب کنید.</p>}
          </div>}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b app-border bg-[var(--surface-2)] px-3 py-2.5 text-xs"><b className="min-w-0 truncate">{currentFolder?.display_name || 'فایل‌منیجر'} <span className="font-normal app-muted">· {files.length} سند</span></b><span className="shrink-0 rounded-full border app-border px-2 py-1">{childFolders.length} زیرپوشه</span></div>
          <div className="min-h-0 flex-none overflow-visible p-3 md:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {childFolders.length>0&&<div className="mb-4"><div className="mb-2"><h3 className="text-xs font-bold app-muted">پوشه‌ها</h3></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{childFolders.map(folder=>{const count=folderDescendantCounts[folder.id]||0;return <div key={folder.id} className="flex min-w-0 items-stretch gap-1 rounded-xl border app-border p-1.5 hover:bg-[var(--surface-2)]"><button type="button" onClick={()=>chooseFolder(folder)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-right"><span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border '+folderToneClass(folder.folder_type)}>{count>0?<FolderOpen size={24}/>:<Folder size={24}/>}</span><span className="min-w-0 flex-1"><span className="block whitespace-normal break-words text-sm font-bold leading-5">{folder.display_name}</span><span className="mt-1 block text-[10px] app-muted">{folder.folder_type==='accounting_finance'?'حسابداری مالی':folder.is_system?'پوشه پیش‌فرض':'پوشه سفارشی'}</span><span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] '+(count>0?'bg-emerald-500/10 text-emerald-600':'bg-[var(--surface-2)] app-muted')}>{count>0?count+' سند فعال':'خالی'}</span></span></button>{isCopyableFolder(folder)&&<button type="button" onClick={()=>beginCopyFolder(folder)} disabled={!folderCopyAvailable} aria-label={'کپی پوشه '+folder.display_name} className="self-center rounded-lg border app-border p-2 disabled:opacity-35"><Copy size={15}/></button>}</div>;})}</div></div>}
            {files.length>0&&<div className="overflow-hidden rounded-xl border app-border"><div className="hidden grid-cols-[minmax(0,1fr)_94px_118px_210px] items-center gap-2 bg-[var(--surface-2)] px-3 py-2 text-[10px] font-bold app-muted sm:grid"><span>نام و اطلاعات سند</span><span>حجم</span><span>تاریخ</span><span className="text-left">عملیات</span></div>{files.map(file=>{const isTelegram=Boolean(file.file_asset_id || file.metadata?.copyAliasFileAssetId);const displayName=typeof file.metadata?.documentName==='string'?file.metadata.documentName:file.original_name;const tags=Array.isArray(file.tags)?file.tags.slice(0,6):[];return <div key={file.id} className="grid gap-2 border-t app-border px-3 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_94px_118px_210px] sm:items-center sm:gap-2"><div className="flex min-w-0 items-start gap-3"><FileText size={20} className={isTelegram?'mt-0.5 shrink-0 text-emerald-600':'mt-0.5 shrink-0 text-[var(--primary)]'}/><div className="min-w-0"><div className="break-words text-sm font-bold">{displayName}</div>{displayName!==file.original_name&&<div className="mt-0.5 break-words text-[10px] app-muted">نام اصلی: {file.original_name}</div>}{tags.length>0&&<div className="mt-1 flex flex-wrap gap-1">{tags.map(tag=><span key={tag} className="rounded-full border app-border px-2 py-0.5 text-[10px] app-muted">{tag}</span>)}</div>}<div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] app-muted"><span className={isTelegram?'text-emerald-600':'text-amber-600'}>{isTelegram?'آرشیو تلگرام':'بایگانی قبلی وب‌سایت'}</span><span>·</span><span>{file.mime_type||'نوع نامشخص'}</span></div></div></div><span className="text-xs app-muted">{byteLabel(file.size_bytes)}</span><span className="text-xs app-muted">{new Date(file.created_at).toLocaleDateString('fa-IR')}</span><div className="flex flex-wrap items-center gap-1 sm:justify-end"><button type="button" onClick={()=>void previewDocument(file)} disabled={!(file.mime_type||'').startsWith('image/')&&file.mime_type!=='application/pdf'&&file.mime_type!=='text/plain'} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="نمایش"><Eye size={13}/>نمایش</button><button type="button" onClick={()=>void copyFileNameForTelegram(displayName)} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="کپی نام برای جست‌وجو در تلگرام"><Copy size={13}/>نام</button><button type="button" onClick={()=>void transferFileFromManager(file,'pdf-studio')} disabled={!((file.mime_type||'').toLowerCase()==='application/pdf'||(file.mime_type||'').toLowerCase()==='image/jpeg'||(file.mime_type||'').toLowerCase()==='image/png'||/\.(pdf|png|jpe?g)$/i.test(file.original_name))} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="بازکردن در PDF Studio"><FileText size={13}/>PDF</button><button type="button" onClick={()=>void transferFileFromManager(file,'chat')} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="انتقال به چت"><MessageCircle size={13}/>چت</button><button type="button" onClick={()=>void downloadFile(file)} className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-xs font-bold text-white" title="دانلود"><Download size={13}/>دانلود</button></div></div>;})}</div>}
            {childFolders.length===0&&files.length===0&&<div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed app-border p-6 text-center"><FolderOpen size={30} className="mb-2 text-[var(--primary)]"/><b className="text-sm">این پوشه خالی است</b><p className="mt-1 text-xs app-muted">از «آپلود فایل» برای ثبت سند استفاده کنید.</p></div>}
          </div>
        </section>
      </section>
      <p className="text-xs app-muted">همگام‌سازی کامل سازمان با یک کلیک و پس از انتخاب یک‌باره پوشه ذخیره انجام می‌شود. کنار هر سند فایل متنی اطلاعات عملیاتی و مالی ساخته می‌شود؛ اسناد اصلی بدون اجازه حذف یا بازنویسی نمی‌شوند.</p>
      {preview&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={'پیش‌نمایش '+preview.name}><section className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border app-border bg-[var(--surface)] shadow-2xl"><header className="flex shrink-0 items-center justify-between gap-3 border-b app-border px-4 py-3"><b className="min-w-0 truncate text-sm">{preview.name}</b><button type="button" onClick={()=>setPreview(null)} className="rounded-lg border app-border p-2" aria-label="بستن پیش‌نمایش"><X size={17}/></button></header><div className="min-h-0 flex-1 overflow-auto p-2">{preview.mime.startsWith('image/')?<img src={preview.url} alt={preview.name} className="mx-auto max-h-[82dvh] max-w-full object-contain"/>:preview.mime==='application/pdf'?<iframe src={preview.url} title={preview.name} className="h-[82dvh] w-full rounded-lg bg-white"/>:<iframe src={preview.url} title={preview.name} sandbox="" className="h-[82dvh] w-full rounded-lg bg-white"/>}</div></section></div>}
    </div>
  </main>;
};

export default FileManagerPage;
