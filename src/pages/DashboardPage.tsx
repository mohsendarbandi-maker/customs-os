import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { extractCustomsDataWithAI } from '../services/geminiService';
import { 
  Wand2, Save, Loader2, CheckCircle2, AlertCircle, 
  Ship, Building2, Wallet, LayoutDashboard, Search, Menu, LogOut, FileUp 
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'home' | 'smart_paste'>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pasteText, setPasteText] = useState('');
  
  const [formData, setFormData] = useState({
    client: '',
    vessel: '',
    regNumber: '',
    receiptNumber: '',
    netWeight: '',
    amount: '',
    currency: ''
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info', text: string } | null>(null);
  
  // برای جلوگیری از انتخاب مجدد فایل در حین پردازش (Race condition)
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSmartPaste = () => {
    if (!pasteText.trim()) {
      setStatusMessage({ type: 'error', text: 'لطفاً ابتدا متنی را برای استخراج وارد کنید.' });
      return;
    }

    const extract = (regex: RegExp) => {
      const match = pasteText.match(regex);
      return match ? match[1].trim() : '';
    };

    setFormData({
      client: extract(/صاحب کالا:?\s*(.+)/) || extract(/صاحب کالا;?\s*(.+)/) || formData.client,
      vessel: extract(/کشتی:?\s*(.+)/) || formData.vessel,
      regNumber: extract(/شماره ثبت سفارش:\s*(\d+)/) || formData.regNumber,
      receiptNumber: extract(/شماره قبض انبار:\s*(\d+)/) || formData.receiptNumber,
      netWeight: extract(/وزن خالص:\s*([0-9,]+)/) || formData.netWeight,
      amount: extract(/مبلغ کل فاکتور:\s*([0-9,.]+)/) || formData.amount,
      currency: extract(/ارز:\s*(.+)/) || formData.currency
    });
    
    setStatusMessage({ type: 'success', text: 'اطلاعات از متن استخراج و در فرم جایگذاری شد.' });
  };

  const handleAIFileProcessing = async (file: File) => {
    if (isProcessing) return; // جلوگیری از اجرای موازی
    
    // اعتبارسنجی سایز فایل (جلوگیری از Bottleneck شبکه)
    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage({ type: 'error', text: 'حجم فایل نباید بیشتر از 5 مگابایت باشد.' });
      return;
    }

    setStatusMessage({ type: 'info', text: 'هوش مصنوعی در حال خواندن سند است، لطفاً صبر کنید...' });
    setIsProcessing(true); 

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64String = result.split(',')[1];
          const prompt = "این سند گمرکی را تحلیل کن و اطلاعات کلیدی شامل صاحب کالا، شماره ثبت سفارش، شماره قبض انبار، وزن خالص، ارز و مبلغ کل را پیدا کن و به صورت یک متن منظم به من بده.";
          
          const resultText = await extractCustomsDataWithAI(prompt, base64String, file.type);
          
          setPasteText(resultText);
          setStatusMessage({ type: 'success', text: 'سند خوانده شد! متن در کادر زیر قرار گرفت. حالا "جایگذاری اطلاعات" را بزنید.' });
        } catch (aiError: any) {
          setStatusMessage({ type: 'error', text: aiError.message || 'خطا در ارتباط با موتور هوش مصنوعی.' });
        } finally {
          setIsProcessing(false);
          if (fileInputRef.current) fileInputRef.current.value = ''; // ریست کردن اینپوت
        }
      };
      
      reader.onerror = () => {
        throw new Error("خطا در خواندن فایل از روی دستگاه.");
      };
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveToDatabase = async () => {
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ type: 'error', text: 'نام صاحب کالا و شماره ثبت سفارش الزامی است.' });
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);

    // شبیه‌سازی ذخیره‌سازی تا زمانی که Supabase نهایی شود
    setTimeout(() => {
      setIsProcessing(false);
      setStatusMessage({ type: 'success', text: 'محموله با موفقیت در سیستم ثبت شد.' });
      setFormData({ client: '', vessel: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: '' });
      setPasteText('');
    }, 1000);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden" dir="rtl">
      
      {/* Sidebar */}
      <aside className={`flex flex-col border-l border-slate-800 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 z-30 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shrink-0 shadow-lg">
              <Ship className="text-white w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <span className="font-bold tracking-tight text-white block">Customs OS</span>
                <span className="text-[10px] text-blue-400 font-mono tracking-widest block uppercase">Enterprise AI v4.1</span>
              </div>
            )}
          </div>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <Menu className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {[
            { id: 'home', label: 'داشبورد فرماندهی', icon: LayoutDashboard },
            { id: 'smart_paste', label: 'ثبت هوشمند (AI)', icon: Wand2 },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium transition-all ${
                activeTab === item.id 
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${activeTab === item.id ? 'text-blue-400' : 'text-slate-500'}`} />
              {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        
        <header className="h-16 flex items-center justify-between px-8 bg-slate-900/40 backdrop-blur-xl border-b border-slate-800/80 z-20">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="جستجوی جهانی (⌘K)..."
                className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pr-10 pl-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 space-y-8">
          
          {activeTab === 'home' && (
            <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
              <h2 className="text-lg font-bold text-slate-200">سیستم یکپارچه مدیریت با هوش مصنوعی</h2>
              <button 
                onClick={() => setActiveTab('smart_paste')}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/20 transition-all"
              >
                🪄 ورود به بخش ثبت هوشمند با AI
              </button>
            </div>
          )}

          {activeTab === 'smart_paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto">
              
              {/* AI Input Section */}
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl space-y-4">
                  
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                    <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
                      <Wand2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-200">موتور هوش مصنوعی (AI)</h2>
                      <p className="text-[11px] text-slate-500">خواندن متن، عکس و PDF</p>
                    </div>
                  </div>

                  {statusMessage && (
                    <div className={`p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${
                      statusMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                      statusMessage.type === 'info' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                      'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : 
                       statusMessage.type === 'info' ? <Loader2 size={16} className="animate-spin" /> : 
                       <AlertCircle size={16} />}
                      <span>{statusMessage.text}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-slate-700 border-dashed rounded-xl transition-all group ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-800'}`}>
                      <div className="flex flex-col items-center justify-center">
                        <FileUp className="w-6 h-6 mb-2 text-slate-400 group-hover:text-blue-400 transition-colors" />
                        <p className="text-xs text-slate-300 font-bold group-hover:text-blue-400 transition-colors">
                          آپلود عکس فاکتور یا فایل PDF قبض انبار
                        </p>
                      </div>
                      <input 
                        type="file" 
                        accept=".pdf,image/*"
                        className="hidden"
                        ref={fileInputRef}
                        disabled={isProcessing}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleAIFileProcessing(e.target.files[0]);
                          }
                        }}
                      />
                    </label>

                    <div className="relative flex items-center py-2">
                      <div className="flex-grow border-t border-slate-800"></div>
                      <span className="flex-shrink-0 mx-4 text-slate-500 text-[10px] font-bold">یا ورود متن دستی</span>
                      <div className="flex-grow border-t border-slate-800"></div>
                    </div>

                    <textarea
                      rows={5}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="متن را اینجا Paste کنید..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
                    />
                    <button
                      onClick={handleSmartPaste}
                      disabled={isProcessing}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      <span>جایگذاری اطلاعات در فیلدها</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Form Output Section */}
              <div className="lg:col-span-7">
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl space-y-6">
                  <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-4">اطلاعات تفکیک‌شده پرونده</h2>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">صاحب کالا / شرکت</label>
                      <input
                        type="text"
                        value={formData.client}
                        onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-100 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">شماره ثبت سفارش</label>
                      <input
                        type="text"
                        value={formData.regNumber}
                        onChange={(e) => setFormData({ ...formData, regNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">شماره قبض انبار</label>
                      <input
                        type="text"
                        value={formData.receiptNumber}
                        onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">مبلغ کل فاکتور</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={formData.amount}
                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono text-left focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={handleSaveToDatabase}
                    disabled={isProcessing}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isProcessing && statusMessage?.type !== 'info' ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>ذخیره نهایی در پایگاه داده</span>
                  </button>
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
