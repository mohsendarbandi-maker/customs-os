import{describe,expect,it}from'vitest';
import{nextRecurrenceDue,recurrenceNext}from'./reminderCore';
import{toJalali,zonedJalaliToDate}from'../../lib/jalali';
describe('تکرار یادآور',()=>{
 it('روزانه',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=DAILY');expect(toJalali(n!)).toEqual({year:1405,month:7,day:11});});
 it('هفتگی بدون BYDAY باید دقیقاً هفتهٔ بعد باشد، نه روز بعد',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=WEEKLY');expect(toJalali(n!)).toEqual({year:1405,month:7,day:17});expect(n!.getTime()-d.getTime()).toBe(7*24*60*60*1000);});
 it('هفتگی با بازهٔ دو هفته‌ای',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=WEEKLY;INTERVAL=2');expect(toJalali(n!)).toEqual({year:1405,month:7,day:24});});
 it('هفتگی با روز انتخابی',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=WEEKLY;BYDAY=MO');expect(n).not.toBeNull();expect(n!.getTime()).toBeGreaterThan(d.getTime());});
 it('ماهانه در پایان ماه ۳۱ روزه به ۳۰ روزه می‌چسبد',()=>{const d=zonedJalaliToDate(1405,6,31,9,0);const n=recurrenceNext(d,'RRULE:FREQ=MONTHLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1405,month:7,day:30});});
 it('ماهانه از اسفند ۳۰ به ۲۹ در سال غیرکبیسه می‌آید',()=>{const d=zonedJalaliToDate(1399,12,30,9,0);const n=recurrenceNext(d,'RRULE:FREQ=MONTHLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1400,month:1,day:30});});
 it('سالانه جلالی ۳۰ اسفند را در صورت نیاز محدود می‌کند',()=>{const d=zonedJalaliToDate(1399,12,30,9,0);const n=recurrenceNext(d,'RRULE:FREQ=YEARLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1400,month:12,day:29});});
 it('نوبت بعدی را در محدودهٔ تاریخ پایان تکرار نگه می‌دارد',()=>{const due=zonedJalaliToDate(1405,7,10,9,0);const end=zonedJalaliToDate(1405,7,11,9,0);expect(nextRecurrenceDue(due.toISOString(),'RRULE:FREQ=DAILY',end.toISOString())).toEqual(end);});
 it('پس از تاریخ پایان، نوبت دیگری نمی‌سازد',()=>{const due=zonedJalaliToDate(1405,7,10,9,0);const end=zonedJalaliToDate(1405,7,10,9,0);expect(nextRecurrenceDue(due.toISOString(),'RRULE:FREQ=DAILY',end.toISOString())).toBeNull();});
 it('قاعدهٔ تکرار خراب را بی‌صدا خاتمه نمی‌دهد',()=>{const due=zonedJalaliToDate(1405,7,10,9,0);expect(()=>nextRecurrenceDue(due.toISOString(),'RRULE:FREQ=HOURLY',null)).toThrow('نوبت بعدی');});

});
