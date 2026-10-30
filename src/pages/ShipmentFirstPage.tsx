import React,{useEffect,useState}from'react';
import{CheckCircle2,Download,ExternalLink,Eye,FileText,Loader2,Plus,RefreshCw,Save,ShieldCheck,Ship,Sparkles,Upload}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{invokeEdgeFunction}from'../lib/edgeFunction';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc=workerUrl;
import{useAuth}from'../context/AuthContext';
import { useAutosavedDraft, formDraftKey } from '../hooks/useAutosavedDraft';
import { FormDraftIndicator } from '../components/FormDraftIndicator';
import{buildShipmentDisplayName}from'../lib/displayNames';
import {ShipmentStageCosts} from '../features/finance/ShipmentStageCosts';
import {AddReminderButton} from '../features/reminders/AddReminderButton';
import { archiveShipmentDocumentInBackground, createTelegramArchiveIdempotencyKey, downloadTelegramArchivedFile, FILE_ARCHIVE_MAX_BYTES, getDefaultClientUploadFolder, getDefaultShipmentUploadFolder, getFileArchiveDestination, uploadTelegramArchivedFile } from '../lib/fileManager';

type Vessel={id:string;name:string;imo_number?:string|null;flag_code?:string|null;shipping_line_id?:string|null};type ShippingLine={id:string;name:string;name_fa?:string|null};
type Office={id:string;code:string;name:string;city:string;is_active:boolean};type Row={id:string;client_id:string|null;vessel_id:string|null;customs_office_id:string|null;shipping_line:string|null;bill_of_lading_no:string|null;bill_of_lading_year:number|null;voyage_no:string|null;origin_port:string|null;destination_port:string|null;cargo_count:number|null;cargo_count_unit:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;current_status:string;current_location:string|null;display_name:string|null;case_id:string|null;transport_documents_status:'not_ready'|'ready';release_invoice_payment_status:'unpaid'|'paid';ship_passed:boolean;ship_passed_at:string|null;ship_passed_by:string|null};
type Form={ownerId:string;shippingLine:string;billOfLading:string;year:string;voyage:string;vessel:string;imo:string;flag:string;originPort:string;destinationPort:string;count:string;unit:string;net:string;gross:string;status:string;location:string;transportDocumentsStatus:'not_ready'|'ready';releaseInvoicePaymentStatus:'unpaid'|'paid'};
type Doc={id:string;document_name:string;original_file_name:string;storage_path:string;mime_type:string;file_size_bytes:number;storage_backend?:'supabase'|'telegram';file_asset_id?:string|null;folder_id?:string|null;created_at:string};type PendingShipmentDocument={id:string;name:string;mimeType:string;sizeBytes:number;pageCount:number;file:File;previewUrl:string;storagePath?:string;fileAssetId?:string;externalMessageId?:string;folderId?:string;uploadStatus:'uploading'|'ready'|'failed';uploadError?:string;clientId:string;uploadedBy:string;extractedFields?:Record<string,string>};
const empty:Form={ownerId:'',shippingLine:'',billOfLading:'',year:String(new Date().getFullYear()),voyage:'',vessel:'',imo:'',flag:'',originPort:'',destinationPort:'',count:'',unit:'رول',net:'',gross:'',status:'draft',location:'',transportDocumentsStatus:'not_ready',releaseInvoicePaymentStatus:'unpaid'};
const digits=(v:string)=>v.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const num=(v:string)=>{const n=Number(digits(v).replace(/[٬,]/g,''));return Number.isFinite(n)?n:null};
const same=(a:string,b:string)=>String(a||'').trim().localeCompare(String(b||'').trim(),'fa',{sensitivity:'base'})===0;
const statuses=[['draft','پیش‌نویس'],['booking_confirmed','تأیید رزرو'],['loading','در حال بارگیری'],['loaded','بارگیری کامل'],['departed','حرکت'],['in_transit','در مسیر'],['approaching_destination','نزدیک مقصد'],['anchorage','لنگرگاه'],['berthing','پهلوگیری'],['discharging','در حال تخلیه'],['discharged','تخلیه کامل'],['completed','تکمیل'],['delayed','تأخیر'],['cancelled','لغو']];
const BUCKET='customs_documents';

export const ShipmentFirstPage:React.FC=()=>{
 const{profile}=useAuth();
 const[clients,setClients]=useState<any[]>([]),[vessels,setVessels]=useState<Vessel[]>([]),[lines,setLines]=useState<ShippingLine[]>([]),[rows,setRows]=useState<Row[]>([]),[docs,setDocs]=useState<Doc[]>([]),[customsOffices,setCustomsOffices]=useState<Office[]>([]);const[uploadTagInput,setUploadTagInput]=useState('');const uploadTags=[...new Set(uploadTagInput.split(',').map(tag=>tag.trim()).filter(Boolean))].slice(0,20);
 const[selected,setSelected]=useState(''),[form,setForm]=useState<Form>(empty),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[message,setMessage]=useState('');
 const[pendingDocuments,setPendingDocuments]=useState<PendingShipmentDocument[]>([]),[selectedBillOfLadingId,setSelectedBillOfLadingId]=useState(''),[extractingBillOfLadingId,setExtractingBillOfLadingId]=useState(''),[previewBillOfLadingId,setPreviewBillOfLadingId]=useState(''),[previewBillOfLadingUrl,setPreviewBillOfLadingUrl]=useState('');
 const hasPendingUploads=pendingDocuments.some(document=>document.uploadStatus==='uploading');
 const shipmentFileInput=React.useRef<HTMLInputElement|null>(null);
  const formDraft=useAutosavedDraft(
  formDraftKey(profile?.id,`shipment-first:${profile?.organization_id||''}`,profile?.organization_id),
  {selected,form},
  (draft:{selected?:string;form?:Form})=>{
   setSelected(draft.selected||'');
   setForm({...empty,...(draft.form||{})});
  },
 );
 const set=(k:keyof Form,v:string)=>setForm(p=>({...p,[k]:v}));
 const ensureFreshSession=async()=>{
  const{data:{session},error:sessionError}=await supabase.auth.getSession();
  if(sessionError){
   console.error('[ShipmentFirstPage] session lookup failed:',sessionError);
   throw new Error('بررسی نشست ورود ناموفق بود. یک‌بار دوباره وارد شوید؛ پیش‌نویس فرم پاک نمی‌شود.');
  }
  if(!session?.user||session.user.id!==profile?.id){
   throw new Error('نشست ورود معتبر نیست یا منقضی شده است. دوباره وارد شوید؛ پیش‌نویس فرم روی همین مرورگر باقی می‌ماند.');
  }
  // Refresh before the first database write when the access token is expired
  // or close to expiry, avoiding a partial shipment workflow caused by JWT 401s.
  if(!session.expires_at||session.expires_at<=Math.floor(Date.now()/1000)+180){
   const{data,error:refreshError}=await supabase.auth.refreshSession();
   if(refreshError||!data.session?.access_token||data.session.user.id!==profile.id){
    console.error('[ShipmentFirstPage] session refresh failed:',refreshError);
    throw new Error('تمدید نشست ورود انجام نشد. دوباره وارد شوید و سپس ذخیره را بزنید؛ اطلاعات فرم حذف نمی‌شود.');
   }
  }
 };
 const loadDocs=async(id:string)=>{
  if(!id){setDocs([]);return}
  const{data,error}=await supabase.from('shipment_documents').select('id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,storage_backend,file_asset_id,folder_id,created_at').eq('shipment_id',id).order('created_at',{ascending:false});
  if(error){setMessage(error.message);return} setDocs((data||[]) as Doc[]);
 };
 const load=async()=>{
  if(!profile?.organization_id)return;
  setBusy(true);setMessage('');
  try{
   const[{data:c,error:ce},{data:s,error:se},{data:v,error:ve},{data:l,error:le}]=await Promise.all([
    supabase.from('clients').select('id,name,national_id').eq('organization_id',profile.organization_id).order('name'),
    supabase.from('shipments').select('id,client_id,vessel_id,shipping_line,bill_of_lading_no,bill_of_lading_year,voyage_no,origin_port,destination_port,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,current_location,display_name,case_id,customs_office_id,transport_documents_status,release_invoice_payment_status,ship_passed,ship_passed_at,ship_passed_by').eq('organization_id',profile.organization_id).order('created_at',{ascending:false}),
    supabase.from('vessels').select('id,name,imo_number,flag_code,shipping_line_id').eq('organization_id',profile.organization_id).order('name'),supabase.from('shipping_lines').select('id,name,name_fa').order('name')
   ]);
   if(ce||se||ve)throw ce||se||ve;
   setClients(c||[]);setVessels((v||[])as Vessel[]);setRows((s||[])as Row[]);setLines((l||[])as ShippingLine[]);const{data:offices,error:oe}=await supabase.from('customs_offices').select('id,code,name,city,is_active').order('name');if(oe)throw oe;setCustomsOffices((offices||[]) as Office[]);
  }catch(e:any){setMessage(e?.message||'خطا در دریافت اطلاعات')}finally{setBusy(false)}
 };
 useEffect(()=>{void load()},[profile?.organization_id]);
 useEffect(()=>{void loadDocs(selected)},[selected]);
 const chooseLine=(name:string)=>{set('shippingLine',name);const line=lines.find(x=>same(x.name,name)||same(x.name_fa||'',name));if(line&&!form.vessel){const v=vessels.find(x=>x.shipping_line_id===line.id);if(v){set('vessel',v.name);set('imo',v.imo_number||'');set('flag',v.flag_code||'')}}};
 const chooseVessel=(name:string)=>{set('vessel',name);const v=vessels.find(x=>same(x.name,name));if(v){set('imo',v.imo_number||'');set('flag',v.flag_code||'')}};
 const reset=()=>{formDraft.clearDraft(true,{selected:'',form:empty});setSelected('');setForm(empty);setDocs([]);setMessage(pendingDocuments.length?'فرم محموله جدید آماده شد؛ فایل‌های بارگذاری‌شده برای اتصال به محموله بعدی حفظ شدند.':'محموله جدید آماده ثبت است.')};
 const edit=(r:Row)=>{const v=vessels.find(x=>x.id===r.vessel_id);setSelected(r.id);setForm({ownerId:r.client_id||'',shippingLine:r.shipping_line||'',billOfLading:r.bill_of_lading_no||'',year:String(r.bill_of_lading_year||new Date().getFullYear()),voyage:r.voyage_no||'',vessel:v?.name||'',imo:v?.imo_number||'',flag:v?.flag_code||'',originPort:r.origin_port||'',destinationPort:r.destination_port||'',count:r.cargo_count==null?'':String(r.cargo_count),unit:r.cargo_count_unit||'رول',net:r.net_weight_kg==null?'':String(r.net_weight_kg),gross:r.gross_weight_kg==null?'':String(r.gross_weight_kg),status:r.current_status||'draft',location:r.current_location||'',transportDocumentsStatus:r.transport_documents_status||'not_ready',releaseInvoicePaymentStatus:r.release_invoice_payment_status||'unpaid'});setMessage('محموله برای مدیریت انتخاب شد.')};
 const ensureVessel=async()=>{
  const name=form.vessel.trim();if(!name)throw new Error('نام کشتی الزامی است.');
  const found=vessels.find(v=>same(v.name,name));if(found)return found;
  const line=lines.find(x=>same(x.name,form.shippingLine)||same(x.name_fa||'',form.shippingLine));
  const imo=digits(form.imo).replace(/\D/g,'');if(imo&&!/^\d{7}$/.test(imo))throw new Error('IMO باید ۷ رقم باشد.');
  const{data,error}=await supabase.from('vessels').insert({organization_id:profile?.organization_id,name,imo_number:imo||null,flag_code:form.flag.toUpperCase()||null,shipping_line_id:line?.id||null}).select('id,name,imo_number,flag_code,shipping_line_id').single();
  if(error)throw error;setVessels(p=>[...p,data as Vessel]);return data as Vessel;
 };
 const archivePendingShipmentDocument=async(document:PendingShipmentDocument)=>{
 setPendingDocuments(previous=>previous.map(item=>item.id===document.id?{...item,uploadStatus:'uploading',uploadError:undefined}:item));
 try{
  if(document.sizeBytes<=0||document.sizeBytes>FILE_ARCHIVE_MAX_BYTES)throw new Error('حجم فایل برای آرشیو قابل بازیابی تلگرام باید حداکثر ۲۰ مگابایت باشد.');
  if(!document.clientId)throw new Error('ابتدا صاحب کالا را انتخاب کنید.');
  const {data:{user},error:userError}=await supabase.auth.getUser();
  if(userError||!user)throw new Error('نشست کاربر معتبر نیست؛ دوباره وارد شوید.');
  const [ownerFolder,destination]=await Promise.all([getDefaultClientUploadFolder(document.clientId),getFileArchiveDestination()]);
  const idempotencyKey=await createTelegramArchiveIdempotencyKey(document.file,{folderId:ownerFolder.id,documentType:'other',documentName:document.name,destination});
  const archived=await uploadTelegramArchivedFile(document.file,{folderId:ownerFolder.id,documentType:'other',documentName:document.name,tags:['ثبت_محموله_جدید','بارنامه_و_اسناد'],destination,idempotencyKey});
  setPendingDocuments(previous=>previous.map(item=>item.id===document.id?{...item,uploadStatus:'ready',uploadError:undefined,fileAssetId:archived.fileAssetId,externalMessageId:archived.externalMessageId,folderId:ownerFolder.id,uploadedBy:user.id}:item));
  setMessage('فایل در تلگرام آرشیو شد و برای مراحل بعدی محموله آماده است: '+document.name);
 }catch(error:any){
  setPendingDocuments(previous=>previous.map(item=>item.id===document.id?{...item,uploadStatus:'failed',uploadError:error?.message||'ارسال فایل به آرشیو تلگرام ناموفق بود.'}:item));
  setMessage('فایل همچنان در مرورگر انتخاب‌شده باقی مانده است؛ آرشیو تلگرام ناموفق بود: '+(error?.message||'خطای نامشخص'));
 }
};
const uploadStagedShipmentDocuments=(files:File[])=>{
 if(!files.length)return;
 if(!form.ownerId){setMessage('ابتدا صاحب کالا را انتخاب کن.');return;}
 let rejected=0;
 for(const file of files){
  const lowerName=file.name.toLowerCase();
  const mime=(file.type|| (lowerName.endsWith('.pdf')?'application/pdf':lowerName.endsWith('.png')?'image/png':(lowerName.endsWith('.jpg')||lowerName.endsWith('.jpeg'))?'image/jpeg':'')).toLowerCase();
  if(file.size<=0||file.size>FILE_ARCHIVE_MAX_BYTES||(mime!=='application/pdf'&&!['image/png','image/jpeg'].includes(mime))){rejected++;continue;}
  const id=crypto.randomUUID(),previewUrl=URL.createObjectURL(file);
  const pending:PendingShipmentDocument={id,name:file.name,mimeType:mime,sizeBytes:file.size,pageCount:1,file,previewUrl,uploadStatus:'uploading',clientId:form.ownerId,uploadedBy:profile?.id||''};
  // Make the PDF visible and selectable before any Telegram network request.
  setPendingDocuments(previous=>[...previous,pending]);
  setSelectedBillOfLadingId(previous=>previous||id);
  setMessage('فایل فوراً در مرورگر آماده و قابل انتخاب شد؛ آرشیو تلگرام در پس‌زمینه انجام می‌شود.');
  void archivePendingShipmentDocument(pending);
  if(mime==='application/pdf'){void (async()=>{try{const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const pageCount=pdf.numPages;await pdf.destroy();setPendingDocuments(previous=>previous.map(item=>item.id===id?{...item,pageCount}:item));}catch{/* Page count is informational; preserve the local file. */}})();}
 }
 if(rejected)setMessage(rejected+' فایل به‌دلیل فرمت پشتیبانی‌نشده یا حجم بیش از ۲۰ مگابایت اضافه نشد.');
};
const retryStagedShipmentDocument=(document:PendingShipmentDocument)=>{void archivePendingShipmentDocument(document);};
const previewPendingBillOfLading=(document:PendingShipmentDocument)=>{
 if(previewBillOfLadingId===document.id){setPreviewBillOfLadingId('');setPreviewBillOfLadingUrl('');return;}
 setPreviewBillOfLadingId(document.id);
 setPreviewBillOfLadingUrl(document.previewUrl);
};
const extractSelectedBillOfLading=async()=>{
   const document=pendingDocuments.find(item=>item.id===selectedBillOfLadingId);
   if(!document){setMessage('ابتدا فایل بارنامه را انتخاب کن.');return;}
   if(document.uploadStatus!=='ready'||!document.storagePath){setMessage('ابتدا صبر کن نسخه امن فایل در Storage ثبت شود؛ آرشیو تلگرام لازم نیست.');return;}
   if(document.clientId!==form.ownerId){setMessage('صاحب کالا پس از آپلود تغییر کرده است. صاحب کالای اولیه را دوباره انتخاب کن.');return;}
   setExtractingBillOfLadingId(document.id);
   setMessage('بارنامه از نسخه امن وب‌سایت تحلیل می‌شود؛ آرشیو تلگرام در این مرحله دخالتی ندارد...');
   try{
    const {data,error}=await invokeEdgeFunction('ai-assistant',{body:{
     query:'از تمام صفحات فایل بارنامه انتخاب‌شده اطلاعات واقعی موردنیاز برای ثبت محموله دریایی را استخراج کن. هیچ داده‌ای را حدس نزن. اگر فیلدی در سند وجود ندارد، مقدار آن را خالی برگردان. اعداد و شناسه‌ها را دقیقاً مطابق سند حفظ کن.',
     extract_fields:true,shipment_extract:true,document_storage_path:document.storagePath,
     document_mime_type:document.mimeType,document_size_bytes:document.sizeBytes,
     page_context:'ثبت محموله جدید - نسخه امن فایل در Storage'
    }});
    if(error)throw error;
    const raw=String(data?.answer||'').replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim();
    const parsed=JSON.parse(raw) as Record<string,unknown>;
    const val=(key:string)=>{const value=String(parsed[key]??'').trim();return value&&!/^x{2,}$/i.test(value)&&value!=='—'&&value!=='-'?value:''};
    const ownerName=val('ownerName');
    const owner=ownerName?clients.find(client=>same(client.name,ownerName)):null;
    setForm(previous=>({
     ...previous,
     shippingLine:val('shippingLine')||previous.shippingLine,
     billOfLading:val('billOfLading')||previous.billOfLading,
     year:val('billOfLadingYear')||previous.year,
     voyage:val('voyageNo')||previous.voyage,
     vessel:val('vesselName')||previous.vessel,
     imo:val('imo')||previous.imo,
     originPort:val('originPort')||previous.originPort,
     destinationPort:val('destinationPort')||previous.destinationPort,
     count:val('count')||previous.count,
     unit:val('unit')||previous.unit,
     net:val('net')||previous.net,
     gross:val('gross')||previous.gross,
    }));
    setPendingDocuments(previous=>previous.map(item=>item.id===document.id?{...item,extractedFields:Object.fromEntries(Object.entries(parsed).filter(([,v])=>typeof v==='string'&&String(v).trim()).map(([k,v])=>[k,String(v)]))}:item));
    const missingOwner=ownerName&&!owner;
    const ownerConflict=!!owner&&owner.id!==document.clientId;
    setMessage('استخراج انجام شد؛ اطلاعات قابل تشخیص از نسخه امن فایل به‌صورت پیش‌نویس در فرم قرار گرفت. '+(ownerConflict?'نام صاحب کالا روی بارنامه با صاحب کالای انتخاب‌شده متفاوت است؛ بررسی دستی لازم است. ':missingOwner?'نام صاحب کالا دقیقاً در فهرست مشتریان پیدا نشد؛ لطفاً دستی بررسی کن. ':'')+'قبل از ذخیره، تمام مقادیر را با خود بارنامه تطبیق بده.');
   }catch(error:any){
    setMessage(error?.message||'استخراج بارنامه ناموفق بود. نسخه امن فایل در وب‌سایت باقی مانده است؛ دوباره تلاش کن.');
   }finally{setExtractingBillOfLadingId('');}
  };
  const save=async()=>{
  if(!profile?.organization_id)return setMessage('سازمان کاربر مشخص نیست.');
  if(!form.ownerId)return setMessage('صاحب کالا را انتخاب کنید.');
  if(!clients.some(c=>c.id===form.ownerId))return setMessage('صاحب کالا برای این سازمان معتبر نیست.');
  if(pendingDocuments.some(document=>document.clientId!==form.ownerId))return setMessage('فایل‌های آپلودشده متعلق به صاحب کالای دیگری هستند؛ صاحب کالا را مطابق آرشیو انتخاب کن.');
   if(pendingDocuments.some(document=>document.uploadStatus!=='ready'||!document.storagePath))return setMessage('هنوز ذخیره امن بعضی فایل‌ها کامل نشده است؛ وضعیت فایل را بررسی کن.');
  if(!form.vessel.trim())return setMessage('نام کشتی را وارد یا انتخاب کنید.');
  if(!form.count.trim()||!form.net.trim()||!form.gross.trim())return setMessage('تعداد، وزن خالص و وزن ناخالص را تکمیل کنید.');
  setBusy(true);setMessage('در حال ذخیره شروع عملیات...');
  try{
   await ensureFreshSession();
   const vessel=await ensureVessel();const owner=clients.find(c=>c.id===form.ownerId);
   const display=buildShipmentDisplayName({cargo_count:num(form.count),cargo_count_unit:form.unit||'رول',client_name:owner?.name,vessel_name:vessel.name});
   const payload={organization_id:profile.organization_id,client_id:form.ownerId,vessel_id:vessel.id,transport_mode:'sea',shipping_line:form.shippingLine||null,bill_of_lading_no:form.billOfLading.trim()||null,bill_of_lading_year:form.billOfLading.trim()?num(form.year):null,voyage_no:form.voyage||null,origin_port:form.originPort||null,destination_port:form.destinationPort||null,cargo_count:num(form.count),cargo_count_unit:form.unit||'رول',net_weight_kg:num(form.net),gross_weight_kg:num(form.gross),current_status:form.status||'draft',current_location:form.location||null,transport_documents_status:form.transportDocumentsStatus,release_invoice_payment_status:form.releaseInvoicePaymentStatus,display_name:display};
   let shipmentId=selected;
   if(selected){const{error}=await supabase.from('shipments').update(payload).eq('id',selected).eq('organization_id',profile.organization_id);if(error)throw error}
   else{
    const{data,error}=await supabase.from('shipments').insert(payload).select('id').single();if(error)throw error;shipmentId=data.id;
    const{data:caseId,error:ce}=await supabase.rpc('create_case_workflow',{p_client_name:owner?.name||'',p_registration_order_no:null});if(ce)throw ce;
    const{error:le}=await supabase.rpc('link_shipment_to_case',{p_shipment_id:shipmentId,p_case_id:caseId});if(le)throw le;
    const{error:ca}=await supabase.from('cases').update({display_name:display}).eq('id',caseId);if(ca)throw ca;
   }
   const{error:te}=await supabase.rpc('set_shipment_tracking_status',{p_shipment_id:shipmentId,p_status:form.status||'draft',p_location:form.location||null,p_event_time:new Date().toISOString(),p_time_type:'actual',p_notes:'شروع عملیات / مدیریت محموله',p_source:'Customs OS'});if(te)throw te;
   const linkedDocumentIds:string[]=[];let documentLinkWarnings=0;
    const archiveQueue:string[]=[];
    const shipmentFolder=await getDefaultShipmentUploadFolder(shipmentId);
    for(const staged of pendingDocuments){
     try{
      const {data:doc,error:docError}=await supabase.from('shipment_documents').insert({
       organization_id:profile.organization_id,shipment_id:shipmentId,uploaded_by:staged.uploadedBy,
       document_name:staged.name,original_file_name:staged.name,storage_path:staged.storagePath!,
       storage_backend:'supabase',folder_id:shipmentFolder.id,mime_type:staged.mimeType,
       file_size_bytes:staged.sizeBytes,extraction_status:staged.extractedFields?'completed':'pending'
      }).select('id').single();
      if(docError||!doc)throw docError||new Error('ثبت مشخصات سند ناموفق بود.');
      if(staged.extractedFields){
       const rows=Object.entries(staged.extractedFields).filter(([,v])=>String(v||'').trim()).map(([key,value])=>({
        organization_id:profile.organization_id,shipment_id:shipmentId,document_id:doc.id,
        field_key:key,field_label:key,extracted_value:value,extraction_method:'ai-assistant',confidence:null
       }));
       if(rows.length){const {error:extractionError}=await supabase.from('shipment_document_extractions').upsert(rows,{onConflict:'shipment_id,document_id,field_key'});if(extractionError)throw extractionError;}
      }
      linkedDocumentIds.push(staged.id);
      archiveQueue.push(doc.id);
     }catch(documentError){documentLinkWarnings++;console.error('[ShipmentFirstPage] pending document link failed:',documentError);}
    }
    if(linkedDocumentIds.length){
     const linked=pendingDocuments.filter(item=>linkedDocumentIds.includes(item.id));
     setPendingDocuments(previous=>previous.filter(item=>!linkedDocumentIds.includes(item.id)));
     linked.forEach(item=>URL.revokeObjectURL(item.previewUrl));
     if(linked.some(item=>item.id===selectedBillOfLadingId)){setSelectedBillOfLadingId('');setPreviewBillOfLadingId('');setPreviewBillOfLadingUrl('');}
    }
    setSelected(shipmentId);
    setMessage(`محموله ذخیره شد؛ ${linkedDocumentIds.length} سند در نسخه امن وب‌سایت ثبت شد. آرشیو تلگرام در پس‌زمینه ادامه پیدا می‌کند.${documentLinkWarnings?' اتصال '+documentLinkWarnings+' سند نیازمند بررسی است.':''}`);
    archiveQueue.forEach(documentId=>{
     void archiveShipmentDocumentInBackground(documentId,['ثبت_محموله_جدید','بارنامه_و_اسناد'])
      .then(()=>loadDocs(shipmentId))
      .catch(error=>console.warn('[ShipmentFirstPage] background Telegram archive will be retried by the server:',error));
    });
    await load();
  }catch(e:any){setMessage(e?.message||'ذخیره محموله ناموفق بود')}finally{setBusy(false)}
 };
 const upload=async(files:FileList|null)=>{
   const selectedFiles=Array.from(files||[]);
   if(!selectedFiles.length||!selected)return setMessage('ابتدا محموله را ذخیره و انتخاب کنید.');
   setUploading(true);setMessage('');
   let completed=0;
   try{
    const folder=await getDefaultShipmentUploadFolder(selected);
    const {data:{user},error:userError}=await supabase.auth.getUser();
    if(userError||!user||!profile?.organization_id)throw new Error('نشست یا سازمان کاربر معتبر نیست.');
    for(const file of selectedFiles){
     const mime=(file.type||(/\\.pdf$/i.test(file.name)?'application/pdf':/\\.png$/i.test(file.name)?'image/png':/\\.jpe?g$/i.test(file.name)?'image/jpeg':'application/octet-stream')).toLowerCase();
     if(file.size<=0||file.size>50*1024*1024)throw new Error('حجم هر فایل باید بین ۱ بایت تا ۵۰ مگابایت باشد.');
     const safeName=file.name.replace(/[^\\w.\\-\\u0600-\\u06ff]+/g,'_').slice(0,160)||'document.bin';
     const storagePath=profile.organization_id+'/'+selected+'/'+crypto.randomUUID()+'-'+safeName;
     const {error:storageError}=await supabase.storage.from(BUCKET).upload(storagePath,file,{contentType:mime,cacheControl:'3600',upsert:false});
     if(storageError)throw new Error('آپلود امن فایل ناموفق بود: '+storageError.message);
     const {data:doc,error:docError}=await supabase.from('shipment_documents').insert({
      organization_id:profile.organization_id,shipment_id:selected,uploaded_by:user.id,
      document_name:file.name,original_file_name:file.name,storage_path:storagePath,
      storage_backend:'supabase',folder_id:folder.id,mime_type:mime,file_size_bytes:file.size,
      extraction_status:'not_requested'
     }).select('id').single();
     if(docError||!doc)throw docError||new Error('ثبت مشخصات سند ناموفق بود.');
     completed++;
     void archiveShipmentDocumentInBackground(doc.id,uploadTags)
      .then(()=>loadDocs(selected))
      .catch(error=>console.warn('[ShipmentFirstPage] background Telegram archive will be retried by the server:',error));
    }
    await loadDocs(selected);
    setMessage(`${completed} سند فوراً در نسخه امن وب‌سایت ذخیره شد؛ ارسال آرشیوی به تلگرام در پس‌زمینه ادامه پیدا می‌کند.`);
   }catch(error:any){
    await loadDocs(selected);
    setMessage(completed?`${completed} سند در وب‌سایت ذخیره شد؛ فایل بعدی ناموفق بود. ${error?.message||''}`:error?.message||'ذخیره فایل ناموفق بود.');
   }finally{setUploading(false)}
  };
  const retryArchiveDocument=async(d:Doc)=>{
  if(d.storage_backend==='telegram'&&d.file_asset_id)return;
  setUploading(true);setMessage('نسخه قدیمی فایل در حال انتقال به آرشیو تلگرام است...');
  try{
   if(!d.storage_path||d.storage_path.startsWith('telegram://'))throw new Error('مسیر نسخه اصلی فایل معتبر نیست.');
   const {data:blob,error:downloadError}=await supabase.storage.from(BUCKET).download(d.storage_path);
   if(downloadError||!blob)throw new Error(downloadError?.message||'دریافت نسخه قدیمی فایل ناموفق بود.');
   const file=new File([blob],d.original_file_name||d.document_name,{type:d.mime_type||blob.type||'application/octet-stream'});
   if(file.size>FILE_ARCHIVE_MAX_BYTES)throw new Error('این فایل از سقف ۲۰ مگابایت Bot API تلگرام بیشتر است؛ نسخه وب‌سایت حذف نمی‌شود.');
   const folder=await getDefaultShipmentUploadFolder(selected),destination=await getFileArchiveDestination();
   const idempotencyKey=await createTelegramArchiveIdempotencyKey(file,{folderId:folder.id,shipmentId:selected,documentType:'other',documentName:file.name,destination});
   const archived=await uploadTelegramArchivedFile(file,{folderId:folder.id,shipmentId:selected,documentType:'other',documentName:file.name,tags:uploadTags,destination,idempotencyKey});
   const {error:updateError}=await supabase.from('shipment_documents').update({storage_path:'telegram://'+archived.fileAssetId,storage_backend:'telegram',file_asset_id:archived.fileAssetId,folder_id:folder.id,telegram_message_id:archived.externalMessageId}).eq('id',d.id).eq('shipment_id',selected);
   if(updateError)throw new Error('فایل در تلگرام ذخیره شد، اما به‌روزرسانی پیوند سند در وب‌سایت ناموفق بود؛ نسخه قدیمی حذف نشده است. '+updateError.message);
   await supabase.storage.from(BUCKET).remove([d.storage_path]);
   await loadDocs(selected);setMessage('سند قدیمی به تلگرام منتقل و به محموله متصل شد.');
  }catch(error:any){await loadDocs(selected);setMessage(error?.message||'انتقال سند قدیمی به تلگرام انجام نشد. نسخه وب‌سایت حفظ شده است.');}
  finally{setUploading(false)}
 };
const download=async(d:Doc)=>{
 if(d.storage_backend==='telegram'&&d.file_asset_id){
  try{
   const blob=await downloadTelegramArchivedFile(d.file_asset_id);
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download=d.original_file_name||d.document_name||'document.bin';
   document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e:any){setMessage(e?.message||'دریافت فایل تلگرام ناموفق بود')}
  return;
 }
 const{data,error}=await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path,600);
 if(error)return setMessage(error.message);
 window.open(data.signedUrl,'_blank','noopener,noreferrer');
};
const passShip=async(passed:boolean)=>{if(!selected)return;setBusy(true);setMessage('');try{const{error:e}=await supabase.rpc('set_shipment_ship_pass',{p_shipment_id:selected,p_passed:passed});if(e)throw e;setMessage(passed?'پاس کشتی ثبت شد.':'پاس کشتی لغو شد.');await load()}catch(e:any){setMessage(e?.message||'ثبت پاس کشتی انجام نشد')}finally{setBusy(false)}};
 const selectedRow=rows.find(r=>r.id===selected);
 const vessel=selectedRow?vessels.find(v=>v.id===selectedRow.vessel_id):vessels.find(v=>same(v.name,form.vessel));
 const openPre=selected?'/operations?tab=pre-declaration&shipmentId='+encodeURIComponent(selected):'/operations';
 const vesselSearch=selected?'/vessel-search?name='+encodeURIComponent(vessel?.name||form.vessel)+'&imo='+encodeURIComponent(vessel?.imo_number||form.imo)+'&bl='+encodeURIComponent(form.billOfLading):'#';
 return <main dir="rtl" className="min-h-screen p-4 md:p-6" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-[1500px] mx-auto space-y-4">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs app-muted">مرحله ۱</div><h1 className="text-2xl font-black">شروع عملیات</h1><p className="text-xs app-muted mt-1">محموله، صاحب کالا، کشتی، وضعیت کشتی و اسناد محموله در یک مرحله.</p><div className="mt-2"><FormDraftIndicator status={formDraft.status} onSave={formDraft.saveDraftNow}/></div></div><div className="flex gap-2"><button onClick={()=>void load()} className="icon-btn" title="بروزرسانی"><RefreshCw size={16}/></button><button onClick={reset} className="px-4 py-2 rounded-xl border app-border"><Plus size={16} className="inline ml-1"/>محموله جدید</button></div></header>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="grid lg:grid-cols-4 gap-3">
   <label className="text-xs app-muted lg:col-span-2">صاحب کالا<select value={form.ownerId} onChange={e=>{const next=e.target.value;set('ownerId',next);if(pendingDocuments.some(document=>document.clientId!==next))setMessage('صاحب کالا تغییر کرد؛ فایل‌های قبلی در آرشیو صاحب کالای قبلی می‌مانند.')}} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="">انتخاب صاحب کالا</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.national_id?' — '+c.national_id:''}</option>)}</select></label>
  {!selected&&profile?.role!=='client'&&<div className="lg:col-span-4"><section className="rounded-2xl border-2 border-dashed app-border bg-[var(--surface)] p-4 sm:p-5">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><div className="flex items-center gap-2 font-black"><FileText size={18}/> بارگذاری سند برای ثبت محموله</div><p className="mt-1 text-xs app-muted">فایل مثل PDF Studio فوراً در مرورگر انتخاب و پیش‌نمایش می‌شود؛ اصل سند مستقیم در تلگرام آرشیو می‌شود و فضای Storage سوپابیس مصرف نمی‌کند.</p></div>
    <div className="flex items-center gap-2">
     <button type="button" onClick={()=>shipmentFileInput.current?.click()} disabled={!form.ownerId} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"><Upload size={16}/> انتخاب فایل بارنامه</button>
     <input ref={shipmentFileInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png" multiple className="hidden" disabled={!form.ownerId} onChange={e=>{const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';uploadStagedShipmentDocuments(files);}}/>
    </div>
   </div>
   {pendingDocuments.length>0&&<div className="mt-4 space-y-2">
    {pendingDocuments.map(document=><div key={document.id} className={`rounded-xl border p-3 ${selectedBillOfLadingId===document.id?'border-[var(--primary)] bg-[var(--surface-2)]':'app-border'}`}>
     <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
       {selectedBillOfLadingId===document.id?<CheckCircle2 className="text-[var(--primary)]" size={18}/>:<FileText size={18} className="app-muted"/>}
       <div className="min-w-0"><b className="block truncate text-sm">{document.name}</b><span className="text-[11px] app-muted">{(document.sizeBytes/1024/1024).toFixed(2)} MB · {document.pageCount} صفحه · {document.uploadStatus==='ready'?'آرشیو شد در تلگرام':document.uploadStatus==='failed'?'آرشیو ناموفق':'در حال ارسال پس‌زمینه به تلگرام'}</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
       <button type="button" onClick={()=>setSelectedBillOfLadingId(document.id)} className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedBillOfLadingId===document.id?'bg-[var(--primary)] text-white':'border app-border'}`}>{selectedBillOfLadingId===document.id?'بارنامه انتخاب‌شده':'انتخاب به‌عنوان بارنامه'}</button>
       <button type="button" onClick={()=>void previewPendingBillOfLading(document)} className="rounded-lg border app-border px-3 py-2 text-xs"><Eye size={14} className="inline ml-1"/>نمایش</button>
      </div>
     </div>
     {document.uploadStatus==='failed'&&<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-600"><span>{document.uploadError||'ذخیره فایل ناموفق بود.'}</span><button type="button" onClick={()=>retryStagedShipmentDocument(document)} className="rounded-lg border border-rose-500/30 px-3 py-1.5 font-bold">تلاش دوباره برای آرشیو تلگرام</button></div>}{document.uploadStatus==='ready'&&<div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">فایل در تلگرام ذخیره شده است؛ پس از ثبت محموله فقط پیوند آن به این محموله اضافه می‌شود.</div>}{document.extractedFields&&<div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">اطلاعات این سند با AI استخراج شده و برای اتصال به محموله آماده است.</div>}
     {previewBillOfLadingId===document.id&&(previewBillOfLadingUrl?<iframe title={document.name} src={previewBillOfLadingUrl} className="mt-3 h-[420px] w-full rounded-xl border app-border bg-white"/>:<div className="mt-3 rounded-xl bg-[var(--surface-2)] p-4 text-xs app-muted">در حال آماده‌سازی پیش‌نمایش مرورگر…</div>)}
    </div>)}
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface-2)] p-3">
     <div className="text-xs app-muted">فایل بلافاصله در مرورگر قابل انتخاب و پیش‌نمایش است؛ نسخه اصلی بدون مصرف فضای Storage سوپابیس در پس‌زمینه به تلگرام می‌رود.</div>
     <button type="button" disabled={!selectedBillOfLadingId||!!extractingBillOfLadingId||((pendingDocuments.find(item=>item.id===selectedBillOfLadingId)?.sizeBytes||0)>4*1024*1024&&pendingDocuments.find(item=>item.id===selectedBillOfLadingId)?.uploadStatus!=='ready')} onClick={()=>void extractSelectedBillOfLading()} className="rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white disabled:opacity-50">
      {extractingBillOfLadingId?<><Loader2 className="inline ml-1 animate-spin" size={16}/>در حال تحلیل سند...</>:<><Sparkles className="inline ml-1" size={16}/>استخراج اطلاعات محموله با AI</>}
     </button>
    </div>
   </div>}
   {pendingDocuments.length===0&&<div className="mt-3 text-xs app-muted">هنوز فایلی انتخاب نشده است. این مرحله اختیاری است و می‌توانی اطلاعات را دستی هم وارد کنی.</div>}
  </section></div>}
   <label className="text-xs app-muted">کشتیرانی<select value={form.shippingLine} onChange={e=>chooseLine(e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="">انتخاب کشتیرانی</option>{lines.map(l=><option key={l.id} value={l.name}>{l.name_fa||l.name}</option>)}</select></label><label className="text-xs app-muted">B/L<input value={form.billOfLading} onChange={e=>set('billOfLading',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">سال B/L<input value={form.year} onChange={e=>set('year',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">Voyage<input value={form.voyage} onChange={e=>set('voyage',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted lg:col-span-2">کشتی<input list="operations-vessels" value={form.vessel} onChange={e=>chooseVessel(e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/><datalist id="operations-vessels">{vessels.map(v=><option key={v.id} value={v.name}/>)}</datalist></label><label className="text-xs app-muted">IMO<input value={form.imo} onChange={e=>set('imo',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">پرچم ISO-2<input value={form.flag} onChange={e=>set('flag',e.target.value.toUpperCase())} maxLength={2} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">بندر مبدأ<input value={form.originPort} onChange={e=>set('originPort',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">بندر مقصد<input value={form.destinationPort} onChange={e=>set('destinationPort',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">تعداد<input value={form.count} onChange={e=>set('count',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">واحد<input value={form.unit} onChange={e=>set('unit',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">وزن خالص kg<input value={form.net} onChange={e=>set('net',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label><label className="text-xs app-muted">وزن ناخالص kg<input value={form.gross} onChange={e=>set('gross',e.target.value)} dir="ltr" className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>
   <label className="text-xs app-muted">وضعیت کشتی<select value={form.status} onChange={e=>set('status',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3">{statuses.map(s=><option key={s[0]} value={s[0]}>{s[1]}</option>)}</select></label><label className="text-xs app-muted">موقعیت فعلی کشتی<input value={form.location} onChange={e=>set('location',e.target.value)} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"/></label>{form.status==='completed'&&<><label className="text-xs app-muted">اسناد حمل و قبض انبار<select value={form.transportDocumentsStatus} onChange={e=>set('transportDocumentsStatus',e.target.value as 'not_ready'|'ready')} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="not_ready">آماده نیست</option><option value="ready">آماده است</option></select></label><label className="text-xs app-muted">صورتحساب ترخیصیه<select value={form.releaseInvoicePaymentStatus} onChange={e=>set('releaseInvoicePaymentStatus',e.target.value as 'unpaid'|'paid')} className="w-full mt-1 rounded-xl border app-border bg-[var(--surface-2)] p-3"><option value="unpaid">پرداخت نشده</option><option value="paid">پرداخت شده</option></select></label></>}
   <div className="lg:col-span-4 flex flex-wrap gap-2 pt-2"><button disabled={busy} onClick={()=>void save()} className="px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-black"><Save size={16} className="inline ml-2"/>{busy?'در حال ذخیره...':'ذخیره شروع عملیات'}</button>{selected&&<Link to={openPre} className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold">مرحله ۲ · ورود اطلاعات قبض انبار</Link>}</div>
  </div></section>
   {selected&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
     <div>
      <div className="font-black">اسناد محموله</div>
      <div className="text-xs app-muted mt-1">اسناد مستقیماً به همین Shipment متصل می‌شوند.</div>
     </div>
     <div className="flex items-center gap-2">
      <AddReminderButton entityType="shipments" entityId={selected} defaultTitle={`پیگیری محموله ${selectedRow?.display_name||selectedRow?.bill_of_lading_no||''}`}/>
      <Link to={'/file-manager?shipmentId='+selected} className="px-4 py-2.5 rounded-xl border app-border font-bold text-sm">بازکردن پوشه فایل‌منیجر</Link>
      <input value={uploadTagInput} onChange={e=>setUploadTagInput(e.target.value)} disabled={uploading} placeholder="برچسب سندها (با ویرگول)" className="max-w-48 px-3 py-2 rounded-xl border app-border bg-[var(--surface)] text-xs"/>
      <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold">
       <Upload size={16} className="inline ml-1"/>{uploading?'در حال ذخیره امن...':'انتخاب و ذخیره فایل'}
       <input type="file" multiple className="hidden" disabled={uploading} onChange={e=>{void upload(e.target.files);e.currentTarget.value=''}}/>
      </label>
     </div>
    </div>
    {docs.length===0?<div className="py-8 text-center app-muted">هنوز سندی برای این محموله ثبت نشده است.</div>:<div className="grid md:grid-cols-2 gap-2 mt-4">{docs.map(d=><div key={d.id} className="rounded-xl border app-border p-3 flex items-center justify-between gap-3"><div className="min-w-0"><b className="block truncate text-sm">{d.document_name}</b><span className="text-[10px] app-muted">{Math.round(d.file_size_bytes/1024)} KB · {d.storage_backend==='telegram'&&d.file_asset_id?'آرشیو تلگرام آماده است':'نسخه امن وب‌سایت · در انتظار آرشیو تلگرام'}</span></div><div className="flex shrink-0 items-center gap-2">{(d.storage_backend!=='telegram'||!d.file_asset_id)&&<button type="button" onClick={()=>void retryArchiveDocument(d)} className="rounded-lg border app-border px-2.5 py-2 text-[11px] font-bold">ارسال به تلگرام</button>}<button onClick={()=>void download(d)} className="icon-btn" title="باز کردن"><Download size={16}/></button></div></div>)}</div>}
   </section>}
  {message&&<div className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{message}</div>}
  {selected&&vessel&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Ship size={19}/><b>بررسی وضعیت کشتی</b></div><Link to={vesselSearch} className="px-4 py-2 rounded-xl border app-border font-bold text-sm"><ExternalLink size={15} className="inline ml-1"/>جستجوی اطلاعات کشتی</Link></div><div className="grid md:grid-cols-6 gap-3 mt-3 text-sm"><div><span className="app-muted text-xs">کشتی</span><b className="block mt-1">{vessel.name}</b></div><div><span className="app-muted text-xs">IMO</span><b className="block mt-1" dir="ltr">{vessel.imo_number||'—'}</b></div><div><span className="app-muted text-xs">پرچم</span><b className="block mt-1">{vessel.flag_code||'—'}</b></div><div><span className="app-muted text-xs">وضعیت</span><b className="block mt-1">{statuses.find(x=>x[0]===selectedRow?.current_status)?.[1]||selectedRow?.current_status||'—'}</b></div><div><span className="app-muted text-xs">موقعیت</span><b className="block mt-1">{selectedRow?.current_location||'—'}</b></div><div><span className="app-muted text-xs">B/L</span><b className="block mt-1" dir="ltr">{selectedRow?.bill_of_lading_no||form.billOfLading||'—'}</b></div>{selectedRow?.current_status==='completed'&&<><div><span className="app-muted text-xs">اسناد حمل و قبض انبار</span><b className="block mt-1">{selectedRow.transport_documents_status==='ready'?'آماده است':'آماده نیست'}</b></div><div><span className="app-muted text-xs">صورتحساب ترخیصیه</span><b className="block mt-1">{selectedRow.release_invoice_payment_status==='paid'?'پرداخت شده':'پرداخت نشده'}</b></div></>}</div></section>}
  {selected&&selectedRow&&<section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck size={19}/><div><b>پاس کشتی</b><div className="text-xs app-muted mt-1">{selectedRow.ship_passed?'پاس کشتی ثبت شده است.':'پس از تحویل کامل اسناد کشتیرانی، پاس کشتی را ثبت کنید.'}</div></div></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${selectedRow.ship_passed?'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{selectedRow.ship_passed?'پاس شده':'پاس نشده'}</span><button type="button" disabled={busy||(!selectedRow.ship_passed&&selectedRow.transport_documents_status!=='ready')} onClick={()=>void passShip(!selectedRow.ship_passed)} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-sm font-bold disabled:opacity-40">{selectedRow.ship_passed?'لغو پاس کشتی':'ثبت پاس کشتی'}</button></div></div>{!selectedRow.ship_passed&&selectedRow.transport_documents_status!=='ready'&&<div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">برای ثبت پاس کشتی ابتدا اسناد حمل و کشتیرانی را تحویل گرفته و وضعیت «آماده است» را ثبت کنید.</div>}</section>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex items-center justify-between mb-3"><b>محموله‌های ثبت‌شده</b><span className="text-xs app-muted">{rows.length} محموله</span></div>{rows.length===0?<div className="py-10 text-center app-muted">هنوز محموله‌ای ثبت نشده است.</div>:<div className="space-y-2">{rows.map(r=><button key={r.id} onClick={()=>edit(r)} className={'w-full text-right rounded-xl border p-3 '+(selected===r.id?'border-[var(--primary)] bg-[var(--surface-2)]':'app-border bg-[var(--surface)]')}><div className="flex justify-between gap-3"><div><b>{r.display_name||'محموله'}</b><div className="text-xs app-muted mt-1">{r.shipping_line||'—'} · B/L {r.bill_of_lading_no||'—'} · گمرک: {customsOffices.find(o=>o.id===r.customs_office_id)?.name||'تعیین نشده'}</div></div><span className="text-xs app-muted">{statuses.find(x=>x[0]===r.current_status)?.[1]||r.current_status}</span></div></button>)}</div>}</section>
 {selectedRow&&<ShipmentStageCosts stage="STAGE_1_SHIPMENT" shipmentId={selected} shipment={selectedRow}/>} 
</div></main>
};
