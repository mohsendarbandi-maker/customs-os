import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {ShipmentStageCosts} from '../features/finance/ShipmentStageCosts';

const EXIT_ITEMS = [
  ['warehouse_invoice_initial', 'صورت‌حساب انبارداری اولیه'],
  ['warehouse_invoice_supplement', 'صورت‌حساب انبارداری متمم'],
  ['transport_power_of_attorney', 'وکالت حمل'],
] as const;

type ExitItemKey = typeof EXIT_ITEMS[number][0];

type Declaration = {
  id: string;
  shipment_id: string | null;
  kottaj_number: string;
};

type Uploads = {
  invoice: string;
  receipt: string;
};

type RemainingChecklistItem = {
  id: string;
  item_key: string;
  item_label?: string | null;
  note?: string | null;
  completed: boolean;
};

const BUCKET = 'customs_documents';

export const ExitPage: React.FC = () => {
  const [params] = useSearchParams();
  const declarationId = params.get('declarationId') || '';

  const [shipmentId, setShipmentId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [shipPassed, setShipPassed] = useState<boolean | null>(null);
  const [transportDocumentsStatus, setTransportDocumentsStatus] = useState('not_ready');
  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [remainingChecklist, setRemainingChecklist] = useState<RemainingChecklistItem[]>([]);
  const [files, setFiles] = useState<Record<string, Uploads>>({
    warehouse_invoice_initial: { invoice: '', receipt: '' },
    warehouse_invoice_supplement: { invoice: '', receipt: '' },
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<{ key: string; kind: 'invoice' | 'receipt' } | null>(null);

  const load = async () => {
    if (!declarationId) return;

    setBusy(true);
    setError('');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('نشست کاربر معتبر نیست.');

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile?.organization_id) {
        throw new Error(profileError?.message || 'سازمان کاربر مشخص نیست.');
      }

      setOrganizationId(profile.organization_id);

      const { data, error: declarationError } = await supabase
        .from('customs_declarations')
        .select('id,shipment_id,kottaj_number')
        .eq('id', declarationId)
        .maybeSingle();

      if (declarationError) throw declarationError;
      if (!data) throw new Error('اظهارنامه پیدا نشد.');

      setDeclaration(data as Declaration);
      setShipmentId(data.shipment_id || '');

      if (data.shipment_id) {
        const { data: shipmentRow, error: shipmentError } = await supabase
          .from('shipments')
          .select('ship_passed,transport_documents_status')
          .eq('id', data.shipment_id)
          .maybeSingle();
        if (shipmentError) throw shipmentError;
        setShipPassed(Boolean(shipmentRow?.ship_passed));
        setTransportDocumentsStatus(shipmentRow?.transport_documents_status || 'not_ready');
      } else {
        setShipPassed(null);
        setTransportDocumentsStatus('not_ready');
      }

      const { data: exitRows, error: exitError } = await supabase
        .from('declaration_exit_checklist_items')
        .select('item_key,completed')
        .eq('declaration_id', declarationId);

      if (exitError) throw exitError;

      setDone(
        Object.fromEntries(
          (exitRows || []).map((item: { item_key: string; completed: boolean }) => [
            item.item_key,
            Boolean(item.completed),
          ]),
        ),
      );

      const { data: pendingRows, error: pendingError } = await supabase
        .from('declaration_checklist_items')
        .select('id,item_key,item_label,note,completed')
        .eq('declaration_id', declarationId)
        .eq('is_active', true)
        .eq('completed', false);

      if (pendingError) throw pendingError;

      setRemainingChecklist((pendingRows || []) as RemainingChecklistItem[]);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'دریافت اطلاعات درب خروج انجام نشد.',
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [declarationId]);

  const toggleExitItem = async (key: ExitItemKey) => {
    const next = !done[key];
    setDone((current) => ({ ...current, [key]: next }));
    setError('');

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setDone((current) => ({ ...current, [key]: !next }));
      setError('نشست کاربر معتبر نیست.');
      return;
    }

    const { error: updateError } = await supabase
      .from('declaration_exit_checklist_items')
      .upsert(
        {
          organization_id: organizationId,
          declaration_id: declarationId,
          item_key: key,
          completed: next,
          completed_at: next ? new Date().toISOString() : null,
          completed_by: next ? user.id : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'declaration_id,item_key' },
      );

    if (updateError) {
      setDone((current) => ({ ...current, [key]: !next }));
      setError(updateError.message);
    }
  };

  const completeRemainingItem = async (itemId: string) => {
    setError('');

    const { error: updateError } = await supabase.rpc(
      'update_declaration_checklist_item',
      {
        p_item_id: itemId,
        p_completed: true,
      },
    );

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setRemainingChecklist((current) =>
      current.filter((item) => item.id !== itemId),
    );
  };

  const selectUploadTarget = (key: string, kind: 'invoice' | 'receipt') => {
    targetRef.current = { key, kind };
    inputRef.current?.click();
  };

  const handleUpload = async (file: File | null) => {
    const target = targetRef.current;

    if (!file || !target || !declarationId) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      if (!organizationId) throw new Error('سازمان کاربر مشخص نیست.');

      if (!/^(application\/pdf|image\/(jpeg|png))$/i.test(file.type)) {
        throw new Error('فقط PDF، JPG یا PNG مجاز است.');
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('نشست کاربر معتبر نیست.');

      const extension =
        (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();

      const safeExtension = /^\.(pdf|jpg|jpeg|png)$/.test(extension)
        ? extension
        : '.bin';

      const path =
        `${organizationId}/${shipmentId || declaration?.shipment_id || 'declaration'}/${declarationId}/exit-${target.key}-${target.kind}-${crypto.randomUUID()}${safeExtension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: documentError } = await supabase
        .from('customs_documents')
        .insert({
          organization_id: organizationId,
          shipment_id: shipmentId || declaration?.shipment_id || null,
          case_id: null,
          document_type: 'WAREHOUSE_RECEIPT',
          original_name: file.name,
          display_name:
            `${target.key === 'warehouse_invoice_initial' ? 'انبارداری اولیه' : 'انبارداری متمم'} - ${target.kind === 'invoice' ? 'صورتحساب' : 'فیش پرداختی'}`,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
          created_by: user.id,
          status: 'uploaded',
          tags: [],
        });

      if (documentError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw documentError;
      }

      setFiles((current) => ({
        ...current,
        [target.key]: {
          ...current[target.key],
          [target.kind]: file.name,
        },
      }));
      setMessage('فایل با موفقیت ذخیره شد.');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'آپلود انجام نشد.',
      );
    } finally {
      setBusy(false);
      targetRef.current = null;
    }
  };

  const finish = async () => {
    if (EXIT_ITEMS.some(([key]) => !done[key])) {
      setError('هر سه مورد درب خروج باید انجام شوند.');
      return;
    }

    if (!shipmentId) {
      setError('محموله مرتبط با اظهارنامه مشخص نیست.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const now = new Date().toISOString();

      const { error: declarationError } = await supabase
        .from('customs_declarations')
        .update({
          workflow_stage: 6,
          updated_at: now,
        })
        .eq('id', declarationId);

      if (declarationError) throw declarationError;

      const { error: shipmentError } = await supabase
        .from('shipments')
        .update({
          finance_status: 'ready',
          updated_at: now,
        })
        .eq('id', shipmentId);

      if (shipmentError) throw shipmentError;

      setMessage('مرحله ۶ درب خروج تکمیل شد؛ پرونده به مرکز مالی تحویل داده شد.');

      window.setTimeout(() => {
        window.location.assign(
          `/finance/shipments/${encodeURIComponent(shipmentId)}`,
        );
      }, 350);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'تکمیل درب خروج انجام نشد.',
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadBox = (key: ExitItemKey, label: string) => {
    if (
      key !== 'warehouse_invoice_initial' &&
      key !== 'warehouse_invoice_supplement'
    ) {
      return null;
    }

    return (
      <div className="p-4 border-b app-border bg-[var(--surface-2)]">
        <div className="font-bold text-sm mb-3">
          {label}{' '}
          <span className="text-xs app-muted">(اختیاری)</span>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => selectUploadTarget(key, 'invoice')}
            className="rounded-xl border app-border p-3 text-right"
          >
            <Upload className="inline ml-2" size={16} />
            آپلود صورتحساب
            {files[key]?.invoice && (
              <span className="block text-xs text-emerald-600 mt-1">
                ✓ {files[key].invoice}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => selectUploadTarget(key, 'receipt')}
            className="rounded-xl border app-border p-3 text-right"
          >
            <Upload className="inline ml-2" size={16} />
            آپلود فیش پرداختی
            {files[key]?.receipt && (
              <span className="block text-xs text-emerald-600 mt-1">
                ✓ {files[key].receipt}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  };

  const completedExitItems = EXIT_ITEMS.filter(([key]) => done[key]).length;

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-8"
    >
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        onChange={(event) => {
          void handleUpload(event.target.files?.[0] || null);
          event.currentTarget.value = '';
        }}
      />

      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] app-muted">مرحله ۶</div>
            <h1 className="text-2xl md:text-3xl font-black mt-1">درب خروج</h1>
            {declaration && (
              <div className="text-xs app-muted mt-1">
                اظهارنامه / کوتاژ {declaration.kottaj_number}
              </div>
            )}
          </div>

          <Link
            to={`/operations?tab=stage5&declarationId=${encodeURIComponent(declarationId)}`}
            className="px-4 py-2 rounded-xl border app-border bg-[var(--surface)] text-xs font-bold"
          >
            <ArrowRight className="inline ml-1" size={15} />
            بازگشت به عملیات گمرکی
          </Link>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
            {message}
          </div>
        )}

        {!declarationId ? (
          <div className="rounded-2xl border app-border bg-[var(--surface)] p-5">
            اظهارنامه‌ای برای مرحله درب خروج انتخاب نشده است.
          </div>
        ) : (
          <>
            {shipPassed === false && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <b>هشدار مرحله‌های قبل:</b> پاس کشتی هنوز ثبت نشده است.
                    <div className="text-xs app-muted mt-1">
                      وضعیت اسناد کشتیرانی: {transportDocumentsStatus === 'ready' ? 'آماده است' : 'هنوز آماده نیست'}.
                    </div>
                  </div>
                </div>
              </div>
            )}
            {shipmentId&&<><ShipmentStageCosts stage="STAGE_5_EXIT_PREPARATION" shipmentId={shipmentId}/><ShipmentStageCosts stage="STAGE_6_EXIT" shipmentId={shipmentId}/></>}

{remainingChecklist.length > 0 && (
              <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                <div className="p-5 border-b border-amber-500/20">
                  <h2 className="font-black">موارد باقی‌مانده عملیات گمرکی</h2>
                  <p className="text-xs app-muted mt-2 leading-6">
                    این موارد مانع ورود به درب خروج نشده‌اند. برای نمونه، «کد ساتا»
                    می‌تواند بعداً تکمیل شود و سهم باقی‌مانده عملیات در همین مرحله ثبت گردد.
                  </p>
                </div>

                {remainingChecklist.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void completeRemainingItem(item.id)}
                    className="w-full flex items-center gap-3 p-4 border-b border-amber-500/10 text-right"
                  >
                    <span className="w-7 h-7 rounded-lg border border-amber-500/30 grid place-items-center shrink-0">
                      ✓
                    </span>
                    <span className="text-sm font-semibold">{item.item_label || item.item_key}{item.note ? <span className="app-muted"> — توضیح: {item.note}</span> : null}</span>
                  </button>
                ))}
              </section>
            )}

            <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden">
              <div className="p-5 border-b app-border flex items-center justify-between">
                <h2 className="font-black">درب خروج</h2>
                <span className="text-xs app-muted">
                  {completedExitItems} از {EXIT_ITEMS.length}
                </span>
              </div>

              {EXIT_ITEMS.map(([key, label], index) => (
                <React.Fragment key={key}>
                  <button
                    type="button"
                    onClick={() => void toggleExitItem(key)}
                    className="w-full flex items-center gap-3 p-5 border-b app-border text-right hover:bg-[var(--surface-2)]"
                  >
                    <span
                      className={`w-7 h-7 rounded-lg border grid place-items-center shrink-0 ${
                        done[key]
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'app-border'
                      }`}
                    >
                      {done[key] && <Check size={16} />}
                    </span>
                    <span className="text-sm font-semibold">
                      {index + 1}. {label}
                    </span>
                  </button>

                  {uploadBox(key, label)}
                </React.Fragment>
              ))}

              <div className="p-5">
                <button
                  disabled={busy || EXIT_ITEMS.some(([key]) => !done[key])}
                  onClick={() => void finish()}
                  className="w-full md:w-auto px-6 py-3 rounded-xl bg-[var(--primary)] text-white text-sm font-bold disabled:opacity-40"
                >
                  {busy ? (
                    <>
                      <Loader2
                        className="inline ml-2 animate-spin"
                        size={16}
                      />
                      در حال تکمیل...
                    </>
                  ) : (
                    'تکمیل مرحله ۶'
                  )}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
};
