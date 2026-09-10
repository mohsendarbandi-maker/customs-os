import { GoogleGenAI } from '@google/genai';

// دریافت امن کلید API از تنظیمات محیطی Vite
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
  console.warn("هشدار: کلید VITE_GEMINI_API_KEY در متغیرهای محیطی یافت نشد.");
}

const aiClient = new GoogleGenAI({ apiKey });

/**
 * تابع استخراج اطلاعات گمرکی با استفاده از مدل چندوجهی گوگل (متن، عکس، PDF)
 */
export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string) {
  try {
    const contents: any[] = [promptText];

    // اگر فایل (تصویر یا PDF) آپلود شده باشد، به صورت چندوجهی (Multimodal) ارسال می‌شود
    if (fileBase64 && mimeType) {
      contents.unshift({
        inlineData: {
          data: fileBase64,
          mimeType: mimeType
        }
      });
    }

    // استفاده از مدل سریع و بهینه گوگل برای تحلیل اسناد
    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    return response.text;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw error;
  }
}
