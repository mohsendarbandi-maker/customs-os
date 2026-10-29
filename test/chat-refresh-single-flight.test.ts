import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(path.resolve(__dirname, '../src/features/chat/ChatPage.tsx'), 'utf8');

describe('chat list refresh performance', () => {
  it('coalesces overlapping refresh requests within the same user and organization', () => {
    expect(page).toContain('const conversationRefreshInFlight = useRef<{scope:string|null;promise:Promise<void>}|null>(null)');
    expect(page).toContain('if(inFlight&&inFlight.scope===scope)return inFlight.promise');
    expect(page).toContain('conversationRefreshInFlight.current={scope,promise:task}');
  });

  it('loads people and organization connections when the workspace changes, not on every conversation switch', () => {
    const start = page.indexOf('useEffect(()=>{\n  const organizationId=profile?.organization_id;');
    const end = page.indexOf('useEffect(()=>{\n  const on=()=>{setOnline(true)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const workspaceEffect = page.slice(start, end);
    expect(workspaceEffect).toContain('listOrgConnections()');
    expect(workspaceEffect).not.toContain('selectedId');

    const onlineEffectEnd = page.indexOf('useEffect(()=>{\n  if(!selectedId||!user?.id)return;', end);
    const onlineEffect = page.slice(end, onlineEffectEnd);
    expect(onlineEffect).toContain('selectedIdRef.current');
    expect(onlineEffect).not.toContain('void refresh()');
  });
});
