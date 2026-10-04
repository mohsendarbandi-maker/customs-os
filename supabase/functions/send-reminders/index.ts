import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "jsr:@supabase/supabase-js@2";
import {generateVapidKeys} from "npm:@mmmike/web-push@1.3.0/vapid";
import {sendPushNotification,rawPayload,WebPushError,type PushSubscriptionData} from "npm:@mmmike/web-push@1.3.0/send";

const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const admin=createClient(supabaseUrl,serviceKey);
const TZ="Asia/Tehran";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8"}});
const getParts=(date:Date,timeZone:string,calendar:"gregory"|"persian")=>{
 const p=new Intl.DateTimeFormat(calendar==="persian"?"en-US-u-ca-persian":"en-US",{timeZone,hourCycle:"h23",hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
 const get=(t:string)=>Number(p.find(x=>x.type===t)?.value??0); return {year:get("year"),month:get("month"),day:get("day"),hour:get("hour")%24,minute:get("minute"),second:get("second")};
};
const offsetMinutes=(ts:number,timeZone:string)=>{
 const p=new Intl.DateTimeFormat("en-US",{timeZone,hourCycle:"h23",hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(new Date(ts));
 const get=(t:string)=>Number(p.find(x=>x.type===t)?.value??0);
 return (Date.UTC(get("year"),get("month")-1,get("day"),get("hour"),get("minute"),get("second"))-ts)/60000;
};
const zonedToUtc=(x:{year:number;month:number;day:number;hour:number;minute:number;second?:number},timeZone:string)=>{
 const guess=Date.UTC(x.year,x.month-1,x.day,x.hour,x.minute,x.second??0),a=offsetMinutes(guess,timeZone);let ts=guess-a*60000,b=offsetMinutes(ts,timeZone);if(a!==b)ts=guess-b*60000;return new Date(ts);
};
const persianKey=(date:Date)=>{const p=getParts(date,"UTC","persian");return p.year*10000+p.month*100+p.day;};
const persianStart=(year:number)=>{
 let lo=Date.UTC(year+620,0,1),hi=Date.UTC(year+623,11,31),target=year*10000+101;
 for(let i=0;i<24&&lo<=hi;i++){const mid=lo+Math.floor((hi-lo)/2);if(persianKey(new Date(mid))<target)lo=mid+86400000;else hi=mid-86400000;}
 for(let ts=Math.max(Date.UTC(year+620,0,1),lo-86400000);ts<=Math.min(Date.UTC(year+623,11,31),hi+2*86400000);ts+=86400000)if(persianKey(new Date(ts))===target)return ts;
 throw new Error("تقویم جلالی خارج از محدوده است");
};
const monthLength=(year:number,month:number)=>month<=6?31:month<=11?30:Math.round((persianStart(year+1)-persianStart(year))/86400000)===366?30:29;
const persianToGregorian=(year:number,month:number,day:number)=>{
 const target=year*10000+month*100+day;let lo=Date.UTC(year+620,0,1),hi=Date.UTC(year+623,11,31);
 for(let i=0;i<24&&lo<=hi;i++){const mid=lo+Math.floor((hi-lo)/2),k=persianKey(new Date(mid));if(k<target)lo=mid+86400000;else hi=mid-86400000;}
 for(let ts=Math.max(Date.UTC(year+620,0,1),lo-86400000);ts<=Math.min(Date.UTC(year+623,11,31),hi+2*86400000);ts+=86400000)if(persianKey(new Date(ts))===target){const d=new Date(ts);return{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
 throw new Error("تاریخ جلالی نامعتبر است");
};
const parseTime=(v:string)=>{const [h,m]=v.split(":").map(Number);return{h,m};};
const isQuiet=(date:Date,tz:string,start:string,end:string)=>{const p=getParts(date,tz,"gregory"),s=parseTime(start),e=parseTime(end),cur=p.hour*60+p.minute,a=s.h*60+s.m,b=e.h*60+e.m;if(a===b)return false;return a<b?cur>=a&&cur<b:cur>=a||cur<b;};
const quietEnd=(date:Date,tz:string,start:string,end:string)=>{const p=getParts(date,tz,"gregory"),s=parseTime(start),e=parseTime(end),dayShift=(s.h*60+s.m)>(e.h*60+e.m)&&p.hour>=s.h?1:0,d=new Date(Date.UTC(p.year,p.month-1,p.day)+dayShift*86400000);return zonedToUtc({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:e.h,minute:e.m},tz);};
const backoff=(attempts:number)=>[60000,300000,900000][Math.min(2,Math.max(0,attempts-1))]??900000;
const toSub=(r:{endpoint:string;p256dh:string;auth:string}):PushSubscriptionData=>({endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}});
async function getSecret(name:string){const {data,error}=await admin.rpc("internal_get_reminder_secret",{p_name:name});if(error)throw error;return typeof data==="string"?data:null;}
async function ensureVapid(){let publicKey=await getSecret("reminder_vapid_public"),privateKey=await getSecret("reminder_vapid_private"),subject=await getSecret("reminder_vapid_subject")??"mailto:admin@darbandicommercial.ir";if(!publicKey||!privateKey){const k=await generateVapidKeys();publicKey=k.publicKey;privateKey=k.privateKey;const {error}=await admin.rpc("store_reminder_vapid_keys",{p_public:publicKey,p_private:privateKey});if(error)throw error;}return{publicKey,privateKey,subject};}
async function authUser(req:Request){const h=req.headers.get("Authorization");if(!h?.startsWith("Bearer "))return null;const {data}=await admin.auth.getUser(h.slice(7));return data.user??null;}
async function subs(userId:string){const {data,error}=await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",userId).eq("is_active",true);if(error)throw error;return (data??[]) as Array<{id:string;endpoint:string;p256dh:string;auth:string}>;}
async function finish(reminderId:string,userId:string,fireAt:string,status:"sent"|"failed"|"skipped"|"pending",error:string|null,retryAt:string|null){const {error:e}=await admin.rpc("finish_reminder_delivery",{p_reminder_id:reminderId,p_user_id:userId,p_fire_at:fireAt,p_status:status,p_error:error,p_retry_at:retryAt});if(e)throw e;}
async function advance(reminderId:string){
 const {data:r}=await admin.from("operational_reminders").select("id,due_at,recurrence_rule,recurrence_until,timezone,status,deleted_at").eq("id",reminderId).maybeSingle();if(!r||!r.recurrence_rule||r.status!=="open"||r.deleted_at)return;
 const due=new Date(r.due_at);if(r.recurrence_until&&due>=new Date(r.recurrence_until))return;
 const rule=Object.fromEntries(r.recurrence_rule.replace(/^RRULE:/,"").split(";").map(x=>{const i=x.indexOf("=");return[i<0?x:x.slice(0,i),i<0?"":x.slice(i+1)]})),tz=r.timezone||TZ,pg=getParts(due,tz,"persian"),gg=getParts(due,tz,"gregory"),interval=Math.max(1,Number(rule.INTERVAL??1));let next:Date|null=null;
 if(rule.FREQ==="DAILY"){const d=new Date(Date.UTC(gg.year,gg.month-1,gg.day)+interval*86400000);next=zonedToUtc({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:gg.hour,minute:gg.minute,second:gg.second},tz);}
 else if(rule.FREQ==="WEEKLY"){const wanted=String(rule.BYDAY??"").split(",").filter(Boolean),codes=["SU","MO","TU","WE","TH","FR","SA"];for(let i=1;i<=14*interval;i++){const d=new Date(Date.UTC(gg.year,gg.month-1,gg.day)+i*86400000),code=codes[d.getUTCDay()];if(!wanted.length||wanted.includes(code)){next=zonedToUtc({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:gg.hour,minute:gg.minute,second:gg.second},tz);break;}}}
 else if(rule.FREQ==="MONTHLY"){const idx=pg.month-1+interval,year=pg.year+Math.floor(idx/12),month=idx%12+1,day=Math.min(pg.day,monthLength(year,month)),g=persianToGregorian(year,month,day);next=zonedToUtc({year:g.year,month:g.month,day:g.day,hour:pg.hour,minute:pg.minute,second:pg.second},tz);}
 else if(rule.FREQ==="YEARLY"){const year=pg.year+interval,day=Math.min(pg.day,monthLength(year,pg.month)),g=persianToGregorian(year,pg.month,day);next=zonedToUtc({year:g.year,month:g.month,day:g.day,hour:pg.hour,minute:pg.minute,second:pg.second},tz);}
 if(!next||isNaN(next.getTime())||(r.recurrence_until&&next>new Date(r.recurrence_until)))return;
 await admin.from("operational_reminders").update({due_at:next.toISOString(),snoozed_until:null,snooze_count:0,occurrence_key:next.toISOString()}).eq("id",reminderId);
}
async function send(sub:{endpoint:string;p256dh:string;auth:string},payload:Record<string,unknown>,vapid:{publicKey:string;privateKey:string;subject:string}){return sendPushNotification(toSub(sub),rawPayload(JSON.stringify(payload)),vapid,{ttl:86400,urgency:"high"});}
async function deliver(){
 const {data,error}=await admin.rpc("claim_reminder_deliveries",{p_limit:100});if(error)throw error;
 const rows=(data??[]) as Array<{reminder_id:string;user_id:string;fire_at:string;attempts:number;title:string;description:string|null;priority:string;due_at:string;timezone:string;hide_content:boolean;push_enabled:boolean}>,vapid=await ensureVapid();
 for(const d of rows){
  if(!d.push_enabled){await finish(d.reminder_id,d.user_id,d.fire_at,"skipped","push_disabled",null);continue;}
  const {data:prefRow}=await admin.from("notification_preferences").select("quiet_start,quiet_end,hide_content,timezone").eq("user_id",d.user_id).maybeSingle(),pref=prefRow as {quiet_start:string;quiet_end:string;hide_content:boolean;timezone:string}|null,tz=pref?.timezone||d.timezone||TZ;
  if(d.priority!=="urgent"&&isQuiet(new Date(d.fire_at),tz,pref?.quiet_start??"22:00:00",pref?.quiet_end??"07:00:00")){await finish(d.reminder_id,d.user_id,d.fire_at,"pending","quiet_hours",quietEnd(new Date(d.fire_at),tz,pref?.quiet_start??"22:00:00",pref?.quiet_end??"07:00:00").toISOString());continue;}
  const devices=await subs(d.user_id);if(!devices.length){await finish(d.reminder_id,d.user_id,d.fire_at,"skipped","no_active_device",null);continue;}
  const hidden=d.hide_content||Boolean(pref?.hide_content),payload={title:hidden?"یادآور جدید":"یادآور گمرکی",body:hidden?"یک یادآور برای شما ثبت شده است.":d.title+(d.description?" · "+d.description:""),tag:"reminder-"+d.reminder_id,url:"/reminders?rid="+encodeURIComponent(d.reminder_id),actions:[{action:"done",title:"انجام شد"},{action:"snooze10",title:"۱۰ دقیقه بعد"},{action:"tomorrow9",title:"فردا ۹ صبح"}],data:{rid:d.reminder_id,url:"/reminders?rid="+encodeURIComponent(d.reminder_id)},icon:"/pwa/icon-192.png",badge:"/pwa/monochrome-96.png",dir:"rtl",lang:"fa"};
  let delivered=false;
  for(const s of devices){try{const ok=await send(s,payload,vapid);if(ok!==false)delivered=true;else await admin.from("push_subscriptions").delete().eq("id",s.id);}catch(err){if(err instanceof WebPushError&&(err.statusCode===404||err.statusCode===410)){await admin.from("push_subscriptions").delete().eq("id",s.id);}else{const msg=err instanceof Error?err.message:"ارسال اعلان ناموفق بود";if(d.attempts<4)await finish(d.reminder_id,d.user_id,d.fire_at,"pending",msg,new Date(Date.now()+backoff(d.attempts)).toISOString());else await finish(d.reminder_id,d.user_id,d.fire_at,"failed",msg,null);}}}
  if(delivered)await finish(d.reminder_id,d.user_id,d.fire_at,"sent",null,null);
  if(new Date(d.fire_at)<=new Date(d.due_at))await advance(d.reminder_id);
 }
 return rows.length;
}
async function digest(){
 const {data,error}=await admin.from("notification_preferences").select("user_id,morning_digest_time,timezone,hide_content").eq("push_enabled",true);if(error)throw error;const now=new Date(),vapid=await ensureVapid();let sent=0;
 for(const p of (data??[]) as Array<{user_id:string;morning_digest_time:string;timezone:string;hide_content:boolean}>){
  const tz=p.timezone||TZ,g=getParts(now,tz,"gregory"),[hh,mm]=p.morning_digest_time.split(":").map(Number);if(g.hour!==hh||g.minute!==mm)continue;
  const start=zonedToUtc({year:g.year,month:g.month,day:g.day,hour:0,minute:0},tz),end=zonedToUtc({year:g.year,month:g.month,day:g.day,hour:23,minute:59},tz);
  const todayQ=await admin.from("operational_reminders").select("id",{count:"exact",head:true}).eq("status","open").gte("due_at",start.toISOString()).lt("due_at",end.toISOString()),overQ=await admin.from("operational_reminders").select("id",{count:"exact",head:true}).eq("status","open").lt("due_at",now.toISOString()),devices=await subs(p.user_id);
  for(const s of devices){try{await send(s,{title:"خلاصه صبحگاهی",body:p.hide_content?"خلاصه امروز آماده است.":"امروز "+String(todayQ.count??0).replace(/\d/g,x=>"۰۱۲۳۴۵۶۷۸۹"[Number(x)])+" یادآور و "+String(overQ.count??0).replace(/\d/g,x=>"۰۱۲۳۴۵۶۷۸۹"[Number(x)])+" مورد معوق دارید.",tag:"morning-"+g.year+"-"+g.month+"-"+g.day,url:"/reminders?view=today",actions:[],data:{url:"/reminders?view=today"},icon:"/pwa/icon-192.png",badge:"/pwa/monochrome-96.png",dir:"rtl",lang:"fa"},vapid);sent++;}catch(err){if(err instanceof WebPushError&&(err.statusCode===404||err.statusCode===410))await admin.from("push_subscriptions").delete().eq("id",s.id);}}
 }
 return sent;
}
async function main(req:Request){
 if(!supabaseUrl||!serviceKey)return json({error:"تنظیمات سرور کامل نیست"},500);
 const body=(await req.json().catch(()=>({}))) as {mode?:string},mode=body.mode??"cron";
 if(mode==="cron"){const expected=await getSecret("reminder_cron_secret"),given=req.headers.get("x-reminder-cron-secret");if(!expected||given!==expected)return json({error:"دسترسی زمان‌بندی مجاز نیست"},401);const processed=await deliver();await digest().catch(()=>0);return json({ok:true,processed});}
 const user=await authUser(req);if(!user)return json({error:"ورود به سامانه لازم است"},401);
 const {data:profile}=await admin.from("profiles").select("organization_id,role,is_active").eq("id",user.id).maybeSingle() as {data:{organization_id:string;role:string;is_active:boolean}|null};
 if(!profile?.is_active||profile.role==="client")return json({error:"این قابلیت برای این حساب فعال نیست"},403);
 if(mode==="bootstrap"){const v=await ensureVapid();return json({publicKey:v.publicKey});}
 if(mode==="test"){const v=await ensureVapid(),devices=await subs(user.id);if(!devices.length)return json({error:"هیچ دستگاه فعالی ثبت نشده است"},400);let sent=0;for(const s of devices){try{const ok=await send(s,{title:"اعلان آزمایشی",body:"اعلان‌های سامانه گمرکی با موفقیت فعال شد.",tag:"test-push",url:"/reminders",actions:[{action:"done",title:"انجام شد"}],data:{url:"/reminders"},icon:"/pwa/icon-192.png",badge:"/pwa/monochrome-96.png",dir:"rtl",lang:"fa"},v);if(ok!==false)sent++;else await admin.from("push_subscriptions").delete().eq("id",s.id);}catch(err){if(err instanceof WebPushError&&(err.statusCode===404||err.statusCode===410))await admin.from("push_subscriptions").delete().eq("id",s.id);}}return json({ok:true,sent});}
 return json({error:"درخواست نامعتبر است"},400);
}
Deno.serve(main);
