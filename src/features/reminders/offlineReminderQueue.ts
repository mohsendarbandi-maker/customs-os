import type {QueuedRpc,QueuedRpcState} from '../../lib/offlineQueue';
import type {Reminder,ReminderKind,ReminderPriority} from './reminderCore';

export interface QueuedReminderDraft{
  queueId:string;
  queueState:QueuedRpcState;
  reminder:Reminder;
}

type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:null;
const text=(value:unknown,fallback='')=>typeof value==='string'?value:fallback;
const nullableText=(value:unknown)=>typeof value==='string'&&value.length?value:null;
const kinds=new Set<ReminderKind>(['document','shipment','finance','other']);
const priorities=new Set<ReminderPriority>(['low','normal','high','urgent']);

export function queuedReminderDrafts(items:QueuedRpc[],userId:string|null,organizationId:string|null):QueuedReminderDraft[]{
 if(!userId)return[];
 const result:QueuedReminderDraft[]=[];
 for(const item of items){
  if(item.userId!==userId||item.functionName!=='create_operational_reminder')continue;
  const args=object(item.args),payload=object(args?.p_payload);
  if(!payload)continue;
  const clientUuid=nullableText(payload.client_uuid);
  const title=text(payload.title).trim();
  if(!clientUuid||!title)continue;
  const dueAt=nullableText(payload.due_at);
  if(dueAt&&!Number.isFinite(new Date(dueAt).getTime()))continue;
  const rawKind=text(payload.kind,'other') as ReminderKind;
  const rawPriority=text(payload.priority,'normal') as ReminderPriority;
  const rawOffsets=Array.isArray(payload.alarm_offsets_min)?payload.alarm_offsets_min:[0];
  const offsets=rawOffsets.filter((x):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<=525600);
  const allDay=payload.all_day===true;
  const reminder:Reminder={
   id:'local-'+clientUuid,
   organization_id:organizationId,
   case_id:nullableText(payload.case_id),
   shipment_id:nullableText(payload.shipment_id),
   title,
   description:nullableText(payload.description),
   due_at:dueAt,
   priority:priorities.has(rawPriority)?rawPriority:'normal',
   status:'open',
   created_by:userId,
   completed_at:null,
   created_at:item.createdAt,
   updated_at:item.createdAt,
   due_precision:text(payload.due_precision,'day'),
   source_key:null,
   is_system:false,
   kind:kinds.has(rawKind)?rawKind:'other',
   entity_type:nullableText(payload.entity_type) as Reminder['entity_type'],
   entity_id:nullableText(payload.entity_id),
   assignee_id:nullableText(payload.assignee_id)??userId,
   visibility:payload.visibility==='team'?'team':'private',
   all_day:allDay,
   timezone:text(payload.timezone,'Asia/Tehran'),
   alarm_offsets_min:offsets.length?offsets:[0],
   recurrence_rule:nullableText(payload.recurrence_rule),
   recurrence_until:nullableText(payload.recurrence_until),
   series_id:nullableText(payload.series_id),
   occurrence_key:nullableText(payload.occurrence_key),
   snoozed_until:null,
   snooze_count:0,
   tags:Array.isArray(payload.tags)?payload.tags.filter((x):x is string=>typeof x==='string'):[],
   notes:nullableText(payload.notes),
   client_uuid:clientUuid,
   deleted_at:null,
   completed_by:null
  };
  result.push({queueId:item.id,queueState:item.state??'queued',reminder});
 }
 return result.sort((a,b)=>a.reminder.created_at.localeCompare(b.reminder.created_at));
}

/** A queued create cannot resolve related records after reconnect, so do not silently lose those links. */
export function offlineReminderQueueBlocker(queued:boolean,linkQuery:string|null,assigneeName:string|null):string|null{
 if(!queued)return null;
 if(linkQuery?.trim()||assigneeName?.trim()){
  return 'این یادآور به محموله یا مسئول وابسته است؛ برای حفظ پیوندها، اتصال را برقرار کنید و دوباره ثبت کنید.';
 }
 return null;
}
