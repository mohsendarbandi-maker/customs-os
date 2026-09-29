import React,{useEffect,useMemo,useState}from'react';
import{AlertTriangle,Archive,ArrowLeft,Bot,Check,ChevronDown,Database,FileCog,History,Lock,RefreshCw,Save,Search,Settings2,ShieldCheck,Ship,Trash2,UserCog,Wallet,X}from'lucide-react';
import{useAuth}from'../context/AuthContext';
import{supabase}from'../lib/supabase';

type ResourceKey='profiles'|'clients'|'cases'|'registration_orders'|'shipments'|'containers'|'shipment_customs_data'|'shipping_lines'|'vessels'|'contacts'|'shipment_documents'|'customs_documents'|'shipment_document_extractions'|'document_extraction_fields'|'documents'|'document_rules'|'permit_rules'|'permits'|'customs_offices'|'hs_codes'|'settings_reference_data'|'case_checklist_items'|'declaration_checklist_items'|'declaration_exit_checklist_items'|'cost_categories'|'finance_settings'|'costs'|'payments'|'payment_requests'|'payment_request_lines'|'invoices'|'invoice_lines'|'invoice_shipments'|'payment_allocations'|'vouchers'|'voucher_lines'|'declarations'|'exit'|'financial_permissions'|'petty_cash_ledger'|'voucher_line_profit'|'ai_gateway'|'templates'|'org'|'org_settings'|'user_settings'|'knowledge_sources'|'knowledge_chunks'|'ai_knowledge_documents'|'ai_knowledge_chunks';
type LogKey='audit'|'case_history'|'financial_history'|'ai_commands'|'ai_interactions'|'ai_action_logs'|'ai_risk_findings'|'file_security_events'|'shipment_tracking'|'discrepancy_logs';

const roleLabels:Record<string,string>={owner:'Owner',admin:'Admin',broker:'Broker',accountant:'Accountant',warehouse:'Warehouse',client:'Client'};
const resourceLabels:Record<ResourceKey,string>={
profiles:'کاربران و نقش‌ها',clients:'صاحبان کالا',cases:'پرونده‌ها',registration_orders:'Registration Order',shipments:'محموله‌ها',containers:'کانتینرها',shipment_customs_data:'اطلاعات گمرکی محموله',
shipping_lines:'کشتیرانی‌ها',vessels:'کشتی‌ها',contacts:'مسئولان کشتیرانی',shipment_documents:'اسناد محموله',customs_documents:'اسناد گمرکی',shipment_document_extractions:'استخراج اسناد',document_extraction_fields:'فیلدهای استخراج',documents:'Documents Legacy',
document_rules:'قواعد مدارک',permit_rules:'قواعد مجوز',permits:'مجوزها',customs_offices:'گمرک‌ها',hs_codes:'HS Codes',settings_reference_data:'داده‌های مرجع',
case_checklist_items:'Case Checklist',declaration_checklist_items:'Declaration Checklist',declaration_exit_checklist_items:'Exit Checklist',
cost_categories:'دسته‌های هزینه',finance_settings:'تنظیمات مالی',costs:'هزینه‌ها',payments:'پرداخت/تنخواه',payment_requests:'درخواست وجه',payment_request_lines:'ردیف‌های درخواست وجه',
invoices:'فاکتورها',invoice_lines:'خطوط فاکتور',invoice_shipments:'ارتباط فاکتور-محموله',payment_allocations:'تخصیص پرداخت',vouchers:'سندهای حسابداری',voucher_lines:'ردیف‌های سند',financial_permissions:'ماتریس دسترسی مالی',petty_cash_ledger:'دفتر تنخواه',voucher_line_profit:'سود پنهان ردیف سند',
declarations:'اظهارنامه/EPL/کوتاژ',exit:'خروج کالا',ai_gateway:'AI Gateway',templates:'قالب چاپ',org:'سازمان',org_settings:'تنظیمات سازمان',user_settings:'تنظیمات کاربر',
knowledge_sources:'دانشنامه - منابع',knowledge_chunks:'دانشنامه - قطعات',ai_knowledge_documents:'AI Knowledge Documents',ai_knowledge_chunks:'AI Knowledge Chunks'}
const resourceColumns:Record<ResourceKey,string[]>={
profiles:['full_name','role','is_active','client_id','phone'],clients:['name'],cases:['case_number','display_name','status','cargo_description','cargo_count','warehouse_receipt_no','registration_order_no'],
registration_orders:['order_number','order_date','status','tariff_code','quantity','quantity_unit','value_amount','currency','case_id','client_id'],shipments:['display_name','bill_of_lading_no','shipping_line','voyage_no','cargo_count','cargo_count_unit','net_weight_kg','gross_weight_kg','finance_status'],
containers:['container_number','size_type','seal_number','shipment_id'],shipment_customs_data:['vessel_type','registration_order_no','package_count','warehouse_receipt_no','cargo_description','origin_country','transaction_country','delivery_term','invoice_amount','invoice_currency','tariff_code','net_weight_kg','gross_weight_kg','bill_of_lading'],
shipping_lines:['name','name_fa'],vessels:['name','imo_number','flag_code','shipping_line_id','mmsi_number'],contacts:['full_name','role_title','phone','whatsapp','email'],
shipment_documents:['document_name','original_file_name','extraction_status','is_archived','file_size_bytes','created_at'],customs_documents:['document_type','original_name','display_name','status','document_number','issue_date','is_archived'],
shipment_document_extractions:['field_key','field_label','extracted_value','source_text','confidence','page_number','extraction_method'],document_extraction_fields:['field_key','extracted_value','normalized_value','confidence','source_page','verification_status','extractor'],documents:['doc_type','file_name','storage_path','mime_type','version'],
document_rules:['rule_name','document_type','priority','required','is_active','condition_json'],permit_rules:['rule_name','hs_prefix','cargo_keyword','permit_type','issuing_authority','required','priority'],
permits:['permit_type','permit_number','issuing_authority','status','issued_at','expires_at'],customs_offices:['code','name','city','is_active'],hs_codes:['code','description','import_duty_pct','is_active'],settings_reference_data:['category','code','name','data','is_active'],
case_checklist_items:['case_id','stage_no','item_key','completed','completed_at'],declaration_checklist_items:['declaration_id','item_key','completed','completed_at','completed_by'],declaration_exit_checklist_items:['declaration_id','item_key','completed','completed_at','completed_by'],
cost_categories:['code','name_fa','name_en','is_active','sort_order'],finance_settings:['default_currency','invoice_prefix','payment_request_prefix','next_invoice_number','next_payment_request_number','default_vat_rate','payment_terms','bank_name'],
costs:['description','quantity','unit','unit_price','amount','currency','amount_irr','status','payable_by','paid_by'],payments:['payment_no','payment_date','direction','amount','currency','amount_irr','payment_type','reference_no'],
payment_requests:['request_no','request_date','requested_amount','currency','status','subject'],payment_request_lines:['request_id','invoice_line_id','description','amount','sort_order'],
invoices:['invoice_no','invoice_year','issue_date','due_date','status','subtotal','vat_amount','total_amount','currency'],invoice_lines:['invoice_id','shipment_id','line_type','description','quantity','unit','unit_price','amount','vat_rate','vat_amount'],
invoice_shipments:['invoice_id','shipment_id'],payment_allocations:['payment_id','invoice_id','amount'],vouchers:['voucher_number','company_name','cargo_type','tonnage','unit_count','unit_type','debit_total','credit_total','balance_total','is_balanced'],financial_permissions:['user_id','view_own_expenses','view_own_petty_cash','view_own_receipts','approve_other_expenses','issue_payment_request','view_org_financials','view_profit'],petty_cash_ledger:['user_id','amount','direction','related_expense_id','description'],voucher_line_profit:['voucher_line_item_id','profit_type','profit_amount','set_by_user_id','visible_to'],
voucher_lines:['voucher_id','row_number','description','description_category','receipt_number','debit_amount','credit_amount','status','void_reason'],declarations:['kottaj_number','declaration_date','customs_path','payment_reference','assessed_value_irr','total_duties_irr','workflow_stage'],
exit:['case_id','exit_status','exit_permit_no','exit_permit_date','vehicle_plate','driver_name','exit_at'],ai_gateway:['enabled','online_enabled','preferred_provider','fallback_providers','confidence_threshold','redaction_enabled','max_commands_per_minute'],
templates:['template_key','name','document_type','is_active'],org:['name','economic_code','created_at'],org_settings:['settings','updated_at'],user_settings:['user_id','settings','updated_at'],
knowledge_sources:['title','source_type','source_number','issued_at','effective_at','issuer','subject','status','storage_path','extraction_confidence'],knowledge_chunks:['source_id','chunk_index','content','page_number'],ai_knowledge_documents:['title','source_type','source_uri','version','content','active'],ai_knowledge_chunks:['knowledge_document_id','chunk_index','content']
}
const logLabels:Record<LogKey,string>={audit:'Audit Log',case_history:'Status History',financial_history:'Financial History',ai_commands:'AI Operator Commands',ai_interactions:'AI Interactions',ai_action_logs:'AI Action Logs',ai_risk_findings:'AI Risk Findings',file_security_events:'File Security Events',shipment_tracking:'Shipment Tracking Events',discrepancy_logs:'Discrepancy Logs'};

const resourceTables:Record<string,string>={
profiles:'profiles',clients:'clients',cases:'cases',registration_orders:'registration_orders',shipments:'shipments',
containers:'containers',shipment_customs_data:'shipment_customs_data',shipping_lines:'shipping_lines',vessels:'vessels',
contacts:'shipping_line_contacts',shipment_documents:'shipment_documents',customs_documents:'customs_documents',
shipment_document_extractions:'shipment_document_extractions',document_extraction_fields:'document_extraction_fields',
documents:'documents',document_rules:'document_requirement_rules',permit_rules:'permit_rules',permits:'permits',
customs_offices:'customs_offices',hs_codes:'hs_codes',settings_reference_data:'settings_reference_data',
case_checklist_items:'case_checklist_items',declaration_checklist_items:'declaration_checklist_items',
declaration_exit_checklist_items:'declaration_exit_checklist_items',cost_categories:'finance_cost_categories',
finance_settings:'finance_org_settings',costs:'finance_cost_items',payments:'finance_payments',
payment_requests:'finance_payment_requests',payment_request_lines:'finance_payment_request_lines',
invoices:'finance_invoices',invoice_lines:'finance_invoice_lines',invoice_shipments:'finance_invoice_shipments',
payment_allocations:'finance_payment_allocations',vouchers:'customs_accounting_vouchers',voucher_lines:'voucher_line_items',
declarations:'customs_declarations',exit:'case_exit_operations',ai_gateway:'ai_gateway_settings',
templates:'print_templates',org:'organizations',org_settings:'organization_settings',user_settings:'user_settings',
knowledge_sources:'knowledge_sources',knowledge_chunks:'knowledge_chunks',ai_knowledge_documents:'ai_knowledge_documents',
ai_knowledge_chunks:'ai_knowledge_chunks'
};
const resourceGlobals=new Set(['customs_offices','hs_codes']);
const logTables:Record<string,string>={
audit:'audit_logs',case_history:'case_status_history',financial_history:'financial_transactions',
ai_commands:'ai_operator_commands',ai_interactions:'ai_interactions',ai_action_logs:'ai_agent_action_logs',
ai_risk_findings:'ai_risk_findings',file_security_events:'file_security_events',
shipment_tracking:'shipment_tracking_events',discrepancy_logs:'discrepancy_logs'
};
const safeJson=(row:any)=>{
const out:any={};
for(const[k,v]of Object.entries(row||{})){
if(['id','organization_id','created_at','updated_at','created_by','updated_by','uploaded_by','voided_by','voided_at','archived_by','archived_at','is_archived','archive_reason'].includes(k))continue;
out[k]=v;
}
return out;
};
const pretty=(v:any)=>typeof v==='string'?v:v==null?'':JSON.stringify(v);

const OwnerConfirm:React.FC<{title:string;description:string;phrase?:string;onClose:()=>void;onConfirm:(reason:string)=>void;busy:boolean}>=({title,description,phrase,onClose,onConfirm,busy})=>{
const[reason,setReason]=useState('');const[input,setInput]=useState('');
return <div className="fixed inset-0 z-[140] bg-black/60 flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-lg rounded-2xl border app-border bg-[var(--surface)] p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black flex items-center gap-2"><AlertTriangle size={18}/> {title}</h3><p className="text-xs app-muted mt-2 leading-6">{description}</p></div><button className="icon-btn" onClick={onClose}><X size={17}/></button></div><textarea className="w-full min-h-24 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm mt-4" value={reason} onChange={e=>setReason(e.target.value)} placeholder="دلیل اجباری را وارد کنید…"/>{phrase&&<><div className="text-[10px] app-muted mt-3">عبارت تأیید نهایی:</div><div className="rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs font-black mt-1">{phrase}</div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mt-2" value={input} onChange={e=>setInput(e.target.value)} placeholder="عبارت را عیناً وارد کنید"/></>}<div className="flex justify-end gap-2 mt-4"><button className="px-4 py-2 rounded-xl border app-border text-xs" onClick={onClose}>انصراف</button><button disabled={busy||!reason.trim()||(!!phrase&&input!==phrase)} className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold" onClick={()=>onConfirm(reason.trim())}>{busy?<RefreshCw size={14} className="inline animate-spin"/>:<Check size={14} className="inline ml-1"/>} تأیید نهایی</button></div></div></div>;
};

const UsersPanel:React.FC<{onMessage:(s:string)=>void}>=({onMessage})=>{
const{profile}=useAuth();const profileOrgId=profile?.organization_id||'';
const[rows,setRows]=useState<any[]>([]),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>(null),[newMode,setNewMode]=useState(false),[form,setForm]=useState<any>({user_id:'',full_name:'',phone:'',role:'client',client_id:'',is_active:true}),[modal,setModal]=useState(false),[busy,setBusy]=useState(false);
const load=async()=>{setBusy(true);try{let q:any=supabase.from('profiles').select('*').eq('organization_id',profileOrgId);const{data,error}=await q.limit(500);if(error)throw error;const s=search.trim().toLowerCase();const filtered=s?(data||[]).filter((r:any)=>Object.values(r||{}).some((v:any)=>String(v??'').toLowerCase().includes(s))):(data||[]);setRows(filtered)}catch(e:any){onMessage(e?.message||'دریافت کاربران ناموفق بود.')}finally{setBusy(false)}};
useEffect(()=>{void load()},[search]);
const open=(u:any)=>{setNewMode(false);setSelected(u);setForm({user_id:u.id,full_name:u.full_name||'',phone:u.phone||'',role:u.role||'client',client_id:u.client_id||'',is_active:!!u.is_active})};
const create=()=>{setSelected(null);setNewMode(true);setForm({user_id:'',full_name:'',phone:'',role:'client',client_id:'',is_active:true})};
const save=async(reason:string)=>{
setBusy(true);try{
if(newMode){
 if(!form.user_id.trim()||!form.full_name.trim()){onMessage('Auth User ID و نام کامل الزامی است.');return;}
 const{error}=await supabase.functions.invoke('owner-console',{body:{action:'create',resource:'profiles',user_id:form.user_id.trim(),full_name:form.full_name.trim(),data:form}});
 if(error)throw error;onMessage('پروفایل Owner Console ساخته شد.');setNewMode(false);setForm({user_id:'',full_name:'',phone:'',role:'client',client_id:'',is_active:true});await load();return;
}
if(!selected?.id)return;
const{error}=await supabase.functions.invoke('owner-console',{body:{action:'save',resource:'profiles',id:selected.id,data:form,reason,confirmation:'تأیید نهایی تغییر کاربر'}});if(error)throw error;
onMessage('تغییر کاربر ثبت شد و Audit شد.');setModal(false);setSelected(null);await load();
}catch(e:any){onMessage(e?.message||'ذخیره کاربر ناموفق بود.')}finally{setBusy(false)}
};
return <section className="space-y-3"><div className="rounded-2xl border app-border bg-[var(--surface)] p-4"><div className="flex items-center justify-between gap-3"><div><b>مدیریت کاربران و نقش‌ها</b><p className="text-[10px] app-muted mt-1">ایجاد برای Auth User موجود انجام می‌شود؛ حذف فیزیکی Profile ممنوع است و Deactivate استفاده می‌شود.</p></div><div className="flex gap-2"><button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={create}>＋ پروفایل Auth موجود</button><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={15}/></button></div></div><div className="relative mt-3"><Search size={15} className="absolute right-3 top-3 app-muted"/><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] pr-9 px-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)} placeholder="نام، نقش، Client ID یا User ID…"/></div></div><div className="grid xl:grid-cols-[1fr_420px] gap-3"><div className="grid md:grid-cols-2 gap-3 content-start">{rows.map(u=><button key={u.id} className="w-full text-right rounded-2xl border app-border bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)] shadow-sm" onClick={()=>open(u)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="text-sm font-black truncate block">{u.full_name||'بدون نام'}</b><div className="text-[10px] app-muted mt-1">{u.phone||'بدون تلفن'}</div></div><span className="shrink-0 px-2.5 py-1 rounded-full border app-border text-[10px] font-bold">{roleLabels[u.role]||u.role}</span></div><div className="grid grid-cols-2 gap-2 mt-4"><div className="rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2"><div className="text-[9px] app-muted">وضعیت</div><div className="text-xs mt-1">{u.is_active?'فعال':'غیرفعال'}</div></div><div className="rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2"><div className="text-[9px] app-muted">Client ID</div><div className="text-xs mt-1 truncate">{u.client_id||'—'}</div></div></div><div className="mt-3 text-[9px] app-muted break-all">{u.id}</div></button>)}</div><div className="rounded-2xl border app-border bg-[var(--surface)] p-4 h-fit">{newMode?<><div className="font-black mb-3">پروفایل جدید برای Auth User</div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.user_id} onChange={e=>setForm({...form,user_id:e.target.value})} placeholder="Auth User UUID"/><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="نام کامل"/><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="تلفن"/><select className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.keys(roleLabels).map(r=><option key={r}>{r}</option>)}</select><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-3" value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})} placeholder="Client UUID (اختیاری)"/><button className="w-full rounded-xl bg-[var(--primary)] text-white py-2.5 text-xs font-bold" onClick={()=>void save('ایجاد پروفایل از Owner Console')}>ایجاد پروفایل</button></>:selected?<><div className="font-black mb-3">ویرایش کاربر</div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="نام کامل"/><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="تلفن"/><select className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.keys(roleLabels).map(r=><option key={r}>{r}</option>)}</select><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mb-2" value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})} placeholder="Client UUID"/><label className="flex items-center gap-2 text-xs mb-3"><input type="checkbox" checked={form.is_active} onChange={e=>setForm({...form,is_active:e.target.checked})}/> فعال</label><button className="w-full rounded-xl bg-[var(--primary)] text-white py-2.5 text-xs font-bold" onClick={()=>setModal(true)}>ذخیره با تأیید</button></>:<div className="text-xs app-muted">یک کاربر را انتخاب کنید یا پروفایل Auth موجود جدید بسازید.</div>}</div></div>{modal&&<OwnerConfirm title="تغییر نقش/وضعیت کاربر" description="این عملیات پرریسک است. آخرین Owner فعال در Database قابل غیرفعال‌سازی یا تنزل نیست." phrase="تأیید نهایی تغییر کاربر" busy={busy} onClose={()=>setModal(false)} onConfirm={save}/>}</section>;
};

const fieldLabels:Record<string,string>={id:'شناسه',full_name:'نام کامل',phone:'تلفن',role:'نقش',is_active:'فعال',name:'نام',name_fa:'نام فارسی',name_en:'نام انگلیسی',client_id:'صاحب کالا',case_id:'پرونده',case_number:'شماره پرونده',display_name:'عنوان سند',status:'وضعیت',cargo_description:'شرح کالا',cargo_count:'تعداد کالا',cargo_count_unit:'واحد تعداد',warehouse_receipt_no:'قبض انبار',registration_order_no:'شماره ثبت سفارش',proforma_no:'شماره پروفرما',order_number:'شماره ثبت سفارش',order_date:'تاریخ ثبت سفارش',tariff_code:'کد تعرفه',quantity:'مقدار',quantity_unit:'واحد مقدار',value_amount:'ارزش',currency:'ارز',order_status:'وضعیت سفارش',bill_of_lading_no:'شماره بارنامه',shipping_line:'کشتیرانی',shipping_line_id:'کشتیرانی',voyage_no:'Voyage',vessel_type:'نوع شناور',origin_port:'بندر مبدأ',destination_port:'بندر مقصد',origin_country:'کشور مبدأ',transaction_country:'کشور معامله',delivery_term:'شرایط تحویل',invoice_amount:'مبلغ فاکتور',invoice_currency:'ارز فاکتور',package_count:'تعداد بسته',gross_weight_kg:'وزن ناخالص (کیلوگرم)',net_weight_kg:'وزن خالص (کیلوگرم)',bill_of_lading:'بارنامه',container_number:'شماره کانتینر',size_type:'سایز/نوع',seal_number:'شماره پلمب',imo_number:'IMO',mmsi_number:'MMSI',flag_code:'پرچم',role_title:'سمت',whatsapp:'واتساپ',email:'ایمیل',document_name:'نام سند',original_file_name:'نام فایل اصلی',storage_path:'مسیر فایل',file_size_bytes:'حجم فایل',extraction_status:'وضعیت استخراج',document_type:'نوع سند',original_name:'نام اصلی',document_number:'شماره سند',issue_date:'تاریخ صدور',field_key:'کلید فیلد',field_label:'عنوان فیلد',extracted_value:'مقدار استخراج‌شده',source_text:'متن منبع',confidence:'اطمینان',page_number:'صفحه',extraction_method:'روش استخراج',normalized_value:'مقدار نرمال‌شده',source_page:'صفحه منبع',verification_status:'وضعیت تأیید',extractor:'استخراج‌کننده',version:'نسخه',doc_type:'نوع سند',file_name:'نام فایل',mime_type:'نوع فایل',rule_name:'نام قاعده',priority:'اولویت',required:'الزامی',condition_json:'شرط قاعده',hs_prefix:'پیشوند HS',cargo_keyword:'کلیدواژه کالا',permit_type:'نوع مجوز',issuing_authority:'مرجع صادرکننده',permit_number:'شماره مجوز',issued_at:'تاریخ صدور',expires_at:'تاریخ انقضا',code:'کد',description:'شرح',import_duty_pct:'حقوق ورودی (%)',category:'دسته',data:'داده',item_key:'کلید آیتم',stage_no:'مرحله',completed:'تکمیل‌شده',completed_at:'زمان تکمیل',completed_by:'تکمیل‌کننده',declaration_id:'اظهارنامه',kottaj_number:'شماره کوتاژ',declaration_date:'تاریخ اظهار',customs_path:'مسیر گمرکی',payment_reference:'شناسه پرداخت',assessed_value_irr:'ارزش ارزیابی (ریال)',total_duties_irr:'حقوق و عوارض (ریال)',workflow_stage:'مرحله گردش کار',unit:'واحد',unit_price:'قیمت واحد',amount:'مبلغ',amount_irr:'مبلغ (ریال)',notes:'یادداشت',internal_notes:'یادداشت داخلی',payable_by:'پرداخت‌کننده',paid_by:'پرداخت‌شده توسط',payment_no:'شماره پرداخت',payment_date:'تاریخ پرداخت',direction:'جهت',payment_type:'نوع پرداخت',reference_no:'شماره مرجع',request_no:'شماره درخواست وجه',request_date:'تاریخ درخواست',requested_amount:'مبلغ درخواستی',subject:'موضوع',body_text:'متن درخواست',request_id:'درخواست',invoice_line_id:'ردیف فاکتور',sort_order:'ترتیب',invoice_no:'شماره فاکتور',invoice_year:'سال',due_date:'سررسید',subtotal:'جمع جزء',vat_amount:'مالیات',total_amount:'جمع کل',invoice_id:'فاکتور',line_type:'نوع ردیف',vat_rate:'نرخ مالیات',invoice_shipments:'ارتباط فاکتور-محموله',payment_id:'پرداخت',balance_total:'مانده',debit_total:'جمع بدهکار',credit_total:'جمع بستانکار',voucher_number:'شماره سند حسابداری',company_name:'نام شرکت',cargo_type:'نوع کالا',tonnage:'تناژ',unit_count:'تعداد واحد',unit_type:'واحد',is_balanced:'تراز است',row_number:'شماره ردیف',description_category:'دسته شرح',receipt_number:'شماره رسید',debit_amount:'بدهکار',credit_amount:'بستانکار',void_reason:'دلیل ابطال',exit_status:'وضعیت خروج',exit_permit_no:'شماره مجوز خروج',exit_permit_date:'تاریخ مجوز خروج',vehicle_plate:'پلاک خودرو',driver_name:'راننده',exit_at:'زمان خروج',enabled:'فعال',online_enabled:'آنلاین',preferred_provider:'Provider اصلی',fallback_providers:'Fallback Providers',confidence_threshold:'حد آستانه اطمینان',redaction_enabled:'حذف اطلاعات حساس',max_commands_per_minute:'سقف فرمان/دقیقه',template_key:'کلید قالب',template_name:'نام قالب',active:'فعال',title:'عنوان',source_type:'نوع منبع',source_number:'شماره منبع',effective_at:'تاریخ اجرا',issuer:'صادرکننده',extraction_confidence:'اطمینان استخراج',chunk_index:'شماره قطعه',content:'محتوا',source_id:'منبع',source_uri:'آدرس منبع',knowledge_document_id:'سند دانش',settings:'تنظیمات',economic_code:'شناسه اقتصادی',created_at:'ایجاد شده',updated_at:'آخرین تغییر'};
const labelFor=(key:string)=>fieldLabels[key]||key.split('_').join(' ').replace(/\\b\\w/g,m=>m.toUpperCase());

const primitiveValue=(v:any)=>{
 if(v===null||v===undefined)return '';
 if(typeof v==='object')return JSON.stringify(v,null,2);
 return String(v);
};
const inputKind=(key:string,value:any)=>{
 if(typeof value==='boolean')return 'boolean';
 if(typeof value==='number')return 'number';
 if(value && typeof value==='object')return 'json';
 if(/(^|_)(date|at|time)(_|$)/i.test(key))return 'date';
 if(/(description|notes|content|source_text|body_text|reason|condition_json|settings)$/i.test(key))return 'textarea';
 return 'text';
};
const statusKeys=new Set(['status','extraction_status','verification_status','exit_status','workflow_stage','order_status']);
const protectedKeys=new Set(['id','organization_id','created_at','updated_at','created_by','updated_by','uploaded_by','voided_by','voided_at','archived_by','archived_at','is_archived','archive_reason']);

const RecordField:React.FC<{label:string;kind:string;value:any;onChange:(v:any)=>void}>=({label,kind,value,onChange})=>{
 if(kind==='boolean')return <label className="rounded-2xl border app-border bg-[var(--surface-2)] p-4 flex items-center justify-between gap-3 cursor-pointer"><span><span className="block text-[11px] font-black">{label}</span><span className="block text-[10px] app-muted mt-1">{value?'فعال / بله':'غیرفعال / خیر'}</span></span><input type="checkbox" className="w-5 h-5" checked={!!value} onChange={e=>onChange(e.target.checked)}/></label>;
 if(kind==='textarea'||kind==='json')return <label className="block md:col-span-2 rounded-2xl border app-border bg-[var(--surface-2)] p-3"><span className="block text-[10px] app-muted mb-2">{label}</span><textarea dir={kind==='json'?'ltr':'rtl'} className="w-full min-h-24 bg-transparent outline-none text-xs leading-6 resize-y" value={primitiveValue(value)} onChange={e=>onChange(kind==='json'?(()=>{try{return JSON.parse(e.target.value)}catch{return e.target.value}})():e.target.value)}/></label>;
 return <label className="block rounded-2xl border app-border bg-[var(--surface-2)] p-3"><span className="block text-[10px] app-muted mb-2">{label}</span><input type={kind==='number'?'number':kind==='date'?'datetime-local':'text'} className="w-full bg-transparent outline-none text-sm min-h-8" value={primitiveValue(value)} onChange={e=>onChange(kind==='number'?(e.target.value===''?'':Number(e.target.value)):e.target.value)}/></label>;
};

const RecordCard:React.FC<{resource:ResourceKey;row:any;selected:boolean;onSelect:()=>void}>=({resource,row,selected,onSelect})=>{
 const keys=Object.keys(row).filter(k=>!protectedKeys.has(k)).slice(0,8);
 const title=String(row.display_name||row.name||row.document_name||row.original_file_name||row.file_name||row.case_number||row.order_number||row.bill_of_lading_no||row.kottaj_number||row.invoice_no||row.payment_no||row.request_no||row.voucher_number||row.permit_number||row.title||row.template_key||row.code||'رکورد');
 const status=String(row.status??row.extraction_status??row.exit_status??row.verification_status??'');
 return <button type="button" onClick={onSelect} className={'w-full text-right rounded-2xl border p-4 transition shadow-sm '+(selected?'border-[var(--primary)] ring-2 ring-[var(--primary)]/15 bg-[var(--surface-2)]':'app-border bg-[var(--surface)] hover:bg-[var(--surface-2)]')}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-black truncate">{title}</div><div className="text-[10px] app-muted mt-1 break-all">{row.id||row.code||'بدون شناسه'}</div></div>{status&&<span className="shrink-0 px-2.5 py-1 rounded-full border app-border text-[10px] font-bold">{status}</span>}</div><div className="grid grid-cols-2 gap-2 mt-4">{keys.slice(0,6).map(k=><div key={k} className="rounded-xl bg-[var(--surface-2)] border app-border px-3 py-2 min-w-0"><div className="text-[9px] app-muted">{labelFor(k)}</div><div className="text-xs mt-1 truncate">{primitiveValue(row[k])||'—'}</div></div>)}</div><div className="mt-3 flex items-center justify-between text-[10px]"><span className="app-muted">{Object.keys(row).filter(k=>!protectedKeys.has(k)).length} فیلد قابل مدیریت</span><span className="font-black text-[var(--primary)]">مشاهده و ویرایش ←</span></div></button>;
};

const ResourcePanel:React.FC<{resource:ResourceKey;onMessage:(s:string)=>void}>=({resource,onMessage})=>{
 const{profile}=useAuth();const profileOrgId=profile?.organization_id||'';
 const[rows,setRows]=useState<any[]>([]),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>(null),[draft,setDraft]=useState<any>({}),[busy,setBusy]=useState(false),[danger,setDanger]=useState<'delete'|'archive'|'void'|null>(null);
 const load=async()=>{
  setBusy(true);
  try{
   const table=resourceTables[resource];if(!table)throw new Error('منبع خواندن نشده است');
   let data:any[]=[];
   if(resource==='user_settings'){
    const u=await supabase.from('profiles').select('id').eq('organization_id',profileOrgId);if(u.error)throw u.error;
    const ids=(u.data||[]).map((x:any)=>x.id);
    if(ids.length){const q=await supabase.from(table).select('*').in('user_id',ids).limit(500);if(q.error)throw q.error;data=q.data||[]}
   }else if(resource==='org'){
    const q=await supabase.from(table).select('*').eq('id',profileOrgId).limit(1);if(q.error)throw q.error;data=q.data||[];
   }else{
    let q:any=supabase.from(table).select('*');if(!resourceGlobals.has(resource))q=q.eq('organization_id',profileOrgId);
    const r=await q.limit(500);if(r.error)throw r.error;data=r.data||[];
   }
   const s=search.trim().toLowerCase();if(s)data=data.filter((r:any)=>Object.values(r||{}).some((v:any)=>String(v??'').toLowerCase().includes(s)));
   setRows(data);
  }catch(e:any){onMessage(e?.message||'خواندن داده ناموفق بود.')}finally{setBusy(false)}
 };
 useEffect(()=>{void load()},[resource,search,profileOrgId]);
 const selectRow=(row:any)=>{setSelected(row);setDraft({...row})};
 const update=(key:string,value:any)=>setDraft((d:any)=>({...d,[key]:value}));
 const save=async()=>{
  if(!selected)return;
  setBusy(true);
  try{
   const editable:any={};
   Object.keys(draft).forEach(k=>{if(!protectedKeys.has(k))editable[k]=draft[k]});
   const{data:r,error}=await supabase.functions.invoke('owner-console',{body:{action:'update',resource,id:selected.id,data:editable}});
   if(error)throw error;
   onMessage('رکورد با موفقیت ذخیره شد.');setSelected(r||draft);await load();
  }catch(e:any){onMessage(e?.message||'ذخیره ناموفق بود.')}finally{setBusy(false)}
 };
 const createNew=()=>{setSelected({__new:true});setDraft({})};
 const create=async()=>{
  setBusy(true);
  try{
   const editable:any={};Object.keys(draft).forEach(k=>{if(!protectedKeys.has(k))editable[k]=draft[k]});
   const{data:r,error}=await supabase.functions.invoke('owner-console',{body:{action:'create',resource,data:editable}});
   if(error)throw error;onMessage('رکورد جدید ایجاد شد.');setSelected(r);setDraft(r);await load();
  }catch(e:any){onMessage(e?.message||'ایجاد رکورد ناموفق بود.')}finally{setBusy(false)}
 };
 const dangerRun=async(reason:string)=>{
  if(!selected||selected.__new)return;setBusy(true);
  try{
   let body:any;
   if(danger==='archive')body={action:'delete',resource:'document_archive',id:selected.id,reason,confirmation:'تأیید نهایی Archive سند'};
   else if(danger==='void')body={action:'delete',resource:'voucher_void',id:selected.id,reason,confirmation:'تأیید نهایی ابطال ردیف سند'};
   else if(resource==='cases')body={action:'delete',resource:'case_delete',id:selected.id,reason,confirmation:'تأیید نهایی حذف پرونده'};
   else body={action:'delete',resource,id:selected.id,reason,confirmation:'تأیید نهایی عملیات'};
   const{error}=await supabase.functions.invoke('owner-console',{body});if(error)throw error;
   setDanger(null);setSelected(null);onMessage('عملیات ثبت شد و Audit به‌روزرسانی شد.');await load();
  }catch(e:any){onMessage(e?.message||'عملیات ناموفق بود.')}finally{setBusy(false)}
 };
 const isDoc=resource==='shipment_documents'||resource==='customs_documents';const isVoid=resource==='voucher_lines';
 const fields=selected?.__new?(resourceColumns[resource]||[]):Object.keys(draft).filter(k=>!protectedKeys.has(k));
 return <section className="space-y-4">
  <div className="rounded-3xl border app-border bg-[var(--surface)] p-4 md:p-5 shadow-sm">
   <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div><div className="flex items-center gap-2"><Settings2 size={18}/><b className="text-base">{resourceLabels[resource]}</b><span className="px-2.5 py-1 rounded-full bg-[var(--surface-2)] border app-border text-[10px]">{rows.length} رکورد</span></div><p className="text-[10px] app-muted mt-2">هر رکورد مستقل است؛ انتخاب کنید تا جزئیات و تنظیمات همان رکورد نمایش داده شود.</p></div>
    <div className="flex gap-2"><button className="px-4 py-2.5 rounded-xl border app-border text-xs font-bold" onClick={createNew}>＋ رکورد جدید</button><button className="icon-btn" onClick={()=>void load()} title="بازخوانی"><RefreshCw size={15} className={busy?'animate-spin':''}/></button></div>
   </div>
   <div className="mt-4 flex flex-col md:flex-row gap-2"><div className="relative flex-1"><Search size={15} className="absolute right-3 top-3 app-muted"/><input className="w-full min-h-11 rounded-xl border app-border bg-[var(--surface-2)] pr-9 px-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)} placeholder="جست‌وجو در همه فیلدهای رکوردها…"/></div><div className="px-3 py-2.5 rounded-xl border app-border bg-[var(--surface-2)] text-[10px] app-muted flex items-center">{busy?'در حال خواندن…':'همگام با Supabase / RLS'}</div></div>
  </div>
  <div className="grid 2xl:grid-cols-[minmax(0,1fr)_560px] gap-4">
   <div className="grid md:grid-cols-2 gap-3 content-start">{rows.map(row=><RecordCard key={row.id||JSON.stringify(row)} resource={resource} row={row} selected={selected?.id===row.id} onSelect={()=>selectRow(row)}/>)}
    {!rows.length&&<div className="md:col-span-2 rounded-3xl border app-border bg-[var(--surface)] p-12 text-center"><Database size={28} className="mx-auto app-muted"/><div className="font-black mt-3">رکوردی پیدا نشد</div><div className="text-[10px] app-muted mt-1">فیلتر را تغییر دهید یا یک رکورد جدید ایجاد کنید.</div></div>}
   </div>
   <div className="rounded-3xl border app-border bg-[var(--surface)] p-4 md:p-5 h-fit 2xl:sticky 2xl:top-4">
    <div className="flex items-center justify-between gap-3"><div><b>{selected?.__new?'رکورد جدید':selected?'ویرایش رکورد':'تنظیمات رکورد'}</b><p className="text-[10px] app-muted mt-1">{selected?.id||'برای شروع یک رکورد از سمت چپ انتخاب کنید.'}</p></div>{selected&&<button className="icon-btn" onClick={()=>{setSelected(null);setDraft({})}}><X size={16}/></button>}</div>
    {selected?<><div className="grid md:grid-cols-2 gap-3 mt-4">{fields.map(k=><RecordField key={k} label={labelFor(k)} kind={inputKind(k,draft[k])} value={draft[k]} onChange={v=>update(k,v)}/>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
       <button disabled={busy} onClick={()=>void(selected.__new?create():save())} className="px-5 py-3 rounded-xl bg-[var(--primary)] text-white text-xs font-black inline-flex items-center gap-2"><Save size={15}/>{selected.__new?'ایجاد رکورد':'ذخیره تغییرات'}</button>
       {selected?.id&&(isDoc||isVoid||resource==='cases'||resource!=='org')&&<button className="px-4 py-3 rounded-xl border border-red-500/30 text-red-500 text-xs font-bold" onClick={()=>setDanger(isDoc?'archive':isVoid?'void':'delete')}>{isDoc?'Archive سند':isVoid?'Void ردیف':'حذف رکورد'}</button>}
      </div>
      {selected?.id&&<div className="mt-4 rounded-2xl border app-border bg-[var(--surface-2)] p-3 text-[10px] app-muted">فیلدهای سیستمی و تاریخچه قابل ویرایش نیستند و توسط Database/Audit کنترل می‌شوند.</div>}
    </>:<div className="mt-10 rounded-2xl border-dashed border app-border p-10 text-center"><Settings2 size={28} className="mx-auto app-muted"/><div className="font-black mt-3">یک رکورد را انتخاب کنید</div><div className="text-[10px] app-muted mt-1">تمام تنظیمات آن رکورد به‌صورت فیلدهای گرافیکی نمایش داده می‌شود.</div></div>}
   </div>
  </div>
  {danger&&<OwnerConfirm title={danger==='archive'?'Archive سند':danger==='void'?'Void ردیف حسابداری':resource==='cases'?'حذف اضطراری پرونده':'حذف رکورد'} description={danger==='archive'?'فایل فیزیکی در Storage حذف نمی‌شود؛ فقط Archived می‌شود.':danger==='void'?'ردیف باطل می‌شود و دلیل/زمان/کاربر تاریخی قابل ویرایش نیست.':'عملیات روی داده واقعی سازمان اجرا می‌شود و دلیل آن در Audit ثبت خواهد شد.'} phrase={danger==='void'?'تأیید نهایی ابطال ردیف سند':resource==='cases'?'تأیید نهایی حذف پرونده':'تأیید نهایی عملیات'} busy={busy} onClose={()=>setDanger(null)} onConfirm={dangerRun}/>}
 </section>;
};

const CaseOverride:React.FC<{row:any;onMessage:(s:string)=>void;onDone:()=>void}>=({row,onMessage,onDone})=>{
const[open,setOpen]=useState(false),[status,setStatus]=useState(''),[reason,setReason]=useState(''),[phrase,setPhrase]=useState(''),[busy,setBusy]=useState(false);
const run=async()=>{if(!status.trim()||!reason.trim()||phrase.trim()!=='تأیید نهایی اصلاح وضعیت')return;setBusy(true);try{const{error}=await supabase.functions.invoke('owner-console',{body:{action:'update',resource:'case_status_override',id:row.id,new_status:status.trim(),reason:reason.trim(),confirmation:phrase.trim()}});if(error)throw error;onMessage('Override وضعیت با دلیل در History/Audit ثبت شد.');setOpen(false);onDone()}catch(e:any){onMessage(e?.message||'Override ناموفق بود.')}finally{setBusy(false)}};
return <>{open? <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-lg rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="flex justify-between"><b>اصلاح استثنایی وضعیت پرونده</b><button className="icon-btn" onClick={()=>setOpen(false)}><X size={17}/></button></div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mt-4" value={status} onChange={e=>setStatus(e.target.value)} placeholder="Status معتبر case_status"/><textarea className="w-full min-h-24 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-sm mt-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="دلیل اجباری…"/><div className="text-[10px] app-muted mt-3">عبارت نهایی: تأیید نهایی اصلاح وضعیت</div><input className="w-full min-h-10 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm mt-1" value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder="عبارت را عیناً وارد کنید"/><div className="flex justify-end gap-2 mt-4"><button className="px-3 py-2 rounded-xl border app-border text-xs" onClick={()=>setOpen(false)}>انصراف</button><button disabled={busy||!status.trim()||!reason.trim()||phrase.trim()!=='تأیید نهایی اصلاح وضعیت'} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-xs font-bold" onClick={()=>void run()}>{busy?'در حال ثبت…':'ثبت Override'}</button></div></div></div>:<button className="w-full mt-3 px-3 py-2.5 rounded-xl border border-amber-500/30 text-amber-600 text-xs font-bold" onClick={()=>setOpen(true)}>Override Status — فقط Owner</button>}</>;
};

const LogsPanel:React.FC<{onMessage:(s:string)=>void}>=({onMessage})=>{
const{profile}=useAuth();const profileOrgId=profile?.organization_id||'';
const[kind,setKind]=useState<LogKey>('audit'),[rows,setRows]=useState<any[]>([]);
const load=async()=>{try{const table=logTables[kind];const r=await supabase.from(table).select('*').eq('organization_id',profileOrgId).limit(500);if(r.error)throw r.error;setRows(r.data||[])}catch(e:any){onMessage(e?.message||'خواندن Log ناموفق بود.')}};
useEffect(()=>{void load()},[kind]);
return <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden"><div className="p-4 border-b app-border flex items-center gap-2"><History size={17}/><b>سوابق — فقط خواندنی</b><select className="mr-auto min-h-9 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-xs" value={kind} onChange={e=>setKind(e.target.value as LogKey)}>{Object.entries(logLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={15}/></button></div><div className="max-h-[65vh] overflow-auto">{rows.map((r:any,i:number)=><details key={r.id||i} className="border-b app-border p-3"><summary className="text-xs cursor-pointer">{logLabels[kind]} · {r.created_at||r.event_at||'—'}</summary><pre dir="ltr" className="mt-2 rounded-xl bg-[var(--surface-2)] p-3 text-[9px] overflow-auto">{JSON.stringify(r,null,2)}</pre></details>)}{!rows.length&&<div className="p-10 text-center text-xs app-muted">رکوردی وجود ندارد.</div>}</div></section>;
};

const OfflinePanel:React.FC=()=>{
const[items,setItems]=useState<any[]>([]);
useEffect(()=>{const a:any[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';if(/queue|offline|sync/i.test(k)){let v:any=localStorage.getItem(k);try{v=JSON.parse(v||'')}catch{}a.push({key:k,value:v})}}setItems(a)},[]);
return <section className="rounded-2xl border app-border bg-[var(--surface)] p-4"><b>Offline Queue</b><p className="text-xs app-muted mt-1">فقط خواندنی؛ هیچ آیتمی از Queue حذف یا اصلاح نمی‌شود.</p>{items.map(x=><details key={x.key} className="rounded-xl border app-border p-3 mt-2"><summary className="text-xs">{x.key}</summary><pre dir="ltr" className="text-[9px] mt-2 overflow-auto">{pretty(x.value)}</pre></details>)}{!items.length&&<div className="p-10 text-center text-xs app-muted">صف قابل مشاهده‌ای در localStorage پیدا نشد.</div>}</section>;
};

const sections=[
{id:'users',label:'کاربران و نقش‌ها',icon:UserCog,res:['profiles']},
{id:'cases',label:'Case و عملیات',icon:Database,res:['clients','cases','case_checklist_items','containers']},
{id:'registration',label:'Registration Order',icon:FileCog,res:['registration_orders']},
{id:'maritime',label:'Maritime',icon:Ship,res:['shipments','shipment_customs_data','shipping_lines','vessels','contacts']},
{id:'documents',label:'Documents',icon:Archive,res:['shipment_documents','customs_documents','shipment_document_extractions','document_extraction_fields','documents']},
{id:'doc_rules',label:'Document Rules',icon:Settings2,res:['document_rules','settings_reference_data']},
{id:'permit_rules',label:'Permit Rules',icon:ShieldCheck,res:['permit_rules','permits','hs_codes','customs_offices']},
{id:'finance',label:'Finance / Accounting',icon:Wallet,res:['finance_settings','cost_categories','costs','payments','payment_requests','payment_request_lines','invoices','invoice_lines','invoice_shipments','payment_allocations','vouchers','voucher_lines','financial_permissions','petty_cash_ledger','voucher_line_profit']},
{id:'declarations',label:'Declaration / EPL / Kottaj',icon:FileCog,res:['declarations','declaration_checklist_items','declaration_exit_checklist_items']},
{id:'exit',label:'Exit',icon:ArrowLeft,res:['exit']},
{id:'ai',label:'AI Gateway / Core',icon:Bot,res:['ai_gateway','ai_knowledge_documents','ai_knowledge_chunks','knowledge_sources','knowledge_chunks']},
{id:'print',label:'Print / PDF',icon:FileCog,res:['templates']},
{id:'offline',label:'Offline Queue',icon:RefreshCw,res:[]},
{id:'org',label:'Organization Settings',icon:Settings2,res:['org','org_settings','user_settings','finance_settings']}
] as const;

export const AdvancedSettingsPage:React.FC=()=>{
const{profile}=useAuth();const owner=profile?.role==='owner';const[section,setSection]=useState<(typeof sections)[number]['id']>('users');const[resource,setResource]=useState<ResourceKey>('profiles');const[message,setMessage]=useState('');const[logsOpen,setLogsOpen]=useState(false);const current=useMemo(()=>sections.find(s=>s.id===section)!,[section]);
useEffect(()=>{if(current.res[0])setResource(current.res[0] as ResourceKey)},[section]);
if(!owner)return <main dir="rtl" className="p-6"><div className="max-w-xl mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 p-7 text-center"><ShieldCheck size={28} className="mx-auto text-red-500"/><h1 className="font-black text-lg mt-3">دسترسی غیرمجاز</h1><p className="text-xs app-muted mt-2">Owner Console فقط برای Owner قابل دسترسی است.</p></div></main>;
return <main dir="rtl" className="min-h-screen p-4 md:p-6"><div className="max-w-[1800px] mx-auto"><header className="flex items-center justify-between gap-3 mb-4"><div><div className="text-[10px] app-muted">OWNER CONTROL PLANE</div><h1 className="text-2xl font-black mt-1">تنظیمات تخصصی</h1><p className="text-xs app-muted mt-1">Full CRUD تحت Session واقعی Owner، با مرزهای Audit و Data Integrity</p></div><span className="px-3 py-2 rounded-xl border app-border text-[10px]"><Lock size={13} className="inline ml-1"/> OWNER ONLY</span></header>{message&&<div className="mb-4 rounded-xl border app-border bg-[var(--surface-2)] p-3 text-xs">{message}</div>}<div className="grid xl:grid-cols-[250px_1fr] gap-4"><aside className="rounded-2xl border app-border bg-[var(--surface)] p-2 h-fit xl:sticky xl:top-4"><div className="px-3 py-2 text-[10px] app-muted">۱۴ بخش مدیریتی</div>{sections.map(s=>{const I=s.icon;return <button key={s.id} onClick={()=>setSection(s.id)} className={'w-full text-right flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold '+(section===s.id?'bg-[var(--primary)] text-white':'hover:bg-[var(--surface-2)]')}><I size={15}/>{s.label}</button>})}<button onClick={()=>setLogsOpen(true)} className="w-full text-right mt-2 pt-3 border-t app-border text-[10px] app-muted">سوابق / Logs ← فقط خواندنی</button></aside><div className="min-w-0">{logsOpen?<LogsPanel onMessage={setMessage}/>:<>{current.res.length>1&&<div className="flex gap-2 overflow-x-auto pb-2">{current.res.map(r=><button key={r} onClick={()=>setResource(r as ResourceKey)} className={'px-3 py-2 rounded-xl border app-border text-xs font-bold whitespace-nowrap '+(resource===r?'bg-[var(--primary)] text-white':'bg-[var(--surface)]')}>{resourceLabels[r as ResourceKey]}</button>)}</div>}{section==='users'?<UsersPanel onMessage={setMessage}/>:section==='offline'?<OfflinePanel/>:section==='ai'?<><ResourcePanel resource={resource} onMessage={setMessage}/><div className="mt-3"><LogsPanel onMessage={setMessage}/></div></>:<><ResourcePanel resource={resource} onMessage={setMessage}/></>}</>}</div></div></div>{logsOpen&&<button onClick={()=>setLogsOpen(false)} className="fixed left-6 top-20 z-[150] rounded-xl border app-border bg-[var(--surface)] px-3 py-2 text-xs font-bold">بازگشت به Console</button>}</main>;
};
