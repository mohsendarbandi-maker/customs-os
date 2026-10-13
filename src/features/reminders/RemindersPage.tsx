import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {Bell,CalendarDays,CalendarClock,Check,CheckCircle2,Circle,ChevronDown,ChevronLeft,ChevronRight,Clock3,UploadCloud,MoreHorizontal,Plus,RefreshCw,Search,Trash2,Undo2,X,Users,Repeat2,ListChecks,Mic,MicOff,ExternalLink,Languages,Sparkles,Send,ArrowUpRight} from 'lucide-react';
import {buildJalaliMonthGrid,jalaliMonthKey,parseReminderDayKey,readJalaliMonth,shiftJalaliMonth,type CalendarReminderDate} from './calendarModel';
import {supabase} from '../../lib/supabase';
import {readOfflineQueryCache,removeQueuedRpc,rpcWithOfflineQueue,saveOfflineQueryCache,subscribeOfflineQueue,type QueuedRpc} from '../../lib/offlineQueue';
import {useAuth} from '../../context/AuthContext';
import {addJalaliDays,formatJalali,formatJalaliDateTime,formatRelativeFa,groupDayLabel,JALALI_MONTHS,startOfTehranDay,toJalali,WEEK_DAYS,zonedJalaliToDate} from '../../lib/jalali';
import {JalaliDateTimePicker} from './JalaliDateTimePicker';
import {readReminderLanguage,reminderText,formatReminderDate,formatReminderDateTime,formatReminderRelative,reminderNumber,ReminderLocaleTree,type ReminderLanguage} from './reminderI18n';
import {disablePush,enablePush,listPushDevices,setNotificationPreferences,testPush} from './push';
import {nextRecurrenceDue,parseReminder,resolveAssignee,resolveLink,type Reminder,type ReminderKind,type ReminderPriority,ReminderEntityType} from './reminderCore';
import {parseReminderTags,recurrenceFrequency,recurrenceRuleFor,validateReminderTitle,type ReminderRecurrenceFrequency} from './editorModel';
import {offlineReminderQueueBlocker,queuedReminderDrafts} from './offlineReminderQueue';
import {areAllVisibleReminderIdsSelected,deselectVisibleReminderIds,selectableReminderIds,selectVisibleReminderIds,toggleReminderSelection} from './selectionModel';
import {summarizeReminderBulkAction,type ReminderBulkAction} from './bulkActionModel';

type Filter='today'|'scheduled'|'overdue'|'all'|'done'|'assigned'|'undated'|'day';
type ReminderSection='home'|'search'|'today'|'scheduled'|'overdue'|'all'|'done'|'assigned'|'undated'|'lists'|'calendar'|'settings'|'list-documents'|'list-shipment'|'list-finance'|'list-other'|'day';
const REMINDER_SECTIONS:ReminderSection[]=['home','search','today','scheduled','overdue','all','done','assigned','undated','lists','calendar','settings','list-documents','list-shipment','list-finance','list-other','day'];
const SECTION_FILTER:Partial<Record<ReminderSection,Filter>>={home:'all',search:'all',today:'today',scheduled:'scheduled',overdue:'overdue',all:'all',done:'done',assigned:'assigned',undated:'undated',lists:'all',calendar:'all',settings:'all','list-documents':'all','list-shipment':'all','list-finance':'all','list-other':'all',day:'day'};
const SECTION_KIND:Partial<Record<ReminderSection,ReminderKind>>={'list-documents':'document','list-shipment':'shipment','list-finance':'finance','list-other':'other'};
const SECTION_TITLE:Record<ReminderSection,string>={home:'یادآورها',search:'جست‌وجو',today:'امروز',scheduled:'برنامه‌ریزی‌شده',overdue:'معوق',all:'همهٔ یادآورها',done:'انجام‌شده',assigned:'واگذارشده به من',undated:'بدون سررسید',lists:'فهرست‌های من',calendar:'تقویم',settings:'تنظیمات','list-documents':'اسناد','list-shipment':'محموله و پرونده','list-finance':'مالی','list-other':'سایر',day:'برنامه روزانه'};
const CATEGORY_ICON:Record<ReminderKind,typeof ListChecks>={document:CalendarClock,shipment:Users,finance:Check,other:ListChecks};
const categoryRoute=(kind:ReminderKind):ReminderSection=>kind==='document'?'list-documents':('list-'+kind) as ReminderSection;
type QueryResult={rows:Reminder[];count:number;offlineCached?:boolean;cacheUpdatedAt?:number};
type ReminderOverview={total:number;today:number;overdue:number;scheduled:number;done:number;undated:number;offlineCached?:boolean;cacheUpdatedAt?:number};
type ReminderEntitySelection={type:ReminderEntityType;id:string;label:string;caseId?:string|null;shipmentId?:string|null};
const entityTypeLabel:Record<ReminderEntityType,string>={shipments:'محموله',cases:'پرونده',customs_documents:'سند گمرکی',shipment_documents:'سند محموله',documents:'سند پرونده',finance_invoices:'فاکتور مالی',clients:'صاحب کالا'};
const PAGE_SIZE=50;
const kinds:Array<[ReminderKind,string]>=[['document','اسناد'],['shipment','محموله / پرونده'],['finance','مالی'],['other','سایر']];
const priorityLabel:Record<ReminderPriority,string>={low:'کم',normal:'عادی',high:'زیاد',urgent:'فوری'};
const filterLabel:Record<Filter,string>={today:'امروز',scheduled:'برنامه‌ریزی‌شده',overdue:'معوق',all:'همه',done:'انجام‌شده',assigned:'به من واگذار شده',undated:'بدون سررسید',day:'روز انتخاب‌شده'};
const todayRange=()=>{const s=startOfTehranDay();return [s,addJalaliDays(s,1)] as const;};
const emptyForm={title:'',notes:'',dueAt:new Date(Date.now()+3600000),priority:'normal' as ReminderPriority,kind:'other' as ReminderKind,allDay:false,offsets:[0],recurrence:null as string|null,visibility:'private' as 'private'|'team',tags:''};

function isOfflineReadError(error:unknown){if(typeof navigator!=='undefined'&&navigator.onLine===false)return true;const message=error instanceof Error?error.message:String(error??'');return /failed to fetch|network request failed|networkerror|load failed|connection (?:lost|reset|refused)|timed? ?out|timeout/i.test(message);}
function errorFa(error:unknown){const m=error instanceof Error?error.message:String(error??'');const lower=m.toLowerCase();const replacements:Array<[string,string]>=[['permission denied','دسترسی مجاز نیست'],['row-level security','دسترسی این یادآور مجاز نیست؛ مجوز کاربر یا سازمان باید بررسی شود'],['violates','اطلاعات ثبت‌شده معتبر نیست'],['invalid','اطلاعات واردشده معتبر نیست'],['does not exist','ساختار پایگاه داده با نسخهٔ برنامه هماهنگ نیست؛ مهاجرت‌های یادآورها باید بررسی شوند'],['schema cache','ساختار جدول یادآورها در کش API به‌روز نیست'],['failed to fetch','ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره تلاش کنید'],['network request failed','ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره تلاش کنید'],['jwt','نشست ورود منقضی شده است؛ دوباره وارد سامانه شوید'],['یادآور تغییر نکرد','یادآور ذخیره نشد؛ دسترسی یا وجود آن را بررسی کنید']];for(const [a,b] of replacements)if(lower.includes(a.toLowerCase()))return b;return 'بارگذاری یا ذخیرهٔ یادآورها انجام نشد؛ اتصال، دسترسی و ساختار پایگاه داده را بررسی کنید';}

type SpeechRecognitionLike={lang:string;interimResults:boolean;resultIndex:number;onresult:(event:SpeechRecognitionEventLike)=>void;onerror:()=>void;onend:()=>void;start:()=>void;stop:()=>void};type SpeechRecognitionEventLike={resultIndex:number;results:ArrayLike<{0:{transcript?:string}} & ArrayLike<{transcript?:string}>>};
export const RemindersPage:React.FC=()=>{
 const {profile,user}=useAuth();const qc=useQueryClient();const location=useLocation();const navigate=useNavigate();const [params,setParams]=useSearchParams();
 const pathParts=location.pathname.split('/').filter(Boolean);const pathToken=pathParts[0]==='reminders'?(pathParts[1]??'home'):(pathParts[0]??'home');
 const legacyView=pathToken==='home'?params.get('view'):null;const routeToken=pathToken==='share'?'all':(legacyView&&(['today','scheduled','overdue','all','done','assigned','undated'] as string[]).includes(legacyView)?legacyView:pathToken);
 const currentSection:ReminderSection=(REMINDER_SECTIONS as string[]).includes(routeToken)?routeToken as ReminderSection:'home';
 const isHome=currentSection==='home',isSearchPage=currentSection==='search',isListsPage=currentSection==='lists',isCalendarPage=currentSection==='calendar',isSettingsPage=currentSection==='settings';
 const dayKey=params.get('day');const calendarMonth=readJalaliMonth(params.get('month'));const [filter,setFilter]=useState<Filter>(SECTION_FILTER[currentSection]??'all');const [kind,setKind]=useState<ReminderKind|null>(SECTION_KIND[currentSection]??null);const [search,setSearch]=useState('');const [page,setPage]=useState(0);const [composer,setComposer]=useState('');const [selected,setSelected]=useState<string[]>([]);const [bulkAction,setBulkAction]=useState<ReminderBulkAction|null>(null);const [editor,setEditor]=useState<Reminder|null>(null);const [showPicker,setShowPicker]=useState(false);const [toast,setToast]=useState<{text:string;undo?:()=>void}|null>(null);const [pushOpen,setPushOpen]=useState(false);const [pushDevices,setPushDevices]=useState<Array<{id:string;platform:string|null;user_agent:string|null;last_seen_at:string;is_active:boolean;failure_count:number}>>([]);const [pushBusy,setPushBusy]=useState(false);const [offlineQueue,setOfflineQueue]=useState<QueuedRpc[]>([]);const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);const previousQueueRef=useRef<QueuedRpc[]>([]);
 const pushAllowed=profile?.role!=='client';
 const [recording,setRecording]=useState(false);const [composerOpen,setComposerOpen]=useState(false);
 useEffect(()=>{const unsubscribe=subscribeOfflineQueue(setOfflineQueue);return()=>{unsubscribe();};},[]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const [menuId,setMenuId]=useState<string|null>(null);const [menuPosition,setMenuPosition]=useState<{top:number;left:number;width:number}|null>(null);
 const [language,setLanguage]=useState<ReminderLanguage>(()=>readReminderLanguage());const [quickDueAt,setQuickDueAt]=useState<Date|null>(null);const [quickAllDay,setQuickAllDay]=useState(false);const [quickDateSource,setQuickDateSource]=useState<'manual'|'inferred'|null>(null);const [showQuickPicker,setShowQuickPicker]=useState(false);
 const t=(value:string)=>reminderText(value,language);
  const goToSection=(section:ReminderSection)=>{setPage(0);navigate(section==='home'?'/reminders':('/reminders/'+section));};
  const goToDay=(key:string)=>{setPage(0);navigate('/reminders/day?day='+encodeURIComponent(key));};
  useEffect(()=>{setFilter(SECTION_FILTER[currentSection]??'all');setKind(SECTION_KIND[currentSection]??null);setPage(0);setSelected([]);},[currentSection]);
 useEffect(()=>{setSelected([]);},[filter,kind,search,page]);
  useEffect(()=>{if(isSearchPage)window.setTimeout(()=>document.getElementById('reminders-page-search')?.focus(),120);},[isSearchPage]);
 const preview=useMemo(()=>composer.trim()?parseReminder(composer):null,[composer]);
 useEffect(()=>{const root=document.documentElement,oldDir=root.dir,oldLang=root.lang;root.dir=language==='fa'?'rtl':'ltr';root.lang=language;try{localStorage.setItem('customs-reminders-language-v1',language);}catch{}return()=>{root.dir=oldDir;root.lang=oldLang;}},[language]);

 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey)return;const target=e.target as HTMLElement|null;const typing=Boolean(target?.isContentEditable||target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'));if(e.key==='Escape'){if(showQuickPicker){setShowQuickPicker(false);return;}if(showPicker){setShowPicker(false);return;}if(composerOpen){setComposerOpen(false);return;}if(isSearchPage){setSearch('');navigate('/reminders');return;}}if(typing)return;if(e.key==='/'){e.preventDefault();navigate('/reminders/search');return;}if(e.key.toLowerCase()==='n'){e.preventDefault();setComposerOpen(true);window.setTimeout(()=>document.getElementById('reminder-quick-input')?.focus(),100);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[composerOpen,isSearchPage,navigate,showPicker,showQuickPicker]);
 useEffect(()=>{if(params.get('new')==='1'){setComposerOpen(true);window.setTimeout(()=>document.getElementById('reminder-quick-input')?.focus(),100);setParams({}, {replace:true});}},[params,setParams]);
 useEffect(()=>{const rid=params.get('rid'),act=params.get('act');if(!rid||!act)return;setParams(p=>{p.delete('rid');p.delete('act');return p},{replace:true});if(!user)return;const run=async()=>{const patch:Partial<Reminder>|null=act==='done'?{status:'done',completed_at:new Date().toISOString(),completed_by:user.id}:act==='snooze10'?{snoozed_until:new Date(Date.now()+600000).toISOString(),snooze_count:1}:act==='tomorrow9'?{snoozed_until:(()=>{const j=toJalali(addJalaliDays(new Date(),1));return zonedJalaliToDate(j.year,j.month,j.day,9,0).toISOString()})(),snooze_count:1}:null;if(!patch)return;const {data,error}=await supabase.from('operational_reminders').update(patch).eq('id',rid).select('id').maybeSingle();if(error||!data){setToast({text:error?errorFa(error):'یادآور پیدا نشد یا مجوز تغییر آن وجود ندارد.'});return;}await qc.invalidateQueries({queryKey:['reminders']});await qc.invalidateQueries({queryKey:['reminder-overview']});};void run().catch(error=>setToast({text:errorFa(error)}));},[params,qc,setParams,user]);

 const reminderCacheDay=(()=>{const j=toJalali(new Date());return j.year+'-'+String(j.month).padStart(2,'0')+'-'+String(j.day).padStart(2,'0');})();
 const reminderCacheScope=JSON.stringify(['reminders',filter,kind,search,page,user?.id,profile?.organization_id,dayKey,reminderCacheDay]);
 const query=useQuery<QueryResult>({
  queryKey:['reminders',filter,kind,search,page,user?.id,profile?.organization_id,dayKey,reminderCacheDay],
  queryFn:async()=>{
   if(!profile?.organization_id)return{rows:[],count:0};
   try{
    let q=supabase.from('operational_reminders').select('*',{count:'exact'}).order('due_at',{ascending:true,nullsFirst:false}).range(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE-1);
    q=q.eq('organization_id',profile.organization_id);q=q.is('deleted_at',null);
    if(filter==='today'){const[r1,r2]=todayRange();q=q.gte('due_at',r1.toISOString()).lt('due_at',r2.toISOString()).eq('status','open');}
    if(filter==='scheduled')q=q.eq('status','open').gte('due_at',new Date().toISOString());
    if(filter==='overdue')q=q.eq('status','open').lt('due_at',new Date().toISOString());
    if(filter==='done')q=q.eq('status','done');
    if(filter==='assigned')q=q.eq('assignee_id',user?.id??'00000000-0000-0000-0000-000000000000').eq('status','open');
    if(filter==='undated')q=q.is('due_at',null).eq('status','open');
    if(filter==='day'){const selectedDay=parseReminderDayKey(dayKey);if(!selectedDay)return{rows:[],count:0};const nextDay=addJalaliDays(selectedDay,1);q=q.gte('due_at',selectedDay.toISOString()).lt('due_at',nextDay.toISOString()).eq('status','open');}
    if(kind)q=q.eq('kind',kind);
    if(search.trim()){const s=search.trim().replace(/[,()]/g,' ');q=q.or('title.ilike.%'+s+'%,description.ilike.%'+s+'%,notes.ilike.%'+s+'%');}
    const {data,error,count}=await q;if(error)throw error;
    const result:QueryResult={rows:(data??[]) as Reminder[],count:count??0,offlineCached:false};
    await saveOfflineQueryCache(reminderCacheScope,user?.id,profile.organization_id,result).catch(()=>false);
    return result;
   }catch(error){
    if(isOfflineReadError(error)){
     const cached=await readOfflineQueryCache<QueryResult>(reminderCacheScope,user?.id,profile.organization_id).catch(()=>null);
     if(cached)return{...cached.payload,offlineCached:true,cacheUpdatedAt:cached.updatedAt};
    }
    throw error;
   }
  },enabled:Boolean(profile?.organization_id),staleTime:15000,placeholderData:(old)=>old
 });
 const statsCacheScope=JSON.stringify(['reminder-overview',profile?.organization_id,user?.id,reminderCacheDay]);
 const statsQuery=useQuery<ReminderOverview>({
  queryKey:['reminder-overview',profile?.organization_id,user?.id,reminderCacheDay],
  enabled:Boolean(profile?.organization_id),staleTime:0,
  queryFn:async()=>{
   const empty:ReminderOverview={total:0,today:0,overdue:0,scheduled:0,done:0,undated:0};
   if(!profile?.organization_id)return empty;
   try{
    const [start,end]=todayRange(),now=new Date().toISOString();
    const base=()=>supabase.from('operational_reminders').select('id',{count:'exact',head:true}).eq('organization_id',profile.organization_id).is('deleted_at',null);
    const results=await Promise.all([base(),base().eq('status','open').gte('due_at',start.toISOString()).lt('due_at',end.toISOString()),base().eq('status','open').lt('due_at',now),base().eq('status','open').gte('due_at',now),base().eq('status','done'),base().eq('status','open').is('due_at',null)]);
    const failed=results.find(result=>result.error);if(failed?.error)throw failed.error;
    const result:ReminderOverview={total:results[0].count??0,today:results[1].count??0,overdue:results[2].count??0,scheduled:results[3].count??0,done:results[4].count??0,undated:results[5].count??0,offlineCached:false};
    await saveOfflineQueryCache(statsCacheScope,user?.id,profile.organization_id,result).catch(()=>false);
    return result;
   }catch(error){
    if(isOfflineReadError(error)){const cached=await readOfflineQueryCache<ReminderOverview>(statsCacheScope,user?.id,profile.organization_id).catch(()=>null);if(cached)return{...cached.payload,offlineCached:true,cacheUpdatedAt:cached.updatedAt};}
    throw error;
   }
  }
 });
 const queuedDrafts=useMemo(()=>queuedReminderDrafts(offlineQueue,user?.id??null,profile?.organization_id??null),[offlineQueue,user?.id,profile?.organization_id]);
 const queuedClientUuids=useMemo(()=>new Set(queuedDrafts.map(x=>x.reminder.client_uuid).filter((x):x is string=>Boolean(x))),[queuedDrafts]);
 const reminders=(query.data?.rows??[]).filter(r=>!(r.id.startsWith('local-')&&r.client_uuid&&queuedClientUuids.has(r.client_uuid)));
 const visibleSelectableIds=useMemo(()=>selectableReminderIds(reminders),[reminders]);
 const selectedReminders=useMemo(()=>reminders.filter(r=>selected.includes(r.id)&&!r.id.startsWith('local-')),[reminders,selected]);
 const allVisibleSelected=areAllVisibleReminderIdsSelected(selected,visibleSelectableIds);
 useEffect(()=>{const previous=previousQueueRef.current;const currentIds=new Set(offlineQueue.map(x=>x.id));const completed=previous.filter(x=>x.functionName==='create_operational_reminder'&&!currentIds.has(x.id));if(completed.length){const syncedUuids=new Set(completed.map(x=>{const args=x.args as {p_payload?:{client_uuid?:unknown}};const id=args.p_payload?.client_uuid;return typeof id==='string'?id:null;}).filter((x):x is string=>Boolean(x)));if(syncedUuids.size){qc.setQueriesData<QueryResult>({queryKey:['reminders']},old=>old?{...old,rows:old.rows.filter(r=>!(r.id.startsWith('local-')&&r.client_uuid&&syncedUuids.has(r.client_uuid)))}:old);void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']});}}previousQueueRef.current=offlineQueue;},[offlineQueue,qc]);
 const upsertVisible=(fn:(rows:Reminder[])=>Reminder[])=>{qc.setQueriesData<QueryResult>({queryKey:['reminders']},old=>old?{...old,rows:fn(old.rows)}:old);};
 const create=useMutation({
  mutationFn:async({parsed,clientUuid,allDay}:{parsed:ReturnType<typeof parseReminder>;clientUuid:string;allDay:boolean})=>{
   const payload={title:parsed.title,due_at:parsed.dueAt?.toISOString()??null,priority:parsed.priority,kind:parsed.kind,recurrence_rule:parsed.recurrenceRule,alarm_offsets_min:parsed.alarmOffsets,visibility:'private',all_day:parsed.dueAt?allDay:false,timezone:'Asia/Tehran',client_uuid:clientUuid};
   if(!navigator.onLine){const blocker=offlineReminderQueueBlocker(true,parsed.linkQuery,parsed.assigneeName);if(blocker)throw new Error(blocker);}
   const result=await rpcWithOfflineQueue('create_operational_reminder',{p_payload:payload}) as {data:Reminder|null;error:{message:string}|null;queued?:boolean;queueId?:string};
   if(result.error)throw new Error(result.error.message);
   if(result.queued){const blocker=offlineReminderQueueBlocker(true,parsed.linkQuery,parsed.assigneeName);if(blocker){if(result.queueId)await removeQueuedRpc(result.queueId);throw new Error(blocker);}}
   if(result.data){const link=await resolveLink(parsed.linkQuery,parsed.kind).catch(()=>null);const assignee=await resolveAssignee(parsed.assigneeName).catch(()=>null);if(link||assignee){const {data:linked,error:linkError}=await supabase.from('operational_reminders').update({...link,...(assignee?{assignee_id:assignee}: {})}).eq('id',result.data.id).select('id').maybeSingle();if(linkError)throw linkError;if(!linked)throw new Error('پیوند محموله یا مسئول ذخیره نشد.');}}
   return result;
  },
  onMutate:async({parsed,clientUuid,allDay})=>{await qc.cancelQueries({queryKey:['reminders']});const temp={id:'local-'+clientUuid,organization_id:profile?.organization_id??null,case_id:null,shipment_id:null,title:parsed.title,description:null,due_at:parsed.dueAt?.toISOString()??null,priority:parsed.priority,status:'open',created_by:user?.id??null,completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),due_precision:'day',source_key:null,is_system:false,kind:parsed.kind,entity_type:null,entity_id:null,assignee_id:user?.id??null,visibility:'private',all_day:parsed.dueAt?allDay:false,timezone:'Asia/Tehran',alarm_offsets_min:parsed.alarmOffsets,recurrence_rule:parsed.recurrenceRule,recurrence_until:null,series_id:null,occurrence_key:null,snoozed_until:null,snooze_count:0,tags:[],notes:null,client_uuid:clientUuid,deleted_at:null,completed_by:null} as Reminder;upsertVisible(rows=>[temp,...rows]);return{tempId:temp.id};},
  onError:(e,_v,ctx)=>{if(ctx?.tempId)upsertVisible(rows=>rows.filter(x=>x.id!==ctx.tempId));setToast({text:errorFa(e)});},
  onSettled:()=>{void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']});}
 });
 const update=useMutation({
  mutationFn:async(v:{id:string;patch:Partial<Reminder>})=>{const {data,error}=await supabase.from('operational_reminders').update(v.patch).eq('id',v.id).select('id').maybeSingle();if(error)throw error;if(!data)throw new Error('یادآور تغییر نکرد؛ ممکن است دسترسی لازم وجود نداشته باشد.');},
  onMutate:async(v)=>{await qc.cancelQueries({queryKey:['reminders']});const old=reminders.find(x=>x.id===v.id);upsertVisible(rows=>rows.map(x=>x.id===v.id?{...x,...v.patch,updated_at:new Date().toISOString()}:x));return{old};},
  onError:(e,v,ctx)=>{if(ctx?.old)upsertVisible(rows=>rows.map(x=>x.id===v.id?ctx.old!:x));setToast({text:errorFa(e)});},
  onSettled:()=>{void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']});}
 });
 const completeReminder=useMutation({
  mutationFn:async(reminder:Reminder)=>{
   const nextDue=nextRecurrenceDue(reminder.due_at,reminder.recurrence_rule,reminder.recurrence_until);
   const {data,error}=await supabase.rpc('complete_operational_reminder',{p_reminder_id:reminder.id,p_next_due_at:nextDue?.toISOString()??null});
   if(error)throw error;
   const result=data as {completed?:boolean;next_id?:string|null;next_due_at?:string|null;next_exists?:boolean}|null;
   if(!result?.completed)throw new Error('تکمیل یادآور تأیید نشد');
   return {reminder,nextDueAt:result.next_due_at??null,nextId:result.next_id??null};
  },
  onMutate:async(reminder)=>{
   await qc.cancelQueries({queryKey:['reminders']});
   const old=reminders.find(x=>x.id===reminder.id);
   upsertVisible(rows=>rows.map(x=>x.id===reminder.id?{...x,status:'done',completed_at:x.completed_at??new Date().toISOString(),completed_by:user?.id??null,updated_at:new Date().toISOString()}:x));
   return {old};
  },
  onError:(error,reminder,context)=>{
   if(context?.old)upsertVisible(rows=>rows.map(x=>x.id===reminder.id?context.old!:x));
   setToast({text:errorFa(error)});
  },
  onSuccess:({reminder,nextDueAt,nextId})=>{
   if(nextId&&nextDueAt){
    const nextDate=new Date(nextDueAt);
    const formatted=reminder.all_day?formatReminderDate(nextDate,language):formatReminderDateTime(nextDate,language);
    setToast({text:t('یادآور انجام شد')+' · '+t('نوبت بعدی ثبت شد')+': '+formatted});
   }else setToast({text:t('یادآور انجام شد')});
  },
  onSettled:()=>{
   void qc.invalidateQueries({queryKey:['reminders']});
   void qc.invalidateQueries({queryKey:['reminder-overview']});
   void qc.invalidateQueries({queryKey:['reminder-calendar']});
  }
 });
 const createQuick=async(text:string,dueDateOverride?:Date|null)=>{const parsed=parseReminder(text);if(dueDateOverride!==undefined)parsed.dueAt=dueDateOverride;const allDay=Boolean(parsed.dueAt&&dueDateOverride!==undefined&&quickAllDay);const clientUuid=crypto.randomUUID();setComposer('');setQuickDueAt(null);setQuickAllDay(false);setQuickDateSource(null);setComposerOpen(false);await create.mutateAsync({parsed,clientUuid,allDay}).catch(()=>{});};
 const changeComposer=(value:string)=>{setComposer(value);if(quickDateSource==='manual')return;const inferred=value.trim()?parseReminder(value).dueAt:null;setQuickDueAt(inferred);setQuickDateSource(inferred?'inferred':null);};
 const openCardMenu=(id:string,event:React.MouseEvent<HTMLButtonElement>)=>{const rect=event.currentTarget.getBoundingClientRect();const width=Math.min(248,window.innerWidth-24);const height=276;let top=rect.bottom+8;if(top+height>window.innerHeight-12)top=Math.max(12,rect.top-height-8);const left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12));setMenuId(id);setMenuPosition({top,left,width});};
 const closeCardMenu=()=>{setMenuId(null);setMenuPosition(null);};
 const openComposer=()=>{if(composerOpen){setComposerOpen(false);return;}setComposerOpen(true);window.setTimeout(()=>document.getElementById('reminder-quick-input')?.focus(),80);};
 const toggleDone=(r:Reminder)=>{if(r.id.startsWith('local-'))return;if(r.status==='done'){update.mutate({id:r.id,patch:{status:'open',completed_at:null,completed_by:null}});return;}completeReminder.mutate(r);};
 const softDelete=(r:Reminder)=>{const deletedAt=new Date().toISOString(),previousStatus=r.status,previousDeletedAt=r.deleted_at;update.mutate({id:r.id,patch:{deleted_at:deletedAt,status:'dismissed'}});setToast({text:t('یادآور از فهرست حذف شد'),undo:()=>update.mutate({id:r.id,patch:{deleted_at:previousDeletedAt,status:previousStatus}})});};
 const snooze=(r:Reminder,minutes:number)=>update.mutate({id:r.id,patch:{snoozed_until:new Date(Date.now()+minutes*60000).toISOString(),snooze_count:r.snooze_count+1}});
 const tomorrow=()=>{const j=toJalali(addJalaliDays(new Date(),1));return zonedJalaliToDate(j.year,j.month,j.day,9,0);};
 const toggleSelected=(id:string)=>{if(bulkAction||id.startsWith('local-'))return;setSelected(current=>toggleReminderSelection(current,id));};
 const bulkDone=async()=>{
  if(bulkAction)return;
  const batch=selectedReminders.filter(item=>item.status!=='done');
  if(!batch.length){setSelected([]);return;}
  setBulkAction('complete');
  const results=await Promise.allSettled(batch.map(item=>item.recurrence_rule&&item.due_at
   ?completeReminder.mutateAsync(item)
   :update.mutateAsync({id:item.id,patch:{status:'done',completed_at:new Date().toISOString(),completed_by:user?.id??null}})));
  const failed=batch.filter((_,index)=>results[index].status==='rejected');
  setSelected(current=>current.filter(id=>failed.some(item=>item.id===id)));
  setBulkAction(null);
  setToast({text:summarizeReminderBulkAction('complete',batch.length-failed.length,failed.length,language)});
 };
 const bulkSnooze=async()=>{
  if(bulkAction)return;
  const batch=selectedReminders.filter(item=>item.status==='open');
  if(!batch.length){setSelected([]);setToast({text:summarizeReminderBulkAction('snooze',0,0,language)});return;}
  setBulkAction('snooze');
  const results=await Promise.allSettled(batch.map(item=>update.mutateAsync({id:item.id,patch:{snoozed_until:new Date(Date.now()+600000).toISOString(),snooze_count:item.snooze_count+1}})));
  const succeeded=batch.filter((_,index)=>results[index].status==='fulfilled');
  const failed=batch.filter((_,index)=>results[index].status==='rejected');
  setSelected(current=>current.filter(id=>failed.some(item=>item.id===id)));
  setBulkAction(null);
  setToast({text:summarizeReminderBulkAction('snooze',succeeded.length,failed.length,language),...(succeeded.length?{undo:()=>{for(const item of succeeded)update.mutate({id:item.id,patch:{snoozed_until:item.snoozed_until,snooze_count:item.snooze_count}});}}:{})});
 };
 const bulkDismiss=async()=>{
  if(bulkAction)return;
  const batch=[...selectedReminders];
  if(!batch.length)return;
  const deletedAt=new Date().toISOString();
  setBulkAction('remove');
  const results=await Promise.allSettled(batch.map(item=>update.mutateAsync({id:item.id,patch:{status:'dismissed',deleted_at:deletedAt}})));
  const succeeded=batch.filter((_,index)=>results[index].status==='fulfilled');
  const failed=batch.filter((_,index)=>results[index].status==='rejected');
  setSelected(current=>current.filter(id=>failed.some(item=>item.id===id)));
  setBulkAction(null);
  setToast({text:summarizeReminderBulkAction('remove',succeeded.length,failed.length,language),...(succeeded.length?{undo:()=>{for(const item of succeeded)update.mutate({id:item.id,patch:{status:item.status,deleted_at:item.deleted_at}});}}:{})});
 };
 const openPush=async()=>{setPushOpen(true);if(pushAllowed){try{setPushDevices(await listPushDevices())}catch{setPushDevices([])}}};
 useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(null),5000);return()=>window.clearTimeout(t);},[toast]);
 useEffect(()=>{const onOnline=()=>{void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']});};window.addEventListener('online',onOnline);return()=>window.removeEventListener('online',onOnline);},[qc]);
 useEffect(()=>{const nav=navigator as Navigator & {setAppBadge?:(contents?:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};const badger=async()=>{try{if(!profile?.organization_id){await nav.clearAppBadge?.();return;}const {count,error}=await supabase.from('operational_reminders').select('id',{count:'exact',head:true}).eq('organization_id',profile.organization_id).is('deleted_at',null).eq('status','open').lt('due_at',new Date().toISOString());if(error)return;if(nav.setAppBadge)await nav.setAppBadge(count??0);}catch{}};void badger();},[reminders.length,profile?.organization_id]);
 useEffect(()=>{const channel=supabase.channel('reminders-live').on('postgres_changes',{event:'*',schema:'public',table:'operational_reminders'},()=>{void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']});}).subscribe();return()=>{void supabase.removeChannel(channel);};},[qc]);

 const groups=useMemo(()=>{const out:Array<{label:string;rows:Reminder[]}>=[];const [start,end]=todayRange(),tomorrowStart=addJalaliDays(start,1),tomorrowEnd=addJalaliDays(end,1);for(const r of reminders){let label=t('بدون سررسید');if(r.due_at){const d=new Date(r.due_at);label=d>=start&&d<end?t('امروز'):d>=tomorrowStart&&d<tomorrowEnd?t('فردا'):formatReminderDate(d,language);}const existing=out.find(x=>x.label===label);if(existing)existing.rows.push(r);else out.push({label,rows:[r]});}return out;},[reminders,language]);
 const totalPages=Math.max(1,Math.ceil((query.data?.count??0)/PAGE_SIZE));
  const calendarQuery=useQuery<CalendarReminderDate[]>({queryKey:['reminder-calendar',profile?.organization_id,calendarMonth.year,calendarMonth.month],enabled:Boolean(profile?.organization_id)&&isCalendarPage,staleTime:30000,queryFn:async()=>{if(!profile?.organization_id)return[];const nextMonth=shiftJalaliMonth(calendarMonth,1);const start=zonedJalaliToDate(calendarMonth.year,calendarMonth.month,1,0,0,0);const end=zonedJalaliToDate(nextMonth.year,nextMonth.month,1,0,0,0);const rows:CalendarReminderDate[]=[];for(let offset=0;;offset+=1000){const {data,error}=await supabase.from('operational_reminders').select('due_at').eq('organization_id',profile.organization_id).is('deleted_at',null).eq('status','open').gte('due_at',start.toISOString()).lt('due_at',end.toISOString()).order('due_at',{ascending:true}).range(offset,offset+999);if(error)throw error;const batch=(data??[]) as CalendarReminderDate[];rows.push(...batch);if(batch.length<1000)break;}return rows;}});
  const calendarGrid=useMemo(()=>buildJalaliMonthGrid(calendarMonth.year,calendarMonth.month,calendarQuery.data??[]),[calendarMonth.year,calendarMonth.month,calendarQuery.data]);
  const calendarMonthTitle=language==='fa'?JALALI_MONTHS[calendarMonth.month-1]+' '+reminderNumber(calendarMonth.year,language):['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'][calendarMonth.month-1]+' '+calendarMonth.year;
  const goToCalendarMonth=(year:number,month:number)=>navigate('/reminders/calendar?month='+jalaliMonthKey({year,month}));
  const selectedDayDate=currentSection==='day'?parseReminderDayKey(dayKey):null;
 const startDictation=()=>{const w=window as Window & {SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};const C=w.SpeechRecognition??w.webkitSpeechRecognition;if(!C){setToast({text:t('تشخیص گفتار در این مرورگر پشتیبانی نمی‌شود.')});return;}const recognition=new C();recognition.lang=language==='fa'?'fa-IR':'en-US';recognition.interimResults=true;recognition.onresult=(event)=>{let value='';for(let i=event.resultIndex;i<event.results.length;i++)value+=event.results[i][0]?.transcript??'';changeComposer(value);};recognition.onerror=()=>{setRecording(false);setToast({text:t('تشخیص گفتار انجام نشد.')});};recognition.onend=()=>setRecording(false);setRecording(true);recognition.start();};
 const submitComposer=(e:React.FormEvent)=>{e.preventDefault();const lines=composer.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>1){setComposer('');setQuickDueAt(null);for(const line of lines)void createQuick(line);}else if(composer.trim())void createQuick(composer.trim(),quickDueAt);};
 const onCardPointerDown=(id:string,e:React.PointerEvent)=>{if(e.pointerType==='mouse'||(e.target as HTMLElement).closest('button,input,a,[role="menu"]'))return;const timer=window.setTimeout(()=>{setSelected(s=>toggleReminderSelection(s,id));},550);(e.currentTarget as HTMLElement).dataset.longPress=String(timer);};
 const onCardPointerUp=(id:string,e:React.PointerEvent)=>{const el=e.currentTarget as HTMLElement;const timer=Number(el.dataset.longPress??0);if(timer)window.clearTimeout(timer);};
 const performSwipe=(r:Reminder,e:React.PointerEvent,start:{x:number})=>{const dx=e.clientX-start.x;if(Math.abs(dx)>70){if(dx>70)toggleDone(r);else snooze(r,10);}};
 const [pointerStart,setPointerStart]=useState<{x:number}|null>(null);

 const menuReminder=menuId?reminders.find(r=>r.id===menuId)??null:null;
 return <ReminderLocaleTree language={language}><main dir={language==='fa'?'rtl':'ltr'} className="reminders-page reminders-app-standalone min-h-[100dvh] pb-28" data-language={language}>

  {query.data?.offlineCached&&<div role="status" className="mx-3 sm:mx-6 mt-2 text-xs app-muted">دادهٔ ذخیره‌شده · آخرین همگام‌سازی {query.data.cacheUpdatedAt?formatReminderRelative(new Date(query.data.cacheUpdatedAt),language):''}</div>}
  {queuedDrafts.length>0&&<section role="status" aria-live="polite" className="mx-3 sm:mx-6 mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 shadow-sm"><div className="flex items-start gap-3"><span className="min-w-10 min-h-10 rounded-xl border border-amber-500/30 bg-amber-500/10 grid place-items-center text-amber-700"><UploadCloud size={19}/></span><div className="min-w-0 flex-1"><div className="flex items-center flex-wrap gap-2"><h2 className="font-black text-sm">{t('یادآورهای در انتظار همگام‌سازی')}</h2><span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-bold tabular-nums">{reminderNumber(queuedDrafts.length,language)}</span></div><p className="mt-1 text-xs app-muted">{t('این یادآورها فعلاً فقط روی همین دستگاه ذخیره شده‌اند و هنوز تأیید سرور را نگرفته‌اند.')}</p><p className="mt-1 text-xs app-muted">{online?t('با اتصال اینترنت، صف به‌صورت خودکار همگام‌سازی می‌شود.'):t('اتصال اینترنت قطع است؛ این موارد روی دستگاه باقی می‌مانند.')}</p></div></div><div className="mt-3 max-h-56 overflow-y-auto space-y-2">{queuedDrafts.map(({queueId,queueState,reminder})=><div key={queueId} className="flex items-center gap-3 rounded-xl border app-border bg-[var(--surface)] p-3"><span className="grid min-w-9 min-h-9 place-items-center rounded-lg bg-[var(--surface-2)] app-muted"><Clock3 size={16}/></span><div className="min-w-0 flex-1"><div className="font-bold text-sm truncate" data-user-content="true" dir="auto">{reminder.title}</div><div className="mt-1 text-xs app-muted">{reminder.due_at?(reminder.all_day?formatReminderDate(new Date(reminder.due_at),language):formatReminderDateTime(new Date(reminder.due_at),language)):t('بدون سررسید')}</div></div><span className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold bg-amber-500/10 text-amber-800">{t(queueState==='sending'?'در حال همگام‌سازی':'در صف')}</span></div>)}</div></section>}
  {isHome ? <section className="reminders-route-screen reminders-hub-screen" key={currentSection}>
    <header className="reminders-hub-header"><div className="reminders-hub-identity"><img src="/pwa/reminders-icon.svg" className="reminders-brand-icon" alt=""/><div className="min-w-0 flex-1"><div className="reminders-brand-kicker">{t('اپ مستقل · Customs OS')}</div><h1>{t('یادآورها')}</h1><p>{formatReminderDate(new Date(),language)} <span>·</span> {t('مرکز مدیریت کارها')}</p></div><div className="reminders-hub-actions"><button type="button" onClick={()=>goToSection('search')} aria-label={t('جست‌وجو')}><Search size={20}/></button><button type="button" onClick={openComposer} aria-label={t('یادآور جدید')}><Plus size={20}/></button><button type="button" onClick={()=>void openPush()} aria-label={t('اعلان‌ها')}><Bell size={20}/></button><button type="button" onClick={()=>goToSection('settings')} aria-label={t('تنظیمات')}><Languages size={20}/></button></div></div></header>
    <button type="button" onClick={()=>goToSection('search')} className="reminders-hub-search"><Search size={18}/><span>{t('جست‌وجو در همهٔ یادآورها')}</span><kbd>/</kbd></button>
    <section className="reminders-hub-hero"><div className="reminders-hub-hero-copy"><span className="reminders-hub-eyebrow"><Sparkles size={14}/>{t('برنامه‌ریزی هوشمند')}</span><h2>{t('کارهای مهم، در زمان درست')}</h2><p>{t('برای امروز')} <strong>{reminderNumber(statsQuery.data?.today??0,language)}</strong> {t('یادآور داری؛ یک کار را انتخاب کن و با تمرکز پیش برو.')}</p><button type="button" onClick={()=>goToSection('today')}>{t('مشاهدهٔ برنامهٔ امروز')}<ChevronLeft size={16}/></button></div><div className="reminders-hub-hero-art" aria-hidden="true"><span className="reminders-hero-orbit reminders-hero-orbit-one"/><span className="reminders-hero-orbit reminders-hero-orbit-two"/><span className="reminders-hero-calendar"><CalendarDays size={35}/><i/><i/><i/><i/><i/><i/></span><span className="reminders-hero-spark"><Check size={17}/></span><span className="reminders-hero-dot"/></div></section>
    <section className="reminders-hub-section"><div className="reminders-section-title"><div><h2>{t('فهرست‌های هوشمند')}</h2><p>{t('نمای سریع وضعیت کارها')}</p></div><button type="button" onClick={()=>goToSection('all')}>{t('همه')}<ChevronLeft size={15}/></button></div>
      <div className="reminders-smart-grid">{[
        {section:'today' as ReminderSection,label:'امروز',detail:'موعدهای امروز',value:statsQuery.data?.today,icon:CalendarDays,tone:'violet'},
        {section:'scheduled' as ReminderSection,label:'برنامه‌ریزی‌شده',detail:'کارهای پیشِ رو',value:statsQuery.data?.scheduled,icon:CalendarClock,tone:'blue'},
        {section:'overdue' as ReminderSection,label:'معوق',detail:'نیازمند پیگیری',value:statsQuery.data?.overdue,icon:Clock3,tone:'rose'},
        {section:'all' as ReminderSection,label:'همهٔ یادآورها',detail:'کل فهرست',value:statsQuery.data?.total,icon:ListChecks,tone:'orange'},
        {section:'done' as ReminderSection,label:'انجام‌شده',detail:'کارهای تکمیل‌شده',value:statsQuery.data?.done,icon:Check,tone:'green'},
        {section:'assigned' as ReminderSection,label:'واگذارشده به من',detail:'مسئولیت‌های من',value:undefined,icon:Users,tone:'indigo'},
        {section:'undated' as ReminderSection,label:'بدون سررسید',detail:'زمان‌بندی نشده',value:statsQuery.data?.undated,icon:CalendarDays,tone:'slate'},
        {section:'calendar' as ReminderSection,label:'تقویم',detail:'برنامهٔ روزانه',value:undefined,icon:CalendarClock,tone:'teal'}
      ].map(item=>{const Icon=item.icon;return <button type="button" key={item.section} className="reminders-smart-card" data-tone={item.tone} onClick={()=>goToSection(item.section)}><span className="reminders-smart-icon"><Icon size={21}/></span><span className="reminders-smart-label">{t(item.label)}</span><strong>{item.value===undefined?'›':reminderNumber(item.value,language)}</strong><small>{t(item.detail)}</small><ChevronLeft className="reminders-smart-arrow" size={15}/></button>;})}</div>
    </section>
    <section className="reminders-hub-section reminders-my-lists"><div className="reminders-section-title"><div><h2>{t('فهرست‌های من')}</h2><p>{t('دسته‌بندی یادآورها بر اساس کار')}</p></div><button type="button" onClick={()=>goToSection('lists')}>{t('مدیریت فهرست‌ها')}<ChevronLeft size={15}/></button></div><div className="reminders-my-list-rows">{kinds.map(([k,label])=>{const Icon=CATEGORY_ICON[k];return <button type="button" key={k} onClick={()=>goToSection(categoryRoute(k))}><span className={'reminders-category-icon tone-'+k}><Icon size={19}/></span><span className="reminders-category-copy"><strong>{t(label)}</strong><small>{t(k==='document'?'پیگیری اسناد و مدارک':k==='shipment'?'پرونده‌ها و محموله‌های مرتبط':k==='finance'?'سررسیدها و امور مالی':'یادآورهای شخصی و سایر موارد')}</small></span><ChevronLeft size={17}/></button>;})}</div></section>
    <section className="reminders-hub-section reminders-up-next"><div className="reminders-section-title"><div><h2>{t('در ادامه')}</h2><p>{t('چند مورد برای پیگیری')}</p></div><button type="button" onClick={()=>goToSection('scheduled')}>{t('نمایش برنامه')}<ChevronLeft size={15}/></button></div>
      {query.isError?<div className="reminders-hub-empty">{errorFa(query.error)} <button type="button" onClick={()=>void query.refetch()}>{t('تلاش دوباره')}</button></div>:query.isPending?<div className="reminders-up-next-loading"><i/><i/><i/></div>:reminders.filter(r=>r.status==='open').slice(0,4).map(r=><article key={r.id} className="reminders-up-next-row"><button type="button" onClick={()=>toggleDone(r)} aria-label={t('انجام شد')} className="reminders-up-next-check"><span/></button><div className="min-w-0 flex-1"><strong>{r.title}</strong><small>{r.due_at?(r.all_day?formatReminderDate(new Date(r.due_at),language):formatReminderRelative(new Date(r.due_at),language)+' · '+formatReminderDateTime(new Date(r.due_at),language)):t('بدون سررسید')}</small></div><button type="button" onClick={()=>goToSection(categoryRoute(r.kind))} aria-label={t('رفتن به فهرست مربوط')}><ChevronLeft size={16}/></button></article>)}
      {!query.isPending&&!query.isError&&!reminders.some(r=>r.status==='open')&&<div className="reminders-hub-empty"><Check size={25}/><strong>{t('همه‌چیز مرتب است')}</strong><span>{t('یادآور بازی برای نمایش وجود ندارد.')}</span><button type="button" onClick={()=>openComposer()}>{t('ساخت یادآور جدید')}<Plus size={15}/></button></div>}
    </section>
  </section> : isListsPage ? <section className="reminders-route-screen reminders-index-screen" key={currentSection}>
    <header className="reminders-subpage-heading"><button type="button" onClick={()=>goToSection('home')} aria-label={t('بازگشت')}><ChevronRight size={20}/></button><div><span>{t('یادآورها')}</span><h1>{t('فهرست‌های من')}</h1></div></header><p className="reminders-index-description">{t('برای دیدن یادآورهای هر حوزه، یک فهرست را باز کنید.')}</p>
    <div className="reminders-category-grid">{kinds.map(([k,label])=>{const Icon=CATEGORY_ICON[k];const detail=k==='document'?'اسناد گمرکی و مدارک محموله':k==='shipment'?'پرونده، محموله و پیگیری عملیات':k==='finance'?'پیگیری پرداخت و امور مالی':'کارهای عمومی و شخصی';return <button type="button" key={k} onClick={()=>goToSection(categoryRoute(k))} className="reminders-category-card"><span className={'reminders-category-icon tone-'+k}><Icon size={23}/></span><strong>{t(label)}</strong><p>{t(detail)}</p><span className="reminders-category-open">{t('بازکردن فهرست')}<ChevronLeft size={15}/></span></button>;})}</div>
  </section> : isSettingsPage ? <section className="reminders-route-screen reminders-index-screen" key={currentSection}>
    <header className="reminders-subpage-heading"><button type="button" onClick={()=>goToSection('home')} aria-label={t('بازگشت')}><ChevronRight size={20}/></button><div><span>{t('شخصی‌سازی')}</span><h1>{t('تنظیمات یادآورها')}</h1></div></header>
    <div className="reminders-settings-group"><div className="reminders-settings-group-title">{t('ترجیحات')}</div><button type="button" onClick={()=>setLanguage(x=>x==='fa'?'en':'fa')}><span className="reminders-settings-icon"><Languages size={20}/></span><span><strong>{t('زبان برنامه')}</strong><small>{t('زبان نمایش و قالب تاریخ')}</small></span><b>{language==='fa'?'فارسی':'English'}</b><ChevronLeft size={16}/></button><button type="button" onClick={()=>goToSection('calendar')}><span className="reminders-settings-icon"><CalendarDays size={20}/></span><span><strong>{t('نمای تقویم')}</strong><small>{t('تقویم شمسی و مرور روزانه')}</small></span><ChevronLeft size={16}/></button></div>
    <div className="reminders-settings-group"><div className="reminders-settings-group-title">{t('اعلان‌ها')}</div><button type="button" onClick={()=>void openPush()}><span className="reminders-settings-icon"><Bell size={20}/></span><span><strong>{t('تنظیم اعلان‌ها')}</strong><small>{t('دستگاه‌ها، ساعت‌های سکوت و آزمایش اعلان')}</small></span><ChevronLeft size={16}/></button></div>
    <div className="reminders-settings-note"><Sparkles size={18}/><p>{t('تغییر زبان بلافاصله اعمال می‌شود. مدیریت اعلان‌ها از تنظیمات موجود سامانه استفاده می‌کند.')}</p></div>
  </section> : isCalendarPage ? <section className="reminders-route-screen reminders-index-screen" key={currentSection}>
    <header className="reminders-subpage-heading"><button type="button" onClick={()=>goToSection('home')} aria-label={t('بازگشت')}><ChevronRight size={20}/></button><div><span>{t('زمان‌بندی')}</span><h1>{t('تقویم یادآورها')}</h1></div><button type="button" onClick={()=>{openComposer();setShowQuickPicker(true);}} aria-label={t('یادآور با تاریخ جدید')}><Plus size={19}/></button></header>
    <div className="reminders-calendar-month-toolbar"><button type="button" onClick={()=>{const prev=shiftJalaliMonth(calendarMonth,-1);goToCalendarMonth(prev.year,prev.month);}} aria-label={t('ماه قبل')} title={t('ماه قبل')}><ChevronRight size={20}/></button><strong>{calendarMonthTitle}</strong><button type="button" onClick={()=>{const next=shiftJalaliMonth(calendarMonth,1);goToCalendarMonth(next.year,next.month);}} aria-label={t('ماه بعد')} title={t('ماه بعد')}><ChevronLeft size={20}/></button><button type="button" onClick={()=>{const current=toJalali(new Date());goToCalendarMonth(current.year,current.month);}} className="reminders-calendar-today">{t('امروز')}</button></div>
    <p className="reminders-index-description">{t('یک روز را انتخاب کن تا یادآورهای همان روز را ببینی. عدد هر خانه تعداد یادآورهای باز آن روز است.')}</p>
    {calendarQuery.isError&&<div className="reminders-calendar-error"><span>{errorFa(calendarQuery.error)}</span><button type="button" onClick={()=>void calendarQuery.refetch()}>{t('تلاش دوباره')}</button></div>}
    <div className="reminders-calendar-month-grid" role="grid" aria-label={calendarMonthTitle}><div className="reminders-calendar-weekdays" role="row">{WEEK_DAYS.map((day,index)=><span key={day} role="columnheader">{language==='fa'?day:['Sat','Sun','Mon','Tue','Wed','Thu','Fri'][index]}</span>)}</div><div className="reminders-calendar-days" role="rowgroup">{calendarGrid.map(cell=>cell.day===null?<span key={cell.key} className="reminders-calendar-cell is-empty" aria-hidden="true"/>:<button key={cell.key} type="button" role="gridcell" aria-selected={cell.isToday} aria-label={cell.day+' '+calendarMonthTitle+(cell.count?'، '+reminderNumber(cell.count,language)+' '+t('یادآور'):'')} className={'reminders-calendar-cell '+(cell.isToday?'is-today ':'')+(cell.count?'has-reminders':'')} onClick={()=>goToDay(cell.key)}><span className="reminders-calendar-cell-day">{reminderNumber(cell.day,language)}</span>{cell.count>0?<span className="reminders-calendar-cell-count">{reminderNumber(cell.count,language)}</span>:<span className="reminders-calendar-cell-dot"/>}</button>)}</div></div>
    {calendarQuery.isPending&&<p className="reminders-calendar-loading">{t('در حال بارگذاری شمار یادآورها…')}</p>}
    <button type="button" onClick={()=>goToSection('scheduled')} className="reminders-calendar-all-link"><CalendarClock size={18}/>{t('نمایش همهٔ موارد برنامه‌ریزی‌شده')}<ChevronLeft size={16}/></button>
  </section> : (  <section className="reminders-route-screen reminders-list-screen mx-auto max-w-6xl px-2 sm:px-4 pt-2 sm:pt-5">
   <header className="reminders-standalone-header sticky top-0 z-20 rounded-3xl border app-border bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] backdrop-blur-xl px-3 py-3 shadow-sm">
    <div className="flex items-center gap-2"><button type="button" onClick={()=>goToSection('home')} className="reminders-route-back" aria-label={t('بازگشت به خانه')}><ChevronRight size={19}/></button><img src="/pwa/reminders-icon.svg" className="reminders-brand-icon" alt="" /><div className="flex-1 min-w-0"><div className="reminders-brand-kicker">{t('اپ مستقل · Customs OS')}</div><h1 className="text-2xl sm:text-3xl font-black">{currentSection==='day'&&selectedDayDate?formatReminderDate(selectedDayDate,language):t(SECTION_TITLE[currentSection])}</h1><div className="text-xs app-muted mt-1">{reminderNumber(query.data?.count??0,language)} · {t('تاریخ شمسی و متصل به عملیات')}</div></div><button type="button" onClick={openComposer} className="reminders-header-add" aria-label={t('یادآور جدید')}><Plus size={18}/><span>{t('یادآور جدید')}</span></button><button type="button" onClick={()=>goToSection('search')} className="min-w-11 min-h-11 rounded-xl border app-border bg-[var(--surface-2)]" title={t('جست‌وجو')} aria-label={t('جست‌وجو')}><Search size={18}/></button><button onClick={()=>void openPush()} className="min-w-11 min-h-11 rounded-xl border app-border bg-[var(--surface-2)]" title={t('اعلان‌ها')} aria-label={t('تنظیم اعلان‌ها')}><Bell size={18}/></button><button onClick={()=>{void query.refetch();void statsQuery.refetch()}} className="min-w-11 min-h-11 rounded-xl border app-border bg-[var(--surface-2)]" title={t('تازه‌سازی')} aria-label={t('تازه‌سازی یادآورها')}><RefreshCw size={17} className={query.isFetching?'animate-spin':''}/></button><button type="button" onClick={()=>setLanguage(x=>x==='fa'?'en':'fa')} className="reminders-language-switch" aria-label={language==='fa'?'Switch to English':'تغییر زبان به فارسی'}>{language==='fa'?'EN':'فا'}<Languages size={15}/></button><button onClick={()=>window.location.assign(window.location.hostname==='reminders.darbandicommercial.ir'?'https://darbandicommercial.ir/':'/')} className="reminders-return-button min-w-11 min-h-11 rounded-xl border app-border bg-[var(--surface-2)]" title={t('بازگشت به سامانه')} aria-label={t('بازگشت به سامانه')}><ExternalLink size={17}/></button></div>
    {isSearchPage?<div className="reminders-page-searchbar mt-3"><Search size={18}/><input id="reminders-page-search" autoFocus value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder={t('نام یادآور، محموله، پرونده یا یادداشت...')} aria-label={t('جست‌وجوی یادآورها')}/>{search&&<button type="button" onClick={()=>{setSearch('');setPage(0)}} aria-label={t('پاک‌کردن جست‌وجو')}><X size={17}/></button>}</div>:<button type="button" onClick={()=>goToSection('search')} className="reminders-search-launcher mt-3"><Search size={17}/><span>{t('جستجو در یادآورها...')}</span><kbd>/</kbd></button>}
    <div className="flex gap-2 overflow-x-auto mt-3 pb-1">{(['today','scheduled','overdue','all','done','assigned','undated'] as Filter[]).map(f=><button key={f} onClick={()=>goToSection(f)} className={'shrink-0 min-h-10 rounded-xl px-3 text-xs font-bold '+(filter===f?'bg-[var(--primary)] text-white':'bg-[var(--surface-2)] border app-border')}>{t(filterLabel[f])}</button>)}</div>
    <div className="flex gap-2 overflow-x-auto mt-2 pb-1">{kinds.map(([k,label])=><button key={k} onClick={()=>goToSection(kind===k?'all':categoryRoute(k))} className={'shrink-0 min-h-9 rounded-full px-3 text-xs '+(kind===k?'bg-[var(--text)] text-[var(--surface)]':'border app-border bg-[var(--surface)]')}>{t(label)}</button>)}</div>
   </header>

   <section className="reminders-overview mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4" aria-label={t('خلاصهٔ عملیاتی یادآورها')}>{[{label:'کل یادآورها',value:statsQuery.data?.total,detail:'همهٔ وضعیت‌ها',view:'all',icon:ListChecks,tone:'text-sky-700 bg-sky-500/10 border-sky-500/25'},{label:'موعد امروز',value:statsQuery.data?.today,detail:'نیازمند اقدام امروز',view:'today',icon:CalendarDays,tone:'text-violet-700 bg-violet-500/10 border-violet-500/25'},{label:'معوق',value:statsQuery.data?.overdue,detail:'موعد گذشته و باز',view:'overdue',icon:Clock3,tone:'text-rose-700 bg-rose-500/10 border-rose-500/25'},{label:'برنامه‌ریزی‌شده',value:statsQuery.data?.scheduled,detail:'موعدهای پیشِ‌رو',view:'scheduled',icon:RefreshCw,tone:'text-amber-700 bg-amber-500/10 border-amber-500/25'},{label:'انجام‌شده',value:statsQuery.data?.done,detail:'کارهای تکمیل‌شده',view:'done',icon:Check,tone:'text-emerald-700 bg-emerald-500/10 border-emerald-500/25'},{label:'بدون سررسید',value:statsQuery.data?.undated,detail:'نیاز به تعیین تاریخ ندارد',view:'undated',icon:CalendarClock,tone:'text-indigo-700 bg-indigo-500/10 border-indigo-500/25'}].map(item=>{const Icon=item.icon;return <button type="button" key={item.view} aria-pressed={filter===item.view} onClick={()=>goToSection(item.view as ReminderSection)} className="reminder-stat-card min-w-0 rounded-2xl border app-border bg-[var(--surface)] p-3 sm:p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" ><span className={'reminder-stat-icon inline-grid place-items-center h-10 w-10 rounded-xl border '+item.tone}><Icon size={19}/></span><span className="mt-3 block text-sm font-bold app-muted">{t(item.label)}</span><span className="reminder-stat-value mt-1 block text-2xl font-black tabular-nums">{item.value===undefined?'—':reminderNumber(item.value,language)}</span><span className="mt-1 block text-xs app-muted">{t(item.detail)}</span></button>})}</section>
   {statsQuery.isError&&<div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm"><div>{errorFa(statsQuery.error)}</div><button onClick={()=>void statsQuery.refetch()} className="mt-2 min-h-10 rounded-xl border app-border px-3 font-bold">تلاش دوباره</button></div>}

   {selectedReminders.length>0&&<div className="reminder-bulk-toolbar sticky top-[178px] z-10 mt-3 rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-sm" role="toolbar" aria-label={t('عملیات گروهی')} aria-busy={bulkAction!==null}>
    <div className="flex items-center justify-between gap-2">
     <div className="flex min-w-0 items-center gap-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border app-border bg-[var(--surface-2)]"><CheckCircle2 size={18}/></span>
      <span className="min-w-0 text-sm font-bold">{reminderNumber(selectedReminders.length,language)} {t(language==='fa'?'مورد انتخاب شده':selectedReminders.length===1?'مورد انتخاب شده':'موارد انتخاب شده')}</span>
      {bulkAction&&<span className="inline-flex shrink-0 items-center gap-1 text-xs app-muted"><RefreshCw size={13} className="animate-spin"/>{t('در حال انجام عملیات…')}</span>}
     </div>
     <button type="button" onClick={()=>setSelected([])} disabled={bulkAction!==null} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-xl border app-border px-2 sm:px-3 text-xs font-semibold disabled:opacity-50" aria-label={t('پاک‌کردن انتخاب')} title={t('پاک‌کردن انتخاب')}><X size={15}/><span className="hidden sm:inline">{t('پاک‌کردن انتخاب')}</span></button>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
     <button type="button" onClick={()=>setSelected(current=>areAllVisibleReminderIdsSelected(current,visibleSelectableIds)?deselectVisibleReminderIds(current,visibleSelectableIds):selectVisibleReminderIds(current,visibleSelectableIds))} disabled={bulkAction!==null||visibleSelectableIds.length===0} aria-pressed={allVisibleSelected} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border app-border px-3 text-xs font-semibold transition hover:bg-[var(--surface-2)] disabled:opacity-50 sm:col-span-1"><CheckCircle2 size={16}/>{t(allVisibleSelected?'لغو انتخاب موارد این صفحه':'انتخاب همهٔ موارد این صفحه')}</button>
     <button type="button" onClick={bulkDone} disabled={bulkAction!==null||selectedReminders.every(item=>item.status==='done')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkAction==='complete'?<RefreshCw size={15} className="animate-spin"/>:<Check size={16}/>} {t('تکمیل موارد')}</button>
     <button type="button" onClick={bulkSnooze} disabled={bulkAction!==null||selectedReminders.every(item=>item.status==='done')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border app-border px-3 text-xs font-semibold transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50">{bulkAction==='snooze'?<RefreshCw size={15} className="animate-spin"/>:<Clock3 size={16}/>} {t('تعویق ۱۰ دقیقه')}</button>
     <button type="button" onClick={bulkDismiss} disabled={bulkAction!==null} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1">{bulkAction==='remove'?<RefreshCw size={15} className="animate-spin"/>:<Trash2 size={16}/>} {t('حذف از فهرست')}</button>
    </div>
   </div>}

   {query.isPending&&<div className="space-y-2 mt-3">{Array.from({length:5},(_,i)=><div key={i} className="h-24 rounded-2xl bg-[var(--surface-2)] animate-pulse border app-border"/>)}</div>}
   {query.isError&&<div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><div>{errorFa(query.error)}</div><button onClick={()=>void query.refetch()} className="mt-2 min-h-10 rounded-xl border app-border px-3 font-bold">بارگذاری دوباره</button></div>}

   <div className="mt-3 space-y-5">
    {groups.map(group=><section key={group.label}><div className="px-2 mb-2 text-sm font-black">{group.label}</div><div className="space-y-2">{group.rows.map(r=><article key={r.id} onPointerDown={e=>{onCardPointerDown(r.id,e);if(!(e.target as HTMLElement).closest('button,input,a,[role="menu"]'))setPointerStart({x:e.clientX})}} onPointerUp={e=>{onCardPointerUp(r.id,e);if(pointerStart&&!(e.target as HTMLElement).closest('button,input,a,[role="menu"]')){performSwipe(r,e,pointerStart);setPointerStart(null)}}} className={'reminder-card relative rounded-2xl border app-border bg-[var(--surface)] p-3 transition '+(selected.includes(r.id)?'ring-2 ring-[var(--primary)] ':'')} style={{contentVisibility:'auto',containIntrinsicSize:'0 96px'}}>
      <div className="flex items-start gap-3"><button aria-label={r.status==='done'?'بازگرداندن':'انجام شد'} onClick={()=>toggleDone(r)} disabled={completeReminder.isPending&&completeReminder.variables?.id===r.id} aria-busy={completeReminder.isPending&&completeReminder.variables?.id===r.id} className={'min-w-11 min-h-11 rounded-xl grid place-items-center border app-border disabled:opacity-60 '+(r.status==='done'?'bg-emerald-600 text-white':'bg-[var(--surface-2)]')}>{r.status==='done'?<Check size={18}/>:completeReminder.isPending&&completeReminder.variables?.id===r.id?<RefreshCw size={17} className="animate-spin"/>:<span className="w-5 h-5 rounded-full border-2 border-current"/>}</button>
       <div className="flex-1 min-w-0"><div data-user-content="true" dir="auto" className={'font-black text-sm leading-6 '+(r.status==='done'?'line-through opacity-60':'')}>{r.title}</div><div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] app-muted"><span className={!r.due_at?'is-undated':''}>{r.due_at?<><Clock3 size={12} className="inline me-1"/>{r.all_day?formatReminderDate(new Date(r.due_at),language):formatReminderRelative(new Date(r.due_at),language)+' · '+formatReminderDateTime(new Date(r.due_at),language)}</>:<><CalendarClock size={12} className="inline me-1"/>{t('بدون سررسید')}</>}</span><span>{priorityLabel[r.priority]}</span><span>{kinds.find(x=>x[0]===r.kind)?.[1]??'سایر'}</span>{r.recurrence_rule&&<span><Repeat2 size={12} className="inline me-1"/>{t('تکرارشونده')}</span>}{r.assignee_id&&r.assignee_id===user?.id&&<span>به من</span>}</div>{(r.case_id||r.shipment_id)&&<div className="text-[11px] mt-1 text-[var(--primary)]">{r.case_id&&r.shipment_id?'پرونده و محموله مرتبط':r.case_id?'پرونده مرتبط':'محموله مرتبط'}</div>}{r.notes&&<div data-user-content="true" dir="auto" className="text-xs app-muted mt-1 line-clamp-2">{r.notes}</div>}</div>
       <button type="button" onClick={e=>{e.stopPropagation();toggleSelected(r.id)}} disabled={r.id.startsWith('local-')||bulkAction!==null} className={'reminder-select-trigger min-w-11 min-h-11 rounded-xl border app-border grid place-items-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] '+(selected.includes(r.id)?'bg-[var(--primary)] text-white border-[var(--primary)]':'bg-[var(--surface-2)] hover:bg-[var(--surface)]')} aria-pressed={selected.includes(r.id)} aria-label={t(selected.includes(r.id)?'لغو انتخاب':'انتخاب یادآور')} title={t(selected.includes(r.id)?'لغو انتخاب':'انتخاب یادآور')}>{selected.includes(r.id)?<CheckCircle2 size={18}/>:<Circle size={18}/>}</button><button type="button" onClick={e=>openCardMenu(r.id,e)} disabled={r.id.startsWith('local-')} className="reminder-overflow-trigger min-w-11 min-h-11 rounded-xl border app-border bg-[var(--surface-2)]" aria-haspopup="menu" aria-expanded={menuId===r.id} aria-label={t('گزینه‌های یادآور')}><MoreHorizontal size={20}/></button>
      </div>
     </article>)}</div></section>)}
   </div>
   {!query.isPending&&!query.isError&&!groups.length&&<div className="reminders-empty-state mt-5 rounded-3xl border app-border bg-[var(--surface)] p-6 sm:p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--surface-2)] border app-border"><Bell size={26} className="app-muted"/></span><div className="mt-3 text-base font-black">{search.trim()||kind?'در این جستجو یا دسته‌بندی یادآوری پیدا نشد':filter==='today'?'برای امروز یادآوری ثبت نشده است':filter==='scheduled'?'یادآوری برنامه‌ریزی‌شده‌ای وجود ندارد':filter==='overdue'?'مورد معوقی برای نمایش وجود ندارد':filter==='done'?'یادآور انجام‌شده‌ای پیدا نشد':filter==='assigned'?'یادآوری واگذارشده‌ای پیدا نشد':'هنوز یادآوری قابل‌نمایشی وجود ندارد'}</div><div className="mt-2 text-sm app-muted">ممکن است این نما خالی باشد؛ برای بررسی همهٔ موارد، فیلتر و جستجو را پاک کنید.</div><button type="button" onClick={()=>{setFilter('all');setKind(null);setSearch('');setPage(0)}} className="mt-4 min-h-11 rounded-xl bg-[var(--primary)] px-4 font-bold text-white">نمایش همهٔ یادآورها</button></div>}
   <div className="flex items-center justify-between mt-5 pb-10"><button disabled={page===0} onClick={()=>setPage(x=>x-1)} className="min-h-11 px-3 rounded-xl border app-border disabled:opacity-40"><ChevronRight size={17}/></button><span className="text-xs app-muted">{reminderNumber(page+1,language)} از {reminderNumber(totalPages,language)}</span><button disabled={page+1>=totalPages} onClick={()=>setPage(x=>x+1)} className="min-h-11 px-3 rounded-xl border app-border disabled:opacity-40"><ChevronLeft size={17}/></button></div>
  </section>  )}

  <form onSubmit={submitComposer} onClick={e=>{if(e.target===e.currentTarget)setComposerOpen(false)}} className={"reminders-composebar fixed inset-0 z-[150] "+(composerOpen?"is-open":"")} role="dialog" aria-modal="true" aria-label={t('یادآور جدید')}>
   <div className="reminders-compose-sheet" onClick={e=>e.stopPropagation()}>
    <div className="reminders-compose-heading"><span className="reminders-compose-icon"><Sparkles size={19}/></span><div className="flex-1 min-w-0"><h2>{t('ثبت هوشمند')}</h2><p>{t('برای ثبت سریع، متن را بنویسید؛ تاریخ فقط وقتی تعیین می‌شود که انتخاب یا در متن مشخص شده باشد.')}</p></div><button type="button" onClick={()=>setComposerOpen(false)} className="reminder-header-icon" aria-label={t('بستن فرم')}><X size={19}/></button></div>
    <textarea id="reminder-quick-input" rows={2} value={composer} onChange={e=>changeComposer(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setComposerOpen(false)}} placeholder={t('مثلاً: فردا ساعت ۹ صبح پیگیری ترخیص کوتاژ ۱۲۳')} className="reminders-smart-input" enterKeyHint="done"/>
    {preview&&<div className="reminders-smart-preview"><span className="reminders-preview-title"><Sparkles size={14}/>{t('پیش‌نمایش هوشمند')}</span><strong data-user-content="true" dir="auto">{preview.title}</strong><div className="reminders-preview-meta"><span>{t(priorityLabel[preview.priority])}</span><span>{t(kinds.find(x=>x[0]===preview.kind)?.[1]??'سایر')}</span><span><CalendarClock size={13}/>{quickDueAt?formatReminderDateTime(quickDueAt,language):t('بدون سررسید')}</span></div></div>}
    <div className="reminders-compose-actions"><button type="button" onClick={()=>setShowQuickPicker(true)} className="reminders-date-control"><CalendarDays size={17}/><span>{quickDueAt?formatReminderDateTime(quickDueAt,language):t('افزودن سررسید')}</span><ChevronDown size={14}/></button>{quickDueAt&&<button type="button" onClick={()=>{setQuickDueAt(null);setQuickDateSource(null);setQuickAllDay(false)}} className="reminders-clear-date" aria-label={t('پاک‌کردن تاریخ')}><X size={16}/></button>}<button type="button" onClick={()=>{if(!recording)startDictation()}} className="reminders-mic-control" aria-label={t('دیکته صوتی')}>{recording?<MicOff size={18}/>:<Mic size={18}/>}</button><button type="submit" disabled={!composer.trim()||create.isPending} className="reminders-submit-button">{create.isPending?<RefreshCw size={17} className="animate-spin"/>:<Send size={17}/>}<span>{create.isPending?t('در حال ثبت…'):t('ثبت یادآور')}</span></button></div>
   </div>
  </form>

  <nav className="reminders-mobile-nav" aria-label={t('ناوبری اپ یادآورها')}><button type="button" className={currentSection==='today'?'is-active':''} onClick={()=>goToSection('today')}><CalendarDays size={20}/><span>{t('امروز')}</span></button><button type="button" className={currentSection==='lists'||currentSection.startsWith('list-')?'is-active':''} onClick={()=>goToSection('lists')}><ListChecks size={20}/><span>{t('فهرست‌ها')}</span></button><button type="button" className={'reminders-mobile-add '+(composerOpen?'is-open':'')} onClick={openComposer} aria-label={composerOpen?t('بستن فرم'):t('یادآور جدید')}><span>{composerOpen?<X size={22}/>:<Plus size={22}/>}</span><small>{composerOpen?t('بستن فرم'):t('یادآور جدید')}</small></button><button type="button" className={isSearchPage?'is-active':''} onClick={()=>goToSection('search')}><Search size={20}/><span>{t('جست‌وجو')}</span></button><button type="button" className={isSettingsPage?'is-active':''} onClick={()=>goToSection('settings')}><Languages size={20}/><span>{t('تنظیمات')}</span></button></nav>
  {menuReminder&&menuPosition&&<><button type="button" className="reminder-menu-scrim" onClick={closeCardMenu} aria-label={t('بستن')}/><div role="menu" className="reminder-overflow-menu" style={{top:menuPosition.top,left:menuPosition.left,width:menuPosition.width}}>
    <button type="button" role="menuitem" onClick={()=>{snooze(menuReminder,10);closeCardMenu()}}><Clock3 size={17}/><span>{t('۱۰ دقیقه بعد')}</span></button>
    <button type="button" role="menuitem" onClick={()=>{snooze(menuReminder,60);closeCardMenu()}}><Clock3 size={17}/><span>{t('۱ ساعت بعد')}</span></button>
    <button type="button" role="menuitem" onClick={()=>{update.mutate({id:menuReminder.id,patch:{snoozed_until:tomorrow().toISOString(),snooze_count:menuReminder.snooze_count+1}});closeCardMenu()}}><CalendarClock size={17}/><span>{t('فردا ۹ صبح')}</span></button>
    <button type="button" role="menuitem" onClick={()=>{softDelete(menuReminder);closeCardMenu()}} className="is-danger"><Trash2 size={17}/><span>{t('حذف از فهرست')}</span></button>
    <button type="button" role="menuitem" onClick={()=>{setEditor(menuReminder);closeCardMenu()}}><ArrowUpRight size={17}/><span>{t('ویرایش')}</span></button>
   </div></>}

  {editor&&<ReminderEditor reminder={editor} language={language} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);void qc.invalidateQueries({queryKey:['reminders']});void qc.invalidateQueries({queryKey:['reminder-overview']});void qc.invalidateQueries({queryKey:['reminder-calendar']})}} onPicker={()=>setShowPicker(true)}/>}
  {showPicker&&editor&&<JalaliDateTimePicker value={editor.due_at?new Date(editor.due_at):new Date()} language={language} onChange={d=>setEditor({...editor,due_at:d.toISOString()})} allDay={editor.all_day} onAllDayChange={v=>{const j=toJalali(new Date(editor.due_at??Date.now()));setEditor({...editor,all_day:v,...(v?{due_at:zonedJalaliToDate(j.year,j.month,j.day,9,0).toISOString()}:{})})}} onClear={()=>{setEditor({...editor,due_at:null,all_day:false});setShowPicker(false)}} onApply={()=>setShowPicker(false)} onClose={()=>setShowPicker(false)}/>}
  {showQuickPicker&&<JalaliDateTimePicker value={quickDueAt??new Date()} language={language} onChange={d=>{setQuickDueAt(d);setQuickDateSource('manual')}} allDay={quickAllDay} onAllDayChange={setQuickAllDay} onClear={()=>{setQuickDueAt(null);setQuickDateSource(null);setQuickAllDay(false);setShowQuickPicker(false)}} onApply={()=>setShowQuickPicker(false)} onClose={()=>setShowQuickPicker(false)}/>}
  {pushOpen&&<PushSettings allowed={pushAllowed} devices={pushDevices} busy={pushBusy} language={language} onClose={()=>setPushOpen(false)} setBusy={setPushBusy} reloadDevices={async()=>setPushDevices(await listPushDevices())}/>}
  {toast&&<div role="status" aria-live="polite" className="fixed bottom-24 left-3 right-3 md:left-auto md:right-6 md:w-[360px] z-[200] rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-xl flex items-center gap-3"><div className="min-w-0 flex-1 text-sm leading-6">{toast.text}</div>{toast.undo&&<button type="button" onClick={()=>{toast.undo?.();setToast(null)}} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-[var(--primary)] px-3 text-xs font-bold text-white"><Undo2 size={14}/>{t('بازگردانی')}</button>}<button type="button" onClick={()=>setToast(null)} aria-label={t('بستن')} className="grid min-w-11 min-h-11 shrink-0 place-items-center rounded-xl border app-border"><X size={15}/></button></div>}
 </main></ReminderLocaleTree>
};

const ReminderEditor:React.FC<{reminder:Reminder;language:ReminderLanguage;onClose:()=>void;onSaved:()=>void;onPicker:()=>void}>=({reminder,language,onClose,onSaved,onPicker})=>{
 const t=(value:string)=>reminderText(value,language);const {profile}=useAuth();
 const [title,setTitle]=useState(reminder.title),[notes,setNotes]=useState(reminder.notes??''),[priority,setPriority]=useState(reminder.priority),[kind,setKind]=useState(reminder.kind),[visibility,setVisibility]=useState(reminder.visibility),[recurrence,setRecurrence]=useState(reminder.recurrence_rule??''),[offsets,setOffsets]=useState<number[]>(reminder.alarm_offsets_min?.length?reminder.alarm_offsets_min:[0]),[tagText,setTagText]=useState(reminder.tags.join(' ')),[items,setItems]=useState<Array<{id:string;title:string;is_done:boolean}>>([]),[check,setCheck]=useState(''),[saving,setSaving]=useState(false),[formError,setFormError]=useState(''),[checklistBusy,setChecklistBusy]=useState(false),[checklistError,setChecklistError]=useState(''),[assigneeId,setAssigneeId]=useState(reminder.assignee_id??''),[people,setPeople]=useState<Array<{id:string;full_name:string;role:string}>>([]),[entitySearch,setEntitySearch]=useState(''),[entity,setEntity]=useState<ReminderEntitySelection|null>(()=>reminder.entity_type&&reminder.entity_id?{type:reminder.entity_type,id:reminder.entity_id,label:'موجودیت پیوندشده',caseId:reminder.case_id,shipmentId:reminder.shipment_id}:reminder.shipment_id?{type:'shipments',id:reminder.shipment_id,label:'محموله مرتبط',caseId:reminder.case_id,shipmentId:reminder.shipment_id}:reminder.case_id?{type:'cases',id:reminder.case_id,label:'پرونده مرتبط',caseId:reminder.case_id,shipmentId:null}:null),[entityResults,setEntityResults]=useState<ReminderEntitySelection[]>([]),[entityError,setEntityError]=useState(''),[entityCleared,setEntityCleared]=useState(false);
 useEffect(()=>{void (async()=>{const {data}=await supabase.from('profiles').select('id,full_name,role').eq('is_active',true).neq('role','client').order('full_name');setPeople((data??[]) as Array<{id:string;full_name:string;role:string}>);})();if(!reminder.id)return;void (async()=>{const {data}=await supabase.from('reminder_checklist_items').select('id,title,is_done').eq('reminder_id',reminder.id).order('position');setItems((data??[]) as Array<{id:string;title:string;is_done:boolean}>);})();},[reminder.id]);
 const save=async()=>{
  const titleError=validateReminderTitle(title);
  if(titleError){setFormError(titleError);return;}
  if(!reminder.id){setFormError('یادآور هنوز شناسهٔ ذخیره‌شده ندارد؛ ابتدا آن را ثبت کنید.');return;}
  setSaving(true);setFormError('');
  try{
   const {data,error}=await supabase.from('operational_reminders').update({title:title.trim(),notes:notes.trim()||null,due_at:reminder.due_at,all_day:reminder.all_day,timezone:reminder.timezone||'Asia/Tehran',priority,kind,visibility,assignee_id:assigneeId||null,entity_type:entity?.type??null,entity_id:entity?.id??null,...(entity?{case_id:entity.type==='cases'?entity.id:(entity.caseId!==undefined?entity.caseId:reminder.case_id),shipment_id:entity.type==='shipments'?entity.id:(entity.shipmentId!==undefined?entity.shipmentId:reminder.shipment_id)}:entityCleared?{case_id:null,shipment_id:null}:{}),alarm_offsets_min:offsets,recurrence_rule:recurrence.trim()?recurrence.trim():null,tags:parseReminderTags(tagText)}).eq('id',reminder.id).select('id').maybeSingle();
   if(error)throw error;
   if(!data)throw new Error('یادآور تغییر نکرد');
   onSaved();
  }catch(error){setFormError(errorFa(error));}
  finally{setSaving(false);}
 };
 const addCheck=async()=>{
  if(!check.trim()||!reminder.id||checklistBusy)return;
  setChecklistBusy(true);setChecklistError('');
  try{
   const {data,error}=await supabase.from('reminder_checklist_items').insert({reminder_id:reminder.id,title:check.trim(),position:items.length}).select('id,title,is_done').single();
   if(error)throw error;
   if(!data)throw new Error('مورد چک‌لیست ذخیره نشد');
   setItems(current=>[...current,data as {id:string;title:string;is_done:boolean}]);setCheck('');
  }catch(error){setChecklistError(errorFa(error));}
  finally{setChecklistBusy(false);}
 };
 const toggleCheck=async(item:{id:string;title:string;is_done:boolean})=>{
  if(checklistBusy)return;
  const previous=item.is_done,next=!previous;
  setChecklistBusy(true);setChecklistError('');setItems(current=>current.map(i=>i.id===item.id?{...i,is_done:next}:i));
  try{
   const {data,error}=await supabase.from('reminder_checklist_items').update({is_done:next}).eq('id',item.id).select('id').maybeSingle();
   if(error)throw error;
   if(!data)throw new Error('یادآور تغییر نکرد');
  }catch(error){setItems(current=>current.map(i=>i.id===item.id?{...i,is_done:previous}:i));setChecklistError(errorFa(error));}
  finally{setChecklistBusy(false);}
 };
 const removeCheck=async(id:string)=>{
  if(checklistBusy)return;
  const previousItems=items;
  if(!previousItems.some(item=>item.id===id))return;
  setChecklistBusy(true);setChecklistError('');setItems(current=>current.filter(item=>item.id!==id));
  try{
   const {data,error}=await supabase.from('reminder_checklist_items').delete().eq('id',id).select('id').maybeSingle();
   if(error)throw error;
   if(!data)throw new Error('یادآور تغییر نکرد');
  }catch(error){setItems(previousItems);setChecklistError(errorFa(error));}
  finally{setChecklistBusy(false);}
 };
 const recurrenceMode=recurrenceFrequency(recurrence);
 const recurrenceModeLabel:Record<ReminderRecurrenceFrequency,string>={none:'تکرار برای این یادآور خاموش است',daily:'تکرار هر روز فعال است',weekly:'تکرار هر هفته فعال است',monthly:'تکرار هر ماه فعال است',yearly:'تکرار هر سال فعال است'};
 const searchEntities=async(raw:string)=>{
  setEntitySearch(raw);setEntityError('');
  const q=raw.trim().replace(/[,()%_*]/g,' ').replace(/\s+/g,' ').trim();
  if(q.length<2){setEntityResults([]);return;}
  if(!profile?.organization_id){setEntityResults([]);setEntityError('سازمان فعال برای جستجوی موارد مرتبط پیدا نشد.');return;}
  try{
   const org=profile.organization_id,pattern=(fields:string[])=>fields.map(f=>f+'.ilike.%'+q+'%').join(',');
   const [s,c,cd,sd,docs,inv,cl]=await Promise.all([
    supabase.from('shipments').select('id,display_name,bill_of_lading_no,case_id').eq('organization_id',org).or(pattern(['display_name','bill_of_lading_no'])).limit(4),
    supabase.from('cases').select('id,display_name,case_number,registration_order_no,proforma_no').eq('organization_id',org).or(pattern(['display_name','case_number','registration_order_no','proforma_no'])).limit(4),
    supabase.from('customs_documents').select('id,display_name,original_name,document_number,case_id,shipment_id').eq('organization_id',org).or(pattern(['display_name','original_name','document_number'])).limit(4),
    supabase.from('shipment_documents').select('id,document_name,original_file_name,shipment_id').eq('organization_id',org).or(pattern(['document_name','original_file_name'])).limit(4),
    supabase.from('documents').select('id,file_name,doc_type,case_id').eq('organization_id',org).ilike('file_name','%'+q+'%').limit(4),
    supabase.from('finance_invoices').select('id,invoice_no,client_id').eq('organization_id',org).ilike('invoice_no','%'+q+'%').limit(4),
    supabase.from('clients').select('id,name,economic_code,national_id').eq('organization_id',org).or(pattern(['name','economic_code','national_id'])).limit(4)
   ]);
   const results:ReminderEntitySelection[]=[];let failed=false;
   if(s.error)failed=true;else for(const x of (s.data??[]) as Array<{id:string;display_name:string|null;bill_of_lading_no:string|null;case_id:string|null}>)results.push({type:'shipments',id:x.id,label:x.display_name??x.bill_of_lading_no??'محموله',caseId:x.case_id,shipmentId:x.id});
   if(c.error)failed=true;else for(const x of (c.data??[]) as Array<{id:string;display_name:string|null;case_number:string|null;registration_order_no:string|null;proforma_no:string|null}>)results.push({type:'cases',id:x.id,label:x.display_name??(x.case_number?'پرونده '+x.case_number:x.registration_order_no?'ثبت سفارش '+x.registration_order_no:x.proforma_no?'پروفورما '+x.proforma_no:'پرونده'),caseId:x.id,shipmentId:null});
   if(cd.error)failed=true;else for(const x of (cd.data??[]) as Array<{id:string;display_name:string|null;original_name:string|null;document_number:string|null;case_id:string|null;shipment_id:string|null}>)results.push({type:'customs_documents',id:x.id,label:x.display_name??x.original_name??x.document_number??'سند گمرکی',caseId:x.case_id,shipmentId:x.shipment_id});
   if(sd.error)failed=true;else for(const x of (sd.data??[]) as Array<{id:string;document_name:string|null;original_file_name:string|null;shipment_id:string|null}>)results.push({type:'shipment_documents',id:x.id,label:x.document_name??x.original_file_name??'سند محموله',caseId:null,shipmentId:x.shipment_id});
   if(docs.error)failed=true;else for(const x of (docs.data??[]) as Array<{id:string;file_name:string;doc_type:string|null;case_id:string|null}>)results.push({type:'documents',id:x.id,label:x.file_name||x.doc_type||'سند پرونده',caseId:x.case_id,shipmentId:null});
   if(inv.error)failed=true;else for(const x of (inv.data??[]) as Array<{id:string;invoice_no:string|null;client_id:string|null}>)results.push({type:'finance_invoices',id:x.id,label:x.invoice_no?'فاکتور '+x.invoice_no:'فاکتور مالی',caseId:null,shipmentId:null});
   if(cl.error)failed=true;else for(const x of (cl.data??[]) as Array<{id:string;name:string;economic_code:string|null;national_id:string|null}>)results.push({type:'clients',id:x.id,label:x.name,caseId:null,shipmentId:null});
   setEntityResults(results);
   if(failed)setEntityError('برخی انواع مورد مرتبط به‌دلیل محدودیت دسترسی یا خطای جستجو نمایش داده نشدند.');
  }catch{setEntityResults([]);setEntityError('جستجوی موارد مرتبط انجام نشد؛ اتصال و دسترسی را بررسی کنید.');}
 };
 return <ReminderLocaleTree language={language}><div className="fixed inset-0 z-[160] bg-black/55 flex items-end md:items-center justify-center" dir={language==='fa'?'rtl':'ltr'}><div className="w-full md:max-w-lg max-h-[94vh] overflow-auto rounded-t-[28px] md:rounded-[28px] border app-border bg-[var(--surface)] p-4 pb-[calc(18px+env(safe-area-inset-bottom))] shadow-2xl"><div className="flex items-center justify-between gap-3 mb-3"><div><b className="text-lg">ویرایش یادآور</b><div className="text-xs app-muted mt-1">{reminder.due_at?(reminder.all_day?formatReminderDate(new Date(reminder.due_at),language):formatReminderDateTime(new Date(reminder.due_at),language)):t('بدون سررسید')}</div></div><button onClick={onClose} disabled={saving} aria-label="بستن ویرایش" className="min-w-11 min-h-11 rounded-xl border app-border disabled:opacity-50"><X size={17}/></button></div>
  <div className="space-y-3">
   <input value={title} onChange={e=>setTitle(e.target.value)} aria-label="عنوان یادآور" placeholder="عنوان یادآور" maxLength={180} className="w-full min-h-12 rounded-xl border app-border bg-[var(--surface-2)] px-3 outline-none"/><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="یادداشت" className="w-full min-h-24 rounded-xl border app-border bg-[var(--surface-2)] p-3 outline-none"/>
   <button onClick={onPicker} className="w-full min-h-12 rounded-xl border app-border bg-[var(--surface-2)] text-right px-3 flex items-center gap-2"><CalendarDays size={16}/><span className="flex-1">{reminder.due_at?(reminder.all_day?formatReminderDate(new Date(reminder.due_at),language):formatReminderDateTime(new Date(reminder.due_at),language)):t('بدون سررسید')}</span><span className="text-xs app-muted">تغییر</span></button>
   <div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold">اولویت<select value={priority} onChange={e=>setPriority(e.target.value as ReminderPriority)} className="min-h-12 rounded-xl border app-border bg-[var(--surface-2)] px-3"><option value="low">کم</option><option value="normal">عادی</option><option value="high">زیاد</option><option value="urgent">فوری</option></select></label><label className="text-xs font-bold">دسته<select value={kind} onChange={e=>setKind(e.target.value as ReminderKind)} className="min-h-12 rounded-xl border app-border bg-[var(--surface-2)] px-3">{kinds.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><label className="block text-xs font-bold mt-3">مسئول<select value={assigneeId} onChange={e=>setAssigneeId(e.target.value)} className="w-full mt-1 min-h-12 rounded-xl border app-border bg-[var(--surface-2)] px-3"><option value="">من</option>{people.map(p=><option key={p.id} value={p.id} data-user-content="true" dir="auto">{p.full_name} · {p.role}</option>)}</select></label><div className="rounded-xl border app-border p-3"><div className="text-xs font-bold mb-2 flex items-center gap-1"><Bell size={14}/>هشدارها</div><div className="flex flex-wrap gap-2">{[[0,'سر وقت'],[10,'۱۰ دقیقه قبل'],[60,'۱ ساعت قبل'],[1440,'۱ روز قبل']].map(([v,l])=>{const n=Number(v);const on=offsets.includes(n);return <button key={n} onClick={()=>setOffsets(x=>on?x.filter(i=>i!==n):[...x,n].sort((a,b)=>a-b))} className={'min-h-9 px-3 rounded-full text-xs '+(on?'bg-[var(--primary)] text-white':'border app-border')}>{l}</button>})}</div></div>
   <div className="grid grid-cols-2 gap-2">
    <button type="button" aria-pressed={recurrenceMode==='daily'} onClick={()=>setRecurrence(recurrenceRuleFor('daily')??'')} className={'min-h-11 rounded-xl border app-border flex items-center justify-center gap-1 '+(recurrenceMode==='daily'?'bg-[var(--primary)] text-white border-transparent':'')}><Repeat2 size={15}/>هر روز</button>
    <button type="button" aria-pressed={recurrenceMode==='weekly'} onClick={()=>setRecurrence(recurrenceRuleFor('weekly')??'')} className={'min-h-11 rounded-xl border app-border flex items-center justify-center gap-1 '+(recurrenceMode==='weekly'?'bg-[var(--primary)] text-white border-transparent':'')}><Repeat2 size={15}/>هر هفته</button>
    <button type="button" aria-pressed={recurrenceMode==='monthly'} onClick={()=>setRecurrence(recurrenceRuleFor('monthly')??'')} className={'min-h-11 rounded-xl border app-border '+(recurrenceMode==='monthly'?'bg-[var(--primary)] text-white border-transparent':'')}>هر ماه</button>
    <button type="button" aria-pressed={recurrenceMode==='yearly'} onClick={()=>setRecurrence(recurrenceRuleFor('yearly')??'')} className={'min-h-11 rounded-xl border app-border '+(recurrenceMode==='yearly'?'bg-[var(--primary)] text-white border-transparent':'')}>هر سال</button>
    <button type="button" aria-pressed={recurrenceMode==='none'} onClick={()=>setRecurrence(recurrenceRuleFor('none')??'')} className={'col-span-2 min-h-10 rounded-xl border app-border text-sm '+(recurrenceMode==='none'?'bg-[var(--surface-2)] font-bold':'')}>بدون تکرار</button>
   </div>
   <div className="text-xs app-muted mt-2" aria-live="polite">{recurrenceModeLabel[recurrenceMode]}</div>
   <div className="rounded-xl border app-border p-3">
    <div className="text-xs font-bold mb-2">پیوند به محموله، پرونده یا سند</div>
    <input value={entitySearch} onChange={e=>void searchEntities(e.target.value)} placeholder="شماره بارنامه، پرونده، سند، فاکتور یا صاحب کالا" className="w-full min-h-11 rounded-xl border app-border bg-[var(--surface-2)] px-3"/>
    {entity&&<div className="text-[11px] mt-2 text-[var(--primary)]">{entityTypeLabel[entity.type]} انتخاب‌شده: <span data-user-content="true" dir="auto">{entity.label}</span><button onClick={()=>{setEntity(null);setEntityCleared(true)}} className="mr-2 underline">حذف پیوند</button></div>}
    {entityError&&<div role="status" className="text-[11px] mt-2 text-amber-700">{entityError}</div>}
    {entityResults.length>0&&<div className="mt-2 space-y-1">{entityResults.map(x=><button key={x.type+x.id} onClick={()=>{setEntity(x);setEntityCleared(false);setEntitySearch('');setEntityResults([]);setEntityError('')}} className="w-full min-h-10 rounded-lg border app-border px-3 text-right text-xs"><span className="font-bold">{entityTypeLabel[x.type]}</span><span className="mx-2 app-muted">·</span><span data-user-content="true" dir="auto">{x.label}</span></button>)}</div>}
   </div><input value={tagText} onChange={e=>setTagText(e.target.value)} placeholder="برچسب‌ها با فاصله یا ویرگول جدا شوند" aria-label="برچسب‌های یادآور" className="w-full min-h-11 rounded-xl border app-border bg-[var(--surface-2)] px-3"/>
   <div className="rounded-xl border app-border p-3">
    <div className="text-xs font-bold flex items-center gap-1"><ListChecks size={14}/>چک‌لیست<span className="mr-auto text-[11px] app-muted">{items.filter(item=>item.is_done).length} از {items.length}</span></div>
    {items.map(item=><div key={item.id} className="flex items-center gap-2 mt-2">
     <button type="button" disabled={checklistBusy} aria-label={item.is_done?'علامت‌گذاری به‌عنوان انجام‌نشده':'علامت‌گذاری به‌عنوان انجام‌شده'} aria-pressed={item.is_done} onClick={()=>void toggleCheck(item)} className={'min-w-9 min-h-9 rounded-lg border app-border disabled:opacity-50 '+(item.is_done?'bg-emerald-600 text-white':'')}>{item.is_done?<Check size={15}/>:''}</button>
     <span data-user-content="true" dir="auto" className={'text-xs flex-1 '+(item.is_done?'line-through opacity-50':'')}>{item.title}</span>
     <button type="button" disabled={checklistBusy} aria-label="حذف مورد چک‌لیست" onClick={()=>void removeCheck(item.id)} className="min-w-9 min-h-9 disabled:opacity-50"><Trash2 size={14}/></button>
    </div>)}
    <div className="flex gap-2 mt-3"><input value={check} disabled={checklistBusy} onChange={e=>setCheck(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void addCheck()}}} aria-label="مورد جدید چک‌لیست" placeholder="مورد جدید" className="flex-1 min-h-10 rounded-lg border app-border bg-[var(--surface-2)] px-3 disabled:opacity-50"/><button type="button" disabled={checklistBusy||!check.trim()} onClick={()=>void addCheck()} aria-label="افزودن مورد چک‌لیست" className="min-w-10 min-h-10 rounded-lg bg-[var(--primary)] text-white disabled:opacity-50">{checklistBusy?<RefreshCw size={15} className="animate-spin"/>:<Plus size={15}/>}</button></div>
    {checklistError&&<div role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs">{checklistError}</div>}
   </div>
   {formError&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{formError}</div>}<div className="grid grid-cols-2 gap-2"><button type="button" onClick={save} disabled={saving} className="min-h-12 rounded-xl bg-[var(--primary)] text-white font-black disabled:opacity-60">{saving?'در حال ذخیره…':'ذخیره تغییرات'}</button><button type="button" onClick={onClose} disabled={saving} className="min-h-12 rounded-xl border app-border disabled:opacity-50">انصراف</button></div>
  </div>
 </div></div></ReminderLocaleTree>;
};

const PushSettings:React.FC<{allowed:boolean;devices:Array<{id:string;platform:string|null;user_agent:string|null;last_seen_at:string;is_active:boolean;failure_count:number}>;busy:boolean;language:ReminderLanguage;onClose:()=>void;setBusy:(v:boolean)=>void;reloadDevices:()=>Promise<void>}>=({allowed,devices,busy,language,onClose,setBusy,reloadDevices})=>{
 const t=(value:string)=>reminderText(value,language);
 const [permission,setPermission]=useState<NotificationPermission>(typeof Notification==='undefined'?'default':Notification.permission);
 const [hide,setHide]=useState(false),[quietStart,setQuietStart]=useState('22:00'),[quietEnd,setQuietEnd]=useState('07:00'),[savedQuietStart,setSavedQuietStart]=useState('22:00'),[savedQuietEnd,setSavedQuietEnd]=useState('07:00');
 useEffect(()=>{let active=true;void(async()=>{const current=(await supabase.auth.getUser()).data.user;if(!current)return;const {data,error}=await supabase.from('notification_preferences').select('hide_content,quiet_start,quiet_end').eq('user_id',current.id).maybeSingle();if(!active||error)return;setHide(Boolean(data?.hide_content));const start=typeof data?.quiet_start==='string'?data.quiet_start.slice(0,5):'22:00';const end=typeof data?.quiet_end==='string'?data.quiet_end.slice(0,5):'07:00';setQuietStart(start);setSavedQuietStart(start);setQuietEnd(end);setSavedQuietEnd(end);})();return()=>{active=false;}},[]);
 const saveQuiet=async(field:'quiet_start'|'quiet_end',value:string)=>{try{await setNotificationPreferences({timezone:'Asia/Tehran',[field]:value+':00'});if(field==='quiet_start')setSavedQuietStart(value);else setSavedQuietEnd(value);}catch{if(field==='quiet_start')setQuietStart(savedQuietStart);else setQuietEnd(savedQuietEnd);alert('ذخیره ساعات سکوت انجام نشد؛ اتصال و دسترسی حساب را بررسی کنید.')}};
 const toggle=async()=>{setBusy(true);try{if(permission==='granted'){await disablePush();setPermission('default');}else{const r=await enablePush();setPermission(r.status==='granted'?'granted':r.status as NotificationPermission);}}catch(e){alert(errorFa(e));}finally{setBusy(false);void reloadDevices();}};
 const test=async()=>{setBusy(true);try{await testPush();}catch(e){alert(errorFa(e));}finally{setBusy(false);}};
 const saveHide=async(v:boolean)=>{const previous=hide;setHide(v);try{await setNotificationPreferences({hide_content:v})}catch{setHide(previous);alert('ذخیره تنظیم اعلان انجام نشد.')}};
 return <ReminderLocaleTree language={language}><div className="fixed inset-0 z-[180] bg-black/55 flex items-end md:items-center justify-center" dir={language==='fa'?'rtl':'ltr'}><div className="w-full md:max-w-lg max-h-[90vh] overflow-auto rounded-t-[28px] md:rounded-[28px] border app-border bg-[var(--surface)] p-4 pb-[calc(18px+env(safe-area-inset-bottom))]"><div className="flex items-center justify-between"><div><b className="text-lg">اعلان‌ها</b><div className="text-xs app-muted mt-1">اعلان واقعی دستگاه‌های شما</div></div><button onClick={onClose} className="min-w-11 min-h-11 border app-border rounded-xl"><X size={17}/></button></div>
  {!allowed?<div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-sm">برای حساب صاحب کالا اعلان داخلی فعال نمی‌شود.</div>:<><div className="mt-4 rounded-2xl border app-border p-3"><div className="flex items-center gap-3"><div className="flex-1"><div className="font-bold text-sm">وضعیت اعلان</div><div className="text-xs app-muted mt-1">{permission==='granted'?'فعال':'فعال نیست'}</div></div><button disabled={busy} onClick={()=>void toggle()} className={'min-h-11 px-4 rounded-xl font-bold '+(permission==='granted'?'border app-border':'bg-[var(--primary)] text-white')}>{permission==='granted'?'غیرفعال‌سازی':'فعال‌سازی'}</button></div><button disabled={busy||permission!=='granted'} onClick={()=>void test()} className="w-full min-h-11 rounded-xl border app-border mt-2 disabled:opacity-40">ارسال اعلان آزمایشی</button></div>
   <label className="flex items-center gap-3 mt-3 p-3 rounded-2xl border app-border"><input type="checkbox" checked={hide} onChange={e=>void saveHide(e.target.checked)} className="w-5 h-5"/><span><b className="block text-sm">پنهان کردن متن اعلان</b><span className="text-xs app-muted">به‌جای عنوان، متن عمومی نمایش داده می‌شود.</span></span></label><div className="mt-3 rounded-2xl border app-border p-3"><b className="text-sm">ساعات سکوت · به وقت تهران</b><p className="text-xs app-muted mt-1">به‌جز اعلان‌های فوری، در این بازه اعلان ارسال نمی‌شود.</p><div className="grid grid-cols-2 gap-3 mt-3"><label className="text-xs app-muted">شروع<input type="time" value={quietStart} onChange={e=>setQuietStart(e.target.value)} onBlur={()=>{if(quietStart&&quietStart!==savedQuietStart)void saveQuiet('quiet_start',quietStart)}} className="block w-full min-h-11 mt-1 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm"/></label><label className="text-xs app-muted">پایان<input type="time" value={quietEnd} onChange={e=>setQuietEnd(e.target.value)} onBlur={()=>{if(quietEnd&&quietEnd!==savedQuietEnd)void saveQuiet('quiet_end',quietEnd)}} className="block w-full min-h-11 mt-1 rounded-xl border app-border bg-[var(--surface-2)] px-3 text-sm"/></label></div></div>
   <div className="mt-4"><div className="font-bold text-sm mb-2 flex items-center gap-1"><Users size={15}/>دستگاه‌ها</div>{devices.length?devices.map(d=><div key={d.id} className="rounded-xl border app-border p-3 mb-2"><div className="text-sm font-bold">{d.platform==='ios'?'آیفون':d.platform==='android'?'اندروید':'رایانه'}</div><div className="text-[11px] app-muted mt-1">{new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(new Date(d.last_seen_at))}</div></div>):<div className="text-xs app-muted border app-border rounded-xl p-4">هنوز دستگاهی ثبت نشده است.</div>}</div></>}
 </div></div></ReminderLocaleTree>;
};
