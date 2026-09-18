export const CASE_WORKFLOW=[
 {key:'draft',label:'پیش‌نویس',action:'تکمیل اطلاعات اولیه'},
 {key:'registration_order',label:'ثبت سفارش',action:'ثبت/کنترل ثبت سفارش'},
 {key:'documents_ready',label:'اسناد آماده',action:'کنترل اسناد'},
 {key:'epl_submitted',label:'اظهار ثبت شد',action:'ثبت اظهار در EPL'},
 {key:'kottaj_received',label:'کوتاژ دریافت شد',action:'ثبت کوتاژ و مسیر'},
 {key:'path',label:'مسیر گمرکی',action:'انجام اقدام اعلام‌شده توسط گمرک'},
 {key:'valuation',label:'ارزش‌گذاری',action:'پیگیری ارزش‌گذاری'},
 {key:'duties_calculation',label:'حقوق و عوارض',action:'پیگیری محاسبه/اعلام گمرک'},
 {key:'exit_permit',label:'مجوز خروج',action:'انجام مراحل خروج'},
 {key:'completed',label:'تکمیل‌شده',action:'بایگانی عملیاتی'}
] as const;
export const getCaseNextAction=(status:string)=>CASE_WORKFLOW.find(x=>x.key===status)?.action||'ادامه پیگیری پرونده';
