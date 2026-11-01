import { PDFDocument } from 'pdf-lib';

const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

export type A4PdfResult = {
  bytes: Uint8Array;
  pageCount: number;
};

/**
 * Creates a print-only A4 copy. It preserves the visible source page as a
 * vector-backed PDF object and scales the complete page proportionally.
 * It cannot restore content already missing from the source PDF.
 */
export async function fitPdfToA4(
  input: Uint8Array,
  marginPt = 18,
): Promise<A4PdfResult> {
  if (!input.byteLength) throw new Error('فایل PDF خالی است.');
  if (!Number.isFinite(marginPt) || marginPt < 0 || marginPt >= 100) {
    throw new Error('حاشیه چاپ معتبر نیست.');
  }

  const source = await PDFDocument.load(input);
  const pageCount = source.getPageCount();
  if (pageCount < 1) throw new Error('فایل PDF صفحه‌ای ندارد.');

  const output = await PDFDocument.create();
  const embeddedPages = await output.embedPdf(input);
  if (embeddedPages.length !== pageCount) {
    throw new Error('تعداد صفحات PDF برای آماده‌سازی چاپ یکسان نیست.');
  }

  embeddedPages.forEach((embeddedPage) => {
    const sourceSize = embeddedPage.size();
    const target = sourceSize.width > sourceSize.height ? A4_LANDSCAPE : A4_PORTRAIT;
    const page = output.addPage([target.width, target.height]);
    const availableWidth = target.width - marginPt * 2;
    const availableHeight = target.height - marginPt * 2;
    const scale = Math.min(
      availableWidth / sourceSize.width,
      availableHeight / sourceSize.height,
    );
    const width = sourceSize.width * scale;
    const height = sourceSize.height * scale;

    page.drawPage(embeddedPage, {
      x: (target.width - width) / 2,
      y: (target.height - height) / 2,
      width,
      height,
    });
  });

  return { bytes: await output.save(), pageCount };
}
