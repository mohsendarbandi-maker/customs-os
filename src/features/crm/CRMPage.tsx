import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, ChevronDown, Handshake, Phone, Plus, Search, Target, UsersRound } from 'lucide-react';
import { crmApi } from './api';
import type { CrmAccount, CrmActivity, CrmDeal, CrmLead, CrmStage } from './types';
import { useAuth } from '../../context/AuthContext';

const faDate = (value: string | null | undefined): string =>
  value ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '—';

const faNumber = (value: number): string => value.toLocaleString('fa-IR');
const errText = (error: unknown): string => {
  const raw = String(error instanceof Error ? error.message : error);
  if (/duplicate|unique/i.test(raw)) return 'این رکورد قبلاً ثبت شده است.';
  if (/permission|unauthor/i.test(raw)) return 'اجازه انجام این عملیات را ندارید.';
  if (/network|fetch/i.test(raw)) return 'اتصال اینترنت در دسترس نیست.';
  return 'ذخیره‌سازی انجام نشد.';
};

const Metric: React.FC<{ label: string; value: number; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="rounded-3xl border app-border bg-[var(--surface)] p-4">
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center">{icon}</div>
      <div><div className="text-xs app-muted">{label}</div><div className="text-2xl font-black">{faNumber(value)}</div></div>
    </div>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-black/30 p-3 flex items-end md:items-center justify-center" onClick={onClose}>
    <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl border app-border bg-[var(--surface)] p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-4"><b className="text-lg">{title}</b><div className="flex-1"/><button className="min-h-10 min-w-10 rounded-xl" onClick={onClose} aria-label="بستن">×</button></div>
      {children}
    </div>
  </div>
);

export const CRMPage: React.FC = () => {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const orgId = profile?.organization_id ?? '';
  const [tab, setTab] = useState<'accounts' | 'leads' | 'deals' | 'activities'>('accounts');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<'account' | 'lead' | 'deal' | 'activity' | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<CrmAccount | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountEconomic, setAccountEconomic] = useState('');
  const [accountNational, setAccountNational] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadScore, setLeadScore] = useState('0');
  const [dealName, setDealName] = useState('');
  const [dealAccount, setDealAccount] = useState('');
  const [dealAmount, setDealAmount] = useState('0');
  const [dealStage, setDealStage] = useState('');
  const [activitySubject, setActivitySubject] = useState('');
  const [activityType, setActivityType] = useState<CrmActivity['activity_type']>('task');
  const [activityAccount, setActivityAccount] = useState('');
  const [activityDue, setActivityDue] = useState('');

  const accounts = useQuery({ queryKey: ['crm-accounts'], queryFn: crmApi.accounts, enabled: Boolean(orgId), staleTime: 10000 });
  const leads = useQuery({ queryKey: ['crm-leads'], queryFn: crmApi.leads, enabled: Boolean(orgId), staleTime: 10000 });
  const pipeline = useQuery({ queryKey: ['crm-pipeline'], queryFn: crmApi.pipelines, enabled: Boolean(orgId), staleTime: 15000 });
  const deals = useQuery({ queryKey: ['crm-deals'], queryFn: crmApi.deals, enabled: Boolean(orgId), staleTime: 5000 });
  const activityAccounts = useMemo(() => accounts.data ?? [], [accounts.data]);

  useEffect(() => {
    if (orgId) void crmApi.seedPipeline().then(() => qc.invalidateQueries({ queryKey: ['crm-pipeline'] })).catch(() => undefined);
  }, [orgId, qc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('crm-global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createAccount = useMutation({
    mutationFn: () => crmApi.createAccount({ organizationId: orgId, name: accountName, economicCode: accountEconomic, nationalId: accountNational }),
    onSuccess: () => { setModal(null); setAccountName(''); setAccountEconomic(''); setAccountNational(''); void qc.invalidateQueries({ queryKey: ['crm-accounts'] }); },
    onError: (error) => window.alert(errText(error)),
  });

  const createLead = useMutation({
    mutationFn: () => crmApi.createLead({ organizationId: orgId, companyName: leadCompany, contactName: leadName, phone: leadPhone, email: leadEmail, score: Math.max(0, Math.min(100, Number(leadScore) || 0)) }),
    onSuccess: () => { setModal(null); setLeadCompany(''); setLeadName(''); setLeadPhone(''); setLeadEmail(''); setLeadScore('0'); void qc.invalidateQueries({ queryKey: ['crm-leads'] }); },
    onError: (error) => window.alert(errText(error)),
  });

  const createDeal = useMutation({
    mutationFn: () => crmApi.createDeal({
      organizationId: orgId,
      accountId: dealAccount,
      pipelineId: pipeline.data?.pipeline.id ?? '',
      stageId: dealStage || pipeline.data?.stages[0]?.id || '',
      name: dealName,
      amount: Math.max(0, Number(dealAmount) || 0),
      probability: pipeline.data?.stages.find((stage) => stage.id === dealStage)?.probability ?? 0,
    }),
    onSuccess: () => { setModal(null); setDealName(''); setDealAccount(''); setDealAmount('0'); setDealStage(''); void qc.invalidateQueries({ queryKey: ['crm-deals'] }); },
    onError: (error) => window.alert(errText(error)),
  });

  const createActivity = useMutation({
    mutationFn: () => crmApi.createActivity({ activityType: activityType, subject: activitySubject, accountId: activityAccount || null, dueAt: activityDue ? new Date(activityDue).toISOString() : null }),
    onSuccess: () => { setModal(null); setActivitySubject(''); setActivityAccount(''); setActivityDue(''); void qc.invalidateQueries({ queryKey: ['crm-activities'] }); },
    onError: (error) => window.alert(errText(error)),
  });

  const moveDeal = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) => crmApi.moveDealStage(dealId, stageId),
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: ['crm-deals'] });
      const previous = qc.getQueryData<CrmDeal[]>(['crm-deals']);
      qc.setQueryData<CrmDeal[]>(['crm-deals'], (items) => (items ?? []).map((item) => item.id === dealId ? { ...item, stage_id: stageId, probability: pipeline.data?.stages.find((s) => s.id === stageId)?.probability ?? item.probability } : item));
      return { previous };
    },
    onError: (_error, _vars, context) => { if (context?.previous) qc.setQueryData(['crm-deals'], context.previous); },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['crm-deals'] }),
  });

  const searchResults = useQuery({
    queryKey: ['crm-search', query],
    queryFn: () => crmApi.search(query),
    enabled: query.trim().length >= 2,
    staleTime: 5000,
  });

  const dealByStage = useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    for (const stage of pipeline.data?.stages ?? []) map.set(stage.id, []);
    for (const deal of deals.data ?? []) map.get(deal.stage_id)?.push(deal);
    return map;
  }, [deals.data, pipeline.data?.stages]);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts.data ?? []).filter((item) => !q || item.name.toLowerCase().includes(q) || (item.economic_code ?? '').includes(q));
  }, [accounts.data, query]);

  return (
    <div dir="rtl" className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <div><h1 className="text-xl md:text-2xl font-black">CRM سازمانی</h1><div className="text-xs app-muted mt-1">حساب‌ها، سرنخ‌ها، معاملات و فعالیت‌ها</div></div>
        <div className="flex-1"/>
        <button className="min-h-11 rounded-2xl bg-[var(--primary)] text-white px-4 flex items-center gap-2" onClick={() => setModal(tab === 'accounts' ? 'account' : tab === 'leads' ? 'lead' : tab === 'deals' ? 'deal' : 'activity')}><Plus size={17}/><span className="hidden sm:inline">جدید</span></button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="حساب‌ها" value={accounts.data?.length ?? 0} icon={<Building2 size={19}/>}/>
        <Metric label="سرنخ‌ها" value={leads.data?.filter((x) => x.status !== 'converted').length ?? 0} icon={<Target size={19}/>}/>
        <Metric label="معاملات" value={deals.data?.length ?? 0} icon={<Handshake size={19}/>}/>
        <Metric label="فعالیت" value={0} icon={<CalendarClock size={19}/>}/>
      </div>

      <div className="rounded-3xl border app-border bg-[var(--surface)] p-2 flex flex-col md:flex-row gap-2">
        <label className="flex items-center gap-2 rounded-2xl border app-border px-3 min-h-11 flex-1">
          <Search size={16} className="app-muted"/><input id="crm-global-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی Ctrl/Cmd+K" className="flex-1 bg-transparent outline-none text-sm"/>
        </label>
        <div className="grid grid-cols-4 gap-1">
          {([['accounts','حساب‌ها'],['leads','سرنخ‌ها'],['deals','معاملات'],['activities','فعالیت‌ها']] as const).map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)} className={'min-h-11 rounded-2xl px-3 text-sm ' + (tab === key ? 'bg-[var(--primary)] text-white' : 'hover:bg-black/5')}>{label}</button>
          ))}
        </div>
      </div>

      {query.trim().length >= 2 && searchResults.data?.length ? (
        <div className="rounded-3xl border app-border bg-[var(--surface)] overflow-hidden">
          {searchResults.data.map((item) => <button key={item.kind+item.id} className="w-full text-right p-3 border-b app-border hover:bg-black/5" onClick={() => { setQuery(''); if (item.kind === 'account') setSelectedAccount((accounts.data ?? []).find((a) => a.id === item.id) ?? null); }}><div className="font-bold text-sm">{item.title}</div><div className="text-xs app-muted">{item.snippet}</div></button>)}
        </div>
      ) : null}

      {tab === 'accounts' && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          <div className="rounded-3xl border app-border bg-[var(--surface)] overflow-hidden">
            <div className="p-4 border-b app-border flex items-center gap-2"><b>حساب‌ها</b><span className="text-xs app-muted">{faNumber(filteredAccounts.length)} رکورد</span></div>
            {accounts.isLoading ? <div className="p-4 space-y-2"><div className="h-16 bg-black/5 rounded-2xl animate-pulse"/><div className="h-16 bg-black/5 rounded-2xl animate-pulse"/></div> : filteredAccounts.length === 0 ? <div className="p-10 text-center app-muted">حسابی ثبت نشده است.</div> : (
              <div>{filteredAccounts.map((account) => <button key={account.id} onClick={() => setSelectedAccount(account)} className={'w-full text-right p-4 border-b app-border hover:bg-black/5 ' + (selectedAccount?.id === account.id ? 'bg-black/5' : '')}><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center"><Building2 size={18}/></div><div className="min-w-0 flex-1"><div className="font-bold truncate">{account.name}</div><div className="text-xs app-muted truncate">{account.economic_code ? 'کد اقتصادی: '+account.economic_code : 'کد اقتصادی ثبت نشده'}</div></div></div></button>)}</div>
            )}
          </div>
          <div className="rounded-3xl border app-border bg-[var(--surface)] p-4">
            {!selectedAccount ? <div className="py-12 text-center app-muted">یک حساب را انتخاب کنید.</div> : <AccountDetails account={selectedAccount}/>}
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div className="rounded-3xl border app-border bg-[var(--surface)] overflow-hidden">
          <div className="p-4 border-b app-border flex items-center gap-2"><b>سرنخ‌ها</b><span className="text-xs app-muted">{faNumber(leads.data?.length ?? 0)} رکورد</span></div>
          {(leads.data ?? []).length === 0 ? <div className="p-10 text-center app-muted">سرنخی ثبت نشده است.</div> : <div className="divide-y app-border">{leads.data?.map((lead) => <LeadRow key={lead.id} lead={lead} onConvert={async () => { try { await crmApi.convertLead(lead.id); await qc.invalidateQueries({ queryKey: ['crm-leads'] }); await qc.invalidateQueries({ queryKey: ['crm-accounts'] }); await qc.invalidateQueries({ queryKey: ['crm-deals'] }); } catch (error) { window.alert(errText(error)); } }}/>)}</div>}
        </div>
      )}

      {tab === 'deals' && (
        <div className="overflow-x-auto">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 min-w-[1060px]">
            {(pipeline.data?.stages ?? []).map((stage) => <DealColumn key={stage.id} stage={stage} deals={dealByStage.get(stage.id) ?? []} onDrop={(dealId) => moveDeal.mutate({ dealId, stageId: stage.id })}/>)}
          </div>
        </div>
      )}

      {tab === 'activities' && (
        <div className="rounded-3xl border app-border bg-[var(--surface)] p-4">
          <div className="flex items-center gap-2 mb-4"><Phone size={18}/><b>فعالیت‌های CRM</b></div>
          <div className="text-sm app-muted">فعالیت‌ها به حساب، مخاطب یا معامله متصل می‌شوند و از همین‌جا می‌توان برای آن‌ها یادآور ساخت.</div>
          <button className="mt-4 min-h-11 rounded-2xl bg-[var(--primary)] text-white px-4" onClick={() => setModal('activity')}>ثبت فعالیت</button>
        </div>
      )}

      <nav className="fixed z-30 bottom-2 inset-x-2 md:hidden rounded-3xl border app-border bg-[var(--surface)]/95 backdrop-blur shadow-2xl p-1 grid grid-cols-4">
        {([['accounts','حساب'],['leads','سرنخ'],['deals','معامله'],['activities','فعالیت']] as const).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={'min-h-12 rounded-2xl text-xs ' + (tab === key ? 'bg-[var(--primary)] text-white' : '')}>{label}</button>)}
      </nav>

      {modal === 'account' && <Modal title="حساب جدید" onClose={() => setModal(null)}>
        <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="نام شرکت" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <input value={accountEconomic} onChange={(e) => setAccountEconomic(e.target.value)} placeholder="کد اقتصادی" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <input value={accountNational} onChange={(e) => setAccountNational(e.target.value)} placeholder="شناسه ملی" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/>
        <button disabled={!accountName.trim() || createAccount.isPending} onClick={() => createAccount.mutate()} className="mt-3 w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white disabled:opacity-40">ثبت حساب</button>
      </Modal>}

      {modal === 'lead' && <Modal title="سرنخ جدید" onClose={() => setModal(null)}>
        <input value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} placeholder="شرکت" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="نام مخاطب *" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <div className="grid grid-cols-2 gap-2"><input value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder="تلفن" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/><input value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="ایمیل" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/></div>
        <input value={leadScore} onChange={(e) => setLeadScore(e.target.value)} inputMode="numeric" placeholder="امتیاز ۰ تا ۱۰۰" className="mt-2 w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/>
        <button disabled={!leadName.trim() || createLead.isPending} onClick={() => createLead.mutate()} className="mt-3 w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white disabled:opacity-40">ثبت سرنخ</button>
      </Modal>}

      {modal === 'deal' && <Modal title="معامله جدید" onClose={() => setModal(null)}>
        <input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="نام معامله *" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <select value={dealAccount} onChange={(e) => setDealAccount(e.target.value)} className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"><option value="">حساب را انتخاب کنید</option>{activityAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        <div className="grid grid-cols-2 gap-2"><input value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} inputMode="decimal" placeholder="مبلغ" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/><select value={dealStage || pipeline.data?.stages[0]?.id || ''} onChange={(e) => setDealStage(e.target.value)} className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3">{pipeline.data?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
        <button disabled={!dealName.trim() || !dealAccount || createDeal.isPending} onClick={() => createDeal.mutate()} className="mt-3 w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white disabled:opacity-40">ثبت معامله</button>
      </Modal>}

      {modal === 'activity' && <Modal title="ثبت فعالیت" onClose={() => setModal(null)}>
        <select value={activityType} onChange={(e) => setActivityType(e.target.value as CrmActivity['activity_type'])} className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"><option value="task">وظیفه</option><option value="call">تماس</option><option value="meeting">جلسه</option><option value="note">یادداشت</option><option value="email">ایمیل ثبت‌شده</option></select>
        <input value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} placeholder="موضوع *" className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"/>
        <select value={activityAccount} onChange={(e) => setActivityAccount(e.target.value)} className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 mb-2"><option value="">حساب را انتخاب کنید</option>{activityAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        <input type="datetime-local" value={activityDue} onChange={(e) => setActivityDue(e.target.value)} className="w-full min-h-12 rounded-2xl border app-border bg-transparent px-3"/>
        <button disabled={!activitySubject.trim() || !activityAccount || createActivity.isPending} onClick={() => createActivity.mutate()} className="mt-3 w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white disabled:opacity-40">ثبت فعالیت</button>
      </Modal>}
    </div>
  );
};

const AccountDetails: React.FC<{ account: CrmAccount }> = ({ account }) => {
  const details = useQuery({ queryKey: ['crm-360', account.id], queryFn: () => crmApi.account360(account.id), staleTime: 10000 });
  return <div>
    <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center"><Building2 size={19}/></div><div><div className="font-black">{account.name}</div><div className="text-xs app-muted">نمای ۳۶۰ درجه</div></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Info label="شناسه ملی" value={account.national_id ?? 'ثبت نشده'}/>
      <Info label="کد اقتصادی" value={account.economic_code ?? 'ثبت نشده'}/>
      <Info label="منبع" value={account.source ?? 'ثبت نشده'}/>
      <Info label="آخرین تغییر" value={faDate(account.updated_at)}/>
    </div>
    {details.isLoading ? <div className="mt-4 h-24 rounded-2xl bg-black/5 animate-pulse"/> : <div className="mt-4 space-y-2 text-sm app-muted"><div className="rounded-2xl border app-border p-3">پرونده‌ها: {Array.isArray(details.data?.cases) ? faNumber(details.data.cases.length) : '۰'}</div><div className="rounded-2xl border app-border p-3">محموله‌ها: {Array.isArray(details.data?.shipments) ? faNumber(details.data.shipments.length) : '۰'}</div><div className="rounded-2xl border app-border p-3">فاکتورها: {Array.isArray(details.data?.invoices) ? faNumber(details.data.invoices.length) : '۰'}</div><div className="rounded-2xl border app-border p-3">پرداخت‌ها: {Array.isArray(details.data?.payments) ? faNumber(details.data.payments.length) : '۰'}</div></div>}
  </div>;
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-2xl border app-border p-3"><div className="text-[10px] app-muted">{label}</div><div className="text-xs font-bold mt-1">{value}</div></div>;

const LeadRow: React.FC<{ lead: CrmLead; onConvert: () => void }> = ({ lead, onConvert }) => (
  <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
    <div className="w-11 h-11 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center"><UsersRound size={18}/></div>
    <div className="flex-1 min-w-0"><div className="font-bold truncate">{lead.contact_name}</div><div className="text-xs app-muted truncate">{lead.company_name ?? 'بدون شرکت'} · امتیاز {faNumber(lead.score)}</div></div>
    <div className="text-xs app-muted">وضعیت: {lead.status === 'new' ? 'جدید' : lead.status === 'qualified' ? 'واجد شرایط' : lead.status === 'converted' ? 'تبدیل‌شده' : lead.status === 'lost' ? 'از دست‌رفته' : 'ردشده'}</div>
    {lead.status !== 'converted' && <button onClick={onConvert} className="min-h-11 rounded-2xl border app-border px-4 hover:bg-black/5">تبدیل</button>}
  </div>
);

const DealColumn: React.FC<{ stage: CrmStage; deals: CrmDeal[]; onDrop: (dealId: string) => void }> = ({ stage, deals, onDrop }) => (
  <div className="rounded-3xl border app-border bg-[var(--surface)] min-h-[420px]" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/crm-deal'); if (id) onDrop(id); }}>
    <div className="p-3 border-b app-border flex items-center gap-2"><b>{stage.name}</b><span className="text-xs app-muted">{faNumber(deals.length)}</span><div className="flex-1"/><span className="text-[10px] app-muted">{faNumber(stage.probability)}٪</span></div>
    <div className="p-2 space-y-2">
      {deals.map((deal) => <div key={deal.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/crm-deal',deal.id)} className="rounded-2xl border app-border p-3 cursor-grab bg-[var(--surface)]"><div className="font-bold text-sm">{deal.name}</div><div className="text-xs app-muted mt-1">{faNumber(deal.amount)} {deal.currency}</div><div className="text-[10px] app-muted mt-1">{deal.forecast_date ? faDate(deal.forecast_date) : 'بدون تاریخ پیش‌بینی'}</div></div>)}
      {deals.length===0 && <div className="py-8 text-center text-xs app-muted">معامله‌ای در این مرحله نیست.</div>}
    </div>
  </div>
);
