const normalizeDigits = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

export function parsePageSelection(expression: string, totalPages: number): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error('تعداد صفحات معتبر نیست.');
  const input = normalizeDigits(expression).replace(/[–—−]/g, '-').replace(/[،؛;]/g, ',').replace(/\s+/g, '');
  if (!input) throw new Error('شماره صفحات را وارد کنید؛ نمونه: 1-2 یا 1,5.');
  const selected = new Set<number>();
  for (const part of input.split(',')) {
    if (!part) throw new Error('فرمت صفحات ناقص است؛ نمونه: 1-2,5.');
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('فرمت صفحات معتبر نیست؛ از 1-2 یا 1,5 استفاده کنید.');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > totalPages) {
      throw new Error(`شماره صفحات باید بین ۱ تا ${totalPages} باشد و بازه از کوچک به بزرگ نوشته شود.`);
    }
    for (let page = start; page <= end; page += 1) selected.add(page);
  }
  return [...selected].sort((a, b) => a - b);
}

const DOCUMENT_PATTERNS: Array<[RegExp, string]> = [
  [/مانیفست|manifest|cargo manifest|e[- ]?manifest/i, 'مانیفست الکترونیک'],
  [/فرم\s*a\s*e\s*o|\baeo\b/i, 'فرم AEO'],
  [/اظهارنامه|customs declaration|declaration|کوتاژ/i, 'اظهارنامه'],
  [/قبض\s*انبار.*(پشت|ظهر)|پشت.*قبض\s*انبار|warehouse receipt.*back/i, 'قبض انبار پشت'],
  [/قبض\s*انبار.*(رو|روی)|روی.*قبض\s*انبار|warehouse receipt.*front/i, 'قبض انبار رو'],
  [/قبض\s*انبار|warehouse receipt/i, 'قبض انبار'],
  [/پروانه\s*بهره.?برداری|operating license| بهره.?برداری/i, 'پروانه بهره‌برداری'],
  [/تمدید.*پروانه|license renewal/i, 'تمدید پروانه'],
  [/علامت\s*استاندارد|نشان\s*استاندارد|standard mark/i, 'علامت استاندارد'],
  [/گواهی\s*مبدا|certificate of origin|\bcoo\b/i, 'گواهی مبدا'],
  [/بارنامه|bill of lading|\bbl\b/i, 'بارنامه'],
  [/فاکتور|invoice|commercial invoice/i, 'فاکتور'],
  [/لیبل|label|برچسب/i, 'لیبل کالا'],
  [/عکس|تصویر|photo|product image/i, 'عکس کالا'],
];

export function suggestDocumentLabel(text: string, fileName: string, pageNumber: number): string {
  const haystack = `${text || ''} ${fileName || ''}`.normalize('NFKC').replace(/\u200c/g, ' ');
  for (const [pattern, label] of DOCUMENT_PATTERNS) {
    if (pattern.test(haystack)) return label;
  }
  return `${fileName.replace(/\.[^.]+$/, '') || 'سند'} - صفحه ${pageNumber}`.slice(0, 100);
}

export function pageExpressionForMatches(pageLabels: Array<{ label: string }>, patterns: readonly RegExp[]): string {
  const matches = pageLabels
    .map((page, index) => patterns.some((pattern) => pattern.test(page.label)) ? index + 1 : 0)
    .filter(Boolean);
  return matches.length ? matches.join(',') : '';
}

export const PDF_STUDIO_PRESETS = {
  shipPass: [
    { name: 'قبض انبار رو', patterns: [/قبض انبار رو|قبض انبار$/] },
    { name: 'قبض انبار پشت', patterns: [/قبض انبار پشت/] },
    { name: 'مانیفست الکترونیک', patterns: [/مانیفست/] },
  ],
  guarantee: [
    { name: 'اظهارنامه', patterns: [/اظهارنامه/] },
    { name: 'قبض انبار پشت و رو', patterns: [/قبض انبار/] },
    { name: 'پروانه بهره‌برداری', patterns: [/پروانه بهره/] },
    { name: 'فرم AEO', patterns: [/AEO/i] },
  ],
} as const;


export type PdfStudioLineageSource = {
  documentId: string;
  fileAssetId: string | null;
  fileManagerFileId: string | null;
  fileName: string;
  folderId: string | null;
  shipmentId: string | null;
  clientId: string | null;
};

export type PdfStudioLineagePage = {
  documentId: string;
  pageIndex: number;
  label: string;
  rotation: number;
};

export type PdfStudioLineage = {
  version: 1;
  parentFileAssetIds: string[];
  parentFileManagerFileIds: string[];
  sourceFiles: Array<{
    fileAssetId: string;
    fileManagerFileId: string;
    fileName: string;
    folderId: string;
    shipmentId: string;
    clientId: string | null;
  }>;
  archiveTarget: {
    folderId: string | null;
    shipmentId: string;
    clientId: string | null;
  };
  pages: Array<{
    fileAssetId: string;
    fileManagerFileId: string;
    sourcePageNumber: number;
    label: string;
    rotation: number;
  }>;
};

/**
 * Create source-to-output lineage only when every output page resolves to a
 * persisted File Manager asset in one shipment and one client scope.
 * Different source folders safely fall back to the shipment documents folder.
 */
export function buildPdfStudioLineage(
  pages: readonly PdfStudioLineagePage[],
  sourceFiles: readonly PdfStudioLineageSource[],
): PdfStudioLineage | null {
  if (!pages.length) return null;
  const sources = new Map(sourceFiles.map((source) => [source.documentId, source]));
  const usedIds = [...new Set(pages.map((page) => page.documentId))];
  const usedSources = usedIds.map((id) => sources.get(id));
  if (usedSources.some((source) =>
    !source?.fileAssetId || !source.fileManagerFileId || !source.folderId || !source.shipmentId
  )) return null;

  const completeSources = usedSources as PdfStudioLineageSource[];
  const first = completeSources[0];
  if (completeSources.some((source) =>
    source.shipmentId !== first.shipmentId || source.clientId !== first.clientId
  )) return null;

  const uniqueSources = completeSources.filter((source, index, all) =>
    all.findIndex((candidate) => candidate.fileAssetId === source.fileAssetId) === index
  );
  const commonFolderId = uniqueSources.every((source) => source.folderId === first.folderId)
    ? first.folderId
    : null;

  return {
    version: 1,
    parentFileAssetIds: uniqueSources.map((source) => source.fileAssetId as string),
    parentFileManagerFileIds: uniqueSources.map((source) => source.fileManagerFileId as string),
    sourceFiles: uniqueSources.map((source) => ({
      fileAssetId: source.fileAssetId as string,
      fileManagerFileId: source.fileManagerFileId as string,
      fileName: source.fileName,
      folderId: source.folderId as string,
      shipmentId: source.shipmentId as string,
      clientId: source.clientId,
    })),
    archiveTarget: {
      folderId: commonFolderId,
      shipmentId: first.shipmentId as string,
      clientId: first.clientId,
    },
    pages: pages.map((page) => {
      const source = sources.get(page.documentId)!;
      return {
        fileAssetId: source.fileAssetId as string,
        fileManagerFileId: source.fileManagerFileId as string,
        sourcePageNumber: page.pageIndex + 1,
        label: page.label,
        rotation: page.rotation,
      };
    }),
  };
}
