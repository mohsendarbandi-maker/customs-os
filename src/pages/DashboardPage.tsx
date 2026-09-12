import React, { useState } from 'react';
import { extractCustomsDataWithAI } from '../services/geminiService';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Wand2, Save, Loader2, CheckCircle2, AlertCircle,
  Ship, Building2, Wallet, LayoutDashboard, Search, Menu, LogOut, FileUp
} from 'lucide-react';

const roleLabels: Record<string, { fa: string; en: string }> = {
  owner: { fa: 'مالک', en: 'Owner' },
  admin: { fa: 'مدیر', en: 'Admin' },
  broker: { fa: 'کارگزار', en: 'Broker' },
  accountant: { fa: 'حسابدار', en: 'Accountant' },
  warehouse: { fa: 'انباردار', en: 'Warehouse' },
  client: { fa: 'مشتری', en: 'Client' },
};

export const DashboardPage: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'ships' | 'customs' | 'finance' | 'smart_paste'>('home');
  const [lang, setLang] = useState<'FA' | 'EN'>('FA');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [formData, setFormData] = useState({
    client: '', vessel: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: ''
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info', text: string } | null>(null);

  const handleSmartPaste = () => {
    if (!pasteText.trim()) {
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'متنی برای پردازش وجود ندارد.' : 'No text to process.' });
      return;
    }
    const text = pasteText;
    const extract = (regex: RegExp) => text.match(regex)?.[1]?.trim() || '';
    setFormData({
      client: extract(/صاحب کالا:?\s*(.+)/) || extract(/صاحب کالا;?\s*(.+)/) || '',
      vessel: extract(/کشتی:?\s*(.+)/) || '',
      regNumber: extract(/شماره ثبت سفارش:\s*(\d+)/) || '',
      receiptNumber: extract(/شماره قبض انبار:\s*(\d+)/) || '',
      netWeight: extract(/وزن خالص:\s*([0-9,]+)/) || '',
      amount: extract(/مبلغ کل فاکتور:\s*([0-9,.]+)/) || '',
      currency: extract(/ارز:\s*(.+)/) || ''
    });
    setStatusMessage({ type: 'success', text: lang === 'FA' ? 'اطلاعات با موفقیت جایگذاری شد.' : 'Data successfully extracted.' });
  };

  const handleAIFileProcessing = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'حجم فایل نباید بیشتر از ۵ مگابایت باشد.' : 'File size exceeds 5MB limit.' });
      e.target.value = '';
      return;
    }
    setStatusMessage({ type: 'info', text: lang === 'FA' ? 'هوش مصنوعی در حال پردازش سند است...' : 'AI is processing document...' });
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64String = result.split(',')[1];
          const prompt = 'شما یک دستیار گمرکی هستید. این سند را تحلیل کنید و فقط اطلاعات زیر را بیابید: صاحب کالا، شماره ثبت سفارش، قبض انبار، وزن خالص، ارز و مبلغ کل.';
          const resultText = await extractCustomsDataWithAI(prompt, base64String, file.type);
          setPasteText(resultText);
          setStatusMessage({ type: 'success', text: lang === 'FA' ? 'سند خوانده شد! اکنون جایگذاری را بزنید.' : 'Document read! Click Paste.' });
        } catch (apiError: any) {
          setStatusMessage({ type: 'error', text: apiError.message || 'خطا در ارتباط با سرور هوش مصنوعی گوگل.' });
        } finally {
          setIsProcessing(false);
          e.target.value = '';
        }
      };
      reader.onerror = () => { throw new Error('خطا در خواندن فایل از سیستم شما.'); };
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'خطای سیستمی رخ داد.' });
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleSaveToDatabase = async () => {
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'فیلدهای صاحب کالا و ثبت سفارش الزامی است.' : 'Client and Reg No required.' });
      return;
    }

    setIsProcessing(true);
    setStatusMessage({ type: 'info', text: lang === 'FA' ? 'در حال ایجاد پرونده واقعی در Supabase...' : 'Creating real case in Supabase...' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(lang === 'FA' ? 'نشست کاربر معتبر نیست.' : 'Invalid user session.');
      if (!profile?.organization_id) throw new Error(lang === 'FA' ? 'پروفایل یا سازمان کاربر یافت نشد.' : 'User profile or organization not found.');

      const { data: caseId, error } = await supabase.rpc('create_case_workflow', {
        p_client_name: formData.client,
        p_registration_order_no: formData.regNumber,
      });

      if (error) {
        throw new Error(`${lang === 'FA' ? 'ایجاد پرونده توسط RLS/DB رد شد' : 'Case creation rejected by RLS/DB'}: ${error.message}`);
      }

      setStatusMessage({
        type: 'success',
        text: lang === 'FA'
          ? `پرونده با موفقیت ایجاد شد. شماره پرونده: ${caseId}`
          : `Case created successfully. Case ID: ${caseId}`
      });
    } catch (err: any) {
      console.error('Phase 3 Case Creation Error:', err);
      setStatusMessage({ type: 'error', text: err?.message || 'خطای ناشناخته در ایجاد پرونده.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const currentRole = profile?.role ? roleLabels[profile.role] : null;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden" dir={lang === 'FA' ? 'rtl' : 'ltr'}>
      <aside className={`flex flex-col border-l border-slate-800 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 z-30 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg"><Ship className="text-white w-5 h-5" /></div>
            {!sidebarCollapsed && <div><span className="font-bold text-white block">Customs OS</span><span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase">Enterprise</span></div>}
          </div>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-slate-400"><Menu className="w-4 h-4" /></button>
        </div>

        {!sidebarCollapsed && (
          <div className="mx-3 mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{lang === 'FA' ? 'کاربر جاری' : 'Current user'}</div>
            <div className="mt-1 text-sm font-bold text-slate-200 truncate">{profile?.full_name || '—'}</div>
            <div className="mt-2 inline-flex items-center rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-bold text-blue-400">{currentRole ? (lang === 'FA' ? currentRole.fa : currentRole.en) : '—'}</div>
          </div>
        )}

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {[
            { id: 'home', label: 'داشبورد فرماندهی', icon: LayoutDashboard },
            { id: 'smart_paste', label: 'موتور هوش مصنوعی (AI)', icon: Wand2 },
            { id: 'ships', label: 'لجستیک و کشتی‌ها', icon: Ship },
            { id: 'customs', label: 'عملیات گمرک و ترخیص', icon: Building2 },
            { id: 'finance', label: 'امور مالی و حسابداری', icon: Wallet },
          ].map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id as any)} className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium transition-all ${activeTab === item.id ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>
              <item.icon className={`w-5 h-5 shrink-0 ${activeTab === item.id ? 'text-blue-400' : 'text-slate-500'}`} />
              {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-4 pt-2 border-t border-slate-800/80">
          <button onClick={signOut} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-all" title={lang === 'FA' ? 'خروج از حساب' : 'Sign out'}>
            <LogOut className="w-5 h-5 shrink-0" />
            {!sidebarCollapsed && <span className="text-sm">{lang === 'FA' ? 'خروج از حساب' : 'Sign out'}</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        <header className="h-16 flex items-center justify-between px-8 bg-slate-900/40 border-b border-slate-800/80">
          <div className="relative w-full max-w-xl"><Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" /><input type="text" placeholder="جستجوی جهانی (⌘K)..." className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pr-10 pl-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50" /></div>
          <button onClick={() => setLang(lang === 'FA' ? 'EN' : 'FA')} className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono text-slate-300">{lang === 'FA' ? 'English' : 'فارسی'}</button>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === 'smart_paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto animate-in fade-in">
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4 shadow-xl">
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-4"><div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400"><Wand2 className="w-5 h-5" /></div><div><h2 className="text-sm font-bold text-slate-200">موتور هوش مصنوعی (AI)</h2><p className="text-[11px] text-slate-500">خواندن متن، عکس و PDF</p></div></div>
                  {statusMessage && <div className={`p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${statusMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : statusMessage.type === 'info' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>{statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : statusMessage.type === 'info' ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}<span>{statusMessage.text}</span></div>}
                  <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-slate-700 border-dashed rounded-xl ${isProcessing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-800'} transition-all`}><FileUp className="w-6 h-6 mb-2 text-slate-400" /><p className="text-xs text-slate-300 font-bold">آپلود عکس فاکتور یا فایل PDF قبض انبار</p><input type="file" accept=".pdf,image/*" className="hidden" disabled={isProcessing} onChange={handleAIFileProcessing} /></label>
                  <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} disabled={isProcessing} placeholder="یا متن را اینجا Paste کنید..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50 resize-none disabled:opacity-50" />
                  <button onClick={handleSmartPaste} disabled={isProcessing} className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs disabled:opacity-50">🪄 جایگذاری اطلاعات در فیلدها</button>
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-6 shadow-xl">
                  <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-4">اطلاعات تفکیک‌شده پرونده</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><label className="block text-[11px] text-slate-400 mb-1.5">صاحب کالا / شرکت</label><input type="text" value={formData.client} onChange={e=>setFormData({...formData, client: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">شماره ثبت سفارش</label><input type="text" value={formData.regNumber} onChange={e=>setFormData({...formData, regNumber: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">شماره قبض انبار</label><input type="text" value={formData.receiptNumber} onChange={e=>setFormData({...formData, receiptNumber: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">مبلغ کل فاکتور</label><input type="text" value={formData.amount} onChange={e=>setFormData({...formData, amount: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" dir="ltr" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">نوع ارز</label><input type="text" value={formData.currency} onChange={e=>setFormData({...formData, currency: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100" /></div>
                    <div className="col-span-2"><label className="block text-[11px] text-slate-400 mb-1.5">وزن خالص (کیلوگرم)</label><input type="text" value={formData.netWeight} onChange={e=>setFormData({...formData, netWeight: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                  </div>
                  <button onClick={handleSaveToDatabase} disabled={isProcessing} className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold text-xs disabled:opacity-50"><Save size={18} className="inline mr-2" /> ذخیره نهایی پرونده در پایگاه داده</button>
                  <p className="text-[10px] text-slate-500">در این مرحله صاحب کالا و شماره ثبت سفارش در پرونده ثبت می‌شوند. بارنامه، کانتینر، اظهارنامه و امور مالی در مراحل بعدی به همین پرونده متصل خواهند شد.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'home' && (
            <div className="space-y-6 animate-in fade-in"><div className="grid grid-cols-1 md:grid-cols-3 gap-6"><div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">کشتی‌های در راه</h3><p className="text-3xl font-bold font-mono text-blue-400 mt-2">۱۲</p></div><div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">اسناد آماده اظهار</h3><p className="text-3xl font-bold font-mono text-emerald-400 mt-2">۸</p></div><div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">پیگیری مالی</h3><p className="text-3xl font-bold font-mono text-amber-400 mt-2">۳</p></div></div></div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DashboardPage;
