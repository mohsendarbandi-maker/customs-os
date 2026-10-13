import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/features/reminders/RemindersPage.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/responsive.css'), 'utf8');

describe('smart reminder composer dismissal', () => {
  it('removes the closed full-screen overlay from the desktop hit-testing layer', () => {
    expect(css).toMatch(
      /\.reminders-app-standalone\s+\.reminders-composebar:not\(\.is-open\)\s*\{[^}]*display:\s*none\s*!important;[^}]*pointer-events:\s*none\s*!important;/s,
    );
    expect(css).toContain('.reminders-app-standalone .reminders-composebar.is-open{position:fixed!important;');
  });

  it('keeps the close button, Escape key, and backdrop wired to the same closed state', () => {
    expect(page).toContain('onClick={()=>setComposerOpen(false)} className="reminder-header-icon"');
    expect(page).toContain("if(e.key==='Escape')setComposerOpen(false)");
    expect(page).toContain('if(composerOpen){setComposerOpen(false);return;}');
    expect(page).toContain('onClick={e=>{if(e.target===e.currentTarget)setComposerOpen(false)}}');
    expect(page).toContain('onClick={e=>e.stopPropagation()}');
  });
});
