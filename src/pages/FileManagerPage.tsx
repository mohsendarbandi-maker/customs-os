import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, Copy, ClipboardPaste,
  Download, Eye, FileText, Folder, FolderOpen, Loader2, MessageCircle,
  RefreshCw, Search, Upload, UploadCloud, X,
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
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
    if (copyAliasAssetId) return downloadTelegramArchivedFile(copyAliasAssetId);
    if (file.file_asset_id) return downloadTelegramArchivedFile(file.file_asset_id);
    if (file.storage_path) {
      const { data, error: storageError } = await supabase.storage.from('customs_documents').download(file.storage_path);
      if (storageError) throw storageError;
      return data;
    }
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

  // Manual bidirectional Windows sync. Never deletes either side; differing files are reported as conflicts.
  const syncWindowsFolder = async () => {
    if (!currentFolder || !uploadEnabled || !roleCanModifyStructure(role)) {
      setError('برای همگام‌سازی، پوشه صاحب کالا یا یک زیرپوشه اسناد را انتخاب کنید.');
      return;
    }
    if (currentFolder.folder_type === 'shipment' || currentFolder.folder_type === 'root') {
      setError('برای همگام‌سازی کامل صاحب کالا، پوشه خود صاحب کالا را انتخاب کنید؛ برای همگام‌سازی محموله، یکی از زیرپوشه‌های آن را انتخاب کنید.');
      return;
    }
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setError('همگام‌سازی پوشه ویندوز در این مرورگر پشتیبانی نمی‌شود؛ از Chrome یا Edge روی ویندوز استفاده کنید.');
      return;
    }

    setSyncing(true);
    setError('');
    setMessage('');
    setProgress('بررسی ساختار پوشه‌ها…');
    let uploaded = 0;
    let downloaded = 0;
    let identical = 0;
    let conflicts = 0;
    let oversized = 0;
    try {
      const localRoot = await picker({ mode: 'readwrite' });
      const folderPathById = new Map<string, string>([[currentFolder.id, '']]);
      const serverFolderByPath = new Map<string, FolderRow>([['', currentFolder]]);
      const ambiguousPaths = new Set<string>();
      const queue: FolderRow[] = [currentFolder];
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
          } else if (entry.kind === 'file' && !['desktop.ini', 'thumbs.db', '.ds_store'].includes(name.toLowerCase())) {
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
          if (localDirectories.has(path)) {
            handle = localDirectories.get(path);
          } else {
            handle = await handle.getDirectoryHandle(part, { create: true });
            localDirectories.set(path, handle);
          }
        }
        return handle;
      };

      // Ensure server-side folders that already exist also exist on the selected Windows tree.
      for (const folderPath of [...serverFolderByPath.keys()].filter(Boolean).sort((a, b) => a.split('/').length - b.split('/').length)) {
        if (!ambiguousPaths.has(folderPath)) await ensureLocalFolder(folderPath);
      }

      const destination = await getFileArchiveDestination();
      const digest = async (blob: Blob): Promise<string> => {
        const bytes = await blob.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('');
      };

      for (const [relativeKey, local] of localFiles) {
        const relativePath = local.relativePath;
        if (ambiguousPaths.has(relativePath) || ambiguousFileKeys.has(relativeKey)) { conflicts += 1; continue; }
        const remoteEntry = serverFilesByPath.get(relativeKey);
        const remote = remoteEntry?.file;
        const localHash = await digest(local.file);
        if (remote) {
          if (Number(remote.size_bytes) !== local.file.size) { conflicts += 1; continue; }
          setProgress('مقایسهٔ محتوا: ' + relativePath);
          const remoteBlob = await getFileBlob(remote);
          if (localHash === await digest(remoteBlob)) identical += 1;
          else conflicts += 1;
          continue;
        }
        if (local.file.size <= 0 || local.file.size > FILE_ARCHIVE_MAX_BYTES) {
          oversized += 1;
          continue;
        }
        const parent = await ensureServerFolder(local.parentPath);
        const keyMaterial = [organizationId, parent.id, relativePath, local.file.size, localHash].join('|');
        const keyHash = await digest(new Blob([keyMaterial]));
        const idempotencyKey = 'windows-sync:' + keyHash;
        setProgress('ارسال به آرشیو تلگرام: ' + relativePath);
        await uploadTelegramArchivedFile(local.file, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType: parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG',
          tags: [],
          destination,
          idempotencyKey,
        });
        uploaded += 1;
      }

      for (const [relativeKey, remoteEntry] of serverFilesByPath) {
        const relativePath = remoteEntry.relativePath;
        const remote = remoteEntry.file;
        if (ambiguousFileKeys.has(relativeKey) || localFiles.has(relativeKey)) {
          if (ambiguousFileKeys.has(relativeKey) && !localFiles.has(relativeKey)) conflicts += 1;
          continue;
        }
        const slash = relativePath.lastIndexOf('/');
        const parentPath = slash >= 0 ? relativePath.slice(0, slash) : '';
        const filename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
        if (remote.file_asset_id && Number(remote.size_bytes) > FILE_ARCHIVE_MAX_BYTES) {
          oversized += 1;
          continue;
        }
        setProgress('دریافت از آرشیو تلگرام: ' + relativePath);
        const blob = await getFileBlob(remote);
        const directory = await ensureLocalFolder(parentPath);
        const fileHandle = await directory.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        downloaded += 1;
      }

      await loadFolders();
      await loadFiles(selectedFolderId);
      const parts = [
        'همگام‌سازی دستی تمام شد.',
        uploaded + ' فایل به آرشیو ارسال شد',
        downloaded + ' فایل از آرشیو دریافت شد',
        identical + ' فایل یکسان بود',
        conflicts + ' تعارض برای بررسی دستی نگه داشته شد',
      ];
      if (oversized) parts.push(oversized + ' فایل بزرگ‌تر از ۲۰ مگابایت رد شد');
      parts.push('هیچ فایلی از هیچ‌کدام از دو طرف حذف یا بازنویسی نشد.');
      setMessage(parts.join('؛ ') + ' همگام‌سازی خودکار پس‌زمینه در این نسخه وجود ندارد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'همگام‌سازی پوشه ویندوز کامل نشد.');
      if (uploaded || downloaded) setMessage('تا پیش از خطا: ' + uploaded + ' فایل ارسال و ' + downloaded + ' فایل دریافت شد؛ اجرای بعدی تعارض‌ها را بازنویسی نمی‌کند.');
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

  return <main dir="rtl" className="file-manager-page min-h-screen px-3 py-3 sm:p-4 md:p-6" style={{ color: 'var(--text)' }}>
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <button type="button" onClick={()=>setTreeOpen(v=>!v)} className="rounded-lg border app-border px-2.5 py-1.5 text-xs lg:hidden">{treeOpen?'بستن فهرست':'فهرست پوشه‌ها'}</button>
              <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs app-muted">{breadcrumbs.map((crumb,i)=><React.Fragment key={crumb.id}>{i>0&&<ChevronLeft size={13}/>}<button type="button" onClick={()=>chooseFolder(crumb)} className={i===breadcrumbs.length-1?'max-w-32 truncate font-bold text-[var(--text)]':'max-w-24 truncate hover:text-[var(--primary)]'}>{crumb.display_name}</button></React.Fragment>)}</div>
              
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1"><h2 className="truncate text-base sm:text-lg font-black">{currentFolder?.display_name||'فایل‌منیجر'}</h2></div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={()=>setUploadPanelOpen(v=>!v)} disabled={!currentFolder} title={uploadEnabled?'آپلود و آرشیو در تلگرام':'برای مشاهدهٔ علت محدودیت، پنل آپلود را باز کنید و پوشهٔ صاحب کالا یا محموله را انتخاب کنید'} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><UploadCloud size={14} className="ml-1 inline"/>{uploadPanelOpen?'بستن آپلود':'آپلود فایل'}</button>
                {currentFolder&&isCopyableFolder(currentFolder)&&<button type="button" onClick={()=>beginCopyFolder(currentFolder)} disabled={!folderCopyAvailable||copyingFolder} title={folderCopyAvailable?'کپی پوشه همراه با زیرپوشه‌ها':'برای کپی کامل، migration دیتابیس لازم است'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40"><Copy size={14} className="ml-1 inline"/>کپی</button>}
                {clipboardFolderId&&<button type="button" onClick={()=>void pasteCopiedFolder()} disabled={!folderCopyAvailable||copyingFolder||!currentFolder||currentFolder.folder_type==='root'} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40">{copyingFolder?<Loader2 size={14} className="ml-1 inline animate-spin"/>:<ClipboardPaste size={14} className="ml-1 inline"/>}چسباندن</button>}
                <button type="button" onClick={()=>void syncWindowsFolder()} disabled={!currentFolder||syncing||exporting||uploading||loading} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-50">{syncing?<Loader2 size={14} className="ml-1 inline animate-spin"/>:<RefreshCw size={14} className="ml-1 inline"/>}همگام‌سازی ویندوز</button>
                <button type="button" onClick={()=>void exportFolderToWindows()} disabled={!currentFolder||exporting||syncing||loading} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-50"><Download size={14} className="ml-1 inline"/>خروجی پوشه</button>
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
          <div className="flex shrink-0 items-center justify-between gap-2 border-b app-border px-3 py-2.5 text-xs"><b className="truncate">{currentFolder?.display_name||'پوشه'} · {files.length} سند</b><span>{childFolders.length} زیرپوشه</span></div>
          <div className="min-h-0 flex-none overflow-visible p-3 md:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {childFolders.length>0&&<div className="mb-4"><div className="mb-2"><h3 className="text-xs font-bold app-muted">پوشه‌ها</h3></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{childFolders.map(folder=>{const count=folderDescendantCounts[folder.id]||0;return <div key={folder.id} className="flex min-w-0 items-stretch gap-1 rounded-xl border app-border p-1.5 hover:bg-[var(--surface-2)]"><button type="button" onClick={()=>chooseFolder(folder)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-right"><span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border '+folderToneClass(folder.folder_type)}>{count>0?<FolderOpen size={24}/>:<Folder size={24}/>}</span><span className="min-w-0 flex-1"><span className="block whitespace-normal break-words text-sm font-bold leading-5">{folder.display_name}</span><span className="mt-1 block text-[10px] app-muted">{folder.folder_type==='accounting_finance'?'حسابداری مالی':folder.is_system?'پوشه پیش‌فرض':'پوشه سفارشی'}</span><span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] '+(count>0?'bg-emerald-500/10 text-emerald-600':'bg-[var(--surface-2)] app-muted')}>{count>0?count+' سند فعال':'خالی'}</span></span></button>{isCopyableFolder(folder)&&<button type="button" onClick={()=>beginCopyFolder(folder)} disabled={!folderCopyAvailable} aria-label={'کپی پوشه '+folder.display_name} className="self-center rounded-lg border app-border p-2 disabled:opacity-35"><Copy size={15}/></button>}</div>;})}</div></div>}
            {files.length>0&&<div className="overflow-hidden rounded-xl border app-border"><div className="hidden grid-cols-[minmax(0,1fr)_94px_118px_210px] items-center gap-2 bg-[var(--surface-2)] px-3 py-2 text-[10px] font-bold app-muted sm:grid"><span>نام و اطلاعات سند</span><span>حجم</span><span>تاریخ</span><span className="text-left">عملیات</span></div>{files.map(file=>{const isTelegram=Boolean(file.file_asset_id || file.metadata?.copyAliasFileAssetId);const displayName=typeof file.metadata?.documentName==='string'?file.metadata.documentName:file.original_name;const tags=Array.isArray(file.tags)?file.tags.slice(0,6):[];return <div key={file.id} className="grid gap-2 border-t app-border px-3 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_94px_118px_210px] sm:items-center sm:gap-2"><div className="flex min-w-0 items-start gap-3"><FileText size={20} className={isTelegram?'mt-0.5 shrink-0 text-emerald-600':'mt-0.5 shrink-0 text-[var(--primary)]'}/><div className="min-w-0"><div className="break-words text-sm font-bold">{displayName}</div>{displayName!==file.original_name&&<div className="mt-0.5 break-words text-[10px] app-muted">نام اصلی: {file.original_name}</div>}{tags.length>0&&<div className="mt-1 flex flex-wrap gap-1">{tags.map(tag=><span key={tag} className="rounded-full border app-border px-2 py-0.5 text-[10px] app-muted">{tag}</span>)}</div>}<div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] app-muted"><span className={isTelegram?'text-emerald-600':'text-amber-600'}>{isTelegram?'آرشیو تلگرام':'بایگانی قبلی وب‌سایت'}</span><span>·</span><span>{file.mime_type||'نوع نامشخص'}</span></div></div></div><span className="text-xs app-muted">{byteLabel(file.size_bytes)}</span><span className="text-xs app-muted">{new Date(file.created_at).toLocaleDateString('fa-IR')}</span><div className="flex flex-wrap items-center gap-1 sm:justify-end"><button type="button" onClick={()=>void previewDocument(file)} disabled={!(file.mime_type||'').startsWith('image/')&&file.mime_type!=='application/pdf'&&file.mime_type!=='text/plain'} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="نمایش"><Eye size={13}/>نمایش</button><button type="button" onClick={()=>void copyFileNameForTelegram(displayName)} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="کپی نام برای جست‌وجو در تلگرام"><Copy size={13}/>نام</button><button type="button" onClick={()=>void transferFileFromManager(file,'pdf-studio')} disabled={!((file.mime_type||'').toLowerCase()==='application/pdf'||(file.mime_type||'').toLowerCase()==='image/jpeg'||(file.mime_type||'').toLowerCase()==='image/png'||/\.(pdf|png|jpe?g)$/i.test(file.original_name))} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs disabled:opacity-35" title="بازکردن در PDF Studio"><FileText size={13}/>PDF</button><button type="button" onClick={()=>void transferFileFromManager(file,'chat')} className="inline-flex items-center gap-1 rounded-lg border app-border px-2 py-1.5 text-xs" title="انتقال به چت"><MessageCircle size={13}/>چت</button><button type="button" onClick={()=>void downloadFile(file)} className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-xs font-bold text-white" title="دانلود"><Download size={13}/>دانلود</button></div></div>;})}</div>}
            {childFolders.length===0&&files.length===0&&<div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed app-border p-6 text-center"><FolderOpen size={30} className="mb-2 text-[var(--primary)]"/><b className="text-sm">این پوشه خالی است</b><p className="mt-1 text-xs app-muted">از «آپلود فایل» برای ثبت سند استفاده کنید.</p></div>}
          </div>
        </section>
      </section>
      <p className="text-xs app-muted">فایل‌های جدید بدون OCR یا استخراج محتوا ارسال می‌شوند؛ کنترل دسترسی و جداسازی سازمانی حفظ می‌شود. همگام‌سازی ویندوز دستی است و در پس‌زمینه اجرا نمی‌شود.</p>
      {preview&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={'پیش‌نمایش '+preview.name}><section className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border app-border bg-[var(--surface)] shadow-2xl"><header className="flex shrink-0 items-center justify-between gap-3 border-b app-border px-4 py-3"><b className="min-w-0 truncate text-sm">{preview.name}</b><button type="button" onClick={()=>setPreview(null)} className="rounded-lg border app-border p-2" aria-label="بستن پیش‌نمایش"><X size={17}/></button></header><div className="min-h-0 flex-1 overflow-auto p-2">{preview.mime.startsWith('image/')?<img src={preview.url} alt={preview.name} className="mx-auto max-h-[82dvh] max-w-full object-contain"/>:preview.mime==='application/pdf'?<iframe src={preview.url} title={preview.name} className="h-[82dvh] w-full rounded-lg bg-white"/>:<iframe src={preview.url} title={preview.name} sandbox="" className="h-[82dvh] w-full rounded-lg bg-white"/>}</div></section></div>}
    </div>
  </main>;
};

export default FileManagerPage;
