import{describe,expect,it}from'vitest';
import{addJalaliDays,isJalaliLeap,jalaliMonthLength,toGregorian,toJalali,zonedJalaliToDate}from'./jalali';
describe('تقویم جلالی یادآورها',()=>{
 it('رفت و برگشت سال‌های ۱۳۰۰ تا ۱۵۰۰ را حفظ می‌کند',()=>{
  for(let year=1300;year<=1500;year++){for(const month of [1,6,7,12]){const day=jalaliMonthLength(year,month);const g=toGregorian(year,month,day);const back=toJalali(new Date(Date.UTC(g.gy,g.gm-1,g.gd,12)));expect(back).toEqual({year,month,day});}}
 });
 it('تعداد روز ماه‌ها را درست می‌دهد',()=>{expect(jalaliMonthLength(1400,1)).toBe(31);expect(jalaliMonthLength(1400,6)).toBe(31);expect(jalaliMonthLength(1400,7)).toBe(30);expect(jalaliMonthLength(1400,11)).toBe(30);});
 it('اسفند کبیسه و غیرکبیسه را مرزبندی می‌کند',()=>{const leap=Array.from({length:201},(_,i)=>1300+i).filter(isJalaliLeap)[0];expect(jalaliMonthLength(leap,12)).toBe(30);expect(jalaliMonthLength(leap+1,12)).toBe(29);});
 it('۲۹ اسفند در همه سال‌ها معتبر است و ۳۰ فقط در کبیسه',()=>{for(let y=1300;y<=1500;y++){expect(()=>toGregorian(y,12,29)).not.toThrow();if(isJalaliLeap(y))expect(()=>toGregorian(y,12,30)).not.toThrow();else expect(()=>toGregorian(y,12,30)).toThrow();}});
 it('مرز ماه‌ها رفت و برگشت دارد',()=>{for(let y=1390;y<=1410;y++){for(let m=1;m<=11;m++){const a=toGregorian(y,m,jalaliMonthLength(y,m));const b=toGregorian(y,m+1,1);const da=Date.UTC(a.gy,a.gm-1,a.gd),db=Date.UTC(b.gy,b.gm-1,b.gd);expect((db-da)/86400000).toBe(1);}}});
 it('زمان محلی تهران را به UTC درست تبدیل می‌کند',()=>{const d=zonedJalaliToDate(1405,7,10,9,0);const j=toJalali(d);expect(j).toEqual({year:1405,month:7,day:10});});
 it('افزودن روزهای جلالی از روی ماه عبور می‌کند',()=>{const d=zonedJalaliToDate(1405,6,31,10,0);expect(toJalali(addJalaliDays(d,1))).toEqual({year:1405,month:7,day:1});});
});
