import React,{useMemo,useRef,useState}from'react';
import{Bot,Send,X,Plus,CheckCircle2,Loader2,PanelLeftClose,SquarePen}from'lucide-react';
import{supabase}from'../lib/supabase';
import{makeClientId}from'../lib/clientId';

type PendingDoc={id:string;name:string;path:string;status:'uploading'|'ready'|'failed'|'extracting'|'done';error?:string;fields?:Record<string,string>};
const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||'');const i=s.indexOf(',');resolve(i>=0?s.slice(i+1):s)};r.onerror=()=>reject(new Error('خواندن فایل ناموفق بود.'));r.readAsDataURL(file)});
const parseFields=(answer:string)=>{const raw=answer.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();const obj=JSON.parse(raw);const out:Record<string,string>={};Object.entries(obj||{}).forEach(([k,v])=>{if(typeof v==='string'&&v.trim())out[k]=v.trim()});return out};
const explain=async(e:any)=>{try{if(e?.context?.json){const b=await e.context.json();return String(b?.error||b?.message||e.message||'خطای سرویس هوش مصنوعی')}if(e?.context?.text){const t=await e.context.text();if(t)return t}}catch{}return e?.message||'Edge Function پاسخ موفق نداد.'};

export const AIWorkspaceUploadQueue:React.FC<{pageContext?:string}>=({pageContext=''})=>{
 const shipmentId=useMemo(()=>{try{return new URLSearchParams(location.search).get('shipmentId')||''}catch{return''}},[pageContext]);
 const[open,setOpen]=useState(false),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[docs,setDocs]=useState<PendingDoc[]>([]),[messages,setMessages]=useState<{role:'user'|'assistant';text:string}[]>([]),[fields,setFields]=useState<Record<string,string>>({});
 const fileRef=useRef<HTMLInputElement>(null);
 const uploadFile=async(file:File)=>{
  if(file.type!=='application/pdf'&&!file.type.startsWith('image/'))throw new Error('فقط PDF و تصویر پشتیبانی می‌شود.');
  if(file.size>50*1024*1024)throw new Error(`حجم «${file.name}» بیشتر از ۵۰MB است.`);
  const temp=`temp-${makeClientId()}`;setDocs(d=>[...d,{id:temp,name:file.name,path:'',status:'uploading'}]);
  try{
   const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('کاربر وارد نشده است.');
   const{data:profile,error:pe}=await supabase.from('profiles').select('organization_id').eq('id',user.id).maybeSingle();if(pe||!profile?.organization_id)throw new Error(pe?.message||'سازمان کاربر مشخص نیست.');
   const path=`${profile.organization_id}/${shipmentId||'ai-chat'}/${makeClientId()}-${file.name.replace(/[^\\w.\\-\\u0600-\\u06ff]+/g,'_')}`;
   const{error:ue}=await supabase.storage.from('customs_documents').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});if(ue)throw new Error(`آپلود ناموفق: ${ue.message}`);
   let docId=temp;
   if(shipmentId){const{data:doc,error:de}=await supabase.from('shipment_documents').insert({organization_id:profile.organization_id,shipment_id:shipmentId,uploaded_by:user.id,document_name:file.name,original_file_name:file.name,storage_path:path,mime_type:file.type||'application/octet-stream',file_size_bytes:file.size,extraction_status:'pending'}).select('id').single();if(de||!doc){await supabase.storage.from('customs_documents').remove([path]);throw new Error(de?.message||'ثبت سند ناموفق بود.')}docId=doc.id}
   setDocs(d=>d.map(x=>x.id===temp?{...x,id:docId,path,status:'ready'}:x));
   setStatus(`✓ ${file.name} آپلود شد. حالا درخواست استخراج را ارسال کنید.`);
  }catch(e:any){setDocs(d=>d.map(x=>x.id===temp?{...x,status:'failed',error:e?.message||'آپلود ناموفق'}:x));throw e}
 };
 const chooseFiles=async(list:FileList|null)=>{if(!list?.length)return;setBusy(true);setStatus('⏳ در حال آپلود فایل…');for(const file of Array.from(list)){try{await uploadFile(file)}catch(e:any){setStatus(`✕ ${file.name}: ${e?.message||'آپلود ناموفق'}`)}}setBusy(false)};
 const sendChat=async()=>{
  const prompt=input.trim();
  if(!prompt||busy)return;
  setBusy(true);setStatus('⏳ در حال دریافت پاسخ…');setMessages(m=>[...m,{role:'user',text:prompt}]);setInput('');
  try{
   const{data,error}=await supabase.functions.invoke('ai-core',{body:{query:prompt,page_context:pageContext,shipment_id:shipmentId||undefined,mode:'chat'}});
   if(error)throw error;
   const answer=typeof data?.answer==='string'?data.answer:(data?.answer?JSON.stringify(data.answer):data?.message||'پاسخ دریافت نشد.');
   setMessages(m=>[...m,{role:'assistant',text:answer}]);setStatus('');
  }catch(e:any){const detail=await explain(e);setStatus('✕ خطای دستیار: '+detail);setMessages(m=>[...m,{role:'assistant',text:'خطای دستیار: '+detail}]);}
  finally{setBusy(false)}
 };
 const requestExtraction=async()=>{
  const ready=docs.filter(d=>d.status==='ready'||d.status==='done');if(!ready.length){setStatus('ابتدا فایل را انتخاب و صبر کنید تا «آپلود شد» نمایش داده شود.');return}
  const prompt=input.trim()||'اطلاعات این اسناد را برای ثبت محموله در Customs OS استخراج کن. همه صفحات، جدول‌ها، سربرگ‌ها و پاورقی‌ها را بررسی کن و فقط اطلاعات واقعی را استخراج کن.';
  setBusy(true);setStatus('⏳ درخواست استخراج ارسال شد…');setMessages(m=>[...m,{role:'user',text:prompt}]);setInput('');let merged:Record<string,string>={};
  try{
   for(const d of ready){setDocs(xs=>xs.map(x=>x.id===d.id?{...x,status:'extracting'}:x));
    const{data,error}=await supabase.functions.invoke('ai-assistant',{body:{query:prompt,document_storage_path:d.path,document_mime_type:'application/pdf',extract_fields:true,page_context:pageContext,shipment_id:shipmentId||undefined}});
    if(error)throw error;const answer=typeof data?.answer==='string'?data.answer:JSON.stringify(data?.answer||data?.fields||{});const parsed=parseFields(answer);merged={...merged,...parsed};
    setDocs(xs=>xs.map(x=>x.id===d.id?{...x,status:'done',fields:parsed}:x));
   }
   setFields(merged);setMessages(m=>[...m,{role:'assistant',text:`استخراج با موفقیت انجام شد. ${Object.keys(merged).length} فیلد استخراج شد. حالا می‌توانید آن‌ها را روی فرم ثبت محموله اعمال کنید.`}]);setStatus('✓ استخراج انجام شد.');
  }catch(e:any){const detail=await explain(e);setStatus(`✕ خطای استخراج: ${detail}`);setMessages(m=>[...m,{role:'assistant',text:`خطای استخراج: ${detail}`}]);setDocs(xs=>xs.map(x=>x.status==='extracting'?{...x,status:'ready'}:x));
  }finally{setBusy(false)}
 };
 const apply=()=>{let count=0;const normalize=(s:string)=>s.toLowerCase().replace(/[\u200c\u200f\u0640]/g,' ').replace(/[_-]+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();const aliases:Record<string,string[]>= {vesselName:['کشتی','vessel'],billOfLading:['بارنامه','bl','bill of lading'],cargoCount:['تعداد','quantity'],cargoCountUnit:['واحد','unit'],netWeight:['وزن خالص','net weight'],grossWeight:['وزن ناخالص','gross weight'],originPort:['مبدأ','origin port'],destinationPort:['مقصد','destination port'],client:['صاحب کالا','client','consignee']};for(const[k,v]of Object.entries(fields)){const names=[k,...(aliases[k]||[])].map(normalize);const els=Array.from(document.querySelectorAll('input,select,textarea')) as any[];const el=els.find(e=>names.some(n=>normalize([e.name,e.id,e.placeholder,e.getAttribute('aria-label')].filter(Boolean).join(' ')).includes(n)));if(!el)continue;if(el.tagName==='SELECT'){const o=Array.from(el.options).find((x:any)=>normalize(x.textContent||'').includes(normalize(v)));if(o)el.value=(o as any).value}else el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));count++}setStatus(`${count} فیلد روی فرم اعمال شد.`)};
 return <>{!open&&<button type="button" className="ai-launcher" aria-label="باز کردن دستیار هوشمند" onClick={()=>setOpen(true)}><Bot size={19}/></button>}{open&&<><div className="ai-backdrop" onClick={()=>setOpen(false)}/><aside className="ai-chat-panel" dir="rtl"><header className="ai-chat-header"><div className="ai-chat-header-main"><div className="ai-chat-avatar"><Bot size={17}/></div><div><div className="ai-chat-title">Customs AI</div><div className="ai-chat-subtitle">دستیار هوشمند Customs OS</div></div></div><div className="ai-chat-header-actions"><button className="ai-header-icon" onClick={()=>{setMessages([]);setStatus('')}}><SquarePen size={17}/></button><button className="ai-header-icon" onClick={()=>setOpen(false)}><PanelLeftClose size={18}/></button></div></header><main className="ai-chat-messages"><div className="ai-chat-column">{messages.map((m,i)=><div key={i} className={`ai-message-row ${m.role==='user'?'is-user':'is-assistant'}`}><div className="ai-message"><div className="ai-message-role">{m.role==='user'?'شما':'Customs AI'}</div><div className="whitespace-pre-wrap leading-7">{m.text}</div></div></div>)}{docs.length>0&&<div className="ai-doc-toast"><div className="flex items-center gap-2"><b>اسناد</b>{docs.every(d=>d.status==='ready'||d.status==='done')?<CheckCircle2 size={16}/>:<Loader2 size={16} className="animate-spin"/>}</div>{docs.map(d=><div key={d.id} className="text-xs mt-2 flex items-center gap-2">{d.status==='uploading'&&<Loader2 size={14} className="animate-spin"/>}{d.status==='ready'&&<CheckCircle2 size={14}/>} {d.status==='extracting'&&<Loader2 size={14} className="animate-spin"/>}{d.status==='done'&&<CheckCircle2 size={14}/>}<span className="truncate">{d.name}</span><span>{d.status==='uploading'?'در حال آپلود':d.status==='ready'?'آپلود شد؛ آماده استخراج':d.status==='extracting'?'در حال استخراج':d.status==='done'?'استخراج شد':'ناموفق'}</span></div>)}{Object.keys(fields).length>0&&<button type="button" className="ai-doc-apply" onClick={()=>void requestExtraction()} disabled={busy||!docs.some(d=>d.status==='ready'||d.status==='done')}>استخراج اسناد با درخواست فعلی</button><button type="button" className="ai-doc-apply" onClick={apply}>اعمال اطلاعات استخراج‌شده روی فرم</button>}</div>}{status&&<div className="ai-status">{status}</div>}{busy&&<div className="ai-typing"><span/><span/><span/><em>در حال پردازش…</em></div>}</div></main><footer className="ai-chat-composer-wrap"><div className="ai-chat-composer"><button type="button" className="ai-composer-icon" title="افزودن فایل" onClick={()=>fileRef.current?.click()}><Plus size={20}/></button><input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e=>{void chooseFiles(e.target.files);e.currentTarget.value=''}}/><textarea value={input} onChange={e=>setInput(e.target.value)} rows={1} placeholder="پیام خود را بنویسید..." className="ai-chat-input"/><button type="button" className="ai-send-button" disabled={busy||!input.trim()} onClick={()=>void sendChat()}><Send size={17}/></button></div><div className="ai-composer-hint">برای چت عادی پیام را ارسال کنید. پس از آپلود سند، دکمه «استخراج اسناد» برای استخراج فعال می‌شود.</div></footer></aside></>}</>;
};
