import React, { useEffect, useMemo, useRef, useState } from 'react';


import { downloadTelegramArchivedFile, FILE_ARCHIVE_MAX_BYTES, getDefaultShipmentUploadFolder } from '../lib/fileManager';
import { safeStorageFilename } from '../lib/safeStorageFilename';
import {
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
  Check,
  FileSearch,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PdfDocumentViewer from '../components/PdfDocumentViewer';
import { supabase } from '../lib/supabase';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { buildCargoName, formatCount } from '../lib/cargoNaming';
import { AddReminderButton } from '../features/reminders/AddReminderButton';
import { extractProformaInvoiceIdentity, normalizeDocumentExtractionDigits } from '../lib/customsDocumentExtraction';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).toString();

type DocType =
  | 'PROFORMA_INVOICE'
  | 'COMMERCIAL_INVOICE'
  | 'PACKING_LIST'
  | 'BILL_OF_LADING'
  | 'DELIVERY_ORDER'
  | 'WAREHOUSE_RECEIPT'
  | 'IMPORT_LICENSE'
  | 'CERTIFICATE_OF_ORIGIN'
  | 'INSPECTION_CERTIFICATE'
  | 'INSURANCE_POLICY'
  | 'SATA_PAYMENT_DOC'
  | 'TECHNICAL_SPEC_CATALOG'
  | 'POWER_OF_ATTORNEY'
  | 'CUSTOMS_DECLARATION_PRINT';

type Shipment = {
  id: string;
  case_id: string | null;
  bill_of_lading_no: string | null;
  vessel_name: string;
  quantity: number | null;
  quantity_unit: string;
  cargo_owner: string;
  cargo_description: string;
  display_name: string;
  customs_office_id: string | null;
  customs_office_label: string;
  customs_regime_label: string;
};

type Doc = {
  id: string;
  shipment_id: string | null;
  document_type: DocType | null;
  document_number?: string | null;
  issue_date?: string | null;
  issue_date_shamsi?: string | null;
  invoice_amount?: number | null;
  invoice_currency?: string | null;
  original_name: string;
  display_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  source: 'shipment_documents' | 'customs_documents';
  storage_backend?: 'supabase' | 'telegram';
  file_asset_id?: string | null;
  folder_id?: string | null;
  telegram_message_id?: string | null;
  telegram_archive_requested?: boolean;
};

const BUCKET = 'customs_documents';
const REGIME_LABELS: Record<string, string> = {import_definitive:'واردات قطعی',export_definitive:'صادرات قطعی',temporary_export:'صادرات موقت',import_temporary:'ورود موقت',temporary_processing:'ورود موقت برای پردازش',external_transit:'ترانزیت خارجی',internal_transit:'ترانزیت داخلی',re_export:'مرجوعی / اعاده به خارج',re_import:'ورود مجدد',cabotage:'کابوتاژ',customs_warehouse:'ورود به انبار گمرکی',free_zone:'رویه منطقه آزاد',other:'سایر رویه‌ها'};

const REQUIRED: DocType[] = [
  'PROFORMA_INVOICE',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'BILL_OF_LADING',
  'CERTIFICATE_OF_ORIGIN',
];

const TYPES: { v: DocType; l: string }[] = [
  { v: 'PROFORMA_INVOICE', l: 'پروفرما' },
  { v: 'COMMERCIAL_INVOICE', l: 'کامرشال اینویس' },
  { v: 'PACKING_LIST', l: 'پکینگ لیست' },
  { v: 'BILL_OF_LADING', l: 'بارنامه / B/L' },
  { v: 'DELIVERY_ORDER', l: 'ترخیصیه' },
  { v: 'WAREHOUSE_RECEIPT', l: 'قبض انبار' },
  { v: 'IMPORT_LICENSE', l: 'ثبت سفارش' },
  { v: 'CERTIFICATE_OF_ORIGIN', l: 'گواهی مبدأ' },
  { v: 'INSPECTION_CERTIFICATE', l: 'گواهی بازرسی' },
  { v: 'INSURANCE_POLICY', l: 'بیمه‌نامه' },
  { v: 'SATA_PAYMENT_DOC', l: 'اسناد ساتا' },
  { v: 'TECHNICAL_SPEC_CATALOG', l: 'آنالیز / کاتالوگ' },
  { v: 'POWER_OF_ATTORNEY', l: 'وکالت‌نامه' },
  { v: 'CUSTOMS_DECLARATION_PRINT', l: 'اظهارنامه / کوتاژ' },
];

const inferType = (name: string): DocType | null => {
  const n = name.toLowerCase();
  if (/proforma|pro forma|پروفرما|پروفورما/.test(n)) return 'PROFORMA_INVOICE';
  if (/commercial|سیاهه|کامرشال|invoice/.test(n)) return 'COMMERCIAL_INVOICE';
  if (/packing|pack list|عدل|بسته بندی|پکینگ/.test(n)) return 'PACKING_LIST';
  if (/bill of lading|b l|bl |بارنامه/.test(n)) return 'BILL_OF_LADING';
  if (/delivery order|do |ترخیصیه/.test(n)) return 'DELIVERY_ORDER';
  if (/warehouse|قبض انبار/.test(n)) return 'WAREHOUSE_RECEIPT';
  if (/import license|order registration|ثبت سفارش/.test(n)) return 'IMPORT_LICENSE';
  if (/origin|certificate of origin|گواهی مبدأ|گواهی مبدا/.test(n)) return 'CERTIFICATE_OF_ORIGIN';
  if (/inspection|sgs|بازرسی/.test(n)) return 'INSPECTION_CERTIFICATE';
  if (/insurance|بیمه/.test(n)) return 'INSURANCE_POLICY';
  if (/sata|ساتا|bank|بانک/.test(n)) return 'SATA_PAYMENT_DOC';
  if (/catalog|technical|آنالیز|کاتالوگ/.test(n)) return 'TECHNICAL_SPEC_CATALOG';
  if (/power|attorney|وکالت/.test(n)) return 'POWER_OF_ATTORNEY';
  if (/declaration|اظهارنامه|کوتاژ/.test(n)) return 'CUSTOMS_DECLARATION_PRINT';
  return null;
};

const label = (t: DocType | null) => TYPES.find((x) => x.v === t)?.l || 'سند';
const fileName = (d: Doc) =>
  String(d.original_name || d.display_name || d.storage_path?.split('/').pop() || 'سند بدون نام').replace(
    /^[0-9a-f-]{36}-/i,
    '',
  );
const isImage = (d: Doc) =>
  /^image\/(jpeg|jpg|png)$/i.test(d.mime_type || '') || /\.(jpe?g|png)$/i.test(fileName(d));
const isPdf = (d: Doc) =>
  /application\/pdf/i.test(d.mime_type || '') || /\.pdf$/i.test(fileName(d));
const sizeText = (n: number | null) =>
  !n ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

export const CustomsDocumentManagerPage: React.FC = () => {
  const [params] = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentId, setShipmentId] = useState(params.get('shipmentId') || '');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [tagInput, setTagInput] = useState('');
  const uploadTags = useMemo(() => [...new Set(tagInput.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20), [tagInput]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [extracting, setExtracting] = useState<Doc | null>(null);
  const [extracted, setExtracted] = useState<any[]>([]);
  const [extractProgress, setExtractProgress] = useState('');
  const [editingMetadataId, setEditingMetadataId] = useState<string | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataForm, setMetadataForm] = useState({ document_type: '', document_number: '', issue_date: '', issue_date_shamsi: '', invoice_amount: '', invoice_currency: '' });
  const [previewUrl, setPreviewUrl] = useState('');
  const [inputRef] = useState(() => React.createRef<HTMLInputElement>());
  const mounted = useRef(true);

  const profile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('کاربر وارد نشده است.');
    const { data, error } = await supabase
      .from('profiles')
      .select('organization_id,role')
      .eq('id', user.id)
      .single();
    if (error || !data?.organization_id) throw error || new Error('سازمان کاربر مشخص نیست.');
    return { user, org: data.organization_id as string, role: data.role as string };
  };

  const loadShipments = async () => {
    setBusy(true);
    setError('');
    try {
      const { org } = await profile();
      const [{ data: s, error: se }, { data: c, error: ce }, { data: v, error: ve }, { data: cl, error: cle }, { data: pre, error: preError }] =
        await Promise.all([
          supabase
            .from('shipments')
            .select('id,case_id,bill_of_lading_no,vessel_id,client_id,cargo_count,cargo_count_unit,display_name,customs_office_id')
            .eq('organization_id', org)
            .order('updated_at', { ascending: false }),
          supabase.from('cases').select('id,cargo_description,status').eq('organization_id', org),
          supabase.from('vessels').select('id,name').eq('organization_id', org),
          supabase.from('clients').select('id,name').eq('organization_id', org),
          supabase.from('shipment_customs_data').select('shipment_id,customs_office_id,customs_regime').eq('organization_id', org),
        ]);
      if (se) throw se;
      if (ce) throw ce;
      if (ve) throw ve;
      if (cle) throw cle;
      if (preError) throw preError;
      const pm = new Map((pre || []).map((x: any) => [x.shipment_id, x]));
      const { data: offices, error: oe } = await supabase.from('customs_offices').select('id,code,name,city');
      if (oe) throw oe;
      const om = new Map((offices || []).map((x: any) => [x.id, `${x.code} · ${x.name} — ${x.city}`]));
      const cm = new Map((c || []).map((x: any) => [x.id, x]));
      const vm = new Map((v || []).map((x: any) => [x.id, x.name || '']));
      const lm = new Map((cl || []).map((x: any) => [x.id, x.name || '']));
      const rows = (s || []).map((x: any) => {
        const owner = lm.get(x.client_id) || '';
        const vessel = vm.get(x.vessel_id) || '';
        const cc = cm.get(x.case_id);
        return {
          id: x.id,
          case_id: x.case_id || null,
          bill_of_lading_no: x.bill_of_lading_no || null,
          vessel_name: vessel,
          quantity: x.cargo_count ?? null,
          quantity_unit: x.cargo_count_unit || '',
          cargo_owner: owner,
          cargo_description: cc?.cargo_description || '',
          display_name: x.display_name || buildCargoName(x.cargo_count, x.cargo_count_unit, owner, vessel),
          customs_office_id: x.customs_office_id || null,
          customs_office_label: om.get(x.customs_office_id) || om.get(pm.get(x.id)?.customs_office_id) || 'گمرک هنوز انتخاب نشده',
          customs_regime_label: REGIME_LABELS[pm.get(x.id)?.customs_regime] || 'رویه انتخاب نشده',
        };
      });
      setShipments(rows);
      const requested = params.get('shipmentId');
      setShipmentId((prev) =>
        rows.some((x) => x.id === prev)
          ? prev
          : requested && rows.some((x) => x.id === requested)
            ? requested
            : rows[0]?.id || '',
      );
    } catch (e: any) {
      setError(e?.message || 'دریافت محموله‌ها ناموفق بود');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const loadDocs = async (id: string) => {
    if (!id) {
      setDocs([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const [canonicalResult, legacyResult, fileManagerResult] = await Promise.all([
        supabase.from('shipment_documents')
          .select('id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,storage_backend,file_asset_id,folder_id,telegram_message_id,telegram_archive_requested,document_type,document_number,issue_date,issue_date_shamsi,invoice_amount,invoice_currency,created_at,updated_at')
          .eq('shipment_id', id).eq('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('customs_documents')
          .select('id,shipment_id,document_type,document_number,issue_date,issue_date_shamsi,invoice_amount,currency,original_name,display_name,storage_path,mime_type,size_bytes,status,storage_backend,file_asset_id,folder_id,telegram_message_id,created_at')
          .eq('shipment_id', id).eq('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('file_manager_files').select('shipment_document_id,document_type').eq('shipment_id', id),
      ]);
      if (legacyResult.error) throw legacyResult.error;
      let canonical = canonicalResult.data as any[] | null;
      if (canonicalResult.error) {
        const schemaMessage = canonicalResult.error.message || '';
        if (!/column|schema cache/i.test(schemaMessage)) throw canonicalResult.error;
        const fallback = await supabase.from('shipment_documents')
          .select('id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,storage_backend,file_asset_id,folder_id,telegram_message_id,telegram_archive_requested,created_at,updated_at')
          .eq('shipment_id', id).eq('is_archived', false).order('created_at', { ascending: false });
        if (fallback.error) throw fallback.error;
        canonical = fallback.data as any[];
      }
      const fileManagerTypes = new Map<string, string>();
      for (const row of fileManagerResult.data || []) {
        if (row.shipment_document_id && row.document_type) fileManagerTypes.set(row.shipment_document_id, row.document_type);
      }
      const canonicalDocs: Doc[] = (canonical || []).map((d: any) => ({
        id: d.id,
        shipment_id: d.shipment_id,
        document_type: (d.document_type || fileManagerTypes.get(d.id) || null) as DocType | null,
        document_number: d.document_number || null,
        issue_date: d.issue_date || null,
        issue_date_shamsi: d.issue_date_shamsi || null,
        invoice_amount: d.invoice_amount == null ? null : Number(d.invoice_amount),
        invoice_currency: d.invoice_currency || null,
        original_name: d.original_file_name || d.document_name || '',
        display_name: d.document_name || d.original_file_name || null,
        storage_path: d.storage_path || null,
        mime_type: d.mime_type || null,
        size_bytes: d.file_size_bytes ?? null,
        status: 'canonical',
        storage_backend: d.storage_backend || 'supabase',
        file_asset_id: d.file_asset_id || null,
        folder_id: d.folder_id || null,
        telegram_message_id: d.telegram_message_id || null,
        telegram_archive_requested: d.telegram_archive_requested === true,
        source: 'shipment_documents',
      }));
      const canonicalIds = new Set(canonicalDocs.map((d) => d.id));
      const fallbackDocs: Doc[] = (legacyResult.data || [])
        .filter((d: any) => !canonicalIds.has(d.id))
        .map((d: any) => ({
          id: d.id,
          shipment_id: d.shipment_id,
          document_type: d.document_type || null,
          document_number: d.document_number || null,
          issue_date: d.issue_date || null,
          issue_date_shamsi: d.issue_date_shamsi || null,
          invoice_amount: d.invoice_amount == null ? null : Number(d.invoice_amount),
          invoice_currency: d.currency || null,
          original_name: d.original_name || '',
          display_name: d.display_name || null,
          storage_path: d.storage_path || null,
          mime_type: d.mime_type || null,
          size_bytes: d.size_bytes ?? null,
          status: d.status || 'legacy',
          storage_backend: d.storage_backend || 'supabase',
          file_asset_id: d.file_asset_id || null,
          folder_id: d.folder_id || null,
          telegram_message_id: d.telegram_message_id || null,
          source: 'customs_documents',
        }));
      setDocs([...canonicalDocs, ...fallbackDocs]);
    } catch (e: any) {
      setError(e?.message || 'دریافت اسناد ناموفق بود');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void loadShipments();
  }, []);
  useEffect(() => {
    void loadDocs(shipmentId);
  }, [shipmentId]);

  const current = shipments.find((x) => x.id === shipmentId);
  const filtered = useMemo(
    () =>
      docs.filter((d) => {
        const n = fileName(d);
        const t = d.document_type || inferType(n);
        return (!type || t === type) && (!q || `${n} ${label(t)}`.toLowerCase().includes(q.toLowerCase()));
      }),
    [docs, q, type],
  );
  const missing = REQUIRED.filter((t) => !docs.some((d) => (d.document_type || inferType(fileName(d))) === t));

  const upload = async (files: File[]) => {
    if (!files.length || !current) return;
    const acceptedFiles: File[] = [];
    const rejectedFiles: string[] = [];
    for (const file of files) {
      const name = file.name.toLowerCase();
      const mime = (file.type || (name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : /\\.jpe?g$/.test(name) ? 'image/jpeg' : '')).toLowerCase();
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mime)) {
        rejectedFiles.push(`«${file.name}»: فرمت پشتیبانی نمی‌شود.`);
      } else if (file.size <= 0 || file.size > FILE_ARCHIVE_MAX_BYTES) {
        rejectedFiles.push(`«${file.name}»: حجم باید حداکثر ۲۰ مگابایت باشد تا آرشیو تلگرام نیز قابل بازیابی باشد.`);
      } else {
        acceptedFiles.push(file);
      }
    }
    setPendingFiles(acceptedFiles);
    setBusy(true);
    setError(rejectedFiles.join('\n'));
    setMessage(acceptedFiles.length ? 'در حال ذخیره فایل در فضای امن سایت…' : '');
    let completed = 0;
    const failedFiles: File[] = [];
    try {
      if (!acceptedFiles.length) return;
      const [{ user, org }, folder] = await Promise.all([
        profile(),
        getDefaultShipmentUploadFolder(current.id),
      ]);
      for (const file of acceptedFiles) {
        let storagePath = '';
        let documentCreated = false;
        try {
          setMessage(`در حال بارگذاری «${file.name}» در فضای امن سایت…`);
          const lowerName = file.name.toLowerCase();
          const mime = (file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg')).toLowerCase();
          storagePath = `${org}/${current.id}/${crypto.randomUUID()}-${safeStorageFilename(file.name)}`;
          const { error: storageError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
            contentType: mime,
            cacheControl: '3600',
            upsert: false,
          });
          if (storageError) throw new Error(`ذخیره فایل در سایت ناموفق بود: ${storageError.message}`);

          const { data: document, error: documentError } = await supabase
            .from('shipment_documents')
            .insert({
              organization_id: org,
              shipment_id: current.id,
              uploaded_by: user.id,
              document_name: file.name,
              original_file_name: file.name,
              document_type: inferType(file.name),
              storage_path: storagePath,
              mime_type: mime,
              file_size_bytes: file.size,
              folder_id: folder.id,
              storage_backend: 'supabase',
              telegram_archive_requested: true,
              extraction_status: 'pending',
            })
            .select('id')
            .single();
          if (documentError || !document) {
            throw new Error(documentError?.message || 'ثبت سند محموله ناموفق بود.');
          }
          documentCreated = true;

          // File type is synchronized regardless of whether optional tags were supplied.
          const fileMetadataPatch: Record<string, unknown> = { document_type: inferType(file.name) || 'other' };
          if (uploadTags.length) fileMetadataPatch.tags = uploadTags;
          const { error: fileMetadataError } = await supabase
            .from('file_manager_files')
            .update(fileMetadataPatch)
            .eq('organization_id', org)
            .eq('shipment_document_id', document.id);
          if (fileMetadataError) console.warn('[CustomsDocumentManagerPage] File Manager metadata was not synchronized:', fileMetadataError);
          completed += 1;
          setPendingFiles((previous) => previous.filter((candidate) => candidate !== file));
        } catch (fileError: any) {
          if (storagePath && !documentCreated) {
            await supabase.storage.from(BUCKET).remove([storagePath]);
          }
          failedFiles.push(file);
          rejectedFiles.push(`«${file.name}»: ${fileError?.message || 'آپلود ناموفق بود.'}`);
        }
      }
      if (completed) {
        await loadDocs(current.id);
        setMessage(`${completed} سند فوراً در سایت ذخیره شد و در صف آرشیو پس‌زمینه تلگرام قرار گرفت. می‌توانید هم‌زمان مراحل دیگر را ادامه دهید.`);
      }
      setError(rejectedFiles.join('\n'));
      setPendingFiles(failedFiles);
      if (!completed && !failedFiles.length) setMessage('');
    } catch (fileError: any) {
      setError(fileError?.message || 'آماده‌سازی آپلود ناموفق بود.');
      setPendingFiles(acceptedFiles);
    } finally {
      setBusy(false);
    }
  };
  const beginEditMetadata = (d: Doc) => {
    setEditingMetadataId(d.id);
    setMetadataForm({
      document_type: d.document_type || inferType(fileName(d)) || '',
      document_number: d.document_number || '',
      issue_date: d.issue_date ? String(d.issue_date).slice(0, 10) : '',
      issue_date_shamsi: d.issue_date_shamsi || '',
      invoice_amount: d.invoice_amount == null ? '' : String(d.invoice_amount),
      invoice_currency: d.invoice_currency || '',
    });
    setError('');
  };

  const saveDocumentMetadata = async (d: Doc) => {
    setMetadataBusy(true);
    setError('');
    setMessage('');
    try {
      const { org } = await profile();
      const amountText = normalizeDocumentExtractionDigits(metadataForm.invoice_amount).replace(/[٬,\\s]/g, '');
      const amount = amountText.trim() ? Number(amountText) : null;
      if (amount !== null && !Number.isFinite(amount)) throw new Error('مبلغ فاکتور معتبر نیست.');
      const selectedType = metadataForm.document_type || null;
      const commonPatch = {
        document_type: d.source === 'customs_documents' && selectedType === 'other' ? null : selectedType,
        document_number: metadataForm.document_number.trim() || null,
        issue_date: metadataForm.issue_date || null,
        issue_date_shamsi: metadataForm.issue_date_shamsi.trim() || null,
        invoice_amount: amount,
      };
      const patch: Record<string, unknown> = d.source === 'customs_documents'
        ? { ...commonPatch, currency: metadataForm.invoice_currency.trim() || null }
        : { ...commonPatch, invoice_currency: metadataForm.invoice_currency.trim() || null };
      const { data: updated, error: updateError } = await supabase
        .from(d.source).update(patch)
        .eq('organization_id', org).eq('id', d.id)
        .select('id').maybeSingle();
      if (updateError) throw updateError;
      if (!updated?.id) throw new Error('سند پیدا نشد یا مجوز ویرایش آن وجود ندارد.');

      if (d.source === 'shipment_documents' && d.shipment_id) {
        const { error: syncError } = await supabase.from('file_manager_files')
          .update({ document_type: selectedType || 'other' })
          .eq('organization_id', org).eq('shipment_document_id', d.id).eq('shipment_id', d.shipment_id);
        if (syncError) console.warn('[CustomsDocumentManagerPage] File Manager document-type sync failed:', syncError);
      }

      const next: Doc = {
        ...d,
        document_type: (commonPatch.document_type || null) as DocType | null,
        document_number: commonPatch.document_number as string | null,
        issue_date: commonPatch.issue_date as string | null,
        issue_date_shamsi: commonPatch.issue_date_shamsi as string | null,
        invoice_amount: amount,
        invoice_currency: metadataForm.invoice_currency.trim() || null,
      };
      setDocs((previous) => previous.map((item) => item.id === d.id ? next : item));
      setSelected((previous) => previous?.id === d.id ? next : previous);
      setEditingMetadataId(null);
      setMessage('مشخصات مستقل این سند ذخیره شد؛ شماره و تاریخ سایر اسناد تغییر نکرد.');
    } catch (e: any) {
      setError(e?.message || 'ذخیره مشخصات سند ناموفق بود.');
    } finally {
      setMetadataBusy(false);
    }
  };

  const extractFields = async (d: Doc) => {
    if (d.storage_backend === 'telegram' || d.file_asset_id) {
      return setError('محتوای فایل‌های آرشیوشده در تلگرام طبق سیاست فایل‌منیجر برای OCR، استخراج یا تحلیل خوانده نمی‌شود.');
    }
    if (!d.storage_path) return;
    setExtracting(d);
    setExtracted([]);
    setExtractProgress('در حال دریافت سند از Storage...');
    const canonicalDocument = d.source === 'shipment_documents';
    const markExtraction = async (status: 'processing'|'completed'|'failed', errorMessage?: string) => {
      if (!canonicalDocument) return;
      const patch: any = {
        extraction_status: status,
        extraction_error: errorMessage || null,
        extraction_started_at: status === 'processing' ? new Date().toISOString() : undefined,
        extraction_completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : undefined,
      };
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
      await supabase.from('shipment_documents').update(patch).eq('id', d.id);
    };
    await markExtraction('processing');
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(d.storage_path);
      if (error) throw error;
      const out: any[] = [];
      const rules: [string, RegExp][] = [
        ['شماره ثبت سفارش', /(?:ثبت\s*سفارش|registration\s*order)[^\d\n]{0,40}([0-9۰-۹]{6,20})/i],
        ['شماره بارنامه', /(?:B\s*[/]\s*L|BILL\s+OF\s+LADING|بارنامه)[^A-Z0-9۰-۹]{0,30}([A-Z0-9۰-۹-]{5,40})/i],
        ['کد تعرفه', /(?:HS\s*(?:CODE|NO)?|کد\s*تعرفه)[^0-9۰-۹]{0,15}([0-9۰-۹]{6,12})/i],
        ['تعداد', /(?:quantity|qty|مقدار|تعداد)[^0-9۰-۹]{0,20}([0-9۰-۹.,]+)/i],
        ['وزن ناخالص', /(?:gross\s*weight|وزن\s*ناخالص)[^0-9۰-۹]{0,20}([0-9۰-۹.,]+)/i],
        ['وزن خالص', /(?:net\s*weight|وزن\s*خالص)[^0-9۰-۹]{0,20}([0-9۰-۹.,]+)/i],
      ];
      const norm = normalizeDocumentExtractionDigits;

      if ((d.mime_type || '').toLowerCase() === 'application/pdf' || isPdf(d)) {
        const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
        for (let n = 1; n <= pdf.numPages; n++) {
          setExtractProgress(`خواندن صفحه ${n} از ${pdf.numPages}`);
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          const text = tc.items.map((x: any) => x.str || '').join(' ');
          for (const [rkey, re] of rules) {
            if (out.some((x) => x.key === rkey)) continue;
            const m = text.match(re);
            if (m) out.push({ key: rkey, label: rkey, value: norm(m[1]), sourceText: m[0], page: n, source: 'PDF text', confidence: 0.9 });
          }
          for (const field of extractProformaInvoiceIdentity(text, n, 'PDF text', 0.9)) {
            if (!out.some((x) => x.key === field.key)) out.push(field);
          }
        }
      } else if ((d.mime_type || '').startsWith('image/') || isImage(d)) {
        setExtractProgress('OCR فارسی/انگلیسی در حال اجراست…');
        const worker = await createWorker('fas+eng');
        try {
          const { data } = await worker.recognize(blob);
          for (const [rkey, re] of rules) {
            const m = data.text.match(re);
            if (m) out.push({ key: rkey, label: rkey, value: norm(m[1]), sourceText: m[0], page: 1, source: 'Tesseract OCR', confidence: 0.82 });
          }
          for (const field of extractProformaInvoiceIdentity(data.text, 1, 'Tesseract OCR', 0.82)) {
            if (!out.some((x) => x.key === field.key)) out.push(field);
          }
        } finally {
          await worker.terminate();
        }
      }
      setExtracted(out);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (canonicalDocument && user && out.length) {
        const { data: p } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
        if (p?.organization_id) {
          const rows = out.map((x) => ({
            organization_id: p.organization_id,
            shipment_id: d.shipment_id,
            document_id: d.id,
            field_key: x.key,
            field_label: x.label || x.key,
            extracted_value: x.value,
            source_text: x.sourceText || null,
            confidence: x.confidence,
            page_number: x.page,
            extraction_method: x.source,
          }));
          const { error: ee } = await supabase
            .from('shipment_document_extractions')
            .upsert(rows, { onConflict: 'shipment_id,document_id,field_key' });
          if (ee) throw ee;
        }
      }
      await markExtraction('completed');
      setExtractProgress('');
    } catch (e: any) {
      const message = e?.message || 'استخراج اطلاعات سند ناموفق بود';
      try { await markExtraction('failed', message); } catch {}
      setExtractProgress('');
      setError(message);
    }
  };

  const preview = async (d: Doc) => {
    if (d.storage_backend === 'telegram' && d.file_asset_id) {
      try {
        const blob = await downloadTelegramArchivedFile(d.file_asset_id);
        const url = URL.createObjectURL(blob);
        setSelected(d);
        setPreviewUrl(url);
      } catch (e: any) { setError(e?.message || 'نمایش سند تلگرام ناموفق بود'); }
      return;
    }
    if (!d.storage_path) return setError('مسیر فایل ثبت نشده است.');
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 3600);
    if (error || !data?.signedUrl) {
      return setError(`نمایش فایل ناموفق بود: ${error?.message || 'لینک امن ساخته نشد'}`);
    }
    setSelected(d);
    setPreviewUrl(data.signedUrl);
  };

  const download = async (d: Doc) => {
    if (d.storage_backend === 'telegram' && d.file_asset_id) {
      try {
        const blob = await downloadTelegramArchivedFile(d.file_asset_id);
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = fileName(d);
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(u), 2000);
      } catch (e: any) { setError(e?.message || 'دانلود سند تلگرام ناموفق بود'); }
      return;
    }
    if (!d.storage_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).download(d.storage_path);
    if (error) return setError(`دانلود ناموفق بود: ${error.message}`);
    const u = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = u;
    a.download = fileName(d);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  const setStatus = async (d: Doc, status: string) => {
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase
        .from('customs_documents')
        .update({
          status,
          reviewed_at: ['approved', 'rejected'].includes(status) ? new Date().toISOString() : null,
        })
        .eq('id', d.id);
      if (error) throw error;
      setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, status } : x)));
      setSelected((prev) => (prev?.id === d.id ? { ...prev, status } : prev));
    } catch (e: any) {
      setError(e?.message || 'تغییر وضعیت سند ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main dir="rtl" className="customs-document-manager-page min-h-screen p-4 md:p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">فایل‌های محموله</h1>
            <p className="text-xs app-muted mt-1">
              آپلود اسناد اختیاری است؛ نبودن سند فقط هشدار است و مانع کار با پرونده نمی‌شود.
            </p>
            {current && <p className="text-xs mt-2 font-bold">گمرک محل اظهار: {current.customs_office_label} · رویه گمرکی: {current.customs_regime_label}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => current && docs[0] && void extractFields(docs[0])}
              disabled={!current || !docs.length || busy}
              className="rounded-xl px-4 py-3 bg-[var(--primary)] text-white font-bold disabled:opacity-50"
            >
              <FileSearch size={16} className="inline ml-2" />
              استخراج اطلاعات
            </button>
            <button className="icon-btn" onClick={() => void loadShipments()} title="بروزرسانی">
              <RefreshCw size={17} />
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700">
            {error}
            <button className="float-left" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <section className="rounded-2xl border app-border bg-[var(--surface)] p-4">
          <div className="flex flex-col md:flex-row gap-3 items-end">
            <label className="block flex-1 w-full">
              <span className="text-xs app-muted">محموله</span>
              <select
                value={shipmentId}
                onChange={(e) => setShipmentId(e.target.value)}
                className="mt-1 w-full rounded-xl border app-border bg-[var(--surface-2)] p-3"
              >
                {!shipments.length && <option value="">محموله‌ای یافت نشد</option>}
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name} — B/L: {s.bill_of_lading_no || '—'} — گمرک: {s.customs_office_label} — رویه: {s.customs_regime_label}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!current || busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-xl px-4 py-3 bg-[var(--primary)] text-white font-bold disabled:opacity-50"
            >
              <Upload size={16} className="inline ml-2" />
              آپلود فایل
            </button>
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png"
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files || []);
                e.currentTarget.value = '';
                if (files.length) void upload(files);
              }}
            />
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-bold app-muted">برچسب‌های اسناد (اختیاری، با ویرگول جدا کنید)</span>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} disabled={busy}
              placeholder="مثلاً: بارنامه، فاکتور، قبض انبار، گواهی مبدأ"
              className="w-full rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-sm" />
          </label>
          {pendingFiles.length > 0 && (
            <div className="mt-3 rounded-2xl border app-border bg-[var(--surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold">{pendingFiles.length} فایل هنوز ذخیره نشده است</div>
                  <div className="text-[11px] app-muted mt-1 break-all">{pendingFiles.map((file) => file.name).join('، ')}</div>
                  <div className="text-[11px] app-muted mt-1">فایل‌ها در مرورگر انتخاب می‌شوند؛ پس از ذخیره امن، آرشیو تلگرام به‌صورت مستقل در پس‌زمینه ادامه پیدا می‌کند.</div>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void upload(pendingFiles)} className="rounded-xl px-3 py-2 bg-[var(--primary)] text-white text-xs font-bold disabled:opacity-50">تلاش دوباره</button>
                  <button type="button" disabled={busy} onClick={() => setPendingFiles([])} className="rounded-xl px-3 py-2 border app-border text-xs">لغو</button>
                </div>
              </div>
            </div>
          )}
          {current && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <span className="app-muted text-xs block">نام محموله</span>
                <b>{current.display_name}</b>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <span className="app-muted text-xs block">صاحب کالا</span>
                <b>{current.cargo_owner || '—'}</b>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <span className="app-muted text-xs block">تعداد</span>
                <b>
                  {formatCount(current.quantity)} {current.quantity_unit}
                </b>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <span className="app-muted text-xs block">کشتی</span>
                <b>{current.vessel_name || '—'}</b>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <span className="app-muted text-xs block">مدارک پایه ناقص</span>
                <b className={missing.length ? 'text-amber-600' : 'text-emerald-600'}>
                  {missing.length ? `${missing.length} مورد` : 'کامل'}
                </b>
              </div>
            </div>
          )}
        </section>

        {current && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
            <div className="font-black text-sm">هشدار مدارک</div>
            <div className="text-xs mt-1">
              مدارک پایه زیر هنوز ثبت نشده‌اند:{' '}
              {missing.length ? missing.map(label).join('، ') : 'همه مدارک پایه ثبت شده‌اند'}.
            </div>
            <div className="text-[11px] app-muted mt-1">این هشدار است و هیچ آپلود یا مرحله‌ای را اجباری نمی‌کند.</div>
          </div>
        )}

        <section className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={17} className="absolute right-3 top-3.5 app-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجوی نام فایل یا نوع سند..."
              className="w-full rounded-xl border app-border bg-[var(--surface)] p-3 pr-10"
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-xl border app-border bg-[var(--surface)] p-3"
          >
            <option value="">همه اسناد</option>
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </section>

        {busy && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {!busy && !filtered.length && (
          <div className="rounded-2xl border app-border bg-[var(--surface)] p-10 text-center app-muted">
            برای این محموله هنوز فایلی ثبت نشده است. می‌توانید بدون آپلود سند ادامه دهید.
          </div>
        )}
        {filtered.length > 0 && (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((d) => (
              <article key={d.id} className="rounded-2xl border app-border bg-[var(--surface)] p-3">
                <button onClick={() => void preview(d)} className="w-full text-right">
                  <div className="h-32 rounded-xl bg-[var(--surface-2)] flex items-center justify-center">
                    {isImage(d) ? <ImageIcon size={50} /> : <FileText size={50} />}
                  </div>
                  <div className="mt-3 font-bold text-sm break-all">{fileName(d)}</div>
                  <div className="text-xs app-muted mt-1">
                    {label(d.document_type || inferType(fileName(d)))} · {sizeText(d.size_bytes) || '—'}
                  </div>
                  <div className="text-[11px] app-muted mt-1">
                    {d.storage_backend === 'telegram' && d.file_asset_id
                      ? 'آرشیو تلگرام آماده است'
                      : d.telegram_archive_requested
                        ? 'ذخیره امن انجام شد · در صف ارسال پس‌زمینه به تلگرام'
                        : 'ذخیره امن در سایت'}
                  </div>
                </button>
                {(d.document_number || d.issue_date || d.issue_date_shamsi || d.invoice_amount != null) && (
                  <div className="mt-2 rounded-lg bg-[var(--surface-2)] p-2 text-[11px] app-muted">
                    {d.document_number && <div>شماره سند: <b dir="ltr" className="text-[var(--text)]">{d.document_number}</b></div>}
                    {(d.issue_date_shamsi || d.issue_date) && <div>تاریخ سند: <b dir="ltr" className="text-[var(--text)]">{d.issue_date_shamsi || d.issue_date}</b></div>}
                    {d.invoice_amount != null && <div>مبلغ این سند: <b dir="ltr" className="text-[var(--text)]">{d.invoice_amount} {d.invoice_currency || ''}</b></div>}
                  </div>
                )}
                <button type="button" className="mt-2 w-full rounded-lg border app-border px-2 py-1.5 text-xs" onClick={() => beginEditMetadata(d)}>
                  ویرایش شماره، تاریخ و مبلغ این سند
                </button>
                {editingMetadataId === d.id && (
                  <div className="mt-2 space-y-2 rounded-xl border app-border bg-[var(--surface-2)] p-2">
                    <label className="block text-[11px] app-muted">نوع سند
                      <select value={metadataForm.document_type} onChange={(e) => setMetadataForm((p) => ({ ...p, document_type: e.target.value }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs">
                        <option value="">تشخیص‌داده‌نشده</option>
                        {TYPES.map((item) => <option key={item.v} value={item.v}>{item.l}</option>)}
                        <option value="other">سایر</option>
                      </select>
                    </label>
                    <label className="block text-[11px] app-muted">شماره همین سند
                      <input value={metadataForm.document_number} onChange={(e) => setMetadataForm((p) => ({ ...p, document_number: e.target.value }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs" dir="auto" />
                    </label>
                    <label className="block text-[11px] app-muted">تاریخ میلادی
                      <input type="date" value={metadataForm.issue_date} onChange={(e) => setMetadataForm((p) => ({ ...p, issue_date: e.target.value }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs" />
                    </label>
                    <label className="block text-[11px] app-muted">تاریخ شمسی / متن اصلی سند
                      <input value={metadataForm.issue_date_shamsi} onChange={(e) => setMetadataForm((p) => ({ ...p, issue_date_shamsi: e.target.value }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs" dir="auto" placeholder="بدون تبدیل خودکار تقویم" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] app-muted">مبلغ فاکتور
                        <input inputMode="decimal" value={metadataForm.invoice_amount} onChange={(e) => setMetadataForm((p) => ({ ...p, invoice_amount: e.target.value }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs" />
                      </label>
                      <label className="text-[11px] app-muted">ارز
                        <input value={metadataForm.invoice_currency} onChange={(e) => setMetadataForm((p) => ({ ...p, invoice_currency: e.target.value.toUpperCase() }))} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface)] p-2 text-xs" placeholder="USD / AED" />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void saveDocumentMetadata(d)} disabled={metadataBusy} className="flex-1 rounded-lg bg-[var(--primary)] px-2 py-2 text-xs font-bold text-white">{metadataBusy ? 'در حال ذخیره…' : 'ذخیره مشخصات'}</button>
                      <button type="button" onClick={() => setEditingMetadataId(null)} disabled={metadataBusy} className="rounded-lg border app-border px-3 py-2 text-xs">انصراف</button>
                    </div>
                  </div>
                )}
                <div className="flex gap-1 mt-2">
                  <button className="icon-btn flex-1" onClick={() => void preview(d)} title="نمایش">
                    <Eye size={15} />
                  </button>
                  <button className="icon-btn flex-1" onClick={() => void extractFields(d)} title="استخراج اطلاعات">
                    <FileSearch size={15} />
                  </button>
                  <button className="icon-btn flex-1" onClick={() => void download(d)} title="دانلود">
                    <Download size={15} />
                  </button>
                  <div className="flex-1"><AddReminderButton entityType={d.source} entityId={d.id} defaultTitle={'پیگیری سند '+fileName(d)}/></div>
                </div>
              </article>
            ))}
          </section>
        )}

        {extracting && (
          <div className="rounded-2xl border app-border bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2">
              <FileSearch size={18} />
              <b className="flex-1">استخراج اطلاعات: {fileName(extracting)}</b>
              <button
                className="icon-btn"
                onClick={() => {
                  setExtracting(null);
                  setExtractProgress('');
                }}
              >
                <X size={17} />
              </button>
            </div>
            {extractProgress && <div className="text-xs app-muted mt-3">{extractProgress}</div>}
            {!extractProgress && !extracted.length && (
              <div className="text-sm app-muted mt-3">اطلاعات قابل استخراج پیدا نشد.</div>
            )}
            {extracted.length > 0 && (
              <div className="grid md:grid-cols-2 gap-2 mt-3">
                {extracted.map((x: any) => (
                  <div key={x.key} className="rounded-xl border app-border bg-[var(--surface-2)] p-3">
                    <div className="font-bold">{x.label || x.key}</div>
                    <div className="text-lg font-black mt-1" dir="ltr">
                      {x.value}
                    </div>
                    <div className="text-[11px] app-muted mt-1">
                      صفحه {x.page} · {x.source} · اطمینان {Math.round(x.confidence * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selected && previewUrl && isImage(selected) && (
          <div
            className="fixed inset-0 z-50 bg-black/70 p-4"
            onClick={() => {
              setSelected(null);
              setPreviewUrl('');
            }}
          >
            <div
              className="h-full bg-[var(--surface)] rounded-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-3 flex items-center gap-2 border-b app-border">
                <b className="flex-1 break-all">{fileName(selected)}</b>
                <button className="icon-btn" onClick={() => void setStatus(selected, 'approved')} title="تأیید">
                  <Check size={16} />
                </button>
                <button className="icon-btn" onClick={() => void download(selected)} title="دانلود">
                  <Download size={16} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setSelected(null);
                    setPreviewUrl('');
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                <img src={previewUrl} alt={fileName(selected)} className="max-w-full max-h-full object-contain" />
              </div>
            </div>
          </div>
        )}

        {selected && previewUrl && isPdf(selected) && (
          <PdfDocumentViewer
            url={previewUrl}
            name={fileName(selected)}
            onClose={() => {
              setSelected(null);
              setPreviewUrl('');
            }}
            onDownload={() => void download(selected)}
          />
        )}
      </div>
    </main>
  );
};

export default CustomsDocumentManagerPage;
