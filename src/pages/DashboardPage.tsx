import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

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

  // State برای مدیریت لودینگ و پیام‌ها
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
      client: extract(/صاحب کالا:?\s*(.+)/) || extract(/صاحب کالا;?\s*(.+)/) || extract(/آذرفولاد/) ? 'آذرفولاد امین' : '',
      regNumber: extract(/شماره ثبت سفارش:\s*(\d+)/),
      receiptNumber: extract(/شماره قبض انبار:\s*(\d+)/),
      netWeight: extract(/وزن خالص:\s*([0-9,]+)/),
      amount: extract(/مبلغ کل فاکتور:\s*([0-9,.]+)/),
      currency: extract(/ارز:\s*(.+)/)
    });
    setStatusMessage(null);
  };

  // V2: Production-ready Database Persistence
  const handleSaveToDatabase = async () => {
    if (!profile?.organization_id) {
      setStatusMessage({ type: 'error', text: 'خطای دسترسی: پروفایل شما بارگذاری نشده است.' });
      return;
    }
    
    if (!formData.client || !formData.regNumber) {
      setStatusMessage({ type: 'error', text: 'لطفاً نام صاحب کالا و شماره ثبت سفارش را وارد کنید.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      // 1. Resolve Client ID safely
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
        if (!newClient) throw new Error('Client creation failed silently.');
        clientId = newClient.id;
      }

      // 2. Insert Case with Null-Reference Protection
      const { error: caseError } = await supabase
        .from('cases')
        .insert({
          organization_id: profile.organization_id,
          client_id: clientId,
          assigned_broker_id: profile.id, // Assign to current user
          case_number: formData.regNumber.trim(),
          status: 'draft',
          proforma_no: formData.receiptNumber // Storing warehouse receipt temporarily here
        });

      if (caseError) {
        if (caseError.code === '23505') { // Postgres Unique Constraint Violation
          throw new Error('محموله‌ای با این شماره ثبت سفارش از قبل وجود دارد.');
        }
        throw caseError;
      }

      // 3. Success Workflow
      setStatusMessage({ type: 'success', text: 'محموله با موفقیت در سیستم ذخیره شد!' });
      setFormData({ client: '', regNumber: '', receiptNumber: '', netWeight: '', amount: '', currency: '' });
      setPasteText('');

    } catch (err: any) {
      console.error('Database Save Error:', err);
      setStatusMessage({ type: 'error', text: err.message || 'خطا در ارتباط با سرور.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans dir-rtl">
      <header className="bg-white p-4 shadow-sm flex justify-between items-center sticky top-0 z-10 border-b border-gray-200">
        <div>
          <h1 className="font-bold text-gray-800 text-lg">داشبورد گمرک</h1>
          <p className="text-xs text-blue-600 font-medium">{profile?.full_name || 'مدیر سیستم'}</p>
        </div>
        <button 
          onClick={handleLogout}
          className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-sm font-bold transition shadow-sm"
        >
          خروج
        </button>
      </header>

      <div className="p-4 max-w-lg mx-auto pb-20">
        {activeTab === 'home' && (
          <div className="space-y-4 mt-6">
            <button 
              onClick={() => setActiveTab('smart_paste')} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-2xl shadow-lg text-lg font-bold transition flex items-center justify-center gap-2"
            >
              🪄 ثبت هوشمند محموله (Smart Paste)
            </button>
            <button className="w-full bg-white text-gray-800 border py-5 rounded-2xl shadow-sm text-lg font-bold">
              🚢 ۱. مدیریت کشتی‌ها
            </button>
            <button className="w-full bg-white text-gray-800 border py-5 rounded-2xl shadow-sm text-lg font-bold">
              🏢 ۲. عملیات گمرک
            </button>
            <button className="w-full bg-white text-gray-800 border py-5 rounded-2xl shadow-sm text-lg font-bold">
              💰 ۳. امور مالی
            </button>
          </div>
        )}

        {activeTab === 'smart_paste' && (
          <div className="space-y-4 animate-fade-in">
            <button 
              onClick={() => {
                setActiveTab('home');
                setStatusMessage(null);
              }}
              className="text-gray-500 hover:text-gray-800 text-sm mb-2 flex items-center gap-1 font-bold"
            >
              ➔ بازگشت به منو
            </button>
            
            {statusMessage && (
              <div className={`p-3 rounded-lg text-sm font-bold border ${statusMessage.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                {statusMessage.text}
              </div>
            )}

            <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
              <label className="block text-blue-800 font-bold mb-2 text-sm">
                متن کپی شده از ترلو را اینجا Paste کنید:
              </label>
              <textarea 
                rows={4}
                className="w-full border border-blue-300 p-2 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                placeholder="مثال:&#10;صاحب کالا: آذرفولاد امین&#10;شماره ثبت سفارش: 90611944"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button 
                onClick={handleSmartPaste}
                disabled={isSaving}
                className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-bold transition shadow"
              >
                استخراج خودکار
              </button>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4 mt-4">
              <h2 className="font-bold text-gray-700 border-b pb-2">فیلدهای سیستم (قابل ویرایش)</h2>
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-bold">صاحب کالا / شرکت</label>
                <input type="text" className="w-full border p-2 rounded bg-gray-50 font-bold text-gray-900" 
                  value={formData.client} onChange={e => setFormData({...formData, client: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-bold">شماره ثبت سفارش</label>
                  <input type="text" className="w-full border p-2 rounded bg-gray-50 text-gray-900" 
                    value={formData.regNumber} onChange={e => setFormData({...formData, regNumber: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-bold">شماره قبض انبار</label>
                  <input type="text" className="w-full border p-2 rounded bg-gray-50 text-gray-900" 
                    value={formData.receiptNumber} onChange={e => setFormData({...formData, receiptNumber: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-bold">مبلغ کل فاکتور</label>
                  <input type="text" className="w-full border p-2 rounded bg-gray-50 text-left dir-ltr font-mono text-gray-900" 
                    value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-bold">نوع ارز</label>
                  <input type="text" className="w-full border p-2 rounded bg-gray-50 text-gray-900" 
                    value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-bold">وزن خالص (کیلوگرم)</label>
                <input type="text" className="w-full border p-2 rounded bg-gray-50 text-gray-900" 
                  value={formData.netWeight} onChange={e => setFormData({...formData, netWeight: e.target.value})} />
              </div>

              <button 
                onClick={handleSaveToDatabase}
                disabled={isSaving}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold mt-4 transition shadow-md flex justify-center items-center disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  'ذخیره نهایی در دیتابیس'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
