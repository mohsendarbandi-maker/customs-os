import { describe, expect, it, vi } from 'vitest';
import { handleCircularSourcePreview } from './customs-circular-preview-api';

const rss = '<rss><channel>' +
  '<item><title><![CDATA[بخشنامه گمرکی درباره واردات و ترخیص]]></title>' +
  '<link>https://www.iranimpex.com/circular/123</link><guid>circular-123</guid>' +
  '<pubDate>Mon, 24 Nov 2026 08:00:00 GMT</pubDate>' +
  '<description><![CDATA[ثبت سفارش و قبض انبار]]></description></item>' +
  '<item><title>خبر غیرمرتبط</title><link>https://www.iranimpex.com/circular/124</link>' +
  '<description>خبر عمومی</description></item>' +
  '<item><title>لینک خارجی</title><link>https://attacker.example/circular/evil</link>' +
  '<description>بخشنامه گمرکی</description></item>' +
  '</channel></rss>';

const telegram = '<div class="tgme_widget_message_wrap">' +
  '<div class="tgme_widget_message" data-post="gomrok_news/500">' +
  '<div class="tgme_widget_message_text">بخشنامه گمرکی درباره ترخیص کالا و واردات</div>' +
  '<a class="tgme_widget_message_document_wrap" href="https://t.me/files/500.pdf">' +
  '<div class="tgme_widget_message_document_title">circular-500.pdf</div></a>' +
  '<time datetime="2026-11-24T08:00:00Z"></time></div></div>';

const request = () => new Request(
  'https://staging.example/api/knowledge/circular-preview',
  { method: 'GET' },
);

describe('Read-only customs circular source preview', () => {
  it('parses relevant RSS and Telegram items without downloading binaries or writing data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url.includes('iranimpex.com') ? rss : telegram, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    });

    const response = await handleCircularSourcePreview(request(), fetchMock);
    const payload = await response.json() as {
      ok: boolean;
      previewOnly: boolean;
      writesPerformed: number;
      binaryDownloadsPerformed: number;
      sources: {
        rss: { ok: boolean; count: number; items: Array<{ classification: { document_type: string } }> };
        telegram: { ok: boolean; count: number; items: Array<{ pdfUrl: string | null }> };
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(payload).toMatchObject({
      ok: true,
      previewOnly: true,
      writesPerformed: 0,
      binaryDownloadsPerformed: 0,
    });
    expect(payload.sources.rss).toMatchObject({ ok: true, count: 1 });
    expect(payload.sources.rss.items[0].classification.document_type).toBe('circular');
    expect(payload.sources.telegram).toMatchObject({ ok: true, count: 1 });
    expect(payload.sources.telegram.items[0].pdfUrl).toBe('https://t.me/files/500.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a partial preview when one source is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('t.me')) return new Response('blocked', { status: 503 });
      return new Response(rss, { status: 200 });
    });

    const response = await handleCircularSourcePreview(request(), fetchMock);
    const payload = await response.json() as {
      ok: boolean;
      partial: boolean;
      warnings: string[];
      sources: { rss: { ok: boolean }; telegram: { ok: boolean } };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.partial).toBe(true);
    expect(payload.sources.rss.ok).toBe(true);
    expect(payload.sources.telegram.ok).toBe(false);
    expect(payload.warnings.some((warning) => warning.startsWith('telegram:'))).toBe(true);
  });

  it('returns 503 when both sources fail', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const response = await handleCircularSourcePreview(request(), fetchMock);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'CIRCULAR_SOURCES_UNAVAILABLE',
      writesPerformed: 0,
    });
  });

  it('rejects unsupported methods before contacting sources', async () => {
    const fetchMock = vi.fn();
    const req = new Request('https://staging.example/api/knowledge/circular-preview', { method: 'POST' });
    const response = await handleCircularSourcePreview(req, fetchMock);

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized source payloads', async () => {
    const huge = 'x'.repeat(6 * 1024 * 1024 + 1);
    const fetchMock = vi.fn(async () => new Response(huge, { status: 200 }));
    const response = await handleCircularSourcePreview(request(), fetchMock);
    const payload = await response.json() as { ok: boolean; warnings: string[] };

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.warnings).toHaveLength(2);
  });
});
