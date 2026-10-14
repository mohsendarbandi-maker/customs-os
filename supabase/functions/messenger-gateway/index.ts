import { createClient } from "npm:@supabase/supabase-js@2";

type Platform = "telegram" | "bale" | "rubika" | "whatsapp";
type Conn = { id:string; organization_id:string; platform:Platform; external_account_id:string; display_name:string; secret_ref:string; webhook_secret_ref:string; verify_token_ref:string|null; app_secret_ref:string|null; config:Record<string,any>; enabled:boolean; created_by?:string|null };
type Profile = { id:string; organization_id:string; role:string; is_active:boolean; client_id?:string|null };
const SB = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLIC_BASE = (Deno.env.get("CUSTOMS_PUBLIC_BASE_URL") || "https://darbandicommercial.ir").replace(/\/+$/, "");
const ORIGINS = new Set(["https://darbandicommercial.ir","https://chat.darbandicommercial.ir"]);
const db = createClient(SB,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const noStore = {"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff"};
const TG_UPLOAD_LIMIT = 50 * 1024 * 1024;
const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const WA_DOCUMENT_LIMIT = 100 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (s:string)=>uuid.test(s);
const isPlatform = (v:unknown):v is Platform=>["telegram","bale","rubika","whatsapp"].includes(String(v));
const manager = (p:Profile)=>p.role==="owner"||p.role==="admin";
const errorCode = (e:unknown)=>(e instanceof Error?e.message:String(e)).replace(/[^A-Za-z0-9_.:-]/g,"_").slice(0,96)||"UPSTREAM_ERROR";
const cleanName = (s:string)=>s.normalize("NFKC").replace(/[\/\\]/g,"_").split("").map(ch=>{const n=ch.charCodeAt(0);return n<32||n===127?"_":ch;}).join("").replace(/^\.+/,"").trim().slice(0,180)||"document.bin";
const cleanMime = (s:string|null)=>{const v=(s||"application/octet-stream").split(";")[0].trim().toLowerCase();return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(v)?v:"application/octet-stream";};
const token = (n=32)=>{const b=crypto.getRandomValues(new Uint8Array(n));return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");};
function out(body:unknown,status=200,req?:Request){const h=new Headers({...noStore,"Content-Type":"application/json; charset=utf-8"});const origin=req?.headers.get("Origin")||"";if(ORIGINS.has(origin)){h.set("Access-Control-Allow-Origin",origin);h.set("Vary","Origin");h.set("Access-Control-Allow-Headers","authorization, apikey, content-type, x-file-name, x-file-size, idempotency-key");h.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");}return new Response(JSON.stringify(body),{status,headers:h});}
const bad=(code:string,status=400,req?:Request)=>out({ok:false,error:code},status,req);
async function readText(req:Request,limit:number){const claimed=Number(req.headers.get("content-length")||0);if(claimed>limit)throw new Error("BODY_TOO_LARGE");if(!req.body)return "";const r=req.body.getReader(),chunks:Uint8Array[]=[];let total=0;try{let done=false;while(!done){const p=await r.read();if(p.done){done=true;continue;}total+=p.value.byteLength;if(total>limit){await r.cancel();throw new Error("BODY_TOO_LARGE");}chunks.push(p.value);}}finally{try{r.releaseLock();}catch{}}const all=new Uint8Array(total);let off=0;for(const c of chunks){all.set(c,off);off+=c.byteLength;}return new TextDecoder().decode(all);}
async function bodyJson(req:Request){const raw=await readText(req,100*1024);if(!raw)return {};const v=JSON.parse(raw);if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("INVALID_JSON");return v as Record<string,any>;}
async function context(req:Request){const jwt=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!jwt||!ANON)throw new Error("AUTH_REQUIRED");const anon=createClient(SB,ANON,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+jwt}}});const {data,error}=await anon.auth.getUser(jwt);if(error||!data.user)throw new Error("AUTH_INVALID");const {data:p,error:pe}=await db.from("profiles").select("id,organization_id,role,is_active,client_id").eq("id",data.user.id).maybeSingle();if(pe||!p||!p.is_active||!p.organization_id)throw new Error("PROFILE_UNAVAILABLE");return {userId:data.user.id,p:p as Profile};}
function onlyManager(p:Profile){if(!manager(p))throw new Error("MANAGER_REQUIRED");}
async function secret(ref:string|null){if(!ref)return null;if(!ref.startsWith("vault:"))return Deno.env.get(ref)||null;const id=ref.slice(6);if(!validId(id))return null;const {data,error}=await db.rpc("messenger_vault_get_secrets",{p_secret_ids:[id]});if(error||!Array.isArray(data))throw new Error("VAULT_READ_FAILED");return data.find((x:any)=>x.secret_id===id)?.decrypted_secret||null;}
async function saveSecret(v:string,name:string){const {data,error}=await db.rpc("messenger_vault_create_secret",{p_secret:v,p_name:name,p_description:"Encrypted Customs OS messenger credential"});if(error||typeof data!=="string"||!validId(data))throw new Error("VAULT_WRITE_FAILED");return "vault:"+data;}
async function readConn(id:string,disabled=false):Promise<Conn|null>{if(!validId(id))return null;const {data,error}=await db.from("messenger_connections").select("*").eq("id",id).maybeSingle();return error||!data||(!disabled&&!data.enabled)?null:data as Conn;}
async function ownedConn(id:string,org:string,disabled=false){const c=await readConn(id,disabled);if(!c||c.organization_id!==org)throw new Error("CONNECTION_NOT_FOUND");return c;}
async function accessToken(c:Conn){const s=await secret(c.secret_ref);if(!s)throw new Error("CREDENTIAL_MISSING");return s;}
function botBase(c:Conn,t:string){if(c.platform==="telegram")return "https://api.telegram.org/bot"+t+"/";if(c.platform==="bale")return "https://tapi.bale.ai/bot"+t+"/";throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");}
function graphBase(c:Conn){return "https://graph.facebook.com/"+String(c.config.apiVersion||"v26.0").replace(/^v?/,"v")+"/";}
async function apiJson(url:string,init?:RequestInit){const r=await fetch(url,init);const raw=await r.text();let data:any={};try{data=raw?JSON.parse(raw):{};}catch{}if(!r.ok||data.ok===false||data.error)throw new Error("UPSTREAM_"+r.status);return data;}
async function graph(c:Conn,path:string,init?:RequestInit){const t=await accessToken(c),h=new Headers(init?.headers);h.set("Authorization","Bearer "+t);if(init?.body&&!h.has("Content-Type"))h.set("Content-Type","application/json");return await fetch(graphBase(c)+path.replace(/^\/+/,""),{...init,headers:h});}
async function probe(c:Conn){if(c.platform==="rubika")throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");if(c.platform==="whatsapp"){const r=await graph(c,encodeURIComponent(String(c.config.phoneNumberId||c.external_account_id))+"?fields=id,display_phone_number,verified_name");const d=await r.json() as any;if(!r.ok||d.error)throw new Error("WHATSAPP_CREDENTIAL_CHECK_FAILED");return {id:d.id,displayPhoneNumber:d.display_phone_number||null,verifiedName:d.verified_name||null};}const d=await apiJson(botBase(c,await accessToken(c))+"getMe");return {id:d.result?.id,username:d.result?.username||null,firstName:d.result?.first_name||null};}
function hookUrl(c:Conn){return PUBLIC_BASE+"/webhooks/messenger/"+c.platform+"/"+c.id;}
async function registerHook(c:Conn){if(c.platform==="telegram"){const t=await accessToken(c),s=await secret(c.webhook_secret_ref);if(!s||!/^[A-Za-z0-9_-]{1,256}$/.test(s))throw new Error("INVALID_TELEGRAM_WEBHOOK_SECRET");await apiJson(botBase(c,t)+"setWebhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:hookUrl(c),secret_token:s,allowed_updates:["message","channel_post","edited_message","edited_channel_post"]})});return hookUrl(c);}if(c.platform==="bale"){const t=await accessToken(c),s=await secret(c.webhook_secret_ref);if(!s||!/^[A-Za-z0-9_-]{20,128}$/.test(s))throw new Error("INVALID_BALE_WEBHOOK_SECRET");const u=PUBLIC_BASE+"/webhooks/messenger/bale/"+c.id+"/"+s;await apiJson(botBase(c,t)+"setWebhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});return u;}if(c.platform==="whatsapp")return hookUrl(c);throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");}
async function addConnection(req:Request,p:Profile,userId:string){onlyManager(p);const b=await bodyJson(req);if(!isPlatform(b.platform))return bad("INVALID_PLATFORM",400,req);const platform=b.platform as Platform;if(platform==="rubika")return bad("PLATFORM_TRANSPORT_UNVERIFIED",422,req);const name=String(b.displayName||"").trim().slice(0,100),access=String(b.accessToken||"").trim(),phone=String(b.phoneNumberId||"").trim(),app=String(b.appSecret||"").trim();if(name.length<2)return bad("DISPLAY_NAME_REQUIRED",400,req);if(!access||access.length>5000)return bad("ACCESS_TOKEN_REQUIRED",400,req);if(platform==="whatsapp"&&(!phone||!app))return bad("WHATSAPP_PHONE_ID_AND_APP_SECRET_REQUIRED",400,req);const verify=platform==="whatsapp"?(String(b.verifyToken||"").trim()||token(24)):null;const wh=platform==="whatsapp"?app:(String(b.webhookSecret||"").trim()||token());if(platform==="telegram"&&!/^[A-Za-z0-9_-]{1,256}$/.test(wh))return bad("INVALID_TELEGRAM_WEBHOOK_SECRET",400,req);if(platform==="bale"&&!/^[A-Za-z0-9_-]{20,128}$/.test(wh))return bad("INVALID_BALE_WEBHOOK_SECRET",400,req);let sr="",wr="",vr:string|null=null,ar:string|null=null;try{sr=await saveSecret(access,"messenger-"+platform+"-access-"+p.organization_id);wr=await saveSecret(wh,"messenger-"+platform+"-webhook-"+p.organization_id);if(verify)vr=await saveSecret(verify,"messenger-whatsapp-verify-"+p.organization_id);if(app)ar=await saveSecret(app,"messenger-whatsapp-app-"+p.organization_id);}catch{return bad("VAULT_WRITE_FAILED",500,req);}const config=platform==="whatsapp"?{phoneNumberId:phone,apiVersion:String(b.apiVersion||"v26.0").replace(/^v?/,"v")}:{ };const external=platform==="whatsapp"?phone:"pending-"+crypto.randomUUID();const {data:c,error}=await db.from("messenger_connections").insert({organization_id:p.organization_id,platform,external_account_id:external,display_name:name,secret_ref:sr,webhook_secret_ref:wr,verify_token_ref:vr,app_secret_ref:ar,config,enabled:false,created_by:userId}).select("*").single();if(error||!c)return bad("CONNECTION_SAVE_FAILED",500,req);let info:any,webhook=hookUrl(c as Conn);try{info=await probe(c as Conn);if(platform!=="whatsapp")webhook=await registerHook(c as Conn);const {error:upError}=await db.from("messenger_connections").update({external_account_id:platform==="whatsapp"?phone:String(info.id||external),enabled:true,updated_at:new Date().toISOString()}).eq("id",c.id);if(upError)throw new Error("CONNECTION_ACTIVATION_FAILED");}catch(e){await db.from("messenger_connections").update({enabled:false,config:{...config,setupError:errorCode(e)},updated_at:new Date().toISOString()}).eq("id",c.id);return out({ok:false,error:errorCode(e),connection:{id:c.id,platform,display_name:name,enabled:false},webhookUrl:webhook,verifyToken:verify||undefined},502,req);}return out({ok:true,connection:{id:c.id,platform,display_name:name,external_account_id:String(info.id||external),enabled:true},account:info,webhookUrl:webhook,verifyToken:verify||undefined,note:platform==="whatsapp"?"Complete callback subscription and verification in Meta Developer settings.":undefined},201,req);}
async function createChat(req:Request,p:Profile,userId:string){
 onlyManager(p);
 const b=await bodyJson(req),cid=String(b.connectionId||""),chatId=String(b.externalChatId||"").trim(),type=String(b.chatType||"unknown"),purpose=String(b.purpose||"inbox"),conversationId=String(b.conversationId||"").trim()||null;
 if(!validId(cid)||!chatId||chatId.length>200)return bad("INVALID_CHAT_INPUT",400,req);
 if(!["private","group","channel","business","unknown"].includes(type)||!["inbox","file_archive","daily_report","shipment_notifications","shipment"].includes(purpose))return bad("INVALID_CHAT_CONFIGURATION",400,req);
 await ownedConn(cid,p.organization_id,true);
 if(purpose==="inbox"&&!validId(conversationId||""))return bad("INTERNAL_CONVERSATION_REQUIRED",400,req);
 if(conversationId){
  if(!validId(conversationId))return bad("INVALID_CONVERSATION_ID",400,req);
  const {data:conversation}=await db.from("chat_conversations").select("id").eq("id",conversationId).eq("organization_id",p.organization_id).is("deleted_at",null).maybeSingle();
  if(!conversation)return bad("CONVERSATION_NOT_FOUND",404,req);
  const {data:member}=await db.from("chat_conversation_members").select("id").eq("conversation_id",conversationId).eq("organization_id",p.organization_id).eq("user_id",userId).is("deleted_at",null).is("left_at",null).maybeSingle();
  if(!member)return bad("CONVERSATION_ACCESS_DENIED",403,req);
 }
 let sid=b.shipmentId?String(b.shipmentId):null;
 if(sid){const {data}=await db.from("shipments").select("id").eq("id",sid).eq("organization_id",p.organization_id).maybeSingle();if(!validId(sid)||!data)return bad("SHIPMENT_NOT_FOUND",404,req);}
 const {data,error}=await db.from("messenger_chats").upsert({
  organization_id:p.organization_id,connection_id:cid,external_chat_id:chatId,chat_type:type,purpose,
  display_name:String(b.displayName||"").slice(0,120)||null,shipment_id:sid,conversation_id:conversationId,enabled:b.enabled!==false
 },{onConflict:"connection_id,external_chat_id"}).select("id,connection_id,external_chat_id,chat_type,purpose,display_name,shipment_id,conversation_id,enabled").single();
 if(error||!data)return bad(error?.message?.includes("CONVERSATION_ORGANIZATION_MISMATCH")?"CONVERSATION_ORGANIZATION_MISMATCH":"CHAT_SAVE_FAILED",500,req);
 return out({ok:true,chat:data},201,req);
}async function sendTextToPlatform(c:Conn,chat:string,message:string){
 if(c.platform==="rubika")throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");
 let msgId="";
 if(c.platform==="whatsapp"){
  const r=await graph(c,String(c.config.phoneNumberId||c.external_account_id)+"/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:chat,type:"text",text:{preview_url:false,body:message}})});
  const d=await r.json() as any;
  if(!r.ok||d.error||!d.messages?.[0]?.id)throw new Error("WHATSAPP_SEND_FAILED");
  msgId=String(d.messages[0].id);
 }else{
  const d=await apiJson(botBase(c,await accessToken(c))+"sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:message,disable_web_page_preview:true})});
  msgId=String(d.result?.message_id||"");
  if(!msgId)throw new Error("MESSAGE_ID_MISSING");
 }
 return msgId;
}
async function sendText(req:Request,p:Profile){
 const b=await bodyJson(req),cid=String(b.connectionId||""),chat=String(b.chatId||""),message=String(b.text||"");
 if(!validId(cid)||!chat||!message.trim()||message.length>4000)return bad("INVALID_MESSAGE",400,req);
 const c=await ownedConn(cid,p.organization_id);
 const {data:mapped}=await db.from("messenger_chats").select("enabled").eq("organization_id",p.organization_id).eq("connection_id",cid).eq("external_chat_id",chat).maybeSingle();
 if(!mapped?.enabled)return bad("CHAT_NOT_ALLOWED",403,req);
 try{
  const msgId=await sendTextToPlatform(c,chat,message);
  await db.from("message_logs").insert({organization_id:p.organization_id,connection_id:c.id,direction:"outbound",message_type:"text",external_message_id:msgId,external_chat_id:chat,status:"sent",payload_summary:{charCount:message.length,text:message.slice(0,4000)},sent_at:new Date().toISOString()});
  return out({ok:true,status:"sent",externalMessageId:msgId},200,req);
 }catch(e){
  const code=errorCode(e);
  await db.from("message_logs").insert({organization_id:p.organization_id,connection_id:c.id,direction:"outbound",message_type:"text",external_chat_id:chat,status:"failed",error_code:code,payload_summary:{charCount:message.length,text:message.slice(0,4000)}});
  return bad(code,502,req);
 }
}function bounded(body:ReadableStream<Uint8Array>,max:number){const r=body.getReader();let total=0;return new ReadableStream<Uint8Array>({async pull(c){const v=await r.read();if(v.done){c.close();try{r.releaseLock();}catch{}return;}total+=v.value.byteLength;if(total>max){await r.cancel();c.error(new Error("FILE_TOO_LARGE"));return;}c.enqueue(v.value);},async cancel(reason){await r.cancel(reason).catch(()=>{});}});}
function multipart(prefix:string,file:ReadableStream<Uint8Array>,suffix:string){const enc=new TextEncoder(),parts=[new Response(enc.encode(prefix)).body!,file,new Response(enc.encode(suffix)).body!];let i=0,r:ReadableStreamDefaultReader<Uint8Array>|null=null;return new ReadableStream<Uint8Array>({async pull(c){while(i<parts.length){if(!r)r=parts[i].getReader();const v=await r.read();if(!v.done){c.enqueue(v.value);return;}r.releaseLock();r=null;i++;}c.close();},async cancel(reason){if(r)await r.cancel(reason).catch(()=>{});for(let n=i+1;n<parts.length;n++)await parts[n].cancel(reason).catch(()=>{});}});}
async function uploadStream(c:Conn,chat:string,name:string,mime:string,size:number|null,stream:ReadableStream<Uint8Array>,mediaKind:"file"|"voice"="file"){
 if(c.platform==="rubika")throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");
 const max=c.platform==="whatsapp"?WA_DOCUMENT_LIMIT:TG_UPLOAD_LIMIT;
 if(size!==null&&size>max)throw new Error("FILE_TOO_LARGE_FOR_DESTINATION");
 const voice=mediaKind==="voice"&&(c.platform!=="telegram"||mime==="audio/ogg"||mime==="audio/opus");
 const boundary="----CustomsOS"+token(16),filename=cleanName(name).replace(/["\r\n]/g,"_");
 const prefix=c.platform==="whatsapp"
  ?"--"+boundary+"\r\nContent-Disposition: form-data; name=\"messaging_product\"\r\n\r\nwhatsapp\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\n"+mime+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+filename+"\"\r\nContent-Type: "+mime+"\r\n\r\n"
  :"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+(voice?"voice":"document")+"\"; filename=\""+filename+"\"\r\nContent-Type: "+mime+"\r\n\r\n";
 const multipartBody=multipart(prefix,bounded(stream,max),"\r\n--"+boundary+"--\r\n");
 if(c.platform==="whatsapp"){
  const pid=String(c.config.phoneNumberId||c.external_account_id);
  const up=await graph(c,pid+"/media",{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary},body:multipartBody});
  const ud=await up.json() as any;
  if(!up.ok||ud.error||!ud.id)throw new Error("WHATSAPP_MEDIA_UPLOAD_FAILED");
  const mediaId=String(ud.id);
  const payload=voice?{messaging_product:"whatsapp",to:chat,type:"audio",audio:{id:mediaId}}:{messaging_product:"whatsapp",to:chat,type:"document",document:{id:mediaId,filename}};
  const send=await graph(c,pid+"/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const sd=await send.json() as any;
  if(!send.ok||sd.error||!sd.messages?.[0]?.id)throw new Error("WHATSAPP_MEDIA_SEND_FAILED");
  return {fileId:mediaId,uniqueId:null,messageId:String(sd.messages[0].id),name:filename};
 }
 const endpoint=voice?"sendVoice":"sendDocument";
 const r=await fetch(botBase(c,await accessToken(c))+endpoint+"?chat_id="+encodeURIComponent(chat),{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary},body:multipartBody});
 const d=await r.json() as any,result=voice?d.result?.voice:d.result?.document;
 if(!r.ok||d.ok===false||!result?.file_id)throw new Error(c.platform.toUpperCase()+"_UPLOAD_FAILED");
 return {fileId:String(result.file_id),uniqueId:result.file_unique_id?String(result.file_unique_id):null,messageId:String(d.result?.message_id||""),name:filename};
}async function storeAsset(org:string,user:string|null,c:Conn,chat:string,result:any,mime:string,size:number|null,source:string,shipment:string|null,recordLog=true){
 const {data:a,error}=await db.from("file_assets").insert({organization_id:org,original_name:result.name,mime_type:mime,size_bytes:size,source_platform:source,created_by:user,metadata:{transferMode:"stream"}}).select("id").single();
 if(error||!a)throw new Error("FILE_METADATA_SAVE_FAILED");
 const {error:le}=await db.from("file_locations").insert({organization_id:org,file_asset_id:a.id,connection_id:c.id,external_file_id:result.fileId,external_file_unique_id:result.uniqueId,external_chat_id:chat,external_message_id:result.messageId,availability_status:"available",metadata:{streamed:true}});
 if(le)throw new Error("FILE_LOCATION_SAVE_FAILED");
 if(shipment){
  const {error:shipmentError}=await db.from("shipment_files").upsert({organization_id:org,shipment_id:shipment,file_asset_id:a.id,document_type:mime==="application/pdf"?"customs_document":"other",created_by:user},{onConflict:"shipment_id,file_asset_id,document_type"});
  if(shipmentError)throw new Error("SHIPMENT_FILE_LINK_FAILED");
 }
 if(recordLog)await db.from("message_logs").insert({organization_id:org,connection_id:c.id,direction:"outbound",message_type:"document",external_message_id:result.messageId,external_chat_id:chat,file_asset_id:a.id,status:"sent",payload_summary:{name:result.name,mimeType:mime,sizeBytes:size},sent_at:new Date().toISOString()});
 return String(a.id);
}async function upload(req:Request,p:Profile,user:string,cid:string){const c=await ownedConn(cid,p.organization_id),u=new URL(req.url),chat=u.searchParams.get("chatId")||"",name=cleanName(decodeURIComponent(req.headers.get("X-File-Name")||u.searchParams.get("filename")||"document.bin")),mime=cleanMime(req.headers.get("Content-Type")),h=req.headers.get("x-file-size")||req.headers.get("content-length"),size=h&&/^\d+$/.test(h)?Number(h):null,max=c.platform==="whatsapp"?100*1024*1024:50*1024*1024;if(!chat||size===0||(size!==null&&size>max)||!req.body)return bad("INVALID_FILE_SIZE_CHAT_OR_BODY",413,req);const {data:mapped}=await db.from("messenger_chats").select("enabled,shipment_id").eq("organization_id",p.organization_id).eq("connection_id",c.id).eq("external_chat_id",chat).maybeSingle();if(!mapped?.enabled)return bad("CHAT_NOT_ALLOWED",403,req);try{const result=await uploadStream(c,chat,name,mime,size,req.body),assetId=await storeAsset(p.organization_id,user,c,chat,result,mime,size,"website",mapped.shipment_id||null);return out({ok:true,fileAssetId:assetId,externalMessageId:result.messageId,sizeBytes:size},201,req);}catch(e){return bad(errorCode(e),502,req);}}
async function sourceFile(c:Conn,fileId:string){if(c.platform==="rubika")throw new Error("PLATFORM_TRANSPORT_UNVERIFIED");if(c.platform==="whatsapp"){const t=await accessToken(c),r=await graph(c,encodeURIComponent(fileId));const d=await r.json() as any;if(!r.ok||d.error||typeof d.url!=="string")throw new Error("WHATSAPP_MEDIA_URL_FAILED");const url=new URL(d.url);if(url.protocol!=="https:"||!(url.hostname.endsWith(".fbsbx.com")||url.hostname.endsWith(".fbcdn.net")||url.hostname.endsWith(".whatsapp.net")))throw new Error("MEDIA_HOST_REJECTED");const media=await fetch(url.toString(),{headers:{Authorization:"Bearer "+t}});if(!media.ok||!media.body)throw new Error("MEDIA_DOWNLOAD_FAILED");const cl=media.headers.get("content-length");return {response:media,size:cl&&/^\d+$/.test(cl)?Number(cl):null};}const t=await accessToken(c),d=await apiJson(botBase(c,t)+"getFile?file_id="+encodeURIComponent(fileId)),path=String(d.result?.file_path||""),size=Number(d.result?.file_size||0)||null;if(!path||(size&&size>TG_DOWNLOAD_LIMIT))throw new Error("SOURCE_FILE_OVER_DOWNLOAD_LIMIT");const base=c.platform==="telegram"?"https://api.telegram.org/file/bot":"https://tapi.bale.ai/file/bot";const r=await fetch(base+t+"/"+path);if(!r.ok||!r.body)throw new Error("SOURCE_FILE_DOWNLOAD_FAILED");return {response:r,size};}
async function authorizeAsset(p:Profile,id:string){const {data:a}=await db.from("file_assets").select("*").eq("id",id).eq("organization_id",p.organization_id).maybeSingle();if(!a)throw new Error("FILE_NOT_FOUND");if(p.role==="client"){const {data:links}=await db.from("shipment_files").select("shipment_id").eq("organization_id",p.organization_id).eq("file_asset_id",id);const ids=(links||[]).map((x:any)=>x.shipment_id);if(!ids.length)throw new Error("FILE_ACCESS_DENIED");const {data:visible}=await db.from("shipments").select("id").eq("organization_id",p.organization_id).eq("client_id",p.client_id||"").in("id",ids);if(!visible?.length)throw new Error("FILE_ACCESS_DENIED");}const {data:locations}=await db.from("file_locations").select("*").eq("organization_id",p.organization_id).eq("file_asset_id",id).eq("availability_status","available").order("created_at");for(const l of locations||[]){const c=await readConn(l.connection_id);if(c&&c.organization_id===p.organization_id)return {asset:a,location:l,connection:c};}throw new Error("SOURCE_CONNECTION_UNAVAILABLE");}
async function download(req:Request,p:Profile,id:string){if(!validId(id))return bad("INVALID_FILE_ID",400,req);try{const x=await authorizeAsset(p,id),f=await sourceFile(x.connection,x.location.external_file_id),h=new Headers(noStore);h.set("Content-Type",cleanMime(x.asset.mime_type));h.set("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(cleanName(x.asset.original_name)));if(f.size!==null)h.set("Content-Length",String(f.size));return new Response(f.response.body,{status:200,headers:h});}catch(e){return bad(errorCode(e),404,req);}}
async function transfer(req:Request,p:Profile,user:string){const b=await bodyJson(req),assetId=String(b.fileAssetId||""),destId=String(b.destinationConnectionId||""),destChat=String(b.destinationChatId||""),key=String(req.headers.get("Idempotency-Key")||b.idempotencyKey||"").trim();if(!validId(assetId)||!validId(destId)||!destChat||!key||key.length>180)return bad("INVALID_TRANSFER_INPUT",400,req);const s=await authorizeAsset(p,assetId),d=await ownedConn(destId,p.organization_id);if(s.connection.id===d.id)return bad("SAME_CONNECTION_USE_PLATFORM_COPY",422,req);const {data:chat}=await db.from("messenger_chats").select("enabled,shipment_id").eq("organization_id",p.organization_id).eq("connection_id",d.id).eq("external_chat_id",destChat).maybeSingle();if(!chat?.enabled)return bad("DESTINATION_CHAT_NOT_ALLOWED",403,req);const {data:job,error}=await db.from("file_transfer_jobs").insert({organization_id:p.organization_id,file_asset_id:assetId,source_location_id:s.location.id,destination_connection_id:d.id,destination_chat_id:destChat,status:"processing",idempotency_key:key,attempt_count:1,created_by:user,locked_until:new Date(Date.now()+8*60*1000).toISOString()}).select("id").single();if(error||!job)return bad(error?.code==="23505"?"IDEMPOTENCY_KEY_ALREADY_USED":"TRANSFER_JOB_CREATE_FAILED",409,req);try{const src=await sourceFile(s.connection,s.location.external_file_id),mime=cleanMime(s.asset.mime_type);if(src.size&&(src.size>(d.platform==="whatsapp"?100*1024*1024:50*1024*1024)))throw new Error("FILE_TOO_LARGE_FOR_DESTINATION");const result=await uploadStream(d,destChat,cleanName(s.asset.original_name),mime,src.size,src.response.body!);const newAsset=await storeAsset(p.organization_id,user,d,destChat,result,mime,src.size,s.connection.platform,chat.shipment_id||null);await db.from("file_transfer_jobs").update({status:"succeeded",result_message_id:result.messageId,completed_at:new Date().toISOString(),locked_until:null,updated_at:new Date().toISOString()}).eq("id",job.id);return out({ok:true,jobId:job.id,sourceFileAssetId:assetId,destinationFileAssetId:newAsset,externalMessageId:result.messageId},201,req);}catch(e){await db.from("file_transfer_jobs").update({status:"retry",last_error_code:errorCode(e),next_attempt_at:new Date(Date.now()+60000).toISOString(),locked_until:null,updated_at:new Date().toISOString()}).eq("id",job.id);return bad("TRANSFER_FAILED_"+errorCode(e),502,req);}}
function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function hex(v:ArrayBuffer){return Array.from(new Uint8Array(v)).map(x=>x.toString(16).padStart(2,"0")).join("");}
async function checkHmac(secretValue:string,raw:string,header:string){if(!header.startsWith("sha256="))return false;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secretValue),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return equal("sha256="+hex(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(raw))),header.toLowerCase());}
async function event(c:Conn,id:string,type:string){const {data,error}=await db.from("webhook_events").upsert({organization_id:c.organization_id,connection_id:c.id,external_event_id:id,event_type:type,status:"received"},{onConflict:"connection_id,external_event_id,event_type",ignoreDuplicates:true}).select("id").maybeSingle();if(error)throw new Error("WEBHOOK_EVENT_SAVE_FAILED");return data?.id?String(data.id):null;}
function tgMedia(m:any){for(const k of ["document","video","audio","voice","animation","video_note"])if(m?.[k]?.file_id){const f=m[k];return{id:String(f.file_id),unique:f.file_unique_id||null,name:f.file_name||(k==="voice"?"voice.ogg":k+".bin"),mime:f.mime_type||"application/octet-stream",size:Number(f.file_size||0)||null,voice:k==="voice"};}if(Array.isArray(m?.photo)&&m.photo.length){const f=m.photo[m.photo.length-1];return{id:String(f.file_id),unique:f.file_unique_id||null,name:"photo.jpg",mime:"image/jpeg",size:Number(f.file_size||0)||null};}return null;}
async function inbound(c:Conn,chatId:string,msgId:string,media:any,messageText:string="",userId?:string,senderName?:string){
 const {data:chat,error:chatError}=await db.from("messenger_chats").select("enabled,shipment_id,conversation_id,purpose").eq("organization_id",c.organization_id).eq("connection_id",c.id).eq("external_chat_id",chatId).maybeSingle();
 if(chatError)throw new Error("CHAT_MAPPING_READ_FAILED");
 if(!chat?.enabled)return;
 if(chat.conversation_id){
  const {data:duplicate}=await db.from("chat_messages").select("id").eq("organization_id",c.organization_id).eq("external_connection_id",c.id).eq("external_chat_id",chatId).eq("external_message_id",msgId).maybeSingle();
  if(duplicate?.id)return;
 }
 let fileAssetId:string|null=null,internalStoragePath:string|null=null,mirrorErrorCode:string|null=null;
 const cleanExternalName=media?cleanName(String(media.name||"document.bin")):null;
 if(media){
  const {data:a,error}=await db.from("file_assets").insert({organization_id:c.organization_id,original_name:cleanExternalName||"document.bin",mime_type:cleanMime(media.mime),size_bytes:media.size||null,source_platform:c.platform,metadata:{inbound:true}}).select("id").single();
  if(error||!a)throw new Error("FILE_METADATA_SAVE_FAILED");
  fileAssetId=String(a.id);
  const {error:le}=await db.from("file_locations").insert({organization_id:c.organization_id,file_asset_id:a.id,connection_id:c.id,external_file_id:String(media.id),external_file_unique_id:media.unique||null,external_chat_id:chatId,external_message_id:msgId,availability_status:"available",metadata:{inbound:true}});
  if(le)throw new Error("FILE_LOCATION_SAVE_FAILED");
  if(chat.shipment_id){
   const {error:shipmentFileError}=await db.from("shipment_files").upsert({organization_id:c.organization_id,shipment_id:chat.shipment_id,file_asset_id:a.id,document_type:media.mime==="application/pdf"?"customs_document":"other"},{onConflict:"shipment_id,file_asset_id,document_type"});
   if(shipmentFileError)throw new Error("SHIPMENT_FILE_LINK_FAILED");
  }
  const maxMirror=c.platform==="whatsapp"?50*1024*1024:TG_DOWNLOAD_LIMIT;
  if(chat.conversation_id&&Number(media.size||0)<=maxMirror){
   try{
    const source=await sourceFile(c,String(media.id)),buffer=await source.response.arrayBuffer();
    if(buffer.byteLength<=0||buffer.byteLength>maxMirror)throw new Error("INBOUND_FILE_SIZE_OUT_OF_RANGE");
    const mime=cleanMime(media.mime),storagePath="quarantine/"+c.organization_id+"/"+chat.conversation_id+"/"+crypto.randomUUID();
    const blob=new Blob([buffer],{type:mime});
    const {error:uploadError}=await db.storage.from("chat-files").upload(storagePath,blob,{contentType:mime,cacheControl:"3600",upsert:false});
    if(uploadError)throw new Error("INBOUND_CHAT_STORAGE_UPLOAD_FAILED");
    internalStoragePath=storagePath;media.size=buffer.byteLength;
   }catch(e){mirrorErrorCode=errorCode(e);}
  }else if(chat.conversation_id){mirrorErrorCode="INBOUND_FILE_TOO_LARGE_TO_MIRROR";}
 }
 let coreMessageId:string|null=null;
 const text=String(messageText||"").trim().slice(0,10000);
 const body=text||(media?"📎 "+(cleanExternalName||"فایل دریافتی")+(mirrorErrorCode?" · فایل در آرشیو پیام‌رسان نگهداری شده است.":""):"");
 if(chat.conversation_id&&(body||media)){
  const {data:conversation}=await db.from("chat_conversations").select("id").eq("id",chat.conversation_id).eq("organization_id",c.organization_id).is("deleted_at",null).maybeSingle();
  if(!conversation){if(internalStoragePath)await db.storage.from("chat-files").remove([internalStoragePath]);throw new Error("INTERNAL_CONVERSATION_NOT_FOUND");}
  const messageType=media?(media.voice?"voice":"file"):"text";
  const {data:coreMessage,error:coreError}=await db.from("chat_messages").insert({
   organization_id:c.organization_id,conversation_id:chat.conversation_id,sender_id:null,client_uuid:crypto.randomUUID(),
   message_type:messageType,body:body||null,delivery_status:"sent",external_platform:c.platform,
   external_connection_id:c.id,external_chat_id:chatId,external_message_id:msgId,
   external_sender_id:userId||null,external_sender_name:String(senderName||"").trim().slice(0,160)||null
  }).select("id").maybeSingle();
  if(coreError&&coreError.code!=="23505"){
   if(internalStoragePath)await db.storage.from("chat-files").remove([internalStoragePath]);
   throw new Error("CORE_CHAT_MIRROR_FAILED");
  }
  if(coreMessage?.id)coreMessageId=String(coreMessage.id);
  if(!coreMessageId){
   const {data:existing}=await db.from("chat_messages").select("id").eq("external_connection_id",c.id).eq("external_chat_id",chatId).eq("external_message_id",msgId).maybeSingle();
   if(existing?.id)coreMessageId=String(existing.id);
  }
  if(internalStoragePath&&coreMessageId){
   try{
    let creator=String(c.created_by||"");
    if(!validId(creator)){
     const {data:profile}=await db.from("profiles").select("id").eq("organization_id",c.organization_id).eq("is_active",true).in("role",["owner","admin"]).limit(1).maybeSingle();
     creator=String(profile?.id||"");
    }
    if(!validId(creator))throw new Error("INTERNAL_ATTACHMENT_OWNER_UNAVAILABLE");
    const {error:attachmentError}=await db.from("chat_attachments").insert({
     organization_id:c.organization_id,conversation_id:chat.conversation_id,message_id:coreMessageId,storage_path:internalStoragePath,
     original_name:cleanExternalName||"document.bin",mime_type:cleanMime(media.mime),size_bytes:Number(media.size||0),
     duration_seconds:null,waveform:null,thumbnail_path:null,created_by:creator
    });
    if(attachmentError)throw new Error("INTERNAL_CHAT_ATTACHMENT_SAVE_FAILED");
   }catch(e){
    mirrorErrorCode=errorCode(e);
    await db.storage.from("chat-files").remove([internalStoragePath]);
    internalStoragePath=null;
   }
  }
  const {error:updateConversationError}=await db.from("chat_conversations").update({updated_at:new Date().toISOString()}).eq("id",chat.conversation_id).eq("organization_id",c.organization_id);
  if(updateConversationError)throw new Error("CONVERSATION_ACTIVITY_UPDATE_FAILED");
 }
 const payload={externalUserId:userId||null,senderName:String(senderName||"").trim().slice(0,160)||null,text:text||null,...(media?{name:cleanExternalName||"document.bin",mimeType:cleanMime(media.mime),sizeBytes:media.size||null,internalAttachmentMirrored:Boolean(internalStoragePath),mirrorError:mirrorErrorCode}: {})};
 const {error:logError}=await db.from("message_logs").insert({organization_id:c.organization_id,connection_id:c.id,direction:"inbound",message_type:media?"document":"text",external_message_id:msgId,external_chat_id:chatId,file_asset_id:fileAssetId,chat_message_id:coreMessageId,status:"received",payload_summary:payload});
 if(logError&&logError.code!=="23505")throw new Error("INBOUND_LOG_SAVE_FAILED");
}async function processMessengerOutbox(req:Request){
 const {data:expected,error:secretError}=await db.rpc("internal_get_reminder_secret",{p_name:"messenger_outbox_cron_secret"});
 if(secretError||typeof expected!=="string"||!expected||!equal(req.headers.get("x-messenger-outbox-cron-secret")||"",expected))return bad("UNAUTHORIZED",401,req);
 const {data:rows,error}=await db.rpc("messenger_claim_delivery_outbox",{p_limit:40});
 if(error||!Array.isArray(rows))return bad("OUTBOX_CLAIM_FAILED",500,req);
 let sent=0,failed=0,skipped=0;
 for(const row of rows as any[]){
  const now=new Date().toISOString();
  try{
   const [{data:c},{data:chat},{data:message}]=await Promise.all([
    db.from("messenger_connections").select("*").eq("id",row.connection_id).eq("organization_id",row.organization_id).maybeSingle(),
    db.from("messenger_chats").select("*").eq("id",row.messenger_chat_id).eq("organization_id",row.organization_id).maybeSingle(),
    db.from("chat_messages").select("id,organization_id,conversation_id,sender_id,body,deleted_at,external_platform,message_type").eq("id",row.chat_message_id).eq("organization_id",row.organization_id).maybeSingle()
   ]);
   if(!c||!c.enabled||!chat||!chat.enabled||!chat.conversation_id||chat.conversation_id!==message?.conversation_id)throw new Error("DESTINATION_NO_LONGER_LINKED");
   if(!message||message.deleted_at||message.external_platform)throw new Error("MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY");
   let externalMessageId="",fileAssetId:string|null=null,logType="text",payloadSummary:Record<string,any>={source:"customs_chat",outboxId:row.id};
   let pendingAsset:{result:any;mime:string;size:number;name:string}|null=null;
   const bodyText=String(message.body||"").trim();
   if(message.message_type==="text"){
    if(!bodyText)throw new Error("EMPTY_MESSAGE_BODY");
    externalMessageId=await sendTextToPlatform(c as Conn,String(chat.external_chat_id),bodyText.slice(0,4000));
    payloadSummary={...payloadSummary,text:bodyText.slice(0,4000),charCount:bodyText.length};
   }else if(message.message_type==="file"||message.message_type==="voice"){
    const {data:attachments,error:attachmentError}=await db.from("chat_attachments").select("id,storage_path,original_name,mime_type,size_bytes,security_status,deleted_at").eq("message_id",message.id).is("deleted_at",null).order("created_at",{ascending:true});
    if(attachmentError)throw new Error("ATTACHMENT_LOOKUP_FAILED");
    const attachment=(attachments||[]).find((a:any)=>a.security_status==="clean"&&a.storage_path&&!String(a.storage_path).startsWith("quarantine/"));
    if(!attachment){
     if((attachments||[]).some((a:any)=>a.security_status==="blocked"))throw new Error("ATTACHMENT_BLOCKED_BY_SECURITY_SCAN");
     throw new Error("ATTACHMENT_NOT_CLEAN_OR_NOT_READY");
    }
    const max=c.platform==="whatsapp"?WA_DOCUMENT_LIMIT:TG_UPLOAD_LIMIT;
    const expectedSize=Number(attachment.size_bytes||0)||null;
    if(expectedSize!==null&&expectedSize>max)throw new Error("FILE_TOO_LARGE_FOR_DESTINATION");
    const {data:file,error:fileError}=await db.storage.from("chat-files").download(String(attachment.storage_path));
    if(fileError||!file)throw new Error("CHAT_ATTACHMENT_DOWNLOAD_FAILED");
    const actualSize=Number(file.size||0);
    if(actualSize<=0||actualSize>max)throw new Error("FILE_TOO_LARGE_FOR_DESTINATION");
    const mime=cleanMime(String(attachment.mime_type||file.type||"application/octet-stream")),name=cleanName(String(attachment.original_name||"attachment.bin"));
    const result=await uploadStream(c as Conn,String(chat.external_chat_id),name,mime,actualSize,file.stream(),message.message_type==="voice"?"voice":"file");
    externalMessageId=result.messageId;
    pendingAsset={result,mime,size:actualSize,name};
    logType="document";
    payloadSummary={...payloadSummary,name,mimeType:mime,sizeBytes:actualSize,sourceMessageType:message.message_type};
   }else throw new Error("UNSUPPORTED_MESSAGE_TYPE");

   // Once the external platform accepts a message, commit delivery before writing optional file metadata.
   // This prevents a transient file_assets/file_locations failure from duplicating a sent file on retry.
   const {error:updateError}=await db.from("messenger_delivery_outbox").update({status:"sent",external_message_id:externalMessageId,last_error_code:null,sent_at:now,updated_at:now}).eq("id",row.id).eq("status","sending");
   if(updateError)throw new Error("OUTBOX_STATUS_UPDATE_FAILED");
   if(pendingAsset){
    try{
     fileAssetId=await storeAsset(row.organization_id,String(message.sender_id||"")||null,c as Conn,String(chat.external_chat_id),pendingAsset.result,pendingAsset.mime,pendingAsset.size,"website",chat.shipment_id||null,false);
    }catch(assetError){
     payloadSummary={...payloadSummary,assetMetadataError:errorCode(assetError)};
    }
   }
   await db.from("message_logs").insert({organization_id:row.organization_id,connection_id:row.connection_id,direction:"outbound",message_type:logType,external_message_id:externalMessageId,external_chat_id:String(chat.external_chat_id),chat_message_id:row.chat_message_id,file_asset_id:fileAssetId,status:"sent",payload_summary:payloadSummary,sent_at:now});
   sent++;
  }catch(e){
   const code=errorCode(e),attempt=Number(row.attempt_count||1);
   const terminal=code==="MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY"||code==="DESTINATION_NO_LONGER_LINKED";
   const delay=Math.min(3600000,15000*Math.pow(2,Math.min(attempt,7)));
   const retryAt=new Date(Date.now()+delay).toISOString();
   await db.from("messenger_delivery_outbox").update({status:terminal?"skipped":"failed",last_error_code:code,next_attempt_at:terminal?new Date().toISOString():retryAt,updated_at:new Date().toISOString()}).eq("id",row.id).eq("status","sending");
   await db.from("message_logs").insert({organization_id:row.organization_id,connection_id:row.connection_id,direction:"outbound",message_type:"text",external_chat_id:row.external_chat_id,chat_message_id:row.chat_message_id,status:"failed",error_code:code,payload_summary:{source:"customs_chat",outboxId:row.id,attempt,terminal}});
   if(terminal)skipped++;else failed++;
  }
 }
 return out({ok:true,claimed:rows.length,sent,failed,skipped},200,req);
}function formatDailyReport(snapshot:Record<string,any>){
 const number=(value:unknown)=>new Intl.NumberFormat("fa-IR").format(Number(value||0));
 const statusFa=(value:unknown)=>{
  const statuses:Record<string,string>={
   draft:"پیش‌نویس",booking_confirmed:"رزرو تأییدشده",loading:"در حال بارگیری",
   loaded:"بارگیری‌شده",departed:"حرکت‌کرده",in_transit:"در مسیر",
   approaching_destination:"نزدیک مقصد",anchorage:"لنگرگاه",berthing:"در حال پهلوگیری",
   discharging:"در حال تخلیه",discharged:"تخلیه‌شده",completed:"تکمیل‌شده",
   delayed:"با تأخیر",cancelled:"لغوشده"
  };
  return statuses[String(value||"").toLowerCase()]||"وضعیت نامشخص";
 };
 const rawDate=String(snapshot.report_date||"");
 const parsedDate=new Date(rawDate+"T12:00:00+03:30");
 const dateLabel=Number.isNaN(parsedDate.getTime())?rawDate:new Intl.DateTimeFormat("fa-IR-u-ca-persian",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).format(parsedDate);
 const lines=[
  "📊 گزارش روزانه عملیات گمرکی",
  "📅 تاریخ گزارش: "+dateLabel,
  "",
  "📦 مجموع محموله‌ها: "+number(snapshot.total_shipments),
  "🔄 محموله‌های به‌روزشده در روز گزارش: "+number(snapshot.shipments_updated),
  "📁 مجموع پرونده‌ها: "+number(snapshot.total_cases),
  "🆕 پرونده‌های جدید: "+number(snapshot.cases_created),
  "🛃 اظهارهای ثبت‌شده: "+number(snapshot.declarations_created),
  "🚢 محموله‌های با پاس کشتی ثبت‌نشده: "+number(snapshot.ship_pass_pending),
  "",
  "🧾 فاکتورهای صادرشده در روز گزارش: "+number(snapshot.invoices_issued),
  "📂 فاکتورهای باز: "+number(snapshot.open_invoices),
  "⏰ فاکتورهای سررسیدگذشته: "+number(snapshot.overdue_invoices),
  "💵 دریافتی‌های ثبت‌شده: "+number(snapshot.payments_received_count)+" مورد · "+number(snapshot.payments_received_total_irr)+" ریال",
  "💸 پرداخت‌های ثبت‌شده: "+number(snapshot.payments_paid_count)+" مورد · "+number(snapshot.payments_paid_total_irr)+" ریال",
  "",
  "🔔 یادآورهای باز: "+number(snapshot.open_reminders),
  "⌛ یادآورهای عقب‌افتاده: "+number(snapshot.overdue_reminders),
  "📅 یادآورهای موعد امروز: "+number(snapshot.reminders_due_today),
  "🚨 یادآورهای فوری: "+number(snapshot.urgent_reminders)
 ];
 const latest=Array.isArray(snapshot.latest_shipments)?snapshot.latest_shipments:[];
 if(latest.length){
  lines.push("","آخرین تغییرات محموله‌ها:");
  for(const [index,item] of latest.slice(0,8).entries()){
   const label=String(item.display_name||item.bill_of_lading_no||"محموله");
   const fields=[
    item.bill_of_lading_no?"بارنامه: "+item.bill_of_lading_no:"",
    item.case_number?"پرونده: "+item.case_number:"",
    item.client_name?"صاحب کالا: "+item.client_name:"",
    item.current_status?"وضعیت: "+statusFa(item.current_status):"",
    item.current_location?"موقعیت: "+item.current_location:"",
    item.cargo_description?"کالا: "+item.cargo_description:""
   ].filter(Boolean);
   lines.push(number(index+1)+". "+label+(fields.length?" — "+fields.join(" · "):""));
  }
 }else{
  lines.push("","در روز گزارش، محموله‌ای به‌روزرسانی نشده است.");
 }
 lines.push("","گزارش تولیدشده توسط Customs OS");
 return lines.join("\n").slice(0,3800);
}
async function processDailyReports(req:Request){
 const {data:expected,error:secretError}=await db.rpc("internal_get_reminder_secret",{p_name:"messenger_outbox_cron_secret"});
 if(secretError||typeof expected!=="string"||!expected||!equal(req.headers.get("x-messenger-outbox-cron-secret")||"",expected))return bad("UNAUTHORIZED",401,req);
 const requestBody=await bodyJson(req);
 const mode=requestBody.mode==="retry"?"retry":"scheduled";
 const {data:destinations,error:destinationError}=await db.from("messenger_chats").select("id,organization_id,connection_id,external_chat_id,display_name,enabled,purpose").eq("enabled",true).eq("purpose","daily_report").order("created_at",{ascending:true});
 if(destinationError)return bad("DAILY_REPORT_DESTINATIONS_UNAVAILABLE",500,req);
 let considered=0,claimed=0,sent=0,failed=0,skipped=0;
 for(const destination of destinations||[]){
  considered++;
  let reportRunId:string|null=null;
  try{
   const c=await readConn(String(destination.connection_id));
   if(!c||!c.enabled||c.organization_id!==destination.organization_id){skipped++;continue;}
   const {data:snapshot,error:snapshotError}=await db.rpc("messenger_report_snapshot",{p_organization_id:destination.organization_id,p_timezone:"Asia/Tehran"});
   if(snapshotError||!snapshot||typeof snapshot!=="object")throw new Error("DAILY_REPORT_SNAPSHOT_FAILED");
   const reportDate=String((snapshot as Record<string,any>).report_date||"");
   if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))throw new Error("DAILY_REPORT_DATE_INVALID");
   if(mode==="retry"){
    const {data:previousRun,error:previousRunError}=await db.from("messenger_report_runs").select("status,updated_at,attempt_count").eq("messenger_chat_id",destination.id).eq("report_date",reportDate).maybeSingle();
    if(previousRunError)throw new Error("DAILY_REPORT_RETRY_LOOKUP_FAILED");
    const previousStatus=String(previousRun?.status||"");
    const staleSending=previousStatus==="sending"&&Date.now()-Date.parse(String(previousRun?.updated_at||""))>10*60*1000;
    if(!previousRun||(previousStatus!=="failed"&&!staleSending)){skipped++;continue;}
   }
   const {data:claimRows,error:claimError}=await db.rpc("messenger_claim_daily_report",{
    p_organization_id:destination.organization_id,p_messenger_chat_id:destination.id,
    p_connection_id:destination.connection_id,p_report_date:reportDate
   });
   if(claimError)throw new Error("DAILY_REPORT_CLAIM_FAILED");
   const run=Array.isArray(claimRows)?claimRows[0]:claimRows;
   if(!run?.id){skipped++;continue;}
   reportRunId=String(run.id);claimed++;
   const content=formatDailyReport(snapshot as Record<string,any>);
   const externalMessageId=await sendTextToPlatform(c,String(destination.external_chat_id),content);
   const {error:updateError}=await db.from("messenger_report_runs").update({
    status:"sent",external_message_id:externalMessageId,error_code:null,
    report_snapshot:snapshot,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()
   }).eq("id",reportRunId).eq("status","sending");
   if(updateError)throw new Error("DAILY_REPORT_STATUS_SAVE_FAILED");
   await db.from("message_logs").insert({
    organization_id:destination.organization_id,connection_id:destination.connection_id,
    direction:"outbound",message_type:"text",external_message_id:externalMessageId,
    external_chat_id:String(destination.external_chat_id),status:"sent",
    payload_summary:{source:"daily_report",reportDate,preview:content.slice(0,3500)},sent_at:new Date().toISOString()
   });
   sent++;
  }catch(e){
   failed++;
   if(reportRunId){
    await db.from("messenger_report_runs").update({
     status:"failed",error_code:errorCode(e),updated_at:new Date().toISOString()
    }).eq("id",reportRunId).eq("status","sending");
   }
  }
 }
 return out({ok:true,mode,considered,claimed,sent,failed,skipped},200,req);
}
async function tgWebhook(req:Request,c:Conn,secretPath?:string){const s=await secret(c.webhook_secret_ref);if(c.platform==="telegram"){if(!s||!equal(req.headers.get("X-Telegram-Bot-Api-Secret-Token")||"",s))return bad("WEBHOOK_AUTH_FAILED",401,req);}else if(!s||!secretPath||!equal(s,secretPath))return bad("WEBHOOK_AUTH_FAILED",401,req);let b:any;try{b=JSON.parse(await readText(req,1024*1024));}catch(e){return bad(errorCode(e),400,req);}const updateId=String(b.update_id??b.updateId??"");if(!updateId)return bad("WEBHOOK_EVENT_ID_MISSING",400,req);const eid=await event(c,updateId,c.platform+"-update");if(!eid)return out({ok:true,duplicate:true},200,req);try{const m=b.message||b.channel_post||b.edited_message||b.edited_channel_post||{},chat=String(m.chat?.id??""),mid=String(m.message_id??"");if(chat&&mid)await inbound(c,chat,mid,tgMedia(m),String((typeof m.text==="string"?m.text:"")||m.caption||""),String(m.from?.id||""),String([m.from?.first_name,m.from?.last_name].filter(Boolean).join(" ")||m.from?.username||""));await db.from("webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("id",eid);return out({ok:true},200,req);}catch(e){await db.from("webhook_events").update({status:"failed",attempt_count:1,error_code:errorCode(e)}).eq("id",eid);return bad("WEBHOOK_PROCESSING_FAILED",500,req);}}
async function waWebhook(req:Request,c:Conn){if(req.method==="GET"){const u=new URL(req.url),s=await secret(c.verify_token_ref),challenge=u.searchParams.get("hub.challenge");if(u.searchParams.get("hub.mode")!=="subscribe"||!s||!equal(u.searchParams.get("hub.verify_token")||"",s)||challenge===null)return bad("WEBHOOK_VERIFICATION_FAILED",403,req);return new Response(challenge,{status:200,headers:{...noStore,"Content-Type":"text/plain"}});}const raw=await readText(req,1024*1024),app=await secret(c.app_secret_ref);if(!app||!await checkHmac(app,raw,req.headers.get("X-Hub-Signature-256")||""))return bad("WEBHOOK_SIGNATURE_INVALID",401,req);let b:any;try{b=JSON.parse(raw);}catch{return bad("INVALID_JSON",400,req);}try{for(const entry of b.entry||[])for(const change of entry.changes||[]){const value=change.value||{};for(const m of value.messages||[]){const id=String(m.id||"");if(!id)continue;const eid=await event(c,id,"whatsapp-message");if(!eid)continue;const type=String(m.type||"unknown"),media=m[type];const normalized=media?.id?{id:String(media.id),unique:null,name:media.filename||(type==="image"?"image.jpg":type+".bin"),mime:media.mime_type||(type==="image"?"image/jpeg":"application/octet-stream"),size:null,voice:type==="audio"}:null;await inbound(c,String(m.from||""),id,normalized,String(m.text?.body||""),String(m.from||""),String((value.contacts||[]).find((contact:any)=>String(contact.wa_id||"")===String(m.from||""))?.profile?.name||""));await db.from("webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("id",eid);}for(const s of value.statuses||[]){const id=String(s.id||"");if(!id)continue;const eid=await event(c,id,"whatsapp-status-"+String(s.status||"unknown"));if(!eid)continue;await db.from("message_logs").update({status:["sent","delivered","read","failed"].includes(s.status)?s.status:"unknown"}).eq("organization_id",c.organization_id).eq("connection_id",c.id).eq("external_message_id",id);await db.from("webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("id",eid);}}}catch(e){return bad("WEBHOOK_PROCESSING_FAILED_"+errorCode(e),500,req);}return out({ok:true},200,req);}
async function webhook(req:Request,path:string){const m=path.match(/^\/webhooks\/messenger\/(telegram|bale|whatsapp)\/([0-9a-f-]{36})(?:\/([A-Za-z0-9_-]+))?$/i);if(!m)return bad("WEBHOOK_NOT_FOUND",404,req);const platform=m[1].toLowerCase() as Platform,c=await readConn(m[2]);if(!c||c.platform!==platform)return bad("CONNECTION_NOT_FOUND",404,req);if(platform==="whatsapp")return await waWebhook(req,c);if(req.method!=="POST")return bad("METHOD_NOT_ALLOWED",405,req);return await tgWebhook(req,c,m[3]);}
async function route(req:Request,path:string){const ctx=await context(req),p=ctx.p;if(req.method==="GET"&&path==="/api/messenger/health")return out({ok:true,platforms:{telegram:{supported:true,maxUploadBytes:TG_UPLOAD_LIMIT,maxDownloadBytes:TG_DOWNLOAD_LIMIT},bale:{supported:true,webhookAuth:"secret_path"},whatsapp:{supported:true,maxDocumentUploadBytes:100*1024*1024,metaSetupRequired:true},rubika:{supported:false,reason:"PUBLIC_BOT_API_NOT_VERIFIED"}}},200,req);if(path==="/api/messenger/connections"&&req.method==="GET"){onlyManager(p);const {data,error}=await db.from("messenger_connections").select("id,organization_id,platform,external_account_id,display_name,config,enabled,created_at").eq("organization_id",p.organization_id).order("created_at",{ascending:false});if(error)return bad("CONNECTION_LIST_FAILED",500,req);return out({ok:true,connections:data||[]},200,req);}if(path==="/api/messenger/connections"&&req.method==="POST")return await addConnection(req,p,ctx.userId);if(path==="/api/messenger/chats"&&req.method==="GET"){onlyManager(p);const {data,error}=await db.from("messenger_chats").select("id,connection_id,external_chat_id,chat_type,purpose,display_name,shipment_id,conversation_id,enabled,created_at").eq("organization_id",p.organization_id).order("created_at",{ascending:false});if(error)return bad("CHAT_LIST_FAILED",500,req);return out({ok:true,chats:data||[]},200,req);}if(path==="/api/messenger/chats"&&req.method==="POST")return await createChat(req,p,ctx.userId);const test=path.match(/^\/api\/messenger\/connections\/([0-9a-f-]{36})\/test$/i);if(req.method==="POST"&&test){onlyManager(p);const c=await ownedConn(test[1],p.organization_id,true);try{return out({ok:true,account:await probe(c)},200,req);}catch(e){return bad(errorCode(e),502,req);}}const hook=path.match(/^\/api\/messenger\/connections\/([0-9a-f-]{36})\/register-webhook$/i);if(req.method==="POST"&&hook){onlyManager(p);const c=await ownedConn(hook[1],p.organization_id,true);try{return out({ok:true,webhookUrl:await registerHook(c)},200,req);}catch(e){return bad(errorCode(e),502,req);}}if(path==="/api/messenger/messages"&&req.method==="GET"){onlyManager(p);const {data,error}=await db.from("message_logs").select("id,connection_id,direction,message_type,external_message_id,external_chat_id,status,payload_summary,created_at,file_asset_id,chat_message_id").eq("organization_id",p.organization_id).order("created_at",{ascending:false}).limit(100);if(error)return bad("MESSAGE_LIST_FAILED",500,req);return out({ok:true,messages:data||[]},200,req);}if(path==="/api/messenger/messages"&&req.method==="POST")return await sendText(req,p);const up=path.match(/^\/api\/messenger\/uploads\/([0-9a-f-]{36})$/i);if(up&&req.method==="POST")return await upload(req,p,ctx.userId,up[1]);const down=path.match(/^\/api\/messenger\/files\/([0-9a-f-]{36})\/download$/i);if(down&&req.method==="GET")return await download(req,p,down[1]);if(path==="/api/messenger/transfers"&&req.method==="POST")return await transfer(req,p,ctx.userId);return bad("ROUTE_NOT_FOUND",404,req);}
Deno.serve(async(req:Request)=>{const path=req.headers.get("x-messenger-path")||new URL(req.url).pathname;if(req.method==="OPTIONS"){const h=new Headers(noStore),o=req.headers.get("Origin")||"";if(ORIGINS.has(o)){h.set("Access-Control-Allow-Origin",o);h.set("Vary","Origin");h.set("Access-Control-Allow-Headers","authorization, apikey, content-type, x-file-name, x-file-size, idempotency-key");h.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");}return new Response(null,{status:204,headers:h});}try{if(!SB||!ANON||!SERVICE)return bad("GATEWAY_CONFIGURATION_MISSING",503,req);if(path==="/api/messenger/outbox/process"&&req.method==="POST")return await processMessengerOutbox(req);if(path==="/api/messenger/reports/daily"&&req.method==="POST")return await processDailyReports(req);if(path.startsWith("/webhooks/messenger/"))return await webhook(req,path);if(path.startsWith("/api/messenger/"))return await route(req,path);return bad("ROUTE_NOT_FOUND",404,req);}catch(e){const c=errorCode(e),status=c==="MANAGER_REQUIRED"?403:c.startsWith("AUTH_")?401:c==="CONNECTION_NOT_FOUND"||c==="FILE_NOT_FOUND"?404:400;return bad(c,status,req);}});
