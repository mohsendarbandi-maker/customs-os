import { describe, expect, it } from 'vitest';
import { folderToneClass, getFolderSubtreeCounts, isCopyableFolder } from '../src/lib/fileManagerExplorer';

describe('file manager explorer model', () => {
  it('counts active files through nested folders', () => {
    const folders = [
      { id: 'root', parent_id: null, folder_type: 'root' },
      { id: 'owner', parent_id: 'root', folder_type: 'client' },
      { id: 'shipment', parent_id: 'owner', folder_type: 'shipment' },
      { id: 'finance', parent_id: 'shipment', folder_type: 'accounting_finance' },
      { id: 'receipts', parent_id: 'finance', folder_type: 'custom' },
    ];
    expect(getFolderSubtreeCounts(folders, { finance: 2, receipts: 3 })).toEqual({
      root: 5, owner: 5, shipment: 5, finance: 5, receipts: 3,
    });
  });
  it('returns finite counts when data contains a cycle', () => {
    const folders = [
      { id: 'a', parent_id: 'b', folder_type: 'custom' },
      { id: 'b', parent_id: 'a', folder_type: 'custom' },
    ];
    const result = getFolderSubtreeCounts(folders, { a: 1, b: 2 });
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
  });
  it('uses distinct colors and protects root business folders from copy', () => {
    expect(folderToneClass('client')).not.toBe(folderToneClass('shipment'));
    expect(folderToneClass('accounting_finance')).toContain('emerald');
    expect(isCopyableFolder({ folder_type: 'custom' })).toBe(true);
    expect(isCopyableFolder({ folder_type: 'shipment' })).toBe(false);
    expect(isCopyableFolder(null)).toBe(false);
  });
});
