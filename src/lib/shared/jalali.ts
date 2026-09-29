const DIGITS='۰۱۲۳۴۵۶۷۸۹';
const faDigits=(value:string)=>value.replace(/[۰-۹]/g,d=>String(DIGITS.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const pad=(n:number)=>String(n).padStart(2,'0');
const formatter=new Intl.DateTimeFormat('en-US-u-ca-persian',{calendar:'persian',numberingSystem:'latn',timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'});

const parts=(date:Date)=>{const p=formatter.formatToParts(date);return{jy:Number(p.find(x=>x.type==='year')?.value),jm:Number(p.find(x=>x.type==='month')?.value),jd:Number(p.find(x=>x.type==='day')?.value)}};
const cmp=(a:{jy:number;jm:number;jd:number},b:{jy:number;jm:number;jd:number})=>a.jy-b.jy||a.jm-b.jm||a.jd-b.jd;

export const isoToJalali=(iso?:string|null)=>{
 if(!iso)return '';
 const d=new Date(/T|Z|[+-]\d\d:/.test(iso)?iso:iso+'T00:00:00Z');
 if(Number.isNaN(d.getTime()))return '';
 const x=parts(d); return `${x.jy}/${pad(x.jm)}/${pad(x.jd)}`;
};

export const jalaliToIso=(value:string)=>{
 const raw=faDigits(String(value||'')).trim().replace(/[.-]/g,'/');
 const m=raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
 if(!m)return null;
 const target={jy:Number(m[1]),jm:Number(m[2]),jd:Number(m[3])};
 if(target.jy<1200||target.jy>1600||target.jm<1||target.jm>12||target.jd<1||target.jd>31)return null;
 let lo=Date.UTC(target.jy+621,2,19),hi=Date.UTC(target.jy+622,2,23);
 while(lo<=hi){
   const mid=lo+Math.floor((hi-lo)/2/86400000)*86400000;
   const got=parts(new Date(mid)); const c=cmp(got,target);
   if(c===0)return new Date(mid).toISOString().slice(0,10);
   if(c<0)lo=mid+86400000;else hi=mid-86400000;
 }
 return null;
};

export const daysBetweenIso=(a?:string|null,b?:string|null)=>{
 if(!a||!b)return null;
 const ams=Date.parse(a+'T00:00:00Z'),bms=Date.parse(b+'T00:00:00Z');
 if(Number.isNaN(ams)||Number.isNaN(bms))return null;
 return Math.abs(ams-bms)/86400000;
};
