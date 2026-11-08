import { strToU8, unzipSync, zipSync } from 'fflate';
import { safeWindowsFileName } from './safeWindowsFileName';
import { isManagedSyncMetadataFile } from './fileManagerSync';

export const PORTABLE_SYNC_ROOT_NAME = 'Darbandi Commercial';

export type PortableSyncArchiveEntry = {
  path: string;
  data: Uint8Array;
};

export type PortableSyncImportedFile = {
  relativePath: string;
  name: string;
  data: Uint8Array;
};

export function createPortableSyncArchive(
  entries: PortableSyncArchiveEntry[],
  snapshot: unknown,
): Uint8Array {
  const archive: Record<string, Uint8Array> = {};
  const manifestPath = PORTABLE_SYNC_ROOT_NAME + '/اطلاعات_کامل_سازمان.json';
  archive[manifestPath] = strToU8(JSON.stringify(snapshot, null, 2));

  for (const entry of entries) {
    const segments = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
      throw new Error('مسیر یکی از فایل‌های بسته پشتیبان معتبر نیست.');
    }
    const safePath = segments.map(safeWindowsFileName).join('/');
    if (archive[safePath]) {
      throw new Error('دو فایل با مسیر یکسان در بسته پشتیبان وجود دارد: ' + safePath);
    }
    archive[safePath] = entry.data;
  }

  return zipSync(archive, { level: 1 });
}

/**
 * Extracts user documents from an exported ZIP. Organization JSON and generated
 * companion text files are intentionally excluded so they are never re-uploaded
 * as if they were original business documents.
 */
export function readPortableSyncArchive(
  bytes: Uint8Array,
  ownerRootName: string,
): PortableSyncImportedFile[] {
  const archive = unzipSync(bytes);
  const result: PortableSyncImportedFile[] = [];

  for (const [archivePath, data] of Object.entries(archive)) {
    if (archivePath.endsWith('/')) continue;
    const segments = archivePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) continue;

    if (segments[0].toLocaleLowerCase() === PORTABLE_SYNC_ROOT_NAME.toLocaleLowerCase()) {
      segments.shift();
    }
    if (segments[0]?.toLocaleLowerCase() === ownerRootName.toLocaleLowerCase()) {
      segments.shift();
    }
    if (!segments.length) continue;

    const safeSegments = segments.map(safeWindowsFileName);
    const name = safeSegments[safeSegments.length - 1];
    const lowerName = name.toLocaleLowerCase();
    if (
      lowerName === 'desktop.ini' ||
      lowerName === 'thumbs.db' ||
      lowerName === '.ds_store' ||
      lowerName.startsWith('~$') ||
      segments.some((segment) => segment === '__MACOSX') ||
      isManagedSyncMetadataFile(name)
    ) {
      continue;
    }

    result.push({
      relativePath: safeSegments.join('/'),
      name,
      data,
    });
  }

  return result;
}
