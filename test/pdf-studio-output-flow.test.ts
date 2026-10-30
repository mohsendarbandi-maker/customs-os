import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../src/pages/PdfStudioPage.tsx'), 'utf8');

describe('PDF Studio prepared output workflow', () => {
  it('stages outputs and triggers a browser download only from the explicit download handler', () => {
    expect(source).toContain('const queueOutputs =');
    expect(source).toContain('const downloadReadyOutput = (output: ReadyOutput)');
    expect(source).toContain('onClick={() => downloadReadyOutput(output)}');
    expect(source).toContain('anchor.download = name');
    expect(source).not.toContain('window.open(');
    expect(source).not.toContain('compressionRuns');
    expect(source.match(/downloadBlob\(/g)?.length).toBe(1);
  });

  it('keeps prepared files available after download instead of clearing the workspace', () => {
    expect(source).toContain('setReadyOutputs((previous) => [...prepared, ...previous])');
    expect(source).toContain('setReadyOutputs((previous) => previous.map((item)');
    expect(source).toContain('downloadedAt');
    expect(source).not.toContain('setReadyOutputs([])');
    expect(source).not.toContain('setDocuments([]);\n    setPages([]);\n    setReadyOutputs([])');
    expect(source).toContain("localStorage.setItem('customs-os-pdfstudio-compression:' + organizationId");
    expect(source).toContain('فایل‌های ورودی و تنظیمات حفظ می‌شوند');
  });

  it('keeps merge, split, compression and stamp tools disabled until explicitly selected', () => {
    expect(source).toContain('merge: false, split: false, compression: false, stamp: false');
    expect(source).toContain('{outputTools.merge && (');
    expect(source).toContain('{outputTools.split && (');
    expect(source).toContain('{outputTools.compression && (');
    expect(source).toContain('{outputTools.stamp && (');
    expect(source).toContain('هیچ عملیات خروجی بدون انتخاب تو اجرا نمی‌شود');
  });


  it('never labels an unchanged PDF as a compressed output', () => {
    expect(source).toContain('if (candidate.blob.size >= originalBytes.byteLength)');
    expect(source).toContain('خروجی تکراری ساخته نشد');
    expect(source).toContain('فشرده‌سازی هوشمند کاهش حجمی ایجاد نکرد');
  });

  it('offers a clearly warned raster fallback and retries at lower image settings', () => {
    expect(source).toContain("compressionSettings.mode === 'smart'");
    expect(source).toContain('متن آن صفحات دیگر قابل جست‌وجو یا انتخاب نخواهد بود');
    expect(source).toContain('Math.min(compressionSettings.dpi, 120)');
    expect(source).toContain('pagePreservationIds');
  });

  it('produces individual PDF files for split outputs rather than an automatic ZIP download', () => {
    expect(source).toContain('const outputFiles: Array<{ name: string; bytes: Uint8Array }>');
    expect(source).toContain("type: 'application/pdf'");
    expect(source).not.toContain('zipSync(');
    expect(source).not.toContain("type: 'application/zip'");
    expect(source).not.toContain('.zip');
  });
});
