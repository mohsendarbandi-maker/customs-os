import React,{useCallback,useEffect,useState}from'react';
import{Bell,BellOff,Check,Image,Languages,Palette,Save,Send,Sun,Moon,Type,UserRound,Volume2,VolumeX,X}from'lucide-react';
import{useAuth}from'../../context/AuthContext';
import{supabase}from'../../lib/supabase';

export type ChatPreferences={
 theme:'light'|'dark';
 accent:string;
 wallpaper:'plain'|'dots'|'grid'|'soft'|'blueprint';
 fontSize:'small'|'normal'|'large';
 language:'fa'|'en';
 notificationsEnabled:boolean;
 soundsEnabled:boolean;
 vibrationEnabled:boolean;
 sendOnEnter:boolean;
 compactMode:boolean;
 showSenderNames:boolean;
 showMessagePreview:boolean;
};

export const DEFAULT_CHAT_PREFERENCES:ChatPreferences={
 theme:'light',accent:'#0B7EA4',wallpaper:'plain',fontSize:'normal',language:'fa',
 notificationsEnabled:true,soundsEnabled:true,vibrationEnabled:true,sendOnEnter:true,compactMode:false,showSenderNames:true,showMessagePreview:true
};

const readLocal=():ChatPreferences=>{
 try{
  const raw=localStorage.getItem('customs-chat-preferences');
  return raw?{...DEFAULT_CHAT_PREFERENCES,...JSON.parse(raw)}:DEFAULT_CHAT_PREFERENCES;
 }catch{return DEFAULT_CHAT_PREFERENCES}
};

const fontScale=(v:ChatPreferences['fontSize'])=>v==='small'?'0.92':v==='large'?'1.12':'1';

export const ChatSettingsPanel:React.FC<{open:boolean;onClose:()=>void}>=({open,onClose})=>{
 const{user}=useAuth();
 const[prefs,setPrefs]=useState<ChatPreferences>(readLocal);
 const[serverSettings,setServerSettings]=useState<Record<string,unknown>>({});
 const[busy,setBusy]=useState(false);
 const[saved,setSaved]=useState(false);

 const apply=useCallback((next:ChatPreferences)=>{
  const root=document.querySelector<HTMLElement>('.chat-standalone');
  if(!root)return;
  root.dataset.chatTheme=next.theme;
  root.dataset.chatWallpaper=next.wallpaper;
  root.dataset.chatLanguage=next.language;
  root.dataset.chatNotifications=String(next.notificationsEnabled);
  root.dataset.chatSounds=String(next.soundsEnabled);
  root.dataset.chatVibration=String(next.vibrationEnabled);
  root.dataset.chatSendOnEnter=String(next.sendOnEnter);
  root.dataset.chatDensity=next.compactMode?'compact':'comfortable';
  root.dataset.chatShowSenderNames=String(next.showSenderNames);
  root.dataset.chatShowMessagePreview=String(next.showMessagePreview);
  root.style.setProperty('--chat-accent',next.accent);
  root.style.setProperty('--chat-font-scale',fontScale(next.fontSize));
 },[]);

 useEffect(()=>{
  const local=readLocal();
  setPrefs(local);
  apply(local);
  let alive=true;
  if(user?.id){
   void supabase.from('user_settings').select('settings').eq('user_id',user.id).maybeSingle().then(({data})=>{
    const server=(data?.settings as any)?.chat?.preferences;
    if(alive&&server){
      const merged={...DEFAULT_CHAT_PREFERENCES,...server} as ChatPreferences;
      setPrefs(merged);
      try{localStorage.setItem('customs-chat-preferences',JSON.stringify(merged))}catch{}
      apply(merged);
    }
    if(alive&&data?.settings)setServerSettings((data.settings||{}) as Record<string,unknown>);
   });
  }
  return()=>{alive=false};
 },[user?.id,apply]);

 useEffect(()=>{apply(prefs)},[prefs,apply]);

 const update=(patch:Partial<ChatPreferences>)=>setPrefs(v=>({...v,...patch}));

 const save=async()=>{
  setBusy(true);
  try{
   try{localStorage.setItem('customs-chat-preferences',JSON.stringify(prefs))}catch{}
   if(user?.id){
    await supabase.from('user_settings').upsert({
      user_id:user.id,
      settings:{
        ...serverSettings,
        chat:{
          ...((serverSettings.chat as Record<string,unknown>|undefined)||{}),
          preferences:prefs
        }
      },
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
   }
   setSaved(true);
   setTimeout(()=>setSaved(false),1400);
  }finally{setBusy(false)}
 };

 if(!open)return null;

 const swatches=['#0B7EA4','#075A78','#2563EB','#7C3AED','#0F766E','#B45309'];
 const wallpapers:[ChatPreferences['wallpaper'],string][]=[
  ['plain','ساده'],['dots','نقطه‌ای'],['grid','شبکه‌ای'],['soft','نرم'],['blueprint','Blueprint']
 ];

 return (
  <div
   className="fixed inset-0 z-[680] bg-black/50 flex items-end md:items-center justify-center"
   onClick={onClose}
  >
   <section
    className="chat-settings-panel w-full md:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl md:rounded-3xl border app-border bg-[var(--surface)] shadow-2xl"
    onClick={e=>e.stopPropagation()}
    dir="rtl"
   >
    <header className="sticky top-0 z-10 p-4 border-b app-border bg-[var(--surface)] flex items-center gap-3">
     <div className="h-11 w-11 rounded-2xl bg-[var(--chat-accent)] text-white grid place-items-center"><Palette size={18}/></div>
     <div className="flex-1 min-w-0">
      <b className="text-base">تنظیمات چت</b>
      <div className="text-xs app-muted mt-0.5">شبیه تنظیمات یک پیام‌رسان واقعی</div>
     </div>
     <button type="button" className="h-11 w-11 rounded-full grid place-items-center hover:bg-black/5" onClick={onClose} aria-label="بستن">
      <X size={18}/>
     </button>
    </header>

    <div className="p-4 space-y-4">
     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Sun size={16}/> نور / حالت نمایش</div>
      <div className="grid grid-cols-2 gap-2 mt-3">
       {(['light','dark'] as const).map((v)=>(
        <button
         type="button"
         key={v}
         onClick={()=>update({theme:v})}
         className={
          "min-h-12 rounded-xl border app-border flex items-center justify-center gap-2 text-sm "+
          (prefs.theme===v?'bg-[var(--chat-accent)] text-white':'bg-[var(--surface-2)]')
         }
        >
         {v==='light'?<Sun size={16}/>:<Moon size={16}/>}
         <span>{v==='light'?'روشن':'تیره'}</span>
         {prefs.theme===v?<Check size={15}/>:null}
        </button>
       ))}
      </div>
     </div>

     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Palette size={16}/> رنگ اصلی</div>
      <div className="flex flex-wrap gap-3 mt-3">
       {swatches.map((c)=>(
        <button
         type="button"
         key={c}
         onClick={()=>update({accent:c})}
         aria-label={c}
         className="h-10 w-10 rounded-full border-4 border-[var(--surface)] shadow-md"
         style={{background:c,outline:prefs.accent===c?'2px solid currentColor':'none'}}
        />
       ))}
      </div>
     </div>

     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Image size={16}/> تصویر پس‌زمینه گفتگو</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
       {wallpapers.map(([v,label])=>(
        <button
         type="button"
         key={v}
         onClick={()=>update({wallpaper:v})}
         className={
          "min-h-12 rounded-xl border app-border text-sm "+
          (prefs.wallpaper===v?'bg-[var(--chat-accent)] text-white':'bg-[var(--surface-2)]')
         }
        >
         {label}
         {prefs.wallpaper===v?<Check size={14} className="inline mr-1"/>:null}
        </button>
       ))}
      </div>
     </div>

     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Type size={16}/> اندازه نوشته‌ها</div>
      <div className="grid grid-cols-3 gap-2 mt-3">
       {([
        ['small','کوچک'],
        ['normal','استاندارد'],
        ['large','بزرگ']
       ] as const).map(([v,label])=>(
        <button
         type="button"
         key={v}
         onClick={()=>update({fontSize:v})}
         className={
          "min-h-12 rounded-xl border app-border text-sm "+
          (prefs.fontSize===v?'bg-[var(--chat-accent)] text-white':'bg-[var(--surface-2)]')
         }
        >
         {label}
        </button>
       ))}
      </div>
     </div>

     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Languages size={16}/> زبان برنامه</div>
      <div className="grid grid-cols-2 gap-2 mt-3">
       <button
        type="button"
        onClick={()=>update({language:'fa'})}
        className={
         "min-h-12 rounded-xl border app-border text-sm "+
         (prefs.language==='fa'?'bg-[var(--chat-accent)] text-white':'bg-[var(--surface-2)]')
        }
       >فارسی</button>
       <button
        type="button"
        onClick={()=>update({language:'en'})}
        className={
         "min-h-12 rounded-xl border app-border text-sm "+
         (prefs.language==='en'?'bg-[var(--chat-accent)] text-white':'bg-[var(--surface-2)]')
        }
       >English</button>
      </div>
      <div className="text-[11px] app-muted mt-2">انتخاب زبان و تنظیمات ظاهر برای همین حساب ذخیره می‌شود.</div>
     </div>
     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Bell size={16}/> اعلان‌ها و تماس‌ها</div>
      <div className="mt-3 space-y-2">
       {([
        ['notificationsEnabled','اعلان پیام و تماس',<Bell size={15}/>],
        ['soundsEnabled','صدای اعلان',prefs.soundsEnabled?<Volume2 size={15}/>:<VolumeX size={15}/>],
        ['vibrationEnabled','لرزش اعلان تماس',<Phone size={15}/>]
       ] as const).map(([key,label,icon])=>{
        const enabled=prefs[key as keyof ChatPreferences] as boolean;
        return <button key={key} type="button" onClick={()=>update({[key]:!enabled} as Partial<ChatPreferences>)} className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5">
         <span className="text-[var(--primary)]">{icon}</span><span className="flex-1 text-right text-sm">{label}</span><span className={"w-10 h-6 rounded-full p-1 transition "+(enabled?'bg-[var(--chat-accent)]':'bg-black/15 dark:bg-white/15')}><span className={"block h-4 w-4 rounded-full bg-white transition "+(enabled?'mr-4':'mr-0')}/></span>
        </button>
       })}
      </div>
     </div>

     <div className="rounded-2xl border app-border p-4">
      <div className="flex items-center gap-2 font-bold text-sm"><Send size={16}/> رفتار و نمایش چت</div>
      <div className="mt-3 space-y-2">
       {([
        ['sendOnEnter','Enter برای ارسال'],
        ['compactMode','نمایش فشرده و خلوت'],
        ['showSenderNames','نمایش نام فرستنده در گروه'],
        ['showMessagePreview','نمایش پیش‌نمایش پیام در اعلان']
       ] as const).map(([key,label])=>{
        const enabled=prefs[key];
        return <button key={key} type="button" onClick={()=>update({[key]:!enabled})} className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5">
         <span className="text-[var(--primary)]">{enabled?<Check size={15}/>:<X size={15}/>}</span><span className="flex-1 text-right text-sm">{label}</span><span className={"w-10 h-6 rounded-full p-1 transition "+(enabled?'bg-[var(--chat-accent)]':'bg-black/15 dark:bg-white/15')}><span className={"block h-4 w-4 rounded-full bg-white transition "+(enabled?'mr-4':'mr-0')}/></span>
        </button>
       })}
      </div>
     </div>
    </div>

    <footer
     className="sticky bottom-0 p-4 border-t app-border bg-[var(--surface)]"
     style={{paddingBottom:'max(16px,env(safe-area-inset-bottom))'}}
    >
     <button
      type="button"
      onClick={()=>void save()}
      disabled={busy}
      className="w-full min-h-12 rounded-2xl bg-[var(--chat-accent)] text-white font-bold disabled:opacity-50"
     >
      <Save size={16} className="inline ml-1"/>
      {saved?'ذخیره شد':'ذخیره تنظیمات'}
     </button>
    </footer>
   </section>
  </div>
 );
};
