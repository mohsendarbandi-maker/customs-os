import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('declaration documents reuse canonical File Manager records', () => {
  const registration = read('src/pages/DeclarationRegistrationPage.tsx');
  const picker = read('src/features/file-manager/FileManagerFilePicker.tsx');
  const baseMigration = read('supabase/migrations/20261025213000_declaration_file_manager_file_link.sql');
  const scopeMigration = read('supabase/migrations/20261025224500_enforce_declaration_file_manager_scope.sql');

  it('lets stage 3 choose an existing file rather than requiring another upload', () => {
    expect(registration).toContain('FileManagerFilePicker');
    expect(registration).toContain('از فایل‌منیجر');
    expect(registration).toContain('setSelectedFileManagerFile(picked)');
    expect(registration).toContain('p_file_name:selectedFileManagerFile.original_name');
    expect(registration).toContain('p_storage_path:selectedPath');
  });

  it('limits search to the selected shipment and that shipment owner folder', () => {
    expect(picker).toContain(".eq('shipment_id', shipmentId)");
    expect(picker).toContain(".eq('client_id', clientId)");
    expect(picker).toContain(".is('shipment_id', null)");
    expect(picker).toContain(".eq('is_archived', false)");
    expect(picker).toContain('supported(row)');
  });

  it('stores a canonical File Manager reference, not a duplicate binary', () => {
    expect(baseMigration).toContain('declaration_file_manager_file_id uuid');
    expect(baseMigration).toContain('references public.file_manager_files(id)');
    expect(registration).toContain("update({declaration_file_manager_file_id:selectedFileManagerFile.id})");
    expect(picker).not.toContain(".storage.from('customs_documents').upload");
  });

  it('enforces same-organization, same-shipment or same-owner scope and blocks archived files', () => {
    expect(scopeMigration).toContain("v_file.organization_id is distinct from new.organization_id");
    expect(scopeMigration).toContain('v_file.is_archived is true');
    expect(scopeMigration).toContain('v_file.shipment_id = new.shipment_id');
    expect(scopeMigration).toContain('v_file.client_id is distinct from v_shipment_client_id');
    expect(scopeMigration).toContain('DECLARATION_FILE_MANAGER_SCOPE_MISMATCH');
  });
});
