import { supabase } from './supabase';
import {
  createTelegramArchiveIdempotencyKey,
  FILE_ARCHIVE_MAX_BYTES,
  getFileArchiveDestination,
  uploadTelegramArchivedFile,
} from './fileManager';
import {
  buildDocumentMetadataText,
  buildFolderMetadataText,
  isManagedSyncMetadataFile,
} from './fileManagerSync';
import { createPortableSyncArchive, PORTABLE_SYNC_ROOT_NAME } from './fileManagerPortableSync';
import { safeWindowsFileName } from './safeWindowsFileName';

export type PortableFolderRow = {
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

export type PortableFileRow = {
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

export type PortableSyncProgress = {
  phase: string;
  percent: number;
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

export type PortableSyncInputFile = {
  file: File;
  relativePath: string;
};

export type PortableSyncResult = {
  uploaded: number;
  downloaded: number;
  identical: number;
  conflicts: number;
  oversized: number;
  failed: number;
  foldersCreated: number;
  metadataWritten: number;
  bytes: number;
  archive?: Uint8Array;
  failures: string[];
};

type ProgressCallback = (progress: PortableSyncProgress) => void;
type GetFileBlob = (file: PortableFileRow) => Promise<Blob>;

const TABLE_NAMES = [
  'clients', 'shipments', 'shipment_customs_data', 'cases', 'vessels',
  'shipping_lines', 'customs_offices', 'registration_orders',
  'customs_declarations', 'financial_transactions', 'customs_documents',
  'shipment_documents', 'customs_accounting_vouchers', 'finance_cost_categories',
  'finance_cost_items', 'finance_invoice_lines', 'finance_invoice_shipments',
  'finance_invoices', 'finance_org_settings', 'finance_payment_allocations',
  'finance_payment_request_lines', 'finance_payment_requests', 'finance_payments',
  'petty_cash_ledger',
];

const SELECT_FILE_COLUMNS =
  'id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,is_archived,created_at';

const normalizeKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');

function folderSlug(value: string): string {
  const slug = value.normalize('NFKC').toLocaleLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 72);
  return slug || crypto.randomUUID();
}

function portablePath(rawPath: string, ownerRootName: string): string {
  const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0]?.toLocaleLowerCase() === PORTABLE_SYNC_ROOT_NAME.toLocaleLowerCase()) parts.shift();
  if (parts[0]?.toLocaleLowerCase() === ownerRootName.toLocaleLowerCase()) parts.shift();
  if (parts[0]?.toLocaleLowerCase() === 'صاحبان کالا') parts.shift();
  const safeParts = parts.map(safeWindowsFileName);
  if (!safeParts.length) return '';
  const filename = safeParts[safeParts.length - 1];
  const lower = filename.toLocaleLowerCase();
  if (
    lower === 'desktop.ini' || lower === 'thumbs.db' || lower === '.ds_store' ||
    lower.startsWith('~' + '$') || lower.startsWith('._') ||
    safeParts.includes('__MACOSX') || isManagedSyncMetadataFile(filename)
  ) return '';
  return safeParts.join('/');
}

async function digest(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('مرورگر امکان مقایسه امن فایل‌ها را ندارد؛ مرورگر را به‌روز و از HTTPS استفاده کنید.');
  }
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function fetchOrganizationRows(organizationId: string, table: string): Promise<Record<string, any>[]> {
  const collected: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await (supabase as any).from(table)
      .select('*').eq('organization_id', organizationId).range(offset, offset + 499);
    if (error) throw new Error('خواندن اطلاعات جدول ' + table + ' ناموفق بود: ' + error.message);
    const batch = (data || []) as Record<string, any>[];
    collected.push(...batch);
    if (batch.length < 500) break;
  }
  return collected;
}

async function fetchPortableTree(organizationId: string) {
  const { data, error } = await supabase
    .from('file_manager_folders')
    .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
    .eq('organization_id', organizationId)
    .order('display_name', { ascending: true });
  if (error) throw error;

  const folderRows = (data || []) as PortableFolderRow[];
  const cloudRoot = folderRows.find((folder) => folder.parent_id === null && folder.folder_key === 'owners-root');
  if (!cloudRoot) throw new Error('پوشه اصلی «صاحبان کالا» پیدا نشد؛ ابتدا ساختار فایل‌منیجر را تازه‌سازی کنید.');

  const folderPathById = new Map<string, string>([[cloudRoot.id, '']]);
  const folderByPath = new Map<string, PortableFolderRow>([['', cloudRoot]]);
  const childrenByParent = new Map<string, PortableFolderRow[]>();
  for (const folder of folderRows) {
    if (!folder.parent_id) continue;
    const children = childrenByParent.get(folder.parent_id) || [];
    children.push(folder);
    childrenByParent.set(folder.parent_id, children);
  }

  const folderConflicts = new Set<string>();
  const queue: PortableFolderRow[] = [cloudRoot];
  while (queue.length) {
    const parent = queue.shift()!;
    const parentPath = folderPathById.get(parent.id) ?? '';
    for (const child of childrenByParent.get(parent.id) || []) {
      const segment = safeWindowsFileName(child.display_name);
      const childPath = parentPath ? parentPath + '/' + segment : segment;
      if (folderByPath.has(childPath)) {
        folderConflicts.add(childPath);
        continue;
      }
      folderByPath.set(childPath, child);
      folderPathById.set(child.id, childPath);
      queue.push(child);
    }
  }

  return { folderRows, cloudRoot, folderPathById, folderByPath, folderConflicts };
}

async function fetchPortableFiles(organizationId: string, folderIds: string[]): Promise<PortableFileRow[]> {
  const all: PortableFileRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('file_manager_files')
      .select(SELECT_FILE_COLUMNS)
      .eq('organization_id', organizationId)
      .in('folder_id', folderIds)
      .eq('is_archived', false)
      .order('created_at', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    const batch = (data || []) as PortableFileRow[];
    all.push(...batch);
    if (batch.length < 500) break;
  }
  return all;
}

function createProgress(onProgress: ProgressCallback, initial?: Partial<PortableSyncProgress>) {
  const state: PortableSyncProgress = {
    phase: 'آماده‌سازی همگام‌سازی سازگار',
    percent: 0,
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
    ...initial,
  };
  return (patch: Partial<PortableSyncProgress>) => {
    Object.assign(state, patch);
    onProgress({ ...state });
  };
}

function addUniqueEntry(
  entries: Array<{ path: string; data: Uint8Array }>,
  used: Set<string>,
  entryPath: string,
  data: Uint8Array,
) {
  let finalPath = entryPath;
  if (used.has(normalizeKey(finalPath))) {
    const slash = finalPath.lastIndexOf('/');
    const parent = slash >= 0 ? finalPath.slice(0, slash + 1) : '';
    const leaf = slash >= 0 ? finalPath.slice(slash + 1) : finalPath;
    const dot = leaf.lastIndexOf('.');
    const base = dot > 0 ? leaf.slice(0, dot) : leaf;
    const extension = dot > 0 ? leaf.slice(dot) : '';
    let suffix = 2;
    while (used.has(normalizeKey(parent + base + '__' + suffix + extension))) suffix += 1;
    finalPath = parent + base + '__' + suffix + extension;
  }
  used.add(normalizeKey(finalPath));
  entries.push({ path: finalPath, data });
}

export async function exportPortableOrganization(
  organizationId: string,
  getFileBlob: GetFileBlob,
  onProgress: ProgressCallback,
): Promise<PortableSyncResult> {
  const publish = createProgress(onProgress);
  const result: PortableSyncResult = {
    uploaded: 0, downloaded: 0, identical: 0, conflicts: 0,
    oversized: 0, failed: 0, foldersCreated: 0,
    metadataWritten: 0, bytes: 0, failures: [],
  };

  try {
    const tree = await fetchPortableTree(organizationId);
    const folderIds = [...tree.folderPathById.keys()];
    if (!folderIds.length) throw new Error('هیچ پوشه‌ای برای تهیه نسخه قابل‌حمل پیدا نشد.');
    publish({
      phase: 'دریافت فهرست اسناد سازمان',
      percent: 4,
      foldersCreated: tree.folderByPath.size,
      conflicts: tree.folderConflicts.size,
      currentItem: tree.cloudRoot.display_name,
    });

    const [files, tableRows] = await Promise.all([
      fetchPortableFiles(organizationId, folderIds),
      Promise.all(TABLE_NAMES.map((table) => fetchOrganizationRows(organizationId, table))),
    ]);
    const tables = Object.fromEntries(TABLE_NAMES.map((table, index) => [table, tableRows[index]])) as Record<string, Record<string, any>[]>;
    const rootPath = PORTABLE_SYNC_ROOT_NAME + '/' + safeWindowsFileName(tree.cloudRoot.display_name);
    const entries: Array<{ path: string; data: Uint8Array }> = [];
    const usedPaths = new Set<string>();

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const parentPath = tree.folderPathById.get(file.folder_id);
      if (parentPath === undefined) continue;
      const relativeFolder = parentPath ? rootPath + '/' + parentPath : rootPath;
      const filename = safeWindowsFileName(file.original_name || 'document');
      try {
        const blob = await getFileBlob(file);
        if (Number(file.size_bytes) > 0 && blob.size !== Number(file.size_bytes)) {
          throw new Error('حجم فایل دریافتی با اندازه ثبت‌شده مطابقت ندارد.');
        }
        addUniqueEntry(entries, usedPaths, relativeFolder + '/' + filename, new Uint8Array(await blob.arrayBuffer()));
        result.downloaded += 1;
        result.bytes += blob.size;
      } catch (reason) {
        result.failed += 1;
        result.failures.push((parentPath ? parentPath + '/' : '') + filename + ': ' +
          (reason instanceof Error ? reason.message : 'دریافت فایل ناموفق بود.'));
      }
      publish({
        phase: 'دریافت فایل‌های اصلی از آرشیو',
        percent: 5 + Math.round(((index + 1) / Math.max(files.length + tree.folderByPath.size, 1)) * 65),
        currentItem: relativeFolder + '/' + filename,
        downloaded: result.downloaded,
        failed: result.failed,
        bytesSaved: result.bytes,
      });
    }

    const byId = (rows: Record<string, any>[], id: unknown) => rows.find((row) => row.id === id) || null;
    const folderEntries = [...tree.folderByPath.entries()]
      .sort((a, b) => a[0].split('/').length - b[0].split('/').length);

    for (let index = 0; index < folderEntries.length; index += 1) {
      const [relativePath, folder] = folderEntries[index];
      const shipment = byId(tables.shipments, folder.shipment_id);
      const caseRecord = byId(tables.cases, shipment?.case_id);
      const client = byId(tables.clients, folder.client_id || shipment?.client_id || caseRecord?.client_id);
      const caseIds = caseRecord ? [caseRecord.id] : [];
      const declarationRows = tables.customs_declarations.filter((row) =>
        (folder.shipment_id && row.shipment_id === folder.shipment_id) ||
        (row.case_id && caseIds.includes(row.case_id)));
      const declarationIds = declarationRows.map((row) => row.id);
      const transactions = tables.financial_transactions.filter((row) =>
        (row.case_id && caseIds.includes(row.case_id)) ||
        (row.source_id && (row.source_id === folder.shipment_id || declarationIds.includes(row.source_id))));
      const relevantShipments = tables.shipments.filter((row) =>
        (folder.shipment_id && row.id === folder.shipment_id) ||
        (folder.client_id && row.client_id === folder.client_id));
      const relevantShipmentIds = relevantShipments.map((row) => row.id);
      const order = tables.registration_orders.find((row) =>
        (shipment?.registration_order_id && row.id === shipment.registration_order_id) ||
        (caseRecord && row.case_id === caseRecord.id)) || null;
      const relatedOrders = tables.registration_orders.filter((row) =>
        (order && row.id === order.id) || caseIds.includes(row.case_id) ||
        (folder.client_id && row.client_id === folder.client_id));
      const vessel = byId(tables.vessels, shipment?.vessel_id);
      const shippingLine = byId(tables.shipping_lines, vessel?.shipping_line_id);
      const customsOffice = byId(tables.customs_offices,
        folder.customs_office_id || shipment?.customs_office_id || caseRecord?.customs_office_id);
      const customsData = tables.shipment_customs_data.find((row) => row.shipment_id === folder.shipment_id) || null;
      const folderFiles = files.filter((row) => row.folder_id === folder.id);
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
        declarations: declarationRows,
        financialTransactions: transactions,
        documents: [
          ...folderFiles.map((file) => file as unknown as Record<string, unknown>),
          ...customsDocuments,
          ...shipmentDocuments,
        ],
        relatedSections: [
          { title: 'پرونده‌های مرتبط صاحب کالا', records: caseRecord ? [caseRecord] : [] },
          { title: 'سایر محموله‌های مرتبط صاحب کالا', records: relevantShipments.filter((row) => row.id !== shipment?.id) },
          { title: 'سایر ثبت سفارش‌های مرتبط', records: relatedOrders.filter((row) => row.id !== order?.id) },
          { title: 'هزینه‌های مرتبط', records: tables.finance_cost_items.filter((row) =>
            (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
            (row.case_id && caseIds.includes(row.case_id)) ||
            (folder.client_id && row.client_id === folder.client_id)) },
          { title: 'فاکتورهای مالی', records: tables.finance_invoices.filter((row) =>
            (folder.client_id && row.client_id === folder.client_id) ||
            (row.shipment_id && relevantShipmentIds.includes(row.shipment_id))) },
          { title: 'پرداخت‌ها و اسناد حسابداری', records: [
            ...tables.finance_payments.filter((row) =>
              (row.shipment_id && relevantShipmentIds.includes(row.shipment_id)) ||
              (row.case_id && caseIds.includes(row.case_id)) ||
              (folder.client_id && row.client_id === folder.client_id)),
            ...tables.customs_accounting_vouchers.filter((row) =>
              (row.case_id && caseIds.includes(row.case_id)) ||
              (folder.client_id && row.client_id === folder.client_id)),
          ] },
        ],
        generatedAt: new Date().toISOString(),
      });

      const relativeFolder = relativePath ? rootPath + '/' + relativePath : rootPath;
      addUniqueEntry(entries, usedPaths, relativeFolder + '/اطلاعات_عملیاتی.txt', new TextEncoder().encode(folderText));
      result.metadataWritten += 1;
      for (const file of folderFiles) {
        const filename = safeWindowsFileName(file.original_name || 'document');
        const companion = safeWindowsFileName(filename + '.اطلاعات.txt');
        const companionText = buildDocumentMetadataText(file as unknown as Record<string, unknown>, folderText);
        addUniqueEntry(entries, usedPaths, relativeFolder + '/' + companion, new TextEncoder().encode(companionText));
        result.metadataWritten += 1;
      }
      publish({
        phase: 'ساخت اطلاعات عملیاتی و فراداده',
        percent: 72 + Math.round(((index + 1) / Math.max(folderEntries.length, 1)) * 18),
        currentItem: relativeFolder,
        downloaded: result.downloaded,
        metadataWritten: result.metadataWritten,
        failed: result.failed,
        bytesSaved: result.bytes,
      });
    }

    const snapshot = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      organizationId,
      tables,
      fileManager: {
        folders: folderEntries.map(([relativePath, folder]) => ({ relativePath, ...folder })),
        files,
      },
    };
    publish({
      phase: 'فشرده‌سازی نسخه قابل‌حمل ZIP',
      percent: 93,
      currentItem: 'اطلاعات_کامل_سازمان.json',
      downloaded: result.downloaded,
      metadataWritten: result.metadataWritten + 1,
      failed: result.failed,
      bytesSaved: result.bytes,
    });
    result.archive = createPortableSyncArchive(entries, snapshot);
    publish({
      phase: result.failed ? 'نسخه ZIP آماده شد؛ بعضی فایل‌ها دریافت نشدند' : 'نسخه ZIP آماده شد',
      percent: 100,
      currentItem: 'CustomsOS-Backup.zip',
      foldersCreated: tree.folderByPath.size,
      downloaded: result.downloaded,
      metadataWritten: result.metadataWritten + 1,
      bytesSaved: result.archive.byteLength,
      failed: result.failed,
      conflicts: tree.folderConflicts.size,
    });
    return result;
  } catch (reason) {
    result.failed += 1;
    result.failures.push(reason instanceof Error ? reason.message : 'تهیه نسخه ZIP ناموفق بود.');
    publish({ phase: 'تهیه نسخه ZIP ناموفق بود', currentItem: result.failures[result.failures.length - 1], failed: result.failed });
    return result;
  }
}

export async function importPortableOrganizationFiles(
  organizationId: string,
  ownerRootName: string,
  inputs: PortableSyncInputFile[],
  getFileBlob: GetFileBlob,
  onProgress: ProgressCallback,
): Promise<PortableSyncResult> {
  const publish = createProgress(onProgress);
  const result: PortableSyncResult = {
    uploaded: 0, downloaded: 0, identical: 0, conflicts: 0,
    oversized: 0, failed: 0, foldersCreated: 0,
    metadataWritten: 0, bytes: 0, failures: [],
  };
  try {
    const tree = await fetchPortableTree(organizationId);
    const normalized = inputs
      .map((item) => ({
        file: item.file,
        relativePath: portablePath(item.relativePath || item.file.name, ownerRootName),
      }))
      .filter((item) => item.relativePath);
    if (!normalized.length) throw new Error('در پوشه یا ZIP انتخاب‌شده، سند اصلی قابل واردکردن پیدا نشد.');

    const localPathCounts = new Map<string, number>();
    for (const item of normalized) {
      const key = normalizeKey(item.relativePath);
      localPathCounts.set(key, (localPathCounts.get(key) || 0) + 1);
    }

    const folderIds = [...tree.folderPathById.keys()];
    const existingFiles = await fetchPortableFiles(organizationId, folderIds);
    const serverFilesByPath = new Map<string, PortableFileRow>();
    const ambiguousServerFiles = new Set<string>();
    for (const file of existingFiles) {
      const parentPath = tree.folderPathById.get(file.folder_id);
      if (parentPath === undefined) continue;
      const relativePath = (parentPath ? parentPath + '/' : '') + safeWindowsFileName(file.original_name);
      const key = normalizeKey(relativePath);
      if (serverFilesByPath.has(key)) ambiguousServerFiles.add(key);
      else serverFilesByPath.set(key, file);
    }

    const folders = new Map(tree.folderByPath);
    const ensureRemoteFolder = async (relativePath: string): Promise<PortableFolderRow> => {
      const existing = folders.get(relativePath);
      if (existing) return existing;
      const parts = relativePath.split('/').filter(Boolean);
      if (!parts.length) return tree.cloudRoot;
      const parentPath = parts.slice(0, -1).join('/');
      if (tree.folderConflicts.has(parentPath)) {
        throw new Error('مسیر پوشه در آرشیو مبهم است و برای جلوگیری از انتقال به پوشه اشتباه متوقف شد: ' + parentPath);
      }
      const parent = await ensureRemoteFolder(parentPath);
      const segment = parts[parts.length - 1];
      const folderKey = 'custom:' + folderSlug(segment);
      const { data: raced } = await supabase
        .from('file_manager_folders')
        .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
        .eq('organization_id', organizationId)
        .eq('parent_id', parent.id)
        .eq('folder_key', folderKey)
        .maybeSingle();
      let folder = raced as PortableFolderRow | null;
      if (!folder) {
        const { data, error } = await supabase
          .from('file_manager_folders')
          .insert({
            organization_id: organizationId,
            parent_id: parent.id,
            folder_key: folderKey,
            folder_type: 'custom',
            display_name: segment,
            client_id: parent.client_id,
            shipment_id: parent.shipment_id,
            customs_office_id: parent.customs_office_id,
            is_system: false,
          })
          .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
          .single();
        if (error) {
          const { data: afterRace } = await supabase
            .from('file_manager_folders')
            .select('id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at')
            .eq('organization_id', organizationId)
            .eq('parent_id', parent.id)
            .eq('folder_key', folderKey)
            .maybeSingle();
          if (!afterRace) throw error;
          folder = afterRace as PortableFolderRow;
        } else {
          folder = data as PortableFolderRow;
          result.foldersCreated += 1;
        }
      }
      folders.set(relativePath, folder);
      tree.folderPathById.set(folder.id, relativePath);
      return folder;
    };

    let destination: Awaited<ReturnType<typeof getFileArchiveDestination>> | null = null;
    for (let index = 0; index < normalized.length; index += 1) {
      const item = normalized[index];
      const relativePath = item.relativePath;
      const key = normalizeKey(relativePath);
      const slash = relativePath.lastIndexOf('/');
      const parentPath = slash >= 0 ? relativePath.slice(0, slash) : '';
      const filename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
      publish({
        phase: 'مقایسه و ارسال اسناد از دستگاه',
        percent: 5 + Math.round(((index + 1) / normalized.length) * 65),
        currentItem: relativePath,
      });

      try {
        if (localPathCounts.get(key) !== 1 || ambiguousServerFiles.has(key)) {
          result.conflicts += 1;
          continue;
        }
        const remote = serverFilesByPath.get(key);
        if (remote) {
          if (Number(remote.size_bytes) !== item.file.size) {
            result.conflicts += 1;
            continue;
          }
          const [localHash, remoteBlob] = await Promise.all([digest(item.file), getFileBlob(remote)]);
          if (localHash === await digest(remoteBlob)) result.identical += 1;
          else result.conflicts += 1;
          continue;
        }
        if (item.file.size <= 0 || item.file.size > FILE_ARCHIVE_MAX_BYTES) {
          result.oversized += 1;
          result.failures.push(relativePath + ': حجم فایل جدید برای آرشیو تلگرام باید حداکثر ۲۰ مگابایت باشد.');
          continue;
        }
        if (tree.folderConflicts.has(parentPath)) {
          result.conflicts += 1;
          continue;
        }
        const parent = await ensureRemoteFolder(parentPath);
        const uploadFile = item.file.name === filename ? item.file : new File([item.file], filename, {
          type: item.file.type || 'application/octet-stream',
          lastModified: item.file.lastModified,
        });
        destination ??= await getFileArchiveDestination();
        const documentType = parent.shipment_id ? parent.folder_type : 'TECHNICAL_SPEC_CATALOG';
        const idempotencyKey = await createTelegramArchiveIdempotencyKey(uploadFile, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType,
          documentName: filename,
          destination,
        });
        await uploadTelegramArchivedFile(uploadFile, {
          folderId: parent.id,
          ...(parent.shipment_id ? { shipmentId: parent.shipment_id } : {}),
          documentType,
          tags: [],
          destination,
          idempotencyKey,
        });
        result.uploaded += 1;
      } catch (reason) {
        result.failed += 1;
        result.failures.push(relativePath + ': ' +
          (reason instanceof Error ? reason.message : 'ارسال فایل ناموفق بود.'));
      }
      publish({
        phase: 'مقایسه و ارسال اسناد از دستگاه',
        percent: 5 + Math.round(((index + 1) / normalized.length) * 65),
        currentItem: relativePath,
        foldersCreated: result.foldersCreated,
        uploaded: result.uploaded,
        identical: result.identical,
        failed: result.failed,
        conflicts: result.conflicts,
        oversized: result.oversized,
      });
    }

    publish({
      phase: 'انتقال فایل‌های جدید پایان یافت',
      percent: 72,
      currentItem: 'آماده‌سازی نسخه کامل ZIP از آرشیو سازمان…',
      foldersCreated: result.foldersCreated,
      uploaded: result.uploaded,
      identical: result.identical,
      failed: result.failed,
      conflicts: result.conflicts,
      oversized: result.oversized,
    });
    return result;
  } catch (reason) {
    result.failed += 1;
    result.failures.push(reason instanceof Error ? reason.message : 'ورود فایل‌ها ناموفق بود.');
    publish({ phase: 'ورود فایل‌ها ناموفق بود', currentItem: result.failures[result.failures.length - 1], failed: result.failed });
    return result;
  }
}
