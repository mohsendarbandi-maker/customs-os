import React,{useEffect,useMemo,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Clock3,Sunrise} from 'lucide-react';
import {JALALI_MONTHS,jalaliMonthLength,jalaliWeekday,startOfTehranDay,toJalali,toGregorian,zonedJalaliToDate,addJalaliDays} from '../../lib/jalali';

type Props={value:Date;onChange:(value:Date)=>void;onClose:()=>void;allDay:boolean;onAllDayChange:(v:boolean)=>void};
const pad=(n:number)=>String(n).padStart(2,'0');
const same=(a:Date,b:Date)=>startOfTehranDay(a).getTime()===startOfTehranDay(b).getTime();
export const JalaliDateTimePicker:React.FC<Props>=({value,onChange,onClose,allDay,onAllDayChange})=>{
 const now=new Date(),jv=toJalali(value),[month,setMonth]=useState(jv.month),[year,setYear]=useState(jv.year),[hour,setHour]=useState(Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',hour12:false,hourCycle:'h23',hour:'2-digit'}).format(value))),[minute,setMinute]=useState(Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',minute:'2-digit'}).format(value)));
 useEffect(()=>{const j=toJalali(value);setMonth(j.month);setYear(j.year);},[value]);
 const days=useMemo(()=>{const len=jalaliMonthLength(year,month),first=zonedJalaliToDate(year,month,1);const offset=jalaliWeekday(first);return Array.from({length:offset+len},(_,i)=>i<offset?null:i-offset+1);},[year,month]);
 const choose=(day:number,h=hour,m=minute)=>onChange(zonedJalaliToDate(year,month,day,allDay?9:h,allDay?0:m));
 const shift=(amount:number)=>{let m=month+amount,y=year;if(m<1){m=12;y--}if(m>12){m=1;y++}setMonth(m);setYear(y);}
 const currentDay=toJalali(now).day;
 const shortcuts=[
  ['امروز عصر',()=>{const j=toJalali(now);onChange(zonedJalaliToDate(j.year,j.month,j.day,17,0));}],
  ['فردا صبح',()=>{const j=toJalali(addJalaliDays(now,1));onChange(zonedJalaliToDate(j.year,j.month,j.day,9,0));}],
  ['آخر هفته',()=>{let d=addJalaliDays(now,1);for(let i=0;i<7;i++){if(jalaliWeekday(d)===6){const j=toJalali(d);onChange(zonedJalaliToDate(j.year,j.month,j.day,17,0));break;}d=addJalaliDays(d,1);}}],
  ['هفته بعد',()=>{const j=toJalali(addJalaliDays(now,7));onChange(zonedJalaliToDate(j.year,j.month,j.day,hour,minute));}],
  ['ماه بعد',()=>{let m=toJalali(now).month+1,y=toJalali(now).year;if(m===13){m=1;y++}onChange(zonedJalaliToDate(y,m,Math.min(toJalali(now).day,jalaliMonthLength(y,m)),hour,minute));}]
 ] as const;
 return <div className="fixed inset-0 z-[170] bg-black/55 flex items-end md:items-center justify-center" dir="rtl" role="dialog" aria-modal="true">
   <div className="w-full md:max-w-lg rounded-t-[26px] md:rounded-[26px] border app-border bg-[var(--surface)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl max-h-[92vh] overflow-auto">
    <div className="flex items-center justify-between gap-3 mb-3"><div><b className="text-base">انتخاب تاریخ و زمان</b><div className="text-[11px] app-muted mt-1">ذخیره‌سازی در سامانه همیشه به زمان هماهنگ جهانی انجام می‌شود.</div></div><button onClick={onClose} className="min-w-11 min-h-11 rounded-xl border app-border">بستن</button></div>
    <div className="grid grid-cols-3 gap-2 mb-3">{shortcuts.map(([label,fn])=><button key={label} onClick={fn} className="min-h-11 rounded-xl border app-border bg-[var(--surface-2)] text-xs font-bold flex items-center justify-center gap-1"><Sunrise size={14}/>{label}</button>)}</div>
    <div className="flex items-center justify-between rounded-2xl bg-[var(--surface-2)] px-2 py-2 mb-3">
      <button onClick={()=>shift(-1)} className="min-w-11 min-h-11 rounded-xl"><ChevronRight size={18}/></button>
      <div className="text-center font-black">{JALALI_MONTHS[month-1]} {year}</div>
      <button onClick={()=>shift(1)} className="min-w-11 min-h-11 rounded-xl"><ChevronLeft size={18}/></button>
    </div>
    <div className="grid grid-cols-7 text-center text-[10px] app-muted mb-1">{['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'].map(d=><div key={d} className="py-1">{d[0]}</div>)}</div>
    <div className="grid grid-cols-7 gap-1">{days.map((day,i)=>day===null?<div key={'e'+i} className="aspect-square"/>:<button key={day} onClick={()=>choose(day)} className={'aspect-square rounded-xl text-sm '+(day===currentDay&&year===toJalali(now).year&&month===toJalali(now).month?'ring-2 ring-[var(--primary)] ':'')+(day===jv.day&&month===jv.month&&year===jv.year?'bg-[var(--primary)] text-white font-black':'bg-[var(--surface-2)]')}>{pad(day).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)])}</button>)}</div>
    <div className="mt-4 rounded-2xl border app-border p-3">
      <label className="flex items-center justify-between gap-3 min-h-11"><span className="flex items-center gap-2 text-sm font-bold"><CalendarDays size={16}/>تمام‌روز</span><input type="checkbox" checked={allDay} onChange={e=>onAllDayChange(e.target.checked)} className="w-5 h-5"/></label>
      {!allDay&&<div className="grid grid-cols-2 gap-3 mt-2"><label className="flex items-center gap-2 border app-border bg-[var(--surface-2)] rounded-xl px-3 min-h-12"><Clock3 size={15}/><select value={hour} onChange={e=>setHour(Number(e.target.value))} className="bg-transparent outline-none flex-1">{Array.from({length:24},(_,h)=><option key={h} value={h}>{pad(h)}</option>)}</select></label><label className="flex items-center gap-2 border app-border bg-[var(--surface-2)] rounded-xl px-3 min-h-12"><Clock3 size={15}/><select value={minute} onChange={e=>setMinute(Math.round(Number(e.target.value)/5)*5%60)} className="bg-transparent outline-none flex-1">{Array.from({length:12},(_,i)=>{const m=i*5;return <option key={m} value={m}>{pad(m)}</option>})}</select></label></div>}
      <button onClick={()=>choose(jv.day,hour,minute)} className="w-full mt-3 min-h-12 rounded-xl bg-[var(--primary)] text-white font-black">تأیید</button>
    </div>
   </div>
 </div>;
};
