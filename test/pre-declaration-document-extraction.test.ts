import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../src/pages/PreDeclarationPage.tsx'), 'utf8');

describe('stage 2 document extraction', () => {
  it('uses the supported binary document contract for Storage and Telegram files', () => {
    expect(source).toContain('telegram_file_asset_id');
    expect(source).toContain('document_storage_path');
    expect(source).toContain('document_mime_type');
    expect(source).not.toContain('documents:[{name:d.document_name');
  });

  it('keeps explicit extraction available for archived documents and provides a local OCR fallback', () => {
    expect(source).toContain('const processDocs=docs.filter(d=>Boolean(d.file_asset_id||d.storage_path))');
    expect(source).toContain('extractDocumentText(localFile,setStatus)');
    expect(source).toContain('document_text:documentText');
  });

  it('persists legacy customs document extraction in its JSON column rather than the shipment-documents foreign key', () => {
    expect(source).toContain("from('customs_documents').update({extraction:parsed,extraction_confidence:null})");
    expect(source).toContain("from('shipment_document_extractions').upsert(rows");
  });

  it('does not overwrite manually entered stage 2 values with extracted values', () => {
    expect(source).toContain('if(usable(incoming[key])&&!usable(merged[key]))merged[key]=incoming[key]');
  });
});
