import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://customs-os-psi.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://customs-os-psi.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
});

const fields = ['vesselType','regNumber','regDate','packageCount','warehouseReceiptNo','warehouseReceiptDate','cargoDescription','originCountry','transactionCountry','deliveryTerm','invoiceAmount','invoiceCurrency','bankBranchCode','bankName','bankBranch','lcNumber','dutyRate','tariffCode','netWeight','grossWeight','billOfLading','insuranceIrr','requiredDocuments'];
const shipmentFields = ['ownerName','shippingLine','vesselName','imo','count','unit','net','gross','billOfLading'];

function extractText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const texts: string[] = [];
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    for (const item of Array.isArray(step?.content) ? step.content : []) {
      if (item?.type === 'text' && typeof item.text === 'string') texts.push(item.text);
    }
  }
  for (const item of Array.isArray(data?.outputs) ? data.outputs : []) {
    if (item?.type === 'text' && typeof item.text === 'string') texts.push(item.text);
  }
  return texts.join('\n').trim();
}

const shipmentPrompt = `تو مسئول استخراج اطلاعات اولیه «محموله کشتیرانی» در Customs OS هستی.
همه اسناد و همه صفحات ارسالی را به عنوان یک مجموعه واحد بررسی و تطبیق بده.
فقط این ۹ فیلد را استخراج کن: ownerName=نام صاحب کالا، shippingLine=نام کشتیرانی، vesselName=نام کشتی، imo=شماره ۷ رقمی IMO، count=تعداد، unit=واحد واقعی، net=وزن خالص، gross=وزن ناخالص، billOfLading=شماره B/L.
هیچ مقدار را حدس نزن. مقدار ناموجود یا ناخوانا دقیقاً xxxx باشد. همه فیلدها همیشه برگردند. نام‌های تجاری را ترجمه نکن. IMO فقط ۷ رقم. شماره B/L عین اصل سند با حروف/اعداد و علائم اصلی. اگر اسناد اختلاف دارند، B/L و Packing List را مبنا قرار بده. هیچ شناسه داخلی مانند CASE تولید نکن. خروجی فقط JSON مطابق schema باشد.`;

const preDeclarationPrompt = `تو فقط مسئول استخراج «ورود اطلاعات قبل اظهار» برای سامانه گمرکی ایران هستی.
همه صفحات، جدول‌ها، سربرگ‌ها، پاورقی‌ها، مهرها و نوشته‌های خوانای اسناد را بررسی و بین اسناد تطبیق بده.
هیچ مقدار را حدس نزن؛ مقدار ناموجود یا ناخوانا دقیقاً xxxx باشد و هیچ فیلدی حذف نشود. خروجی فارسی باشد، اما شناسه‌ها و شماره‌های رسمی عین سند حفظ شوند. شرح کالا فقط بر اساس خود سند باشد و کد تعرفه یا توضیح ساختگی داخل آن نیاید. نوع کشتی فقط ایرانی/خارجی یا xxxx. ثبت سفارش و تاریخ فقط از سند ثبت سفارش. تعداد از Packing List. قبض انبار فقط از قبض انبار. کشورها فقط از اسناد. شرایط تحویل عین سند. مبلغ و ارز از Commercial Invoice. اطلاعات بانکی فقط از اسناد و در صورت روش TT/نقدی شماره اعتبار اسنادی --- باشد. ماخذ حقوق ورودی فقط از ثبت سفارش. کد تعرفه عین ثبت سفارش. وزن‌ها از اسناد و واحد کیلوگرم. شماره B/L عین اصل. بیمه ریالی فقط از اسناد؛ در صورت نیاز محاسبه متناسب با وزن وارداتی. مدارک موردنیاز فقط از فهرست ثبت سفارش، اینویس، پروفرما، بیمه‌نامه، پکینگ لیست، اطلاعات بانکی و گواهی بازرسی؛ ترخیصیه، بارنامه و قبض انبار را درخواست نکن. خروجی فقط JSON مطابق schema و همه ۲۳ فیلد الزامی باشند.`;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://customs-os-psi.vercel.app',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json({ error: 'Unauthorized: Supabase session is missing.' }, 401, origin);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
    if (!supabaseUrl || !supabaseAnonKey) return json({ error: 'Supabase runtime configuration is missing.' }, 503, origin);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: 'Unauthorized: invalid Supabase session.' }, 401, origin);

    const key = Deno.env.get('GEMINI_API_KEY')?.trim();
    if (!key) return json({ error: 'GEMINI_API_KEY is missing in Supabase Secrets.' }, 503, origin);

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || '').slice(0, 20000);
    const documentText = String(body?.document_text || '').slice(0, 120000);
    const documentData = String(body?.document_data || '').replace(/^data:[^;]+;base64,/, '');
    const documentMime = String(body?.document_mime_type || '').trim().toLowerCase();
    const documents = Array.isArray(body?.documents) ? body.documents : [];
    const pageContext = String(body?.page_context || '').slice(0, 1000);
    const extractFields = Boolean(body?.extract_fields);
    const shipmentExtract = Boolean(body?.shipment_extract) || query.includes('اطلاعات محموله کشتیرانی');
    if (!query && !documentText && !documentData && !documents.length) return json({ error: 'No query or document was supplied.' }, 400, origin);

    const totalSize = documents.reduce((n: number, d: any) => n + String(d?.data || '').length, 0) + documentData.length;
    if (totalSize > 45000000) return json({ error: 'حجم مجموع اسناد برای ارسال به هوش مصنوعی بیش از حد مجاز است. اسناد را در چند نوبت ارسال کنید.' }, 413, origin);

    const system = `You are Customs OS AI for Iranian customs clearance. Follow extraction rules literally. Never invent values. Preserve official identifiers exactly. Current section: ${pageContext}`;
    const prompt = shipmentExtract ? shipmentPrompt : (extractFields ? preDeclarationPrompt : (query || 'این اسناد را برای عملیات گمرکی تحلیل کن.'));
    const input: any[] = [{ type: 'text', text: prompt }];
    if (documentText) input.push({ type: 'text', text: `DOCUMENT TEXT:\n${documentText}` });
    if (documentData) {
      if (documentMime === 'application/pdf') input.push({ type: 'document', data: documentData, mime_type: 'application/pdf' });
      else if (documentMime.startsWith('image/')) input.push({ type: 'image', data: documentData, mime_type: documentMime });
      else return json({ error: 'نوع فایل پشتیبانی نمی‌شود. PDF یا تصویر ارسال کنید.' }, 415, origin);
    }
    for (const d of documents) {
      const data = String(d?.data || '').replace(/^data:[^;]+;base64,/, '');
      const mime = String(d?.mime_type || '').toLowerCase();
      if (!data) continue;
      if (mime === 'application/pdf') input.push({ type: 'text', text: `نام سند: ${String(d?.name || 'سند')}` }, { type: 'document', data, mime_type: 'application/pdf' });
      else if (mime.startsWith('image/')) input.push({ type: 'text', text: `نام سند: ${String(d?.name || 'سند')}` }, { type: 'image', data, mime_type: mime });
      else return json({ error: `نوع فایل ${String(d?.name || '')} پشتیبانی نمی‌شود.` }, 415, origin);
    }

    const payload: any = {
      model: 'gemini-3.5-flash-lite',
      input,
      system_instruction: system,
      // Customs documents are sensitive. Do not ask Gemini to persist interaction/document data.
      store: false,
    };
    const schemaFields = shipmentExtract ? shipmentFields : (extractFields ? fields : []);
    if (schemaFields.length) payload.response_format = {
      type: 'text',
      mime_type: 'application/json',
      schema: { type: 'object', properties: Object.fromEntries(schemaFields.map(k => [k, { type: 'string' }])), required: schemaFields, additionalProperties: false },
    };

    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await r.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 3000) }; }
    if (!r.ok) {
      const msg = String(data?.error?.message || data?.message || data?.raw || `Gemini HTTP ${r.status}`);
      return json({ error: `Gemini error: ${msg}` }, 502, origin);
    }
    const answer = extractText(data) || 'پاسخ خالی از Gemini دریافت شد.';
    return json({ answer, model: 'gemini-3.5-flash-lite', interaction_id: null, status: data?.status || null }, 200, origin);
  } catch (e) {
    console.error('ai-assistant fatal error', e);
    return json({ error: e instanceof Error ? e.message : 'AI request failed' }, 500, origin);
  }
});
