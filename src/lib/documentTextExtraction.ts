import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export function normalizeDocumentText(value: string, maxChars = 26_000): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

type Progress = (message: string) => void;

/**
 * Local fallback for documents that the AI provider cannot read.
 * Extracts embedded PDF text first and OCRs scanned pages/images with Persian + English.
 */
export async function extractDocumentText(
  file: File,
  onProgress: Progress = () => undefined,
): Promise<string> {
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/.test(name);

  if (!isPdf && !isImage) {
    throw new Error('قالب این سند برای استخراج متن پشتیبانی نمی‌شود.');
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  const chunks: string[] = [];

  const getOcrWorker = async () => {
    if (!worker) {
      onProgress('متن PDF قابل‌خواندن نیست؛ OCR فارسی و انگلیسی فعال می‌شود…');
      worker = await createWorker('fas+eng');
    }
    return worker;
  };

  try {
    if (isPdf) {
      onProgress('در حال خواندن متن صفحات PDF…');
      const pdf = await pdfjsLib.getDocument({
        data: await file.arrayBuffer(),
        useSystemFonts: true,
      }).promise;
      const pageLimit = Math.min(pdf.numPages, 40);
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        onProgress('در حال بررسی صفحه ' + pageNumber + ' از ' + pdf.numPages + '…');
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => typeof item.str === 'string' ? item.str : '')
          .filter(Boolean)
          .join(' ')
          .trim();

        if (pageText.length >= 24) {
          chunks.push('[صفحه ' + pageNumber + ']\n' + pageText);
        } else {
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('ساخت تصویر صفحه PDF برای OCR ناموفق بود.');
          await page.render({ canvasContext: context, viewport }).promise;
          const ocr = await getOcrWorker();
          const result = await ocr.recognize(canvas);
          const text = String(result.data?.text || '').trim();
          if (text) chunks.push('[صفحه ' + pageNumber + ' · OCR]\n' + text);
          canvas.width = 0;
          canvas.height = 0;
        }

        if (chunks.join('\n').length >= 26_000) break;
      }
      if (pdf.numPages > pageLimit) {
        chunks.push('[ادامه سند: برای جلوگیری از پردازش بیش‌ازحد، فقط ' + pageLimit + ' صفحه نخست بررسی شد.]');
      }
    } else {
      onProgress('در حال OCR تصویر سند…');
      const ocr = await getOcrWorker();
      const result = await ocr.recognize(file);
      const text = String(result.data?.text || '').trim();
      if (text) chunks.push(text);
    }
  } finally {
    if (worker) await worker.terminate();
  }

  const output = normalizeDocumentText(chunks.join('\n\n'));
  if (output.length < 12) {
    throw new Error('از سند متن قابل‌خواندنی استخراج نشد. کیفیت تصویر یا اسکن سند را بررسی کنید.');
  }
  return output;
}
