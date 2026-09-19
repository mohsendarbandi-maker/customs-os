import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://customs-os-psi.vercel.app',
  'https://customs.mohsen-darbandi.workers.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const fields = ['vesselType','regNumber','regDate','packageCount','warehouseReceiptNo','warehouseReceiptDate','cargoDescription','originCountry','transactionCountry','deliveryTerm','invoiceAmount','invoiceCurrency','bankBranchCode','bankName','bankBranch','lcNumber','dutyRate','tariffCode','netWeight','grossWeight','billOfLading','insuranceIrr','requiredDocuments'];
const shipmentFields = ['ownerName','shippingLine','vesselName','imo','count','unit','net','gross','billOfLading'];

const cors = (origin:string) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://customs.mohsen-darbandi.workers.dev',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});
const json = (body:unknown, status=200, origin='') => new Response(JSON.stringify(body), {
  status, headers: {...cors(origin), 'Content-Type':'application/json', 'Cache-Control':'no-store'}
});
const textOf = (d:any) => d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').filter(Boolean).join('\n').trim() || '';
const strip = (v:string) => v.replace(/^data:[^;]+;base64,/,'');
const schemaFor = (keys:string[]) => ({
  type:'OBJECT',
  properties:Object.fromEntries(keys.map(k=>[k,{type:'STRING'}])),
  required:keys,
  additionalProperties:false
});

Deno.serve(async(req)=>{
  const origin=req.headers.get('Origin')||'';
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors(origin)});
  if(req.method!=='POST') return json({error:'Method not allowed.'},405,origin);

  try {
    const auth=req.headers.get('Authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
    if(!token) return json({error:'Unauthorized: Supabase session is missing.'},401,origin);

    const url=Deno.env.get('SUPABASE_URL')?.trim();
    const anon=Deno.env.get('SUPABASE_ANON_KEY')?.trim();
    const key=Deno.env.get('GEMINI_API_KEY')?.trim();
    if(!url||!anon) return json({error:'Supabase runtime configuration is missing.'},503,origin);
    if(!key) return json({error:'GEMINI_API_KEY is missing in Supabase Secrets.'},503,origin);

    const sb=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}});
    const {data:{user},error:ue}=await sb.auth.getUser(token);
    if(ue||!user) return json({error:'Unauthorized: invalid Supabase session.'},401,origin);

    const {data:profile}=await sb.from('profiles').select('id,organization_id,role,is_active').eq('id',user.id).maybeSingle();
    if(!profile||profile.is_active===false) return json({error:'پروفایل کاربر معتبر یا فعال نیست.'},403,origin);

    const b=await req.json().catch(()=>({}));
    const query=String(b?.query||'').slice(0,20000);
    const docText=String(b?.document_text||'').slice(0,120000);
    const docData=strip(String(b?.document_data||''));
    const docMime=String(b?.document_mime_type||'').toLowerCase();
    const docs=Array.isArray(b?.documents)?b.documents:[];
    const extract=Boolean(b?.extract_fields);
    const ship=Boolean(b?.shipment_extract)||query.includes('اطلاعات محموله کشتیرانی');

    if(!query&&!docText&&!docData&&!docs.length) return json({error:'No query or document was supplied.'},400,origin);

    const parts:any[]=[];
    const addFile=(data:string,mime:string,name:string)=>{
      if(!data) return;
      if(mime==='application/pdf'||mime.startsWith('image/')){
        parts.push({text:`نام سند: ${name||'سند'}`},{inline_data:{mime_type:mime,data}});
      } else throw new Error(`نوع فایل ${name||''} پشتیبانی نمی‌شود؛ PDF یا تصویر ارسال کنید.`);
    };
    if(docText) parts.push({text:`DOCUMENT TEXT:\n${docText}`});
    if(docData) addFile(docData,docMime,'سند');
    for(const x of docs){
      addFile(strip(String(x?.data||x?.base64||'')),String(x?.mime_type||x?.mimeType||'').toLowerCase(),String(x?.name||'سند'));
    }

    const prompt=ship
      ? 'تو مسئول استخراج اطلاعات اولیه محموله کشتیرانی در Customs OS هستی. فقط ownerName, shippingLine, vesselName, imo, count, unit, net, gross, billOfLading را استخراج کن. هیچ مقدار را حدس نزن؛ نبود یا ناخوانا دقیقاً xxxx. نام تجاری را ترجمه نکن. IMO فقط ۷ رقم. B/L عین سند. خروجی فقط JSON.'
      : extract
      ? 'تو مسئول استخراج ورود اطلاعات قبل اظهار برای سامانه گمرکی ایران هستی. همه صفحات و اسناد را بررسی و تطبیق بده. هیچ مقدار را حدس نزن؛ نبود یا ناخوانا دقیقاً xxxx. شناسه‌های رسمی عیناً. وزن‌ها دقیق. همه فیلدها همیشه برگردند. خروجی فقط JSON.'
      : (query||'این اسناد را برای عملیات گمرکی تحلیل کن.');

    parts.unshift({text:prompt});
    const schemaKeys=ship?shipmentFields:(extract?fields:[]);

    const callGemini=async(useSchema:boolean)=>{
      const generationConfig:any={};
      if(useSchema&&schemaKeys.length){
        generationConfig.response_mime_type='application/json';
        generationConfig.response_schema=schemaFor(schemaKeys);
      }
      const payload:any={
        contents:[{role:'user',parts}],
        systemInstruction:{parts:[{text:`You are Customs OS AI for Iranian customs clearance. User role: ${profile.role}. Never invent official identifiers.`}]},
        generationConfig
      };
      const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{
        method:'POST',
        headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const raw=await r.text();
      let d:any={}; try{d=JSON.parse(raw)}catch{d={raw:raw.slice(0,2000)}}
      return {r,d};
    };

    let result=await callGemini(Boolean(schemaKeys.length));
    if(!result.r.ok && schemaKeys.length){
      result=await callGemini(false);
    }
    if(!result.r.ok){
      const msg=String(result.d?.error?.message||result.d?.message||result.d?.raw||`HTTP ${result.r.status}`);
      return json({error:`Gemini error: ${msg}`,provider_status:result.r.status},502,origin);
    }

    return json({
      answer:textOf(result.d)||'پاسخ خالی از Gemini دریافت شد.',
      model:result.d?.modelVersion||'gemini-3.6-flash',
      status:'completed'
    },200,origin);
  } catch(e) {
    console.error('ai-assistant fatal error',e);
    return json({error:e instanceof Error?e.message:'AI request failed'},500,origin);
  }
});
