import React,{useEffect,useState} from 'react';
import {ArrowRight,Download,FileText,Loader2,Trash2,Upload} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {createTelegramArchiveIdempotencyKey,downloadTelegramArchivedFile,FILE_ARCHIVE_MAX_BYTES,getDefaultClientUploadFolder,getFileArchiveDestination,uploadTelegramArchivedFile} from '../lib/fileManager';

type Client={id:string;name:string;national_id:string|null};type Doc={id:string;original_name:string;display_name:string|null;storage_path:string;mime_type:string|null;size_bytes:number|null;storage_backend?:'supabase'|'telegram';file_asset_id?:string|null;folder_id?:string|null;is_archived?:boolean;created_at:string};
const BUCKET='customs_documents';
export const ClientDocumentManagerPage:React.FC=()=>{const[clients,setClients]=useState<Client[]>([]);const[selected,setSelected]=useState('');const[docs,setDocs]=useState<Doc[]>([]);const[busy,setBusy]=useState(false);const[message,setMessage]=useState('');const[error,setError]=useState('');const[input]=useState(()=>React.createRef<HTMLInputElement>());const[pendingFiles,setPendingFiles]=useState<File[]>([]);const[documentName,setDocumentName]=useState('');const[tagInput,setTagInput]=useState('');const uploadTags=[...new Set(tagInput.split(',').map(tag=>tag.trim()).filter(Boolean))].slice(0,20);
 const profile=async()=>{const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('کاربر وارد نشده است.');const{data,error}=await supabase.from('profiles').select('organization_id').eq('id',user.id).single();if(error||!data?.organization_id)throw error||new Error('سازمان کاربر مشخص نیست.');return{user,org:data.organization_id};};
 const loadClients=async()=>{const{org}=await profile();const{data,error}=await supabase.from('clients').select('id,name,national_id').eq('organization_id',org).order('name');if(error)throw error;setClients((data||[]) as Client[]);const saved=localStorage.getItem('customs_last_client');const sid=JSON.parse(saved||'null')?.id;setSelected(sid&&data?.some((x:any)=>x.id===sid)?sid:data?.[0]?.id||'')};
 const loadDocs=async(id:string)=>{if(!id)return setDocs([]);const{data,error}=await supabase.from('customs_documents').select('id,original_name,display_name,storage_path,mime_type,size_bytes,storage_backend,file_asset_id,folder_id,is_archived,created_at').eq('client_id',id).is('shipment_id',null).eq('is_archived',false).order('created_at',{ascending:false});if(error)throw error;setDocs((data||[]) as Doc[])};
 useEffect(()=>{void loadClients().catch(e=>setError(e.message))},[]);useEffect(()=>{void loadDocs(selected).catch(e=>setError(e.message))},[selected]);
 const upload=async(files:File[],customName='')=>{
  if(!files.length||!selected)return;
  setBusy(true);setError('');setMessage('');
  let completed=0;
  try{
   const {org}=await profile();
   const folder=await getDefaultClientUploadFolder(selected);
   const destination=await getFileArchiveDestination();
   for(const f of files){
    if(!/\.(pdf|jpe?g|png)$/i.test(f.name))throw new Error('فقط PDF/JPG/PNG قابل آپلود است.');
    if(f.size<=0||f.size>FILE_ARCHIVE_MAX_BYTES)throw new Error('حجم هر فایل برای آرشیو قابل بازیابی تلگرام باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
    const documentType='TECHNICAL_SPEC_CATALOG';
    const documentNameToSave=files.length===1&&customName?customName:f.name;
    const idempotencyKey=await createTelegramArchiveIdempotencyKey(f,{
     folderId:folder.id,documentType,documentName:documentNameToSave,destination
    });
    await uploadTelegramArchivedFile(f,{
     organizationId:org,folderId:folder.id,documentType,
     documentName:documentNameToSave,
     tags:uploadTags,destination,idempotencyKey,
     onProgress:setMessage
    });
    completed++;
    setPendingFiles(previous=>previous.filter(candidate=>candidate!==f));
   }
   await loadDocs(selected);
   setPendingFiles([]);setDocumentName('');setTagInput('');
   setMessage(`${completed} مدرک شرکت مستقیماً در آرشیو تلگرام ذخیره شد و در پوشه صاحب کالا ثبت شد.`);
  }catch(e:any){
   await loadDocs(selected);
   setError(e?.message||'آپلود در آرشیو تلگرام ناموفق بود');
   if(completed)setMessage(`${completed} مدرک ذخیره شد؛ فایل‌های باقی‌مانده در صف هستند.`);
  }finally{setBusy(false)}
};
 const download=async(d:Doc)=>{
  if(d.storage_backend==='telegram'&&d.file_asset_id){
   try{
    const blob=await downloadTelegramArchivedFile(d.file_asset_id);
    const u=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=u;a.download=d.original_name;a.click();window.setTimeout(()=>URL.revokeObjectURL(u),2000);
   }catch(e:any){setError(e?.message||'دریافت فایل تلگرام ناموفق بود')}
   return;
  }
  const{data,error}=await supabase.storage.from(BUCKET).download(d.storage_path);
  if(error)return setError(error.message);
  const u=URL.createObjectURL(data);const a=document.createElement('a');a.href=u;a.download=d.original_name;a.click();window.setTimeout(()=>URL.revokeObjectURL(u),2000)
 };
 const remove=async(d:Doc)=>{
  const telegram=d.storage_backend==='telegram'&&Boolean(d.file_asset_id);
  const prompt=telegram
   ? `مدرک «${d.original_name}» از فهرست فعال بایگانی شود؟ نسخه اصلی در آرشیو تلگرام حذف نخواهد شد.`
   : `مدرک «${d.original_name}» حذف شود؟`;
  if(!window.confirm(prompt))return;
  setBusy(true);setError('');setMessage('');
  try{
   if(telegram){
    const {data:{user},error:userError}=await supabase.auth.getUser();
    if(userError||!user)throw userError||new Error('کاربر وارد نشده است.');
    const {error}=await supabase.from('customs_documents').update({
     is_archived:true,archived_at:new Date().toISOString(),archived_by:user.id,archive_reason:'Archived from client document manager'
    }).eq('id',d.id).eq('client_id',selected);
    if(error)throw error;
    setMessage('مدرک از فهرست فعال بایگانی شد؛ نسخه اصلی در آرشیو تلگرام باقی مانده است.');
   }else{
    await supabase.storage.from(BUCKET).remove([d.storage_path]);
    const {error}=await supabase.from('customs_documents').delete().eq('id',d.id);
    if(error)throw error;
   }
   await loadDocs(selected);
  }catch(e:any){setError(e.message||'عملیات روی مدرک ناموفق بود')}finally{setBusy(false)}
 };
 const client=clients.find(x=>x.id===selected);return <main dir="rtl" className="min-h-screen p-5 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-6xl mx-auto space-y-5"><header className="flex items-center justify-between"><div><div className="text-xs app-muted">فایل منیجر</div><h1 className="text-2xl font-black">مدارک شرکت‌ها</h1><p className="text-sm app-muted mt-1">مدارک ثابت هر شرکت برای مراجعه و استفاده در زمان نیاز.</p></div><Link to="/clients" className="px-4 py-2 rounded-xl border app-border bg-[var(--surface)] text-sm"><ArrowRight className="inline ml-1" size={15}/>صاحبان کالا</Link></header>{error&&<div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}</div>}{message&&<div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">{message}</div>}<section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><label className="text-sm font-bold">شرکت</label><select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-2 w-full rounded-xl border app-border bg-[var(--surface-2)] p-3">{clients.map(c=><option key={c.id} value={c.id}>{c.name} — {c.national_id||'بدون شناسه ملی'}</option>)}</select>{client&&<div className="mt-3 text-xs app-muted">مدارک اختصاصی: {client.name}</div>}</section><section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden"><div className="p-5 border-b app-border flex items-center justify-between"><h2 className="font-black">مدارک شرکت</h2><button disabled={!selected||busy} onClick={()=>input.current?.click()} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Upload size={15} className="inline ml-2"/>انتخاب فایل</button><input ref={input} hidden type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={e=>{setPendingFiles(Array.from(e.target.files||[]));setDocumentName('');e.currentTarget.value=''}}/></div>{pendingFiles.length>0&&<div className="mx-5 mb-4 rounded-2xl border app-border bg-[var(--surface-2)] p-3"><div className="flex flex-col md:flex-row md:items-end gap-3"><div className="flex-1 min-w-0"><div className="text-xs font-bold">{pendingFiles.length} فایل انتخاب شده</div><div className="text-[11px] app-muted mt-1 truncate">{pendingFiles.map(f=>f.name).join('، ')}</div></div>{pendingFiles.length===1&&<label className="flex-1 min-w-0"><span className="text-xs font-bold">نام سند (اختیاری)</span><input value={documentName} onChange={e=>setDocumentName(e.target.value)} placeholder="مثلاً: کارت بازرگانی" className="mt-1 w-full rounded-xl border app-border bg-[var(--surface)] p-3"/><span className="text-[10px] app-muted mt-1 block">خالی بگذارید تا نام اصلی فایل ثبت شود.</span></label>}<div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>void upload(pendingFiles,documentName.trim())} className="px-4 py-3 rounded-xl bg-[var(--primary)] text-white font-bold">آپلود و ثبت</button><button type="button" disabled={busy} onClick={()=>{setPendingFiles([]);setDocumentName('')}} className="px-4 py-3 rounded-xl border app-border">لغو</button></div></div><label className="mt-3 block"><span className="mb-1 block text-xs font-bold app-muted">برچسب‌های مدرک (با ویرگول جدا کنید)</span><input value={tagInput} onChange={e=>setTagInput(e.target.value)} disabled={busy} placeholder="مثلاً: کارت بازرگانی، کاتالوگ، مجوز" className="w-full rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-sm"/><span className="mt-1 block text-[10px] app-muted">حداکثر ۲۰ برچسب؛ در جست‌وجوی فایل‌منیجر قابل یافتن است.</span></label></div>}{docs.length===0?<div className="p-8 text-center app-muted">هنوز مدرکی برای این شرکت ثبت نشده است.</div>:<div>{docs.map(d=><div key={d.id} className="flex items-center justify-between gap-3 p-4 border-b app-border"><div className="flex items-center gap-3 min-w-0"><FileText size={19}/><div className="min-w-0"><div className="font-semibold truncate">{d.display_name||d.original_name}</div><div className="text-xs app-muted">{new Date(d.created_at).toLocaleDateString('fa-IR')}</div></div></div><div className="flex gap-2"><button onClick={()=>void download(d)} className="p-2 rounded-lg border app-border" title="دانلود"><Download size={16}/></button><button onClick={()=>void remove(d)} disabled={busy} className="p-2 rounded-lg border border-red-400/40 text-red-500" title={d.storage_backend==="telegram" ? "بایگانی از فهرست فعال" : "حذف"}><Trash2 size={16}/></button></div></div>)}</div>}</section></div></main>};
