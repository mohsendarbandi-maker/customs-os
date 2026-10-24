import React,{useCallback,useEffect,useState} from "react";
import {ArrowLeft,RefreshCw,Send,Plug,UploadCloud,CheckCircle2,ShieldAlert,ChevronDown,MessageSquare,FileArchive,Settings2,HelpCircle} from "lucide-react";
import {useNavigate} from "react-router-dom";
import {supabase} from "../lib/supabase";
import {listConversations} from "../features/chat/api";
import type {ChatConversation} from "../features/chat/types";
type Conn={id:string;platform:string;display_name:string;external_account_id:string;enabled:boolean};
type Chat={id:string;connection_id:string;external_chat_id:string;display_name:string|null;purpose:string;enabled:boolean;conversation_id:string|null};
type MessageLog={id:string;connection_id:string;direction:string;message_type:string;external_message_id:string;external_chat_id:string;status:string;payload_summary:Record<string,any>|null;created_at:string;file_asset_id:string|null};
const names:Record<string,string>={telegram:"تلگرام",bale:"بله",rubika:"روبیکا",whatsapp:"واتساپ"};
const field="w-full rounded-xl border app-border bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]";
export const MessengerIntegrationsPage:React.FC=()=>{
 const nav=useNavigate(),[connections,setConnections]=useState<Conn[]>([]),[chats,setChats]=useState<Chat[]>([]),[conversations,setConversations]=useState<ChatConversation[]>([]),[messages,setMessages]=useState<MessageLog[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState(""),[verifyToken,setVerifyToken]=useState("");
 const [platform,setPlatform]=useState("telegram"),[displayName,setDisplayName]=useState(""),[accessToken,setAccessToken]=useState(""),[phoneNumberId,setPhoneNumberId]=useState(""),[appSecret,setAppSecret]=useState(""),[webhookSecret,setWebhookSecret]=useState("");
 const [connectionId,setConnectionId]=useState(""),[externalChatId,setExternalChatId]=useState(""),[chatName,setChatName]=useState(""),[purpose,setPurpose]=useState("inbox"),[conversationId,setConversationId]=useState(""),[chatSelection,setChatSelection]=useState(""),[message,setMessage]=useState(""),[file,setFile]=useState<File|null>(null),[lastAssetId,setLastAssetId]=useState("");
 const [transferConnectionId,setTransferConnectionId]=useState(""),[transferChatId,setTransferChatId]=useState("");
 const api=useCallback(async(path:string,init:RequestInit={})=>{const {data}=await supabase.auth.getSession();const jwt=data.session?.access_token;if(!jwt)throw new Error("نشست معتبر نیست؛ دوباره وارد شوید.");const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+jwt);headers.set("apikey",(import.meta as any).env.VITE_SUPABASE_ANON_KEY||"");if(typeof init.body==="string"&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");const res=await fetch(path,{...init,headers,cache:"no-store"});const ct=res.headers.get("content-type")||"",d=ct.includes("application/json")?await res.json():await res.text();if(!res.ok||d?.ok===false)throw new Error(d?.error||"درخواست ناموفق بود.");return d;},[]);
 const refresh=useCallback(async()=>{setBusy(true);try{const [a,b,m,coreConversations]=await Promise.all([api("/api/messenger/connections"),api("/api/messenger/chats"),api("/api/messenger/messages"),listConversations()]);setConnections(a.connections||[]);setChats(b.chats||[]);setMessages(m.messages||[]);setConversations(coreConversations||[]);if(!connectionId&&a.connections?.[0])setConnectionId(a.connections[0].id);}catch(e){setError(e instanceof Error?e.message:"دریافت اطلاعات ناموفق بود");}finally{setBusy(false);}},[api,connectionId]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{const timer=window.setInterval(()=>{void api("/api/messenger/messages").then(d=>setMessages(d.messages||[])).catch(()=>undefined);},10000);return ()=>window.clearInterval(timer);},[api]);
 const create=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{const d=await api("/api/messenger/connections",{method:"POST",body:JSON.stringify({platform,displayName,accessToken,phoneNumberId,appSecret,webhookSecret})});setNotice((d.note||"اتصال ایجاد شد.")+(d.webhookUrl?" آدرس وب‌هوک: "+d.webhookUrl:""));if(d.verifyToken){setVerifyToken(d.verifyToken);setNotice("Callback URL: "+(d.webhookUrl||"")+". توکن تأیید را همین حالا در Meta وارد کنید.");}setAccessToken("");setAppSecret("");setWebhookSecret("");await refresh();if(d.connection?.id)setConnectionId(d.connection.id);}catch(e){setError(e instanceof Error?e.message:"ایجاد اتصال ناموفق بود");}finally{setBusy(false);}};
 const saveChat=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{await api("/api/messenger/chats",{method:"POST",body:JSON.stringify({connectionId,externalChatId,displayName:chatName,chatType:"unknown",purpose,conversationId:conversationId||null})});setNotice("مقصد مجاز ثبت شد.");setExternalChatId("");setChatName("");await refresh();}catch(e){setError(e instanceof Error?e.message:"ثبت مقصد ناموفق بود");}finally{setBusy(false);}};
 const activeChat=chats.find(c=>c.id===chatSelection);
 const send=async(e:React.FormEvent)=>{e.preventDefault();if(!activeChat)return;setBusy(true);setError("");try{await api("/api/messenger/messages",{method:"POST",body:JSON.stringify({connectionId:activeChat.connection_id,chatId:activeChat.external_chat_id,text:message})});setMessage("");setNotice("پیام ارسال شد.");}catch(e){setError(e instanceof Error?e.message:"ارسال پیام ناموفق بود");}finally{setBusy(false);}};
 const upload=async(e:React.FormEvent)=>{e.preventDefault();if(!file||!activeChat)return;setBusy(true);setError("");try{const d=await api("/api/messenger/uploads/"+activeChat.connection_id+"?chatId="+encodeURIComponent(activeChat.external_chat_id),{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream","X-File-Name":encodeURIComponent(file.name),"X-File-Size":String(file.size)},body:file});setLastAssetId(d.fileAssetId||"");setNotice("فایل استریم و ارسال شد؛ محتوای باینری در سامانه نگهداری نشد.");setFile(null);}catch(e){setError(e instanceof Error?e.message:"ارسال فایل ناموفق بود");}finally{setBusy(false);}};
 const transfer=async(e?:React.FormEvent)=>{e?.preventDefault();if(!transferConnectionId||!transferChatId||!lastAssetId)return;if(activeChat?.connection_id===transferConnectionId){setError("برای انتقال فایل، اتصال مقصد باید با اتصال مبدأ متفاوت باشد.");return;}setBusy(true);setError("");try{await api("/api/messenger/transfers",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({fileAssetId:lastAssetId,destinationConnectionId:transferConnectionId,destinationChatId:transferChatId})});setNotice("درخواست انتقال فایل ثبت شد.");}catch(e){setError(e instanceof Error?e.message:"انتقال ناموفق بود");}finally{setBusy(false);}};
 const transferChats=chats.filter(c=>c.connection_id===transferConnectionId&&c.enabled);
 return <main dir="rtl" className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-4 md:p-6">
 <header className="flex items-center justify-between gap-3 rounded-2xl border app-border bg-[var(--surface)] p-4">
  <div className="flex min-w-0 items-center gap-3">
   <button type="button" onClick={()=>nav("/settings")} className="shrink-0 rounded-xl border app-border p-2" aria-label="بازگشت به تنظیمات"><ArrowLeft size={18}/></button>
   <div className="min-w-0"><h1 className="text-xl font-black">اتصال پیام‌رسان‌ها</h1><p className="mt-1 text-xs app-muted">همهٔ تنظیمات در بخش‌های بازشونده و مرتب‌شده</p></div>
  </div>
  <button type="button" onClick={()=>void refresh()} disabled={busy} className="flex shrink-0 items-center gap-2 rounded-xl border app-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={16}/> <span className="hidden sm:inline">تازه‌سازی</span></button>
 </header>

 {notice&&<div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"><div className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500"/><div className="min-w-0 break-words">{notice}{verifyToken&&<p className="mt-2 break-all font-mono text-xs">Verify Token: {verifyToken}<button type="button" className="mr-2 underline" onClick={()=>void navigator.clipboard.writeText(verifyToken)}>کپی</button></p>}</div></div></div>}
 {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">{error}</div>}

 <details open className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><Plug size={18}/></span><div><h2 className="font-bold">۱. افزودن اتصال</h2><p className="mt-1 text-xs app-muted">انتخاب پیام‌رسان و واردکردن اطلاعات دسترسی</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="border-t app-border p-4">
   <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
    <label className="block text-xs font-bold sm:col-span-2">پیام‌رسان
     <select className={field+" mt-1"} value={platform} onChange={e=>{setPlatform(e.target.value);setError("");setNotice("");}}><option value="telegram">تلگرام</option><option value="bale">بله</option><option value="whatsapp">واتساپ تجاری (Cloud API)</option><option value="rubika" disabled>روبیکا (API عمومی تأیید نشده)</option></select>
    </label>
    {platform==="whatsapp"&&<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-6 sm:col-span-2">
     <p className="font-bold text-amber-600">قبل از ورود اطلاعات واتساپ</p>
     <p>اگر Meta پیام می‌دهد کشور شما پشتیبانی نمی‌شود، VPN معمولاً مشکل را حل نمی‌کند. دسترسی WhatsApp Business Platform به کشور کسب‌وکار و شمارهٔ ثبت‌شده وابسته است؛ شماره‌های ایران (+98) برای API تجاری پشتیبانی نمی‌شوند. کشور یا مشخصات غیرواقعی وارد نکنید.</p>
     <p className="mt-1">اگر کسب‌وکار واقعاً در کشور پشتیبانی‌شده ثبت شده، از Business Portfolio و شمارهٔ واقعی همان کسب‌وکار استفاده و وضعیت دسترسی را بررسی کنید. در غیر این صورت، فعلاً تلگرام مقصد مطمئن‌تری برای این سامانه است.</p>
     <a className="mt-1 inline-flex items-center gap-1 font-bold underline" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">راهنمای رسمی راه‌اندازی WhatsApp Cloud API <span aria-hidden="true">↗</span></a>
    </div>}
    <label className="block text-xs font-bold">نام اتصال
     <input className={field+" mt-1"} value={displayName} onChange={e=>setDisplayName(e.target.value)} required minLength={2} placeholder={platform==="whatsapp"?"مثلاً WhatsApp شرکت":"مثلاً ربات Customs OS"}/>
    </label>
    <label className="block text-xs font-bold">{platform==="whatsapp"?"Access Token":"توکن دسترسی"}
     <input className={field+" mt-1"} type="password" autoComplete="off" value={accessToken} onChange={e=>setAccessToken(e.target.value)} required placeholder="توکن صادرشده از پنل رسمی"/>
    </label>
    {platform==="whatsapp"&&<><label className="block text-xs font-bold">Phone Number ID
     <input className={field+" mt-1"} inputMode="numeric" value={phoneNumberId} onChange={e=>setPhoneNumberId(e.target.value)} required placeholder="شناسهٔ شماره در Meta؛ نه خود شماره"/>
    </label><label className="block text-xs font-bold">Meta App Secret
     <input className={field+" mt-1"} type="password" autoComplete="off" value={appSecret} onChange={e=>setAppSecret(e.target.value)} required placeholder="از تنظیمات اپ Meta"/>
    </label></>}
    {platform!=="whatsapp"&&<label className="block text-xs font-bold sm:col-span-2">کلید وب‌هوک (اختیاری)
     <input className={field+" mt-1"} value={webhookSecret} onChange={e=>setWebhookSecret(e.target.value)} autoComplete="off" placeholder="خالی بماند تا کلید امن تولید شود"/>
    </label>}
    <button disabled={busy||platform==="rubika"} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"><CheckCircle2 size={17}/> آزمایش و ثبت اتصال</button>
    <p className="text-xs app-muted sm:col-span-2">توکن‌ها در مرورگر نگهداری نمی‌شوند و در Supabase Vault رمزنگاری می‌شوند.</p>
   </form>
  </div>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><Settings2 size={18}/></span><div><h2 className="font-bold">۲. اتصال‌های ثبت‌شده</h2><p className="mt-1 text-xs app-muted">{connections.length} اتصال · آزمایش سلامت و ثبت وب‌هوک</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="space-y-2 border-t app-border p-4">
   {connections.length===0&&<p className="text-sm app-muted">هنوز اتصالی ثبت نشده است.</p>}
   {connections.map(c=><article key={c.id} className="rounded-xl border app-border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><b>{names[c.platform]||c.platform} · {c.display_name}</b><div className="mt-1 break-all text-xs app-muted">{c.platform==="whatsapp"?"Phone Number ID: ":"شناسهٔ حساب: "}{c.external_account_id}</div></div><span className={c.enabled?"rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600":"rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-600"}>{c.enabled?"فعال":"غیرفعال"}</span></div>
    <div className="mt-3 flex flex-wrap gap-2">
     <button type="button" onClick={async()=>{setBusy(true);setError("");try{const d=await api("/api/messenger/connections/"+c.id+"/test",{method:"POST"});setNotice("اتصال سالم است: "+(d.account?.username||d.account?.displayPhoneNumber||d.account?.verifiedName||d.account?.id||"تأیید شد"));}catch(e){setError(e instanceof Error?e.message:"آزمایش اتصال ناموفق بود");}finally{setBusy(false);}}} disabled={busy} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-50">آزمایش اتصال</button>
     {c.platform!=="whatsapp"&&<button type="button" onClick={async()=>{setBusy(true);setError("");try{const d=await api("/api/messenger/connections/"+c.id+"/register-webhook",{method:"POST"});setNotice("وب‌هوک ثبت شد: "+d.webhookUrl);}catch(e){setError(e instanceof Error?e.message:"ثبت وب‌هوک ناموفق بود");}finally{setBusy(false);}}} disabled={busy} className="rounded-lg border app-border px-3 py-2 text-xs disabled:opacity-50">ثبت دوبارهٔ وب‌هوک</button>}
    </div>
   </article>)}
  </div>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><FileArchive size={18}/></span><div><h2 className="font-bold">۳. مقصدها و کانال گزارش</h2><p className="mt-1 text-xs app-muted">آرشیو فایل، گزارش روزانه، اعلان‌ها و گفتگوی داخلی</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="border-t app-border p-4">
   <form onSubmit={saveChat} className="grid gap-3 sm:grid-cols-2">
    <label className="block text-xs font-bold">اتصال پیام‌رسان
     <select className={field+" mt-1"} value={connectionId} onChange={e=>setConnectionId(e.target.value)} required><option value="">انتخاب اتصال</option>{connections.map(c=><option key={c.id} value={c.id}>{names[c.platform]||c.platform} · {c.display_name}{c.enabled?"":" · غیرفعال"}</option>)}</select>
    </label>
    <label className="block text-xs font-bold">نوع مقصد
     <select className={field+" mt-1"} value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="file_archive">آرشیو فایل‌ها</option><option value="daily_report">گزارش روزانه</option><option value="inbox">گفتگوی دوطرفه</option><option value="shipment_notifications">اعلان محموله</option><option value="shipment">گفتگوی اختصاصی محموله</option></select>
    </label>
    <label className="block text-xs font-bold">Chat ID یا شمارهٔ مقصد
     <input className={field+" mt-1"} value={externalChatId} onChange={e=>setExternalChatId(e.target.value)} required placeholder="شناسهٔ گروه/چت یا شمارهٔ بین‌المللی"/>
    </label>
    <label className="block text-xs font-bold">نام نمایشی مقصد
     <input className={field+" mt-1"} value={chatName} onChange={e=>setChatName(e.target.value)} placeholder="مثلاً آرشیو اسناد Customs OS"/>
    </label>
    <label className="block text-xs font-bold sm:col-span-2">گفتگوی داخلی Customs OS
     <select className={field+" mt-1"} value={conversationId} onChange={e=>setConversationId(e.target.value)} required={["inbox","shipment_notifications","shipment"].includes(purpose)}><option value="">بدون اتصال به گفتگوی داخلی</option>{conversations.map(c=><option key={c.conversation_id} value={c.conversation_id}>{c.display_name||c.title||"گفتگو"}{c.hierarchy_kind==="owner_group"?" · صاحب کالا":c.hierarchy_kind==="shipment_group"?" · محموله":""}</option>)}</select>
    </label>
    <p className="text-xs leading-5 app-muted sm:col-span-2">برای گفتگوی دوطرفه و اعلان محموله، گفتگوی داخلی الزامی است. آرشیو فایل و گزارش روزانه می‌توانند مقصد مستقلی داشته باشند.</p>
    <button disabled={busy||!connectionId||(["inbox","shipment_notifications","shipment"].includes(purpose)&&!conversationId)} className="w-full rounded-xl border app-border px-4 py-3 text-sm font-bold disabled:opacity-50 sm:col-span-2">ذخیرهٔ مقصد</button>
   </form>
   <div className="mt-4 border-t app-border pt-4"><p className="mb-2 text-sm font-bold">مقصدهای موجود</p>
    <div className="space-y-2">{chats.length===0&&<p className="text-sm app-muted">مقصدی ثبت نشده است.</p>}
     {chats.map(c=><details key={c.id} className="group rounded-xl border app-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden"><div className="min-w-0"><b className="break-words text-sm">{c.display_name||c.external_chat_id}</b><p className="mt-1 break-all text-xs app-muted">{names[connections.find(x=>x.id===c.connection_id)?.platform||""]||""} · {c.external_chat_id}</p></div><ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180"/></summary>
      <div className="space-y-2 border-t app-border p-3 text-xs"><p>کاربرد: {c.purpose==="inbox"?"گفتگوی دوطرفه":c.purpose==="file_archive"?"آرشیو فایل":c.purpose==="daily_report"?"گزارش روزانه":c.purpose==="shipment_notifications"?"اعلان محموله":"محموله"}</p><p>گفتگوی داخلی: {conversations.find(x=>x.conversation_id===c.conversation_id)?.display_name||conversations.find(x=>x.conversation_id===c.conversation_id)?.title||(c.conversation_id?"متصل":"بدون اتصال")}</p><span className={c.enabled?"text-emerald-600":"text-amber-600"}>{c.enabled?"فعال":"غیرفعال"}</span><div><button type="button" className="rounded-lg border app-border px-3 py-2 font-bold" onClick={()=>{setConnectionId(c.connection_id);setExternalChatId(c.external_chat_id);setChatName(c.display_name||"");setPurpose(c.purpose);setConversationId(c.conversation_id||"");}}>بارگذاری در فرم برای ویرایش</button></div></div>
     </details>)}
    </div>
   </div>
  </div>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><Send size={18}/></span><div><h2 className="font-bold">۴. ارسال پیام</h2><p className="mt-1 text-xs app-muted">انتخاب مقصد از فهرست به‌جای واردکردن شناسه</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <form onSubmit={send} className="space-y-3 border-t app-border p-4">
   <label className="block text-xs font-bold">مقصد
    <select className={field+" mt-1"} value={chatSelection} onChange={e=>setChatSelection(e.target.value)} required><option value="">انتخاب مقصد</option>{chats.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.display_name||c.external_chat_id} · {names[connections.find(x=>x.id===c.connection_id)?.platform||""]||""}</option>)}</select>
   </label>
   <label className="block text-xs font-bold">متن پیام
    <textarea className={field+" mt-1 min-h-24"} value={message} onChange={e=>setMessage(e.target.value)} maxLength={4000} required placeholder="متن پیام را وارد کنید"/>
   </label>
   <button disabled={busy||!activeChat} className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">ارسال پیام</button>
  </form>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><UploadCloud size={18}/></span><div><h2 className="font-bold">۵. ارسال و انتقال فایل</h2><p className="mt-1 text-xs app-muted">انتخاب مقصد از فهرست‌های کشویی</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="space-y-5 border-t app-border p-4">
   <form onSubmit={upload} className="space-y-3">
    <label className="block text-xs font-bold">مقصد ارسال فایل
     <select className={field+" mt-1"} value={chatSelection} onChange={e=>setChatSelection(e.target.value)} required><option value="">انتخاب مقصد فعال</option>{chats.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.display_name||c.external_chat_id} · {names[connections.find(x=>x.id===c.connection_id)?.platform||""]||""}</option>)}</select>
    </label>
    <label className="block text-xs font-bold">فایل
     <input className={field+" mt-1"} type="file" onChange={e=>setFile(e.target.files?.[0]||null)} required/>
    </label>
    <p className="text-xs app-muted">فایل به مقصد انتخاب‌شده در همین بخش ارسال می‌شود.</p>
    <button disabled={busy||!file||!activeChat} className="w-full rounded-xl border app-border px-4 py-3 text-sm font-bold disabled:opacity-50">استریم و ارسال فایل</button>
   </form>
   {lastAssetId&&<form onSubmit={e=>void transfer(e)} className="space-y-3 border-t app-border pt-4">
    <div><p className="font-bold text-sm">انتقال آخرین فایل ارسال‌شده</p><p className="mt-1 break-all text-xs app-muted">شناسهٔ فایل: {lastAssetId}</p></div>
    <label className="block text-xs font-bold">اتصال مقصد
     <select className={field+" mt-1"} value={transferConnectionId} onChange={e=>{setTransferConnectionId(e.target.value);setTransferChatId("");}} required><option value="">انتخاب پیام‌رسان مقصد</option>{connections.filter(c=>c.enabled&&c.id!==activeChat?.connection_id).map(c=><option key={c.id} value={c.id}>{names[c.platform]||c.platform} · {c.display_name}</option>)}</select>
    </label>
    <label className="block text-xs font-bold">مقصد در پیام‌رسان انتخاب‌شده
     <select className={field+" mt-1"} value={transferChatId} onChange={e=>setTransferChatId(e.target.value)} required disabled={!transferConnectionId}><option value="">ابتدا اتصال مقصد را انتخاب کنید</option>{transferChats.map(c=><option key={c.id} value={c.external_chat_id}>{c.display_name||c.external_chat_id} · {c.external_chat_id}</option>)}</select>
    </label>
    <button disabled={busy||!lastAssetId||!transferConnectionId||!transferChatId} className="w-full rounded-xl border app-border px-4 py-3 text-sm font-bold disabled:opacity-50">انتقال به مقصد انتخاب‌شده</button>
   </form>}
  </div>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><MessageSquare size={18}/></span><div><h2 className="font-bold">۶. تاریخچهٔ پیام‌ها</h2><p className="mt-1 text-xs app-muted">{messages.length} پیام ثبت‌شده · نمایش ۳۰ پیام اخیر</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="border-t app-border p-4">
   <div className="mb-3 flex justify-end"><button type="button" onClick={()=>void refresh()} disabled={busy} className="rounded-lg border app-border px-3 py-2 text-xs">تازه‌سازی پیام‌ها</button></div>
   <div className="space-y-2">{messages.length===0&&<p className="text-sm app-muted">هنوز پیامی ثبت نشده است.</p>}
    {messages.slice(0,30).map(m=><article key={m.id} className="rounded-xl border app-border p-3">
     <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><b>{m.direction==="inbound"?"دریافتی":"ارسالی"} · {m.payload_summary?.senderName||chats.find(c=>c.connection_id===m.connection_id&&c.external_chat_id===m.external_chat_id)?.display_name||m.external_chat_id} · {m.payload_summary?.text?"متن":m.message_type==="document"?"فایل":"پیام"}</b><span className="app-muted">{new Date(m.created_at).toLocaleString("fa-IR-u-ca-persian",{timeZone:"Asia/Tehran"})}</span></div>
     <p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.payload_summary?.text||(m.message_type==="document"?(m.payload_summary?.name||"فایل دریافتی"):m.payload_summary&&Object.prototype.hasOwnProperty.call(m.payload_summary,"text")?"متن این پیام در نسخهٔ قبلی خالی ذخیره شده؛ برای ثبت متن، پیام را دوباره در تلگرام بفرستید.":"این پیام پیش از فعال‌شدن ذخیرهٔ متن ثبت شده و متن اصلی در داده‌های موجود نیست.")}</p>
     <p className="mt-1 break-all text-[11px] app-muted">Chat ID: {m.external_chat_id} · وضعیت: {m.status}</p>
    </article>)}</div>
  </div>
 </details>

 <details className="group overflow-hidden rounded-2xl border app-border bg-[var(--surface)]">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
   <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[var(--surface-2)] p-2"><HelpCircle size={18}/></span><div><h2 className="font-bold">راهنمای رفع مشکل واتساپ</h2><p className="mt-1 text-xs app-muted">کدام خطا با VPN حل می‌شود و کدام به محدودیت کشور مربوط است؟</p></div></div>
   <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="space-y-3 border-t app-border p-4 text-sm leading-7">
   <p><b>اگر پیام صریحاً می‌گوید «این کشور پشتیبانی نمی‌شود»:</b> ابتدا کشور Business Portfolio، کشور قانونی کسب‌وکار و کد کشور شماره را بررسی کن؛ VPN فقط مسیر اتصال اینترنت را تغییر می‌دهد و محدودیت واجدشرایط‌بودن کشور را برطرف نمی‌کند.</p>
   <p>اگر شمارهٔ API با کد ‎+98 است یا کسب‌وکار در کشور محدودشده ثبت شده، مسیر رسمی WhatsApp Business Platform برای آن قابل استفاده نیست. از شمارهٔ اجاره‌ای یا کشور و مشخصات غیرواقعی برای دورزدن بررسی Meta استفاده نکن.</p>
   <p>اگر شرکت واقعاً در کشور پشتیبانی‌شده ثبت شده است، راهکار درست استفاده از Business Portfolio واقعی همان شرکت و شماره‌ای است که امکان دریافت پیامک یا تماس تأیید را دارد؛ سپس باید دسترسی Cloud API برای همان دارایی تأیید شود. <a className="font-bold underline" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">راهنمای Meta</a> · <a className="font-bold underline" href="https://www.twilio.com/docs/api/errors/63058" target="_blank" rel="noreferrer">توضیح محدودیت کشورها</a>.</p>
   <p className="rounded-xl border app-border bg-[var(--surface-2)] p-3">برای آرشیو فایل، گزارش روزانه و اعلان‌های داخلی Customs OS، فعلاً از تلگرام استفاده کن. اتصال بله هم در سامانه پشتیبانی می‌شود؛ واتساپ را بعد از تأیید واجدشرایط‌بودن Meta وصل می‌کنیم.</p>
  </div>
 </details>

 <div className="rounded-xl border app-border p-3 text-xs leading-6 app-muted"><ShieldAlert size={16} className="ml-1 inline-block align-middle"/><span>روبیکا تا زمان تأیید API عمومی و مجاز غیرفعال است. در واتساپ، پنل این سامانه به اطلاعات معتبر Cloud API نیاز دارد؛ در صورت محدودیت کشور، قبل از واردکردن توکن‌ها ابتدا واجدشرایط‌بودن حساب را بررسی کن.</span></div>
</main>;
};