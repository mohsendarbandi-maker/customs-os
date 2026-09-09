import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Wand2, Save, Loader2, CheckCircle2, AlertCircle, LogOut, Ship, Building2, Wallet, LayoutDashboard } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'smart_paste'>('home');
  const [pasteText, setPasteText] = useState('');
  
  const [formData, setFormData] = useState({
    client: '',
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

  const handleSmartPaste = () => {
    const text = pasteText;
    const extract = (regex: RegExp) => {
      const match = text.match(regex);
      return match ? match[1].trim() : '';
    };

    setFormData({
      client: extract(/صاحب کالا:?\s*(.+)/) || extract(/صاحب کالا;?\s*(.+)/) || '',
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
      setStatusMessage({ type: 'error', text: 'خطای دسترسی: پروفایل سازمانی یافت نشد.' });
      return;
    }
    
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ type: 'error', text: 'وارد کردن نام صاحب کالا و شماره ثبت سفارش الزامی است.' });
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
        if (!newClient) throw new Error('خطا در ایجاد پروفایل مشتری.');
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
          throw new Error('محموله‌ای با این شماره ثبت سفارش قبلاً ثبت شده است.');
        }
        throw caseError;
      }

      setStatusMessage({ type: 'success', text: 'محموله با موفقیت در سیستم ثبت شد.' });
      setFormData({ client: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: '' });
      setPasteText('');

    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'خطا در ارتباط با سرور.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* هدر بالا */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            OS
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-800">سیستم مدیریت گمرک</h1>
            <p className="text-xs text-slate-500">{profile?.full_name || 'مدیر سیستم'}</p>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-600 px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
        >
          <LogOut size={16} />
          <span>خروج</span>
        </button>
      </header>

      {/* محتوای اصلی */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 pb-20">
        {activeTab === 'home' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-xl font-extrabold text-slate-900">منوی اصلی عملیات</h2>
              <p className="text-sm text-slate-500 mt-1">لطفاً بخش مورد نظر خود را انتخاب کنید.</p>
            </div>

            <button 
              onClick={() => setActiveTab('smart_paste')} 
              className="w-full bg-secondary hover:bg-blue-700 text-white p-6 rounded-2xl shadow-lg text-lg font-bold transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/20 rounded-xl">
                  <Wand2 size={24} />
                </div>
                <span>ثبت هوشمند محموله (Smart Paste)</span>
              </div>
              <span className="text-xl group-hover:-translate-x-1 transition-transform">←</span>
            </button>

            <button className="w-full bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 p-5 rounded-2xl shadow-sm text-base font-bold flex items-center gap-3 transition-all">
              <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Ship size={20} /></div>
              <span>۱. مدیریت کشتی‌ها و حمل‌ونقل</span>
            </button>

            <button className="w-full bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 p-5 rounded-2xl shadow-sm text-base font-bold flex items-center gap-3 transition-all">
              <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Building2 size={20} /></div>
              <span>۲. عملیات گمرک و اظهار</span>
            </button>

            <button className="w-full bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 p-5 rounded-2xl shadow-sm text-base font-bold flex items-center gap-3 transition-all">
              <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Wallet size={20} /></div>
              <span>۳. امور مالی و هزینه‌ها</span>
            </button>
          </div>
        )}

        {activeTab === 'smart_paste' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <button 
              onClick={() => {
                setActiveTab('home');
                setStatusMessage(null);
              }}
              className="text-slate-500 hover:text-slate-800 text-sm font-bold flex items-center gap-1 mb-2"
            >
              ➔ بازگشت به منوی اصلی
            </button>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-secondary">
                  <Wand2 size={22} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">جعبه جادویی استخراج متن</h2>
                  <p className="text-xs text-slate-500">اطلاعات کپی‌شده از ترلو را در کادر زیر وارد کنید.</p>
                </div>
              </div>

              {statusMessage && (
                <div className={`mb-4 p-4 rounded-xl text-sm font-medium flex items-center gap-3 border ${
                  statusMessage.type === 'success' 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}>
                  {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span>{statusMessage.text}</span>
                </div>
              )}

              <textarea 
                rows={4}
                className="w-full bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm focus:ring-2 focus:ring-secondary outline-none transition-all resize-none font-mono text-slate-900"
                placeholder="مثال:&#10;صاحب کالا: آذرفولاد امین&#10;شماره ثبت سفارش: 90611944"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button 
                onClick={handleSmartPaste}
                className="w-full mt-3 bg-secondary hover:bg-blue-700 text-white py-3 rounded-xl font-bold transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Wand2 size={18} />
                <span>استخراج خودکار اطلاعات</span>
              </button>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h3 className="font-bold text-sm text-slate-700 border-b border-slate-100 pb-3">فیلدهای تفکیک‌شده (قابل ویرایش)</h3>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">صاحب کالا / شرکت</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold text-slate-900" 
                  value={formData.client} 
                  onChange={e => setFormData({...formData, client: e.target.value})} 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">شماره ثبت سفارش</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono text-slate-900" 
                    value={formData.regNumber} 
                    onChange={e => setFormData({...formData, regNumber: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">شماره قبض انبار</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono text-slate-900" 
                    value={formData.receiptNumber} 
                    onChange={e => setFormData({...formData, receiptNumber: e.target.value})} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">مبلغ کل فاکتور</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono text-left text-slate-900" 
                    dir="ltr"
                    value={formData.amount} 
                    onChange={e => setFormData({...formData, amount: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نوع ارز</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm text-slate-900" 
                    value={formData.currency} 
                    onChange={e => setFormData({...formData, currency: e.target.value})} 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">وزن خالص (کیلوگرم)</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono text-slate-900" 
                  value={formData.netWeight} 
                  onChange={e => setFormData({...formData, netWeight: e.target.value})} 
                />
              </div>

              <button 
                onClick={handleSaveToDatabase}
                disabled={isSaving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-xl font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
              >
                {isSaving ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    <Save size={18} />
                    <span>ذخیره نهایی در پایگاه داده</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
