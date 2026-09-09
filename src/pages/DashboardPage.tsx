import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Wand2, Save, Loader2, CheckCircle2, AlertCircle, LogOut, 
  Ship, Building2, Wallet, LayoutDashboard, Search, Bell, Menu, ShieldAlert 
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'ships' | 'customs' | 'finance' | 'smart_paste'>('home');
  const [lang, setLang] = useState<'FA' | 'EN'>('FA');
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

  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  const handleLogout = async () => {
    try {
      await signOut();
      window.location.href = '/login';
    } catch (error) {
      window.location.href = '/login';
    }
  };

  // Smart Paste Extraction Engine
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
    setStatusMessage(null);
  };

  const handleSaveToDatabase = async () => {
    if (!profile?.organization_id) {
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'خطای دسترسی: پروفایل سازمانی یافت نشد.' : 'Access Error: Organization profile not found.' });
      return;
    }
    
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ type: 'error', text: lang === 'FA' ? 'وارد کردن نام صاحب کالا و شماره ثبت سفارش الزامی است.' : 'Client and Registration Number are required.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      let clientId: string;
      const { data: existingClients, error: clientFetchError } = await supabase
        .from('clients')
        .select('id')
        .eq('name', formData.client.trim())
        .eq('organization_id', profile.organization_id)
        .limit(1);

      if (clientFetchError) throw clientFetchError;

      if (existingClients && existingClients.length > 0) {
        clientId = existingClients[0].id;
      } else {
        const { data: newClient, error: clientInsertError } = await supabase
          .from('clients')
          .insert({ 
            name: formData.client.trim(), 
            organization_id: profile.organization_id 
          })
          .select('id')
          .single();
          
        if (clientInsertError) throw clientInsertError;
        if (!newClient) throw new Error('Client creation failed.');
        clientId = newClient.id;
      }

      const { error: caseError } = await supabase
        .from('cases')
        .insert({
          organization_id: profile.organization_id,
          client_id: clientId,
          assigned_broker_id: profile.id,
          case_number: formData.regNumber.trim(),
          status: 'draft',
          proforma_no: formData.receiptNumber
        });

      if (caseError) {
        if (caseError.code === '23505') {
          throw new Error(lang === 'FA' ? 'محموله‌ای با این شماره ثبت سفارش قبلاً ثبت شده است.' : 'A shipment with this registration number already exists.');
        }
        throw caseError;
      }

      setStatusMessage({ type: 'success', text: lang === 'FA' ? 'محموله با موفقیت در سیستم ثبت شد.' : 'Shipment successfully saved to database.' });
      setFormData({ client: '', vessel: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: '' });
      setPasteText('');

    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Server connection error.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden" dir={lang === 'FA' ? 'rtl' : 'ltr'}>
      
      {/* Enterprise Sidebar */}
      <aside className={`flex flex-col border-l border-slate-800 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 z-30 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shrink-0 shadow-lg">
              <Ship className="text-white w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <span className="font-bold tracking-tight text-white block">Customs OS</span>
                <span className="text-[10px] text-blue-400 font-mono tracking-widest block uppercase">Enterprise v3.4</span>
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
            { id: 'smart_paste', label: lang === 'FA' ? 'ثبت هوشمند (Smart Paste)' : 'Smart Paste', icon: Wand2 },
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

        <div className="p-4 border-t border-slate-800/80">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl hover:bg-rose-500/10 text-rose-400 font-medium transition-colors"
          >
            <LogOut size={20} className="shrink-0" />
            {!sidebarCollapsed && <span>{lang === 'FA' ? 'خروج از سیستم' : 'Sign Out'}</span>}
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-8 bg-slate-900/40 backdrop-blur-xl border-b border-slate-800/80 z-20">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <Search className={`absolute ${lang === 'FA' ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500`} />
              <input
                type="text"
                placeholder={lang === 'FA' ? "جستجوی جهانی شماره ثبت، ک کوتاژ، نام کشتی (⌘K)..." : "Global search..."}
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

            <div className="flex items-center gap-3">
              <div className="text-left">
                <p className="text-xs font-bold text-slate-200">{profile?.full_name || 'مدیر سیستم'}</p>
                <p className="text-[10px] text-slate-500 font-mono">{profile?.role || 'Owner'}</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-xs">
                MD
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 space-y-8">
          
          {activeTab === 'home' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { title: lang === 'FA' ? 'کشتی‌های در راه' : 'In Transit', value: '۱۲', color: 'text-blue-400' },
                  { title: lang === 'FA' ? 'اسناد آماده اظهار' : 'Ready for Declaration', value: '۸', color: 'text-emerald-400' },
                  { title: lang === 'FA' ? 'نیازمند پیگیری مالی' : 'Pending Financials', value: '۳', color: 'text-amber-400' }
                ].map((stat, idx) => (
                  <div key={idx} className="p-6 rounded-2xl bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 shadow-xl">
                    <h3 className="text-sm font-medium text-slate-400">{stat.title}</h3>
                    <p className={`text-3xl font-bold font-mono mt-2 ${stat.color}`}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
                <h2 className="text-lg font-bold text-slate-200">{lang === 'FA' ? 'به سیستم مدیریت یکپارچه گمرک خوش آمدید' : 'Welcome to Customs OS'}</h2>
                <p className="text-sm text-slate-400">{lang === 'FA' ? 'برای شروع روی دکمه ثبت هوشمند محموله در منو کلیک کنید.' : 'Click Smart Paste in the menu to begin.'}</p>
                <button 
                  onClick={() => setActiveTab('smart_paste')}
                  className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/20"
                >
                  {lang === 'FA' ? '🪄 ورود به جعبه جادویی (Smart Paste)' : '🪄 Open Smart Paste'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'smart_paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto">
              
              {/* Smart Paste Box */}
              <div className="lg:col-span-5 space-y-6">
                <div className="p-6 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
                        <Wand2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-200">{lang === 'FA' ? 'جعبه جادویی (Smart Paste)' : 'Smart Paste'}</h2>
                        <p className="text-[11px] text-slate-500">{lang === 'FA' ? 'استخراج خودکار اطلاعات ترلو' : 'Extract Trello text'}</p>
                      </div>
                    </div>
                  </div>

                  {statusMessage && (
                    <div className={`p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${
                      statusMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                      <span>{statusMessage.text}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <textarea
                      rows={6}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={lang === 'FA' ? "متن کارت ترلو را اینجا Paste کنید...\nصاحب کالا: آذرفولاد امین\nشماره ثبت سفارش: 90611944" : "Paste Trello text here..."}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
                    />
                    <button
                      onClick={handleSmartPaste}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      <Wand2 className="w-4 h-4" />
                      <span>{lang === 'FA' ? 'استخراج خودکار اطلاعات' : 'Extract Information'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Form Fields */}
              <div className="lg:col-span-7">
                <div className="p-6 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-xl space-y-6">
                  <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-4">{lang === 'FA' ? 'اطلاعات تفکیک‌شده پرونده' : 'Extracted Case Fields'}</h2>

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
                    disabled={isSaving}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>{lang === 'FA' ? 'ذخیره نهایی در پایگاه داده Supabase' : 'Save to Supabase Database'}</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {(activeTab === 'ships' || activeTab === 'customs' || activeTab === 'finance') && (
            <div className="p-12 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
              <h2 className="text-xl font-bold text-slate-200">
                {activeTab === 'ships' && (lang === 'FA' ? 'بخش لجستیک و کشتی‌ها' : 'Ships & Logistics')}
                {activeTab === 'customs' && (lang === 'FA' ? 'بخش عملیات گمرک (EPL)' : 'Customs Operations')}
                {activeTab === 'finance' && (lang === 'FA' ? 'بخش مالی و تعرفه‌ها' : 'Financial Center')}
              </h2>
              <p className="text-sm text-slate-400">{lang === 'FA' ? 'این بخش به زودی به دیتابیس متصل می‌شود.' : 'This module is connecting to the database.'}</p>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};
