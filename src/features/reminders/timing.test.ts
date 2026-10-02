import{describe,expect,it}from'vitest';
import{isQuietHours,snoozeAt,tomorrowAtNine}from'./timing';
describe('زمان‌بندی اعلان',()=>{
 const tz='Asia/Tehran';
 it('ساعت سکوت ۲۲ تا ۷ را در نیمه شب تشخیص می‌دهد',()=>{expect(isQuietHours(new Date('2026-10-02T00:30:00Z'),{start:'22:00',end:'07:00'},tz)).toBe(true);});
 it('ساعت کاری را خارج از سکوت تشخیص می‌دهد',()=>{expect(isQuietHours(new Date('2026-10-02T07:30:00Z'),{start:'22:00',end:'07:00'},tz)).toBe(false);});
 it('زمان سکوت عبوری را درست می‌سنجد',()=>{expect(isQuietHours(new Date('2026-10-02T18:00:00Z'),{start:'22:00',end:'07:00'},tz)).toBe(false);expect(isQuietHours(new Date('2026-10-02T19:00:00Z'),{start:'22:00',end:'07:00'},tz)).toBe(true);});
 it('تعویق ۱۰ دقیقه و یک ساعت را دقیق محاسبه می‌کند',()=>{const d=new Date('2026-10-02T10:00:00Z');expect(snoozeAt(d,10).toISOString()).toBe('2026-10-02T10:10:00.000Z');expect(snoozeAt(d,60).toISOString()).toBe('2026-10-02T11:00:00.000Z');});
 it('فردا ساعت ۹ را در منطقه زمانی تهران می‌سازد',()=>{const d=tomorrowAtNine(new Date('2026-10-02T10:00:00Z'),tz);expect(d.toISOString()).toContain('2026-10-03T05:30:00.000Z');});
});
