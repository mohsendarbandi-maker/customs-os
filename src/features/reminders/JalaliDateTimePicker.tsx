import React,{useEffect,useMemo,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Clock3,Sunrise,X} from 'lucide-react';
import {JALALI_MONTHS,jalaliMonthLength,jalaliWeekday,toJalali,toGregorian,zonedJalaliToDate,addJalaliDays} from '../../lib/jalali';
import {reminderNumber,reminderYear,reminderText,type ReminderLanguage} from './reminderI18n';
type Props={value:Date;onChange:(value:Date)=>void;onClose:()=>void;allDay:boolean;onAllDayChange:(v:boolean)=>void;language?:ReminderLanguage;onClear?:()=>void;onApply?:()=>void};
const pad=(n:number)=>String(n).padStart(2,'0');
const EN_MONTHS=['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'],EN_WEEKDAYS=['Sat','Sun','Mon','Tue','Wed','Thu','Fri'];
const TEHRAN_TIME=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',hour12:false,hourCycle:'h23',hour:'2-digit',minute:'2-digit'});
const timeFrom=(date:Date)=>{const p=TEHRAN_TIME.formatToParts(date);return{hour:Number(p.find(x=>x.type==='hour')?.value??0),minute:Number(p.find(x=>x.type==='minute')?.value??0)};};
export const JalaliDateTimePicker:React.FC<Props>=({value,onChange,onClose,allDay,onAllDayChange,language='fa',onClear,onApply})=>{
 const now=new Date(),initial=toJalali(value),initialTime=timeFrom(value);
 const [month,setMonth]=useState(initial.month),[year,setYear]=useState(initial.year),[selectedDay,setSelectedDay]=useState(initial.day),[hour,setHour]=useState(initialTime.hour),[minute,setMinute]=useState(initialTime.minute);
 const t=(v:string)=>reminderText(v,language);
 useEffect(()=>{const j=toJalali(value),time=timeFrom(value);setMonth(j.month);setYear(j.year);setSelectedDay(j.day);setHour(time.hour);setMinute(time.minute);},[value]);
 const days=useMemo(()=>{const len=jalaliMonthLength(year,month),first=zonedJalaliToDate(year,month,1),offset=jalaliWeekday(first);return Array.from({length:offset+len},(_,i)=>i<offset?null:i-offset+1);},[year,month]);
 const shift=(amount:number)=>{let m=month+amount,y=year;if(m<1){m=12;y--}if(m>12){m=1;y++}setMonth(m);setYear(y);setSelectedDay(d=>Math.min(d,jalaliMonthLength(y,m)));};
 const setDraft=(date:Date)=>{const j=toJalali(date),time=timeFrom(date);setMonth(j.month);setYear(j.year);setSelectedDay(j.day);setHour(time.hour);setMinute(time.minute);};
 const nowJ=toJalali(now),months=language==='fa'?JALALI_MONTHS:EN_MONTHS;
 const shortcuts:Array<[string,()=>void]>=[
 ['امروز عصر',()=>{const j=toJalali(now);setDraft(zonedJalaliToDate(j.year,j.month,j.day,17,0));}],
 ['فردا صبح',()=>{const j=toJalali(addJalaliDays(now,1));setDraft(zonedJalaliToDate(j.year,j.month,j.day,9,0));}],
 ['آخر هفته',()=>{let d=addJalaliDays(now,1);for(let i=0;i<7;i++){const j=toJalali(d),g=toGregorian(j.year,j.month,j.day);if(new Date(Date.UTC(g.gy,g.gm-1,g.gd)).getUTCDay()===5){setDraft(zonedJalaliToDate(j.year,j.month,j.day,17,0));break;}d=addJalaliDays(d,1);}}],
 ['هفته بعد',()=>{const j=toJalali(addJalaliDays(now,7));setDraft(zonedJalaliToDate(j.year,j.month,j.day,hour,minute));}],
 ['ماه بعد',()=>{let m=nowJ.month+1,y=nowJ.year;if(m===13){m=1;y++}setDraft(zonedJalaliToDate(y,m,Math.min(nowJ.day,jalaliMonthLength(y,m)),hour,minute));}]
 ];
 const apply=()=>{onChange(zonedJalaliToDate(year,month,selectedDay,allDay?9:hour,allDay?0:minute));onApply?.();};
 return <div className="reminders-calendar-backdrop fixed inset-0 z-[170] flex items-start justify-center overflow-y-auto overscroll-contain p-2 sm:items-center sm:p-4" dir={language==='fa'?'rtl':'ltr'} role="dialog" aria-modal="true" aria-label={t('انتخاب تاریخ و زمان')}>
 <div className="reminders-calendar-panel my-auto w-full max-w-lg shrink-0 rounded-[20px] border app-border bg-[var(--surface)] p-3 shadow-2xl max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-16px)] overflow-y-auto overscroll-contain">
 <div className="flex items-start justify-between gap-3 mb-4"><div><b className="text-lg">{t('انتخاب تاریخ و زمان')}</b></div><button type="button" onClick={onClose} aria-label={t('بستن')} className="reminder-icon-button"><X size={19}/></button></div>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">{shortcuts.map(([label,fn])=><button type="button" key={label} onClick={fn} className="reminders-calendar-shortcut"><Sunrise size={16}/>{t(label)}</button>)}</div>
 <div className="flex items-center justify-between rounded-2xl bg-[var(--surface-2)] px-2 py-2 mb-2"><button type="button" onClick={()=>shift(-1)} aria-label={language==='fa'?'ماه قبل':'Previous month'} className="reminder-icon-button"><ChevronLeft size={18}/></button><div className="text-center font-black text-base">{months[month-1]} {reminderYear(year,language)}</div><button type="button" onClick={()=>shift(1)} aria-label={language==='fa'?'ماه بعد':'Next month'} className="reminder-icon-button"><ChevronRight size={18}/></button></div>
 <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2 text-sm"><strong>{reminderNumber(selectedDay,language)} {months[month-1]} {reminderYear(year,language)}</strong><span className="shrink-0 app-muted">{allDay?t('تمام‌روز'):`${reminderNumber(hour,language)}:${pad(minute)}`}</span></div>
 <div className="grid grid-cols-7 text-center text-xs app-muted mb-2">{(language==='fa'?['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه']:EN_WEEKDAYS).map((d,i)=><div key={i} className="py-2">{language==='fa'?d[0]:d}</div>)}</div>
 <div className="grid grid-cols-7 gap-1.5">{days.map((day,i)=>day===null?<div key={'e'+i} className="aspect-square"/>:<button type="button" key={day} aria-pressed={day===selectedDay} onClick={()=>setSelectedDay(day)} className={'reminders-calendar-day '+(day===nowJ.day&&year===nowJ.year&&month===nowJ.month?'is-today ':'')+(day===selectedDay?'is-selected':'')}>{reminderNumber(day,language)}</button>)}</div>
 <div className="mt-4 rounded-2xl border app-border p-3"><label className="flex items-center justify-between gap-3 min-h-12"><span className="flex items-center gap-2 text-sm font-bold"><CalendarDays size={17}/>{t('تمام‌روز')}</span><input type="checkbox" checked={allDay} onChange={e=>onAllDayChange(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]"/></label>
 {!allDay&&<div className="grid grid-cols-2 gap-3 mt-2"><label className="flex items-center gap-2 border app-border bg-[var(--surface-2)] rounded-xl px-3 min-h-12"><Clock3 size={16}/><select aria-label={language==='fa'?'ساعت':'Hour'} value={hour} onChange={e=>setHour(Number(e.target.value))} className="bg-transparent outline-none flex-1 text-base">{Array.from({length:24},(_,h)=><option key={h} value={h}>{reminderNumber(h,language)}</option>)}</select></label><label className="flex items-center gap-2 border app-border bg-[var(--surface-2)] rounded-xl px-3 min-h-12"><Clock3 size={16}/><select aria-label={language==='fa'?'دقیقه':'Minute'} value={minute} onChange={e=>setMinute(Math.round(Number(e.target.value)/5)*5%60)} className="bg-transparent outline-none flex-1 text-base">{Array.from({length:12},(_,i)=>{const m=i*5;return <option key={m} value={m}>{pad(m)}</option>})}</select></label></div>}
 <div className="grid grid-cols-2 gap-2 mt-3"><button type="button" onClick={apply} className="min-h-12 rounded-xl bg-[var(--primary)] text-white font-black">{t('تأیید')}</button>{onClear&&<button type="button" onClick={()=>{onClear();onClose();}} className="min-h-12 rounded-xl border app-border font-bold">{t('پاک‌کردن تاریخ')}</button>}</div>
 </div></div></div>;
};
