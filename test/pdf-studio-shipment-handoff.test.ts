import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const studio = read('src/pages/PdfStudioPage.tsx');
const shipment = read('src/pages/ShipmentFirstPage.tsx');
const transfer = read('src/lib/appFileTransfer.ts');

describe('Shipment registration and PDF Studio hand-off', () => {
  it('transfers the complete staged shipment draft while opening only the chosen PDF in Studio', () => {
    expect(shipment).toContain("createAppFileTransfer(pendingDocuments.map(item=>item.file),'pdf-studio'");
    expect(shipment).toContain('shipmentDraftDocuments');
    expect(shipment).toContain('formDraft.saveDraftNow()');
    expect(studio).toContain('consumeAppFileTransferWithContext');
    expect(studio).toContain('await loadFiles([files[primaryIndex]])');
  });

  it('keeps the existing PDF Studio page editor capabilities available to shipment documents', () => {
    expect(studio).toContain('page.thumbnail');
    expect(studio).toContain('onDropPage');
    expect(studio).toContain('movePage(index, -1)');
    expect(studio).toContain('rotateSelected');
    expect(studio).toContain('removeSelected');
    expect(studio).toContain('const createPdfBytes = async');
  });

  it('returns the edited primary document together with untouched staged documents and metadata', () => {
    expect(studio).toContain("createAppFileTransfer(returnFiles, 'shipment'");
    expect(studio).toContain('editedDocumentId: bundle.primaryDocumentId');
    expect(shipment).toContain("consumeAppFileTransferWithContext(transferId,'shipment')");
    expect(shipment).toContain('restored.filter(item=>item.id===editedDocumentId||!item.storagePath)');
    expect(shipment).not.toContain('<iframe title={document.name} src={previewBillOfLadingUrl');
  });

  it('cleans the previous staging object only after the edited replacement has uploaded successfully', () => {
    expect(shipment).toContain('const previousStoragePath=document.storagePath');
    expect(shipment).toContain("supabase.storage.from(BUCKET).remove([previousStoragePath])");
  });

  it('preserves older transfer callers while adding typed transfer context', () => {
    expect(transfer).toContain("'shipment'");
    expect(transfer).toContain('export async function consumeAppFileTransferWithContext');
    expect(transfer).toContain('export async function consumeAppFileTransfer(');
    expect(transfer).toContain('return transfer.files');
  });
});
