import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractCustomsDataWithAI } from '../services/geminiService'; // ایمپورت سرویس هوش مصنوعی
import { 
  Wand2, Save, Loader2, CheckCircle2, AlertCircle, 
  Ship, Building2, Wallet, LayoutDashboard, Search, Bell, Menu, LogOut, FileUp 
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'home' | 'ships' | 'customs' | 'finance' | 'smart_paste'>('home');
  const [lang, setLang] = useState<'FA' | 'EN'>('FA');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pasteText, setPasteText] = useState('');
  
  // فرم اطلاعات محموله
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

  // 1. موتور استخراج آفلاین (Regex) - برای متن‌های ساده ترلو
  const handleSmartPaste = () => {
    const text = pasteText;
    const extract = (regex: RegExp) => {
      const match = text.match(regex);
      return match ? match[1].trim() : '';
    };

    setFormData({
      client: extract(/صاحب کالا:?\s*(.+)/) || extract(/صاحب کالا;?\s*(.+)/) || '',
      vessel: extract(/کشتی:?\s*(.+)/) || '',
      regNumber: extract(/شماره ثبت سفارش:\s*(\d+)/),
      receiptNumber: extract(/شماره قبض انبار:\s*(\d+)/),
      netWeight: extract(/وزن خالص:\s*([0-9,]+)/),
      amount: extract(/مبلغ کل فاکتور:\s*([0-9,.]+)/),
      currency: extract(/ارز:\s*(.+)/)
    });
    setStatusMessage({ type: 'success', text: lang === 'FA' ? 'اطلاعات از متن استخراج شد.' : 'Data extracted from text.' });
  };

  // 2. موتور استخراج هوش مصنوعی گوگل (AI) - برای فایل‌های PDF و عکس
  const handleAIFileProcessing = async (file: File) => {
    setStatusMessage({ type: 'info', text: lang === 'FA' ? 'هوش مصنوعی در حال خواندن سند است، لطفاً صبر کنید...' : 'AI is processing the document...' });
    setIsProcessing(true); 

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const prompt = "این سند گمرکی را تحلیل کن و اطلاعات کلیدی شامل صاحب کالا، شماره ثبت سفارش، شماره قبض انبار، وزن خالص، ارز و مبلغ کل را پیدا کن و به صورت یک متن منظم به من بده تا بتوانم آن را در فرم قرار دهم.";
        
        const resultText = await extractCustomsDataWithAI(prompt, base64String, file.type);
        
        // قرار دادن متن استخراج شده توسط هوش مصنوعی در جعبه جادویی
        setPasteText(resultText);
        
        setStatusMessage({ 
          type: 'success', 
          text: lang === 'FA' 
            ? 'سند با موفقیت توسط هوش مصنوعی خوانده شد! حالا دکمه "استخراج" را بزنید.' 
            : 'Document processed! Now click Extract.' 
        });
      };
    } catch (err) {
      console.error("خطا در پردازش هوشمند فایل:", err);
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'خطا در ارتباط با سرور هوش مصنوعی.' : 'AI Processing Error.' });
    } finally {
      setIsProcessing(false);
    }
  };

  // ذخیره در دیتابیس
  const handleSaveToDatabase = async () => {
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ 
        type: 'error', 
        text: lang === 'FA' ? 'وارد کردن نام صاحب کالا و شماره ثبت سفارش الزامی است.' : 'Client and Registration Number are required.' 
      });
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);

    // شبیه‌سازی ذخیره‌سازی
    setTimeout(() => {
      setIsProcessing(false);
      setStatusMessage({ 
        type: 'success', 
        text: lang === 'FA' ? 'محموله با موفقیت در سیستم ثبت شد.' : 'Shipment successfully saved.' 
      });
      setFormData({ client: '', vessel: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: '' });
      setPasteText('');
    }, 1000);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden" dir={lang === 'FA' ? 'rtl' : 'ltr'}>
      
      {/* سایدبار سازمانی */}
      <aside className={`flex flex-col border-l border-slate-800 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 z-30 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shrink-0 shadow-lg">
              <Ship className="text-white w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <span className="font-bold tracking-tight text-white block">Customs OS</span>
                <span className="text-[10px] text-blue-400 font-mono tracking-widest block uppercase">Enterprise AI v4.0</span>
              </div>
            )}
          </div>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <Menu className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {[
            { id: 'home', label: lang === 'FA' ? 'داشبورد فرماندهی' : 'Command Dashboard', icon: LayoutDashboard },
            { id: 'ships', label: lang === 'FA' ? 'لجستیک و کشتی‌ها' : 'Ships & Logistics', icon: Ship },
            { id: 'customs', label: lang === 'FA' ? 'عملیات گمرک (EPL)' : 'Customs Operations', icon: Building2 },
            { id: 'finance', label: lang === 'FA' ? 'امور مالی و تعرفه‌ها' : 'Financial Center', icon: Wallet },
            { id: 'smart_paste', label: lang === 'FA' ? 'ثبت هوشمند (AI)' : 'AI Smart Paste', icon: Wand2 },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium transition-all group relative ${
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

      {/* محتوای اصلی */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        
        <header className="h-16 flex items-center justify-between px-8 bg-slate-900/40 backdrop-blur-xl border-b border-slate-800/80 z-20">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <Search className={`absolute ${lang === 'FA' ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500`} />
              <input
                type="text"
                placeholder={lang === 'FA' ? "جستجوی جهانی (⌘K)..." : "Global search..."}
                className={`w-full bg-slate-900/80 border border-slate-800 rounded-xl ${lang === 'FA' ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500/50`}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setLang(lang === 'FA' ? 'EN' : 'FA')}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono font-bold text-slate-300 hover:bg-slate-800"
            >
              {lang === 'FA' ? 'English' : 'فارسی'}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 space-y-8">
          
          {activeTab === 'home' && (
            <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
              <h2 className="text-lg font-bold text-slate-200">{lang === 'FA' ? 'سیستم یکپارچه مدیریت با هوش مصنوعی' : 'AI-Powered Customs OS'}</h2>
              <button 
                onClick={() => setActiveTab('smart_paste')}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/20 transition-all"
              >
                {lang === 'FA' ? '🪄 ورود به بخش ثبت هوشمند با AI' : '🪄 Open AI Smart Paste'}
              </button>
            </div>
          )}

          {activeTab === 'smart_paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto">
              
              {/* کادر جعبه جادویی و آپلود AI */}
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-xl space-y-4">
                  
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                    <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
                      <Wand2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-200">{lang === 'FA' ? 'موتور هوش مصنوعی (AI Engine)' : 'AI Engine'}</h2>
                      <p className="text-[11px] text-slate-500">{lang === 'FA' ? 'خواندن متن، عکس و PDF' : 'Read Text, Image, and PDF'}</p>
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
                    {/* دکمه آپلود فایل برای هوش مصنوعی */}
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-700 border-dashed rounded-xl cursor-pointer bg-slate-900/50 hover:bg-slate-800 transition-all group">
                      <div className="flex flex-col items-center justify-center">
                        <FileUp className="w-6 h-6 mb-2 text-slate-400 group-hover:text-blue-400 transition-colors" />
                        <p className="text-xs text-slate-300 font-bold group-hover:text-blue-400 transition-colors">
                          {lang === 'FA' ? 'آپلود عکس فاکتور یا فایل PDF قبض انبار' : 'Upload Invoice/Receipt (PDF/Img)'}
                        </p>
                      </div>
                      <input 
                        type="file" 
                        accept=".pdf,image/*"
                        className="hidden"
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
                      placeholder={lang === 'FA' ? "متن ترلو را اینجا Paste کنید..." : "Paste cargo info here..."}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
                    />
                    <button
                      onClick={handleSmartPaste}
                      disabled={isProcessing}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      <span>{lang === 'FA' ? 'جایگذاری اطلاعات در فیلدها' : 'Extract Information'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* فرم ساختاریافته خروجی */}
              <div className="lg:col-span-7">
                <div className="p-6 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-xl space-y-6">
                  <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-4">
                    {lang === 'FA' ? 'اطلاعات تفکیک‌شده پرونده' : 'Structured Case Fields'}
                  </h2>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'صاحب کالا / شرکت' : 'Client / Company'}</label>
                      <input
                        type="text"
                        value={formData.client}
                        onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-100 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'شماره ثبت سفارش' : 'Registration No'}</label>
                      <input
                        type="text"
                        value={formData.regNumber}
                        onChange={(e) => setFormData({ ...formData, regNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'شماره قبض انبار' : 'Warehouse Receipt No'}</label>
                      <input
                        type="text"
                        value={formData.receiptNumber}
                        onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'مبلغ کل فاکتور' : 'Invoice Amount'}</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={formData.amount}
                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono text-left focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'نوع ارز' : 'Currency'}</label>
                      <input
                        type="text"
                        value={formData.currency}
                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'FA' ? 'وزن خالص (کیلوگرم)' : 'Net Weight (KG)'}</label>
                      <input
                        type="text"
                        value={formData.netWeight}
                        onChange={(e) => setFormData({ ...formData, netWeight: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={handleSaveToDatabase}
                    disabled={isProcessing}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isProcessing && !statusMessage?.text.includes('هوش مصنوعی') ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>{lang === 'FA' ? 'ذخیره نهایی در پایگاه داده' : 'Save to Database'}</span>
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
