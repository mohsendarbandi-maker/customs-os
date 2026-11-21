import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const allowed=new Set([
  'https://darbandicommercial.ir',
  'https://www.darbandicommercial.ir',
  'https://mobile.darbandicommercial.ir',
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

async function geminiJson(prompt:string,mime:string,data:string,key:string):Promise<{extraction:any;model:string}>{
  const schema={
    type:'object',
    properties:{
      title:{type:'string'},
      source_type:{type:'string',enum:['law','circular','instruction','notice','tariff','ruling','guide','other']},
      source_number:{type:'string',nullable:true},
      issued_at:{type:'string',nullable:true,description:'ISO date YYYY-MM-DD if explicitly present'},
      effective_at:{type:'string',nullable:true,description:'ISO date YYYY-MM-DD if explicitly present'},
      issuer:{type:'string',nullable:true},
      subject:{type:'string',nullable:true},
      keywords:{type:'array',items:{type:'string'}},
      summary:{type:'string'},
      extracted_text:{type:'string'},
      chunks:{type:'array',items:{type:'object',properties:{
        page_number:{type:'integer',nullable:true},
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
  // Prefer the lighter model and fall back to the previous production model.
  // Secondary Gemini keys are optional and are never returned to the caller.
  const models=['gemini-3.5-flash-lite','gemini-3.8-flash'];
  const keys=[...new Set([
    key,
    ...Array.from({length:10},(_,index)=>Deno.env.get('GEMINI_API_KEY_'+(index+1))||'')
  ].map(clean).filter(Boolean))].slice(0,2);
  const failures:string[]=[];
  for(const model of models){
    for(const candidateKey of keys){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        const controller=new AbortController();
        timer=setTimeout(()=>controller.abort(),18000);
        const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
          method:'POST',
          headers:{'x-goog-api-key':candidateKey,'Content-Type':'application/json'},
          body:JSON.stringify(body),
          signal:controller.signal
        });
        const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{}
        if(r.ok){
          const txt=String(d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||'').join('')||'').trim();
          if(txt){
            try{return {extraction:JSON.parse(txt),model};}
            catch(parseError){failures.push(model+': خروجی JSON نامعتبر بود: '+(parseError instanceof Error?parseError.message:String(parseError)));continue;}
          }
          failures.push(model+': خروجی متنی خالی بود.');
          continue;
        }
        const detail=String(d?.error?.message||'Gemini HTTP '+r.status).trim();
        failures.push(model+' HTTP '+r.status+': '+detail);
      }catch(error){
        failures.push(model+': '+(error instanceof Error?error.message:String(error)));
      }finally{
        if(timer)clearTimeout(timer);
      }
    }
  }
  throw new Error('استخراج PDF با مدل اصلی و مدل جایگزین Gemini ناموفق شد. فایل در دانشنامه ذخیره است؛ از فهرست پیش‌نویس‌ها ادامه دهید. '+failures.slice(-4).join(' | '));
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


function bytesToBase64(bytes:Uint8Array):string{
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000){
  binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));
 }
 return btoa(binary);
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
      let mime=clean(b.document_mime_type).toLowerCase();
      let data=clean(b.document_data);
      let filename=clean(b.filename);
      const storagePath=clean(b.storage_path);
      const sourceId=clean(b.source_id);
      let storedSource:any=null;
      let fileBlob:Blob|null=null;
      if(storagePath){
        if(!sourceId)return reply({error:'برای استخراج فایل ذخیره‌شده، شناسه منبع دانشنامه الزامی است.'},400,origin);
        const safePrefix=String(profile.organization_id||'')+'/';
        if(!safePrefix||!storagePath.startsWith(safePrefix)||storagePath.includes('..')||storagePath.startsWith('/'))return reply({error:'مسیر فایل خارج از فضای سازمان کاربر است.'},403,origin);
        const {data:source,error:sourceError}=await sb.from('knowledge_sources').select('id,organization_id,status,storage_path,mime_type,metadata,title,ai_extraction').eq('id',sourceId).eq('organization_id',profile.organization_id).maybeSingle();
        if(sourceError)throw sourceError;
        if(!source||source.storage_path!==storagePath)return reply({error:'فایل با منبع دانشنامه تطابق ندارد.'},404,origin);
        if(!['draft','pending_review'].includes(String(source.status)))return reply({error:'وضعیت این منبع برای استخراج مجدد مجاز نیست.'},409,origin);
        storedSource=source;
        const {data:downloaded,error:downloadError}=await sb.storage.from('customs-knowledge').download(storagePath);
        if(downloadError||!downloaded)return reply({error:downloadError?.message||'دریافت نسخه ذخیره‌شده فایل ناموفق بود.'},404,origin);
        if(downloaded.size<=0||downloaded.size>25*1024*1024)return reply({error:'حجم فایل ذخیره‌شده باید بین ۱ بایت تا ۲۵ مگابایت باشد.'},413,origin);
        fileBlob=downloaded;
        mime=String(source.mime_type||mime||downloaded.type||'').toLowerCase();
        filename=String(source.metadata?.filename||source.title||filename||'document');
      }else{
        if(!data||!['application/pdf','text/plain','text/markdown'].includes(mime)&&!mime.startsWith('image/'))return reply({error:'نوع فایل پشتیبانی نمی‌شود.'},400,origin);
        if(data.length>35_000_000)return reply({error:'حجم فایل برای پردازش AI بیش از حد مجاز است.'},413,origin);
      }
      if(mime==='application/pdf'&&fileBlob&&storedSource){
        const pdf=await PDFDocument.load(new Uint8Array(await fileBlob.arrayBuffer()),{ignoreEncryption:true});
        const totalPages=pdf.getPageCount();
        if(totalPages<1)return reply({error:'فایل PDF هیچ صفحه‌ای ندارد.'},422,origin);
        const previous=storedSource.ai_extraction&&typeof storedSource.ai_extraction==='object'?storedSource.ai_extraction:{};
        const progress=previous.__progress&&typeof previous.__progress==='object'?previous.__progress:{};
        const startPage=Math.max(1,Math.min(totalPages,Number(progress.processed_pages||0)+1));
        const endPage=Math.min(totalPages,startPage+2);
        const batchPdf=await PDFDocument.create();
        const copied=await batchPdf.copyPages(pdf,Array.from({length:endPage-startPage+1},(_,i)=>startPage-1+i));
        copied.forEach(page=>batchPdf.addPage(page));
        const batchBase64=bytesToBase64(await batchPdf.save());
        const extractionResult=await geminiJson(
          'این فایل فقط شامل بخشی از یک سند حقوقی/گمرکی/تجاری است. صفحات این فایل به ترتیب متناظر با صفحات اصلی PDF از '+startPage+' تا '+endPage+' هستند. شماره page_number را بر اساس شماره صفحه اصلی PDF ثبت کن. صفحات اسکن‌شده و تصویرمحور را با خواندن بصری متن، جدول‌ها، مهرها، سربرگ و پاورقی بررسی کن؛ متن ناخوانا را حدس نزن و مقدار ناموجود را خالی بگذار. فقط اطلاعات صریح سند را استخراج کن و هیچ قانون، شماره، تاریخ یا تفسیر حقوقی نساز. متن قابل استناد همین صفحات را حفظ کن. chunks را به تفکیک صفحه بساز. خلاصه فقط خلاصه همین صفحات باشد. نام فایل: '+filename,
          'application/pdf',batchBase64,geminiKey
        );
        const extracted=extractionResult.extraction;
        const oldChunks=Array.isArray(previous.chunks)?previous.chunks:[];
        const newChunks=Array.isArray(extracted.chunks)?extracted.chunks.map((c:any)=>({page_number:Number.isInteger(c?.page_number)?Math.max(startPage,Math.min(endPage,Number(c.page_number))):startPage,content:clean(c?.content)})).filter((c:any)=>c.content):[];
        const combined={
          title:clean(previous.title)||clean(extracted.title)||filename,
          source_type:clean(previous.source_type)||clean(extracted.source_type)||'other',
          source_number:previous.source_number??extracted.source_number??null,
          issued_at:previous.issued_at??extracted.issued_at??null,
          effective_at:previous.effective_at??extracted.effective_at??null,
          issuer:previous.issuer??extracted.issuer??null,
          subject:previous.subject??extracted.subject??null,
          keywords:[...new Set([...(Array.isArray(previous.keywords)?previous.keywords:[]),...(Array.isArray(extracted.keywords)?extracted.keywords:[])].map(clean).filter(Boolean))],
          summary:[clean(previous.summary),clean(extracted.summary)].filter(Boolean).join('\n'),
          extracted_text:[clean(previous.extracted_text),clean(extracted.extracted_text)].filter(Boolean).join('\n\n'),
          chunks:[...oldChunks,...newChunks]
        };
        if(endPage<totalPages){
          const {error:saveError}=await sb.from('knowledge_sources').update({ai_extraction:{...combined,__progress:{processed_pages:endPage,total_pages:totalPages}},extracted_text:combined.extracted_text}).eq('id',sourceId).eq('organization_id',profile.organization_id);
          if(saveError)throw saveError;
          return reply({status:'processing',source_id:sourceId,progress:{processed_pages:endPage,total_pages:totalPages,batch_start:startPage,batch_end:endPage}},200,origin);
        }
        const {error:saveError}=await sb.from('knowledge_sources').update({ai_extraction:combined,extracted_text:combined.extracted_text}).eq('id',sourceId).eq('organization_id',profile.organization_id);
        if(saveError)throw saveError;
        return reply({status:'extracted',model:extractionResult.model,extraction:combined,source_id:sourceId,extraction_input:'private_storage',progress:{processed_pages:endPage,total_pages:totalPages}},200,origin);
      }
      if(!data&&fileBlob)data=bytesToBase64(new Uint8Array(await fileBlob.arrayBuffer()));
      if(!data)return reply({error:'محتوای فایل برای استخراج خالی است.'},400,origin);
      const extractionResult=await geminiJson('این فایل یک سند حقوقی/گمرکی/تجاری است. اگر PDF اسکن‌شده یا تصویرمحور است، متن را از روی تصویر صفحه نیز بخوان و جدول‌ها، مهرها، سربرگ و پاورقی را بررسی کن؛ هیچ بخش ناخوانایی را حدس نزن. فقط اطلاعات صریح سند را استخراج کن و هیچ قانون، شماره، تاریخ، مرجع یا تفسیر حقوقی جدید نساز. متن کامل قابل استناد را حفظ کن. chunks را بر اساس صفحه بساز و اگر صفحه مشخص نیست null بگذار. نام فایل: '+filename,mime,data,geminiKey);
      return reply({status:'extracted',model:extractionResult.model,extraction:extractionResult.extraction,source_id:sourceId||null,extraction_input:storagePath?'private_storage':'browser_upload'},200,origin);
    }

    const sourceId=clean(b.source_id);
    if(!sourceId)return reply({error:'source_id الزامی است.'},400,origin);
    const {data:source,error:se}=await sb.from('knowledge_sources').select('*').eq('id',sourceId).eq('organization_id',profile.organization_id).maybeSingle();
    if(se||!source)return reply({error:'منبع پیدا نشد.'},404,origin);

    if(action==='approve'||action==='reject'){
      if(!['owner','admin'].includes(profile.role))return reply({error:'تأیید/رد منبع فقط برای مالک یا مدیر مجاز است.'},403,origin);
    }


    if(action==='qa'){
      const extraction=source.ai_extraction||{};
      const raw=Array.isArray(extraction.chunks)?extraction.chunks:[];
      const chunks=raw.map((c:any,i:number)=>({i,content:clean(c?.content),page:Number.isInteger(c?.page_number)?c.page_number:null})).filter((c:any)=>c.content);
      const normalized=chunks.map((c:any)=>c.content.replace(/\\s+/g,' ').trim().toLowerCase());
      const duplicates=normalized.length-new Set(normalized).size;
      const shortChunks=chunks.filter((c:any)=>c.content.length<80).length;
      const pages=[...new Set(chunks.map((c:any)=>c.page).filter((x:any)=>x!==null))].sort((a:any,b:any)=>a-b);
      const extractedChars=clean(extraction.extracted_text).length;
      const chunkChars=chunks.reduce((n:number,c:any)=>n+c.content.length,0);
      const warnings:string[]=[];
      if(!chunks.length)warnings.push('هیچ قطعه متنی استخراج نشده است.');
      if(extractedChars<500)warnings.push('متن کامل استخراج‌شده کمتر از ۵۰۰ نویسه است.');
      if(chunkChars<500)warnings.push('حجم متن قطعه‌بندی‌شده کمتر از ۵۰۰ نویسه است.');
      if(duplicates>0)warnings.push(duplicates+' قطعه تکراری شناسایی شد.');
      if(shortChunks>Math.max(2,Math.ceil(chunks.length*0.2)))warnings.push('تعداد قطعات بسیار کوتاه زیاد است.');
      if(pages.length===0)warnings.push('شماره صفحه برای هیچ قطعه‌ای ثبت نشده است.');
      return reply({status:'qa_complete',passed:chunks.length>0&&extractedChars>=500&&chunkChars>=500&&duplicates===0,source_id:sourceId,metrics:{
        raw_chunks:raw.length,nonempty_chunks:chunks.length,unique_pages:pages.length,
        first_page:pages[0]??null,last_page:pages[pages.length-1]??null,
        extracted_chars:extractedChars,chunk_chars:chunkChars,duplicate_chunks:duplicates,
        short_chunks:shortChunks
      },warnings,limitations:['این کنترل، کیفیت ساختاری متن و فراداده را می‌سنجد؛ صحت OCR و تطابق کامل متن با تصویر تمام صفحات باید با نمونه‌خوانی انسانی تأیید شود.']},200,origin);
    }

    if(action==='reject'){
      const {error}=await sb.from('knowledge_sources').update({
        status:'rejected',reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_note:clean(b.note)||'رد شده در بررسی انسانی'
      }).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(error)throw error;
      return reply({status:'rejected',source_id:sourceId},200,origin);
    }

    if(action==='approve'){
      if(!['owner','admin'].includes(profile.role))return reply({error:'تأیید/انتشار فقط برای مالک یا مدیر مجاز است.'},403,origin);
      const raw=Array.isArray(source.ai_extraction?.chunks)?source.ai_extraction.chunks:[];
      const normalized:any[]=[];
      for(let i=0;i<raw.length;i++){
        const content=clean(raw[i]?.content);
        if(!content)continue;
        const page=Number.isInteger(raw[i]?.page_number)?raw[i].page_number:null;
        const max=5000;
        for(let offset=0;offset<content.length;offset+=max){
          const part=content.slice(offset,Math.min(offset+max,content.length)).trim();
          if(part)normalized.push({chunk_index:normalized.length,content:part,page_number:page,part_index:Math.floor(offset/max)});
        }
      }
      if(!normalized.length)throw new Error('برای انتشار، قطعه متنی قابل استناد وجود ندارد.');
      const {error:pendingError}=await sb.from('knowledge_sources').update({status:'pending_review',review_note:'در حال ایندکس‌گذاری برداری'}).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(pendingError)throw pendingError;
      const {data:existing,error:existingError}=await sb.from('knowledge_chunks').select('chunk_index,embedding').eq('source_id',sourceId).eq('organization_id',profile.organization_id);
      if(existingError)throw existingError;
      const done=new Set((existing||[]).filter((x:any)=>x.embedding!==null).map((x:any)=>x.chunk_index));
      const missing=normalized.filter((x:any)=>!done.has(x.chunk_index));
      const batch=missing.slice(0,4);
      for(const c of batch){
        const vector=await embed(c.content,geminiKey);
        const {error:upsertError}=await sb.from('knowledge_chunks').upsert({
          organization_id:profile.organization_id,source_id:sourceId,chunk_index:c.chunk_index,
          content:c.content,page_number:c.page_number,embedding:vector,
          metadata:{embedding_model:'gemini-embedding-2',embedding_dimensions:1536,part_index:c.part_index}
        },{onConflict:'source_id,chunk_index'});
        if(upsertError)throw upsertError;
      }
      const {data:verified,error:verifyError}=await sb.from('knowledge_chunks').select('chunk_index,embedding').eq('source_id',sourceId).eq('organization_id',profile.organization_id);
      if(verifyError)throw verifyError;
      const verifiedSet=new Set((verified||[]).filter((x:any)=>x.embedding!==null).map((x:any)=>x.chunk_index));
      const remaining=normalized.filter((x:any)=>!verifiedSet.has(x.chunk_index)).length;
      const metadata={...(source.metadata||{}),indexing:{
        model:'gemini-embedding-2',dimensions:1536,total_chunks:normalized.length,
        embedded_chunks:verifiedSet.size,remaining_chunks:remaining,updated_at:new Date().toISOString()
      }};
      const {error:metaError}=await sb.from('knowledge_sources').update({metadata}).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(metaError)throw metaError;
      if(remaining>0)return reply({status:'indexing',source_id:sourceId,embedded_chunks:verifiedSet.size,total_chunks:normalized.length,remaining_chunks:remaining,batch_size:batch.length},200,origin);
      const {error:activeError}=await sb.from('knowledge_sources').update({
        status:'active',reviewed_by:user.id,reviewed_at:new Date().toISOString(),
        review_note:clean(b.note)||'ایندکس برداری کامل و تأیید شد'
      }).eq('id',sourceId).eq('organization_id',profile.organization_id);
      if(activeError)throw activeError;
      return reply({status:'active',source_id:sourceId,embedded_chunks:verifiedSet.size,total_chunks:normalized.length,embedding_model:'gemini-embedding-2',embedding_dimensions:1536},200,origin);
    }

    return reply({error:'Unknown action'},400,origin);
  }catch(e){
    console.error(e);
    return reply({error:e instanceof Error?e.message:'Knowledge AI failed'},500,origin);
  }
});