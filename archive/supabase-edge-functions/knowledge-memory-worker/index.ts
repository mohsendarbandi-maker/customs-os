import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const EXPECTED_TOKEN_SHA256 = 'a228451145959efb301e866e2908a5ea03f156a12b5b6d4872df60595f4c0f9d';
const ORG_ID = 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd';
const OCR_CHUNK_BASE = 1_000_000;
const MAX_OCR_PAGES_PER_RUN = 1;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

async function extractPage(
  pdf: PDFDocument,
  pageNumber: number,
  filename: string,
  apiKeys: string[],
  workerToken: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ page_text: string; page_kind: string; confidence: number; notes: string; model: string }> {
  if (pageNumber < 1 || pageNumber > pdf.getPageCount()) {
    throw new Error('Page index outside source PDF: ' + pageNumber);
  }
  const single = await PDFDocument.create();
  const copied = await single.copyPages(pdf, [pageNumber - 1]);
  copied.forEach(page => single.addPage(page));
  const base64 = bytesToBase64(await single.save());

  const schema = {
    type: 'object',
    properties: {
      page_text: { type: 'string', description: 'متن کامل و وفادار همین صفحه، نه خلاصه' },
      page_kind: { type: 'string', enum: ['text', 'table', 'form', 'image', 'cover', 'divider', 'blank', 'unknown'] },
      confidence: { type: 'number' },
      notes: { type: 'string' },
    },
    required: ['page_text', 'page_kind', 'confidence', 'notes'],
  };

  const prompt =
    'تو موتور بازخوانی دقیق اسناد رسمی فارسی هستی. این PDF فقط یک صفحه از سند اصلی است؛ شماره صفحه واقعی آن ' + pageNumber + ' است. ' +
    'نام فایل: ' + filename + '. تمام نوشته‌های قابل مشاهده را عیناً و کامل رونویسی کن؛ خلاصه‌سازی، بازنویسی، حذف بندها، جایگزینی متن با عبارت «متن کامل در صفحه موجود است» یا ساختن محتوا ممنوع است. ' +
    'سربرگ، پاورقی، شماره نامه، تاریخ، شماره صفحه چاپی، بندها، تبصره‌ها، شماره‌گذاری، جدول‌ها، ارقام، کدها، مهرها و توضیحات داخل تصویر را بررسی کن. ' +
    'در جدول، ترتیب سطرها و ستون‌ها را با جداکننده | حفظ کن. اعداد فارسی و لاتین را همان‌گونه که دیده می‌شوند ثبت کن. ' +
    'اگر بخشی ناخواناست، فقط همان بخش را [ناخوانا] بنویس و بقیه را حذف نکن. ' +
    'اگر صفحه واقعاً سفید است page_kind=blank؛ اگر فقط عنوان فصل/جداکننده کوتاه است page_kind=divider؛ در غیر این صورت نوع واقعی صفحه را انتخاب کن. ' +
    'برای page_text فقط متن صفحه را برگردان. هیچ محتوای صفحه‌های دیگر را اضافه نکن. اگر متن کم است، کوتاه بودن را با notes توضیح بده.';

  const failures: string[] = [];
  try {
    const baseUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
    const response = await fetch(baseUrl + '/functions/v1/ai-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'x-knowledge-worker-token': workerToken,
      },
      body: JSON.stringify({
        action: 'knowledge_ocr_page',
        page_number: pageNumber,
        filename,
        page_pdf_base64: base64,
      }),
      signal: AbortSignal.timeout(65000),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { /* fallback to Gemini below */ }
    if (response.ok && typeof data.page_text === 'string') {
      const allowedKinds = new Set(['text', 'table', 'form', 'image', 'cover', 'divider', 'blank', 'unknown']);
      const kind = allowedKinds.has(clean(data.page_kind)) ? clean(data.page_kind) : 'unknown';
      return {
        page_text: clean(data.page_text),
        page_kind: kind,
        confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
        notes: clean(data.notes),
        model: clean(data.model) || 'gpt-4.1-mini',
      };
    }
    failures.push('OpenAI OCR fallback: HTTP ' + response.status + ': ' + clean(data?.error || raw.slice(0, 700)));
  } catch (error) {
    failures.push('OpenAI OCR fallback: ' + (error instanceof Error ? error.message : String(error)));
  }

  const models = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  for (const model of models) {
    for (const apiKey of apiKeys) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 22000);
      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
          {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: base64 } }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0,
                maxOutputTokens: 8192,
              },
            }),
            signal: controller.signal,
          },
        );
        const raw = await response.text();
        let data: any = {};
        try { data = JSON.parse(raw); } catch { /* handled below */ }
        if (!response.ok) {
          failures.push(model + ' HTTP ' + response.status + ': ' + clean(data?.error?.message));
          continue;
        }
        const output = clean(data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(''));
        if (!output) {
          failures.push(model + ': empty model response');
          continue;
        }
        let parsed: any;
        try { parsed = JSON.parse(output); }
        catch { failures.push(model + ': invalid JSON'); continue; }
        const pageText = clean(parsed.page_text);
        const allowedKinds = new Set(['text', 'table', 'form', 'image', 'cover', 'divider', 'blank', 'unknown']);
        const kind = allowedKinds.has(clean(parsed.page_kind)) ? clean(parsed.page_kind) : 'unknown';
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
        return {
          page_text: pageText,
          page_kind: kind,
          confidence,
          notes: [clean(parsed.notes), ...failures].filter(Boolean).join(' | '),
          model,
        };
      } catch (error) {
        failures.push(model + ': ' + (error instanceof Error ? error.message : String(error)));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error('OCR failed: ' + failures.join(' | '));
}

async function makeEmbedding(content: string, apiKeys: string[]): Promise<number[]> {
  const failures: string[] = [];
  for (const apiKey of apiKeys) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: content.slice(0, 30000) }] },
          output_dimensionality: 1536,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const raw = await response.text();
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* handled below */ }
      const vector = data?.embedding?.values;
      if (response.ok && Array.isArray(vector) && vector.length === 1536) return vector;
      failures.push(clean(data?.error?.message) || 'Embedding HTTP ' + response.status);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error('Embedding failed: ' + failures.join(' | '));
}

async function persistPage(
  sb: any,
  source: any,
  job: any,
  result: { page_text: string; page_kind: string; confidence: number; notes: string; model: string },
  apiKeys: string[],
): Promise<{ status: string; chars: number; chunks: number; reason?: string }> {
  const pageText = clean(result.page_text);
  const chars = pageText.length;
  const shortButLegitimate = ['blank', 'divider', 'cover'].includes(result.page_kind);
  const enoughText = chars >= 500 || (chars >= 80 && (job.original_chars < 80 || chars >= Math.floor(job.original_chars * 0.8))) || (shortButLegitimate && (chars > 0 || result.page_kind === 'blank'));
  const notWorse = shortButLegitimate || job.original_chars < 80 || chars >= Math.floor(job.original_chars * 0.8);
  if (!enoughText || !notWorse) {
    const reason = !enoughText
      ? 'OCR output is too short for a content page; original vector content preserved.'
      : 'OCR output is materially shorter than the already indexed page; original vector content preserved.';
    await sb.from('knowledge_page_extractions').update({
      extracted_text: pageText,
      page_kind: result.page_kind,
      confidence: result.confidence,
      model: result.model,
      status: 'needs_review',
      last_error: reason,
      metadata: {
        notes: result.notes,
        original_chars: job.original_chars,
        ocr_chars: chars,
        quality_gate: 'short_page_or_text_loss',
      },
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    return { status: 'needs_review', chars, chunks: 0, reason };
  }

  const pieces: string[] = [];
  for (let offset = 0; offset < pageText.length; offset += 3000) {
    const piece = pageText.slice(offset, offset + 3000).trim();
    if (piece) pieces.push(piece);
  }

  const newRows: any[] = [];
  for (let start = 0; start < pieces.length; start += 4) {
    const batch = pieces.slice(start, start + 4);
    const vectors = await Promise.all(batch.map(piece => makeEmbedding(piece, apiKeys)));
    batch.forEach((piece, offset) => {
      const partIndex = start + offset;
      newRows.push({
        organization_id: source.organization_id,
        source_id: source.id,
        chunk_index: OCR_CHUNK_BASE + job.page_number * 100 + partIndex,
        content: piece,
        page_number: job.page_number,
        embedding: vectors[offset],
        metadata: {
          embedding_model: 'gemini-embedding-2',
          embedding_dimensions: 1536,
          origin: 'page_level_visual_ocr',
          ocr_model: result.model,
          ocr_confidence: result.confidence,
          page_kind: result.page_kind,
          part_index: partIndex,
        },
      });
    });
  }

  if (newRows.length) {
    const { error: upsertError } = await sb.from('knowledge_chunks').upsert(newRows, { onConflict: 'source_id,chunk_index' });
    if (upsertError) throw upsertError;
  }

  const { error: deleteOldError } = await sb.from('knowledge_chunks')
    .delete()
    .eq('source_id', source.id)
    .eq('organization_id', source.organization_id)
    .eq('page_number', job.page_number)
    .lt('chunk_index', OCR_CHUNK_BASE);
  if (deleteOldError) throw deleteOldError;

  const { error: pageSaveError } = await sb.from('knowledge_page_extractions').update({
    extracted_text: pageText,
    page_kind: result.page_kind,
    confidence: result.confidence,
    model: result.model,
    status: 'complete',
    last_error: null,
    metadata: {
      notes: result.notes,
      original_chars: job.original_chars,
      ocr_chars: chars,
      quality_gate: 'passed',
      indexed_chunks: newRows.length,
    },
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (pageSaveError) throw pageSaveError;
  return { status: 'complete', chars, chunks: newRows.length };
}


async function archiveKnowledgeSourceToTelegram(sb: any, source: any): Promise<any> {
  const base = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  if (base.telegram_archive_requested !== true) return { status: 'not_requested' };
  if (base.telegram_archive_via_gateway === true) return { status: 'delegated_to_gateway' };
  const previous = base.telegram_archive && typeof base.telegram_archive === 'object' ? base.telegram_archive : {};
  if (previous.status === 'sent') return previous;
  const now = Date.now();
  const nextAttempt = Date.parse(String(previous.next_attempt_at || ''));
  if (previous.status === 'failed' && Number.isFinite(nextAttempt) && nextAttempt > now) return previous;
  if (previous.status === 'sending') {
    const started = Date.parse(String(previous.started_at || ''));
    if (Number.isFinite(started) && now - started < 15 * 60 * 1000) return previous;
    const unknown = { ...previous, status: 'unknown', last_error: 'ارسال تلگرام شروع شده اما نتیجه قطعی نیست؛ برای جلوگیری از ارسال تکراری، تلاش خودکار متوقف شد.', checked_at: new Date().toISOString() };
    await sb.from('knowledge_sources').update({ metadata: { ...base, telegram_archive: unknown }, updated_at: new Date().toISOString() }).eq('id', source.id).eq('organization_id', source.organization_id);
    return unknown;
  }
  const setState = async (state: any) => {
    const { error } = await sb.from('knowledge_sources').update({
      metadata: { ...base, telegram_archive: state },
      updated_at: new Date().toISOString(),
    }).eq('id', source.id).eq('organization_id', source.organization_id);
    if (error) throw error;
  };
  try {
    if (!clean(source.storage_path).startsWith(String(source.organization_id) + '/')) throw new Error('مسیر فایل برای آرشیو تلگرام معتبر نیست.');
    const { data: connections, error: connectionError } = await sb.from('messenger_connections')
      .select('id,secret_ref,display_name').eq('organization_id', source.organization_id)
      .eq('platform', 'telegram').eq('enabled', true).order('created_at', { ascending: false }).limit(5);
    if (connectionError) throw connectionError;
    let selected: any = null;
    for (const connection of connections || []) {
      const { data: chats, error: chatError } = await sb.from('messenger_chats')
        .select('external_chat_id,display_name').eq('organization_id', source.organization_id)
        .eq('connection_id', connection.id).eq('purpose', 'file_archive').eq('enabled', true)
        .order('created_at', { ascending: false }).limit(1);
      if (chatError) throw chatError;
      if (chats?.[0]) { selected = { connection, chat: chats[0] }; break; }
    }
    if (!selected) throw new Error('مقصد فعال آرشیو تلگرام تنظیم نشده است.');
    const secretRef = clean(selected.connection.secret_ref);
    let botToken = '';
    if (secretRef.startsWith('vault:')) {
      const secretId = secretRef.slice(6);
      if (!/^[0-9a-f-]{36}$/i.test(secretId)) throw new Error('شناسه اعتبارنامه تلگرام معتبر نیست.');
      const { data: secrets, error: secretError } = await sb.rpc('messenger_vault_get_secrets', { p_secret_ids: [secretId] });
      if (secretError) throw secretError;
      botToken = clean((secrets || []).find((item: any) => item.secret_id === secretId)?.decrypted_secret);
    } else {
      botToken = clean(Deno.env.get(secretRef));
    }
    if (!botToken) throw new Error('اعتبارنامه ربات تلگرام در Vault در دسترس نیست.');
    await setState({ status: 'sending', started_at: new Date().toISOString(), connection_id: selected.connection.id, chat_name: clean(selected.chat.display_name) || clean(selected.connection.display_name) });
    const { data: pdf, error: downloadError } = await sb.storage.from('customs-knowledge').download(source.storage_path);
    if (downloadError || !pdf) throw downloadError || new Error('دریافت فایل اصلی برای آرشیو تلگرام ناموفق بود.');
    if (pdf.size <= 0 || pdf.size > 25 * 1024 * 1024) throw new Error('حجم فایل برای آرشیو خودکار تلگرام خارج از محدوده مجاز است.');
    const filename = clean(base.filename || source.title || 'customs-document.pdf').replace(/[\\/\r\n]/g, '_').slice(0, 180);
    const caption = [
      '📚 سند دانشنامه گمرکی Customs OS',
      clean(source.title),
      source.source_number ? 'شماره: ' + clean(source.source_number) : '',
      source.issued_at ? 'تاریخ صدور: ' + clean(source.issued_at) : '',
      source.issuer ? 'مرجع: ' + clean(source.issuer) : '',
      'شناسه سند: ' + source.id,
    ].filter(Boolean).join('\n').slice(0, 950);
    const form = new FormData();
    form.set('chat_id', String(selected.chat.external_chat_id));
    form.set('caption', caption);
    form.set('document', new File([new Uint8Array(await pdf.arrayBuffer())], filename, { type: clean(source.mime_type) || 'application/pdf' }));
    const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendDocument', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    const rawBody = await response.text();
    let result: any = {};
    try { result = JSON.parse(rawBody); } catch { /* handled below */ }
    if (!response.ok || result.ok !== true || !result.result?.message_id) {
      throw new Error(clean(result?.description) || 'Telegram sendDocument HTTP ' + response.status);
    }
    const sent = {
      status: 'sent',
      connection_id: selected.connection.id,
      chat_name: clean(selected.chat.display_name) || clean(selected.connection.display_name),
      message_id: Number(result.result.message_id),
      telegram_file_id: clean(result.result.document?.file_id),
      sent_at: new Date().toISOString(),
    };
    await setState(sent);
    return sent;
  } catch (error) {
    const failed = {
      status: 'failed',
      last_error: (error instanceof Error ? error.message : String(error)).slice(0, 800),
      attempted_at: new Date().toISOString(),
      next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    try { await setState(failed); } catch { /* Keep OCR alive if archive metadata cannot be saved. */ }
    return failed;
  }
}




async function indexTextOnlyKnowledgeSources(sb: any, apiKeys: string[]): Promise<any> {
  if (!apiKeys.length) return { status: 'skipped', reason: 'no_embedding_provider' };
  const { data: sources, error } = await sb.from('knowledge_sources')
    .select('id,organization_id,title,source_type,source_number,issued_at,issuer,subject,keywords,metadata,extracted_text,status')
    .eq('status', 'pending_review')
    .is('storage_path', null)
    .filter('metadata->>source_channel', 'eq', '@Gomrok_news')
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) throw error;
  let processed = 0, activated = 0, failed = 0, skipped = 0;
  const errors: Array<{ title: string; error: string }> = [];
  for (const source of (sources || []) as any[]) {
    const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
    if (metadata.auto_activation_policy !== 'quality_gate') { skipped++; continue; }
    const previous = metadata.text_indexing && typeof metadata.text_indexing === 'object' ? metadata.text_indexing : {};
    const retryAt = Date.parse(String(previous.next_attempt_at || ''));
    if (previous.status === 'failed' && Number.isFinite(retryAt) && retryAt > Date.now()) { skipped++; continue; }
    processed++;
    try {
      const content = clean(source.extracted_text);
      if (content.length < 120) {
        const next = { ...metadata, text_indexing: { status: 'needs_review', reason: 'متن پیام برای ایندکس خودکار کافی نیست.', checked_at: new Date().toISOString() } };
        await sb.from('knowledge_sources').update({ metadata: next, review_note: 'متن پیام کوتاه است؛ برای جلوگیری از حافظه ناقص، بازبینی انسانی لازم است.', updated_at: new Date().toISOString() })
          .eq('id', source.id).eq('organization_id', source.organization_id);
        skipped++;
        continue;
      }
      const pieces: string[] = [];
      for (let offset = 0; offset < content.length; offset += 2500) {
        const piece = content.slice(offset, offset + 2500).trim();
        if (piece) pieces.push(piece);
      }
      const { data: existing, error: existingError } = await sb.from('knowledge_chunks')
        .select('chunk_index,embedding')
        .eq('source_id', source.id).eq('organization_id', source.organization_id);
      if (existingError) throw existingError;
      const embedded = new Set((existing || []).filter((row: any) => row.embedding !== null).map((row: any) => Number(row.chunk_index)));
      const rows: any[] = [];
      for (let i = 0; i < pieces.length; i++) {
        if (embedded.has(i)) continue;
        const vector = await makeEmbedding(pieces[i], apiKeys);
        rows.push({
          organization_id: source.organization_id,
          source_id: source.id,
          chunk_index: i,
          content: pieces[i],
          page_number: null,
          embedding: vector,
          metadata: {
            embedding_model: 'gemini-embedding-2',
            embedding_dimensions: 1536,
            origin: 'telegram_public_channel_text',
            source_class: metadata.source_class || 'trusted_specialist_secondary_channel',
            legal_status: metadata.legal_status || 'secondary_channel_text_not_primary_original',
            source_message_url: metadata.source_message_url || source.source_url || null,
            classification: metadata.classification || {},
          },
        });
      }
      if (rows.length) {
        const { error: upsertError } = await sb.from('knowledge_chunks').upsert(rows, { onConflict: 'source_id,chunk_index' });
        if (upsertError) throw upsertError;
      }
      const { data: verified, error: verifyError } = await sb.from('knowledge_chunks')
        .select('chunk_index,embedding')
        .eq('source_id', source.id).eq('organization_id', source.organization_id);
      if (verifyError) throw verifyError;
      const verifiedSet = new Set((verified || []).filter((row: any) => row.embedding !== null).map((row: any) => Number(row.chunk_index)));
      const allEmbedded = pieces.length > 0 && pieces.every((_, i) => verifiedSet.has(i));
      if (!allEmbedded) throw new Error('TEXT_EMBEDDING_COVERAGE_INCOMPLETE');
      const now = new Date().toISOString();
      const nextMetadata = {
        ...metadata,
        indexing: { model: 'gemini-embedding-2', dimensions: 1536, total_chunks: pieces.length, embedded_chunks: pieces.length, remaining_chunks: 0, updated_at: now },
        text_indexing: { status: 'complete', chunks: pieces.length, verified_at: now },
        automation: { ...(metadata.automation || {}), activated_by: 'text_quality_gate', activated_at: now, source_provenance: 'secondary_channel' },
      };
      const { error: activateError } = await sb.from('knowledge_sources').update({
        metadata: nextMetadata,
        status: 'active',
        review_note: 'متن کانال تخصصی پس از کنترل ساختار و تکمیل ایندکس برداری به‌صورت خودکار فعال شد. این منبع ثانویه است و برای استناد حقوقی باید با سند مرجع صادرکننده تطبیق داده شود.',
        updated_at: now,
      }).eq('id', source.id).eq('organization_id', source.organization_id);
      if (activateError) throw activateError;
      activated++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ title: String(source.title || source.id).slice(0, 100), error: message.slice(0, 400) });
      const now = new Date().toISOString();
      await sb.from('knowledge_sources').update({
        metadata: { ...metadata, text_indexing: { status: 'failed', error: message.slice(0, 700), attempted_at: now, next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() } },
        review_note: 'متن ذخیره شده است، اما ایندکس برداری خودکار کامل نشد؛ تلاش مجدد زمان‌بندی شده است.',
        updated_at: now,
      }).eq('id', source.id).eq('organization_id', source.organization_id);
    }
  }
  return { status: 'completed', processed, activated, failed, skipped, errors: errors.slice(0, 5) };
}

async function pollKnowledgeTelegramArchive(sb: any, supabaseUrl: string, anonKey: string): Promise<any> {
  const { data: cronSecret, error: secretError } = await sb.rpc('internal_get_reminder_secret', {
    p_name: 'messenger_outbox_cron_secret',
  });
  if (secretError || typeof cronSecret !== 'string' || !cronSecret) {
    return { status: 'failed', error: 'MESSENGER_ARCHIVE_CRON_SECRET_UNAVAILABLE' };
  }
  try {
    const base = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
    const response = await fetch(base + '/functions/v1/messenger-gateway', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'x-messenger-path': '/api/messenger/archive/knowledge/process',
        'x-messenger-outbox-cron-secret': cronSecret,
      },
      body: JSON.stringify({ organizationId: ORG_ID, limit: 3 }),
      signal: AbortSignal.timeout(55000),
    });
    const raw = await response.text();
    let result: any = {};
    try { result = JSON.parse(raw); } catch { /* summarized below */ }
    if (!response.ok || result.ok !== true) {
      throw new Error(clean(result.error || raw.slice(0, 700)) || 'MESSENGER_ARCHIVE_HTTP_' + response.status);
    }
    const compact = {
      processed: Number(result.processed || 0),
      archived: Number(result.archived || 0),
      failed: Number(result.failed || 0),
      destination: clean(result.destination) || 'آرشیو تلگرام',
      checked_at: new Date().toISOString(),
    };
    const { error: saveError } = await sb.from('knowledge_worker_state').upsert({
      worker_key: 'knowledge-telegram-archive',
      last_status: 'completed:' + JSON.stringify(compact),
      last_error: compact.failed ? JSON.stringify((result.errors || []).slice(0, 5)) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_key' });
    if (saveError) throw saveError;
    return { status: 'completed', ...compact };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sb.from('knowledge_worker_state').upsert({
      worker_key: 'knowledge-telegram-archive',
      last_status: 'failed',
      last_error: message.slice(0, 1200),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_key' });
    return { status: 'failed', error: message.slice(0, 600) };
  }
}

async function pollCircularFeeds(sb: any, workerToken: string, supabaseUrl: string, anonKey: string): Promise<any> {
  const key = 'customs-circular-feeds';
  const { data: state, error: stateError } = await sb.from('knowledge_worker_state')
    .select('updated_at,last_status')
    .eq('worker_key', key)
    .maybeSingle();
  if (stateError) throw stateError;
  const lastRun = Date.parse(String(state?.updated_at || ''));
  const inFlight = clean(state?.last_status) === 'polling' && Number.isFinite(lastRun) && Date.now() - lastRun < 15 * 60 * 1000;
  const tooSoon = Number.isFinite(lastRun) && Date.now() - lastRun < 20 * 60 * 1000;
  if (inFlight || tooSoon) return { status: 'skipped', reason: inFlight ? 'previous_poll_in_progress' : 'poll_interval_not_reached', last_checked_at: state?.updated_at || null };

  const startedAt = new Date().toISOString();
  const { error: markError } = await sb.from('knowledge_worker_state').upsert({
    worker_key: key,
    last_status: 'polling',
    last_error: null,
    updated_at: startedAt,
  }, { onConflict: 'worker_key' });
  if (markError) throw markError;

  try {
    const base = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
    const response = await fetch(base + '/functions/v1/customs-circular-ingestor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'x-knowledge-worker-token': workerToken,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(110000),
    });
    const raw = await response.text();
    let result: any = {};
    try { result = JSON.parse(raw); } catch { /* reported below */ }
    if (!response.ok || result.status !== 'completed') {
      throw new Error(clean(result?.error || raw.slice(0, 900)) || 'Circular feed ingestor HTTP ' + response.status);
    }
    const compact = {
      checked_at: result.checked_at || new Date().toISOString(),
      rss_ingested: Number(result.rss_ingested || 0),
      telegram_ingested: Number(result.telegram_ingested || 0),
      duplicates: Number(result.duplicates || 0),
      skipped: Number(result.skipped || 0),
      failed: Number(result.failed || 0),
    };
    const { error: saveError } = await sb.from('knowledge_worker_state').upsert({
      worker_key: key,
      last_status: 'completed:' + JSON.stringify(compact),
      last_error: compact.failed ? JSON.stringify((result.results || []).filter((x: any) => x.status === 'failed').slice(0, 3)) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_key' });
    if (saveError) throw saveError;
    return { status: 'completed', ...compact };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sb.from('knowledge_worker_state').upsert({
      worker_key: key,
      last_status: 'failed',
      last_error: message.slice(0, 1500),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_key' });
    return { status: 'failed', error: message.slice(0, 700) };
  }
}

async function finalizeSource(sb: any, sourceId: string): Promise<any> {
  const { data: pages, error: pageError } = await sb.from('knowledge_page_extractions')
    .select('page_number,extracted_text,status,page_kind,confidence')
    .eq('source_id', sourceId)
    .order('page_number', { ascending: true });
  if (pageError) throw pageError;

  const pendingPages = (pages || []).filter((p: any) => p.status === 'pending').length;
  const processingPages = (pages || []).filter((p: any) => p.status === 'processing').length;
  const pending = pendingPages + processingPages;
  const completeCount = (pages || []).filter((p: any) => p.status === 'complete').length;
  const reviewCount = (pages || []).filter((p: any) => p.status === 'needs_review').length;
  const failedCount = (pages || []).filter((p: any) => p.status === 'failed').length;

  const { data: source, error: sourceError } = await sb.from('knowledge_sources')
    .select('id,organization_id,title,source_number,issued_at,effective_at,issuer,subject,keywords,metadata,ai_extraction,status')
    .eq('id', sourceId).maybeSingle();
  if (sourceError || !source) throw sourceError || new Error('Knowledge source not found');

  if (pending > 0) {
    // Keep transient OCR progress out of knowledge_sources: its audit trigger
    // snapshots the full extracted_text and ai_extraction JSON on every UPDATE.
    // Store only compact counters in worker state, and write only when counters change.
    const progress = {
      queued_pages: (pages || []).length,
      completed_pages: completeCount,
      needs_review_pages: reviewCount,
      failed_pages: failedCount,
      pending_pages: pendingPages,
      processing_pages: processingPages,
      progress_percent: (pages || []).length
        ? Math.round((completeCount + reviewCount + failedCount) * 10000 / (pages || []).length) / 100
        : 0,
    };
    const workerKey = 'knowledge-ocr-progress:' + sourceId;
    const progressStatus = 'progress:' + JSON.stringify(progress);
    const { data: prior, error: priorError } = await sb.from('knowledge_worker_state')
      .select('last_status')
      .eq('worker_key', workerKey)
      .maybeSingle();
    if (priorError) throw priorError;
    if (prior?.last_status !== progressStatus) {
      const { error: progressError } = await sb.from('knowledge_worker_state').upsert({
        worker_key: workerKey,
        last_status: progressStatus,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'worker_key' });
      if (progressError) throw progressError;
    }
    return { finalized: false, ...progress };
  }

  const verifiedPages = (pages || []).filter((p: any) => p.status === 'complete');
  const replaced = new Set(verifiedPages.map((p: any) => Number(p.page_number)));
  const existing = Array.isArray(source.ai_extraction?.chunks) ? source.ai_extraction.chunks : [];
  const merged = existing.filter((c: any) => !replaced.has(Number(c?.page_number)));
  for (const page of verifiedPages) {
    const content = clean(page.extracted_text);
    if (content) merged.push({ page_number: Number(page.page_number), content });
  }
  merged.sort((a: any, b: any) => Number(a.page_number || 0) - Number(b.page_number || 0));
  const extractedText = merged.map((c: any) => clean(c.content)).filter(Boolean).join('\n\n');
  const [{ count: totalChunks, error: totalError }, { count: embeddedChunks, error: embeddedError }] = await Promise.all([
    sb.from('knowledge_chunks').select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId).eq('organization_id', source.organization_id),
    sb.from('knowledge_chunks').select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId).eq('organization_id', source.organization_id).not('embedding', 'is', null),
  ]);
  if (totalError) throw totalError;
  if (embeddedError) throw embeddedError;

  const metadata = {
    ...(source.metadata || {}),
    indexing: {
      ...((source.metadata || {}).indexing || {}),
      total_chunks: totalChunks || 0,
      embedded_chunks: embeddedChunks || 0,
      remaining_chunks: Math.max(0, (totalChunks || 0) - (embeddedChunks || 0)),
      updated_at: new Date().toISOString(),
    },
    page_ocr: {
      queued_pages: (pages || []).length,
      completed_pages: completeCount,
      needs_review_pages: reviewCount,
      failed_pages: failedCount,
      pending_pages: 0,
      processing_pages: 0,
      progress_percent: 100,
      verified_at: new Date().toISOString(),
      method: 'single-page visual OCR + page-level QA + persistent page records',
    },
  };

  const aiExtraction = {
    ...(source.ai_extraction || {}),
    extracted_text: extractedText,
    chunks: merged,
    page_ocr: metadata.page_ocr,
  };
  const allPagesPassed = (pages || []).length > 0 && completeCount === (pages || []).length && reviewCount === 0 && failedCount === 0;
  const indexingPassed = (totalChunks || 0) > 0 && (embeddedChunks || 0) === (totalChunks || 0);
  const autoActivationAllowed = source.metadata?.auto_activation_policy !== 'manual_review';
  const autoActivated = source.status !== 'active' && allPagesPassed && indexingPassed && autoActivationAllowed;
  const finalMetadata = {
    ...metadata,
    automation: autoActivated
      ? { ...(source.metadata?.automation || {}), activated_by: 'page_quality_gate', activated_at: new Date().toISOString() }
      : (source.metadata?.automation || {}),
  };
  const { error: updateError } = await sb.from('knowledge_sources').update({
    ai_extraction: aiExtraction,
    extracted_text: extractedText,
    metadata: finalMetadata,
    ...(autoActivated ? { status: 'active' } : {}),
    review_note: autoActivated
      ? 'فعال‌سازی خودکار پس از تکمیل OCR تمام صفحات و تأیید کامل ایندکس برداری.'
      : (reviewCount || failedCount
        ? 'بازخوانی صفحه‌محور انجام شد؛ ' + (reviewCount + failedCount) + ' صفحه برای بازبینی انسانی باقی مانده است.'
        : 'OCR و ایندکس‌گذاری صفحه‌به‌صفحه تکمیل شد؛ فعال‌سازی نیازمند بررسی بیشتر است.'),
    updated_at: new Date().toISOString(),
  }).eq('id', sourceId).eq('organization_id', source.organization_id);
  if (updateError) throw updateError;

  return { finalized: true, complete: completeCount, needs_review: reviewCount, failed: failedCount, total_chunks: totalChunks || 0, auto_activated: autoActivated, cron_stopped: false, persistent_feed_monitor: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const supplied = clean(req.headers.get('x-knowledge-worker-token'));
    if (!supplied || !safeEqual(await sha256(supplied), EXPECTED_TOKEN_SHA256)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
    const geminiKeys = [...new Set([
      Deno.env.get('GEMINI_API_KEY') || '',
      ...Array.from({ length: 10 }, (_, i) => Deno.env.get('GEMINI_API_KEY_' + (i + 1)) || ''),
    ].map(clean).filter(Boolean))].slice(0, 10);
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Missing server-side Supabase configuration' }, 503);
    }
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const sourceIdRequested = clean(body.source_id);
    let feedCheck: any = null;
    let telegramArchiveCheck: any = null;
    let textIndexCheck: any = null;
    if (!sourceIdRequested && !clean(body.action)) {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_pIh0yF6SQcQ-IAa_FkbjWA_qTSm83Sr';
      const feedPromise = pollCircularFeeds(sb, supplied, supabaseUrl, anonKey);
      textIndexCheck = await indexTextOnlyKnowledgeSources(sb, geminiKeys);
      telegramArchiveCheck = await pollKnowledgeTelegramArchive(sb, supabaseUrl, anonKey);
      const feedResult = await Promise.allSettled([feedPromise]);
      feedCheck = feedResult[0].status === 'fulfilled'
        ? feedResult[0].value
        : { status: 'failed', error: (feedResult[0].reason instanceof Error ? feedResult[0].reason.message : String(feedResult[0].reason)).slice(0, 500) };
    }

    if (clean(body.action) === 'provider_status') {
      const geminiSlots = ['GEMINI_API_KEY', ...Array.from({ length: 10 }, (_, i) => 'GEMINI_API_KEY_' + (i + 1))]
        .filter(name => Boolean(Deno.env.get(name)));
      return json({ configuredGeminiKeySlots: geminiSlots, configuredCount: geminiSlots.length, supabaseAnonKeyConfigured: Boolean(Deno.env.get('SUPABASE_ANON_KEY')), openaiOcrBridge: 'ai-assistant/gpt-4.1-mini' });
    }

    if (clean(body.action) === 'signed_url' && !sourceIdRequested) {
      return json({ error: 'source_id is required for signed_url' }, 400);
    }

    const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { error: staleResetError } = await sb.from('knowledge_page_extractions')
      .update({
        status: 'pending',
        next_attempt_at: null,
        last_error: 'پردازشگر قبلی متوقف شده بود؛ صفحه به صف بازگشت.',
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('updated_at', staleBefore);
    if (staleResetError) throw staleResetError;

    let sourceId = sourceIdRequested;
    if (!sourceId) {
      const dueNow = new Date().toISOString();
      const { data: nextPage, error: nextPageError } = await sb.from('knowledge_page_extractions')
        .select('source_id')
        .eq('status', 'pending')
        .or('next_attempt_at.is.null,next_attempt_at.lte.' + dueNow)
        .order('created_at', { ascending: true })
        .order('page_number', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (nextPageError) throw nextPageError;
      sourceId = clean(nextPage?.source_id);
    }
    if (!sourceId) return json({ status: 'idle', reason: 'no_due_knowledge_pages', feed_check: feedCheck, telegram_archive_check: telegramArchiveCheck, text_index_check: textIndexCheck });
    if (!geminiKeys.length && clean(body.action) !== 'signed_url' && clean(body.action) !== 'provider_status') {
      return json({ error: 'Missing server-side GEMINI_API_KEY' }, 503);
    }
    const apiKeys = geminiKeys;

    const { data: source, error: sourceError } = await sb.from('knowledge_sources')
      .select('id,organization_id,title,storage_path,mime_type,metadata,ai_extraction,status')
      .eq('id', sourceId).maybeSingle();
    if (sourceError || !source) throw sourceError || new Error('Knowledge source not found');
    if (!clean(source.storage_path).startsWith(String(source.organization_id) + '/')) {
      throw new Error('Storage path does not match source organization');
    }

    if (!['signed_url', 'test_ocr_page', 'provider_status'].includes(clean(body.action))) {
      await archiveKnowledgeSourceToTelegram(sb, source);
    }

    if (clean(body.action) === 'signed_url') {
      const { data: signed, error: signedError } = await sb.storage
        .from('customs-knowledge')
        .createSignedUrl(source.storage_path, 300);
      if (signedError || !signed?.signedUrl) throw signedError || new Error('Signed URL not generated');
      const baseUrl = String(supabaseUrl).endsWith('/')
        ? String(supabaseUrl).slice(0, -1)
        : String(supabaseUrl);
      const signedUrl = signed.signedUrl.startsWith('http')
        ? signed.signedUrl
        : baseUrl + signed.signedUrl;
      return json({ signedUrl, expiresInSeconds: 300 });
    }

    if (clean(body.action) === 'test_ocr_page') {
      const testPageNumber = Number(body.page_number);
      if (!Number.isInteger(testPageNumber) || testPageNumber < 1) {
        return json({ error: 'Valid page_number is required for test_ocr_page' }, 400);
      }
      const { data: testFile, error: testDownloadError } = await sb.storage
        .from('customs-knowledge').download(source.storage_path);
      if (testDownloadError || !testFile) throw testDownloadError || new Error('Unable to download source PDF for OCR test');
      const testPdf = await PDFDocument.load(new Uint8Array(await testFile.arrayBuffer()), { ignoreEncryption: true });
      const testResult = await extractPage(
        testPdf,
        testPageNumber,
        clean(source.metadata?.filename || source.title || 'customs-knowledge.pdf'),
        apiKeys,
        supplied,
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_pIh0yF6SQcQ-IAa_FkbjWA_qTSm83Sr',
      );
      return json({
        status: 'ocr_test_complete',
        page_number: testPageNumber,
        chars: testResult.page_text.length,
        page_kind: testResult.page_kind,
        confidence: testResult.confidence,
        model: testResult.model,
        notes: testResult.notes,
        excerpt: testResult.page_text.slice(0, 1200),
      });
    }

    const { data: jobs, error: claimError } = await sb.rpc('claim_knowledge_ocr_pages', {
      p_source_id: sourceId,
      p_limit: MAX_OCR_PAGES_PER_RUN,
    });
    if (claimError) throw claimError;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      const final = await finalizeSource(sb, sourceId);
      return json({ status: final.finalized ? 'finished' : 'idle', final });
    }

    const { data: file, error: downloadError } = await sb.storage.from('customs-knowledge').download(source.storage_path);
    if (downloadError || !file) throw downloadError || new Error('Unable to download private source PDF');
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) throw new Error('Source PDF is outside the worker size limit');

    const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
    const filename = clean(source.metadata?.filename || source.title || 'customs-knowledge.pdf');
    const results = await Promise.allSettled(jobs.map(async (job: any) => {
      try {
        const { data: storedPage, error: storedPageError } = await sb.from('knowledge_page_extractions')
          .select('extracted_text,page_kind,confidence,model,metadata')
          .eq('id', job.id)
          .maybeSingle();
        if (storedPageError) throw storedPageError;
        const storedText = clean(storedPage?.extracted_text);
        const storedKind = clean(storedPage?.page_kind);
        const storedConfidence = Number(storedPage?.confidence || 0);
        const storedShortKind = ['blank','divider','cover'].includes(storedKind);
        const reusableShort = storedShortKind && (storedText.length > 0 || storedKind === 'blank');
        const reusableLongEnough = storedText.length >= 80 &&
          (job.original_chars < 80 || storedText.length >= Math.floor(job.original_chars * 0.8));
        const forceReverify = storedPage?.metadata?.reverification_required === true;
        const reusableStoredOCR = !forceReverify && storedConfidence >= 0.90 && (reusableShort || reusableLongEnough);
        const extracted = reusableStoredOCR
          ? {
              page_text: storedText,
              page_kind: storedKind,
              confidence: storedConfidence,
              notes: 'Reused previously saved page-level OCR; only embeddings and quality status were rebuilt.',
              model: clean(storedPage?.model) || 'saved-page-ocr',
            }
          : await extractPage(pdf, Number(job.page_number), filename, apiKeys, supplied, supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
        return await persistPage(sb, source, job, extracted, apiKeys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = /HTTP\\s*(429|500|502|503|504)|quota|free_tier|resource.?exhausted|high demand|temporar|timed out|aborted|worker_resource_limit/i.test(message);
        let delayMs = 5 * 60 * 1000;
        const retryMatch = message.match(/retry in\\s+(?:(\\d+)h)?\\s*(?:(\\d+)m)?\\s*(?:(\\d+(?:\\.\\d+)?)s)?/i);
        if (retryMatch) {
          const hours = Number(retryMatch[1] || 0);
          const minutes = Number(retryMatch[2] || 0);
          const seconds = Number(retryMatch[3] || 0);
          const parsedDelay = ((hours * 60 + minutes) * 60 + seconds) * 1000;
          if (parsedDelay > 0) delayMs = Math.max(delayMs, parsedDelay);
        } else if (/quota|free_tier_requests|daily.*limit/i.test(message)) {
          delayMs = 24 * 60 * 60 * 1000;
        }
        const hardQuota = /insufficient_quota|free_tier_requests|quota exceeded|requests per day|daily.*limit/i.test(message);
        if (hardQuota) {
          await sb.from('knowledge_worker_state').upsert({
            worker_key: 'knowledge-ocr',
            paused_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            last_status: 'quota_paused',
            last_error: message.slice(0, 1500),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'worker_key' });
        }
        const terminal = !transient && Number(job.attempts || 0) >= 3;
        const nextAttemptAt = transient ? new Date(Date.now() + delayMs).toISOString() : null;
        await sb.from('knowledge_page_extractions').update({
          status: terminal ? 'needs_review' : 'pending',
          next_attempt_at: nextAttemptAt,
          last_error: message.slice(0, 1500),
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        return {
          status: terminal ? 'needs_review' : 'retry',
          page_number: job.page_number,
          retry_after: nextAttemptAt,
          reason: message,
        };
      }
    }));

    const items = results.map((result: any, i: number) =>
      result.status === 'fulfilled'
        ? { page_number: jobs[i].page_number, ...result.value }
        : { page_number: jobs[i].page_number, status: 'failed' }
    );

    const final = await finalizeSource(sb, sourceId);
    return json({
      status: final.finalized ? 'finished' : 'processing',
      source_id: sourceId,
      source_pdf_pages: pdf.getPageCount(),
      processed_this_run: items.length,
      items,
      final,
      feed_check: feedCheck,
      telegram_archive_check: telegramArchiveCheck,
      text_index_check: textIndexCheck,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});