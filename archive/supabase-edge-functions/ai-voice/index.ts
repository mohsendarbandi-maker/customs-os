import { createClient } from 'npm:@supabase/supabase-js@2';

const cors=(origin:string)=>({'Access-Control-Allow-Origin':origin||'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const reply=(body:unknown,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any)=>String(v??'').trim();
function getSecretKey(){try{const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(raw){const keys=JSON.parse(raw);if(keys?.default)return keys.default;}}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';}
const toBytes=(b64:string)=>{const bin=atob(b64.replace(/^data:[^;]+;base64,/,''));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;};

Deno.serve(async(req)=>{
 const origin=req.headers.get('Origin')||'';
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405,origin);
 try{
  const auth=req.headers.get('Authorization')||'';const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
  if(!token)return reply({error:'Unauthorized'},401,origin);
  const url=Deno.env.get('SUPABASE_URL')!;const publishable=Deno.env.get('SUPABASE_ANON_KEY')||'';
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token);
  if(authError||!user)return reply({error:'Unauthorized'},401,origin);
  const {data:profile,error:profileError}=await userClient.from('profiles').select('organization_id,is_active').eq('id',user.id).maybeSingle();
  if(profileError||!profile?.organization_id||profile.is_active===false)return reply({error:'پروفایل کاربر معتبر یا فعال نیست.'},403,origin);
  const b=await req.json().catch(()=>({}));const path=clean(b.document_storage_path);const suppliedData=clean(b.document_data);const mime=clean(b.document_mime_type||'audio/mp4').toLowerCase().split(';')[0]||'audio/mp4';
  if(!path&&!suppliedData)return reply({error:'Audio data or storage path is required.'},400,origin);
  if(path){const prefix=profile.organization_id+'/ai-voice/';if(!path.startsWith(prefix))return reply({error:'Invalid voice storage path.'},403,origin);}
  let bytes:Uint8Array;
  if(suppliedData){bytes=toBytes(suppliedData);}else{
   const secret=getSecretKey();if(!secret)return reply({error:'Server storage configuration is missing.'},503,origin);
   const admin=createClient(url,secret);const {data:file,error}=await admin.storage.from('customs_documents').download(path);
   if(error||!file)return reply({error:'صدای ضبط‌شده از Storage قابل دریافت نیست.'},502,origin);
   bytes=new Uint8Array(await file.arrayBuffer());
  }
  if(!bytes.length)return reply({error:'فایل صوتی خالی است.'},400,origin);
  if(bytes.length>15*1024*1024)return reply({error:'فایل صوتی بزرگ‌تر از حد مجاز است.'},413,origin);
  const errors:string[]=[];
  const groq=Deno.env.get('GROQ_API_KEY');
  if(groq){try{
   const ext=mime.includes('webm')?'webm':mime.includes('ogg')?'ogg':mime.includes('wav')?'wav':mime.includes('m4a')?'m4a':'mp4';
   const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),'voice.'+ext);form.append('model','whisper-large-v3-turbo');form.append('language','fa');form.append('response_format','json');form.append('temperature','0');
   const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+groq},body:form});
   const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};const t=clean(d?.text);
   if(r.ok&&t)return reply({transcript:t,provider:'groq',model:'whisper-large-v3-turbo',status:'completed'},200,origin);
   errors.push('Groq: '+clean(d?.error?.message||'HTTP '+r.status));
  }catch(e){errors.push('Groq: '+(e instanceof Error?e.message:String(e)));}}else errors.push('Groq: API key missing');
  const cf=Deno.env.get('CLOUDFLARE_API_TOKEN');const account=Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  if(cf&&account){try{
   const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/openai/whisper',{method:'POST',headers:{Authorization:'Bearer '+cf,'Content-Type':'application/octet-stream'},body:bytes});
   const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};const t=clean(d?.result?.text);
   if(r.ok&&t)return reply({transcript:t,provider:'cloudflare',model:'@cf/openai/whisper',status:'completed'},200,origin);
   errors.push('Cloudflare: '+clean(d?.errors?.[0]?.message||'HTTP '+r.status));
  }catch(e){errors.push('Cloudflare: '+(e instanceof Error?e.message:String(e)));}}else errors.push('Cloudflare: configuration missing');
  const openai=Deno.env.get('OPENAI_API_KEY');
  if(openai){try{
   const ext=mime.includes('webm')?'webm':mime.includes('ogg')?'ogg':mime.includes('wav')?'wav':mime.includes('m4a')?'m4a':'mp4';
   const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),'voice.'+ext);form.append('model','gpt-4o-mini-transcribe');form.append('language','fa');
   const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+openai},body:form});
   const raw=await r.text();let d:any={};try{d=JSON.parse(raw)}catch{};const t=clean(d?.text);
   if(r.ok&&t)return reply({transcript:t,provider:'openai',model:'gpt-4o-mini-transcribe',status:'completed'},200,origin);
   errors.push('OpenAI: '+clean(d?.error?.message||'HTTP '+r.status));
  }catch(e){errors.push('OpenAI: '+(e instanceof Error?e.message:String(e)));}}else errors.push('OpenAI: API key missing');
  return reply({error:'هیچ سرویس تبدیل گفتار به متن در دسترس نبود.',provider_errors:errors},502,origin);
 }catch(e){console.error(e);return reply({error:e instanceof Error?e.message:'Voice transcription failed'},500,origin);}
});