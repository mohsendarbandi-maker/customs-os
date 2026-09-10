import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractCustomsDataWithAI } from '../services/geminiService';
import { 
  Wand2, Save, Loader2, CheckCircle2, AlertCircle, 
  Ship, Building2, Wallet, LayoutDashboard, Search, Menu, LogOut, FileUp 
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
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
    const text = pasteText;
    const extract = (regex: RegExp) => { const match = text.match(regex); return match ? match[1].trim() : ''; };
    setFormData({
      client: extract(/صاحب کالا:?\s*(.+)/) || '',
      vessel: extract(/کشتی:?\s*(.+)/) || '',
      regNumber: extract(/شماره ثبت سفارش:\s*(\d+)/) || '',
      receiptNumber: extract(/شماره قبض انبار:\s*(\d+)/) || '',
      netWeight: extract(/وزن خالص:\s*([0-9,]+)/) || '',
      amount: extract(/مبلغ کل فاکتور:\s*([0-9,.]+)/) || '',
      currency: extract(/ارز:\s*(.+)/) || ''
    });
    setStatusMessage({ type: 'success', text: 'اطلاعات با موفقیت جایگذاری شد.' });
  };

  const handleAIFileProcessing = async (file: File) => {
    setStatusMessage({ type: 'info', text: 'هوش مصنوعی در حال خواندن سند است، لطفاً صبر کنید...' });
    setIsProcessing(true); 
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const prompt = "این سند گمرکی را تحلیل کن و اطلاعات: صاحب کالا، شماره ثبت سفارش، قبض انبار، وزن خالص، ارز و مبلغ کل را پیدا کن.";
        const resultText = await extractCustomsDataWithAI(prompt, base64String, file.type);
        setPasteText(resultText);
        setStatusMessage({ type: 'success', text: 'سند خوانده شد! حالا دکمه جایگذاری را بزنید.' });
      };
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'خطا در ارتباط با سرور هوش مصنوعی گوگل.' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden" dir={lang === 'FA' ? 'rtl' : 'ltr'}>
      
      {/* سایدبار */}
      <aside className={`flex flex-col border-l border-slate-800 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 z-30 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg">
              <Ship className="text-white w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <span className="font-bold text-white block">Customs OS</span>
                <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase">Enterprise</span>
              </div>
            )}
          </div>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-slate-400">
            <Menu className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {[
            { id: 'home', label: 'داشبورد فرماندهی', icon: LayoutDashboard },
            { id: 'smart_paste', label: 'موتور هوش مصنوعی (AI)', icon: Wand2 },
            { id: 'ships', label: 'لجستیک و کشتی‌ها', icon: Ship },
            { id: 'customs', label: 'عملیات گمرک و ترخیص', icon: Building2 },
            { id: 'finance', label: 'امور مالی و حسابداری', icon: Wallet },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium transition-all ${
                activeTab === item.id ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${activeTab === item.id ? 'text-blue-400' : 'text-slate-500'}`} />
              {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* محتوای اصلی */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        <header className="h-16 flex items-center justify-between px-8 bg-slate-900/40 border-b border-slate-800/80">
          <div className="relative w-full max-w-xl">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="جستجوی جهانی (⌘K)..." className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pr-10 pl-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50" />
          </div>
          <button onClick={() => setLang(lang === 'FA' ? 'EN' : 'FA')} className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono text-slate-300">
            {lang === 'FA' ? 'English' : 'فارسی'}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          
          {/* بخش ۱: داشبورد اصلی */}
          {activeTab === 'home' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">کشتی‌های در راه</h3><p className="text-3xl font-bold font-mono text-blue-400 mt-2">۱۲</p></div>
                <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">اسناد آماده اظهار</h3><p className="text-3xl font-bold font-mono text-emerald-400 mt-2">۸</p></div>
                <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800"><h3 className="text-sm text-slate-400">پیگیری مالی</h3><p className="text-3xl font-bold font-mono text-amber-400 mt-2">۳</p></div>
              </div>
            </div>
          )}

          {/* بخش ۲: هوش مصنوعی */}
          {activeTab === 'smart_paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto animate-in fade-in">
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                    <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400"><Wand2 className="w-5 h-5" /></div>
                    <div><h2 className="text-sm font-bold text-slate-200">موتور هوش مصنوعی (AI)</h2><p className="text-[11px] text-slate-500">خواندن متن، عکس و PDF</p></div>
                  </div>

                  {statusMessage && (
                    <div className={`p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${statusMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : statusMessage.type === 'info' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                      {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : statusMessage.type === 'info' ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}
                      <span>{statusMessage.text}</span>
                    </div>
                  )}

                  <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-700 border-dashed rounded-xl cursor-pointer bg-slate-900/50 hover:bg-slate-800 transition-all">
                    <FileUp className="w-6 h-6 mb-2 text-slate-400" />
                    <p className="text-xs text-slate-300 font-bold">آپلود عکس فاکتور یا فایل PDF قبض انبار</p>
                    <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { if (e.target.files && e.target.files[0]) handleAIFileProcessing(e.target.files[0]); }} />
                  </label>

                  <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="یا متن را اینجا Paste کنید..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50 resize-none" />
                  <button onClick={handleSmartPaste} disabled={isProcessing} className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs">🪄 جایگذاری اطلاعات در فیلدها</button>
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-6">
                  <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-4">اطلاعات تفکیک‌شده پرونده</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><label className="block text-[11px] text-slate-400 mb-1.5">صاحب کالا / شرکت</label><input type="text" value={formData.client} onChange={e=>setFormData({...formData, client: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">شماره ثبت سفارش</label><input type="text" value={formData.regNumber} onChange={e=>setFormData({...formData, regNumber: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">شماره قبض انبار</label><input type="text" value={formData.receiptNumber} onChange={e=>setFormData({...formData, receiptNumber: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">مبلغ کل فاکتور</label><input type="text" value={formData.amount} onChange={e=>setFormData({...formData, amount: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" dir="ltr" /></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1.5">نوع ارز</label><input type="text" value={formData.currency} onChange={e=>setFormData({...formData, currency: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100" /></div>
                    <div className="col-span-2"><label className="block text-[11px] text-slate-400 mb-1.5">وزن خالص (کیلوگرم)</label><input type="text" value={formData.netWeight} onChange={e=>setFormData({...formData, netWeight: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono" /></div>
                  </div>
                  <button className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold text-xs"><Save size={18} className="inline mr-2" /> ذخیره نهایی در پایگاه داده</button>
                </div>
              </div>
            </div>
          )}

          {/* بخش ۳: لجستیک و کشتی‌ها */}
          {activeTab === 'ships' && (
            <div className="space-y-4 animate-in fade-in">
              <h2 className="font-bold text-lg text-slate-200 border-b border-slate-800 pb-2">مدیریت لجستیک و کشتی‌ها 🚢</h2>
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <p className="font-bold text-slate-200">آذرفولاد امین - کشتی دوریتا</p>
                  <p className="text-xs text-slate-400 mt-1">۷۵ رول ورق گرم - در انتظار پاس کشتی</p>
                </div>
                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-lg text-xs font-bold">در راه</span>
              </div>
            </div>
          )}

          {/* بخش ۴: گمرک */}
          {activeTab === 'customs' && (
            <div className="space-y-4 animate-in fade-in">
              <h2 className="font-bold text-lg text-slate-200 border-b border-slate-800 pb-2">چک‌لیست عملیات گمرک 🏢</h2>
              <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800 space-y-3">
                <p className="font-bold text-emerald-400 mb-4">فولاد امیر آذربایجان - غازیان ۱</p>
                {['اظهار گمرکی', 'مالیات علی‌الحساب', 'درخواست ضمانتنامه', 'ارزیابی', 'آزمایشگاه', 'مجوز استاندارد', 'صورتحساب انبارداری', 'وکالت حمل'].map((item, idx) => (
                  <label key={idx} className="flex items-center space-x-3 space-x-reverse text-sm text-slate-300">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500" />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* بخش ۵: امور مالی */}
          {activeTab === 'finance' && (
            <div className="space-y-4 animate-in fade-in">
              <h2 className="font-bold text-lg text-slate-200 border-b border-slate-800 pb-2">مرکز امور مالی 💰</h2>
              <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800">
                <p className="font-bold text-slate-200 mb-4">ثبت هزینه جدید</p>
                <div className="space-y-3">
                  <input type="text" placeholder="مبلغ (ریال)" className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-sm text-slate-200" />
                  <input type="text" placeholder="بابت..." className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-sm text-slate-200" />
                  <button className="w-full bg-purple-600 text-white py-3 rounded-xl text-sm font-bold mt-2">ثبت تراکنش در سیستم</button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default DashboardPage;
