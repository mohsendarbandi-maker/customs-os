import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});

const fields=['vesselType','regNumber','regDate','packageCount','warehouseReceiptNo','warehouseReceiptDate','cargoDescription','originCountry','transactionCountry','deliveryTerm','invoiceAmount','invoiceCurrency','bankBranchCode','bankName','bankBranch','lcNumber','dutyRate','tariffCode','netWeight','grossWeight','billOfLading','insuranceIrr','requiredDocuments'];

function extractText(data:any){
 if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();
 const texts:string[]=[];
 for(const step of Array.isArray(data?.steps)?data.steps:[]){for(const item of Array.isArray(step?.content)?step.content:[]){if(item?.type==='text'&&typeof item.text==='string')texts.push(item.text)}}
 for(const item of Array.isArray(data?.outputs)?data.outputs:[]){if(item?.type==='text'&&typeof item.text==='string')texts.push(item.text)}
 return texts.join('\n').trim();
}

const preDeclarationPrompt=`
تو فقط مسئول استخراج «ورود اطلاعات قبل اظهار» برای سامانه گمرکی ایران هستی.

اسناد ارسال‌شده را به صورت یک مجموعه واحد بررسی کن. همه صفحات، جدول‌ها، سربرگ‌ها، پاورقی‌ها، مهرها، نوشته‌های چاپی و دست‌نویس خوانا را بررسی کن و بین اسناد تطبیق بده.

قواعد غیرقابل تخطی:
1) هیچ مقدار را حدس نزن و هیچ مقدار ساختگی ایجاد نکن.
2) اگر مقدار یک فیلد در هیچ‌یک از اسناد وجود ندارد یا خوانا نیست، مقدار آن فیلد دقیقاً «xxxx» باشد. هیچ فیلدی را حذف نکن.
3) خروجی باید فارسی باشد. شرح کالا، نام کشور، نام بانک، نام شعبه و سایر مقادیر توصیفی را فارسی بنویس؛ حتی اگر در سند انگلیسی هستند. شناسه‌ها و شماره‌های رسمی را تغییر نده.
4) «شرح کالا» حتماً فارسی باشد و فقط از خود کالا و مشخصات واقعی آن تشکیل شود؛ کد تعرفه، عبارت HS Code، عبارت «کد تعرفه»، «ورق فولادی» یا توضیح ساختگی داخل شرح کالا ممنوع است. برای رول آهنی، در صورت وجود مشخصات، از قالب «آهن ورق گرم سایز ...» استفاده کن. برای تخته از «تخته بسته ...» استفاده کن.
5) نوع کشتی فقط یکی از «ایرانی» یا «خارجی» باشد. اگر پرچم یا مالک کشتی ایرانی است «ایرانی»، در غیر این صورت «خارجی». اگر قابل تشخیص نیست xxxx.
6) شماره ثبت سفارش و تاریخ آن فقط از سند ثبت سفارش. تاریخ شمسی با قالب رایج 1405/02/23.
7) تعداد فقط از Packing List و به همراه واحد/بسته‌بندی واقعی آن.
8) شماره و تاریخ قبض انبار فقط از قبض انبار.
9) کشور مبدأ و کشور طرف معامله فقط از اسناد. نام کشور فارسی و کد دوحرفی در صورت وجود/قابل تشخیص: «روسیه (RU)». اگر نیست xxxx.
10) شرایط تحویل دقیقاً از اسناد مثل CFR/FOB.
11) مبلغ کل فاکتور و ارز دقیقاً از Commercial Invoice.
12) اطلاعات بانکی فقط بانک ایرانی: کد شعبه، نام بانک و نام شعبه را از بیمه‌نامه و سایر اسناد استخراج کن. مهر بانک، کد شعبه و نوشته دست‌نویس روی مهر را هم بررسی کن. اگر روش پرداخت TT، نقدی یا مشابه است، شماره اعتبار اسنادی دقیقاً «---» باشد. اگر اطلاعات بانکی وجود ندارد xxxx.
13) ماخذ حقوق ورودی فقط از جدول ثبت سفارش و به صورت درصد، مثلاً 4%.
14) کد تعرفه دقیقاً مطابق ثبت سفارش و بدون تغییر.
15) وزن خالص و ناخالص از اسناد. اگر فقط یکی وجود دارد، همان مقدار را در هر دو فیلد قرار بده. واحد کیلوگرم.
16) شماره بارنامه باید دقیقاً مطابق اصل B/L باشد؛ حروف و اعداد انگلیسی و علائم / و - و سایر علائم عیناً حفظ شوند. در یک خط. ترجمه یا تغییر فرمت ممنوع.
17) بیمه: مبلغ کل حق بیمه پرداختی را به ریال استخراج کن. اگر تناژ کل پروفرما/بیمه با وزن خالص وارداتی طبق B/L متفاوت است، مبلغ بیمه ریالی را متناسب با نسبت وزن خالص وارداتی به تناژ کل بیمه‌شده/پروفرما محاسبه کن.
18) اطلاعات مورد نیاز فقط اسامی مدارکی باشد که از صاحب کالا باید گرفته شود و در مجموعه اسناد ارسال‌شده موجود نیست. مدارک مورد درخواست: ثبت سفارش، اینویس، پروفرما، بیمه‌نامه، پکینگ لیست، اطلاعات بانکی، گواهی بازرسی. ترخیصیه، بارنامه، قبض انبار و ترخیصیه الکترونیک را از صاحب کالا درخواست نکن. اگر هیچ مدرکی لازم نیست «ندارد».
19) خروجی فقط JSON مطابق schema است. هیچ توضیح، مقدمه، تحلیل یا Markdown ننویس.
20) همه 23 فیلد الزامی هستند و هیچ‌کدام نباید خالی یا حذف شوند. اگر مقدار ندارند دقیقاً xxxx.
`;

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const auth=req.headers.get('Authorization');
  if(!auth?.startsWith('Bearer '))return json({error:'Unauthorized: Supabase session is missing.'},401);
  const key=Deno.env.get('GEMINI_API_KEY')?.trim();
  if(!key)return json({error:'GEMINI_API_KEY is missing in Supabase Secrets.'},503);
  const body=await req.json().catch(()=>({}));
  const query=String(body?.query||'').slice(0,20000);
  const documentText=String(body?.document_text||'').slice(0,120000);
  const documentData=String(body?.document_data||'').replace(/^data:[^;]+;base64,/,'');
  const documentMime=String(body?.document_mime_type||'').trim().toLowerCase();
  const documents=Array.isArray(body?.documents)?body.documents:[];
  const pageContext=String(body?.page_context||'').slice(0,1000);
  const extractFields=Boolean(body?.extract_fields);
  if(!query&&!documentText&&!documentData&&!documents.length)return json({error:'No query or document was supplied.'},400);

  const totalSize=documents.reduce((n:any,d:any)=>n+String(d?.data||'').length,0)+documentData.length;
  if(totalSize>45000000)return json({error:'حجم مجموع اسناد برای ارسال به هوش مصنوعی بیش از حد مجاز است. اسناد را در چند نوبت ارسال کنید.'},413);

  const system=`You are Customs OS AI for Iranian customs clearance. You must follow the user's extraction rules literally. Never invent values. When the requested output field is descriptive, output Persian. Preserve official identifiers exactly. Current section: ${pageContext}`;
  const prompt=extractFields?preDeclarationPrompt:(query||'این اسناد را برای عملیات گمرکی تحلیل کن.');
  const input:any[]=[{type:'text',text:prompt}];
  if(documentText)input.push({type:'text',text:`DOCUMENT TEXT:\n${documentText}`});
  if(documentData){if(documentMime==='application/pdf')input.push({type:'document',data:documentData,mime_type:'application/pdf'});else if(documentMime.startsWith('image/'))input.push({type:'image',data:documentData,mime_type:documentMime});else return json({error:'نوع فایل پشتیبانی نمی‌شود. PDF یا تصویر ارسال کنید.'},415)}
  for(const d of documents){const data=String(d?.data||'').replace(/^data:[^;]+;base64,/,'');const mime=String(d?.mime_type||'').toLowerCase();if(!data)continue;if(mime==='application/pdf')input.push({type:'text',text:`نام سند: ${String(d?.name||'سند')}`},{type:'document',data,mime_type:'application/pdf'});else if(mime.startsWith('image/'))input.push({type:'text',text:`نام سند: ${String(d?.name||'سند')}`},{type:'image',data,mime_type:mime});else return json({error:`نوع فایل ${String(d?.name||'')} پشتیبانی نمی‌شود.`},415)}

  const payload:any={model:'gemini-3.5-flash-lite',input,system_instruction:system,store:true};
  if(extractFields)payload.response_format={type:'text',mime_type:'application/json',schema:{type:'object',properties:Object.fromEntries(fields.map(k=>[k,{type:'string'}])),required:fields,additionalProperties:false}};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const raw=await r.text();let data:any={};try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,3000)}}
  if(!r.ok){const msg=String(data?.error?.message||data?.message||data?.raw||`Gemini HTTP ${r.status}`);return json({error:`Gemini error: ${msg}`},502)}
  const answer=extractText(data)||'پاسخ خالی از Gemini دریافت شد.';
  return json({answer,model:'gemini-3.5-flash-lite',interaction_id:data?.id||data?.interaction_id||null,status:data?.status||null});
 }catch(e){console.error('ai-assistant fatal error',e);return json({error:e instanceof Error?e.message:'AI request failed'},500)}
});
