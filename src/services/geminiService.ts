/// <reference types="vite/client" />

export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string): Promise<string> {
  // دور زدن خطای تایپ‌اسکریپت برای متغیرهای محیطی Vite
  const env = (import.meta as any).env;
  const apiKey = env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("کلید VITE_GEMINI_API_KEY در تنظیمات Vercel یافت نشد.");
  }

  // استفاده از REST API مستقیم گوگل به جای پکیج @google/genai
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  // ساختاردهی محتوا
  let parts: any[] = [{ text: promptText }];

  // اگر فایلی وجود داشت، آن را به عنوان داده چندوجهی اضافه کن
  if (fileBase64 && mimeType) {
    parts.unshift({
      inline_data: {
        mime_type: mimeType,
        data: fileBase64
      }
    });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `خطای API گوگل: ${response.status}`);
    }

    const data = await response.json();
    
    // استخراج امن متن از پاسخ گوگل (Null-safe)
    const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!extractedText) {
      throw new Error("گوگل پاسخی برنگرداند یا فرمت فایل خوانا نبود.");
    }

    return extractedText;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw error;
  }
}
