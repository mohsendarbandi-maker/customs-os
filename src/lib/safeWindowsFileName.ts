/**
 * Creates a single portable Windows path component for the File System Access API.
 * Chromium rejects Windows device names and shell-integrated extensions even when
 * the rest of the filename contains no forbidden punctuation.
 */
export function safeWindowsFileName(value: string): string {
  const normalized = String(value ?? '').normalize('NFKC');
  let name = normalized
    // eslint-disable-next-line no-control-regex -- Windows forbids C0/C1 control characters in path components.
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);

  if (!name || name === '.' || name === '..') name = 'بدون نام';

  // Windows treats device names as reserved even when followed by an extension.
  const deviceBase = name.split('.')[0].replace(/[ .]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(deviceBase)) {
    name = '_' + name;
  }

  // Chromium blocks these shell-integrated extensions through File System Access.
  if (/\.(lnk|scf|url)$/i.test(name)) {
    name += '_file';
  }

  // A final CLSID extension is blocked by Chromium even though braces are legal in Windows names.
  name = name.replace(/\.\{([0-9a-f-]{36})\}$/i, '._clsid_$1');

  // Guard the final component after every transformation.
  name = name.replace(/[. ]+$/g, '');
  return name && name !== '.' && name !== '..' ? name : 'بدون نام';
}
