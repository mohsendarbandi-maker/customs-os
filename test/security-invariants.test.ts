// reminder-specific assertions are added to the existing canonical security test by phase build.
import{describe,expect,it}from'vitest';import fs from'node:fs';import path from'node:path';
const root=path.resolve(__dirname,'..');const q=fs.readFileSync(path.join(root,'src/lib/offlineQueue.ts'),'utf8');const m=fs.readFileSync(path.join(root,'supabase/migrations/20261002010000_reminders_full_model.sql'),'utf8');
describe('Reminder offline invariants',()=>{it('queues only the idempotent reminder creation RPC',()=>{expect(q).toContain('create_operational_reminder');expect(m).toContain('client_uuid');expect(m).toContain('on conflict(created_by,client_uuid)');});it('never stores a session token in queue source',()=>{expect(q).not.toMatch(/access_token|refresh_token|session_token/i);});});
