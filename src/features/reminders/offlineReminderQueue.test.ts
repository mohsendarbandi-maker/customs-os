import {describe,expect,it} from 'vitest';
import type {QueuedRpc} from '../../lib/offlineQueue';
import {offlineReminderQueueBlocker,queuedReminderDrafts} from './offlineReminderQueue';

const item=(overrides:Partial<QueuedRpc>={}):QueuedRpc=>({
 id:'queue-1',
 createdAt:'2026-10-12T12:00:00.000Z',
 userId:'user-1',
 functionName:'create_operational_reminder',
 args:{p_payload:{
  client_uuid:'local-uuid-1',
  title:'پیگیری محموله',
  due_at:'2026-10-15T05:30:00.000Z',
  priority:'high',
  kind:'shipment',
  recurrence_rule:'RRULE:FREQ=WEEKLY',
  all_day:false,
  timezone:'Asia/Tehran',
  alarm_offsets_min:[0,10],
  tags:['ترخیص','پیگیری'],
  notes:'با تأمین‌کننده تماس بگیر'
 }},
 attempts:0,
 state:'queued',
 nextAttemptAt:0,
 ...overrides
});

describe('offline reminder queue',()=>{
 it('restores a queued reminder draft with its date, recurrence, alerts and notes',()=>{
  const [draft]=queuedReminderDrafts([item()], 'user-1','org-1');
  expect(draft.reminder).toMatchObject({
   id:'local-local-uuid-1',
   organization_id:'org-1',
   title:'پیگیری محموله',
   due_at:'2026-10-15T05:30:00.000Z',
   priority:'high',
   kind:'shipment',
   recurrence_rule:'RRULE:FREQ=WEEKLY',
   alarm_offsets_min:[0,10],
   tags:['ترخیص','پیگیری'],
   notes:'با تأمین‌کننده تماس بگیر',
   status:'open',
   client_uuid:'local-uuid-1'
  });
  expect(draft.queueId).toBe('queue-1');
  expect(draft.queueState).toBe('queued');
 });
 it('does not expose another user’s queue or unrelated RPC jobs',()=>{
  const drafts=queuedReminderDrafts([
   item(),
   item({id:'other-user',userId:'user-2'}),
   item({id:'chat-message',functionName:'chat_insert_message'})
  ], 'user-1','org-1');
  expect(drafts).toHaveLength(1);
  expect(drafts[0].queueId).toBe('queue-1');
 });
 it('ignores malformed or date-invalid queued payloads',()=>{
  expect(queuedReminderDrafts([item({args:{}})],'user-1','org-1')).toEqual([]);
  expect(queuedReminderDrafts([item({args:{p_payload:{client_uuid:'id',title:'Task',due_at:'not-a-date'}}})],'user-1','org-1')).toEqual([]);
 });
 it('blocks queued reminders whose related shipment or assignee could be silently lost',()=>{
  expect(offlineReminderQueueBlocker(true,'BL-123',null)).toContain('حفظ پیوندها');
  expect(offlineReminderQueueBlocker(true,null,'مسئول')).toContain('حفظ پیوندها');
  expect(offlineReminderQueueBlocker(true,null,null)).toBeNull();
  expect(offlineReminderQueueBlocker(false,'BL-123','مسئول')).toBeNull();
 });
});
