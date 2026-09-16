import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,Download,Eye,FileText,FileSpreadsheet,Image as ImageIcon,Loader2,Plus,RefreshCw,Search,Upload,X} from 'lucide-react';
import {supabase} from '../lib/supabase';

type DocType='PROFORMA_INVOICE'|'COMMERCIAL_INVOICE'|'PACKING_LIST'|'BILL_OF_LADING'|'DELIVERY_ORDER'|'EPL_DELIVERY_ORDER'|'WAREHOUSE_RECEIPT'|'IMPORT_LICENSE'|'SATA_PAYMENT_DOC'|'INSURANCE_POLICY'|'CERTIFICATE_OF_ORIGIN'|'INSPECTION_CERTIFICATE'|'TECHNICAL_SPEC_CATALOG'|'POWER_OF_ATTORNEY'|'CUSTOMS_DECLARATION_PRINT';
type Shipment={id:string;case_id:string|null;bill_of_lading_no:string|null;net_weight_kg:number|null;gross_weight_kg:number|null;vessel_id:string|null;vessel_name:string;quantity:number|null;cargo_owner:string};
type Doc={id:string;shipment_id:string|null;document_type:DocType|null;original_name:string;display_name:string|null;storage_path:string|null;mime_type:string|null;size_bytes:number|null;status:string;tags:string[];document_number:string|null;issue_date_shamsi:string|null;gross_weight_kg:number|null;net_weight_kg:number|null;quantity:number|null;packaging_type:string|null;currency:string|null;invoice_amount:number|null;exporter_name:string|null;importer_name:string|null};

const TYPES:{v:DocType;l:string}[]=[
 {v:'PROFORMA_INVOICE',l:'پروفرما اینویس'},{v:'COMMERCIAL_INVOICE',l:'کامرشال اینویس / سیاهه خرید'},{v:'PACKING_LIST',l:'پکینگ لیست / عدل‌بندی'},{v:'BILL_OF_LADING',l:'بارنامه / B/L'},{v:'DELIVERY_ORDER',l:'ترخیصیه کشتیرانی'},{v:'EPL_DELIVERY_ORDER',l:'ترخیصیه الکترونیک'},{v:'WAREHOUSE_RECEIPT',l:'قبض انبار'},{v:'IMPORT_LICENSE',l:'ثبت سفارش'},{v:'SATA_PAYMENT_DOC',l:'کد ساتا / اسناد بانکی'},{v:'INSURANCE_POLICY',l:'بیمه‌نامه'},{v:'CERTIFICATE_OF_ORIGIN',l:'گواهی مبدأ'},{v:'INSPECTION_CERTIFICATE',l:'گواهی بازرسی'},{v:'TECHNICAL_SPEC_CATALOG',l:'آنالیز / کاتالوگ فنی'},{v:'POWER_OF_ATTORNEY',l:'وکالت‌نامه / مدارک هویتی'},{v:'CUSTOMS_DECLARATION_PRINT',l:'پرینت اظهارنامه / کوتاژ'}
];
const required:DocType[]=['PROFORMA_INVOICE','COMMERCIAL_INVOICE','PACKING_LIST','BILL_OF_LADING','DELIVERY_ORDER','WAREHOUSE_RECEIPT','IMPORT_LICENSE','CERTIFICATE_OF_ORIGIN'];
const TAGS=['نیاز به اصلاح','تأیید گمرک','مغایرت‌دار'];
const label=(t:DocType|null)=>TYPES.find(x=>x.v===t)?.l||'دسته‌بندی نشده';
const kg=(v:unknown)=>{const n=Number(String(v??'').replace(/[٬,]/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?Math.round(n):null};
const norm=(v:string)=>v.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
const inferType=(name:string):DocType|null=>{const n=norm(name);if(/proforma|pro forma|پروفرما|پروفورما|proforma invoice/.test(n))return'PROFORMA_INVOICE';if(/commercial invoice|commercial|سیاهه|کامرشال|invoice/.test(n))return'COMMERCIAL_INVOICE';if(/packing|pack list|عدل|بسته بندی|پکینگ/.test(n))return'PACKING_LIST';if(/bill of lading|b l|bl |بارنامه/.test(n))return'BILL_OF_LADING';if(/delivery order|do |ترخیصیه/.test(n))return'DELIVERY_ORDER';if(/warehouse|قبض انبار/.test(n))return'WAREHOUSE_RECEIPT';if(/import license|order registration|ثبت سفارش/.test(n))return'IMPORT_LICENSE';if(/origin|certificate of origin|گواهی مبدأ|گواهی مبدا/.test(n))return'CERTIFICATE_OF_ORIGIN';if(/inspection|sgs|بازرسی/.test(n))return'INSPECTION_CERTIFICATE';if(/insurance|بیمه/.test(n))return'INSURANCE_POLICY';if(/sata|ساتا|bank|بانک/.test(n))return'SATA_PAYMENT_DOC';if(/catalog|technical|آنالیز|کاتالوگ/.test(n))return'TECHNICAL_SPEC_CATALOG';if(/power|attorney|وکالت/.test(n))return'POWER_OF_ATTORNEY';if(/declaration|اظهارنامه|کوتاژ/.test(n))return'CUSTOMS_DECLARATION_PRINT';return null};
const fileExt=(d:Doc)=>{const n=d.original_name||d.display_name||'';const m=n.split('.').pop()?.toUpperCase()||'';return m.slice(0,5)};
const isImage=(d:Doc)=>/^image\//i.test(d.mime_type||'')||/\.(jpe?g|png|webp|gif)$/i.test(d.original_name||'');
const isSheet=(d:Doc)=>/\.(xls|xlsx|csv)$/i.test(d.original_name||'')||/spreadsheet|excel/i.test(d.mime_type||'');

export const CustomsDocumentManagerPage:React.FC=()=>{
 const[shipments,setShipments]=useState<Shipment[]>([]),[shipmentId,setShipmentId]=useState(''),[docs,setDocs]=useState<Doc[]>([]),[query,setQuery]=useState(''),[type,setType]=useState<DocType|''>(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Doc|null>(null),[preview,setPreview]=useState(''),[drag,setDrag]=useState(false),[mismatches,setMismatches]=useState<any[]>([]),[view,setView]=useState<'grid'|'list'>('grid'),[imageUrls,setImageUrls]=useState<Record<string,string>>({});
 const inputRef=useRef<HTMLInputElement>(null);

 const loadShipments=async()=>{setBusy(true);setError('');try{
   const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('کاربر وارد نشده است.');
   const{data:p,error:pe}=await supabase.from('profiles').select('organization_id').eq('id',user.id).single();if(pe||!p?.organization_id)throw pe||new Error('سازمان کاربر مشخص نیست.');
   const{data:docRows,error:de}=await supabase.from('customs_documents').select('shipment_id,case_id,quantity,importer_name').eq('organization_id',p.organization_id).not('shipment_id','is',null);
   if(de)throw de;
   const ids=[...new Set((docRows||[]).map((r:any)=>r.shipment_id).filter(Boolean))];
   if(!ids.length){setShipments([]);setShipmentId('');return}
   const[{data:s,error:se},{data:v,error:ve}]=await Promise.all([
     supabase.from('shipments').select('id,case_id,bill_of_lading_no,net_weight_kg,gross_weight_kg,vessel_id').eq('organization_id',p.organization_id).in('id',ids).order('created_at',{ascending:false}),
     supabase.from('vessels').select('id,name').eq('organization_id',p.organization_id)
   ]);
   if(se)throw se;if(ve)throw ve;
   const names=new Map((v||[]).map((x:any)=>[x.id,x.name]));
   const meta=new Map<string,{quantity:number;owner:string}>();
   for(const row of docRows||[]){const id=String(row.shipment_id);const q=Number(row.quantity);const prev=meta.get(id)||{quantity:0,owner:''};if(Number.isFinite(q)&&q>0)prev.quantity+=q;if(!prev.owner&&String(row.importer_name||'').trim())prev.owner=String(row.importer_name).trim();meta.set(id,prev)}
   const rows=(s||[]).map((x:any)=>{const m=meta.get(x.id);return{...x,vessel_name:names.get(x.vessel_id)||'',quantity:m?.quantity||null,cargo_owner:m?.owner||''}}) as Shipment[];
   setShipments(rows);setShipmentId(prev=>rows.some(x=>x.id===prev)?prev:(rows[0]?.id||''));
 }catch(e:any){setError(e?.message||'دریافت محموله‌ها ناموفق بود')}finally{setBusy(false)}};
