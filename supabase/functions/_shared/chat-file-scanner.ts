export type ChatFileScanResult = {
  clean: boolean;
  magic: string;
  extension: string;
  mime: string;
  reasons: string[];
};

const blockedExtensions = new Set([
  "exe","dll","com","scr","msi","msix","apk","ipa","jar","class","wasm",
  "js","mjs","cjs","ts","tsx","jsx","php","phtml","asp","aspx","jsp","jspx",
  "cgi","pl","py","rb","sh","bash","bat","cmd","ps1","vbs","vbe","wsf","hta",
  "html","htm","svg",
]);
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const u16 = (bytes: Uint8Array, offset: number) =>
  offset >= 0 && offset + 2 <= bytes.length
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
    : 0;
const u32 = (bytes: Uint8Array, offset: number) =>
  offset >= 0 && offset + 4 <= bytes.length
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
    : 0;

function detectMagic(bytes: Uint8Array): string {
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "exe";
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "elf";
  if (latin1(bytes.slice(0, 5)) === "%PDF-") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return "unknown";
}

/**
 * Static, bounded-content checks used by chat attachments. This is not a
 * commercial antivirus engine; it rejects dangerous formats and common active
 * content before a file becomes available to other conversation members.
 */
export function scanChatFile(bytes: Uint8Array, name: string, mime: string): ChatFileScanResult {
  const reasons: string[] = [];
  const extension = (name.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] ?? "");
  const magic = detectMagic(bytes);
  if (bytes.length === 0) reasons.push("empty");
  if (bytes.length > 50 * 1024 * 1024) reasons.push("size");
  if (blockedExtensions.has(extension) || magic === "exe" || magic === "elf") reasons.push("executable");

  if (magic === "pdf") {
    const header = latin1(bytes.slice(0, 2 * 1024 * 1024));
    for (const marker of ["/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile"]) {
      if (header.includes(marker)) reasons.push("pdf_active:" + marker);
    }
  }

  if (magic === "zip") {
    const end = Math.max(0, bytes.length - 65557);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= end; i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) reasons.push("invalid_zip");
    else {
      const entries = u16(bytes, eocd + 10);
      const centralSize = u32(bytes, eocd + 12);
      const centralOffset = u32(bytes, eocd + 16);
      if (entries > 100 || centralOffset + centralSize > bytes.length) reasons.push("archive_limit");
      else {
        let cursor = centralOffset;
        let expandedBytes = 0;
        for (let i = 0; i < entries; i++) {
          if (u32(bytes, cursor) !== 0x02014b50) { reasons.push("invalid_entry"); break; }
          const flags = u16(bytes, cursor + 8);
          const expanded = u32(bytes, cursor + 24);
          const nameLength = u16(bytes, cursor + 28);
          const extraLength = u16(bytes, cursor + 30);
          const commentLength = u16(bytes, cursor + 32);
          const entryName = latin1(bytes.slice(cursor + 46, cursor + 46 + nameLength));
          if (flags & 1) reasons.push("encrypted");
          if (entryName.includes("..") || entryName.startsWith("/") || entryName.includes("\\") || entryName.includes(":")) {
            reasons.push("path_traversal");
          }
          if (/vbaProject\.bin$/i.test(entryName)) reasons.push("office_macro");
          expandedBytes += expanded;
          if (expandedBytes > 250 * 1024 * 1024) reasons.push("decompression_limit");
          cursor += 46 + nameLength + extraLength + commentLength;
        }
      }
    }
  }

  if (["docm", "xlsm", "pptm", "xlam", "xltm", "potm"].includes(extension)) reasons.push("office_macro");
  return { clean: reasons.length === 0, magic, extension, mime, reasons };
}
