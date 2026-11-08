/**
 * Creates a single portable Windows path component for the File System Access API.
 * Chromium rejects invalid Unicode, Windows device names and shell-integrated
 * extensions even when the rest of the filename contains no forbidden punctuation.
 */
export function safeWindowsFileName(value: string): string {
  const normalized = String(value ?? '').normalize('NFKC');
  let name = Array.from(normalized)
    // Keep Persian ZWNJ/ZWJ, but remove invalid/control code points and bidi overrides.
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(/[<>:"/\\|?*]/.test(character) ||
        codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
        (codePoint & 0xffff) === 0xfffe || (codePoint & 0xffff) === 0xffff ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069) || codePoint === 0xfeff);
    })
    .join('')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);

  if (!name || name === '.' || name === '..') name = 'بدون نام';

  // Prefix dot-leading components for predictable cross-platform archive paths.
  if (name.startsWith('.')) name = '_' + name;

  // Windows device names are reserved even when followed by an extension.
  const deviceBase = name.split('.')[0].replace(/[ .]+$/g, '');
  if (/^(con|prn|aux|nul|clock\$|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(deviceBase)) {
    name = '_' + name;
  }

  // Chromium blocks shell-integrated extensions through File System Access.
  if (/\.(lnk|scf|url)$/i.test(name)) name += '_file';

  // A final CLSID extension is blocked by Chromium.
  name = name.replace(/\.\{([0-9a-f-]{36})\}$/i, '._clsid_$1');

  name = name.replace(/[. ]+$/g, '');
  return name && name !== '.' && name !== '..' ? name : 'بدون نام';
}
