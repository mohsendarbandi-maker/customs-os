import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fitPdfToA4 } from '../src/lib/eplPrintUtils';

describe('fitPdfToA4', () => {
  it('keeps every source page and fits portrait and landscape pages to A4', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 900]);
    source.addPage([1000, 600]);

    const result = await fitPdfToA4(await source.save());
    const output = await PDFDocument.load(result.bytes);

    expect(result.pageCount).toBe(2);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(output.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
    expect(output.getPage(1).getWidth()).toBeCloseTo(841.89, 1);
    expect(output.getPage(1).getHeight()).toBeCloseTo(595.28, 1);
  });

  it('rejects invalid margins and empty input', async () => {
    await expect(fitPdfToA4(new Uint8Array())).rejects.toThrow('خالی');
    const source = await PDFDocument.create();
    source.addPage();
    await expect(fitPdfToA4(await source.save(), 120)).rejects.toThrow('حاشیه');
  });
});
