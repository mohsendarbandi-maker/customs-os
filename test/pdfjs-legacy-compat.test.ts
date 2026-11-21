import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(fullPath)
      : /\.tsx?$/.test(entry.name)
        ? [fullPath]
        : [];
  });
}

describe('PDF.js browser compatibility', () => {
  it('uses the legacy API and matching legacy worker in every PDF.js consumer', () => {
    const consumers = sourceFiles(path.join(root, 'src'))
      .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
      .filter(({ content }) => content.includes('pdfjs-dist'))
      .sort((a, b) => a.file.localeCompare(b.file));

    expect(consumers.length).toBeGreaterThan(0);

    for (const { content } of consumers) {
      const pdfReferences = content.match(/pdfjs-dist[^'"]*/g) || [];
      expect(pdfReferences.length).toBeGreaterThanOrEqual(2);
      expect(pdfReferences.every((reference) => reference.startsWith('pdfjs-dist/legacy/build/'))).toBe(true);
      expect(content).toContain('pdfjs-dist/legacy/build/pdf.mjs');
      expect(content).toContain('pdfjs-dist/legacy/build/pdf.worker');
    }
  });
});
