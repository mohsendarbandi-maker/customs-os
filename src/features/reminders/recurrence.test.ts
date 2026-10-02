import{describe,expect,it}from'vitest';
import{recurrenceNext}from'./reminderCore';
import{toJalali,zonedJalaliToDate}from'../../lib/jalali';
describe('تکرار یادآور',()=>{
 it('روزانه',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=DAILY');expect(toJalali(n!)).toEqual({year:1405,month:7,day:11});});
 it('هفتگی با روز انتخابی',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const n=recurrenceNext(d,'RRULE:FREQ=WEEKLY;BYDAY=MO');expect(n).not.toBeNull();expect(n!.getTime()).toBeGreaterThan(d.getTime());});
 it('ماهانه در پایان ماه ۳۱ روزه به ۳۰ روزه می‌چسبد',()=>{const d=zonedJalaliToDate(1405,6,31,9,0);const n=recurrenceNext(d,'RRULE:FREQ=MONTHLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1405,month:7,day:30});});
 it('ماهانه از اسفند ۳۰ به ۲۹ در سال غیرکبیسه می‌آید',()=>{const d=zonedJalaliToDate(1399,12,30,9,0);const n=recurrenceNext(d,'RRULE:FREQ=MONTHLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1400,month:1,day:30});});
 it('سالانه جلالی ۳۰ اسفند را در صورت نیاز محدود می‌کند',()=>{const d=zonedJalaliToDate(1399,12,30,9,0);const n=recurrenceNext(d,'RRULE:FREQ=YEARLY;X-JALALI=1');expect(toJalali(n!)).toEqual({year:1400,month:12,day:29});});
});
