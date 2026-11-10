import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Anchor, ArrowRight, CalendarDays, Check, ChevronDown,
  Circle, ClipboardList, FileText, Loader2, Package, Search, Ship, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { buildCargoName } from '../lib/cargoNaming';

const EXIT_CHECKLIST = [
  'warehouse_invoice_initial',
  'warehouse_invoice_supplement',
  'transport_power_of_attorney',
];

const STAGES = [
  { key: 'start', label: 'شروع عملیات', shortLabel: 'سفارش' },
  { key: 'warehouse', label: 'ورود اطلاعات قبض انبار', shortLabel: 'انبار' },
  { key: 'declaration', label: 'ثبت اظهار', shortLabel: 'اظهار' },
  { key: 'customs', label: 'عملیات گمرکی', shortLabel: 'گمرک' },
  { key: 'exit', label: 'درب خروج', shortLabel: 'خروج' },
];

const stageIndex = (shipment: any) => {
  if (shipment.decl?.workflow_stage >= 6 || shipment.customsCompleted) return 5;
  if (shipment.customsChecklistStarted || shipment.decl?.workflow_stage >= 5) return 4;
  if (shipment.decl) return 3;
  if (shipment.transport_documents_status === 'ready') return 2;
  return 1;
};

const normalizeShipmentSearch = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase()
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[\u200c\s\-_]/g, '');

const stageTarget = (shipment: any, stage: number) => {
  if (stage === 5) return '/finance/shipments/' + encodeURIComponent(shipment.id);
  if (stage === 1) return '/operations';
  if (stage === 2) return '/operations?tab=pre-declaration&shipmentId=' + encodeURIComponent(shipment.id);
  if (stage === 3) return '/operations?tab=declaration&shipmentId=' + encodeURIComponent(shipment.id);
  if (stage === 4) {
    return shipment.decl
      ? '/operations?tab=stage5&declarationId=' + encodeURIComponent(shipment.decl.id) + '&shipmentId=' + encodeURIComponent(shipment.id)
      : '/operations';
  }
  return shipment.decl
    ? '/operations?tab=exit&declarationId=' + encodeURIComponent(shipment.decl.id) + '&shipmentId=' + encodeURIComponent(shipment.id)
    : '/operations';
};

const statusTone = (shipment: any, stage: number) => {
  if (shipment.exitCompleted || shipment.finance_status === 'closed') return 'done';
  if (shipment.current_status === 'completed' && (
    shipment.transport_documents_status !== 'ready' ||
    shipment.release_invoice_payment_status !== 'paid'
  )) return 'attention';
  if (shipment.transport_documents_status === 'ready' && !shipment.ship_passed) return 'attention';
  return stage >= 5 ? 'done' : 'active';
};

const statusLabel = (shipment: any, stage: number) => {
  if (shipment.exitCompleted || shipment.finance_status === 'closed') return 'تکمیل شده';
  if (shipment.current_status === 'completed' && shipment.transport_documents_status !== 'ready') return 'نیازمند سند حمل';
  if (shipment.current_status === 'completed' && shipment.release_invoice_payment_status !== 'paid') return 'در انتظار پرداخت';
  if (shipment.transport_documents_status === 'ready' && !shipment.ship_passed) return 'در انتظار پاس کشتی';
  return STAGES[stage - 1]?.label || 'در جریان';
};

export const LatestShipmentStatuses: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, number | null>>({});
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('shipments')
          .select('id,bill_of_lading_no,vessel_id,client_id,cargo_count,cargo_count_unit,current_status,transport_documents_status,release_invoice_payment_status,ship_passed,ship_passed_at,finance_status,updated_at,created_at')
          .order('updated_at', { ascending: false })
          .limit(12);
        if (error) throw error;

        const shipments = rows || [];
        const vesselIds = shipments.map((item: any) => item.vessel_id).filter(Boolean);
        const clientIds = shipments.map((item: any) => item.client_id).filter(Boolean);
        const shipmentIds = shipments.map((item: any) => item.id);

        const [{ data: vessels }, { data: clients }, { data: declarations }] = await Promise.all([
          vesselIds.length
            ? supabase.from('vessels').select('id,name').in('id', vesselIds)
            : Promise.resolve({ data: [] as any[] }),
          clientIds.length
            ? supabase.from('clients').select('id,name').in('id', clientIds)
            : Promise.resolve({ data: [] as any[] }),
          shipmentIds.length
            ? supabase.from('customs_declarations')
              .select('id,shipment_id,workflow_stage,kottaj_number,declaration_date,customs_path,payment_reference,total_duties_irr,declaration_file_name,created_at')
              .in('shipment_id', shipmentIds)
              .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const vesselById = new Map((vessels || []).map((item: any) => [item.id, item.name || '']));
        const clientById = new Map((clients || []).map((item: any) => [item.id, item.name || '']));
        const declarationByShipment = new Map<string, any>();
        (declarations || []).forEach((item: any) => {
          if (!declarationByShipment.has(item.shipment_id)) declarationByShipment.set(item.shipment_id, item);
        });

        const declarationIds = (declarations || []).map((item: any) => item.id);
        const [{ data: checklistItems }, { data: exitItems }] = declarationIds.length
          ? await Promise.all([
            supabase.from('declaration_checklist_items')
              .select('declaration_id,item_key,item_label,completed,note,is_active,sort_order')
              .in('declaration_id', declarationIds),
            supabase.from('declaration_exit_checklist_items')
              .select('declaration_id,item_key,completed')
              .in('declaration_id', declarationIds),
          ])
          : [{ data: [] as any[] }, { data: [] as any[] }];

        const checklistByDeclaration = new Map<string, any[]>();
        (checklistItems || []).forEach((item: any) => {
          if (!checklistByDeclaration.has(item.declaration_id)) checklistByDeclaration.set(item.declaration_id, []);
          checklistByDeclaration.get(item.declaration_id)!.push(item);
        });

        const exitByDeclaration = new Map<string, any[]>();
        (exitItems || []).forEach((item: any) => {
          if (!exitByDeclaration.has(item.declaration_id)) exitByDeclaration.set(item.declaration_id, []);
          exitByDeclaration.get(item.declaration_id)!.push(item);
        });

        const nextData = shipments.map((shipment: any) => {
          const declaration = declarationByShipment.get(shipment.id) || null;
          const checklist = declaration ? checklistByDeclaration.get(declaration.id) || [] : [];
          const exitChecklist = declaration ? exitByDeclaration.get(declaration.id) || [] : [];
          const activeItems = checklist
            .filter((item: any) => item.is_active !== false)
            .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
          const pendingChecklist = activeItems
            .filter((item: any) => !item.completed)
            .map((item: any) => ({ label: item.item_label || item.item_key, note: item.note || null }));
          const checkCompleted = activeItems.length - pendingChecklist.length;
          const customsCompleted = Boolean(declaration && activeItems.length > 0 && pendingChecklist.length === 0);
          const customsChecklistStarted = Boolean(declaration && activeItems.length > 0);
          const exitChecks = EXIT_CHECKLIST.map(key => ({
            key,
            label: key === 'warehouse_invoice_initial'
              ? 'فاکتور اولیه انبار'
              : key === 'warehouse_invoice_supplement'
                ? 'فاکتور متمم انبار'
                : 'وکالت‌نامه حمل',
            completed: exitChecklist.some((item: any) => item.item_key === key && item.completed),
          }));
          const exitCompleted = Boolean(declaration && EXIT_CHECKLIST.every(key =>
            exitChecklist.some((item: any) => item.item_key === key && item.completed),
          ));

          return {
            ...shipment,
            owner: clientById.get(shipment.client_id) || 'صاحب کالا نامشخص',
            vessel: vesselById.get(shipment.vessel_id) || 'کشتی نامشخص',
            decl: declaration,
            checkCompleted,
            pendingChecklist,
            customsCompleted,
            customsChecklistStarted,
            exitChecks,
            exitCompleted,
          };
        }).filter((shipment: any) => !shipment.exitCompleted && shipment.finance_status !== 'closed');

        if (!cancelled) setData(nextData);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const query = normalizeShipmentSearch(searchText);
  const filteredData = query
    ? data.filter((shipment: any) => [
      shipment.id,
      shipment.owner,
      shipment.vessel,
      shipment.bill_of_lading_no,
      shipment.decl?.kottaj_number,
      shipment.decl?.declaration_date,
      shipment.decl?.customs_path,
      buildCargoName(shipment.cargo_count, shipment.cargo_count_unit, shipment.owner, shipment.vessel),
    ].some(value => normalizeShipmentSearch(value).includes(query)))
    : data;

  return (
    <section dir="rtl" className="shipment-board">
      <header className="shipment-board-header">
        <div className="shipment-board-title">
          <span className="shipment-board-eyebrow">SHIPMENT TRACKING</span>
          <h2><Ship size={19} aria-hidden="true" /> وضعیت محموله‌ها</h2>
          <small>{filteredData.length.toLocaleString('fa-IR')} محموله فعال</small>
        </div>
        <Link to="/shipment-showcase" className="shipment-board-all">
          همه محموله‌ها <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>

      <label className="shipment-board-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label="جست‌وجو در محموله‌ها"
          placeholder="جست‌وجوی نام، بارنامه یا کوتاژ…"
          value={searchText}
          onChange={event => setSearchText(event.target.value)}
          autoComplete="off"
        />
        <button type="button" onClick={() => setSearchText('')} aria-label="پاک کردن جست‌وجو" hidden={!searchText}>
          <X size={15} />
        </button>
      </label>

      {loading ? (
        <div className="shipment-board-loading"><Loader2 size={23} className="animate-spin" /></div>
      ) : !filteredData.length ? (
        <div className="shipment-board-empty">
          {data.length ? 'نتیجه‌ای برای جست‌وجو پیدا نشد.' : 'هنوز محموله‌ای ثبت نشده است.'}
        </div>
      ) : (
        <div className="shipment-board-grid">
          {filteredData.map((shipment: any) => {
            const current = stageIndex(shipment);
            const open = selected[shipment.id] ?? null;
            const tone = statusTone(shipment, current);
            const warnings = [
              ...(shipment.current_status === 'completed' && shipment.transport_documents_status !== 'ready'
                ? ['اسناد حمل و قبض انبار آماده نیست']
                : []),
              ...(shipment.current_status === 'completed' && shipment.release_invoice_payment_status !== 'paid'
                ? ['صورتحساب ترخیصیه پرداخت نشده']
                : []),
              ...(shipment.transport_documents_status === 'ready' && !shipment.ship_passed
                ? ['پاس کشتی ثبت نشده']
                : []),
            ];

            return (
              <article className={'shipment-premium-card ' + tone} key={shipment.id} data-shipment-id={shipment.id}>
                <div className="shipment-premium-card-head">
                  <div className="shipment-premium-identity">
                    <span className="shipment-premium-thumb"><img src="/mobile-ocean-hero.svg" alt="" loading="lazy" /><span aria-hidden="true"><Ship size={15} /></span></span>
                    <div>
                      <span className="shipment-premium-bl">BL · {shipment.bill_of_lading_no || 'بدون بارنامه'}</span>
                      <h3>{buildCargoName(shipment.cargo_count, shipment.cargo_count_unit, shipment.owner, shipment.vessel)}</h3>
                    </div>
                  </div>
                  <span className={'shipment-premium-status ' + tone}>
                    <i aria-hidden="true" />
                    {statusLabel(shipment, current)}
                  </span>
                </div>

                <div className="shipment-premium-meta">
                  <span><Ship size={14} /> {shipment.vessel}</span>
                  <span><Anchor size={14} /> {shipment.owner}</span>
                </div>

                <div className="shipment-premium-progress-head">
                  <span>مسیر عملیات</span>
                  <b>{STAGES[current - 1]?.label || 'شروع عملیات'}</b>
                </div>

                <div className="shipment-premium-steps" role="list" aria-label="مراحل عملیات محموله">
                  {STAGES.map((stage, index) => {
                    const number = index + 1;
                    const done = number < current;
                    const active = number === current;
                    return (
                      <button
                        type="button"
                        role="listitem"
                        key={stage.key}
                        className={'shipment-premium-step ' + (done ? 'done' : active ? 'current' : 'pending')}
                        aria-label={stage.label}
                        aria-current={active ? 'step' : undefined}
                        aria-expanded={open === number}
                        onClick={() => setSelected(previous => ({
                          ...previous,
                          [shipment.id]: previous[shipment.id] === number ? null : number,
                        }))}
                      >
                        <span className="shipment-premium-step-dot">
                          {done || (active && current === 5) ? <Check size={13} /> : <Circle size={10} />}
                        </span>
                        <span className="shipment-premium-step-label">{stage.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="shipment-premium-facts">
                  <div><Package size={14} /><span>مقدار</span><b>{shipment.cargo_count != null ? Number(shipment.cargo_count).toLocaleString('fa-IR') + ' ' + (shipment.cargo_count_unit || '') : '—'}</b></div>
                  <div><FileText size={14} /><span>کوتاژ</span><b>{shipment.decl?.kottaj_number || 'ثبت نشده'}</b></div>
                  <div><CalendarDays size={14} /><span>تاریخ اظهار</span><b>{shipment.decl?.declaration_date || '—'}</b></div>
                </div>

                {warnings.length > 0 && (
                  <div className="shipment-premium-warnings">
                    {warnings.map(warning => <span key={warning}><AlertTriangle size={13} />{warning}</span>)}
                  </div>
                )}

                <footer className="shipment-premium-actions">
                  <button
                    type="button"
                    className="shipment-premium-details"
                    aria-expanded={open !== null}
                    onClick={() => setSelected(previous => ({
                      ...previous,
                      [shipment.id]: previous[shipment.id] === current ? null : current,
                    }))}
                  >
                    جزئیات محموله <ChevronDown size={15} />
                  </button>
                  <Link to={stageTarget(shipment, current)} className="shipment-premium-enter">
                    ورود به عملیات <ArrowRight size={15} />
                  </Link>
                </footer>

                {open !== null && (
                  <section className="shipment-premium-expanded" aria-label="جزئیات مرحله انتخاب شده">
                    <div className="shipment-premium-expanded-title">
                      <b>{STAGES[open - 1]?.label}</b>
                      <Link to={stageTarget(shipment, open)}>باز کردن مرحله <ArrowRight size={14} /></Link>
                    </div>
                    {open === 5 ? (
                      <div className="shipment-premium-checklist">
                        {shipment.exitChecks.map((item: any) => (
                          <div key={item.key} className={item.completed ? 'is-complete' : 'is-pending'}>
                            <span>{item.completed ? <Check size={13} /> : <Circle size={12} />}</span>
                            <b>{item.label}</b>
                            <small>{item.completed ? 'تکمیل شده' : 'در انتظار'}</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="shipment-premium-detail-grid">
                        <span>شماره کوتاژ <b>{shipment.decl?.kottaj_number || '—'}</b></span>
                        <span>تاریخ اظهار <b>{shipment.decl?.declaration_date || '—'}</b></span>
                        <span>مسیر گمرکی <b>{shipment.decl?.customs_path || '—'}</b></span>
                        <span>پاس کشتی <b>{shipment.ship_passed ? 'ثبت شده' : 'ثبت نشده'}</b></span>
                        <span>چک‌لیست تکمیل شده <b>{shipment.checkCompleted}</b></span>
                        <span>موارد باقی‌مانده <b>{shipment.pendingChecklist.length}</b></span>
                      </div>
                    )}
                  </section>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
