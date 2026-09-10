/// <reference types="vite/client" />

const rawApiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const apiKey = encodeURIComponent(rawApiKey.trim());

export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string): Promise<string> {
  if (!apiKey) {
    throw new Error('کلید API گوگل در تنظیمات یافت نشد.');
  }

  // استفاده از نسخه پایدار v1beta که برای خواندن فایل‌ها بهینه‌ترین حالت است
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const parts: any[] = [];

  if (fileBase64) {
    // 🐛 FIX: فیلتر قدرتمند برای اصلاح باگ فرمت فایل در گوشی‌های آیفون
    let cleanMimeType = 'application/pdf'; // پیش‌فرض روی PDF
    
    const lowerMime = (mimeType || '').toLowerCase();
    if (lowerMime.includes('png')) cleanMimeType = 'image/png';
    else if (lowerMime.includes('jpg') || lowerMime.includes('jpeg')) cleanMimeType = 'image/jpeg';
    else if (lowerMime.includes('webp')) cleanMimeType = 'image/webp';
    else if (lowerMime.includes('heic') || lowerMime.includes('heif')) cleanMimeType = 'image/heic';
    else cleanMimeType = 'application/pdf'; // اگر آیفون فرمت را خالی یا عجیب فرستاد، حتماً PDF در نظر بگیر

    parts.push({
      inlineData: {
        mimeType: cleanMimeType,
        data: fileBase64
      }
    });
  }

  parts.push({ text: promptText });

  const payload = {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ]
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
      console.error("جزئیات خطای گوگل:", errorData);
      throw new Error(errorData.error?.message || 'خطا در ارتباط با سرور گوگل');
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates.length > 0) {
      const firstCandidate = data.candidates[0];
      if (firstCandidate.content && firstCandidate.content.parts) {
        return firstCandidate.content.parts[0].text || '';
      }
    }
    
    throw new Error('گوگل سند را خواند اما نتوانست متنی از آن استخراج کند.');
    
  } catch (error: any) {
    console.error("AI Extraction Error:", error);
    throw new Error(error.message || 'خطای ناشناخته در ارتباط با هوش مصنوعی');
  }
}
