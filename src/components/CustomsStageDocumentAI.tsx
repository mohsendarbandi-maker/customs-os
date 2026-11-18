import React,{useCallback,useEffect,useMemo,useState}from'react';
import{FileSearch,Loader2,RefreshCw,Sparkles,CheckCircle2,Link2,Unlink2,AlertTriangle}from'lucide-react';
import{supabase}from'../lib/supabase';
import{invokeEdgeFunction}from'../lib/edgeFunction';
import{CUSTOMS_OPERATION_SECTIONS,customsOperationFieldSchema,isCustomsDocumentAssignedToSection,parseCustomsDocumentExtraction,type CustomsOperationSection}from'../lib/customsDocumentAI';

type Props={declarationId:string;shipmentId:string;organizationId:string;section:CustomsOperationSection;editable:boolean};
type StageFile={
 id:string;sourceKey:string;sourceKind:'shipment_document'|'file_manager_file';shipmentDocumentId:string|null;
 fileManagerFileId:string|null;customsDocumentId:string|null;fileAssetId:string|null;
 originalName:string;displayName:string;mimeType:string;sizeBytes:number;storagePath:string|null;
 storageBackend:string|null;operationSections:string[];metadata:Record<string,unknown>;
};
type Extraction={id:string;source_key:string;status:string;extracted_fields:Record<string,string>|null;provider:string|null;error:string|null;updated_at:string};

export const CustomsStageDocumentAI:React.FC<Props>=({declarationId,shipmentId,organizationId,section,editable})=>{
 const[files,setFiles]=useState<StageFile[]>([]);
 const[results,setResults]=useState<Record<string,Extraction>>({});
 const[loading,setLoading]=useState(true);
 const[busyId,setBusyId]=useState('');
 const[bulkExtracting,setBulkExtracting]=useState(false);
 const[error,setError]=useState('');
 const[message,setMessage]=useState('');
 const config=CUSTOMS_OPERATION_SECTIONS[section];
 const fields=useMemo(()=>customsOperationFieldSchema(section),[section]);

 const load=useCallback(async()=>{
  if(!declarationId||!shipmentId||!organizationId){setFiles([]);setResults({});setLoading(false);return;}
  setLoading(true);setError('');
  try{
   const [{data:shipmentRows,error:shipmentError},{data:fileRows,error:fileError},{data:extractionRows,error:extractionError}]=await Promise.all([
    supabase.from('shipment_documents').select('id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,storage_backend,file_asset_id,document_type,operation_sections,is_archived').eq('organization_id',organizationId).eq('shipment_id',shipmentId).eq('is_archived',false).order('created_at',{ascending:false}),
    supabase.from('file_manager_files').select('id,shipment_document_id,customs_document_id,file_asset_id,original_name,mime_type,size_bytes,document_type,operation_sections,metadata,storage_path,is_archived').eq('organization_id',organizationId).eq('shipment_id',shipmentId).eq('is_archived',false).order('created_at',{ascending:false}),
    supabase.from('customs_document_extractions').select('id,source_key,status,extracted_fields,provider,error,updated_at').eq('organization_id',organizationId).eq('declaration_id',declarationId).eq('operation_section',section).order('updated_at',{ascending:false}),
   ]);
   if(shipmentError)throw shipmentError;if(fileError)throw fileError;if(extractionError)throw extractionError;
   const next:StageFile[]=(shipmentRows||[]).map((row:any)=>({
    id:row.id,sourceKey:'shipment-document:'+row.id,sourceKind:'shipment_document',shipmentDocumentId:row.id,
    fileManagerFileId:null,customsDocumentId:null,fileAssetId:row.file_asset_id||null,originalName:row.original_file_name||row.document_name,
    displayName:row.document_name||row.original_file_name,mimeType:row.mime_type||'application/octet-stream',sizeBytes:Number(row.file_size_bytes||0),
    storagePath:row.storage_path||null,storageBackend:row.storage_backend||'supabase',operationSections:Array.isArray(row.operation_sections)?row.operation_sections:[],metadata:{documentType:row.document_type||''},
   }));
   for(const row of (fileRows||[]) as any[]){
    const existing=next.find(item=>(row.shipment_document_id&&item.shipmentDocumentId===row.shipment_document_id)||(row.file_asset_id&&item.fileAssetId===row.file_asset_id));
    if(existing){
     existing.fileManagerFileId=row.id;existing.fileAssetId=existing.fileAssetId||row.file_asset_id||null;
     existing.operationSections=[...new Set([...existing.operationSections,...(Array.isArray(row.operation_sections)?row.operation_sections:[])])];
     existing.metadata=row.metadata||{};existing.displayName=String((row.metadata as any)?.documentName||existing.displayName);
     existing.storagePath=existing.storagePath||row.storage_path||null;
    }else{
     next.push({id:row.id,sourceKey:'file-manager:'+row.id,sourceKind:'file_manager_file',shipmentDocumentId:null,fileManagerFileId:row.id,
      customsDocumentId:row.customs_document_id||null,fileAssetId:row.file_asset_id||null,originalName:row.original_name,
      displayName:String((row.metadata as any)?.documentName||row.original_name),mimeType:row.mime_type||'application/octet-stream',
      sizeBytes:Number(row.size_bytes||0),storagePath:row.storage_path||null,storageBackend:null,
      operationSections:Array.isArray(row.operation_sections)?row.operation_sections:[],metadata:{...(row.metadata||{}),documentType:row.document_type||''}});
    }
   }
   setFiles(next);
   setResults(Object.fromEntries(((extractionRows||[]) as Extraction[]).map(row=>[row.source_key,row])));
  }catch(reason){setError(reason instanceof Error?reason.message:'بارگذاری اسناد این محموله ناموفق بود.');}
  finally{setLoading(false);}
 },[declarationId,shipmentId,organizationId,section]);
 useEffect(()=>{void load()},[load]);

 const assign=async(file:StageFile,checked:boolean)=>{
  if(!editable)return;
  setError('');setMessage('');
  const sections=checked?[...new Set([...file.operationSections,section])]:file.operationSections.filter(item=>item!==section);
  try{
   if(file.shipmentDocumentId){
    const{error:e}=await supabase.from('shipment_documents').update({operation_sections:sections}).eq('organization_id',organizationId).eq('id',file.shipmentDocumentId);if(e)throw e;
   }
   if(file.fileManagerFileId){
    const{error:e}=await supabase.from('file_manager_files').update({operation_sections:sections,metadata:{...file.metadata,customsOperationSections:sections,documentName:file.displayName}}).eq('organization_id',organizationId).eq('id',file.fileManagerFileId);if(e)throw e;
   }
   setFiles(previous=>previous.map(item=>item.id===file.id?{...item,operationSections:sections}:item));
   setMessage(checked?'سند به این باکس عملیات متصل شد.':'ارتباط سند با این باکس برداشته شد.');
  }catch(reason){setError(reason instanceof Error?reason.message:'ذخیره ارتباط سند با باکس ناموفق بود.');}
 };

 const extract=async(file:StageFile):Promise<boolean>=>{
  if(!editable)return false;
  if(!isCustomsDocumentAssignedToSection(file.operationSections,section)){setError('ابتدا این فایل را به باکس «'+config.label+'» متصل کنید.');return false;}
  if(!file.storagePath&&!file.fileAssetId){setError('برای این فایل مسیر ذخیره‌سازی یا شناسه آرشیو موجود نیست.');return false;}
  setBusyId(file.id);setError('');setMessage('استخراج اطلاعات همین سند برای بخش «'+config.label+'» آغاز شد…');
  const pendingRow={
   organization_id:organizationId,declaration_id:declarationId,shipment_id:shipmentId,
   shipment_document_id:file.shipmentDocumentId,file_manager_file_id:file.fileManagerFileId,
   customs_document_id:file.customsDocumentId,file_asset_id:file.fileAssetId,source_key:file.sourceKey,
   operation_section:section,document_type:String((file.metadata as any)?.documentType||''),display_name:file.displayName,
   original_file_name:file.originalName,status:'processing',error:null,extracted_by:null,
  };
  try{
   const{data:{user}}=await supabase.auth.getUser();
   const initialRow={...pendingRow,extracted_by:user?.id||null};
   const{error:processingError}=await supabase.from('customs_document_extractions').upsert(initialRow,{onConflict:'declaration_id,source_key,operation_section'});
   if(processingError)throw processingError;
   const{data,error:aiError}=await invokeEdgeFunction('ai-assistant',{body:{
    query:'فقط اطلاعات قابل مشاهده در همین فایل را برای باکس عملیات گمرکی «'+config.label+'» استخراج کن. از فایل یا عملیات دیگر استفاده نکن، هیچ شماره رسمی، مبلغ، تاریخ یا وضعیت را حدس نزن. مقادیر ناموجود یا ناخوانا را خالی برگردان. متن هر فیلد را به همان شکل سند حفظ کن. خروجی فقط JSON با کلیدهای تعریف‌شده باشد.',
    extract_fields:true,form_schema:fields,page_context:'customs-operation:'+section,shipment_id:shipmentId,
    document_mime_type:file.mimeType,document_size_bytes:file.sizeBytes,
    ...(file.fileAssetId&&(file.storageBackend==='telegram'||file.sourceKind==='file_manager_file'||file.storagePath?.startsWith('telegram://'))?{telegram_file_asset_id:file.fileAssetId}:{document_storage_path:file.storagePath||undefined}),
   }});
   if(aiError)throw aiError;
   const extracted=parseCustomsDocumentExtraction(String(data?.answer||''),section);
   const saved={...initialRow,status:'completed',extracted_fields:extracted,confidence:null,provider:String(data?.provider||''),error:null,completed_at:new Date().toISOString()};
   const{data:row,error:saveError}=await supabase.from('customs_document_extractions').upsert(saved,{onConflict:'declaration_id,source_key,operation_section'}).select('id,source_key,status,extracted_fields,provider,error,updated_at').single();
   if(saveError)throw saveError;
   setResults(previous=>({...previous,[file.sourceKey]:row as Extraction}));
   setMessage('استخراج تمام شد و نتیجه فقط در باکس «'+config.label+'» ذخیره شد؛ برای ثبت در فرم اصلی آن را بازبینی کنید.');
   return true;
  }catch(reason){
   const message=reason instanceof Error?reason.message:'استخراج هوشمند سند ناموفق بود.';
   const{data:row}=await supabase.from('customs_document_extractions').upsert({...pendingRow,status:'failed',error:message},{onConflict:'declaration_id,source_key,operation_section'}).select('id,source_key,status,extracted_fields,provider,error,updated_at').maybeSingle();
   if(row)setResults(previous=>({...previous,[file.sourceKey]:row as Extraction}));
   setError(message);setMessage('');
   return false;
  }finally{setBusyId('');}
 };

 const assignedFiles=files.filter(file=>isCustomsDocumentAssignedToSection(file.operationSections,section));
 const extractAllAssigned=async()=>{
  if(!editable||bulkExtracting||busyId)return;
  if(!assignedFiles.length){setError('هیچ فایلی به این باکس متصل نشده است.');return;}
  setBulkExtracting(true);setError('');setMessage('استخراج فایل‌های متصل به «'+config.label+'» به‌ترتیب آغاز شد…');
  let succeeded=0;let failed=0;
  try{
   for(const file of assignedFiles){
    try{if(await extract(file))succeeded+=1;else failed+=1;}catch{failed+=1;}
   }
   setMessage(`${succeeded} فایل با موفقیت استخراج و در باکس «${config.label}» ذخیره شد؛ ${failed} فایل ناموفق بود.`);
   if(failed)setError('برای فایل‌های ناموفق، خطا در کارت همان فایل نمایش داده می‌شود.');
  }finally{setBulkExtracting(false);}
 };

 if(!shipmentId)return null;
 return <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 sm:p-5 space-y-3">
  <header className="flex flex-wrap items-start justify-between gap-2">
   <div><div className="flex items-center gap-2 font-black"><Sparkles size={17}/> اسناد و استخراج هوشمند · {config.label}</div>
   <p className="mt-1 text-xs app-muted">هر فایل به‌صورت مستقل تحلیل می‌شود؛ نتیجه فقط در همین باکس ذخیره می‌شود و قبل از انتقال به فرم باید بازبینی شود.</p></div>
   <div className="flex items-center gap-2">
    {editable&&<button type="button" onClick={()=>void extractAllAssigned()} disabled={loading||!!busyId||bulkExtracting||assignedFiles.length===0} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Sparkles size={14}/>{bulkExtracting?'در حال استخراج همه فایل‌ها…':`استخراج همه فایل‌های متصل (${assignedFiles.length})`}</button>}
    <button type="button" onClick={()=>void load()} disabled={loading||!!busyId||bulkExtracting} className="rounded-lg border app-border p-2" aria-label="بروزرسانی اسناد"><RefreshCw size={15} className={loading?'animate-spin':''}/></button>
   </div>
  </header>
  {error&&<div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600"><AlertTriangle size={14} className="inline ml-1"/>{error}</div>}
  {message&&<p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
  {loading?<div className="py-4 text-sm app-muted"><Loader2 className="inline ml-2 animate-spin" size={16}/>در حال دریافت فایل‌های محموله…</div>:
   files.length===0?<p className="rounded-xl border app-border p-3 text-sm app-muted">هنوز سندی در فایل‌منیجر این محموله ثبت نشده است.</p>:
   <div className="space-y-2">{files.map(file=>{
    const assigned=file.operationSections.includes(section);const result=results[file.sourceKey];
    return <article key={file.sourceKey} className="rounded-xl border app-border bg-[var(--surface-2)] p-3">
     <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><FileSearch size={16} className="shrink-0 app-muted"/><b className="truncate text-sm">{file.displayName}</b></div>
       <p className="mt-1 text-[11px] app-muted" dir="auto">نام اصلی: {file.originalName} · {Math.max(1,Math.round(file.sizeBytes/1024))} KB · {file.sourceKind==='shipment_document'?'سند محموله':'فایل‌منیجر'}</p>
       {result&&<p className="mt-1 text-[11px]">{result.status==='completed'?<><CheckCircle2 size={13} className="inline ml-1 text-emerald-600"/>استخراج ذخیره‌شده</>:result.status==='failed'?'استخراج ناموفق: '+(result.error||'خطای نامشخص'):'در صف پردازش'}</p>}
      </div>
      {editable&&<button type="button" onClick={()=>void assign(file,!assigned)} disabled={!!busyId} className={'inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-bold '+(assigned?'border-emerald-500/30 text-emerald-700':'app-border')}>
       {assigned?<Unlink2 size={13}/>:<Link2 size={13}/>} {assigned?'متصل به این باکس':'اتصال به این باکس'}
      </button>}
     </div>
     {result?.extracted_fields&&<div className="mt-2 rounded-lg border app-border bg-[var(--surface)] p-2"><b className="text-xs">خروجی استخراج‌شده</b><dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">{Object.entries(result.extracted_fields).map(([key,value])=><div key={key} className="min-w-0 text-xs"><dt className="app-muted">{fields.find(f=>f.key===key)?.label||key}</dt><dd className="break-words font-semibold" dir="auto">{String(value)}</dd></div>)}</dl></div>}
     {editable&&<button type="button" onClick={()=>void extract(file)} disabled={!!busyId||bulkExtracting||!assigned} title={!assigned?'ابتدا فایل را به این باکس متصل کنید':''} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">
      {busyId===file.id?<Loader2 size={14} className="animate-spin"/>:<Sparkles size={14}/>} {busyId===file.id?'در حال استخراج…':!assigned?'ابتدا اتصال فایل به این باکس را فعال کنید':result?.status==='completed'?'استخراج مجدد این فایل برای این باکس':'استخراج هوشمند این فایل'}
     </button>}
    </article>;
   })}</div>}
  {!editable&&<p className="text-xs app-muted">دسترسی این کاربر فقط مشاهده است.</p>}
 </section>;
};
