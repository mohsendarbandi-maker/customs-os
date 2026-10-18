import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const draftStore = read('src/lib/draftStorage.ts');
const formHook = read('src/hooks/useAutosavedDraft.ts');
const chat = read('src/features/chat/ChatPage.tsx');
const reminders = read('src/features/reminders/RemindersPage.tsx');
const queue = read('src/lib/offlineQueue.ts');

describe('durable unfinished-work protection', () => {
  it('mirrors form drafts to IndexedDB and falls back when localStorage is unavailable', () => {
    expect(draftStore).toContain("DATABASE_NAME = 'customs-os-form-drafts-v1'");
    expect(draftStore).toContain('indexedDB.open(DATABASE_NAME, DATABASE_VERSION)');
    expect(draftStore).toContain('writeDraftValue');
    expect(draftStore).toContain('readDraftValue');
    expect(draftStore).toContain('removeDraftValue');
    expect(formHook).toContain('readDraftValue(key)');
    expect(formHook).toContain('writeDraftValue(key, valueRef.current)');
    expect(formHook).toContain('removeDraftValue(key)');
    expect(formHook).toContain('restorePendingRef.current');
  });

  it('restores a reminder composer including date and shipment context from durable storage', () => {
    expect(reminders).toContain("import {readDraftValue,removeDraftValue,writeDraftValue} from '../../lib/draftStorage'");
    expect(reminders).toContain('customs-os-reminder-composer-v2:');
    expect(reminders).toContain('readDraftValue(composerDraftKey)');
    expect(reminders).toContain('await writeDraftValue(composerDraftKey,saved)');
    expect(reminders).toContain('shipment:quickShipment');
    expect(reminders).toContain("sessionStorage.getItem('customs-os-reminder-composer-v1:");
  });

  it('scopes chat drafts to user, organization and selected conversation', () => {
    expect(chat).toContain("import{readDraftValue,removeDraftValue,writeDraftValue}from'../../lib/draftStorage'");
    expect(chat).toContain("'customs-os:chat-composer:v1:'+encodeURIComponent(user.id)+':'+encodeURIComponent(profile.organization_id)+':'+encodeURIComponent(selectedId)");
    expect(chat).toContain('readDraftValue(key)');
    expect(chat).toContain('writeDraftValue(draftKey,{text,updatedAt:Date.now()})');
    expect(chat).toContain('removeDraftValue(draftKey)');
  });

  it('retains the pre-existing offline queue as the authoritative outbox for unsent messages and reminders', () => {
    expect(queue).toContain('subscribeOfflineQueue');
    expect(queue).toContain('rpcWithOfflineQueue');
    expect(chat).toContain('sendMessage(selectedId,clientUuid,body');
    expect(reminders).toContain('rpcWithOfflineQueue');
  });
});
