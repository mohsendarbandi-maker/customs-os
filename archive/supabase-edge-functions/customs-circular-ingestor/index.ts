import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const EXPECTED_TOKEN_SHA256 = 'a228451145959efb301e866e2908a5ea03f156a12b5b6d4872df60595f4c0f9d';
const ORG_ID = 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd';
const CREATED_BY = '11ad257d-c3ba-49f4-b76a-c40a2cd0c948';
const FEED_URL = 'https://iranimpex.com/circular/feed/';
const TELEGRAM_PREVIEW_URL = 'https://t.me/s/Gomrok_news';
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_RSS_ITEMS_PER_RUN = 4;
const MAX_TELEGRAM_ITEMS_PER_RUN = 8;

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}
async function sha256Text(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
function htmlText(value: string): string {
  return clean(decodeEntities(value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')));
}
function tagValue(block: string, tag: string): string {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? clean(decodeEntities(m[1].replace(/<[^>]+>/g, ' '))) : '';
}
function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
}
function safeFilename(value: string): string {
  const raw = value.normalize('NFKC').replace(/[\\/\r\n\u0000-\u001f]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_').trim();
  return (raw || 'customs-circular.pdf').slice(-170);
}
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const claimed = Number(response.headers.get('content-length') || 0);
  if (claimed > maxBytes) throw new Error('UPSTREAM_FILE_TOO_LARGE');
  if (!response.body) throw new Error('UPSTREAM_EMPTY_BODY');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('UPSTREAM_FILE_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
async function getBytes(url: string, maxBytes: number, expectedType?: RegExp): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'CustomsOS-CircularMonitor/1.0 (+https://darbandicommercial.ir)' },
  });
  if (!response.ok) throw new Error('UPSTREAM_HTTP_' + response.status);
  const contentType = clean(response.headers.get('content-type')).toLowerCase();
  if (expectedType && !expectedType.test(contentType)) throw new Error('UNEXPECTED_CONTENT_TYPE_' + contentType.slice(0, 80));
  return { bytes: await readBounded(response, maxBytes), contentType };
}
function classifyDocument(text: string): any {
  const t = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  let type = 'other';
  if (/قانون|مصوبه|تصویب\s*نامه|تصویبنامه/i.test(t)) type = 'law';
  else if (/بخشنامه/i.test(t)) type = 'circular';
  else if (/دستورالعمل|شیوه\s*نامه|شیوه‌نامه|ضوابط\s*اجرایی/i.test(t)) type = 'instruction';
  else if (/اطلاعیه|اخطاریه/i.test(t)) type = 'notice';
  else if (/تعرفه|حقوق\s*ورودی|ردیف\s*تعرفه/i.test(t)) type = 'tariff';
  else if (/رأی|رای|نظر\s*کمیسیون|نظریه/i.test(t)) type = 'ruling';

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
  const authority = authorities.find(a => a.pattern.test(t)) || { key: 'unknown', label: 'در متن پیام مشخص نشده' };

  const areas = [
    { key: 'import', label: 'واردات', pattern: /واردات|ورود\s*قطعی|ثبت\s*سفارش/i },
    { key: 'export', label: 'صادرات', pattern: /صادرات|صدور\s*قطعی|پروانه\s*صادراتی/i },
    { key: 'transit', label: 'ترانزیت و حمل', pattern: /ترانزیت|حمل\s*یکسره|عبور\s*مرزی/i },
    { key: 'customs_clearance', label: 'ترخیص و تشریفات گمرکی', pattern: /ترخیص|اظهارنامه|قبض\s*انبار|کوتاژ|کوتاژ/i },
    { key: 'tariff_valuation', label: 'تعرفه و ارزش', pattern: /تعرفه|ارزش\s*گمرکی|حقوق\s*ورودی|طبقه\s*بندی/i },
    { key: 'foreign_exchange', label: 'ارز و تعهدات ارزی', pattern: /ارز|تخصیص|تأمین\s*ارز|تعهد\s*ارزی|رفع\s*تعهد/i },
    { key: 'order_registration', label: 'ثبت سفارش و سامانه جامع تجارت', pattern: /ثبت\s*سفارش|سامانه\s*جامع\s*تجارت|nts[wW]/i },
    { key: 'permits', label: 'مجوزها و کنترل‌های سیستمی', pattern: /مجوز|تأیید\s*سیستمی|تایید\s*سیستمی|استاندارد|قرنطینه/i },
    { key: 'customs_offices', label: 'گمرکات اجرایی و مرزی', pattern: /گمرکات\s*اجرایی|گمرک\s*(?:تهران|انزلی|بندر|شهید\s*رجایی|امام|آستارا|آبادان|بوشهر|تبریز|مشهد|ارومیه|ساری|نوشهر|پرویزخان|مهران|دوغارون|سرخس|بازرگان)/i },
  ];
  const matchedAreas = areas.filter(a => a.pattern.test(t));
  const num = t.match(/(?:شماره(?:\s|‌)*(?:بخشنامه|نامه|ابلاغیه)?\s*[:：]?\s*)([0-9۰-۹]{2,}(?:[\/.\-][0-9۰-۹A-Za-z]+){1,6})/i)?.[1] || null;
  const office = t.match(/(?:مدیر|مدیرکل|ناظر)\s+(?:گمرک\s+)?([آ-ی]{2,}(?:\s+[آ-ی]{2,}){0,2})/);
  const authorityUnit = t.match(/(?:دفتر|معاونت|اداره\s*کل)\s+([آ-ی\s]{3,60})(?:\s+گمرک|\s+وزارت|\s+سازمان|،|,|\.)/);
  return {
    document_type: type,
    document_type_label: ({law:'قانون / مصوبه',circular:'بخشنامه',instruction:'دستورالعمل / شیوه‌نامه',notice:'اطلاعیه',tariff:'تعرفه',ruling:'رأی / نظریه',guide:'راهنما',other:'خبر / سند متفرقه'} as Record<string,string>)[type],
    authority_key: authority.key,
    authority_label: authority.label,
    authority_unit: clean(authorityUnit?.[1]) || null,
    office_hint: clean(office?.[1]) || null,
    subject_area_keys: matchedAreas.map(a => a.key),
    subject_area_label: matchedAreas.map(a => a.label).join('، ') || 'سایر امور تجارت خارجی',
    source_number: num ? toLatinDigits(num) : null,
  };
}
function relevantCustomsContent(text: string): boolean {
  return /گمرک|بخشنامه|ترخیص|اظهارنامه|قبض\s*انبار|تعرفه|واردات|صادرات|ثبت\s*سفارش|ترانزیت|تخصیص\s*ارز|تعهد\s*ارزی|وزارت\s*صمت|سازمان\s*توسعه\s*تجارت|بانک\s*مرکزی|پنجره\s*واحد|epl|ntsw/i.test(text);
}
function parseItems(xml: string): Array<{ title: string; url: string; pubDate: string; guid: string; description: string }> {
  const found: Array<{ title: string; url: string; pubDate: string; guid: string; description: string }> = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const description = tagValue(block, 'description');
    const item = {
      title: tagValue(block, 'title'),
      url: tagValue(block, 'link'),
      pubDate: tagValue(block, 'pubDate'),
      guid: tagValue(block, 'guid'),
      description,
    };
    if (item.title && item.url) found.push(item);
  }
  return found;
}
function parseTelegramPosts(html: string): Array<{id:string;title:string;text:string;url:string;date:string;pdfUrl:string|null;attachmentName:string|null}> {
  const marks = [...html.matchAll(/data-post=["']gomrok_news\/(\d+)["']/gi)];
  const posts: Array<{id:string;title:string;text:string;url:string;date:string;pdfUrl:string|null;attachmentName:string|null}> = [];
  for (let i=0;i<marks.length;i++) {
    const mark = marks[i];
    const wrapperStart = html.lastIndexOf('tgme_widget_message_wrap', mark.index);
    const start = wrapperStart >= 0 ? Math.max(0,html.lastIndexOf('<div',wrapperStart)) : mark.index;
    let end = i+1<marks.length ? html.lastIndexOf('tgme_widget_message_wrap',marks[i+1].index) : html.length;
    if (end <= start) end = i+1<marks.length ? marks[i+1].index : html.length;
    const block = html.slice(start,end);
    const textMatch = block.match(/<div\b[^>]*class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const text = textMatch ? htmlText(textMatch[1]).slice(0,20000) : '';
    const links:string[]=[];
    let attachmentName:string|null=null;
    for (const a of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs=a[1],inner=a[2];
      const href=attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (href) links.push(decodeEntities(href));
      if (/tgme_widget_message_document_wrap/i.test(attrs)) {
        const name=inner.match(/tgme_widget_message_document_title[^>]*>([\s\S]*?)<\//i);
        attachmentName=name?htmlText(name[1]):(htmlText(inner).slice(0,180)||null);
      }
    }
    const pdfUrl=links.find(link=>/\.pdf(?:[?#]|$)/i.test(link))||null;
    const title=(text.split('\n').map(clean).find(x=>x.length>12)||attachmentName||'پیام گمرکی کانال') .slice(0,300);
    const datetime=block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1]||'';
    const id=mark[1];
    if (!text && !attachmentName && !pdfUrl) continue;
    posts.push({id,title,text,url:'https://t.me/Gomrok_news/'+id,date:datetime,pdfUrl,attachmentName});
  }
  const seen=new Set<string>();
  return posts.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;});
}
function safeArticleUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['iranimpex.com', 'www.iranimpex.com'].includes(url.hostname) ||
      !url.pathname.startsWith('/circular/')) throw new Error('ARTICLE_URL_NOT_ALLOWED');
  return url.toString();
}
function safeTelegramPdfUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const permitted = host === 't.me' || host.endsWith('.telesco.pe') || host === 'telesco.pe' ||
    host === 'telegram.org' || host.endsWith('.telegram.org') ||
    host === 'iranimpex.com' || host === 'dl.iranimpex.com' ||
    host.endsWith('.gov.ir') || host === 'gov.ir' || host === 'irica.ir' || host.endsWith('.irica.ir');
  if (url.protocol !== 'https:' || !permitted || !/\.pdf(?:[?#]|$)/i.test(url.href)) throw new Error('PDF_URL_NOT_ALLOWED');
  return url.toString();
}
async function findDuplicate(sb:any,sourceUrl:string,org:string):Promise<any|null>{
  const {data,error}=await sb.from('knowledge_sources').select('id,status').eq('organization_id',org).eq('source_url',sourceUrl).limit(1).maybeSingle();
  if(error)throw error;
  return data||null;
}
async function saveTextPost(sb:any,post:any,classification:any):Promise<any>{
  const text=clean(post.text).slice(0,20000);
  const sourceId=crypto.randomUUID();
  const filename=safeFilename((post.title||'customs-news-'+post.id).slice(0,140)+'.txt');
  const metadata={
    filename,
    size:null,
    upload_complete:false,
    telegram_archive_requested:true,telegram_archive_via_gateway:true,
    auto_activation_policy:'quality_gate',
    source_channel:'@Gomrok_news',
    source_channel_label:'خبر گمرکی (@Gomrok_news)',
    source_channel_url:'https://t.me/Gomrok_news',
    source_message_id:post.id,
    source_message_url:post.url,
    source_message_date:post.date||null,
    source_class:'trusted_specialist_secondary_channel',
    source_class_label:'کانال تخصصی مورد اعتماد کاربر؛ منبع ثانویه',
    legal_status:'secondary_channel_text_not_primary_original',
    classification,
    attachment_name:filename,
    source_links:post.pdfUrl?[post.pdfUrl]:[],
  };
  const title=post.title||'پیام گمرکی از خبر گمرکی';
  const {data,error}=await sb.from('knowledge_sources').insert({
    id:sourceId,organization_id:ORG_ID,title,source_type:classification.document_type,
    source_number:classification.source_number,issued_at:null,effective_at:null,
    issuer:classification.authority_label,subject:title,
    keywords:['گمرک','خبر گمرکی','@Gomrok_news',...classification.subject_area_keys],
    status:'pending_review',source_url:post.url,storage_path:null,mime_type:'text/plain',
    metadata,created_by:CREATED_BY,extracted_text:text,
    ai_extraction:{
      title,source_type:classification.document_type,source_number:classification.source_number,
      issued_at:null,effective_at:null,issuer:classification.authority_label,subject:title,
      keywords:['گمرک','بخشنامه',...classification.subject_area_keys],summary:'',
      extracted_text:text,chunks:text?[{page_number:null,content:text}]:[],
      provenance:'Public post from user-prioritized Telegram specialist channel; primary document is not attached or verified.',
    },
    extraction_model:'telegram-public-channel-v1',
    review_note:'از کانال عمومی خبر گمرکی دریافت شد. دسته‌بندی اولیه بر اساس متن پیام است؛ مرجع صادرکننده و اصل سند باید پیش از استناد حقوقی کنترل شود.',
  }).select('id').single();
  if(error||!data)throw error||new Error('TELEGRAM_TEXT_SOURCE_INSERT_FAILED');
  return {status:'text_saved_pending_review',source_id:sourceId,title,document_type:classification.document_type,issuer:classification.authority_label};
}
async function savePdfSource(sb:any,input:any,classification:any,opts:any):Promise<any>{
  const bytes:Uint8Array=opts.bytes;
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true});
  const pageCount=pdf.getPageCount();
  if(pageCount<1||pageCount>2000)throw new Error('PDF_PAGE_COUNT_OUT_OF_RANGE');
  const digest=await sha256(bytes);
  const filename=safeFilename(opts.filename||input.title+'.pdf');
  const sourceId=crypto.randomUUID();
  const storagePath=ORG_ID+'/circular-watch/'+sourceId+'-'+filename;
  const metadata={
    filename,size:bytes.length,sha256:digest,upload_complete:true,page_count:pageCount,
    telegram_archive_requested:true,telegram_archive_via_gateway:true,auto_activation_policy:'quality_gate',
    source_channel:input.channel==='telegram'?'@Gomrok_news':'IranImpex',
    source_channel_label:input.channel==='telegram'?'خبر گمرکی (@Gomrok_news)':'بایگانی بخشنامه‌های ایران‌ایمپکس',
    source_channel_url:input.channel==='telegram'?'https://t.me/Gomrok_news':FEED_URL,
    source_message_id:input.message_id||null,source_message_url:input.message_url||input.url,
    source_article_url:input.article_url||input.url,source_pdf_url:opts.pdfUrl||null,
    rss_published_at:input.pubDate||null,source_class:input.channel==='telegram'?'trusted_specialist_secondary_channel':'secondary_aggregator',
    source_class_label:input.channel==='telegram'?'کانال تخصصی مورد اعتماد کاربر؛ منبع ثانویه':'منبع تجمیع‌کننده؛ منبع ثانویه',
    authority_checked:false,legal_status:'secondary_copy_requires_authority_check',
    discovery_method:input.channel==='telegram'?'telegram_public_preview_then_original_pdf':'rss_then_article_original_pdf',
    classification,
  };
  const {error:storageError}=await sb.storage.from('customs-knowledge').upload(storagePath,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
  if(storageError)throw storageError;
  let inserted=false;
  try{
    const title=clean(input.title).slice(0,500)||filename;
    const {data:source,error:sourceError}=await sb.from('knowledge_sources').insert({
      id:sourceId,organization_id:ORG_ID,title,source_type:classification.document_type,
      source_number:classification.source_number,issued_at:null,effective_at:null,
      issuer:classification.authority_label,subject:title,
      keywords:['گمرک','بخشنامه',...classification.subject_area_keys],
      status:'pending_review',source_url:input.message_url||input.url,
      storage_path:storagePath,mime_type:'application/pdf',metadata,created_by:CREATED_BY,
      extracted_text:'',
      ai_extraction:{
        title,source_type:classification.document_type,source_number:classification.source_number,
        issued_at:null,effective_at:null,issuer:classification.authority_label,subject:title,
        keywords:['گمرک','بخشنامه',...classification.subject_area_keys],summary:'',extracted_text:'',chunks:[],
        provenance:'Original PDF file attached or linked by a user-prioritized secondary customs-news publisher; not yet verified against issuer registry.',
      },
      extraction_model:'telegram-public-channel-v1',
      review_note:'PDF به‌صورت خودکار دریافت شد؛ OCR صفحه‌به‌صفحه انجام می‌شود. اعتبار مرجع، شماره و تاریخ قبل از انتشار نهایی بررسی شود.',
    }).select('id').single();
    if(sourceError||!source)throw sourceError||new Error('KNOWLEDGE_SOURCE_INSERT_FAILED');
    inserted=true;
    const pages=Array.from({length:pageCount},(_,i)=>({
      organization_id:ORG_ID,source_id:sourceId,page_number:i+1,original_chars:0,extracted_text:'',
      page_kind:'unknown',status:'pending',model:'telegram-public-channel-pdf',attempts:0,
      metadata:{origin:input.channel==='telegram'?'telegram_public_channel_attachment':'secondary_publisher_pdf',
        source_message_url:input.message_url||input.url,source_pdf_url:opts.pdfUrl||null},
    }));
    for(let i=0;i<pages.length;i+=500){
      const {error:pageError}=await sb.from('knowledge_page_extractions').insert(pages.slice(i,i+500));
      if(pageError)throw pageError;
    }
    return {status:'pdf_saved_pending_ocr_and_review',source_id:sourceId,title,document_type:classification.document_type,issuer:classification.authority_label,pages:pageCount,bytes:bytes.length,telegram_archive_queued:true};
  }catch(error){
    if(inserted)await sb.from('knowledge_sources').delete().eq('id',sourceId).eq('organization_id',ORG_ID);
    await sb.storage.from('customs-knowledge').remove([storagePath]);
    throw error;
  }
}
async function ingestRssItem(sb:any,item:any):Promise<any>{
  const url=safeArticleUrl(item.url);
  const dup=await findDuplicate(sb,url,ORG_ID);
  if(dup)return {status:'duplicate',source_id:dup.id,title:item.title};
  const article=await getBytes(url,MAX_HTML_BYTES,/text\/html|application\/xhtml\+xml/i);
  const html=new TextDecoder('utf-8').decode(article.bytes);
  const pdfLink=html.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)?.map((a:string)=>{
    if(!/ir-btn-download-primary/i.test(a))return '';
    return a.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]||'';
  }).find(Boolean)||'';
  if(!pdfLink)return {status:'skipped_no_original_pdf',title:item.title,article_url:url};
  const pdfUrl=new URL(decodeEntities(pdfLink),url).toString();
  const issuerMatch=html.match(/مرجع نهایی ابلاغ[\s\S]{0,450}?<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
  const numberMatch=html.match(/شماره بخشنامه[\s\S]{0,450}?<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
  const issuer=htmlText(issuerMatch?.[1]||'');
  const number=htmlText(numberMatch?.[1]||'');
  const classification=classifyDocument([item.title,item.description,issuer,number].join('\n'));
  classification.authority_label=issuer||classification.authority_label;
  classification.source_number=number||classification.source_number;
  const {bytes}=await getBytes(pdfUrl,MAX_PDF_BYTES,/application\/pdf|application\/octet-stream|binary\/octet-stream/i);
  if(bytes.length<100||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('DOWNLOADED_FILE_IS_NOT_A_PDF');
  return await savePdfSource(sb,{channel:'rss',title:item.title,url,message_url:url,article_url:url,pubDate:item.pubDate},classification,{bytes,pdfUrl,filename:decodeURIComponent(new URL(pdfUrl).pathname.split('/').pop()||item.title+'.pdf')});
}
async function ingestTelegramPost(sb:any,post:any):Promise<any>{
  const text=clean(post.text||post.attachmentName||post.title).slice(0,20000);
  if(!relevantCustomsContent(text))return {status:'skipped_not_customs_relevant',title:post.title};
  const dup=await findDuplicate(sb,post.url,ORG_ID);
  if(dup)return {status:'duplicate',source_id:dup.id,title:post.title};
  const classification=classifyDocument(text);
  const pdfUrl=post.pdfUrl;
  if(pdfUrl){
    try{
      const safe=safeTelegramPdfUrl(pdfUrl);
      const result=await getBytes(safe,MAX_PDF_BYTES,/application\/pdf|application\/octet-stream|binary\/octet-stream/i);
      if(result.bytes.length>=100&&new TextDecoder().decode(result.bytes.subarray(0,5))==='%PDF-'){
        return await savePdfSource(sb,{channel:'telegram',title:post.title,url:post.url,message_url:post.url,message_id:post.id,date:post.date},classification,{bytes:result.bytes,pdfUrl:safe,filename:post.attachmentName||decodeURIComponent(new URL(safe).pathname.split('/').pop()||post.title+'.pdf')});
      }
    }catch(error){
      // Preserve the message and its original link as a reviewable knowledge record if the PDF host blocks automated download.
    }
  }
  return await saveTextPost(sb,{...post,text:post.text||post.title},classification);
}

Deno.serve(async (req: Request) => {
  if(req.method!=='POST')return json({error:'POST required'},405);
  try{
    const supplied=clean(req.headers.get('x-knowledge-worker-token'));
    if(!supplied||!safeEqual(await sha256Text(supplied),EXPECTED_TOKEN_SHA256))return json({error:'Unauthorized'},401);
    const supabaseUrl=Deno.env.get('SUPABASE_URL');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY');
    if(!supabaseUrl||!serviceKey)return json({error:'Server-side Supabase configuration is missing'},503);
    const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const [feedResult,telegramResult]=await Promise.allSettled([
      getBytes(FEED_URL,MAX_FEED_BYTES,/application\/rss\+xml|application\/xml|text\/xml|text\/plain/i),
      getBytes(TELEGRAM_PREVIEW_URL,MAX_HTML_BYTES,/text\/html|application\/xhtml\+xml/i),
    ]);
    const results:any[]=[];
    let rssIngested=0,telegramIngested=0,duplicates=0,skipped=0,failed=0;
    if(feedResult.status==='fulfilled'){
      const xml=new TextDecoder('utf-8').decode(feedResult.value.bytes);
      const items=parseItems(xml).slice(0,40);
      for(const item of items){
        if(rssIngested>=MAX_RSS_ITEMS_PER_RUN)break;
        try{
          const result=await ingestRssItem(sb,item);
          results.push({channel:'IranImpex RSS',...result});
          if(result.status==='pdf_saved_pending_ocr_and_review')rssIngested++;
          else if(String(result.status).startsWith('duplicate'))duplicates++;
          else skipped++;
        }catch(error){
          failed++;
          results.push({channel:'IranImpex RSS',status:'failed',title:item.title,error:(error instanceof Error?error.message:String(error)).slice(0,400)});
        }
      }
    }else{
      failed++;
      results.push({channel:'IranImpex RSS',status:'feed_unavailable',error:String(feedResult.reason).slice(0,400)});
    }
    if(telegramResult.status==='fulfilled'){
      const html=new TextDecoder('utf-8').decode(telegramResult.value.bytes);
      const posts=parseTelegramPosts(html).slice(-40);
      for(const post of posts.slice(-MAX_TELEGRAM_ITEMS_PER_RUN)){
        try{
          const result=await ingestTelegramPost(sb,post);
          results.push({channel:'@Gomrok_news',message_id:post.id,...result});
          if(String(result.status).startsWith('pdf_saved')||String(result.status).startsWith('text_saved'))telegramIngested++;
          else if(String(result.status).startsWith('duplicate'))duplicates++;
          else skipped++;
        }catch(error){
          failed++;
          results.push({channel:'@Gomrok_news',message_id:post.id,status:'failed',title:post.title,error:(error instanceof Error?error.message:String(error)).slice(0,400)});
        }
      }
    }else{
      failed++;
      results.push({channel:'@Gomrok_news',status:'channel_unavailable',error:String(telegramResult.reason).slice(0,400)});
    }
    return json({
      status:'completed',
      feeds:[FEED_URL,TELEGRAM_PREVIEW_URL],
      rss_ingested:rssIngested,
      telegram_ingested:telegramIngested,
      duplicates,skipped,failed,
      results,
      note:'هر دو منبع به‌عنوان منابع ثانویه ثبت می‌شوند. فایل/پیام ابتدا در وضعیت نیازمند بررسی قرار می‌گیرد و بدون تطبیق با مرجع صادرکننده به مقرره قطعی تبدیل نمی‌شود.',
      checked_at:new Date().toISOString(),
    });
  }catch(error){
    return json({status:'failed',error:(error instanceof Error?error.message:String(error)).slice(0,1000)},500);
  }
});
