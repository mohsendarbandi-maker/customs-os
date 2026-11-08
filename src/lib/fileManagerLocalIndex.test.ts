import { describe, expect, it } from 'vitest';
import { buildLocalFileManagerHtml } from './fileManagerLocalIndex';
import { isManagedSyncMetadataFile } from './fileManagerSync';

describe('buildLocalFileManagerHtml', () => {
  it('creates a self-contained Persian offline dashboard with the folder tree and document metadata', () => {
    const html = buildLocalFileManagerHtml({
      schemaVersion: 1,
      exportedAt: '2026-11-08T12:00:00.000Z',
      organizationId: 'org-1',
      tables: { shipments: [{ id: 'ship-1', bill_of_lading_no: 'BL-123' }], clients: [{ id: 'client-1' }] },
      fileManager: {
        folders: [{ id: 'folder-1', display_name: 'ارس تارلا امین', relativePath: 'ارس تارلا امین' }],
        files: [{ id: 'file-1', folder_id: 'folder-1', original_name: 'بارنامه.pdf', relativePath: 'ارس تارلا امین/بارنامه.pdf', size_bytes: 123, document_type: 'BILL_OF_LADING' }],
      },
    });
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain('مدیریت محلی اسناد و پرونده‌ها');
    expect(html).toContain('ارس تارلا امین');
    expect(html).toContain('بارنامه.pdf');
    expect(html).toContain('BL-123');
    expect(html).toContain('const DATA =');
    expect(html).not.toContain('https://');
  });

  it('escapes script-breaking characters in embedded organization data', () => {
    const html = buildLocalFileManagerHtml({
      schemaVersion: 1,
      exportedAt: '2026-11-08T12:00:00.000Z',
      tables: { clients: [{ name: '</script><script>alert(1)</script>' }] },
      fileManager: { folders: [], files: [] },
    });
    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('\\u003c/script\\u003e');
  });
});


describe('local dashboard sync exclusion', () => {
  it('does not re-upload the generated HTML index as an archived business document', () => {
    expect(isManagedSyncMetadataFile('مدیریت_فایل.html')).toBe(true);
  });
});
