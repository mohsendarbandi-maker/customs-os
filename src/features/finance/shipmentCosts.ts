import { toGregorian, toJalali } from '../../lib/jalali';

export const SHIPMENT_COST_STAGES=[
  'STAGE_1_SHIPMENT','STAGE_2_PRE_DECLARATION','STAGE_3_DECLARATION',
  'STAGE_4_CUSTOMS_OPERATIONS','STAGE_5_EXIT_PREPARATION','STAGE_6_EXIT',
] as const;
export type ShipmentCostStage=typeof SHIPMENT_COST_STAGES[number];
export const LEGACY_SHIPMENT_COST_STAGES=['PRE_DECLARATION','DURING_DECLARATION','POST_DECLARATION','MISC'] as const;
export type ShipmentCostWorkflowStatus='DRAFT'|'SUBMITTED'|'APPROVED'|'REJECTED';
export type ShipmentCostCurrency='IRR'|'USD'|'EUR';
export type ReceiptFile={id:string;path:string;original_name:string;mime_type:'application/pdf'|'image/jpeg'|'image/png';size_bytes:number;uploaded_by:string;uploaded_at:string};
export type ShipmentCost={id:string;organization_id:string;shipment_id:string;case_id:string|null;client_id:string;category_id:string;cost_type:string;cost_category:string;description:string;amount:number|string;currency:ShipmentCostCurrency|string;exchange_rate:number|string;amount_irr:number|string;vat_amount:number|string;payment_date:string;receipt_files:ReceiptFile[];receipt_file_url:string|null;created_by:string;uploaded_by:string;workflow_status:ShipmentCostWorkflowStatus;submitted_by:string|null;submitted_at:string|null;approved_by:string|null;approved_at:string|null;rejection_reason:string|null;deleted_by:string|null;deleted_at:string|null;deleted_reason:string|null;created_at:string;updated_at:string;paid_by:'our_company'|'client_direct'};
export type ShipmentCostCategory={id:string;name_fa:string;code:string;is_active:boolean};
export const STAGE_LABELS:Record<string,string>={
  STAGE_1_SHIPMENT:'مرحله ۱ · شروع عملیات',STAGE_2_PRE_DECLARATION:'مرحله ۲ · قبض انبار و پیش‌اظهار',
  STAGE_3_DECLARATION:'مرحله ۳ · ثبت اظهار',STAGE_4_CUSTOMS_OPERATIONS:'مرحله ۴ · عملیات گمرکی',
  STAGE_5_EXIT_PREPARATION:'مرحله ۵ · آماده‌سازی خروج',STAGE_6_EXIT:'مرحله ۶ · درب خروج',
  PRE_DECLARATION:'قبل از اظهار (قدیمی)',DURING_DECLARATION:'حین اظهار (قدیمی)',
  POST_DECLARATION:'بعد از اظهار / ترخیص (قدیمی)',MISC:'متفرقه (قدیمی)',
};
export const WORKFLOW_LABELS:Record<ShipmentCostWorkflowStatus,string>={DRAFT:'پیش‌نویس',SUBMITTED:'ارسال‌شده',APPROVED:'تأییدشده',REJECTED:'ردشده'};
export const RECEIPT_MIME:Record<string,ReceiptFile['mime_type']>={'application/pdf':'application/pdf','image/jpeg':'image/jpeg','image/png':'image/png'};
export const MAX_RECEIPT_BYTES=10*1024*1024;

export const normalizeDigits=(value:string)=>value.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٬,]/g,'');
export const parseAmount=(value:string)=>{const n=Number(normalizeDigits(value).trim());return Number.isFinite(n)?n:0};
export const formatIrr=(value:number|string)=>new Intl.NumberFormat('fa-IR').format(Number(value||0));
export const isoToJalaliInput=(iso:string)=>{if(!iso)return'';const j=toJalali(new Date(iso+'T12:00:00Z'));return [j.year,j.month,j.day].map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('/')};
export const jalaliInputToIso=(value:string)=>{const m=normalizeDigits(value).replace(/-/g,'/').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);if(!m)return'';const g=toGregorian(Number(m[1]),Number(m[2]),Number(m[3]));return [g.gy,String(g.gm).padStart(2,'0'),String(g.gd).padStart(2,'0')].join('-')};
export const todayIso=()=>{const j=toJalali(new Date());const g=toGregorian(j.year,j.month,j.day);return[g.gy,String(g.gm).padStart(2,'0'),String(g.gd).padStart(2,'0')].join('-')};
export const extensionFor=(file:File)=>{const ext=file.name.split('.').pop()?.toLowerCase()||'';return ext==='jpeg'?'jpg':ext};
const readBytes=async(file:File,count:number)=>new Uint8Array(await file.slice(0,count).arrayBuffer());
const hex=(bytes:Uint8Array)=>Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
export const validateReceiptFile=async(file:File)=>{const mime=RECEIPT_MIME[file.type];const ext=extensionFor(file);if(!mime||!['pdf','jpg','png'].includes(ext))return{ok:false as const,error:'فقط فایل PDF، JPG و PNG مجاز است.'};if(file.size<=0||file.size>MAX_RECEIPT_BYTES)return{ok:false as const,error:'حجم هر فیش باید بیشتر از صفر و حداکثر ۱۰ مگابایت باشد.'};const signature=hex(await readBytes(file,8));const validMagic=(mime==='application/pdf'&&signature.startsWith('25504446'))||(mime==='image/jpeg'&&signature.startsWith('ffd8ff'))||(mime==='image/png'&&signature.startsWith('89504e470d0a1a0a'));if(!validMagic)return{ok:false as const,error:'محتوای فایل با نوع فایل اعلام‌شده سازگار نیست.'};return{ok:true as const,mime,extension:ext as 'pdf'|'jpg'|'png'}};
export const createReceiptPath=(organizationId:string,userId:string,extension:string)=>organizationId+'/'+userId+'/'+crypto.randomUUID()+'.'+extension;
export const toReceiptMetadata=(file:File,path:string,userId:string):ReceiptFile=>({id:crypto.randomUUID(),path,original_name:file.name,mime_type:RECEIPT_MIME[file.type] as ReceiptFile['mime_type'],size_bytes:file.size,uploaded_by:userId,uploaded_at:new Date().toISOString()});
export const displayReceiptName=(receipt:ReceiptFile)=>receipt.original_name||'فیش پرداختی';
export const sumApprovedByStage=(costs:ShipmentCost[])=>SHIPMENT_COST_STAGES.reduce((acc,stage)=>{acc[stage]=costs.filter(c=>c.workflow_status==='APPROVED'&&c.cost_type===stage&&!c.deleted_at).reduce((sum,c)=>sum+Number(c.amount_irr||0)+Number(c.vat_amount||0),0);return acc;},{} as Record<ShipmentCostStage,number>);
export const validateCostDraft=(draft:{clientId:string;stage:string;categoryId:string;categoryName:string;description:string;amount:string;currency:string;exchangeRate:string;paymentDate:string;paidBy:string})=>{if(!draft.clientId)return'صاحب کالا مشخص نیست.';if(!SHIPMENT_COST_STAGES.includes(draft.stage as ShipmentCostStage))return'مرحله هزینه معتبر نیست.';if(!draft.categoryId)return'دسته هزینه را انتخاب کنید.';if(!draft.categoryName.trim())return'عنوان دسته هزینه الزامی است.';if(!draft.description.trim())return'شرح کامل هزینه الزامی است.';if(parseAmount(draft.amount)<=0)return'مبلغ باید بیشتر از صفر باشد.';if(!['IRR','USD','EUR'].includes(draft.currency))return'ارز هزینه معتبر نیست.';if(parseAmount(draft.exchangeRate)<=0)return'نرخ تبدیل باید بیشتر از صفر باشد.';if(!draft.paymentDate)return'تاریخ پرداخت الزامی است.';if(!['our_company','client_direct'].includes(draft.paidBy))return'پرداخت‌کننده معتبر نیست.';return null};
