import React, { useState } from 'px-react'; // یا ایمپورت‌های استاندارد React
import { Wand2, Loader2, FileUp, CheckCircle2, AlertCircle } from 'lucide-react';

interface ExtractionResult {
  client: string;
  regNumber: string;
  receiptNumber: string;
  netWeight: string;
  amount: string;
  currency: string;
}

export const AIExtractionComponent: React.FC<{ onExtracted: (data: ExtractionResult) => void }> = ({ onExtracted }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputSource, setInputSource] = useState<'text' | 'file'>('text');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // تابع ارتباط با سرویس هوش مصنوعی گوگل (از طریق سرور یا Edge Function برای امنیت کلید)
  const handleAIProcess = async () => {
    setLoading(true);
    setError(null);

    try {
      // در محیط واقعی، درخواست به Supabase Edge Function یا سرور خودتان ارسال می‌شود 
      // تا کلید API گوگل افشا نشود.
      
      let payloadContent: any = rawText;

      if (inputSource === 'file' && selectedFile) {
        // تبدیل فایل به Base64 برای ارسال به هوش مصنوعی
        const base64Data = await convertFileToBase64(selectedFile);
        payloadContent = {
          mimeType: selectedFile.type,
          data: base64Data
        };
      }

      if (!payloadContent) {
        throw new Error('لطفاً متن یا فایلی برای پردازش وارد کنید.');
      }

      // شبیه‌سازی درخواست به موتور هوش مصنوعی چندوجهی گوگل (Gemini Multimodal API)
      // در اینجا ساختار Prompt برای استخراج فیلدهای گمرکی تنظیم شده است:
      const extractedData = await callGoogleAIEngine(payloadContent, inputSource);

      onExtracted(extractedData);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'خطا در پردازش هوشمند سند.');
      setLoading(false);
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // حذف هدر Base64 (مثل data:application/pdf;base64,)
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // تابع فرضی ارتباط با API گوگل (در سمت سرور پیاده‌سازی می‌شود)
  const callGoogleAIEngine = async (content: any, type: 'text' | 'file'): Promise<ExtractionResult> => {
    // اینجا در نسخه نهایی، فچ (Fetch) به سمت API پلتفرم شما انجام می‌شود
    // که در پشت صحنه از SDK رسمی گوگل (`google-genai`) استفاده می‌کند.
    
    // شبیه‌سازی خروجی استاندارد JSON برای تست سریع:
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          client: 'آذرفولاد امین',
          regNumber: '90611944',
          receiptNumber: '1051295',
          netWeight: '1,595,970',
          amount: '861,823.80',
          currency: 'USD'
        });
      }, 1500);
    });
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800 shadow-xl space-y-6" dir="rtl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
            <Wand2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-200">هوش مصنوعی چندوجهی گوگل (Google AI)</h2>
            <p className="text-[11px] text-slate-500">استخراج خودکار از متن، عکس قبض انبار و فایل‌های PDF</p>
          </div>
        </div>
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button 
            onClick={() => setInputSource('text')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${inputSource === 'text' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >
            متن / Smart Paste
          </button>
          <button 
            onClick={() => setInputSource('file')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${inputSource === 'file' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >
            فایل PDF / عکس
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl text-xs font-medium flex items-center gap-3 bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {inputSource === 'text' ? (
        <div className="space-y-3">
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="متن کارت ترلو یا اطلاعات سند را اینجا Paste کنید..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer bg-slate-950/50 hover:bg-slate-950 transition-all">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <FileUp className="w-8 h-8 mb-2 text-blue-500" />
              <p className="mb-2 text-xs text-slate-300 font-semibold">
                {selectedFile ? selectedFile.name : 'انتخاب فایل PDF یا تصویر سند گمرکی'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">PDF, PNG, JPG (حداکثر 20MB)</p>
            </div>
            <input 
              type="file" 
              className="hidden" 
              accept=".pdf,image/*" 
              onChange={(e) => e.target.files && setSelectedFile(e.target.files[0])} 
            />
          </label>
        </div>
      )}

      <button
        onClick={handleAIProcess}
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>در حال تحلیل هوشمند سند با گوگل AI...</span>
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4" />
            <span>استخراج هوشمند اطلاعات</span>
          </>
        )}
      </button>
    </div>
  );
};
