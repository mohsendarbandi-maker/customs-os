import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowed=new Set([
  'https://customs-os-psi.vercel.app',
  'https://customs.mohsen-darbandi.workers.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
const cors=(origin:string)=>({
  'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://customs.mohsen-darbandi.workers.dev',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Vary':'Origin'
});
const reply=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{
  status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}
});
const clean=(v:any)=>String(v??'').trim();
const validRole=(role:string)=>['owner','admin','broker'].includes(role);

async function geminiJson(prompt:string,mime:string,data:string,key:string){
  const schema={
    type:'object',
    properties:{
      title:{type:'string'},
      source_type:{type:'string',enum:['law','circular','instruction','notice','tariff','ruling','guide','other']},
      source_number:{type:['string','null']},
      issued_at:{type:['string','null'],description:'ISO date YYYY-MM-DD if explicitly present'},
      effective_at:{type:['string','null'],description:'ISO date YYYY-MM-DD if explicitly present'},
      issuer:{type:['string','null']},
      subject:{type:['string','null']},
      keywords:{type:'array',items:{type:'string'}},
      summary:{type:'string'},
      extracted_text:{type:'string'},
      chunks:{type:'array',items:{type:'object',properties:{
        page_number:{type:['integer','null']},
        content:{type:'string'}
      },required:['page_number','content']}}
    },
    required:['title','source_type','source_number','issued_at','effective_at','issuer','subject','keywords','summary','extracted_text','chunks']
  };
  const body={
    contents:[{role:'user',parts:[
      {text:prompt},
      {inline_data:{mime_type:mime,data}}
    ]}],
    generationConfig:{
      responseMimeType:'application/json',
      responseSchema:schema,
      temperature:0
    }
  };
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',{
    method:'POST',
    headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(d?.error?.message||'Gemini HTTP '+r.status);
  const txt=String(d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('')||'').trim();
  if(!txt)throw new Error('Gemini خروجی استخراج نداد.');
  try{return JSON.parse(txt)}catch{throw new Error('خروجی ساختاریافته AI قابل خواندن نبود.')}
}

async function embed(text:string,key:string){
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{
    method:'POST',
    headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({
      content:{parts:[{text:text.slice(0,30000)}]},
      output_dimensionality:1536
    })
  });
  const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(d?.error?.message||'Embedding HTTP '+r.status);
  const v=d?.embedding?.values;
  if(!Array.isArray(v)||v.length!==1536)throw new Error('Embedding نامعتبر است.');
  return v;
}

Deno.serve(async(req)=>{
  const origin=req.headers.get('Origin')||'';
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405,origin);
  try{
    const auth=req.headers.get('Authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
    if(!token)return reply({error:'Unauthorized'},401,origin);
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),geminiKey=Deno.env.get('GEMINI_API_KEY');
    if(!url||!anon||!geminiKey)return reply({error:'Supabase/Gemini configuration missing'},503,origin);
    const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
    const {data:{user}}=await sb.auth.getUser(token);if(!user)return reply({error:'Unauthorized'},401,origin);
    const {data:profile}=await sb.from('profiles').select('organization_id,role,is_active').eq('id',user.id).maybeSingle();
    if(!profile||profile.is_active===false||!validRole(profile.role))return reply({error:'دسترسی کافی نیست.'},403,origin);
    const b=await req.json().catch(()=>({}));const action=clean(b.action||'extract');

    if(action==='extract'){
      const mime=clean(b.document_mime_type).toLowerCase();
      const data=clean(b.document_data);
      const filename=clean(b.filename);
      if(!data||!['application/pdf','text/plain','text/markdown'].includes(mime)&&!mime.startsWith('image/'))return reply({error:'نوع فایل پشتیبانی نمی‌شود.'},400,origin);
      if(data.length>35_000_000)return reply({error:'حجم فایل برای پردازش AI بیش از حد مجاز است.'},413,origin);
      const result=await geminiJson(
        'این فایل یک سند حقوقی/گمرکی/تجاری است. آن را برای ورود به مرکز دانش Customs OS بررسی کن. فقط اطلاعاتی را که صراحتاً در سند وجود دارد استخراج کن و هیچ قانون، شماره، تاریخ، مرجع یا تفسیر حقوقی جدید نساز. عنوان و نوع سند را از خود سند تشخیص بده. شماره و تاریخ‌ها را دقیق نگه دار. متن کامل قابل استناد را حفظ کن. chunks باید بر اساس صفحه باشند؛ اگر صفحه مشخص نیست page_number را null بگذار. summary فقط خلاصه سند باشد، نه توصیه حقوقی. نام فایل: '+filename,
        mime,data,geminiKey
      );
      return reply({status:'extracted',model:'gemini-3.8-flash',extraction:result},200,origin);
    }

    const sourceId=clean(b.source_id);
    if(!sourceId)return reply({error:'source_id الزامی است.'},400,origin);
    const {data:source,error:se}=await sb.from('knowledge_sources').select('*').eq('id',sourceId).eq('organization_id',profile.organization_id).maybeSingle();
    if(se||!source)return reply({error:'منبع پیدا نشد.'},404,origin);

    if(action==='approve'||action==='reject'){
      if(!['owner','admin'].includes(profile.role))return reply({error:'تأیید/رد منبع فقط برای مالک یا مدیر مجاز است.'},403,origin);
    }

    if(action==='reject'){
      const {error}=await sb.from('knowledge_sources').update({
        status:'rejected',reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_note:clean(b.note)||'رد شده در بررسی انسانی'
      }).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(error)throw error;
      return reply({status:'rejected',source_id:sourceId},200,origin);
    }

    if(action==='approve'){
      const {error:ue}=await sb.from('knowledge_sources').update({
        status:'active',reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_note:clean(b.note)||null
      }).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(ue)throw ue;
      await sb.from('knowledge_chunks').delete().eq('source_id',sourceId).eq('organization_id',profile.organization_id);
      const chunks=Array.isArray(source.ai_extraction?.chunks)?source.ai_extraction.chunks:[];
      if(!chunks.length)throw new Error('برای انتشار، chunk قابل استناد وجود ندارد.');
      let embedded=0;
      for(let i=0;i<chunks.length;i++){
        const c=chunks[i];const content=clean(c?.content);if(!content)continue;
        const vector=await embed(content,geminiKey);
        const {error:ie}=await sb.from('knowledge_chunks').insert({
          organization_id:profile.organization_id,source_id:sourceId,chunk_index:i,content,page_number:Number.isInteger(c?.page_number)?c.page_number:null,embedding:vector,metadata:{embedding_model:'gemini-embedding-2',embedding_dimensions:1536}
        });
        if(ie)throw ie;
        embedded++;
      }
      return reply({status:'active',source_id:sourceId,embedded_chunks:embedded,embedding_model:'gemini-embedding-2'},200,origin);
    }

    return reply({error:'Unknown action'},400,origin);
  }catch(e){
    console.error(e);
    return reply({error:e instanceof Error?e.message:'Knowledge AI failed'},500,origin);
  }
});