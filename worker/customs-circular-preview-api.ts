import {
  classifyDocument,
  parseCircularRssItems,
  parseCircularTelegramPosts,
  relevantCustomsContent,
  safeCircularArticleUrl,
  safeCircularPdfUrl,
} from './customs-circular-parser';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const RSS_URL = 'https://iranimpex.com/circular/feed/';
const TELEGRAM_PREVIEW_URL = 'https://t.me/s/Gomrok_news';
const RSS_MAX_BYTES = 5 * 1024 * 1024;
const TELEGRAM_MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
  },
});

const fetchBoundedText = async (
  url: string,
  maxBytes: number,
  fetchImpl: FetchLike,
): Promise<string> => {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9',
      'user-agent': 'Customs OS Circular Preview/1.0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error('UPSTREAM_HTTP_' + response.status);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('UPSTREAM_TOO_LARGE');

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new Error('UPSTREAM_TOO_LARGE');
  }
  return body;
};

const failureCode = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 120) : 'UPSTREAM_UNAVAILABLE';

export const handleCircularSourcePreview = async (
  request: Request,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const [rssResult, telegramResult] = await Promise.allSettled([
    fetchBoundedText(RSS_URL, RSS_MAX_BYTES, fetchImpl),
    fetchBoundedText(TELEGRAM_PREVIEW_URL, TELEGRAM_MAX_BYTES, fetchImpl),
  ]);

  const warnings: string[] = [];
  if (rssResult.status === 'rejected') warnings.push('rss:' + failureCode(rssResult.reason));
  if (telegramResult.status === 'rejected') warnings.push('telegram:' + failureCode(telegramResult.reason));

  if (rssResult.status === 'rejected' && telegramResult.status === 'rejected') {
    return json({
      ok: false,
      error: 'CIRCULAR_SOURCES_UNAVAILABLE',
      warnings,
      writesPerformed: 0,
    }, 503);
  }

  const rssItems = rssResult.status === 'fulfilled'
    ? parseCircularRssItems(rssResult.value)
      .slice(0, 4)
      .flatMap((item) => {
        try {
          const url = safeCircularArticleUrl(item.url);
          const text = [item.title, item.description].filter(Boolean).join('\n');
          if (!relevantCustomsContent(text)) return [];
          return [{
            title: item.title.slice(0, 300),
            url,
            pubDate: item.pubDate,
            guid: item.guid.slice(0, 180),
            description: item.description.slice(0, 2_000),
            classification: classifyDocument(text),
          }];
        } catch {
          return [];
        }
      })
    : [];

  const telegramPosts = telegramResult.status === 'fulfilled'
    ? parseCircularTelegramPosts(telegramResult.value)
      .slice(0, 8)
      .flatMap((post) => {
        const sourceText = [post.title, post.text, post.attachmentName].filter(Boolean).join('\n');
        if (!relevantCustomsContent(sourceText)) return [];
        let pdfUrl: string | null = null;
        if (post.pdfUrl) {
          try {
            pdfUrl = safeCircularPdfUrl(post.pdfUrl);
          } catch {
            pdfUrl = null;
          }
        }
        return [{
          id: post.id,
          title: post.title,
          text: post.text.slice(0, 2_000),
          url: post.url,
          date: post.date,
          pdfUrl,
          attachmentName: post.attachmentName,
          classification: classifyDocument(sourceText),
        }];
      })
    : [];

  return json({
    ok: true,
    partial: warnings.length > 0,
    sources: {
      rss: {
        ok: rssResult.status === 'fulfilled',
        count: rssItems.length,
        items: rssItems,
      },
      telegram: {
        ok: telegramResult.status === 'fulfilled',
        count: telegramPosts.length,
        items: telegramPosts,
      },
    },
    warnings,
    generatedAt: new Date().toISOString(),
    previewOnly: true,
    writesPerformed: 0,
    binaryDownloadsPerformed: 0,
  });
};
