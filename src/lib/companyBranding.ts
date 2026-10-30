export type CompanyLogoStyle = 'monogram' | 'shield' | 'minimal';

export const normalizeBrandColor = (value?: string | null): string =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '#173B57';

export const deriveCompanyLogoMark = (companyName?: string | null): string => {
  const words = (companyName || '').trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return 'ش';
  const characters = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0] || '')
    : Array.from(words[0]).slice(0, 2);
  return characters.join('').slice(0, 3);
};

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;').replace(/'/g, '&apos;');

export const buildCompanyLogoSvg = (options: {
  companyName: string; mark?: string | null; color?: string | null; style?: CompanyLogoStyle | string | null;
}): string => {
  const color = normalizeBrandColor(options.color);
  const mark = escapeXml((options.mark || deriveCompanyLogoMark(options.companyName)).slice(0, 3));
  const title = escapeXml(options.companyName || 'نشان شرکت');
  const shape = options.style === 'shield'
    ? '<path d="M120 24 L204 56 V118 C204 176 166 214 120 236 C74 214 36 176 36 118 V56 Z" fill="' + color + '"/>'
    : options.style === 'minimal'
      ? '<circle cx="120" cy="120" r="90" fill="none" stroke="' + color + '" stroke-width="16"/>'
      : '<rect x="30" y="30" width="180" height="180" rx="34" fill="' + color + '"/>';
  const textColor = options.style === 'minimal' ? color : '#FFFFFF';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="' + title + '"><title>' + title + '</title>' + shape + '<text x="120" y="137" text-anchor="middle" dominant-baseline="middle" fill="' + textColor + '" font-family="Tahoma,Arial,sans-serif" font-size="76" font-weight="700">' + mark + '</text></svg>';
};

export const buildCompanyStampSvg = (options: {
  companyName: string; registrationNumber?: string | null; color?: string | null;
}): string => {
  const color = normalizeBrandColor(options.color);
  const name = escapeXml(options.companyName || 'نام شرکت');
  const registration = escapeXml(options.registrationNumber || 'ثبت نشده');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 260" role="img" aria-label="مهر ' + name + '"><rect x="8" y="8" width="664" height="244" rx="8" fill="none" stroke="' + color + '" stroke-width="12"/><rect x="24" y="24" width="632" height="212" rx="3" fill="none" stroke="' + color + '" stroke-width="2"/><text x="340" y="104" text-anchor="middle" fill="' + color + '" font-family="Tahoma,Arial,sans-serif" font-size="36" font-weight="700">' + name + '</text><path d="M92 132 H588" stroke="' + color + '" stroke-width="2"/><text x="340" y="190" text-anchor="middle" fill="' + color + '" font-family="Tahoma,Arial,sans-serif" font-size="27">شماره ثبت: ' + registration + '</text></svg>';
};