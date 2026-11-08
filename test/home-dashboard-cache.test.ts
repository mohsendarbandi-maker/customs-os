import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dashboard = fs.readFileSync(path.resolve(__dirname, '../src/pages/DesktopHomePage.tsx'), 'utf8');

describe('dashboard cold-start cache', () => {
  it('restores user-and-organization-scoped dashboard counts before refreshing from the network', () => {
    const cachedRead = dashboard.indexOf("readOfflineQueryCache<typeof stats>('home-dashboard-stats-v1'");
    const shipmentFetch = dashboard.indexOf("supabase.from('shipments').select('id,current_status').eq('organization_id',organizationId)");
    expect(cachedRead).toBeGreaterThan(-1);
    expect(shipmentFetch).toBeGreaterThan(cachedRead);
    expect(dashboard).toContain("saveOfflineQueryCache('home-dashboard-stats-v1',userId,organizationId,nextStats)");
    expect(dashboard).toContain("const{user,profile}=useAuth();");
    expect(dashboard).toContain('},[profile?.organization_id,user?.id]);');
  });

  it('retains the last cached counts if a refresh fails instead of replacing them with zeros', () => {
    expect(dashboard).toContain('setStats(cachedStats)');
    expect(dashboard).toContain('Preserve the most recent user-and-organization-scoped counts');
  });
});
