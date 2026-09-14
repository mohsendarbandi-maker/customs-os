import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  try{
    const auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer ')) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{...cors,'Content-Type':'application/json'}});
    const key=Deno.env.get('OPENAI_API_KEY');
    if(!key) return new Response(JSON.stringify({error:'AI backend is not configured. Set OPENAI_API_KEY in Supabase Secrets.'}),{status:503,headers:{...cors,'Content-Type':'application/json'}});
    const body=await req.json();
    const query=String(body?.query||'').slice(0,12000);
    const documentText=String(body?.document_text||'').slice(0,120000);
    const pageContext=String(body?.page_context||'').slice(0,500);
    const history=Array.isArray(body?.history)?body.history.slice(-8):[];
    const instructions=`You are Customs OS AI, an expert assistant for Iranian customs clearance, import/export, logistics, maritime operations, documents, finance and case management. Answer in Persian unless the user asks otherwise. Be precise, practical and conservative. Never invent customs regulations, document values, vessel positions, legal requirements or financial figures. Clearly label uncertainty and distinguish extracted facts from interpretation. When analyzing documents, identify fields, inconsistencies, missing data, suspicious values and what must be human-verified. The AI output is advisory; it never constitutes final customs/legal approval. Current application section: ${pageContext}`;
    const input=[...history.map((m:any)=>({role:m.role==='assistant'?'assistant':'user',content:String(m.text||'').slice(0,8000)})),{role:'user',content:`${query}${documentText?`\n\nDOCUMENT TEXT:\n${documentText}`:''}`}];
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.6-luna',instructions,input,max_output_tokens:3000})});
    const data=await r.json();
    if(!r.ok) return new Response(JSON.stringify({error:data?.error?.message||`OpenAI HTTP ${r.status}`}),{status:502,headers:{...cors,'Content-Type':'application/json'}});
    const answer=data?.output_text||data?.output?.flatMap((x:any)=>x.content||[]).map((x:any)=>x.text||'').join('')||'پاسخ خالی از سرویس هوش مصنوعی دریافت شد.';
    return new Response(JSON.stringify({answer,model:'gpt-5.6-luna'}),{headers:{...cors,'Content-Type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'AI request failed'}),{status:500,headers:{...cors,'Content-Type':'application/json'}})}
});
