import { addJalaliDays, jalaliMonthLength, normalizeFaText, toJalali, toGregorian, zonedJalaliToDate, type JalaliDate } from '../../lib/jalali';

export type ReminderKind='document'|'shipment'|'finance'|'other';
export type ReminderPriority='low'|'normal'|'high'|'urgent';
export type ReminderStatus='open'|'done'|'dismissed';
export type ReminderEntityType='customs_documents'|'shipment_documents'|'documents'|'shipments'|'cases'|'finance_invoices'|'clients';
export interface Reminder{
 id:string; organization_id:string|null; case_id:string|null; shipment_id:string|null; title:string; description:string|null; due_at:string|null;
 priority:ReminderPriority; status:ReminderStatus; created_by:string|null; completed_at:string|null; created_at:string; updated_at:string;
 due_precision:string; source_key:string|null; is_system:boolean; kind:ReminderKind; entity_type:ReminderEntityType|null; entity_id:string|null;
 assignee_id:string|null; visibility:'private'|'team'; all_day:boolean; timezone:string; alarm_offsets_min:number[]; recurrence_rule:string|null;
 recurrence_until:string|null; series_id:string|null; occurrence_key:string|null; snoozed_until:string|null; snooze_count:number;
 tags:string[]; notes:string|null; client_uuid:string|null; deleted_at:string|null; completed_by:string|null;
}
export interface ParsedReminder{title:string;dueAt:Date|null;priority:ReminderPriority;kind:ReminderKind;recurrenceRule:string|null;linkQuery:string|null;assigneeName:string|null;confidence:number;alarmOffsets:number[]}
const months=new Map(['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'].map((x,i)=>[x,i+1]));
const weekdayCodes=new Map([['شنبه','SA'],['یکشنبه','SU'],['دوشنبه','MO'],['سه شنبه','TU'],['سه‌شنبه','TU'],['چهارشنبه','WE'],['پنجشنبه','TH'],['جمعه','FR']]);
const addMinutes=(d:Date,m:number)=>new Date(d.getTime()+m*60000);
const local= (d:Date)=>toJalali(d);
const timeParts=(raw:string)=>{const m=raw.match(/(?:ساعت\s*|at\s*)?(\d{1,2})(?::(\d{1,2}))?\s*(صبح|عصر|شب|ظهر|am|pm|morning|afternoon|evening)?/i);if(!m)return null;let h=Number(m[1]),minute=Number(m[2]??0);if(minute>59||h>23)return null;const period=(m[3]??'').toLowerCase();if((period==='صبح'||period==='am'||period==='morning')&&h===12)h=0;if((period==='عصر'||period==='شب'||period==='pm'||period==='afternoon'||period==='evening')&&h<12)h+=12;return{h,minute};};
const nextYearIfPast=(j:JalaliDate,n:JalaliDate)=>j.month<n.month||(j.month===n.month&&j.day<n.day)?j.year+1:j.year;
const weekdayOf=(d:Date)=>{const j=local(d),g=toGregorian(j.year,j.month,j.day);return ['SU','MO','TU','WE','TH','FR','SA'][new Date(Date.UTC(g.gy,g.gm-1,g.gd)).getUTCDay()];};

export function parseReminder(input:string,now=new Date()):ParsedReminder{
 let text=normalizeFaText(input),priority:ReminderPriority='normal',kind:ReminderKind='other',recurrenceRule:string|null=null,linkQuery:string|null=null,assigneeName:string|null=null,confidence=.25;
 if(text.includes('!!')){priority='urgent';text=text.replace(/!!/g,' ');confidence+=.1;}else if(text.includes('!')){priority='high';text=text.replace(/!/g,' ');confidence+=.05;}
 const tags=[...text.matchAll(/#([^\s#]+)/g)].map(x=>x[1].toLowerCase());
 if(tags.some(x=>['اسناد','اسنادگمرکی','documents'].includes(x)))kind='document';
 if(tags.some(x=>['محموله','shipment','shipments'].includes(x)))kind='shipment';
 if(tags.some(x=>['مالی','finance','invoice'].includes(x)))kind='finance';
 if(tags.some(x=>['سایر','other'].includes(x)))kind='other';
 text=text.replace(/#[^\s#]+/g,' ');
 const at=text.match(/@([^\s@/]+)/);if(at){assigneeName=at[1];text=text.replace(at[0],' ');}
 const slash=text.match(/\/([^\s]+)/);if(slash){linkQuery=slash[1];text=text.replace(slash[0],' ');}
 const weekdayCodesByName=new Map<string,string>([['شنبه','SA'],['یکشنبه','SU'],['دوشنبه','MO'],['سه شنبه','TU'],['سه‌شنبه','TU'],['چهارشنبه','WE'],['پنجشنبه','TH'],['جمعه','FR'],['sunday','SU'],['monday','MO'],['tuesday','TU'],['wednesday','WE'],['thursday','TH'],['friday','FR'],['saturday','SA']]);
 const weekly=text.match(/هر\s+(شنبه|یکشنبه|دوشنبه|سه‌شنبه|سه سه شنبه|چهارشنبه|پنجشنبه|جمعه)/)||text.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
 if(weekly){recurrenceRule='RRULE:FREQ=WEEKLY;BYDAY='+(weekdayCodesByName.get(weekly[1])||weekdayCodesByName.get(weekly[1].toLowerCase())||'MO');text=text.replace(weekly[0],' ');confidence+=.35;}
 if(/هر\s+روز|\bevery\s+day\b/i.test(text)){recurrenceRule='RRULE:FREQ=DAILY';text=text.replace(/هر\s+روز|\bevery\s+day\b/gi,' ');confidence+=.3;}
 if(/هر\s+هفته|\bevery\s+week\b/i.test(text)){recurrenceRule='RRULE:FREQ=WEEKLY';text=text.replace(/هر\s+هفته|\bevery\s+week\b/gi,' ');confidence+=.25;}
 if(/هر\s+ماه|\bevery\s+month\b/i.test(text)){recurrenceRule='RRULE:FREQ=MONTHLY;X-JALALI=1';text=text.replace(/هر\s+ماه|\bevery\s+month\b/gi,' ');confidence+=.25;}
 if(/هر\s+سال|\bevery\s+year\b/i.test(text)){recurrenceRule='RRULE:FREQ=YEARLY;X-JALALI=1';text=text.replace(/هر\s+سال|\bevery\s+year\b/gi,' ');confidence+=.25;}
 let dueAt:Date|null=null;
 const delta=text.match(/(\d+)\s*(دقیقه|ساعت|روز|هفته)\s*(?:دیگه|بعد|دیگر)/);
 if(delta){const n=Number(delta[1]),u=delta[2];dueAt=addMinutes(now,u==='دقیقه'?n:u==='ساعت'?n*60:u==='هفته'?n*10080:n*1440);text=text.replace(delta[0],' ');confidence+=.4;}
 const englishDelta=text.match(/\bin\s+(\d+)\s+(minutes?|hours?|days?|weeks?)\b/i);
 if(englishDelta){const n=Number(englishDelta[1]),u=englishDelta[2].toLowerCase();dueAt=addMinutes(now,u.startsWith('minute')?n:u.startsWith('hour')?n*60:u.startsWith('week')?n*10080:n*1440);text=text.replace(englishDelta[0],' ');confidence+=.4;}
 const half=text.match(/نیم\s*ساعت\s*(?:دیگه|بعد|دیگر)/),englishHalf=text.match(/\b(?:in\s+)?half\s+an?\s+hour\b/i);
 if(half){dueAt=addMinutes(now,30);text=text.replace(half[0],' ');confidence+=.4;}
 if(englishHalf){dueAt=addMinutes(now,30);text=text.replace(englishHalf[0],' ');confidence+=.4;}
 const specialTodayEvening=text.match(/امروز\s+عصر|\btoday\s+evening\b/i),specialTomorrowMorning=text.match(/فردا\s+صبح|\btomorrow\s+morning\b/i);
 if(specialTodayEvening){const j=local(now);dueAt=zonedJalaliToDate(j.year,j.month,j.day,17,0);text=text.replace(specialTodayEvening[0],' ');confidence+=.25;}
 else if(specialTomorrowMorning){const j=local(addJalaliDays(now,1));dueAt=zonedJalaliToDate(j.year,j.month,j.day,9,0);text=text.replace(specialTomorrowMorning[0],' ');confidence+=.25;}
 else {
  const afterTomorrow=text.match(/پس‌فردا|\bday\s+after\s+tomorrow\b/i),tomorrowText=text.match(/فردا|\btomorrow\b/i),todayText=text.match(/امروز|\btoday\b/i);
  if(afterTomorrow){dueAt=addJalaliDays(now,2);text=text.replace(afterTomorrow[0],' ');confidence+=.3;}
  else if(tomorrowText){dueAt=addJalaliDays(now,1);text=text.replace(tomorrowText[0],' ');confidence+=.25;}
  else if(todayText){dueAt=now;text=text.replace(todayText[0],' ');confidence+=.2;}
 }
 const weekend=text.match(/آخر\s*هفته|\bthis\s+weekend\b|\bweekend\b/i);
 if(weekend){let d=addJalaliDays(now,1);for(let i=0;i<7;i++){const j=local(d),g=toGregorian(j.year,j.month,j.day);if(new Date(Date.UTC(g.gy,g.gm-1,g.gd)).getUTCDay()===5){dueAt=zonedJalaliToDate(j.year,j.month,j.day,17,0);break;}d=addJalaliDays(d,1);}text=text.replace(weekend[0],' ');confidence+=.25;}
 const jalaliDateMatch=text.match(/(\d{1,2})\s+([^\s\d]+)/);
 if(jalaliDateMatch&&months.has(jalaliDateMatch[2])){const month=months.get(jalaliDateMatch[2]) as number,day=Number(jalaliDateMatch[1]),year=nextYearIfPast({year:local(now).year,month,day},local(now));if(day<=jalaliMonthLength(year,month)){dueAt=zonedJalaliToDate(year,month,day,9,0);text=text.replace(jalaliDateMatch[0],' ');confidence+=.3;}}
 const monthLookup=new Map<string,number>();
 [['january','jan'],['february','feb'],['march','mar'],['april','apr'],['may'],['june','jun'],['july','jul'],['august','aug'],['september','sep','sept'],['october','oct'],['november','nov'],['december','dec']].forEach((aliases,i)=>aliases.forEach(alias=>monthLookup.set(alias,i+1)));
 const monthFirst=text.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
 const dayFirst=text.match(/\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\.?(?:,?\s+(\d{4}))?\b/i),englishDate=monthFirst||dayFirst;
 if(englishDate){const monthFirstMatch=englishDate===monthFirst,month=monthLookup.get((monthFirstMatch?englishDate[1]:englishDate[2]).toLowerCase().replace(/\.$/,''))||1,day=Number(monthFirstMatch?englishDate[2]:englishDate[1]),yearText=englishDate[3],nowParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now),get=(k:string)=>Number(nowParts.find(p=>p.type===k)?.value??0);let year=yearText?Number(yearText):get('year');const valid=(y:number)=>{const g=new Date(Date.UTC(y,month-1,day,12));return g.getUTCMonth()===month-1&&g.getUTCDate()===day;};if(valid(year)&&!yearText&&(month<get('month')||(month===get('month')&&day<get('day'))))year++;if(valid(year)){const j=toJalali(new Date(Date.UTC(year,month-1,day,12)));dueAt=zonedJalaliToDate(j.year,j.month,j.day,9,0);text=text.replace(englishDate[0],' ');confidence+=.3;}}
 const numeric=text.match(/(\d{3,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
 if(numeric){const year=Number(numeric[1]),month=Number(numeric[2]),day=Number(numeric[3]);if(year>=1700){const g=new Date(Date.UTC(year,month-1,day,12));if(g.getUTCMonth()===month-1&&g.getUTCDate()===day){const j=toJalali(g);dueAt=zonedJalaliToDate(j.year,j.month,j.day,9,0);text=text.replace(numeric[0],' ');confidence+=.3;}}else if(month>=1&&month<=12&&day<=jalaliMonthLength(year,month)){dueAt=zonedJalaliToDate(year,month,day,9,0);text=text.replace(numeric[0],' ');confidence+=.3;}}
 const tm=text.match(/(?:ساعت\s*)?\d{1,2}(?::\d{1,2})?\s*(?:صبح|عصر|شب|ظهر)/)||text.match(/(?:ساعت\s*)?\d{1,2}:\d{2}/)||text.match(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
 if(tm){const t=timeParts(tm[0]);if(t){const base=dueAt??now,j=local(base);let candidate=zonedJalaliToDate(j.year,j.month,j.day,t.h,t.minute);if(!dueAt&&candidate<=now)candidate=addJalaliDays(candidate,1);dueAt=candidate;text=text.replace(tm[0],' ');confidence+=.25;}}
 const title=normalizeFaText(text).replace(/\s+/g,' ').trim()||'یادآور جدید';
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
