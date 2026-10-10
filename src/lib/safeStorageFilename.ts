/**
 * Produces a storage object key segment that is ASCII-only.
 *
 * Storage paths should not contain raw Unicode filenames: the original filename
 * remains in document metadata for display, while this value is only for the
 * storage object key.
 */
export const safeStorageFilename = (filename: string): string => {
  const leaf = filename.split(/[\\/]/).pop() || '';
  const lastDot = leaf.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < leaf.length - 1;
  const rawBase = hasExtension ? leaf.slice(0, lastDot) : leaf;
  const rawExtension = hasExtension ? leaf.slice(lastDot + 1) : '';

  const base =
    rawBase
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '')
      .slice(0, 80) || 'document';
  const extension = rawExtension.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase();

  return extension ? `${base}.${extension}` : base;
};
