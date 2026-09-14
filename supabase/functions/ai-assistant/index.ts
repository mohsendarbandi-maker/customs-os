import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});

const fields=['client','seller','regNumber','regDate','shippingLine','vesselName','billOfLading','billYear','voyageNo','originPort','destinationPort','originCountry','transactionCountry','deliveryTerm','cargoDescription','cargoCount','cargoCountUnit','netWeight','grossWeight','tariffCode','invoiceAmount','invoiceCurrency','insuranceIrr','dutyRate','unloadingDate','warehouseReceiptNo','warehouseReceiptDate'];

function extractText(data:any){
  if(typeof data?.output_text==='string' && data.output_text.trim()) return data.output_text.trim();
  const steps=Array.isArray(data?.steps)?data.steps:[];
  const texts:string[]=[];
  for(const step of steps){
    const content=Array.isArray(step?.content)?step.content:[];
    for(const item of content){if(item?.type==='text' && typeof item.text==='string')texts.push(item.text);}
  }
  if(texts.length)return texts.join('\n').trim();
  const outputs=Array.isArray(data?.outputs)?data.outputs:[];
  for(const item of outputs){if(item?.type==='text' && typeof item.text==='string')texts.push(item.text);}
  return texts.join('\n').trim();
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))return json({error:'Unauthorized: Supabase session is missing.'},401);
    const key=Deno.env.get('GEMINI_API_KEY')?.trim();
    if(!key)return json({error:'GEMINI_API_KEY is missing in Supabase Secrets.'},503);

    const body=await req.json().catch(()=>({}));
    const query=String(body?.query||'').slice(0,12000);
    const documentText=String(body?.document_text||'').slice(0,120000);
    const documentData=String(body?.document_data||'').replace(/^data:[^;]+;base64,/,'');
    const documentMime=String(body?.document_mime_type||'').trim().toLowerCase();
    const pageContext=String(body?.page_context||'').slice(0,500);
    const extractFields=Boolean(body?.extract_fields);
    const previousInteractionId=String(body?.previous_interaction_id||'').trim();

    if(!query&&!documentText&&!documentData)return json({error:'No query or document was supplied.'},400);
    if(documentData && documentData.length>14000000)return json({error:'فایل برای ارسال مستقیم به Gemini بزرگ است. لطفاً فایل کوچک‌تری انتخاب کنید.'},413);

    const system=`You are Customs OS AI, an expert assistant for Iranian customs clearance, import/export, logistics, maritime operations, documents, finance and case management. Answer in Persian unless asked otherwise. Be precise and conservative. Never invent regulations, document values, vessel positions, legal requirements or financial figures. Clearly distinguish extracted facts from interpretation and flag uncertainty. Current application section: ${pageContext}`;
    const prompt=extractFields
      ? `از سند زیر اطلاعات قابل انتقال به فرم‌های Customs OS را استخراج کن. فقط JSON معتبر برگردان، بدون markdown و بدون توضیح. کلیدهای مجاز فقط اینها هستند: ${fields.join(', ')}. فقط مقادیری را برگردان که صریحاً در سند وجود دارند؛ حدس نزن. همه مقادیر string باشند. اگر فیلدی وجود ندارد آن را اصلاً برنگردان.`
      : (query||'این سند را برای عملیات گمرکی و لجستیکی تحلیل کن و اطلاعات مهم، خطاها، مغایرت‌ها و فیلدهای قابل استخراج را ارائه بده.');

    const input:any[]=[{type:'text',text:prompt}];
    if(documentText)input.push({type:'text',text:`DOCUMENT TEXT:\n${documentText}`});
    if(documentData){
      if(documentMime==='application/pdf')input.push({type:'document',data:documentData,mime_type:'application/pdf'});
      else if(documentMime.startsWith('image/'))input.push({type:'image',data:documentData,mime_type:documentMime});
      else return json({error:'نوع فایل پشتیبانی نمی‌شود. PDF یا تصویر ارسال کنید.'},415);
    }

    const payload:any={model:'gemini-3.5-flash-lite',input,system_instruction:system,store:true};
    if(previousInteractionId)payload.previous_interaction_id=previousInteractionId;
    if(extractFields)payload.response_format={type:'text',mime_type:'application/json',schema:{type:'object',properties:Object.fromEntries(fields.map(k=>[k,{type:'string'}])),additionalProperties:false}};

    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const raw=await r.text();
    let data:any={};try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,2000)}};
    if(!r.ok){
      const msg=String(data?.error?.message||data?.message||data?.raw||`Gemini HTTP ${r.status}`);
      console.error('Gemini Interactions failed',{status:r.status,error:msg});
      const hint=r.status===400?'درخواست Gemini نامعتبر است.':r.status===401||r.status===403?'کلید Gemini معتبر نیست یا دسترسی API فعال نیست.':r.status===429?'سهمیه رایگان Gemini فعلاً تمام شده یا Rate Limit شده است.':'سرویس Gemini خطا داده است.';
      return json({error:`${hint} جزئیات: ${msg}`},502);
    }
    const answer=extractText(data)||'پاسخ خالی از Gemini دریافت شد.';
    return json({answer,model:'gemini-3.5-flash-lite',interaction_id:data?.id||data?.interaction_id||null,status:data?.status||null});
  }catch(e){
    console.error('ai-assistant fatal error',e);
    return json({error:e instanceof Error?e.message:'AI request failed'},500);
  }
});
