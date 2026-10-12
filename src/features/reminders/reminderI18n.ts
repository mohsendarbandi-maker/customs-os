import React from 'react';
export type ReminderLanguage='fa'|'en';
const ENGLISH:Record<string,string>={
 'یادآورها':'Reminders',
 'اپ مستقل · Customs OS':'Standalone app · Customs OS',
 'تاریخ شمسی و متصل به عملیات':'Jalali dates · connected to operations',
 'کل یادآورها':'All reminders',
 'همهٔ وضعیت‌ها':'All statuses',
 'موعد امروز':'Due today',
 'نیازمند اقدام امروز':'Needs attention today',
 'معوق':'Overdue',
 'موعد گذشته و باز':'Past due and open',
 'برنامه‌ریزی‌شده':'Scheduled',
 'موعدهای پیشِ‌رو':'Upcoming reminders',
 'انجام‌شده':'Completed',
 'کارهای تکمیل‌شده':'Completed tasks',
 'امروز':'Today',
 'فردا':'Tomorrow',
 'همه':'All',
 'به من واگذار شده':'Assigned to me',
 'اسناد':'Documents',
 'محموله / پرونده':'Shipment / case',
 'مالی':'Finance',
 'سایر':'Other',
 'کم':'Low',
 'عادی':'Normal',
 'زیاد':'High',
 'فوری':'Urgent',
 'جستجو در یادآورها...':'Search reminders…',
 'تلاش دوباره':'Try again',
 'بارگذاری دوباره':'Reload',
 'انتخاب شده':'selected',
 'انجام شد':'Mark done',
 '۱۰ دقیقه':'10 min',
 'پنهان‌کردن':'Hide',
 'لغو':'Cancel',
 'بازگرداندن':'Restore',
 'پرونده مرتبط':'Linked case',
 'محموله مرتبط':'Linked shipment',
 'پرونده و محموله مرتبط':'Linked case and shipment',
 'به من':'Assigned to me',
 '۱۰ دقیقه بعد':'In 10 minutes',
 '۱ ساعت بعد':'In 1 hour',
 'فردا ۹ صبح':'Tomorrow at 9 AM',
 'ویرایش':'Edit',
 'در این جستجو یا دسته‌بندی یادآوری پیدا نشد':'No reminders match this search or category',
 'برای امروز یادآوری ثبت نشده است':'Nothing scheduled for today',
 'یادآوری برنامه‌ریزی‌شده‌ای وجود ندارد':'No upcoming reminders',
 'مورد معوقی برای نمایش وجود ندارد':'No overdue reminders',
 'یادآور انجام‌شده‌ای پیدا نشد':'No completed reminders',
 'یادآوری واگذارشده‌ای پیدا نشد':'No reminders assigned to you',
 'هنوز یادآوری قابل‌نمایشی وجود ندارد':'No reminders to show yet',
 'ممکن است این نما خالی باشد؛ برای بررسی همهٔ موارد، فیلتر و جستجو را پاک کنید.':'This view may be empty. Clear filters and search to see all reminders.',
 'نمایش همهٔ یادآورها':'Show all reminders',
 'از':'of',
 'یادآور جدید':'New reminder',
 'ثبت هوشمند':'Smart capture',
 'پیش‌نمایش هوشمند':'Smart preview',
 'نوشتن کار، تاریخ یا دستور…':'Describe a task, date, or instruction…',
 'مثلاً: فردا ساعت ۹ صبح پیگیری ترخیص کوتاژ ۱۲۳':'e.g. Check customs entry tomorrow at 9 AM',
 'سررسید اختیاری':'Optional due date',
 'افزودن سررسید':'Add due date',
 'بدون سررسید':'No due date',
 'تاریخ انتخاب شد':'Date selected',
 'پاک‌کردن تاریخ':'Clear date',
 'انتخاب تاریخ':'Choose date',
 'ثبت یادآور':'Create reminder',
 'در حال ثبت…':'Creating…',
 'برای ثبت سریع، متن را بنویسید؛ تاریخ فقط وقتی تعیین می‌شود که انتخاب یا در متن مشخص شده باشد.':'Describe the task. A due date is set only if chosen or recognized in your text.',
 'بستن فرم':'Close form',
 'بازگشت به سامانه':'Back to Customs OS',
 'تنظیم اعلان‌ها':'Notification settings',
 'تازه‌سازی یادآورها':'Refresh reminders',
 'فارسی':'Persian',
 'انگلیسی':'English',
 'خلاصهٔ عملیاتی یادآورها':'Reminder overview',
 'انتخاب تاریخ و زمان':'Choose date and time',
 'ذخیره‌سازی در سامانه همیشه به زمان هماهنگ جهانی انجام می‌شود.':'Dates are stored as UTC instants and displayed in Tehran time.',
 'بستن':'Close',
 'امروز عصر':'Today evening',
 'فردا صبح':'Tomorrow morning',
 'آخر هفته':'This weekend',
 'هفته بعد':'Next week',
 'ماه بعد':'Next month',
 'تمام‌روز':'All day',
 'تأیید':'Apply date',
 'ویرایش یادآور':'Edit reminder',
 'تغییر':'Change',
 'اولویت':'Priority',
 'دسته':'Category',
 'مسئول':'Assignee',
 'من':'Me',
 'هشدارها':'Alerts',
 'سر وقت':'At due time',
 '۱۰ دقیقه قبل':'10 minutes before',
 '۱ ساعت قبل':'1 hour before',
 '۱ روز قبل':'1 day before',
 'پیوند به محموله، پرونده یا سند':'Link a shipment, case, or document',
 'حذف پیوند':'Remove link',
 'چک‌لیست':'Checklist',
 'ذخیره تغییرات':'Save changes',
 'انصراف':'Cancel',
 'اعلان‌ها':'Notifications',
 'اعلان واقعی دستگاه‌های شما':'Push notifications for your devices',
 'برای حساب صاحب کالا اعلان داخلی فعال نمی‌شود.':'Internal push notifications are unavailable for client accounts.',
 'وضعیت اعلان':'Notification status',
 'فعال':'Enabled',
 'فعال نیست':'Not enabled',
 'غیرفعال‌سازی':'Disable',
 'فعال‌سازی':'Enable',
 'ارسال اعلان آزمایشی':'Send test notification',
 'پنهان کردن متن اعلان':'Hide notification content',
 'به‌جای عنوان، متن عمومی نمایش داده می‌شود.':'A generic message is shown instead of the reminder title.',
 'ساعات سکوت · به وقت تهران':'Quiet hours · Tehran time',
 'به‌جز اعلان‌های فوری، در این بازه اعلان ارسال نمی‌شود.':'Non-urgent notifications are paused during this period.',
 'شروع':'Start',
 'پایان':'End',
 'دستگاه‌ها':'Devices',
 'آیفون':'iPhone',
 'اندروید':'Android',
 'رایانه':'Computer',
 'هنوز دستگاهی ثبت نشده است.':'No devices registered yet.',
 'اطلاعات ثبت‌شده معتبر نیست':'The submitted information is invalid.',
 'اطلاعات واردشده معتبر نیست':'The entered information is invalid.',
 'دسترسی مجاز نیست':'Access denied.',
 'ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره تلاش کنید':'Could not reach the server. Check your connection and try again.',
 'نشست ورود منقضی شده است؛ دوباره وارد سامانه شوید':'Your session expired. Please sign in again.',
 'ساختار پایگاه داده با نسخهٔ برنامه هماهنگ نیست؛ مهاجرت‌های یادآورها باید بررسی شوند':'The database schema does not match this app version.',
 'ساختار جدول یادآورها در کش API به‌روز نیست':'The reminders schema cache is outdated.',
 'بارگذاری یا ذخیرهٔ یادآورها انجام نشد؛ اتصال، دسترسی و ساختار پایگاه داده را بررسی کنید':'Reminders could not be loaded or saved. Check connectivity and permissions.',
 'یادآور ذخیره نشد؛ دسترسی یا وجود آن را بررسی کنید':'The reminder was not saved. Check your access.',
 'یادآور تغییر نکرد؛ ممکن است دسترسی لازم وجود نداشته باشد.':'The reminder was not changed. You may not have permission.',
 'یادآور به سطل پنهان منتقل شد.':'Reminder moved to hidden items.',
 'تشخیص گفتار در این مرورگر پشتیبانی نمی‌شود.':'Speech recognition is not supported in this browser.',
 'تشخیص گفتار انجام نشد.':'Speech recognition failed.',
 'سازمان فعال برای جستجوی موارد مرتبط پیدا نشد.':'An active organization was not found for linked-item search.',
 'برخی انواع مورد مرتبط به‌دلیل محدودیت دسترسی یا خطای جستجو نمایش داده نشدند.':'Some linked-item types were unavailable due to access or search errors.',
 'جستجوی موارد مرتبط انجام نشد؛ اتصال و دسترسی را بررسی کنید.':'Linked-item search failed. Check connectivity and permissions.',
 'شماره بارنامه، پرونده، سند، فاکتور یا صاحب کالا':'Bill of lading, case, document, invoice, or client',
 'برچسب‌ها با فاصله':'Separate tags with spaces',
 'مورد جدید':'New item',
 'یادداشت':'Notes',
 'ثبت سفارش ':'Order no. ',
 'پروفورما ':'Pro forma ',
 'فاکتور ':'Invoice ',
 'موجودیت پیوندشده':'Linked item',
 'سند گمرکی':'Customs document',
 'سند محموله':'Shipment document',
 'سند پرونده':'Case document',
 'فاکتور مالی':'Finance invoice',
 'صاحب کالا':'Client',
 'ادامه':'Continue',
 'ورود به سامانه':'Sign in',
 'ورود به یادآورها':'Sign in to Reminders',
 'ایمیل':'Email',
 'رمز عبور':'Password',
 'در حال ورود…':'Signing in…',
 'ورود ناموفق بود. اطلاعات ورود را بررسی کنید.':'Sign-in failed. Check your credentials.',
 'تاریخ':'Date',
 'زمان':'Time',
 'Just now':'همین الان',
 'بدون موعد':'No due date',
 'نیاز به تعیین تاریخ ندارد':'No date required',
 'ساعت':'Hour',
 'دقیقه':'Minute',
 'سررسید':'Due date',
 'پرونده':'Case',
 'محموله':'Shipment',
 'سند':'Document',
 'یادآور پیدا نشد یا مجوز تغییر آن وجود ندارد.':'Reminder not found or permission to change it was denied.',
 'در حال بارگذاری بخش…':'Loading section…',
 'هر روز':'Every day',
 'هر هفته':'Every week',
 'هر ماه':'Every month',
 'هر سال':'Every year',
 'عنوان یادآور الزامی است':'A reminder title is required',
 'پیوند محموله یا مسئول ذخیره نشد.':'The shipment link or assignee was not saved.',
 'انتخاب‌شده':'Selected',
 'در حال ذخیره…':'Saving…',
 'برگردان':'Undo',
 'اعلان آزمایشی':'Test notification',
 'نسخه جدید آماده است':'A new version is ready',
 'به‌روزرسانی':'Update',
 'اتصال اینترنت قطع است؛ ثبت یادآور جدید در صف می‌ماند؛ ویرایش، تغییر وضعیت و اعلان‌ها به اتصال اینترنت نیاز دارند.':'You are offline. New reminders are queued; editing, status changes, and notifications need an internet connection.'
};
export const reminderText=(value:string,language:ReminderLanguage):string=>{
 const normalized=value.replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
 if(language==='fa')return normalized;
 if(!normalized)return '';
 const exact=ENGLISH[normalized];
 if(exact)return exact;
 const summary=normalized.match(/^(.+) مورد · تاریخ شمسی و متصل به عملیات$/);
 if(summary)return summary[1]+' reminders · Jalali dates linked to operations';
 const ordered=Object.keys(ENGLISH).filter(key=>key.length>=7).sort((a,b)=>b.length-a.length);
 let translated=normalized;
 for(const key of ordered)if(translated.includes(key))translated=translated.split(key).join(ENGLISH[key]);
 return translated;
};
function translateNode(node:React.ReactNode,language:ReminderLanguage):React.ReactNode{
 if(typeof node==='string')return reminderText(node,language);
 if(node===null||node===undefined||typeof node==='boolean'||typeof node==='number')return node;
 if(Array.isArray(node))return node.map(child=>translateNode(child,language));
 if(React.isValidElement(node)){
  const props=node.props as Record<string,unknown>;
  const next:Record<string,unknown>={};
  if(Object.prototype.hasOwnProperty.call(props,'children'))next.children=translateNode(props.children as React.ReactNode,language);
  for(const name of ['placeholder','title','aria-label','aria-description','alt']){
   const value=props[name];
   if(typeof value==='string')next[name]=reminderText(value,language);
  }
  if(language==='en'&&typeof props.className==='string'){
   next.className=props.className
    .replace(/\btext-right\b/g,'text-left').replace(/\btext-left\b/g,'text-right')
    .replace(/\bright-(\d+)\b/g,'__LEFT_$1__').replace(/\bleft-(\d+)\b/g,'right-$1').replace(/__LEFT-(\d+)__/g,'left-$1')
    .replace(/\bpr-(\d+)\b/g,'__PL-$1__').replace(/\bpl-(\d+)\b/g,'pr-$1').replace(/__PL-(\d+)__/g,'pl-$1')
    .replace(/\bmr-(\d+)\b/g,'__ML-$1__').replace(/\bml-(\d+)\b/g,'mr-$1').replace(/__ML-(\d+)__/g,'ml-$1')
  }
  return React.cloneElement(node as React.ReactElement<any>,next);
 }
 return node;
}
export const ReminderLocaleTree:React.FC<{language:ReminderLanguage;children:React.ReactNode}>=({language,children})=>React.createElement(React.Fragment,null,translateNode(children,language));
export function readReminderLanguage():ReminderLanguage{try{return localStorage.getItem('customs-reminders-language-v1')==='en'?'en':'fa';}catch{return'fa';}}
export function saveReminderLanguage(language:ReminderLanguage):void{try{localStorage.setItem('customs-reminders-language-v1',language);}catch{}}
export function formatReminderDate(date:Date,language:ReminderLanguage):string{return new Intl.DateTimeFormat(language==='fa'?'fa-IR-u-ca-persian':'en-US-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric',month:'long',day:'numeric'}).format(date);}
export function formatReminderDateTime(date:Date,language:ReminderLanguage):string{const d=formatReminderDate(date,language);const time=new Intl.DateTimeFormat(language==='fa'?'fa-IR':'en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',hour12:language==='fa'}).format(date);return d+' · '+time;}
export function formatReminderRelative(date:Date,language:ReminderLanguage,now=new Date()):string{const seconds=Math.round((date.getTime()-now.getTime())/1000);if(Math.abs(seconds)<45)return language==='fa'?'همین الان':'Just now';const unit:Intl.RelativeTimeFormatUnit=Math.abs(seconds)>=86400?'day':Math.abs(seconds)>=3600?'hour':'minute';const divisor=unit==='day'?86400:unit==='hour'?3600:60;return new Intl.RelativeTimeFormat(language==='fa'?'fa':'en',{numeric:'auto'}).format(Math.round(seconds/divisor),unit);}
export function reminderNumber(value:number,language:ReminderLanguage):string{return new Intl.NumberFormat(language==='fa'?'fa-IR':'en-US').format(value);}
