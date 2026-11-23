export interface CircularClassification {
  document_type: 'law' | 'circular' | 'instruction' | 'notice' | 'tariff' | 'ruling' | 'other';
  document_type_label: string;
  authority_key: string;
  authority_label: string;
  authority_unit: string | null;
  office_hint: string | null;
  subject_area_keys: string[];
  subject_area_label: string;
  source_number: string | null;
}

export interface CircularRssItem {
  title: string;
  url: string;
  pubDate: string;
  guid: string;
  description: string;
}

export interface CircularTelegramPost {
  id: string;
  title: string;
  text: string;
  url: string;
  date: string;
  pdfUrl: string | null;
  attachmentName: string | null;
}

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

export const decodeHtmlEntities = (value: string): string => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
    const point = Number.parseInt(hex, 16);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&#(\d+);/g, (_match, decimal: string) => {
    const point = Number.parseInt(decimal, 10);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

export const htmlText = (value: string): string => clean(decodeHtmlEntities(value
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')));

const tagValue = (block: string, tag: string): string => {
  const pattern = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
  const match = block.match(pattern);
  return match ? clean(decodeHtmlEntities(match[1]).replace(/<[^>]+>/g, ' ')) : '';
};

export const toLatinDigits = (value: string): string => value
  .replace(/[۰-۹]/g, (character) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(character)))
  .replace(/[٠-٩]/g, (character) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(character)));

export const safeFilename = (value: string): string => {
  const raw = value.normalize('NFKC')
    .replace(/[\\/\r\n\u0000-\u001f]/g, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  return (raw || 'customs-circular.pdf').slice(-170);
};

export const classifyDocument = (text: string): CircularClassification => {
  const normalized = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  let type: CircularClassification['document_type'] = 'other';
  if (/قانون|مصوبه|تصویب\s*نامه|تصویبنامه/i.test(normalized)) type = 'law';
  else if (/بخشنامه/i.test(normalized)) type = 'circular';
  else if (/دستورالعمل|شیوه\s*نامه|شیوه‌نامه|ضوابط\s*اجرایی/i.test(normalized)) type = 'instruction';
  else if (/اطلاعیه|اخطاریه/i.test(normalized)) type = 'notice';
  else if (/تعرفه|حقوق\s*ورودی|ردیف\s*تعرفه/i.test(normalized)) type = 'tariff';
  else if (/رأی|رای|نظر\s*کمیسیون|نظریه/i.test(normalized)) type = 'ruling';

  const authorities = [
    { pattern: /گمرک\s*(?:جمهوری\s*اسلامی\s*ایران|ایران)|رئیس\s*کل\s*گمرک|معاونت\s*امور\s*گمرکی/i, key: 'customs', label: 'گمرک جمهوری اسلامی ایران' },
    { pattern: /وزارت\s*صنعت|وزارت\s*صمت|وزیر\s*صمت/i, key: 'mimt', label: 'وزارت صنعت، معدن و تجارت' },
    { pattern: /سازمان\s*توسعه\s*تجارت/i, key: 'trade_development', label: 'سازمان توسعه تجارت ایران' },
    { pattern: /بانک\s*مرکزی/i, key: 'central_bank', label: 'بانک مرکزی جمهوری اسلامی ایران' },
    { pattern: /وزارت\s*جهاد\s*کشاورزی|جهاد\s*کشاورزی/i, key: 'agriculture', label: 'وزارت جهاد کشاورزی' },
    { pattern: /هیئت\s*وزیران|هیات\s*وزیران|معاون\s*اول\s*رئیس\s*جمهور/i, key: 'cabinet', label: 'هیئت وزیران / معاونت ریاست جمهوری' },
    { pattern: /سازمان\s*بنادر|بنادر\s*و\s*دریانوردی/i, key: 'ports', label: 'سازمان بنادر و دریانوردی' },
    { pattern: /سازمان\s*ملی\s*استاندارد/i, key: 'standards', label: 'سازمان ملی استاندارد ایران' },
    { pattern: /سازمان\s*غذا\s*و\s*دارو/i, key: 'food_drug', label: 'سازمان غذا و دارو' },
    { pattern: /سازمان\s*دامپزشکی/i, key: 'veterinary', label: 'سازمان دامپزشکی کشور' },
  ];
  const authority = authorities.find((candidate) => candidate.pattern.test(normalized))
    || { key: 'unknown', label: 'در متن پیام مشخص نشده' };

  const areas = [
    { key: 'import', label: 'واردات', pattern: /واردات|ورود\s*قطعی|ثبت\s*سفارش/i },
    { key: 'export', label: 'صادرات', pattern: /صادرات|صدور\s*قطعی|پروانه\s*صادراتی/i },
    { key: 'transit', label: 'ترانزیت و حمل', pattern: /ترانزیت|حمل\s*یکسره|عبور\s*مرزی/i },
    { key: 'customs_clearance', label: 'ترخیص و تشریفات گمرکی', pattern: /ترخیص|اظهارنامه|قبض\s*انبار|کوتاژ/i },
    { key: 'tariff_valuation', label: 'تعرفه و ارزش', pattern: /تعرفه|ارزش\s*گمرکی|حقوق\s*ورودی|طبقه\s*بندی/i },
    { key: 'foreign_exchange', label: 'ارز و تعهدات ارزی', pattern: /ارز|تخصیص|تأمین\s*ارز|تعهد\s*ارزی|رفع\s*تعهد/i },
    { key: 'order_registration', label: 'ثبت سفارش و سامانه جامع تجارت', pattern: /ثبت\s*سفارش|سامانه\s*جامع\s*تجارت|nts[wW]/i },
    { key: 'permits', label: 'مجوزها و کنترل‌های سیستمی', pattern: /مجوز|تأیید\s*سیستمی|تایید\s*سیستمی|استاندارد|قرنطینه/i },
    { key: 'customs_offices', label: 'گمرکات اجرایی و مرزی', pattern: /گمرکات\s*اجرایی|گمرک\s*(?:تهران|انزلی|بندر|شهید\s*رجایی|امام|آستارا|آبادان|بوشهر|تبریز|مشهد|ارومیه|ساری|نوشهر|پرویزخان|مهران|دوغارون|سرخس|بازرگان)/i },
  ];
  const matchedAreas = areas.filter((area) => area.pattern.test(normalized));
  const sourceNumber = normalized.match(
    /(?:شماره(?:\s|‌)*(?:بخشنامه|نامه|ابلاغیه)?\s*[:：]?\s*)([0-9۰-۹]{2,}(?:[\/.\-][0-9۰-۹A-Za-z]+){1,6})/i,
  )?.[1] || null;
  const office = normalized.match(/(?:مدیر|مدیرکل|ناظر)\s+(?:گمرک\s+)?([آ-ی]{2,}(?:\s+[آ-ی]{2,}){0,2})/);
  const authorityUnit = normalized.match(/(?:دفتر|معاونت|اداره\s*کل)\s+([آ-ی\s]{3,60})(?:\s+گمرک|\s+وزارت|\s+سازمان|،|,|\.)/);

  const labels: Record<CircularClassification['document_type'], string> = {
    law: 'قانون / مصوبه',
    circular: 'بخشنامه',
    instruction: 'دستورالعمل / شیوه‌نامه',
    notice: 'اطلاعیه',
    tariff: 'تعرفه',
    ruling: 'رأی / نظریه',
    other: 'خبر / سند متفرقه',
  };

  return {
    document_type: type,
    document_type_label: labels[type],
    authority_key: authority.key,
    authority_label: authority.label,
    authority_unit: clean(authorityUnit?.[1]) || null,
    office_hint: clean(office?.[1]) || null,
    subject_area_keys: matchedAreas.map((area) => area.key),
    subject_area_label: matchedAreas.map((area) => area.label).join('، ') || 'سایر امور تجارت خارجی',
    source_number: sourceNumber ? toLatinDigits(sourceNumber) : null,
  };
};

export const relevantCustomsContent = (text: string): boolean =>
  /گمرک|بخشنامه|ترخیص|اظهارنامه|قبض\s*انبار|تعرفه|واردات|صادرات|ثبت\s*سفارش|ترانزیت|تخصیص\s*ارز|تعهد\s*ارزی|وزارت\s*صمت|سازمان\s*توسعه\s*تجارت|بانک\s*مرکزی|پنجره\s*واحد|epl|ntsw/i.test(text);

export const parseCircularRssItems = (xml: string): CircularRssItem[] => {
  const items: CircularRssItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const item = {
      title: tagValue(block, 'title'),
      url: tagValue(block, 'link'),
      pubDate: tagValue(block, 'pubDate'),
      guid: tagValue(block, 'guid'),
      description: tagValue(block, 'description'),
    };
    if (item.title && item.url) items.push(item);
  }
  return items;
};

export const parseCircularTelegramPosts = (html: string): CircularTelegramPost[] => {
  const marks = [...html.matchAll(/data-post=["']gomrok_news\/(\d+)["']/gi)];
  const posts: CircularTelegramPost[] = [];

  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    const wrapperStart = html.lastIndexOf('tgme_widget_message_wrap', mark.index);
    const start = wrapperStart >= 0 ? Math.max(0, html.lastIndexOf('<div', wrapperStart)) : mark.index;
    let end = index + 1 < marks.length
      ? html.lastIndexOf('tgme_widget_message_wrap', marks[index + 1].index)
      : html.length;
    if (end <= start) end = index + 1 < marks.length ? marks[index + 1].index : html.length;

    const block = html.slice(start, end);
    const textMatch = block.match(
      /<div\b[^>]*class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const text = textMatch ? htmlText(textMatch[1]).slice(0, 20_000) : '';
    const links: string[] = [];
    let attachmentName: string | null = null;

    for (const anchor of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attributes = anchor[1];
      const inner = anchor[2];
      const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (href) links.push(decodeHtmlEntities(href));
      if (/tgme_widget_message_document_wrap/i.test(attributes)) {
        const name = inner.match(/tgme_widget_message_document_title[^>]*>([\s\S]*?)<\//i);
        attachmentName = name ? htmlText(name[1]) : (htmlText(inner).slice(0, 180) || null);
      }
    }

    const pdfUrl = links.find((link) => /\.pdf(?:[?#]|$)/i.test(link)) || null;
    const title = (
      text.split('\n').map(clean).find((line) => line.length > 12)
      || attachmentName
      || 'پیام گمرکی کانال'
    ).slice(0, 300);
    const date = block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || '';
    const id = mark[1];
    if (!text && !attachmentName && !pdfUrl) continue;

    posts.push({
      id,
      title,
      text,
      url: 'https://t.me/Gomrok_news/' + id,
      date,
      pdfUrl,
      attachmentName,
    });
  }

  const seen = new Set<string>();
  return posts.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
};

export const safeCircularArticleUrl = (value: string): string => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['iranimpex.com', 'www.iranimpex.com'].includes(url.hostname) ||
    !url.pathname.startsWith('/circular/')
  ) throw new Error('ARTICLE_URL_NOT_ALLOWED');
  return url.toString();
};

export const safeCircularPdfUrl = (value: string): string => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const permitted =
    host === 't.me' ||
    host === 'telesco.pe' ||
    host.endsWith('.telesco.pe') ||
    host === 'telegram.org' ||
    host.endsWith('.telegram.org') ||
    host === 'iranimpex.com' ||
    host === 'dl.iranimpex.com' ||
    host === 'gov.ir' ||
    host.endsWith('.gov.ir') ||
    host === 'irica.ir' ||
    host.endsWith('.irica.ir');

  if (url.protocol !== 'https:' || !permitted || !/\.pdf(?:[?#]|$)/i.test(url.href)) {
    throw new Error('PDF_URL_NOT_ALLOWED');
  }
  return url.toString();
};
