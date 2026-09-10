import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const aiClient = new GoogleGenAI({ apiKey });

export async function extractCustomsDataWithAI(promptText: string, fileBase64?: string, mimeType?: string) {
  try {
    const contents: any[] = [promptText];

    if (fileBase64 && mimeType) {
      contents.unshift({
        inlineData: {
          data: fileBase64,
          mimeType: mimeType
        }
      });
    }

    // تغییر نام مدل برای رفع ارور v1beta
    const response = await aiClient.models.generateContent({
      model: 'gemini-1.5-flash-latest', 
      contents: contents,
    });

    return response.text;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw error;
  }
}
