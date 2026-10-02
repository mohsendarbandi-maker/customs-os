import { addJalaliDays, jalaliMonthLength, normalizeFaText, toJalali, toGregorian, zonedJalaliToDate, type JalaliDate } from '../../lib/jalali';

export type ReminderKind='document'|'shipment'|'finance'|'other';
export type ReminderPriority='low'|'normal'|'high'|'urgent';
export type ReminderStatus='open'|'done'|'dismissed';
export type ReminderEntityType='customs_documents'|'shipment_documents'|'documents'|'shipments'|'cases'|'finance_invoices'|'clients';
export interface Reminder{
 id:string; organization_id:string|null; case_id:string|null; shipment_id:string|null; title:string; description:string|null; due_at:string;
 priority:ReminderPriority; status:ReminderStatus; created_by:string|null; completed_at:string|null; created_at:string; updated_at:string;
 due_precision:string; source_key:string|null; is_system:boolean; kind:ReminderKind; entity_type:ReminderEntityType|null; entity_id:string|null;
 assignee_id:string|null; visibility:'private'|'team'; all_day:boolean; timezone:string; alarm_offsets_min:number[]; recurrence_rule:string|null;
 recurrence_until:string|null; series_id:string|null; occurrence_key:string|null; snoozed_until:string|null; snooze_count:number;
 tags:string[]; notes:string|null; client_uuid:string|null; deleted_at:string|null; completed_by:string|null;
}
export interface ParsedReminder{title:string;dueAt:Date;priority:ReminderPriority;kind:ReminderKind;recurrenceRule:string|null;linkQuery:string|null;assigneeName:string|null;confidence:number;alarmOffsets:number[]}
const months=new Map(['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'].map((x,i)=>[x,i+1]));
const weekdayCodes=new Map([['شنبه','SA'],['یکشنبه','SU'],['دوشنبه','MO'],['سه شنبه','TU'],['سه‌شنبه','TU'],['چهارشنبه','WE'],['پنجشنبه','TH'],['جمعه','FR']]);
const addMinutes=(d:Date,m:number)=>new Date(d.getTime()+m*60000);
const local= (d:Date)=>toJalali(d);
const timeParts=(raw:string)=>{const m=raw.match(/(?:ساعت\s*)?(\d{1,2})(?::(\d{1,2}))?\s*(صبح|عصر|شب|ظهر)?/);if(!m)return null;let h=Number(m[1]),minute=Number(m[2]??0);if(minute>59||h>23)return null;if(m[3]==='صبح'&&h===12)h=0;if((m[3]==='عصر'||m[3]==='شب')&&h<12)h+=12;return{h,minute};};
const nextYearIfPast=(j:JalaliDate,n:JalaliDate)=>j.month<n.month||(j.month===n.month&&j.day<n.day)?j.year+1:j.year;
const weekdayOf=(d:Date)=>{const j=local(d),g=toGregorian(j.year,j.month,j.day);return ['SU','MO','TU','WE','TH','FR','SA'][new Date(Date.UTC(g.gy,g.gm-1,g.gd)).getUTCDay()];};

export function parseReminder(input:string,now=new Date()):ParsedReminder{
 let text=normalizeFaText(input),source=text,priority:ReminderPriority='normal',kind:ReminderKind='other',recurrenceRule:string|null=null,linkQuery:string|null=null,assigneeName:string|null=null;
 let confidence=.25;
 if(text.includes('!!')){priority='urgent';text=text.replace(/!!/g,' ');confidence+=.1;}
 else if(text.includes('!')){priority='high';text=text.replace(/!/g,' ');confidence+=.05;}
 const tags=[...text.matchAll(/#([^\s#]+)/g)].map(x=>x[1]); if(tags.includes('اسناد'))kind='document';if(tags.includes('محموله'))kind='shipment';if(tags.includes('مالی'))kind='finance';if(tags.includes('سایر'))kind='other';text=text.replace(/#[^\s#]+/g,' ');
 const at=text.match(/@([^\s@/]+)/);if(at){assigneeName=at[1];text=text.replace(at[0],' ');}
 const slash=text.match(/\/([^\s]+)/);if(slash){linkQuery=slash[1];text=text.replace(slash[0],' ');}
 const weekly=text.match(/هر\s+(شنبه|یکشنبه|دوشنبه|سه‌شنبه|سه سه شنبه|چهارشنبه|پنجشنبه|جمعه)/);
 if(weekly){recurrenceRule='RRULE:FREQ=WEEKLY;BYDAY='+(weekdayCodes.get(weekly[1])??'MO');text=text.replace(weekly[0],' ');confidence+=.35;}
 if(/هر\s+روز/.test(text)){recurrenceRule='RRULE:FREQ=DAILY';text=text.replace(/هر\s+روز/g,' ');confidence+=.3;}
 if(/هر\s+ماه/.test(text)){recurrenceRule='RRULE:FREQ=MONTHLY;X-JALALI=1';text=text.replace(/هر\s+ماه/g,' ');confidence+=.25;}
 if(/هر\s+سال/.test(text)){recurrenceRule='RRULE:FREQ=YEARLY;X-JALALI=1';text=text.replace(/هر\s+سال/g,' ');confidence+=.25;}

 let dueAt:Date|null=null;
 const delta=text.match(/(\d+)\s*(دقیقه|ساعت|روز|هفته)\s*(?:دیگه|بعد|دیگر)/);
 if(delta){const n=Number(delta[1]),u=delta[2];dueAt=addMinutes(now,u==='دقیقه'?n:u==='ساعت'?n*60:u==='هفته'?n*10080:n*1440);text=text.replace(delta[0],' ');confidence+=.4;}
 const half=text.match(/نیم\s*ساعت\s*(?:دیگه|بعد|دیگر)/);if(half){dueAt=addMinutes(now,30);text=text.replace(half[0],' ');confidence+=.4;}

 const todayText=/امروز/.test(text),tomorrowText=/فردا/.test(text),afterTomorrow=/پس‌فردا/.test(text);
 if(afterTomorrow){dueAt=addJalaliDays(now,2);text=text.replace(/پس‌فردا/g,' ');confidence+=.3;}
 else if(tomorrowText){dueAt=addJalaliDays(now,1);text=text.replace(/فردا/g,' ');confidence+=.25;}
 else if(todayText){dueAt=now;text=text.replace(/امروز/g,' ');confidence+=.2;}

 const specialTodayEvening=/امروز\s+عصر/.test(source);
 const specialTomorrowMorning=/فردا\s+صبح/.test(source);
 if(specialTodayEvening){const j=local(now);dueAt=zonedJalaliToDate(j.year,j.month,j.day,17,0);text=text.replace(/امروز\s+عصر/g,' ');confidence+=.25;}
 if(specialTomorrowMorning){const j=local(addJalaliDays(now,1));dueAt=zonedJalaliToDate(j.year,j.month,j.day,9,0);text=text.replace(/فردا\s+صبح/g,' ');confidence+=.25;}

 const weekend=/آخر\s*هفته/.test(text);
 if(weekend){let d=addJalaliDays(now,1);for(let i=0;i<7;i++){if(weekdayOf(d)==='FR'){const j=local(d);dueAt=zonedJalaliToDate(j.year,j.month,j.day,17,0);break;}d=addJalaliDays(d,1);}text=text.replace(/آخر\s*هفته/g,' ');confidence+=.25;}

 const dateMatch=text.match(/(\d{1,2})\s+([^\s\d]+)/);
 if(dateMatch&&months.has(dateMatch[2])){const month=months.get(dateMatch[2]) as number,day=Number(dateMatch[1]),year=nextYearIfPast({year:local(now).year,month,day},local(now));if(day<=jalaliMonthLength(year,month)){dueAt=zonedJalaliToDate(year,month,day,9,0);text=text.replace(dateMatch[0],' ');confidence+=.3;}}
 const numeric=text.match(/(\d{3,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
 if(numeric){dueAt=zonedJalaliToDate(Number(numeric[1]),Number(numeric[2]),Number(numeric[3]),9,0);text=text.replace(numeric[0],' ');confidence+=.3;}

 const tm=text.match(/(?:ساعت\s*)?\d{1,2}(?::\d{1,2})?\s*(?:صبح|عصر|شب|ظهر)/)||text.match(/(?:ساعت\s*)?\d{1,2}:\d{2}/);
 if(tm){const t=timeParts(tm[0]);if(t){const base=dueAt??now,j=local(base);let candidate=zonedJalaliToDate(j.year,j.month,j.day,t.h,t.minute);if(!dateMatch&&!numeric&&!todayText&&!tomorrowText&&!afterTomorrow&&!specialTodayEvening&&!specialTomorrowMorning&&candidate<=now)candidate=addJalaliDays(candidate,1);dueAt=candidate;text=text.replace(tm[0],' ');confidence+=.25;}}
 if(!dueAt)dueAt=addMinutes(now,60);
 let title=normalizeFaText(text);
 title=title.replace(/\s+/g,' ').trim()||'یادآور جدید';
 return{title,dueAt,priority,kind,recurrenceRule,linkQuery,assigneeName,confidence:Math.min(1,confidence),alarmOffsets:[0]};
}
export function parseRRule(rule:string|null){if(!rule)return null;const result:Record<string,string>= {};for(const item of rule.replace(/^RRULE:/,'').split(';')){const [k,v]=item.split('=');if(k&&v)result[k]=v;}return result;}
export function recurrenceNext(from:Date,rule:string|null):Date|null{
 const r=parseRRule(rule);if(!r?.FREQ)return null;const j=local(from),minutes=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(from);const get=(t:string)=>Number(minutes.find(x=>x.type===t)?.value??0);const h=get('hour'),m=get('minute');const interval=Math.max(1,Number(r.INTERVAL??1));
 if(r.FREQ==='DAILY')return addJalaliDays(from,interval);
 if(r.FREQ==='WEEKLY'){const wanted=(r.BYDAY??'').split(',').filter(Boolean);let d=addJalaliDays(from,1);const limit=Math.max(8,7*interval+7);for(let i=0;i<limit;i++){if(wanted.length===0||wanted.includes(weekdayOf(d))){const q=local(d);return zonedJalaliToDate(q.year,q.month,q.day,h,m);}d=addJalaliDays(d,1);}return null;}
 if(r.FREQ==='MONTHLY'){const index=j.month-1+interval*Number(1),year=j.year+Math.floor(index/12),month=(index%12)+1,day=Math.min(j.day,jalaliMonthLength(year,month));return zonedJalaliToDate(year,month,day,h,m);}
 if(r.FREQ==='YEARLY'){const year=j.year+interval,day=Math.min(j.day,jalaliMonthLength(year,j.month));return zonedJalaliToDate(year,j.month,day,h,m);}
 return null;
}
export const tomorrowNine=(date=new Date())=>{const j=local(addJalaliDays(date,1));return zonedJalaliToDate(j.year,j.month,j.day,9,0);};
export async function resolveLink(query:string|null,kind:ReminderKind){if(!query)return null;const {supabase} = await import('../../lib/supabase');const q=normalizeFaText(query);const table=kind==='finance'?'finance_invoices':kind==='document'?'customs_documents':'shipments';const fields=table==='shipments'?'bill_of_lading_no,display_name':table==='customs_documents'?'original_name,display_name,document_number':'invoice_no';const {data}=await supabase.from(table).select('id,case_id,shipment_id').or(fields.split(',').map(f=>f+'.ilike.%'+q+'%').join(',')).limit(1);const row=data?.[0] as {id:string;case_id?:string|null;shipment_id?:string|null}|undefined;if(!row)return null;return {entity_type:table as ReminderEntityType,entity_id:row.id,case_id:row.case_id??null,shipment_id:row.shipment_id??(table==='shipments'?row.id:null)};}
export async function resolveAssignee(name:string|null){if(!name)return null;const {supabase} = await import('../../lib/supabase');const q=normalizeFaText(name);const {data}=await supabase.from('profiles').select('id,full_name').eq('is_active',true).neq('role','client').ilike('full_name','%'+q+'%').limit(1);return (data?.[0] as {id:string}|undefined)?.id??null;}
