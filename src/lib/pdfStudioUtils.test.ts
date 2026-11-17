import { describe, expect, it } from 'vitest';
import { buildPdfStudioLineage, pageExpressionForMatches, parsePageSelection, suggestDocumentLabel } from './pdfStudioUtils';

describe('PDF Studio page selection', () => {
  it('supports ranges and explicit page lists in one field', () => {
    expect(parsePageSelection('1-2,5', 8)).toEqual([1, 2, 5]);
    expect(parsePageSelection('۱-۲،۵', 8)).toEqual([1, 2, 5]);
    expect(parsePageSelection('1,5,2-3', 8)).toEqual([1, 2, 3, 5]);
  });

  it('rejects invalid, descending and out-of-bounds ranges', () => {
    expect(() => parsePageSelection('', 4)).toThrow();
    expect(() => parsePageSelection('3-1', 4)).toThrow();
    expect(() => parsePageSelection('1-5', 4)).toThrow();
    expect(() => parsePageSelection('1,,2', 4)).toThrow();
  });

  it('suggests document labels from page text without OCR', () => {
    expect(suggestDocumentLabel('مانیفست الکترونیک کالا', 'scan.pdf', 3)).toBe('مانیفست الکترونیک');
    expect(suggestDocumentLabel('Customs declaration', 'document.pdf', 1)).toBe('اظهارنامه');
    expect(suggestDocumentLabel('', 'permit.pdf', 2)).toBe('permit - صفحه 2');
  });

  it('maps named page labels to page numbers for a prepared split', () => {
    expect(pageExpressionForMatches([
      { label: 'اظهارنامه' },
      { label: 'قبض انبار پشت' },
      { label: 'مانیفست الکترونیک' },
    ], [/قبض انبار/])).toBe('2');
  });
});


describe('PDF Studio persisted source lineage', () => {
  const sources = [
    {
      documentId: 'doc-a', fileAssetId: 'asset-a', fileManagerFileId: 'row-a',
      fileName: 'bill.pdf', folderId: 'folder-a', shipmentId: 'shipment-a', clientId: 'client-a',
    },
    {
      documentId: 'doc-b', fileAssetId: 'asset-b', fileManagerFileId: 'row-b',
      fileName: 'manifest.pdf', folderId: 'folder-a', shipmentId: 'shipment-a', clientId: 'client-a',
    },
  ];

  it('keeps exact parent file and page mapping for a merged output', () => {
    const lineage = buildPdfStudioLineage([
      { documentId: 'doc-a', pageIndex: 0, label: 'قبض انبار رو', rotation: 0 },
      { documentId: 'doc-b', pageIndex: 2, label: 'مانیفست', rotation: 90 },
    ], sources);

    expect(lineage?.parentFileAssetIds).toEqual(['asset-a', 'asset-b']);
    expect(lineage?.archiveTarget).toEqual({ folderId: 'folder-a', shipmentId: 'shipment-a', clientId: 'client-a' });
    expect(lineage?.pages.map((page) => [page.fileAssetId, page.sourcePageNumber, page.label, page.rotation])).toEqual([
      ['asset-a', 1, 'قبض انبار رو', 0],
      ['asset-b', 3, 'مانیفست', 90],
    ]);
  });

  it('uses the shipment documents folder when source files came from different folders', () => {
    const lineage = buildPdfStudioLineage([
      { documentId: 'doc-a', pageIndex: 0, label: 'A', rotation: 0 },
      { documentId: 'doc-b', pageIndex: 1, label: 'B', rotation: 0 },
    ], sources.map((source) => ({ ...source, folderId: source.documentId === 'doc-a' ? 'folder-a' : 'folder-b' })));

    expect(lineage?.archiveTarget.folderId).toBeNull();
    expect(lineage?.archiveTarget.shipmentId).toBe('shipment-a');
  });

  it('refuses automatic archiving across shipments, clients, or unlinked files', () => {
    const pages = [
      { documentId: 'doc-a', pageIndex: 0, label: 'A', rotation: 0 },
      { documentId: 'doc-b', pageIndex: 0, label: 'B', rotation: 0 },
    ];
    expect(buildPdfStudioLineage(pages, sources.map((source, index) => ({
      ...source, shipmentId: index === 0 ? 'shipment-a' : 'shipment-b',
    })))).toBeNull();
    expect(buildPdfStudioLineage(pages, sources.map((source, index) => ({
      ...source, clientId: index === 0 ? 'client-a' : 'other-client',
    })))).toBeNull();
    expect(buildPdfStudioLineage(pages, [sources[0], { ...sources[1], fileAssetId: null }])).toBeNull();
  });
});
