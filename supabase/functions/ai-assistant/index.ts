import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const auth=req.headers.get('Authorization');
  if(!auth?.startsWith('Bearer '))return json({error:'Unauthorized: user session/JWT is missing.'},401);
  const key=Deno.env.get('OPENAI_API_KEY')?.trim();
  if(!key)return json({error:'OPENAI_API_KEY is missing in Supabase Edge Function Secrets.'},503);
  const body=await req.json().catch(()=>({}));
  const query=String(body?.query||'').slice(0,12000),documentText=String(body?.document_text||'').slice(0,120000),pageContext=String(body?.page_context||'').slice(0,500);
  const history=Array.isArray(body?.history)?body.history.slice(-8):[];
  if(!query&&!documentText)return json({error:'No query or document text was supplied.'},400);
  const instructions=`You are Customs OS AI, an expert assistant for Iranian customs clearance, import/export, logistics, maritime operations, documents, finance and case management. Answer in Persian unless the user asks otherwise. Be precise, practical and conservative. Never invent customs regulations, document values, vessel positions, legal requirements or financial figures. Clearly label uncertainty and distinguish extracted facts from interpretation. When analyzing documents, identify fields, inconsistencies, missing data, suspicious values and what must be human-verified. The AI output is advisory; it never constitutes final customs/legal approval. Current application section: ${pageContext}`;
  const input=[...history.map((m:any)=>({role:m.role==='assistant'?'assistant':'user',content:String(m.text||'').slice(0,8000)})),{role:'user',content:`${query}${documentText?`\n\nDOCUMENT TEXT:\n${documentText}`:''}`}];
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.6-luna',instructions,input,max_output_tokens:3000,reasoning:{effort:'none'}})});
  const raw=await r.text();let data:any={};try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,1000)}};
  if(!r.ok){const upstream=String(data?.error?.message||data?.message||data?.raw||`OpenAI HTTP ${r.status}`);console.error('OpenAI request failed',{status:r.status,error:upstream});const hint=r.status===401?'OPENAI_API_KEY نامعتبر است یا منقضی شده است.':r.status===403?'کلید OpenAI معتبر است اما دسترسی/مجوز این API یا مدل رد شده است.':r.status===429?'سهمیه، اعتبار یا Rate Limit حساب OpenAI مانع درخواست شده است.':r.status>=500?'سرویس OpenAI موقتاً خطا داده است.':'درخواست OpenAI رد شده است.';return json({error:`${hint} جزئیات: ${upstream}`},502);}
  const answer=data?.output_text||data?.output?.flatMap((x:any)=>x.content||[]).map((x:any)=>x.text||'').join('')||'پاسخ خالی از سرویس هوش مصنوعی دریافت شد.';
  return json({answer,model:'gpt-5.6-luna'});
 }catch(e){console.error('ai-assistant fatal error',e);return json({error:e instanceof Error?e.message:'AI request failed'},500)}
});
