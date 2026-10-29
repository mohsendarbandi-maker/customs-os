import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const lifecycle = fs.readFileSync(path.resolve(__dirname, '../src/features/reminders/PwaLifecycle.tsx'), 'utf8');
describe('safe PWA version updates', () => {
  it('auto-activates new static assets on an idle visible app open', () => {
    expect(lifecycle).toContain('onNeedRefresh: () => {');
    expect(lifecycle).toContain('document.visibilityState !== \'visible\'');
    expect(lifecycle).toContain('!navigator.onLine');
    expect(lifecycle).toContain('void activate(true).catch');
  });
  it('keeps the manual update path when a form or chat contains a draft', () => {
    expect(lifecycle).toContain('hasUnsavedWork()');
    expect(lifecycle).toContain('.chat-composer textarea');
    expect(lifecycle).toContain('#reminder-quick-input');
    expect(lifecycle).toContain('await activate(true)');
  });
});
