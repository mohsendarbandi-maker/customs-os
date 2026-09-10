/// <reference types="vite/client" />

const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string): Promise<string> {
  if (!apiKey) {
    throw new Error('کلید API گوگل (VITE_GEMINI_API_KEY) در تنظیمات Vercel یافت نشد.');
  }

  // استفاده از نسخه نهایی، پایدار و استاندارد v1
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  let parts: any[] = [];

  // حل مشکل اصلی: استفاده از نگارش صحیح inlineData و mimeType برای API گوگل
  if (fileBase64 && mimeType) {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: fileBase64
      }
    });
  }

  parts.push({ text: promptText });

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
