import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('inbound messenger files use canonical File Manager metadata', () => {
  const gateway = read('supabase/functions/messenger-gateway/index.ts');

  it('classifies incoming documents from the name instead of marking every PDF as a declaration', () => {
    expect(gateway).toContain('function inferInboundDocumentType(name:string):string');
    expect(gateway).toContain('return "CUSTOMS_DECLARATION_PRINT"');
    expect(gateway).toContain('return "COMMERCIAL_INVOICE"');
    expect(gateway).toContain('return "PACKING_LIST"');
    expect(gateway).toContain('return "BILL_OF_LADING"');
    expect(gateway).toContain('return "other"');
    expect(gateway).toContain('document_type:inferInboundDocumentType(cleanExternalName||"document.bin")');
  });

  it('indexes an inbound file only under the configured shipment or cargo-owner folder', () => {
    expect(gateway).toContain('.select("enabled,shipment_id,client_id,conversation_id,purpose")');
    expect(gateway).toContain('.eq("shipment_id",chat.shipment_id)');
    expect(gateway).toContain('.eq("client_id",chat.client_id)');
    expect(gateway).toContain('file_asset_id:a.id');
    expect(gateway).toContain('storage_path:"telegram://"+String(a.id)');
    expect(gateway).toContain('onConflict:"organization_id,file_asset_id"');
  });
});
