export type QuietHours={start:string;end:string};
export function parseClock(value:string){const [hour,minute]=value.split(':').map(Number);return{hour,minute};}
export function isQuietHours(date:Date,quiet:QuietHours,timeZone='Asia/Tehran'){
 const p=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(date);
 const hour=Number(p.find(x=>x.type==='hour')?.value??0)%24;const minute=Number(p.find(x=>x.type==='minute')?.value??0);
 const s=parseClock(quiet.start),e=parseClock(quiet.end);const cur=hour*60+minute,a=s.hour*60+s.minute,b=e.hour*60+e.minute;
 if(a===b)return false;return a<b?cur>=a&&cur<b:cur>=a||cur<b;
}
export function snoozeAt(date:Date,minutes:number){return new Date(date.getTime()+minutes*60000);}
export function tomorrowAtNine(date:Date,timeZone='Asia/Tehran'){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=(t:string)=>Number(p.find(x=>x.type===t)?.value??0);
 const base=new Date(Date.UTC(get('year'),get('month')-1,get('day'))+86400000);
 const guess=Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate(),9,0);
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(guess));
 const g=(t:string)=>Number(parts.find(x=>x.type===t)?.value??0);
 const offset=(Date.UTC(g('year'),g('month')-1,g('day'),g('hour')%24,g('minute'))-guess)/60000;
 return new Date(guess-offset*60000);
}
