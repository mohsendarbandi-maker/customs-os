import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Wand2, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { profile } = useAuth();
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
    <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-secondary">
            <Wand2 size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold">ثبت هوشمند محموله (Smart Paste)</h2>
            <p className="text-sm text-slate-500">متن اطلاعات ترلو را کپی کرده و در کادر زیر قرار دهید.</p>
          </div>
        </div>

        {statusMessage && (
          <div className={`mb-4 p-4 rounded-xl text-sm font-medium flex items-center gap-3 border ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' 
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800'
          }`}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div className="space-y-4">
          <textarea 
            rows={5}
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-xl text-sm focus:ring-2 focus:ring-secondary outline-none transition-all resize-none font-mono"
            placeholder="مثال:&#10;صاحب کالا: آذرفولاد امین&#10;شماره ثبت سفارش: 90611944&#10;وزن خالص: 1,595,970"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button 
            onClick={handleSmartPaste}
            className="w-full bg-secondary hover:bg-blue-700 text-white py-3 rounded-xl font-bold transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Wand2 size={18} />
            <span>استخراج خودکار اطلاعات</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-800 space-y-4">
        <h3 className="font-bold text-base border-b border-slate-100 dark:border-slate-800 pb-3">اطلاعات تفکیک‌شده پرونده</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 mb-1">صاحب کالا / شرکت</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm font-bold" 
              value={formData.client} 
              onChange={e => setFormData({...formData, client: e.target.value})} 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">شماره ثبت سفارش</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm font-mono" 
              value={formData.regNumber} 
              onChange={e => setFormData({...formData, regNumber: e.target.value})} 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">شماره قبض انبار</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm font-mono" 
              value={formData.receiptNumber} 
              onChange={e => setFormData({...formData, receiptNumber: e.target.value})} 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">مبلغ کل فاکتور</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm font-mono text-left" 
              dir="ltr"
              value={formData.amount} 
              onChange={e => setFormData({...formData, amount: e.target.value})} 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">نوع ارز</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm" 
              value={formData.currency} 
              onChange={e => setFormData({...formData, currency: e.target.value})} 
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 mb-1">وزن خالص (کیلوگرم)</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl text-sm font-mono" 
              value={formData.netWeight} 
              onChange={e => setFormData({...formData, netWeight: e.target.value})} 
            />
          </div>
        </div>

        <button 
          onClick={handleSaveToDatabase}
          disabled={isSaving}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-xl font-bold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 mt-6"
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
  );
};
