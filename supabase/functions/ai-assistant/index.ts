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

// Gemini and OpenAI use different schema dialects. Keep them separate so a
// provider-specific validation error cannot disable the entire extraction fallback chain.
const geminiSchemaFor = (keys:string[]) => ({
  type:'OBJECT',
  properties:Object.fromEntries(keys.map(k=>[k,{type:'STRING'}])),
  required:keys,
});
const openAiSchemaFor = (keys:string[]) => ({
  type:'object',
  properties:Object.fromEntries(keys.map(k=>[k,{type:'string'}])),
  required:keys,
  additionalProperties:false,
});
const parseJsonText = (text:string) => {
  const raw=String(text||'').replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(raw)}catch{
    const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
    if(a>=0&&b>a)return JSON.parse(raw.slice(a,b+1));
    throw new Error('AI returned non-JSON extraction output.');
  }
};

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
    const geminiKey=Deno.env.get('GEMINI_API_KEY')?.trim();
    const openaiKey=Deno.env.get('OPENAI_API_KEY')?.trim();
    const groqKey=Deno.env.get('GROQ_API_KEY')?.trim();
    if(!url||!anon) return json({error:'Supabase runtime configuration is missing.'},503,origin);
    if(!geminiKey&&!openaiKey&&!groqKey) return json({error:'No AI provider key is configured in Supabase Secrets.'},503,origin);

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
      if(!data)return;
      if(mime==='application/pdf'||mime.startsWith('image/')) parts.push({text:`نام سند: ${name||'سند'}`},{inline_data:{mime_type:mime,data}});
      else throw new Error(`نوع فایل ${name||''} پشتیبانی نمی‌شود؛ PDF یا تصویر ارسال کنید.`);
    };
    if(docText) parts.push({text:`DOCUMENT TEXT:\n${docText}`});
    if(docData) addFile(docData,docMime,'سند');
    for(const x of docs)addFile(strip(String(x?.data||x?.base64||'')),String(x?.mime_type||x?.mimeType||'').toLowerCase(),String(x?.name||'سند'));

    const prompt=ship
      ? 'تو مسئول استخراج اطلاعات اولیه محموله کشتیرانی در Customs OS هستی. فقط ownerName, shippingLine, vesselName, imo, count, unit, net, gross, billOfLading را استخراج کن. هیچ مقدار را حدس نزن؛ نبود یا ناخوانا دقیقاً xxxx. نام تجاری را ترجمه نکن. IMO فقط ۷ رقم. B/L عین سند. خروجی فقط JSON.'
      : extract
      ? 'تو مسئول استخراج ورود اطلاعات قبل اظهار برای سامانه گمرکی ایران هستی. همه صفحات و اسناد را بررسی و تطبیق بده. هیچ مقدار را حدس نزن؛ نبود یا ناخوانا دقیقاً xxxx. شناسه‌های رسمی عیناً. وزن‌ها دقیق. همه فیلدها همیشه برگردند. خروجی فقط JSON.'
      : (query||'این اسناد را برای عملیات گمرکی تحلیل کن.');
    parts.unshift({text:prompt});
    const schemaKeys=ship?shipmentFields:(extract?fields:[]);

    const callGemini=async()=>{
      if(!geminiKey)throw new Error('Gemini key is not configured');
      const generationConfig:any={};
      if(schemaKeys.length){generationConfig.response_mime_type='application/json';generationConfig.response_schema=geminiSchemaFor(schemaKeys);}
      const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{method:'POST',headers:{'x-goog-api-key':geminiKey,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts}],systemInstruction:{parts:[{text:`You are Customs OS AI for Iranian customs clearance. User role: ${profile.role}. Never invent official identifiers.`}]},generationConfig})});
      const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{d={raw:raw.slice(0,2000)}}
      if(!r.ok)throw new Error(String(d?.error?.message||d?.message||d?.raw||`Gemini HTTP ${r.status}`));
      return {answer:textOf(d),provider:'gemini'};
    };

    const openaiParts:any[]=[];
    if(docText)openaiParts.push({type:'input_text',text:`DOCUMENT TEXT:\n${docText}`});
    if(docData){openaiParts.push({type:'input_file',filename:'document',file_data:`data:${docMime};base64,${docData}`});}
    for(const x of docs){const data=strip(String(x?.data||x?.base64||''));const mime=String(x?.mime_type||x?.mimeType||'application/pdf').toLowerCase();if(data)openaiParts.push({type:'input_file',filename:String(x?.name||'document'),file_data:`data:${mime};base64,${data}`});}
    openaiParts.unshift({type:'input_text',text:prompt});
    const callOpenAI=async()=>{
      if(!openaiKey)throw new Error('OpenAI key is not configured');
      const body:any={model:'gpt-4o-mini',input:[{role:'user',content:openaiParts}]};
      if(schemaKeys.length)body.text={format:{type:'json_schema',name:'customs_extraction',strict:true,schema:openAiSchemaFor(schemaKeys)}};
      const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{d={raw:raw.slice(0,2000)}}
      if(!r.ok)throw new Error(String(d?.error?.message||d?.message||d?.raw||`OpenAI HTTP ${r.status}`));
      const answer=String(d?.output_text||d?.output?.flatMap((o:any)=>o?.content||[]).map((c:any)=>c?.text||'').join('')||'').trim();
      return {answer,provider:'openai'};
    };

    const callGroq=async()=>{
      if(!groqKey)throw new Error('Groq key is not configured');
      const text=parts.filter(p=>p?.text).map(p=>p.text).join('\n');
      if(!text)throw new Error('Groq fallback requires document text; it cannot directly process the uploaded PDF here.');
      const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${groqKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:'You are Customs OS AI. Never invent official identifiers. Return JSON only when asked.'},{role:'user',content:text}],temperature:0})});
      const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{d={raw:raw.slice(0,2000)}}
      if(!r.ok)throw new Error(String(d?.error?.message||d?.message||d?.raw||`Groq HTTP ${r.status}`));
      return {answer:String(d?.choices?.[0]?.message?.content||''),provider:'groq'};
    };

    const attempts:string[]=[];
    const providers=[callGemini,callOpenAI,callGroq];
    let result:any=null;
    for(const provider of providers){try{result=await provider();if(result?.answer)break;}catch(e){attempts.push(e instanceof Error?e.message:String(e));}}
    if(!result?.answer)return json({error:`همه سرویس‌های AI ناموفق بودند: ${attempts.join(' | ')}`},502,origin);

    let answer=result.answer;
    if(schemaKeys.length){try{const parsed=parseJsonText(answer);answer=JSON.stringify(parsed);}catch{}}
    return json({answer,model:result.provider,status:'completed',provider:result.provider},200,origin);
  } catch(e) {
    console.error('ai-assistant fatal error',e);
    return json({error:e instanceof Error?e.message:'AI request failed'},500,origin);
  }
});
