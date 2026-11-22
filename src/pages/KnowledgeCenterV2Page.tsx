import React,{useEffect,useState} from 'react';
import {BookOpen,Check,Clock3,FileSearch,Loader2,MessageCircle,ShieldCheck,Upload,X} from 'lucide-react';
import {supabase} from '../lib/supabase';

type Extraction={title:string;source_type:string;source_number:string|null;issued_at:string|null;effective_at:string|null;issuer:string|null;subject:string|null;keywords:string[];summary:string;extracted_text:string;chunks:{page_number:number|null;content:string}[]};
type Source={id:string;title:string;source_type:string;source_number:string|null;issued_at:string|null;effective_at:string|null;issuer:string|null;subject:string|null;status:string;metadata:any;ai_extraction:Extraction;storage_path:string|null;mime_type:string|null;created_at:string};

const typeLabels:Record<string,string>={law:'قانون',circular:'بخشنامه',instruction:'دستورالعمل',notice:'اطلاعیه',tariff:'تعرفه',ruling:'رأی/نظر',guide:'راهنما',other:'سایر'};
const statusLabels:Record<string,string>={pending_review:'در انتظار تأیید',active:'فعال',rejected:'رد شده',superseded:'منسوخ/جایگزین شده',revoked:'لغو شده',draft:'پیش‌نویس'};
const sha256=async(file:File)=>{const b=await file.arrayBuffer();const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('')};
const uploadKnowledgeFileWithProgress=async(file:File,path:string,onProgress:(percent:number)=>void):Promise<void>=>{
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token)throw new Error('جلسه کاربر معتبر نیست؛ دوباره وارد شوید.');
 const apiKey=(import.meta as any).env.VITE_SUPABASE_ANON_KEY;
 if(!apiKey)throw new Error('کلید عمومی Supabase در تنظیمات برنامه موجود نیست.');
 const objectPath=path.split('/').map(x=>encodeURIComponent(x)).join('/');
 await new Promise<void>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('POST',window.location.origin+'/storage/v1/object/customs-knowledge/'+objectPath);
  xhr.setRequestHeader('Authorization','Bearer '+session.access_token);
  xhr.setRequestHeader('apikey',apiKey);
  xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  xhr.setRequestHeader('x-upsert','false');
  xhr.setRequestHeader('cache-control','3600');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.max(0,Math.min(100,Math.round(e.loaded/e.total*100))))};
  xhr.onerror=()=>reject(new Error('ارتباط هنگام آپلود فایل قطع شد.'));
  xhr.onabort=()=>reject(new Error('آپلود فایل لغو شد.'));
  xhr.onload=()=>{
   if(xhr.status>=200&&xhr.status<300){onProgress(100);resolve();return;}
   let detail=xhr.responseText||'';
   try{const body=JSON.parse(detail);detail=body.message||body.error||detail;}catch{}
   reject(new Error('آپلود فایل ناموفق بود (HTTP '+xhr.status+'): '+String(detail).slice(0,350)));
  };
  xhr.send(file);
 });
};
const supportedKnowledgeMime=(mime:string)=>mime==='application/pdf'||mime==='text/plain'||mime==='text/markdown'||mime.startsWith('image/');
const knowledgeMime=(filename:string,mime:string)=>{
 const supplied=String(mime||'').toLowerCase();
 if(supportedKnowledgeMime(supplied))return supplied;
 const extension=filename.toLowerCase().split('.').pop()||'';
 const byExtension:Record<string,string>={pdf:'application/pdf',txt:'text/plain',md:'text/markdown',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff'};
 return byExtension[extension]||supplied||'application/octet-stream';
};

export const KnowledgeCenterV2Page:React.FC=()=>{
 const[sources,setSources]=useState<Source[]>([]),[pending,setPending]=useState<Source[]>([]),[q,setQ]=useState(''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[files,setFiles]=useState<File[]>([]),[review,setReview]=useState<Extraction|null>(null),[reviewSourceId,setReviewSourceId]=useState(''),[selected,setSelected]=useState<Source|null>(null),[uploadProgress,setUploadProgress]=useState(0),[uploadStage,setUploadStage]=useState(''),[draftSourceId,setDraftSourceId]=useState(''),[queueProgress,setQueueProgress]=useState<{done:number;total:number;current:string}|null>(null);
 const load=async()=>{const{data,error}=await supabase.from('knowledge_sources').select('id,title,source_type,source_number,issued_at,effective_at,issuer,subject,status,metadata,ai_extraction,storage_path,mime_type,created_at').order('updated_at',{ascending:false}).limit(100);if(error){setErr(error.message);return}const rows=(data||[]) as Source[];setSources(rows.filter(x=>x.status==='active'));setPending(rows.filter(x=>x.status==='pending_review'||x.status==='draft'))};
 useEffect(()=>{void load();const timer=window.setInterval(()=>{void load()},20000);return()=>window.clearInterval(timer)},[]);
 const extractOne=async(currentFile:File|null,resumeSourceId:string,userId:string,organizationId:string):Promise<{id:string;extraction:Extraction;pageMemory:any}>=>{
  let savedSourceId=resumeSourceId;
  let storedMetadata:any={};
  try{
   let filename=currentFile?.name||'';
   let mime=knowledgeMime(filename,currentFile?.type||'');
   let storagePath='';
   let fileSize=Number(currentFile?.size||0);

   if(savedSourceId){
    const{data:saved,error:savedError}=await supabase.from('knowledge_sources')
      .select('id,organization_id,status,storage_path,mime_type,metadata,title')
      .eq('id',savedSourceId).eq('organization_id',organizationId).maybeSingle();
    if(savedError||!saved)throw new Error(savedError?.message||'پیش‌نویس دانشنامه پیدا نشد.');
    if(!['draft','pending_review'].includes(saved.status))throw new Error('وضعیت این منبع برای استخراج مجدد مجاز نیست.');
    storagePath=String(saved.storage_path||'');
    if(!storagePath)throw new Error('مسیر فایل در پیش‌نویس ذخیره نشده است؛ فایل را دوباره آپلود کنید.');
    const savedName=String(saved.metadata?.filename||saved.title||'');
    if(currentFile&&savedName&&savedName!==currentFile.name)throw new Error('فایل انتخاب‌شده با پیش‌نویس ذخیره‌شده تطابق ندارد: '+savedName);
    filename=savedName||filename||'document';
    mime=knowledgeMime(filename,String(saved.mime_type||mime||''));
    storedMetadata=saved.metadata||{};
    fileSize=Number(storedMetadata.size||fileSize||0);
   }else{
    if(!currentFile)throw new Error('فایل موردنظر را انتخاب کنید.');
    filename=currentFile.name;
    mime=knowledgeMime(filename,currentFile.type||'');
    fileSize=currentFile.size;
    if(mime!=='application/pdf'&&!filename.toLowerCase().endsWith('.pdf'))throw new Error('این صف فقط فایل PDF می‌پذیرد.');
    if(fileSize<=0||fileSize>25*1024*1024)throw new Error('حجم هر PDF باید بین ۱ بایت تا ۲۵ مگابایت باشد: '+filename);
    const hash=await sha256(currentFile);
    const safe=filename.replace(/[^\w.\-\u0600-\u06ff]+/g,'_');
    storagePath=organizationId+'/'+crypto.randomUUID()+'-'+safe;
    setUploadStage('آپلود '+filename+' به فضای خصوصی دانشنامه');
    setUploadProgress(0);
    await uploadKnowledgeFileWithProgress(currentFile,storagePath,setUploadProgress);
    setUploadStage('ثبت فایل در دانشنامه: '+filename);
    storedMetadata={filename,size:fileSize,sha256:hash,upload_complete:true,telegram_archive_requested:true,auto_activation_policy:'quality_gate'};
    const{data:s,error:se}=await supabase.from('knowledge_sources').insert({
      organization_id:organizationId,title:filename,source_type:'other',status:'draft',
      storage_path:storagePath,mime_type:mime,created_by:userId,extracted_text:'',metadata:storedMetadata
    }).select('id').single();
    if(se||!s){
      await supabase.storage.from('customs-knowledge').remove([storagePath]);
      throw se||new Error('ثبت مشخصات فایل در دانشنامه ناموفق بود.');
    }
    savedSourceId=s.id;
    setDraftSourceId(s.id);
   }

   if(mime!=='application/pdf')throw new Error('در این بخش فقط PDF پشتیبانی می‌شود: '+filename);
   if(fileSize>25*1024*1024)throw new Error('حجم PDF ذخیره‌شده بیش از ۲۵ مگابایت است: '+filename);
   setUploadProgress(100);
   setUploadStage('استخراج PDF با مدل‌های جایگزین AI: '+filename);
   let r:any=null;
   for(let batchAttempt=0;batchAttempt<500;batchAttempt++){
    const response=await supabase.functions.invoke('knowledge-ai',{body:{
     action:'extract',filename,document_mime_type:mime,source_id:savedSourceId,storage_path:storagePath
    }});
    if(response.error){
     let reason=response.error.message;try{const detail=await(response.error as any).context?.json?.();if(detail?.error)reason=detail.error;}catch{}
     throw new Error(reason||'استخراج هوش مصنوعی ناموفق بود.');
    }
    r=response.data;
    if(r?.status==='processing'){
     const progress=r.progress||{};
     setUploadStage(filename+' — استخراج صفحات '+(progress.processed_pages||0)+' از '+(progress.total_pages||0));
     setUploadProgress(Math.max(1,Math.min(99,Math.round((progress.processed_pages||0)/(progress.total_pages||1)*100))));
     continue;
    }
    break;
   }
   if(r?.status==='processing')throw new Error('استخراج این PDF هنوز تمام نشده است؛ از فهرست منابع پیش‌نویس، ادامه استخراج را اجرا کنید.');
   if(r?.status!=='extracted')throw new Error(r?.error||'پاسخ استخراج نامعتبر بود.');
   const ex=r?.extraction as Extraction;
   if(!ex?.title||!Array.isArray(ex.chunks)||!ex.chunks.length)throw new Error('استخراج AI ناقص بود؛ فایل ذخیره است و می‌توانید از فهرست پیش‌نویس‌ها ادامه دهید.');
   setUploadStage('ذخیره متن استخراج‌شده: '+filename);
   const{error:updateError}=await supabase.from('knowledge_sources').update({
    title:ex.title,source_type:typeLabels[ex.source_type]?ex.source_type:'other',
    source_number:ex.source_number||null,issued_at:ex.issued_at||null,effective_at:ex.effective_at||null,
    issuer:ex.issuer||null,subject:ex.subject||null,keywords:Array.isArray(ex.keywords)?ex.keywords:[],
    status:'pending_review',extracted_text:ex.extracted_text||'',ai_extraction:ex,
    extraction_model:r?.model||'gemini-3.5-flash-lite',
    metadata:{...storedMetadata,filename,size:fileSize,upload_complete:true,summary:ex.summary||''}
   }).eq('id',savedSourceId).eq('organization_id',organizationId);
   if(updateError)throw updateError;
   setDraftSourceId('');
   return {id:savedSourceId,extraction:ex,pageMemory:r?.page_memory||null};
  }catch(error:any){
   const wrapped=new Error(error?.message||'فرآیند استخراج این PDF ناموفق بود.') as Error&{savedSourceId?:string};
   wrapped.savedSourceId=savedSourceId||undefined;
   throw wrapped;
  }
 };

 const extract=async()=>{
  const jobs=draftSourceId?[{file:null as File|null,resumeId:draftSourceId}]:files.map(currentFile=>({file:currentFile,resumeId:''}));
  if(!jobs.length)return;
  setBusy(true);setErr('');setReview(null);setReviewSourceId('');
  setUploadProgress(0);
  setQueueProgress({done:0,total:jobs.length,current:''});
  const completed:Array<{id:string;extraction:Extraction;pageMemory:any}>=[];
  const failed:Array<{name:string;message:string;savedSourceId?:string}>=[];
  const retryFiles:File[]=[];
  try{
   const{data:{user}}=await supabase.auth.getUser();
   if(!user)throw new Error('کاربر وارد نشده است.');
   const{data:p,error:pe}=await supabase.from('profiles').select('organization_id').eq('id',user.id).maybeSingle();
   if(pe||!p?.organization_id)throw new Error(pe?.message||'سازمان کاربر مشخص نیست.');
   for(let i=0;i<jobs.length;i++){
    const job=jobs[i];
    const name=job.file?.name||'PDF ذخیره‌شده';
    setQueueProgress({done:i,total:jobs.length,current:name});
    setUploadProgress(0);
    setUploadStage('شروع فایل '+(i+1)+' از '+jobs.length+': '+name);
    try{
     const result=await extractOne(job.file,job.resumeId,user.id,p.organization_id);
     completed.push(result);
    }catch(error:any){
     failed.push({name,message:error?.message||'استخراج ناموفق بود.',savedSourceId:error?.savedSourceId});
     if(job.file&&!error?.savedSourceId)retryFiles.push(job.file);
    }
    setQueueProgress({done:i+1,total:jobs.length,current:name});
   }
   await load();
   setDraftSourceId(failed.find(x=>x.savedSourceId)?.savedSourceId||'');
   setFiles(retryFiles);
   if(completed.length){
    const last=completed[completed.length-1];
    if(last.pageMemory?.worker_scheduled){
     setReview(null);
     setReviewSourceId('');
     setUploadStage('استخراج اولیه کامل شد؛ OCR تمام صفحات، ایندکس و فعال‌سازی در پس‌زمینه انجام می‌شود.');
    }else{
     setReview(last.extraction);
     setReviewSourceId(last.id);
    }
    setUploadProgress(100);
   }
   if(failed.length){
    const succeeded=completed.length;
    const details=failed.map(x=>'• '+x.name+': '+x.message).join('\n');
    setErr((succeeded?succeeded+' فایل استخراج شد. ':'')+'استخراج '+failed.length+' فایل ناموفق بود:\n'+details+'\nفایل‌هایی که در دانشنامه ذخیره شده‌اند در فهرست «منابع نیازمند تکمیل» باقی می‌مانند؛ فقط فایل‌هایی را دوباره انتخاب کنید که آپلودشان کامل نشده است.');
    setUploadStage('صف پایان یافت؛ '+completed.length+' موفق، '+failed.length+' نیازمند بررسی');
   }else{
    setErr('');
    setUploadStage('استخراج اولیه '+completed.length+' PDF کامل شد؛ OCR، کنترل کیفیت، ایندکس و فعال‌سازی سالم‌ها خودکار ادامه می‌یابد.');
    setUploadProgress(100);
   }
  }catch(error:any){
   setErr(error?.message||'فرآیند ثبت دانشنامه ناموفق بود.');
   setUploadStage('صف متوقف شد؛ فایل‌های انتخاب‌شده هنوز برای تلاش مجدد نگه داشته شده‌اند.');
   setFiles(jobs.filter(x=>x.file).map(x=>x.file as File));
  }finally{
   setQueueProgress({done:completed.length+failed.length,total:jobs.length,current:''});
   setBusy(false);
  }
 };

 const reviewAction=async(action:'approve'|'reject')=>{
  if(!reviewSourceId)return;
  setBusy(true);setErr('');
  try{
   if(action==='reject'){
    const{data,error}=await supabase.functions.invoke('knowledge-ai',{body:{action,source_id:reviewSourceId,note:'رد شده در بررسی انسانی'}});
    if(error)throw error;if(data?.error)throw new Error(data.error);
    setReview(null);setReviewSourceId('');await load();return;
   }
   setUploadStage('کنترل کیفیت استخراج متن و صفحات');
   const qa=await supabase.functions.invoke('knowledge-ai',{body:{action:'qa',source_id:reviewSourceId}});
   if(qa.error)throw qa.error;
   if(qa.data?.error)throw new Error(qa.data.error);
   const metrics=qa.data?.metrics||{};
   if(!qa.data?.passed){
    const reasons=Array.isArray(qa.data?.warnings)?qa.data.warnings.join('، '):'معیارهای کیفیت استخراج تأمین نشده است.';
    throw new Error('کنترل کیفیت اجازه انتشار نداد: '+reasons);
   }
   const qaWarnings=Array.isArray(qa.data?.warnings)?qa.data.warnings:[];
   setUploadStage('ایندکس‌گذاری برداری '+(metrics.nonempty_chunks||0)+' قطعه؛ '+(metrics.unique_pages||0)+' صفحه شناسایی‌شده');
   let result:any=null;
   for(let attempt=0;attempt<250;attempt++){
    const{data,error}=await supabase.functions.invoke('knowledge-ai',{body:{action:'approve',source_id:reviewSourceId,note:'تأیید پس از کنترل کیفیت و ایندکس‌گذاری کامل'}});
    if(error)throw error;if(data?.error)throw new Error(data.error);
    result=data;
    if(data?.status==='active')break;
    if(data?.status!=='indexing')throw new Error('وضعیت غیرمنتظره هنگام ایندکس‌گذاری: '+String(data?.status||'نامشخص'));
    setUploadStage('ایندکس‌گذاری برداری: '+data.embedded_chunks+'/'+data.total_chunks+' قطعه');
   }
   if(result?.status!=='active')throw new Error('ایندکس‌گذاری بیش از سقف مجاز ادامه یافت؛ با فشردن دوباره تأیید، از ادامه کار تکمیل می‌شود.');
   setUploadStage('ایندکس کامل شد: '+result.embedded_chunks+' قطعه برداری');
   if(qaWarnings.length)setErr('هشدارهای کنترل کیفیت: '+qaWarnings.join('، '));
   setReview(null);setReviewSourceId('');await load();
  }catch(e:any){setErr(e?.message||'عملیات بررسی ناموفق بود.')}
  finally{setBusy(false)}
 };
 const resumeOrReviewSource=(source:Source)=>{
  if(source.status==='draft'){
   setDraftSourceId(source.id);setFiles([]);setReview(null);setReviewSourceId('');
   setErr('فایل در دانشنامه ذخیره شده است. برای ادامه استخراج، دکمه «ادامه استخراج از فایل ذخیره‌شده» را بزنید؛ آپلود مجدد لازم نیست.');
   setUploadProgress(100);setUploadStage('نسخه خصوصی فایل آماده استخراج است');
   return;
  }
  if(source.ai_extraction){setReview(source.ai_extraction);setReviewSourceId(source.id);}
 };
 const ask=async()=>{if(!q.trim())return;setBusy(true);setErr('');setAnswer('');try{const{data,error}=await supabase.functions.invoke('ai-core',{body:{query:q,mode:'chat'}});if(error)throw error;setAnswer(data?.answer||'پاسخی دریافت نشد.')}catch(e:any){setErr(e?.message||'پاسخ‌گویی ناموفق بود.')}finally{setBusy(false)}};
 return <main dir="rtl" className="min-h-screen p-4 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-6xl mx-auto space-y-5">
  <header><div className="flex items-center gap-2"><BookOpen/><h1 className="text-2xl font-black">دانشنامه گمرکی</h1></div><p className="text-xs app-muted mt-1">آپلود یک‌باره → استخراج و کنترل کیفیت → ایندکس برداری مرحله‌ای → بازیابی از حافظه AI</p></header>
  {err&&<div className="p-3 rounded-xl bg-red-500/10 border border-red-400/30 text-sm">{err}</div>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-3"><Upload size={18}/><h2 className="font-bold">افزودن قانون / بخشنامه</h2></div>
   <label className="block p-6 rounded-xl border border-dashed app-border text-center cursor-pointer"><FileSearch className="mx-auto mb-2" size={28}/><div className="font-bold">{files.length?files.length+' فایل PDF انتخاب شده':(draftSourceId?'فایل ذخیره‌شده در دانشنامه آماده ادامه استخراج':'چند فایل PDF را با هم انتخاب کنید')}</div><div className="text-xs app-muted mt-1">انتخاب هم‌زمان چند PDF؛ پردازش ترتیبی برای جلوگیری از فشار هم‌زمان به سرویس AI — حداکثر ۲۵MB برای هر فایل</div><input id="knowledge-source-file" type="file" multiple className="hidden" accept="application/pdf,.pdf" onChange={e=>{const chosen=Array.from(e.target.files||[]);const invalid=chosen.filter(x=>x.type!=='application/pdf'&&!x.name.toLowerCase().endsWith('.pdf'));if(invalid.length){setErr('فقط فایل PDF انتخاب کنید: '+invalid.map(x=>x.name).join('، '));}else{setErr('');setFiles(chosen);if(chosen.length)setDraftSourceId('');setUploadProgress(0);setUploadStage('');setQueueProgress(null);}e.currentTarget.value='';}}/></label>
   <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2"><button className="w-full py-3 rounded-xl bg-[var(--primary)] text-white font-bold disabled:opacity-50" disabled={(!files.length&&!draftSourceId)||busy} onClick={extract}>{busy?<span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={17}/>در حال استخراج صف...</span>:(draftSourceId&&!files.length?'ادامه استخراج از فایل ذخیره‌شده':files.length>1?'آپلود و استخراج '+files.length+' PDF':'آپلود و استخراج PDF')}</button>{files.length>0&&<button type="button" className="px-4 py-3 rounded-xl border app-border font-bold disabled:opacity-50" disabled={busy} onClick={()=>setFiles([])}>پاک‌کردن صف</button>}</div>
   {files.length>0&&<div className="mt-2 text-xs app-muted">{files.map((item,i)=><div key={i} className="flex justify-between gap-3 py-1"><span className="truncate">{i+1}. {item.name}</span><span className="shrink-0">{(item.size/1024/1024).toFixed(1)} MB</span></div>)}</div>}
   {queueProgress&&<div className="mt-3 text-xs app-muted">{queueProgress.current?('فایل '+Math.min(queueProgress.done+1,queueProgress.total)+' از '+queueProgress.total+' — '+queueProgress.current):(queueProgress.done+' از '+queueProgress.total+' فایل پردازش شد')}</div>}
   {(busy||uploadProgress>0)&&<div className="mt-3 rounded-xl border app-border bg-[var(--surface-2)] p-3" aria-live="polite">
    <div className="flex items-center justify-between gap-3 text-xs"><b>{uploadStage||'آماده‌سازی فایل'}</b><strong className="tabular-nums">{uploadProgress}%</strong></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
     <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150" style={{width:uploadProgress+'%'}}/>
    </div>
   </div>}
  </section>
  {review&&<section className="rounded-2xl border-2 border-amber-400/40 bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><Clock3/><h2 className="font-bold">بررسی قبل از انتشار</h2></div>
   <div className="grid md:grid-cols-2 gap-3 mt-4 text-sm"><div>عنوان: <b>{review.title||'—'}</b></div><div>نوع: <b>{typeLabels[review.source_type]||'سایر'}</b></div><div>شماره: {review.source_number||'—'}</div><div>مرجع: {review.issuer||'—'}</div><div>تاریخ صدور: {review.issued_at||'—'}</div><div>تاریخ اجرا: {review.effective_at||'—'}</div><div className="md:col-span-2">موضوع: {review.subject||'—'}</div><div className="md:col-span-2">خلاصه AI: {review.summary||'—'}</div></div>
   <div className="mt-4"><div className="font-bold text-sm mb-2">متن استخراج‌شده</div><div className="max-h-72 overflow-auto rounded-xl bg-[var(--surface-2)] p-4 whitespace-pre-wrap text-xs leading-6">{review.extracted_text||'متن استخراج نشد.'}</div></div>
   <div className="mt-4"><div className="font-bold text-sm mb-2">بخش‌های قابل استناد: {review.chunks.length}</div><div className="max-h-48 overflow-auto space-y-2">{review.chunks.slice(0,20).map((c,i)=><div key={i} className="rounded-lg bg-[var(--surface-2)] p-3 text-xs"><b>{c.page_number?'صفحه '+c.page_number:'بخش '+(i+1)}</b><div className="mt-1">{c.content}</div></div>)}</div></div>
   <div className="flex gap-2 mt-4"><button className="flex-1 py-3 rounded-xl bg-[var(--primary)] text-white font-bold disabled:opacity-50" disabled={busy} onClick={()=>reviewAction('approve')}><Check className="inline ml-1" size={17}/>تأیید و انتشار</button><button className="px-5 py-3 rounded-xl border app-border font-bold disabled:opacity-50" disabled={busy} onClick={()=>reviewAction('reject')}><X className="inline ml-1" size={17}/>رد</button></div>
  </section>}
  {pending.length>0&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><h2 className="font-bold mb-3">منابع نیازمند تکمیل یا تأیید ({pending.length})</h2><div className="grid md:grid-cols-2 gap-2">{pending.map(s=><button key={s.id} onClick={()=>resumeOrReviewSource(s)} className="text-right p-3 rounded-xl bg-[var(--surface-2)]"><b>{s.title}</b><div className="text-xs app-muted mt-1">{typeLabels[s.source_type]||'سایر'}{s.source_number?' · '+s.source_number:''} · {s.status==='draft'?'فایل ذخیره شده؛ استخراج ناتمام':((Number(s.metadata?.page_ocr?.pending_pages||0)+Number(s.metadata?.page_ocr?.processing_pages||0))>0?'در حال OCR و ایندکس خودکار':(Number(s.metadata?.page_ocr?.needs_review_pages||0)+Number(s.metadata?.page_ocr?.failed_pages||0)>0?'نیازمند بازبینی صفحه‌ای':'در انتظار تکمیل فرایند'))}{s.metadata?.classification?.authority_label?' · '+s.metadata.classification.authority_label:''}{s.metadata?.classification?.subject_area_label?' · '+s.metadata.classification.subject_area_label:''}{s.metadata?.source_channel_label?' · منبع: '+s.metadata.source_channel_label:''}{s.metadata?.telegram_archive?.status==='sent'?' · آرشیو تلگرام: ذخیره شد':s.metadata?.telegram_archive?.status==='failed'?' · آرشیو تلگرام: خطا':s.metadata?.telegram_archive?.status==='unknown'?' · آرشیو تلگرام: نیازمند بررسی':''}</div></button>)}</div></section>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-3"><MessageCircle size={18}/><h2 className="font-bold">پرسش از دانش فعال</h2></div><div className="flex gap-2"><input className="field flex-1" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&ask()} placeholder="مثلاً: در این بخشنامه چه الزامی برای قبض انبار آمده؟"/><button className="px-5 rounded-xl bg-[var(--primary)] text-white font-bold disabled:opacity-50" onClick={ask} disabled={busy||!q.trim()}>{busy?<Loader2 className="animate-spin"/>:'پرسش'}</button></div>{answer&&<div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4 whitespace-pre-wrap leading-7 text-sm">{answer}</div>}</section>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 mb-3"><ShieldCheck size={18}/><h2 className="font-bold">منابع فعال ({sources.length})</h2></div>{!sources.length?<div className="text-sm app-muted">هنوز منبع تأییدشده‌ای ثبت نشده است.</div>:<div className="grid md:grid-cols-2 gap-2">{sources.map(s=><div key={s.id} className="p-3 rounded-xl bg-[var(--surface-2)]"><b>{s.title}</b><div className="text-xs app-muted mt-1">{typeLabels[s.source_type]||'سایر'}{s.source_number?' · '+s.source_number:''}{s.issuer?' · '+s.issuer:''} · {statusLabels[s.status]||s.status}</div></div>)}</div>}</section>
 </div></main>;
};