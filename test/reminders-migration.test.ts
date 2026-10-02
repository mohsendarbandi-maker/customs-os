import{describe,expect,it}from'vitest';import fs from'node:fs';import path from'node:path';
const root=path.resolve(__dirname,'..');const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261002010000_reminders_full_model.sql'),'utf8');
describe('reminders migration invariants',()=>{
 it('has all required tables and reminder columns',()=>{for(const x of ['reminder_checklist_items','notification_preferences','push_subscriptions','reminder_deliveries','kind','entity_type','entity_id','assignee_id','visibility','all_day','timezone','alarm_offsets_min','recurrence_rule','recurrence_until','series_id','occurrence_key','snoozed_until','snooze_count','tags','notes','client_uuid','deleted_at','completed_by'])expect(migration).toContain(x);});
 it('has RLS ownership restrictions',()=>{expect(migration).toContain("created_by=auth.uid()");expect(migration).toContain("assignee_id=auth.uid()");expect(migration).toContain("public.user_role()<>'client'");});
 it('has idempotent offline insert',()=>{expect(migration).toContain('on conflict(created_by,client_uuid)');});
 it('has locked delivery claiming',()=>{expect(migration).toContain('for update');expect(migration).toContain('skip locked');});
 it('does not embed a VAPID private key',()=>{expect(migration).not.toMatch(/BEGIN PRIVATE KEY/);expect(migration).not.toMatch(/privateKey.{0,50}[A-Za-z0-9_-]{40,}/i);});
});
