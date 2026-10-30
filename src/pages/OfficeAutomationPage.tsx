import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, BadgeCheck, Building2, CheckCircle2, AlertCircle, ClipboardList, Download,
  Eye, FileCheck2, FileSignature, FileText, Inbox, Loader2, Mail, Paperclip, PenLine,
  Plus, Printer, Save, Send, ShieldCheck, Stamp, Upload, X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const db = supabase as unknown as { from: (table: string) => any; storage: typeof supabase.storage };
type CompanyProfile = {
  id: string; organization_id: string; client_id: string | null; company_name: string;
  national_id: string | null; economic_code: string | null; registration_number: string | null;
  address: string | null; phone: string | null; email: string | null;
  letterhead_storage_path: string | null; stamp_storage_path: string | null;
  signature_storage_path: string | null; authorization_storage_path: string | null;
  authorized_signer_name: string | null; authority_reference: string | null;
  authority_valid_until: string | null; authority_status: string;
  authority_approved_by: string | null; authority_approved_at: string | null;
};
type ClientRow = { id: string; name: string; national_id: string | null };
type Letter = {
  id: string; direction: 'incoming' | 'outgoing' | 'internal'; year_key: string;
  registry_no: string | null; external_reference: string | null; letter_date: string | null;
  recipient_name: string | null; recipient_organization: string | null; sender_name: string | null;
  sender_organization: string | null; subject: string; body: string; notes: string | null;
  response_due_date: string | null; response_status: string; visible_to_client: boolean;
  apply_stamp: boolean; apply_signature: boolean; status: string; approved_by: string | null;
  approved_at: string | null; issued_at: string | null; sent_at: string | null; archived_at: string | null;
  created_at: string;
  issued_company_name: string | null;
  issued_company_address: string | null;
  issued_company_phone: string | null;
  issued_company_email: string | null;
  issued_signer_name: string | null;
  issued_letterhead_storage_path: string | null;
  issued_stamp_storage_path: string | null;
  issued_signature_storage_path: string | null;
  issued_authorization_storage_path: string | null;
};
type Attachment = { id: string; original_name: string; mime_type: string; size_bytes: number; storage_path: string };
type EventRow = { id: string; event_type: string; from_status: string | null; to_status: string | null; created_at: string };
type Draft = {
  direction: 'incoming' | 'outgoing' | 'internal'; recipient_name: string; recipient_organization: string;
  sender_name: string; sender_organization: string; external_reference: string; letter_date: string;
  subject: string; body: string; notes: string; response_due_date: string; response_status: string;
  visible_to_client: boolean; apply_stamp: boolean; apply_signature: boolean;
};
const blankDraft: Draft = {
  direction: 'outgoing', recipient_name: '', recipient_organization: '', sender_name: '',
  sender_organization: '', external_reference: '', letter_date: new Date().toISOString().slice(0, 10),
  subject: '', body: '', notes: '', response_due_date: '', response_status: 'not_required',
  visible_to_client: true, apply_stamp: false, apply_signature: false,
};
const yearKey = () => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' })
  .format(new Date()).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(new Date(value))
  : '—';
const statusName: Record<string, string> = {
  draft: 'پیش‌نویس', in_review: 'در انتظار بررسی', approved: 'تأییدشده',
  issued: 'صادرشده', sent: 'ارسال‌شده', archived: 'بایگانی‌شده',
};
const directionName: Record<string, string> = { incoming: 'وارده', outgoing: 'صادره', internal: 'داخلی' };
const authorityName: Record<string, string> = {
  not_required: 'مجوز نمایندگی لازم نیست', not_provided: 'مدرک نمایندگی ثبت نشده',
  pending: 'در انتظار تأیید مجوز', approved: 'مجوز نمایندگی تأیید شده',
  expired: 'مجوز منقضی شده', revoked: 'مجوز لغو شده',
};
const safeName = (name: string) => name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 100) || 'file';
const pdfFile = (name: string) => /\.pdf$/i.test(name);
const sizeName = (size: number) => size < 1024 * 1024
  ? Math.max(1, Math.round(size / 1024)) + ' KB'
  : (size / 1024 / 1024).toFixed(1) + ' MB';

export const OfficeAutomationPage: React.FC = () => {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isClient = profile?.role === 'client';
  const isManager = ['owner', 'admin', 'broker'].includes(profile?.role || '');
  const canApproveAuthority = ['owner', 'admin'].includes(profile?.role || '');
  const canConfigure = isManager || isClient;
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState(params.get('clientId') || '');
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [companyForm, setCompanyForm] = useState({
    company_name: '', national_id: '', economic_code: '', registration_number: '',
    address: '', phone: '', email: '', authorized_signer_name: '', authority_reference: '',
    authority_valid_until: '',
  });
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [activeAssetUrls, setActiveAssetUrls] = useState<Record<string, string>>({});
  const [letterheadPreview, setLetterheadPreview] = useState('');
  const [busyProfile, setBusyProfile] = useState(false);
  const [authorityBusy, setAuthorityBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const [letters, setLetters] = useState<Letter[]>([]);
  const [active, setActive] = useState<Letter | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busyLetter, setBusyLetter] = useState(false);
  const [letterNotice, setLetterNotice] = useState('');
  const [letterError, setLetterError] = useState('');
  const [search, setSearch] = useState('');
  const [filterDirection, setFilterDirection] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const letterheadInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);
  const authorityInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const validAuthority = Boolean(company &&
    (company.client_id ? company.authority_status === 'approved' : ['approved', 'not_required'].includes(company.authority_status)) &&
    (!company.authority_valid_until || company.authority_valid_until >= new Date().toISOString().slice(0, 10)));
  const isEditing = !active || active.status === 'draft' || active.status === 'in_review';
  const filtered = useMemo(() => letters.filter((letter) => {
    const q = search.trim().toLocaleLowerCase();
    const haystack = [letter.registry_no, letter.external_reference, letter.subject, letter.recipient_name,
      letter.recipient_organization, letter.sender_name, letter.sender_organization]
      .join(' ').toLocaleLowerCase();
    return (!q || haystack.includes(q)) &&
      (filterDirection === 'all' || letter.direction === filterDirection) &&
      (filterStatus === 'all' || letter.status === filterStatus);
  }), [letters, search, filterDirection, filterStatus]);

  const signedUrl = useCallback(async (path: string | null) => {
    if (!path) return '';
    const result = await db.storage.from('office-documents').createSignedUrl(path, 3600);
    return result.error ? '' : result.data?.signedUrl || '';
  }, []);

  const loadCompany = useCallback(async (selectedClientId: string, defaultName: string) => {
    if (!profile?.organization_id || !user?.id) return;
    setBusyProfile(true);
    setProfileError('');
    try {
      let query = db.from('office_company_profiles').select('*').eq('organization_id', profile.organization_id);
      query = selectedClientId ? query.eq('client_id', selectedClientId) : query.is('client_id', null);
      const existing = await query.maybeSingle();
      if (existing.error) throw existing.error;
      let row = existing.data as CompanyProfile | null;
      if (!row) {
        const inserted = await db.from('office_company_profiles').insert({
          organization_id: profile.organization_id, client_id: selectedClientId || null,
          company_name: defaultName || 'شرکت',
          authority_status: selectedClientId ? 'not_provided' : 'approved',
          created_by: user.id,
        }).select('*').single();
        if (inserted.error) throw inserted.error;
        row = inserted.data as CompanyProfile;
      }
      setCompany(row);
      setCompanyForm({
        company_name: row.company_name || defaultName, national_id: row.national_id || '',
        economic_code: row.economic_code || '', registration_number: row.registration_number || '',
        address: row.address || '', phone: row.phone || '', email: row.email || '',
        authorized_signer_name: row.authorized_signer_name || '',
        authority_reference: row.authority_reference || '',
        authority_valid_until: row.authority_valid_until || '',
      });
      const [letterhead, stamp, signature, authorization] = await Promise.all([
        signedUrl(row.letterhead_storage_path), signedUrl(row.stamp_storage_path),
        signedUrl(row.signature_storage_path), signedUrl(row.authorization_storage_path),
      ]);
      setAssetUrls({ letterhead, stamp, signature, authorization });
      if (letterhead && row.letterhead_storage_path && pdfFile(row.letterhead_storage_path)) {
        try {
          const response = await fetch(letterhead);
          const bytes = await response.arrayBuffer();
          const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            setLetterheadPreview(canvas.toDataURL('image/png'));
          }
          await pdf.destroy();
        } catch { setLetterheadPreview(''); }
      } else {
        setLetterheadPreview(letterhead);
      }
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'دریافت پروفایل شرکت ناموفق بود.');
    } finally {
      setBusyProfile(false);
    }
  }, [profile?.organization_id, user?.id, signedUrl]);

  const loadLetters = useCallback(async (companyId: string) => {
    if (!profile?.organization_id || !companyId) return;
    const result = await db.from('office_correspondence').select('*')
      .eq('organization_id', profile.organization_id).eq('company_profile_id', companyId)
      .order('created_at', { ascending: false }).limit(500);
    if (result.error) { setLetterError(result.error.message); return; }
    setLetters((result.data || []) as Letter[]);
  }, [profile?.organization_id]);

  const bootstrap = useCallback(async () => {
    if (!profile?.organization_id) return;
    try {
      const org = await supabase.from('organizations').select('name').eq('id', profile.organization_id).maybeSingle();
      if (org.error) throw org.error;
      const clientResult = await supabase.from('clients').select('id,name,national_id')
        .eq('organization_id', profile.organization_id).order('name');
      if (clientResult.error) throw clientResult.error;
      const list = (clientResult.data || []) as ClientRow[];
      setClients(list);
      let chosen = isClient ? (profile.client_id || '') : (params.get('clientId') || '');
      if (chosen && !list.some((item) => item.id === chosen)) chosen = '';
      setClientId(chosen);
      const name = chosen ? list.find((item) => item.id === chosen)?.name || 'صاحب کالا' : org.data?.name || 'کارگزاری';
      await loadCompany(chosen, name);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'بارگذاری دبیرخانه ناموفق بود.');
    }
  }, [profile?.organization_id, profile?.client_id, isClient, params, loadCompany]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => { if (company?.id) void loadLetters(company.id); }, [company?.id, loadLetters]);

  const switchCompany = async (id: string) => {
    const name = id ? clients.find((item) => item.id === id)?.name || 'صاحب کالا' : 'کارگزاری';
    setClientId(id);
    setParams(id ? { clientId: id } : {});
    setActive(null);
    setDraft({ ...blankDraft });
    setLetters([]);
    setAttachments([]);
    await loadCompany(id, name);
  };

  const saveCompany = async () => {
    if (!company || !companyForm.company_name.trim()) return setProfileError('نام رسمی شرکت الزامی است.');
    setBusyProfile(true); setProfileError(''); setProfileNotice('');
    const patch: Record<string, unknown> = {
      ...companyForm, company_name: companyForm.company_name.trim(),
      authority_valid_until: companyForm.authority_valid_until || null,
    };
    if (company.client_id) {
      patch.authority_status = 'pending';
      patch.authority_approved_by = null;
      patch.authority_approved_at = null;
    }
    try {
      const result = await db.from('office_company_profiles').update(patch).eq('id', company.id).select('*').single();
      if (result.error) throw result.error;
      setCompany(result.data as CompanyProfile);
      setProfileNotice('اطلاعات هویتی شرکت ذخیره شد.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'ذخیره اطلاعات ناموفق بود.');
    } finally { setBusyProfile(false); }
  };

  const uploadAsset = async (kind: 'letterhead' | 'stamp' | 'signature' | 'authorization', file?: File) => {
    if (!file || !company || !profile?.organization_id || !user?.id) return;
    const allowed = kind === 'letterhead'
      ? ['application/pdf','image/png','image/jpeg','image/webp']
      : ['application/pdf','image/png','image/jpeg'];
    if (!allowed.includes(file.type)) return setProfileError('نوع فایل انتخاب‌شده پشتیبانی نمی‌شود.');
    if (file.size > 20 * 1024 * 1024) return setProfileError('حجم فایل هویتی حداکثر ۲۰ مگابایت است.');
    setBusyProfile(true); setProfileError(''); setProfileNotice('');
    const folder = clientId || 'organization';
    const path = profile.organization_id + '/' + folder + '/assets/' + kind + '-' + crypto.randomUUID() + '-' + safeName(file.name);
    try {
      const uploaded = await db.storage.from('office-documents').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
      if (uploaded.error) throw uploaded.error;
      const column = ({
        letterhead: 'letterhead_storage_path', stamp: 'stamp_storage_path',
        signature: 'signature_storage_path', authorization: 'authorization_storage_path',
      } as const)[kind];
      const patch: Record<string, unknown> = { [column]: path };
      if (clientId) {
        patch.authority_status = 'pending';
        patch.authority_approved_by = null;
        patch.authority_approved_at = null;
      }
      const saved = await db.from('office_company_profiles').update(patch).eq('id', company.id).select('*').single();
      if (saved.error) {
        await db.storage.from('office-documents').remove([path]);
        throw saved.error;
      }
      setCompany(saved.data as CompanyProfile);
      const url = await signedUrl(path);
      setAssetUrls((old) => ({ ...old, [kind]: url }));
      if (kind === 'letterhead' && url) {
        if (pdfFile(file.name)) {
          const response = await fetch(url);
          const bytes = await response.arrayBuffer();
          const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) { await page.render({ canvasContext: ctx, viewport }).promise; setLetterheadPreview(canvas.toDataURL('image/png')); }
          await pdf.destroy();
        } else setLetterheadPreview(url);
      }
      setProfileNotice('فایل به پروفایل همین شرکت متصل شد.' + (clientId ? ' تأیید مجوز برای بررسی مجدد به حالت انتظار رفت.' : ''));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'بارگذاری فایل ناموفق بود.');
    } finally { setBusyProfile(false); }
  };

  const approveAuthority = async () => {
    if (!company || !company.client_id || !canApproveAuthority || !user?.id) return;
    if (!company.authorization_storage_path) return setProfileError('ابتدا مدرک معتبر نمایندگی یا وکالت‌نامه را بارگذاری کنید.');
    if (!companyForm.authority_reference.trim()) return setProfileError('شماره یا شناسه سند نمایندگی را ثبت کنید.');
    if (!companyForm.authorized_signer_name.trim()) return setProfileError('نام امضاکننده مجاز را ثبت کنید.');
    if (companyForm.authority_valid_until && companyForm.authority_valid_until < new Date().toISOString().slice(0, 10)) {
      return setProfileError('تاریخ اعتبار مجوز گذشته است.');
    }
    setAuthorityBusy(true); setProfileError(''); setProfileNotice('');
    try {
      const evidence = await db.from('office_company_profiles').update({
        authorized_signer_name: companyForm.authorized_signer_name.trim(),
        authority_reference: companyForm.authority_reference.trim(),
        authority_valid_until: companyForm.authority_valid_until || null,
        authority_status: 'pending',
        authority_approved_by: null,
        authority_approved_at: null,
      }).eq('id', company.id).select('*').single();
      if (evidence.error) throw evidence.error;
      const approved = await db.from('office_company_profiles').update({
        authority_status: 'approved',
      }).eq('id', company.id).select('*').single();
      if (approved.error) throw approved.error;
      setCompany(approved.data as CompanyProfile);
      setProfileNotice('مجوز نمایندگی با ثبت مدرک، مرجع و امضاکننده تأیید شد؛ امکان استفاده کنترل‌شده از هویت این صاحب‌کالا فعال است.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'تأیید مجوز ناموفق بود.');
    } finally { setAuthorityBusy(false); }
  };

  const newLetter = () => {
    setActive(null); setActiveAssetUrls(assetUrls); setDraft({
      ...blankDraft, sender_name: companyForm.authorized_signer_name,
      sender_organization: company?.company_name || '',
      apply_stamp: Boolean(company?.stamp_storage_path),
      apply_signature: Boolean(company?.signature_storage_path),
    });
    setAttachments([]); setAttachmentUrls({}); setPendingAttachments([]); setEvents([]);
    setLetterError(''); setLetterNotice('');
  };

  const selectLetter = async (letter: Letter) => {
    setActive(letter);
    const issuedSnapshot = ['issued','sent','archived'].includes(letter.status);
    const [letterheadUrl, stampUrl, signatureUrl] = await Promise.all([
      signedUrl(issuedSnapshot ? letter.issued_letterhead_storage_path : company?.letterhead_storage_path || null),
      signedUrl(issuedSnapshot ? letter.issued_stamp_storage_path : company?.stamp_storage_path || null),
      signedUrl(issuedSnapshot ? letter.issued_signature_storage_path : company?.signature_storage_path || null),
    ]);
    setActiveAssetUrls({ letterhead: letterheadUrl, stamp: stampUrl, signature: signatureUrl });
    const effectiveLetterheadPath = issuedSnapshot
      ? letter.issued_letterhead_storage_path
      : company?.letterhead_storage_path || null;
    if (letterheadUrl && effectiveLetterheadPath && pdfFile(effectiveLetterheadPath)) {
      try {
        const response = await fetch(letterheadUrl);
        if (!response.ok) throw new Error('Letterhead snapshot fetch failed.');
        const bytes = await response.arrayBuffer();
        const pdfDocument = await getDocument({ data: new Uint8Array(bytes) }).promise;
        const firstPage = await pdfDocument.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (context) {
          await firstPage.render({ canvasContext: context, viewport }).promise;
          setLetterheadPreview(canvas.toDataURL('image/png'));
        }
        await pdfDocument.destroy();
      } catch { setLetterheadPreview(''); }
    } else {
      setLetterheadPreview(letterheadUrl);
    }
    setDraft({
      direction: letter.direction, recipient_name: letter.recipient_name || '',
      recipient_organization: letter.recipient_organization || '', sender_name: letter.sender_name || '',
      sender_organization: letter.sender_organization || '', external_reference: letter.external_reference || '',
      letter_date: letter.letter_date || '', subject: letter.subject, body: letter.body,
      notes: letter.notes || '', response_due_date: letter.response_due_date || '',
      response_status: letter.response_status || 'not_required', visible_to_client: letter.visible_to_client,
      apply_stamp: letter.apply_stamp, apply_signature: letter.apply_signature,
    });
    setPendingAttachments([]);
    if (!profile?.organization_id) return;
    const [a, e] = await Promise.all([
      db.from('office_correspondence_attachments').select('id,original_name,mime_type,size_bytes,storage_path')
        .eq('organization_id', profile.organization_id).eq('correspondence_id', letter.id).order('created_at'),
      db.from('office_correspondence_events').select('id,event_type,from_status,to_status,created_at')
        .eq('organization_id', profile.organization_id).eq('correspondence_id', letter.id).order('created_at', { ascending: false }).limit(30),
    ]);
    const rows = (a.data || []) as Attachment[];
    setAttachments(rows);
    const signed = await Promise.all(rows.map(async (item) => [item.id, await signedUrl(item.storage_path)] as const));
    setAttachmentUrls(Object.fromEntries(signed));
    setEvents((e.data || []) as EventRow[]);
  };

  const uploadAttachments = async (letterId: string, files: File[]) => {
    if (!company || !profile?.organization_id || !user?.id) return;
    for (const file of files) {
      if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('حجم هر پیوست باید کمتر از ۵۰ مگابایت باشد: ' + file.name);
      const path = profile.organization_id + '/' + (clientId || 'organization') + '/letters/' + letterId + '/' + crypto.randomUUID() + '-' + safeName(file.name);
      const uploaded = await db.storage.from('office-documents').upload(path, file, {
        contentType: file.type || 'application/octet-stream', cacheControl: '3600', upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
      const saved = await db.from('office_correspondence_attachments').insert({
        organization_id: profile.organization_id, correspondence_id: letterId, storage_path: path,
        original_name: file.name, mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size, created_by: user.id,
      });
      if (saved.error) { await db.storage.from('office-documents').remove([path]); throw saved.error; }
      setPendingAttachments((previous) => {
        const index = previous.indexOf(file);
        return index < 0 ? previous : previous.filter((_, itemIndex) => itemIndex !== index);
      });
    }
  };

  const saveLetter = async (nextStatus: 'draft' | 'in_review') => {
    if (!company || !profile?.organization_id || !user?.id) return;
    if (!draft.subject.trim() || !draft.body.trim()) return setLetterError('موضوع و متن نامه الزامی است.');
    if (draft.apply_stamp && !company.stamp_storage_path) return setLetterError('مهر این شرکت هنوز بارگذاری نشده است.');
    if (draft.apply_signature && !company.signature_storage_path) return setLetterError('امضای مجاز این شرکت هنوز بارگذاری نشده است.');
    setBusyLetter(true); setLetterError(''); setLetterNotice('');
    const payload = {
      organization_id: profile.organization_id, company_profile_id: company.id,
      direction: draft.direction, year_key: yearKey(), external_reference: draft.external_reference || null,
      letter_date: draft.letter_date || null, recipient_name: draft.recipient_name || null,
      recipient_organization: draft.recipient_organization || null, sender_name: draft.sender_name || null,
      sender_organization: draft.sender_organization || null, subject: draft.subject.trim(), body: draft.body,
      notes: draft.notes || null, response_due_date: draft.response_due_date || null,
      response_status: draft.response_status, visible_to_client: draft.visible_to_client,
      apply_stamp: draft.apply_stamp, apply_signature: draft.apply_signature, updated_by: user.id,
    };
    try {
      let row: Letter;
      if (active && ['draft','in_review'].includes(active.status)) {
        const updated = await db.from('office_correspondence').update({ ...payload, status: nextStatus })
          .eq('id', active.id).eq('organization_id', profile.organization_id).select('*').single();
        if (updated.error) throw updated.error;
        row = updated.data as Letter;
      } else {
        const inserted = await db.from('office_correspondence').insert({
          ...payload, status: 'draft', created_by: user.id,
        }).select('*').single();
        if (inserted.error) throw inserted.error;
        row = inserted.data as Letter;
        setActive(row);
        if (nextStatus === 'in_review') {
          const submitted = await db.from('office_correspondence').update({ status: 'in_review' })
            .eq('id', row.id).eq('organization_id', profile.organization_id).select('*').single();
          if (submitted.error) throw submitted.error;
          row = submitted.data as Letter;
        }
      }
      setActive(row);
      await loadLetters(company.id);
      if (pendingAttachments.length) await uploadAttachments(row.id, pendingAttachments);
      setPendingAttachments([]);
      setLetterNotice(nextStatus === 'in_review' ? 'نامه برای بررسی و تأیید ارسال شد.' : 'پیش‌نویس ذخیره شد.');
      await selectLetter(row);
    } catch (error) {
      setLetterError(error instanceof Error ? error.message : 'ذخیره نامه ناموفق بود.');
      if (company?.id) await loadLetters(company.id);
    } finally { setBusyLetter(false); }
  };

  const changeStatus = async (next: 'approved' | 'issued' | 'sent' | 'archived') => {
    if (!active || !profile?.organization_id) return;
    if (next === 'issued' && !validAuthority) return setLetterError('مجوز نمایندگی معتبر برای این شرکت هنوز تأیید نشده است.');
    setBusyLetter(true); setLetterError(''); setLetterNotice('');
    try {
      const patch: Record<string, unknown> = { status: next };
      if (next === 'issued') patch.year_key = yearKey();
      const result = await db.from('office_correspondence').update(patch).eq('id', active.id)
        .eq('organization_id', profile.organization_id).select('*').single();
      if (result.error) throw result.error;
      const row = result.data as Letter;
      await loadLetters(company?.id || '');
      await selectLetter(row);
      setLetterNotice(next === 'issued'
        ? 'نامه صادر شد؛ شماره اندیکاتور به‌صورت اتمیک ثبت و متن نسخه نهایی قفل شد.'
        : next === 'approved' ? 'نامه تأیید شد.' : next === 'sent' ? 'ارسال نامه ثبت شد.' : 'نامه بایگانی شد.');
    } catch (error) {
      setLetterError(error instanceof Error ? error.message : 'تغییر وضعیت نامه ناموفق بود.');
    } finally { setBusyLetter(false); }
  };

  const deleteDraft = async () => {
    if (!active || active.status !== 'draft' || !profile?.organization_id) return;
    if (!window.confirm('پیش‌نویس حذف شود؟ این عملیات قابل بازگشت نیست.')) return;
    setBusyLetter(true);
    try {
      const draftPaths = attachments.map((item) => item.storage_path).filter(Boolean);
      if (draftPaths.length) {
        const removed = await db.storage.from('office-documents').remove(draftPaths);
        if (removed.error) throw removed.error;
      }
      const result = await db.from('office_correspondence').delete().eq('id', active.id).eq('organization_id', profile.organization_id);
      if (result.error) throw result.error;
      setActive(null); setDraft({ ...blankDraft }); await loadLetters(company?.id || '');
      setLetterNotice('پیش‌نویس حذف شد.');
    } catch (error) { setLetterError(error instanceof Error ? error.message : 'حذف پیش‌نویس ناموفق بود.'); }
    finally { setBusyLetter(false); }
  };

  const inputClass = 'mt-1 min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm disabled:opacity-60';
  return (
    <main className="office-app min-h-[calc(100dvh-64px)] bg-[var(--bg)] p-3 text-[var(--text)] md:p-6" dir="rtl">
      <style>{'.office-print-sheet{display:none}@media print{@page{size:A4;margin:14mm 16mm}body{background:#fff!important}body *{visibility:hidden!important}.office-print-sheet,.office-print-sheet *{visibility:visible!important}.office-print-sheet{display:block!important;position:absolute;inset:0;width:100%;padding:0;color:#111!important;background:#fff!important;font-family:Tahoma,Arial,sans-serif;direction:rtl}.office-print-sheet .letter-body{white-space:pre-wrap;line-height:2.1;font-size:13px;text-align:justify}.office-print-sheet .letter-header img{max-height:35mm;max-width:100%;object-fit:contain}.office-print-sheet .signature-assets img{max-height:28mm;max-width:45mm;object-fit:contain}.office-print-sheet .letter-attachments{page-break-inside:avoid}}'}</style>
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-400"><FileSignature size={25}/></div>
            <div><h1 className="text-xl font-black md:text-2xl">دبیرخانه و اتوماسیون اداری</h1><p className="mt-1 text-xs text-[var(--muted)]">سربرگ، مهر، امضا، مکاتبات و دفتر اندیکاتور</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/clients" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">صاحبان کالا</Link>
            <Link to="/pdf-studio" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">PDF Studio</Link>
            <Link to="/file-manager" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">فایل‌منیجر</Link>
          </div>
        </header>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Building2 size={20} className="text-blue-400"/>
            <div className="min-w-0 flex-1"><div className="text-xs text-[var(--muted)]">دفتر مکاتبات متعلق به</div><div className="truncate font-black">{company?.company_name || 'در حال بارگذاری…'}</div></div>
            {!isClient && <select value={clientId} onChange={(event) => void switchCompany(event.target.value)} className="min-h-10 min-w-[190px] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
              <option value="">کارگزاری / شرکت نماینده</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
            {busyProfile && <Loader2 size={18} className="animate-spin text-blue-400"/>}
          </div>
          {clientId && <div className="mt-3 flex items-center gap-2 rounded-xl bg-blue-500/5 px-3 py-2 text-xs"><BadgeCheck size={15} className="text-blue-400"/> اطلاعات و شماره‌گذاری این صاحب‌کالا کاملاً مستقل از سایر شرکت‌هاست.</div>}
        </section>

        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <h2 className="mb-3 font-black">اطلاعات رسمی شرکت</h2>
              <label className="block text-xs text-[var(--muted)]">نام رسمی شرکت<input className={inputClass} disabled={!canConfigure} value={companyForm.company_name} onChange={(e) => setCompanyForm((p) => ({ ...p, company_name: e.target.value }))}/></label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-[var(--muted)]">شناسه ملی<input className={inputClass} disabled={!canConfigure} value={companyForm.national_id} onChange={(e) => setCompanyForm((p) => ({ ...p, national_id: e.target.value }))}/></label>
                <label className="text-xs text-[var(--muted)]">کد اقتصادی<input className={inputClass} disabled={!canConfigure} value={companyForm.economic_code} onChange={(e) => setCompanyForm((p) => ({ ...p, economic_code: e.target.value }))}/></label>
                <label className="text-xs text-[var(--muted)]">شماره ثبت<input className={inputClass} disabled={!canConfigure} value={companyForm.registration_number} onChange={(e) => setCompanyForm((p) => ({ ...p, registration_number: e.target.value }))}/></label>
                <label className="text-xs text-[var(--muted)]">تلفن<input className={inputClass} disabled={!canConfigure} value={companyForm.phone} onChange={(e) => setCompanyForm((p) => ({ ...p, phone: e.target.value }))}/></label>
              </div>
              <label className="mt-2 block text-xs text-[var(--muted)]">آدرس<textarea className={inputClass + ' py-2'} rows={2} disabled={!canConfigure} value={companyForm.address} onChange={(e) => setCompanyForm((p) => ({ ...p, address: e.target.value }))}/></label>
              <label className="mt-2 block text-xs text-[var(--muted)]">ایمیل<input className={inputClass} disabled={!canConfigure} value={companyForm.email} onChange={(e) => setCompanyForm((p) => ({ ...p, email: e.target.value }))}/></label>
              {canConfigure && <button type="button" onClick={() => void saveCompany()} disabled={busyProfile || !company} className="mt-3 min-h-10 w-full rounded-xl bg-blue-600 text-sm font-bold text-white disabled:opacity-40"><Save className="ml-1 inline" size={15}/> ذخیره مشخصات</button>}
              {profileNotice && <p className="mt-2 rounded-xl bg-emerald-500/10 p-2 text-xs text-emerald-500">{profileNotice}</p>}
              {profileError && <p className="mt-2 rounded-xl bg-red-500/10 p-2 text-xs text-red-400">{profileError}</p>}
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <h2 className="mb-2 font-black">هویت بصری و مجوزها</h2>
              {([
                ['letterhead','سربرگ شرکت',FileText,letterheadInput,'PDF یا تصویر'],
                ['stamp','مهر شرکت',Stamp,stampInput,'PNG/JPG'],
                ['signature','امضای مجاز',PenLine,signatureInput,'PNG/JPG'],
                ['authorization','وکالت‌نامه / معرفی‌نامه نمایندگی',ShieldCheck,authorityInput,'مدرک قانونی'],
              ] as const).map(([kind,label,Icon,ref,hint]) => (
                <div key={kind} className="flex items-center gap-2 border-b border-[var(--border)] py-2.5 last:border-0">
                  <Icon size={17} className="text-blue-400"/>
                  <div className="min-w-0 flex-1"><div className="text-xs font-bold">{label}</div><div className="text-[10px] text-[var(--muted)]">{assetUrls[kind] ? 'فایل ثبت شده' : hint}</div></div>
                  {assetUrls[kind] && <a href={assetUrls[kind]} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] p-2"><Eye size={14}/></a>}
                  {canConfigure && <button type="button" disabled={busyProfile} onClick={() => ref.current?.click()} className="rounded-lg border border-[var(--border)] p-2 disabled:opacity-40"><Upload size={14}/></button>}
                  <input ref={ref} type="file" className="hidden" accept={kind === 'letterhead' ? '.pdf,image/png,image/jpeg,image/webp' : '.pdf,image/png,image/jpeg'} onChange={(e) => {
                    const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void uploadAsset(kind, file);
                  }}/>
                </div>
              ))}
              {clientId && <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-2 text-xs font-bold">
                  {validAuthority ? <CheckCircle2 className="text-emerald-500" size={16}/> : <AlertCircle className="text-amber-500" size={16}/>}
                  {authorityName[company?.authority_status || 'not_provided']}
                </div>
                <label className="mt-3 block text-xs text-[var(--muted)]">نام امضاکننده مجاز<input className={inputClass} disabled={!canConfigure} value={companyForm.authorized_signer_name} onChange={(e) => setCompanyForm((p) => ({ ...p, authorized_signer_name: e.target.value }))}/></label>
                <label className="mt-2 block text-xs text-[var(--muted)]">شماره مجوز<input className={inputClass} disabled={!canConfigure} value={companyForm.authority_reference} onChange={(e) => setCompanyForm((p) => ({ ...p, authority_reference: e.target.value }))}/></label>
                <label className="mt-2 block text-xs text-[var(--muted)]">اعتبار تا<input type="date" className={inputClass} disabled={!canConfigure} value={companyForm.authority_valid_until} onChange={(e) => setCompanyForm((p) => ({ ...p, authority_valid_until: e.target.value }))}/></label>
                {canConfigure && <button type="button" onClick={() => void saveCompany()} className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold">ذخیره اطلاعات مجوز</button>}
                {canApproveAuthority && <button type="button" onClick={() => void approveAuthority()} disabled={authorityBusy || busyProfile || !company?.authorization_storage_path} className="mt-2 w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                  {authorityBusy ? <Loader2 className="ml-1 inline animate-spin" size={14}/> : <BadgeCheck className="ml-1 inline" size={14}/>} تأیید مجوز نمایندگی
                </button>}
                <p className="mt-2 text-[10px] leading-5 text-[var(--muted)]">بارگذاری مهر و امضا به‌تنهایی اجازه استفاده نیست. ابتدا مدرک نمایندگی باید بررسی و توسط مدیر مجاز تأیید شود. جایگزینی فایل‌های هویتی، تأیید قبلی را باطل می‌کند.</p>
              </div>}
              {letterheadPreview && <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-white p-2"><img src={letterheadPreview} alt="پیش‌نمایش سربرگ" className="max-h-36 w-full object-contain"/></div>}
            </section>
          </aside>

          <section className="min-w-0 space-y-4">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="font-black">دفتر اندیکاتور و مکاتبات</h2><p className="mt-1 text-xs text-[var(--muted)]">شماره‌گذاری مستقل بر اساس شرکت، سال و نوع نامه</p></div>
                {!isClient && <button type="button" onClick={newLetter} className="min-h-10 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white"><Plus className="ml-1 inline" size={15}/> نامه جدید</button>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['کل مکاتبات',letters.length],['وارده',letters.filter((x) => x.direction === 'incoming').length],
                  ['صادره',letters.filter((x) => x.direction === 'outgoing').length],
                  ['در انتظار بررسی',letters.filter((x) => x.status === 'in_review').length],
                ].map(([label,count]) => <div key={String(label)} className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-[10px] text-[var(--muted)]">{label}</div><div className="mt-1 text-xl font-black">{new Intl.NumberFormat('fa-IR').format(Number(count))}</div></div>)}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_140px]">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو در شماره، موضوع، فرستنده و گیرنده" className={inputClass + ' mt-0'}/>
                <select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)} className={inputClass + ' mt-0'}><option value="all">همه انواع</option><option value="incoming">وارده</option><option value="outgoing">صادره</option><option value="internal">داخلی</option></select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={inputClass + ' mt-0'}><option value="all">همه وضعیت‌ها</option>{Object.entries(statusName).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-right text-xs">
                  <thead><tr className="border-b border-[var(--border)] text-[var(--muted)]"><th className="p-2">شماره اندیکاتور</th><th className="p-2">نوع</th><th className="p-2">موضوع</th><th className="p-2">تاریخ</th><th className="p-2">وضعیت</th></tr></thead>
                  <tbody>
                    {filtered.map((letter) => <tr key={letter.id} onClick={() => void selectLetter(letter)} className={'cursor-pointer border-b border-[var(--border)] hover:bg-[var(--surface-2)] ' + (active?.id === letter.id ? 'bg-blue-500/10' : '')}>
                      <td className="whitespace-nowrap p-2 font-bold">{letter.registry_no || '—'}</td><td className="whitespace-nowrap p-2">{directionName[letter.direction]}</td>
                      <td className="max-w-[250px] truncate p-2">{letter.subject}</td><td className="whitespace-nowrap p-2">{dateLabel(letter.issued_at || letter.letter_date || letter.created_at)}</td>
                      <td className="whitespace-nowrap p-2"><span className="rounded-lg bg-[var(--surface-2)] px-2 py-1">{statusName[letter.status] || letter.status}</span></td>
                    </tr>)}
                    {!filtered.length && <tr><td colSpan={5} className="p-8 text-center text-[var(--muted)]">برای این شرکت هنوز نامه‌ای ثبت نشده است.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {isClient ? <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-xs leading-7 text-[var(--muted)]"><div className="flex items-center gap-2 font-bold text-[var(--text)]"><Inbox size={18}/> کارتابل شرکت</div>نامه‌هایی که کارگزاری برای نمایش به شرکت شما ثبت کرده است، در دفتر بالا قابل مشاهده‌اند. ثبت، تأیید و صدور مکاتبه از طرف شرکت نماینده، در اختیار کاربران مجاز کارگزاری است.</section> : <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-black">{active ? 'جزئیات و گردش نامه' : 'تنظیم نامه'}</h2><p className="mt-1 text-xs text-[var(--muted)]">{active ? (active.registry_no || 'بدون شماره ثبت') + ' · ' + (statusName[active.status] || active.status) : 'پیش‌نویس جدید برای ' + (company?.company_name || '')}</p></div>{active && <button type="button" onClick={newLetter} className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs"><Plus className="ml-1 inline" size={14}/> نامه جدید</button>}</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-[var(--muted)]">نوع مکاتبه<select disabled={Boolean(active && !isEditing)} value={draft.direction} onChange={(e) => setDraft((p) => ({ ...p, direction: e.target.value as Draft['direction'] }))} className={inputClass}><option value="outgoing">صادره</option><option value="incoming">وارده</option><option value="internal">داخلی</option></select></label>
                <label className="text-xs text-[var(--muted)]">تاریخ نامه<input type="date" disabled={Boolean(active && !isEditing)} value={draft.letter_date} onChange={(e) => setDraft((p) => ({ ...p, letter_date: e.target.value }))} className={inputClass}/></label>
                <label className="text-xs text-[var(--muted)]">گیرنده<input disabled={Boolean(active && !isEditing)} value={draft.recipient_name} onChange={(e) => setDraft((p) => ({ ...p, recipient_name: e.target.value }))} className={inputClass}/></label>
                <label className="text-xs text-[var(--muted)]">سازمان گیرنده<input disabled={Boolean(active && !isEditing)} value={draft.recipient_organization} onChange={(e) => setDraft((p) => ({ ...p, recipient_organization: e.target.value }))} className={inputClass}/></label>
                <label className="text-xs text-[var(--muted)]">نام فرستنده / امضاکننده<input disabled={Boolean(active && !isEditing)} value={draft.sender_name} onChange={(e) => setDraft((p) => ({ ...p, sender_name: e.target.value }))} className={inputClass}/></label>
                <label className="text-xs text-[var(--muted)]">شماره نامه مرجع<input disabled={Boolean(active && !isEditing)} value={draft.external_reference} onChange={(e) => setDraft((p) => ({ ...p, external_reference: e.target.value }))} className={inputClass}/></label>
                <label className="md:col-span-2 text-xs text-[var(--muted)]">موضوع<input disabled={Boolean(active && !isEditing)} value={draft.subject} onChange={(e) => setDraft((p) => ({ ...p, subject: e.target.value }))} className={inputClass + ' font-bold'}/></label>
                <label className="md:col-span-2 text-xs text-[var(--muted)]">متن نامه<textarea rows={11} disabled={Boolean(active && !isEditing)} value={draft.body} onChange={(e) => setDraft((p) => ({ ...p, body: e.target.value }))} className={inputClass + ' min-h-64 resize-y py-3 leading-8'} placeholder="متن رسمی نامه را وارد کنید…"/></label>
                <label className="text-xs text-[var(--muted)]">مهلت پاسخ<input type="date" disabled={Boolean(active && !isEditing)} value={draft.response_due_date} onChange={(e) => setDraft((p) => ({ ...p, response_due_date: e.target.value }))} className={inputClass}/></label>
                <label className="text-xs text-[var(--muted)]">وضعیت پاسخ<select disabled={Boolean(active && !isEditing)} value={draft.response_status} onChange={(e) => setDraft((p) => ({ ...p, response_status: e.target.value }))} className={inputClass}><option value="not_required">نیازی به پاسخ نیست</option><option value="pending">در انتظار پاسخ</option><option value="answered">پاسخ دریافت شد</option><option value="overdue">مهلت پاسخ گذشته</option></select></label>
                <label className="md:col-span-2 text-xs text-[var(--muted)]">یادداشت داخلی<textarea rows={2} disabled={Boolean(active && !isEditing)} value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} className={inputClass + ' py-2'}/></label>
              </div>

              {isEditing && <div className="mt-3 flex flex-wrap gap-4 rounded-xl bg-[var(--surface-2)] p-3 text-xs">
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.apply_signature} onChange={(e) => setDraft((p) => ({ ...p, apply_signature: e.target.checked }))}/> درج امضای ثبت‌شده</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.apply_stamp} onChange={(e) => setDraft((p) => ({ ...p, apply_stamp: e.target.checked }))}/> درج مهر شرکت</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.visible_to_client} onChange={(e) => setDraft((p) => ({ ...p, visible_to_client: e.target.checked }))}/> نمایش برای صاحب کالا</label>
              </div>}

              {isEditing && <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold"><Paperclip size={15}/> پیوست‌ها</div><button type="button" onClick={() => attachmentInput.current?.click()} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs"><Upload className="ml-1 inline" size={14}/> افزودن فایل</button>
                  <input ref={attachmentInput} type="file" multiple className="hidden" onChange={(e) => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; setPendingAttachments((p) => [...p, ...files]); }}/>
                </div>
                {pendingAttachments.map((file, index) => <div key={file.name + index} className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="truncate">{file.name} · {sizeName(file.size)}</span><button type="button" onClick={() => setPendingAttachments((p) => p.filter((_, i) => i !== index))}><X size={14}/></button></div>)}
              </div>}
              {attachments.length > 0 && <div className="mt-3 rounded-xl border border-[var(--border)] p-3"><div className="mb-2 text-xs font-bold">پیوست‌های ثبت‌شده</div>{attachments.map((item) => <div key={item.id} className="flex items-center gap-2 py-1 text-xs"><FileText size={15} className="text-blue-400"/><span className="min-w-0 flex-1 truncate">{item.original_name} · {sizeName(item.size_bytes)}</span>{attachmentUrls[item.id] && <a href={attachmentUrls[item.id]} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] p-2"><Download size={14}/></a>}</div>)}</div>}

              <div className="mt-4 flex flex-wrap gap-2">
                {isEditing && <>
                  <button type="button" onClick={() => void saveLetter('draft')} disabled={busyLetter} className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-xs font-bold"><Save className="ml-1 inline" size={14}/> ذخیره پیش‌نویس</button>
                  <button type="button" onClick={() => void saveLetter('in_review')} disabled={busyLetter} className="min-h-10 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white"><Send className="ml-1 inline" size={14}/> ارسال برای تأیید</button>
                  {active?.status === 'draft' && <button type="button" onClick={() => void deleteDraft()} disabled={busyLetter} className="min-h-10 rounded-xl border border-red-500/30 px-3 text-xs text-red-500"><Archive className="ml-1 inline" size={14}/> حذف پیش‌نویس</button>}
                </>}
                {active?.status === 'in_review' && isManager && <button type="button" onClick={() => void changeStatus('approved')} disabled={busyLetter} className="min-h-10 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white"><CheckCircle2 className="ml-1 inline" size={14}/> تأیید نامه</button>}
                {active?.status === 'approved' && isManager && <button type="button" onClick={() => void changeStatus('issued')} disabled={busyLetter || (Boolean(clientId) && !validAuthority)} className="min-h-10 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white disabled:opacity-40"><FileCheck2 className="ml-1 inline" size={14}/> صدور و ثبت اندیکاتور</button>}
                {active?.status === 'issued' && <button type="button" onClick={() => void changeStatus('sent')} disabled={busyLetter} className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-xs"><Mail className="ml-1 inline" size={14}/> ثبت ارسال</button>}
                {['issued','sent'].includes(active?.status || '') && <button type="button" onClick={() => void changeStatus('archived')} disabled={busyLetter} className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-xs"><Archive className="ml-1 inline" size={14}/> بایگانی</button>}
                {active && <button type="button" onClick={() => window.print()} className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-xs font-bold"><Printer className="ml-1 inline" size={14}/> چاپ / ذخیره PDF</button>}
              </div>
              {busyLetter && <div className="mt-3 flex items-center gap-2 text-xs text-blue-400"><Loader2 size={15} className="animate-spin"/> عملیات در حال انجام است…</div>}
              {letterNotice && <p className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-500">{letterNotice}</p>}
              {letterError && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-400">{letterError}</p>}
              {events.length > 0 && <div className="mt-4 border-t border-[var(--border)] pt-3"><div className="mb-2 flex items-center gap-2 text-xs font-bold"><ClipboardList size={15}/> تاریخچه تغییرات</div>{events.map((event) => <div key={event.id} className="flex justify-between gap-2 py-1 text-[11px] text-[var(--muted)]"><span>{event.event_type === 'created' ? 'ایجاد پیش‌نویس' : event.event_type === 'status_changed' ? (statusName[event.from_status || ''] || '') + ' ← ' + (statusName[event.to_status || ''] || '') : 'ویرایش محتوای نامه'}</span><span>{dateLabel(event.created_at)}</span></div>)}</div>}
            </section>}
          </section>
        </div>
      </div>

      {active && <section className="office-print-sheet" dir="rtl">
        <div className="letter-header border-b border-slate-300 pb-3">{letterheadPreview ? <img src={letterheadPreview} alt="سربرگ شرکت"/> : <div className="text-center text-lg font-bold">{active.issued_company_name || company?.company_name}</div>}</div>
        <div className="mt-5 flex justify-between gap-4 text-xs">
          <div><div><b>شماره:</b> {active.registry_no || 'پیش‌نویس'}</div><div className="mt-2"><b>تاریخ:</b> {dateLabel(active.issued_at || active.letter_date || active.created_at)}</div><div className="mt-2"><b>پیوست:</b> {new Intl.NumberFormat('fa-IR').format(attachments.length)} مورد</div></div>
          <div><b>نوع:</b> {directionName[active.direction]}</div>
        </div>
        <div className="mt-6 text-sm"><b>گیرنده:</b> {active.recipient_name || '—'} {active.recipient_organization ? ' ـ ' + active.recipient_organization : ''}</div>
        <div className="mt-4 text-sm"><b>موضوع:</b> {active.subject}</div>
        <div className="letter-body mt-6 min-h-[125mm]">{active.body}</div>
        <div className="signature-assets mt-10 flex items-end justify-between gap-6">
          <div className="text-center">{active.apply_signature && activeAssetUrls.signature && <img src={activeAssetUrls.signature} alt="امضا"/>}<div className="mt-2 text-xs font-bold">{active.issued_signer_name || active.sender_name || companyForm.authorized_signer_name}</div><div className="text-[10px]">{active.issued_company_name || company?.company_name}</div></div>
          <div className="text-center">{active.apply_stamp && activeAssetUrls.stamp && <img src={activeAssetUrls.stamp} alt="مهر شرکت"/>}</div>
        </div>
        {attachments.length > 0 && <div className="letter-attachments mt-8 border-t border-slate-300 pt-3 text-xs"><b>پیوست‌ها:</b><ul className="mt-2 list-disc pr-5">{attachments.map((item) => <li key={item.id}>{item.original_name}</li>)}</ul></div>}
        <footer className="mt-10 border-t border-slate-300 pt-3 text-center text-[10px] text-slate-600">{active.issued_company_address || company?.address || ''} {active.issued_company_phone || company?.phone ? ' · ' + (active.issued_company_phone || company?.phone) : ''} {active.issued_company_email || company?.email ? ' · ' + (active.issued_company_email || company?.email) : ''}</footer>
      </section>}
    </main>
  );
};
