import { describe, expect, it } from 'vitest';
import {
  classifyDocument,
  decodeHtmlEntities,
  htmlText,
  parseCircularRssItems,
  parseCircularTelegramPosts,
  relevantCustomsContent,
  safeCircularArticleUrl,
  safeCircularPdfUrl,
  safeFilename,
  toLatinDigits,
} from './customs-circular-parser';

describe('Customs circular source parser', () => {
  it('decodes RSS entities and CDATA text safely', () => {
    expect(decodeHtmlEntities('<![CDATA[بخشنامه &amp; ترخیص]]>')).toBe('بخشنامه & ترخیص');
    expect(htmlText('<p>بخشنامه&nbsp;شماره ۱۲۳</p><script>alert(1)</script>'))
      .toBe('بخشنامه شماره ۱۲۳');
  });

  it('parses only RSS items with both title and link', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[بخشنامه جدید ترخیص کالا]]></title>
          <link>https://www.iranimpex.com/circular/123</link>
          <guid>rss-123</guid>
          <pubDate>Mon, 24 Nov 2026 08:00:00 GMT</pubDate>
          <description><![CDATA[واردات و ثبت سفارش]]></description>
        </item>
        <item><title>بدون لینک</title></item>
        <item><link>https://www.iranimpex.com/circular/456</link></item>
      </channel></rss>`;
    const items = parseCircularRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'بخشنامه جدید ترخیص کالا',
      url: 'https://www.iranimpex.com/circular/123',
      guid: 'rss-123',
      description: 'واردات و ثبت سفارش',
    });
  });

  it('parses Telegram public preview posts and deduplicates message IDs', () => {
    const html = `<div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="gomrok_news/123">
        <div class="tgme_widget_message_text">بخشنامه گمرکی شماره ۱۲۳<br>ترخیص کالا و واردات</div>
        <a class="tgme_widget_message_document_wrap" href="https://t.me/files/123.pdf">
          <div class="tgme_widget_message_document_title">بخشنامه-۱۲۳.pdf</div>
        </a>
        <time datetime="2026-11-23T12:00:00+00:00"></time>
      </div>
    </div>
    <div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="gomrok_news/123">
        <div class="tgme_widget_message_text">تکرار همان پیام</div>
      </div>
    </div>
    <div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="gomrok_news/124">
        <div class="tgme_widget_message_text">اطلاعیه مرتبط با گمرک</div>
      </div>
    </div>`;
    const posts = parseCircularTelegramPosts(html);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      id: '123',
      url: 'https://t.me/Gomrok_news/123',
      pdfUrl: 'https://t.me/files/123.pdf',
      attachmentName: 'بخشنامه-۱۲۳.pdf',
    });
  });

  it('classifies customs circulars, authority, subject areas, and Persian source numbers', () => {
    const result = classifyDocument(
      'بخشنامه شماره ۱۲۳/۱۴۰۵ صادره از گمرک جمهوری اسلامی ایران درباره واردات، ترخیص، قبض انبار و ثبت سفارش',
    );
    expect(result).toMatchObject({
      document_type: 'circular',
      authority_key: 'customs',
      authority_label: 'گمرک جمهوری اسلامی ایران',
      source_number: '123/1405',
    });
    expect(result.subject_area_keys).toContain('import');
    expect(result.subject_area_keys).toContain('customs_clearance');
    expect(result.subject_area_keys).toContain('order_registration');
  });

  it('normalizes Persian and Arabic digits and recognizes customs-related posts', () => {
    expect(toLatinDigits('۱۲۳٤٥')).toBe('12345');
    expect(relevantCustomsContent('اطلاعیه در خصوص اظهارنامه گمرکی')).toBe(true);
    expect(relevantCustomsContent('خبر ورزشی عمومی')).toBe(false);
    expect(safeFilename('../بخشنامه/شماره ۱۲۳.pdf')).not.toContain('/');
  });

  it('allows only HTTPS IranImpex circular article URLs', () => {
    expect(safeCircularArticleUrl('https://www.iranimpex.com/circular/123'))
      .toBe('https://www.iranimpex.com/circular/123');
    expect(() => safeCircularArticleUrl('http://www.iranimpex.com/circular/123')).toThrow('ARTICLE_URL_NOT_ALLOWED');
    expect(() => safeCircularArticleUrl('https://example.com/circular/123')).toThrow('ARTICLE_URL_NOT_ALLOWED');
    expect(() => safeCircularArticleUrl('https://www.iranimpex.com/account/123')).toThrow('ARTICLE_URL_NOT_ALLOWED');
  });

  it('allows PDF downloads only from the explicit trusted source hosts', () => {
    expect(safeCircularPdfUrl('https://dl.iranimpex.com/files/123.pdf')).toBe('https://dl.iranimpex.com/files/123.pdf');
    expect(safeCircularPdfUrl('https://irica.ir/docs/123.pdf')).toBe('https://irica.ir/docs/123.pdf');
    expect(() => safeCircularPdfUrl('https://attacker.example/123.pdf')).toThrow('PDF_URL_NOT_ALLOWED');
    expect(() => safeCircularPdfUrl('http://t.me/files/123.pdf')).toThrow('PDF_URL_NOT_ALLOWED');
    expect(() => safeCircularPdfUrl('https://t.me/files/123.txt')).toThrow('PDF_URL_NOT_ALLOWED');
  });
});
