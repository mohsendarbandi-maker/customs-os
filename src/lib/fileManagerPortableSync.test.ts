import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { createPortableSyncArchive, readPortableSyncArchive } from './fileManagerPortableSync';

describe('cross-browser portable file-manager sync', () => {
  it('round-trips files and the organization manifest in a ZIP archive', () => {
    const zip = createPortableSyncArchive([
      { path: 'Darbandi Commercial/صاحبان کالا/شرکت نمونه/محموله ۱/بارنامه.pdf', data: strToU8('bill of lading') },
      { path: 'Darbandi Commercial/صاحبان کالا/شرکت نمونه/محموله ۱/ضمیمه.txt', data: strToU8('attachment') },
    ], { organizationId: 'org-1', tables: { shipments: [{ id: 'shipment-1' }] } });

    const files = readPortableSyncArchive(zip, 'صاحبان کالا');
    expect(files).toHaveLength(2);
    expect(files[0].relativePath).toBe('شرکت نمونه/محموله ۱/بارنامه.pdf');
    expect(files[0].data).toEqual(strToU8('bill of lading'));
    expect(files[1].relativePath).toBe('شرکت نمونه/محموله ۱/ضمیمه.txt');
  });

  it('strips the portable root and owners-root folder regardless of path casing', () => {
    const zip = createPortableSyncArchive([
      { path: 'Darbandi Commercial/صاحبان کالا/صاحب کالا/سند.pdf', data: strToU8('x') },
    ], {});
    const files = readPortableSyncArchive(zip, 'صاحبان کالا');
    expect(files[0].relativePath).toBe('صاحب کالا/سند.pdf');
  });

  it('does not re-import generated metadata or operating-system files', () => {
    const zip = createPortableSyncArchive([
      { path: 'Darbandi Commercial/صاحبان کالا/a/اطلاعات_عملیاتی.txt', data: strToU8('generated') },
      { path: 'Darbandi Commercial/صاحبان کالا/a/test.pdf.اطلاعات.txt', data: strToU8('generated') },
      { path: 'Darbandi Commercial/صاحبان کالا/a/.DS_Store', data: strToU8('system') },
      { path: 'Darbandi Commercial/صاحبان کالا/a/desktop.ini', data: strToU8('system') },
      { path: 'Darbandi Commercial/اطلاعات_کامل_سازمان.json', data: strToU8('{}') },
      { path: 'Darbandi Commercial/صاحبان کالا/a/original.pdf', data: strToU8('original') },
    ], {});
    const files = readPortableSyncArchive(zip, 'صاحبان کالا');
    expect(files.map((file) => file.name)).toEqual(['original.pdf']);
  });

  it('does not allow path traversal components during ZIP import', () => {
    const zip = createPortableSyncArchive([
      { path: 'Darbandi Commercial/صاحبان کالا/a/secure.pdf', data: strToU8('ok') },
    ], {});
    const files = readPortableSyncArchive(zip, 'صاحبان کالا');
    expect(files.every((file) => !file.relativePath.split('/').includes('..'))).toBe(true);
  });

  it('rejects duplicate archive paths rather than silently overwriting a file', () => {
    expect(() => createPortableSyncArchive([
      { path: 'root/a.pdf', data: strToU8('one') },
      { path: 'root/a.pdf', data: strToU8('two') },
    ], {})).toThrow('دو فایل با مسیر یکسان');
  });
});
