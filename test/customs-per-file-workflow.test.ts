import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const shipment = read('src/pages/ShipmentFirstPage.tsx');
const manager = read('src/pages/FileManagerPage.tsx');
const ai = read('src/components/CustomsStageDocumentAI.tsx');
const migration = read('supabase/migrations/20261118120000_customs_per_file_operation_extractions.sql');
const gateway = read('supabase/functions/messenger-gateway/index.ts');

describe('per-file customs document lifecycle', () => {
  it('preserves source filename while saving a custom display name, type, tags and operation assignments per shipment file', () => {
    expect(shipment).toContain('type PendingShipmentDocument={id:string;name:string;displayName:string;documentType:string;tags:string[];operationSections:string[]');
    expect(shipment).toContain('document_name:staged.displayName.trim()||staged.name,original_file_name:staged.name');
    expect(shipment).toContain('document_type:staged.documentType,tags:staged.tags,operation_sections:staged.operationSections');
    expect(shipment).toContain('برچسب‌های همین فایل');
  });
  it('archives File Manager drafts one-by-one and persists each row’s own tags and operation sections', () => {
    expect(manager).toContain('type PendingFileDraft={id:string;file:File;displayName:string;documentType:string;tags:string[];operationSections:string[]}');
    expect(manager).toContain('for (const draft of queue)');
    expect(manager).toContain('uploadTelegramArchivedFile(fileToUpload, {');
    expect(manager).toContain('destination: destination!,');
    expect(manager).toContain('uploadCloudflareFileManagerFile(fileToUpload, {');
    expect(manager).toContain('operationSections: draft.operationSections,');
    expect(manager).toContain('update({ document_type: documentType, tags, operation_sections: draft.operationSections');
  });
  it('stores each file’s section extraction separately and prevents extraction before assignment', () => {
    expect(ai).toContain('if(!isCustomsDocumentAssignedToSection(file.operationSections,section))');
    expect(ai).toContain('operation_section:section');
    expect(ai).toContain('onConflict:\'declaration_id,source_key,operation_section\'');
    expect(ai).toContain('extractAllAssigned');
    expect(migration).toContain('create table if not exists public.customs_document_extractions');
    expect(migration).toContain('unique (declaration_id,source_key,operation_section)');
  });
  it('propagates per-document operation assignment and tags into the archived File Manager record', () => {
    expect(migration).toContain('add column if not exists tags text[] not null default');
    expect(gateway).toContain('tags,operation_sections,file_size_bytes');
    expect(gateway).toContain('const storedTags=Array.isArray(document.tags)');
    expect(gateway).toContain('tags,\n    operation_sections:sections');
  });
});
