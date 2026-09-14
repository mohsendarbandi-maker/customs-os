import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const auth=req.headers.get('Authorization');
  if(!auth?.startsWith('Bearer '))return json({error:'Unauthorized: Supabase session is missing.'},401);
  const key=Deno.env.get('GEMINI_API_KEY')?.trim();
  if(!key)return json({error:'GEMINI_API_KEY is missing in Supabase Secrets.'},503);
  const body=await req.json().catch(()=>({}));
  const query=String(body?.query||'').slice(0,12000),documentText=String(body?.document_text||'').slice(0,120000),pageContext=String(body?.page_context||'').slice(0,500);
  const previousInteractionId=String(body?.previous_interaction_id||'').trim();
  if(!query&&!documentText)return json({error:'No query or document text was supplied.'},400);
  const system=`You are Customs OS AI, an expert assistant for Iranian customs clearance, import/export, logistics, maritime operations, documents, finance and case management. Answer in Persian unless asked otherwise. Be precise and conservative. Never invent regulations, document values, vessel positions, legal requirements or financial figures. Clearly distinguish extracted facts from interpretation and flag uncertainty. Current application section: ${pageContext}`;
  const input=`${query}${documentText?`\n\nDOCUMENT TEXT:\n${documentText}`:''}`;
  const payload:any={model:'gemini-3.5-flash-lite',input,system_instruction:system,store:true};
  if(previousInteractionId)payload.previous_interaction_id=previousInteractionId;
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const raw=await r.text();let data:any={};try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,1000)}};
  if(!r.ok){const msg=String(data?.error?.message||data?.message||data?.raw||`Gemini HTTP ${r.status}`);console.error('Gemini Interactions failed',{status:r.status,error:msg});const hint=r.status===400?'درخواست Gemini نامعتبر است.':r.status===401||r.status===403?'کلید Gemini معتبر نیست یا دسترسی API فعال نیست.':r.status===429?'سهمیه رایگان Gemini فعلاً تمام شده یا Rate Limit شده است.':'سرویس Gemini خطا داده است.';return json({error:`${hint} جزئیات: ${msg}`},502)}
  const answer=data?.output_text||data?.output?.filter?.((x:any)=>x?.type==='text')?.map?.((x:any)=>x.text||'').join('')||data?.steps?.flatMap?.((s:any)=>s.content||[])?.map?.((x:any)=>x.text||'').join('')||'پاسخ خالی از Gemini دریافت شد.';
  return json({answer,model:'gemini-3.5-flash-lite',interaction_id:data?.id||data?.interaction_id||null,status:data?.status||null});
 }catch(e){console.error('ai-assistant fatal error',e);return json({error:e instanceof Error?e.message:'AI request failed'},500)}
});
