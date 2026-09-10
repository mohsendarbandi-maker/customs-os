/// <reference types="vite/client" />

// دریافت کلید از متغیرهای محیطی با Fallback برای جلوگیری از کرش کردن
const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string): Promise<string> {
  if (!apiKey) {
    throw new Error('کلید API گوگل (VITE_GEMINI_API_KEY) یافت نشد. لطفاً در تنظیمات Vercel اضافه کنید.');
  }

  // استفاده از REST API مستقیم به جای SDK برای جلوگیری از خطای نصب پکیج در Vercel
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  let parts: any[] = [{ text: promptText }];

  if (fileBase64 && mimeType) {
    parts.unshift({
      inline_data: {
        mime_type: mimeType,
        data: fileBase64
      }
    });
  }

  const payload = {
    contents: [{ parts }]
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'خطا در ارتباط با سرور گوگل');
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
  } catch (error: any) {
    console.error("AI Extraction Error:", error);
    throw new Error(error.message || 'خطای ناشناخته در سرویس هوش مصنوعی');
  }
}
