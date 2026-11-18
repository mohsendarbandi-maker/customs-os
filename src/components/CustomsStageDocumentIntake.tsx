import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, RefreshCw, Sparkles, UploadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { safeStorageFilename } from '../lib/safeStorageFilename';
import {
  CUSTOMS_DOCUMENT_TYPE_OPTIONS,
  normalizeCustomsExtractionAnswer,
  type CustomsStageField,
  type CustomsDocumentType,
} from '../lib/customsStageExtraction';

type DocumentRow = {
  id: string;
  original_name: string;
  display_name: string | null;
  document_type: CustomsDocumentType | null;
  description: string | null;
  tags: string[];
  operation_stage: string | null;
  extraction: Record<string, unknown> | null;
  extraction_status: string;
  extraction_error: string | null;
  storage_path: string | null;
  file_asset_id: string | null;
  storage_backend: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type PendingDocument = {
  id: string;
  file: File;
  displayName: string;
  documentType: CustomsDocumentType;
  description: string;
  tagsText: string;
};

type Props = {
  declarationId: string;
  organizationId: string;
  userId?: string;
  stage: string;
  stageLabel: string;
  fields: CustomsStageField[];
  editable: boolean;
  onApply?: (values: Record<string, unknown>) => void;
};

const BUCKET = 'customs_documents';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const isAllowedFile = (file: File) =>
  ['application/pdf', 'image/jpeg', 'image/png'].includes(String(file.type || '').toLowerCase()) ||
  /\.(pdf|jpe?g|png)$/i.test(file.name);

const mimeFor = (file: File) => {
  const mime = String(file.type || '').toLowerCase();
  if (mime) return mime;
  const name = file.name.toLowerCase();
  return name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg';
};

const makePending = (file: File): PendingDocument => ({
  id: crypto.randomUUID(),
  file,
  displayName: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || file.name,
  documentType: 'TECHNICAL_SPEC_CATALOG',
  description: '',
  tagsText: '',
});

const parseTags = (value: string) =>
  [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);

const normalizedFields = (fields: CustomsStageField[]) =>
  fields.slice(0, 60).map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type || field.kind || 'text',
    required: Boolean(field.required),
    options: field.options || [],
  }));

export const CustomsStageDocumentIntake: React.FC<Props> = ({
  declarationId, organizationId, userId, stage, stageLabel, fields, editable, onApply,
}) => {
  const [declaration, setDeclaration] = useState<{ shipment_id: string | null; case_id: string | null; client_id: string | null } | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [extractingId, setExtractingId] = useState('');
  const autoExtractionStarted = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const schema = useMemo(() => normalizedFields(fields), [fields]);

  const load = useCallback(async () => {
    if (!declarationId || !organizationId) return;
    const { data: declarationRow, error: declarationError } = await supabase.from('customs_declarations')
      .select('shipment_id,case_id')
      .eq('id', declarationId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (declarationError) throw declarationError;
    const shipmentId = declarationRow?.shipment_id || null;
    let documentQuery = supabase.from('customs_documents')
      .select('id,original_name,display_name,document_type,description,tags,operation_stage,extraction,extraction_status,extraction_error,storage_path,file_asset_id,storage_backend,mime_type,size_bytes,created_at')
      .eq('organization_id', organizationId)
      .eq('operation_stage', stage)
      .eq('is_archived', false);
    documentQuery = shipmentId
      ? documentQuery.or('declaration_id.eq.' + declarationId + ',shipment_id.eq.' + shipmentId)
      : documentQuery.eq('declaration_id', declarationId);
    const { data: docs, error: docsError } = await documentQuery.order('created_at', { ascending: false });
    if (docsError) throw docsError;
    let clientId: string | null = null;
    if (shipmentId) {
      const { data: shipment, error: shipmentError } = await supabase.from('shipments')
        .select('client_id')
        .eq('id', shipmentId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (shipmentError) throw shipmentError;
      clientId = shipment?.client_id || null;
    } else if (declarationRow?.case_id) {
      const { data: caseRow, error: caseError } = await supabase.from('cases')
        .select('client_id')
        .eq('id', declarationRow.case_id)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (caseError) throw caseError;
      clientId = caseRow?.client_id || null;
    }
    setDeclaration({ shipment_id: shipmentId, case_id: declarationRow?.case_id || null, client_id: clientId });
    setDocuments((docs || []) as DocumentRow[]);
  }, [declarationId, organizationId, stage]);

  useEffect(() => {
    let active = true;
    void load().catch((cause: any) => {
      if (active) setError(cause?.message || 'دریافت اسناد مرحله انجام نشد.');
    });
    return () => { active = false; };
  }, [load]);

  const updatePending = (id: string, patch: Partial<PendingDocument>) =>
    setPending((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));

  const extractDocument = useCallback(async (document: DocumentRow) => {
    if (!document.storage_path && !document.file_asset_id) throw new Error('مسیر امن یا شناسه آرشیو فایل ثبت نشده است.');
    autoExtractionStarted.current.add(document.id);
    setExtractingId(document.id);
    setError('');
    try {
      const { error: startError } = await supabase.from('customs_documents')
        .update({ extraction_status: 'processing', extraction_error: null } as any)
        .eq('id', document.id).eq('organization_id', organizationId);
      if (startError) throw startError;
      const { data, error: invokeError } = await supabase.functions.invoke('ai-assistant', {
        body: {
          query: 'این سند مربوط به بخش «' + stageLabel + '» از عملیات گمرکی است. فقط اطلاعاتی را استخراج کن که صریحاً در سند دیده می‌شود. شماره‌ها، مبالغ، وزن‌ها و تاریخ‌ها را حدس نزن. برای فیلد ناموجود مقدار خالی برگردان. مقادیر موجود در فرم را تغییر نده و صرفاً JSON مطابق schema بده.',
          extract_fields: true,
          ...(document.file_asset_id ? { telegram_file_asset_id: document.file_asset_id } : { document_storage_path: document.storage_path }),
          document_mime_type: document.mime_type || 'application/octet-stream',
          document_size_bytes: document.size_bytes || 0,
          page_context: 'Customs OS / ' + stageLabel + ' / Declaration ' + declarationId + ' / Document ' + document.display_name,
          form_schema: schema,
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(String(data.error));
      const parsed = normalizeCustomsExtractionAnswer(data);
      const extraction = {
        fields: parsed,
        stage,
        stageLabel,
        provider: data?.provider || null,
        extractedAt: new Date().toISOString(),
      };
      const { error: updateError } = await supabase.from('customs_documents')
        .update({
          extraction,
          extraction_status: 'completed',
          extraction_error: null,
          extraction_completed_at: new Date().toISOString(),
        } as any)
        .eq('id', document.id)
        .eq('organization_id', organizationId);
      if (updateError) throw updateError;
      setDocuments((previous) => previous.map((item) => item.id === document.id
        ? { ...item, extraction, extraction_status: 'completed', extraction_error: null }
        : item));
      setMessage('اطلاعات سند «' + (document.display_name || document.original_name) + '» برای بخش «' + stageLabel + '» استخراج و ذخیره شد.');
    } catch (cause: any) {
      const reason = cause?.message || 'استخراج هوشمند سند ناموفق بود.';
      await supabase.from('customs_documents').update({
        extraction_status: 'failed',
        extraction_error: reason.slice(0, 2000),
        extraction_completed_at: new Date().toISOString(),
      } as any).eq('id', document.id).eq('organization_id', organizationId);
      setDocuments((previous) => previous.map((item) => item.id === document.id
        ? { ...item, extraction_status: 'failed', extraction_error: reason }
        : item));
      setError(reason);
    } finally {
      setExtractingId('');
    }
  }, [declarationId, organizationId, schema, stage, stageLabel]);

  useEffect(() => {
    if (!editable) return;
    const pendingDocuments = documents.filter((document) =>
      document.extraction_status === 'pending' &&
      Boolean(document.storage_path || document.file_asset_id) &&
      !autoExtractionStarted.current.has(document.id)
    );
    if (!pendingDocuments.length) return;
    void (async () => {
      for (const document of pendingDocuments) {
        if (autoExtractionStarted.current.has(document.id)) continue;
        autoExtractionStarted.current.add(document.id);
        await extractDocument(document);
      }
    })();
  }, [documents, editable, extractDocument]);

  const saveOne = async (item: PendingDocument) => {
    if (!declaration) throw new Error('اطلاعات اظهارنامه بارگذاری نشده است.');
    const file = item.file;
    if (!isAllowedFile(file)) throw new Error('فقط PDF، JPG و PNG پشتیبانی می‌شود.');
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('حجم هر سند باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
    const mime = mimeFor(file);
    const basePath = declaration.shipment_id || declarationId;
    const storagePath = organizationId + '/' + basePath + '/' + crypto.randomUUID() + '-' + safeStorageFilename(file.name);
    const { error: storageError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });
    if (storageError) throw new Error('ذخیره فایل اصلی ناموفق بود: ' + storageError.message);
    let documentSaved = false;
    try {
      const { data: row, error: insertError } = await supabase.from('customs_documents').insert({
        organization_id: organizationId,
        shipment_id: declaration.shipment_id,
        case_id: declaration.case_id,
        client_id: declaration.client_id,
        declaration_id: declarationId,
        original_name: file.name,
        display_name: item.displayName.trim() || file.name,
        document_type: item.documentType,
        description: item.description.trim() || null,
        tags: parseTags(item.tagsText),
        operation_stage: stage,
        storage_path: storagePath,
        mime_type: mime,
        size_bytes: file.size,
        created_by: userId || null,
        status: 'review',
        extraction_status: 'pending',
      } as any).select('id,original_name,display_name,document_type,description,tags,operation_stage,extraction,extraction_status,extraction_error,storage_path,file_asset_id,storage_backend,mime_type,size_bytes,created_at').single();
      if (insertError || !row) throw insertError || new Error('ثبت مستقل سند در فایل‌منیجر ناموفق بود.');
      documentSaved = true;
      const saved = row as DocumentRow;
      setDocuments((previous) => [saved, ...previous]);
      setPending((previous) => previous.filter((entry) => entry.id !== item.id));
      await extractDocument(saved);
    } catch (cause) {
      if (!documentSaved) await supabase.storage.from(BUCKET).remove([storagePath]);
      throw cause;
    }
  };

  const archivePending = async () => {
    if (!pending.length || !editable || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    let stored = 0;
    for (const item of [...pending]) {
      try {
        await saveOne(item);
        stored += 1;
      } catch (cause: any) {
        setError('فایل «' + item.file.name + '»: ' + (cause?.message || 'ذخیره ناموفق بود.'));
        break;
      }
    }
    setBusy(false);
    if (stored) await load().catch(() => undefined);
    if (stored) setMessage(stored + ' فایل به‌صورت مستقل ذخیره شد؛ هر فایل جداگانه برای استخراج هوشمند ارسال شد.');
  };

  const apply = (document: DocumentRow) => {
    const values = document.extraction?.fields;
    if (!values || typeof values !== 'object' || !onApply) return;
    onApply(values as Record<string, unknown>);
    setMessage('مقادیر استخراج‌شده در فرم همین بخش به‌صورت پیش‌نویس اعمال شد؛ پیش از ذخیره نهایی، آن‌ها را بازبینی کنید.');
  };

  return <section dir="rtl" className="rounded-2xl border app-border bg-[var(--surface)] p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-black">اسناد هوشمند این بخش · {stageLabel}</h3><p className="mt-1 text-xs app-muted">هر فایل رکورد مستقل دارد؛ نام اصلی حفظ می‌شود و نام نمایشی، نوع، توضیح، برچسب‌ها و داده‌های AI جداگانه نگهداری می‌شوند.</p></div>
      <button type="button" onClick={() => void load().catch((cause: any) => setError(cause?.message || 'بارگذاری اسناد ناموفق بود.'))} className="rounded-lg border app-border p-2" aria-label="بازخوانی اسناد"><RefreshCw size={15}/></button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600"><AlertTriangle size={14} className="inline ml-1"/>{error}</div>}
    {message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">{message}</div>}
    {editable && <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white"><UploadCloud size={16}/>انتخاب اسناد این بخش<input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple className="hidden" disabled={busy} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; setPending((previous) => [...previous, ...files.map(makePending)]); }}/></label>
      {pending.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border app-border p-3 md:grid-cols-2">
        <label className="text-xs app-muted">نام نمایشی<input value={item.displayName} disabled={busy} onChange={(event) => updatePending(item.id, { displayName: event.target.value })} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"/></label>
        <label className="text-xs app-muted">نوع سند<select value={item.documentType} disabled={busy} onChange={(event) => updatePending(item.id, { documentType: event.target.value as CustomsDocumentType })} className="mt-1 w-full rounded-lg border app-border bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]">{CUSTOMS_DOCUMENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="text-xs app-muted md:col-span-2">توضیحات مستقل<input value={item.description} disabled={busy} onChange={(event) => updatePending(item.id, { description: event.target.value })} placeholder="محتوای سند یا توضیح تکمیلی" className="mt-1 w-full rounded-lg border app-border bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"/></label>
        <label className="text-xs app-muted md:col-span-2">برچسب‌های همین فایل<input value={item.tagsText} disabled={busy} onChange={(event) => updatePending(item.id, { tagsText: event.target.value })} placeholder="فاکتور، گمرک، پیگیری…" className="mt-1 w-full rounded-lg border app-border bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"/></label>
        <div className="flex items-center justify-between gap-2 text-xs app-muted md:col-span-2"><span className="min-w-0 truncate">{item.file.name} · {(item.file.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" onClick={() => setPending((previous) => previous.filter((entry) => entry.id !== item.id))} disabled={busy} className="text-rose-600">حذف از صف</button></div>
      </div>)}
      {pending.length > 0 && <button type="button" onClick={() => void archivePending()} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}ذخیره جداگانه و استخراج AI برای هر فایل</button>}
    </div>}
    {documents.length === 0 && <p className="text-xs app-muted">هنوز سندی برای این بخش ثبت نشده است.</p>}
    {documents.map((document) => {
      const extracted = document.extraction?.fields && typeof document.extraction.fields === 'object'
        ? Object.entries(document.extraction.fields as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
        : [];
      return <article key={document.id} className="rounded-xl border app-border bg-[var(--surface-2)] p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="text-sm font-bold">{document.display_name || document.original_name}</div><div className="mt-1 text-[11px] app-muted break-all">نام اصلی: {document.original_name}</div><div className="mt-1 text-[11px] app-muted">{document.document_type || 'نوع نامشخص'} · {new Date(document.created_at).toLocaleDateString('fa-IR')}</div></div><span className="rounded-full border app-border px-2 py-1 text-[10px]">{document.extraction_status === 'completed' ? 'استخراج شد' : document.extraction_status === 'failed' ? 'خطای استخراج' : document.extraction_status === 'processing' ? 'در حال استخراج' : document.extraction_status === 'skipped' ? 'استخراج نشده' : 'در صف استخراج'}</span></div>
        {document.description && <p className="text-xs app-muted">{document.description}</p>}
        {document.extraction_error && <p className="text-xs text-rose-600">{document.extraction_error}</p>}
        {extracted.length > 0 && <div className="grid gap-1 sm:grid-cols-2">{extracted.map(([key, value]) => <div key={key} className="rounded-lg bg-[var(--surface)] p-2 text-xs"><span className="app-muted">{fields.find((field) => field.key === key)?.label || key}:</span> <b>{String(value)}</b></div>)}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void extractDocument(document)} disabled={!editable || extractingId === document.id || (!document.storage_path && !document.file_asset_id)} className="inline-flex items-center gap-1 rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-40">{extractingId === document.id ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}استخراج مجدد</button>
          {onApply && extracted.length > 0 && <button type="button" onClick={() => apply(document)} disabled={!editable} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)] px-3 py-2 text-xs font-bold"><CheckCircle2 size={13}/>اعمال در فرم این بخش</button>}
        </div>
      </article>;
    })}
  </section>;
};
