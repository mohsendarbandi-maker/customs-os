import { describe, expect, it } from 'vitest';
import stagingWorker from './migration-staging';

const health = async (password?: string) => {
  const response = await stagingWorker.fetch(
    new Request('https://customs-os-migration-staging.mohsen-darbandi.workers.dev/health'),
    {
      MIGRATION_ENVIRONMENT: 'staging',
      PRODUCTION_DATA_IMPORTED: 'false',
      CUSTOMS_ADMIN_PASSWORD: password,
    } as never,
  );
  return { response, body: await response.json() as Record<string, unknown> };
};

describe('staging health auth configuration', () => {
  it('reports only whether the admin secret exists', async () => {
    const { response, body } = await health('test-only-secret');
    expect(response.status).toBe(200);
    expect(body.authenticationConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('test-only-secret');
  });

  it('reports an absent admin secret without changing health status', async () => {
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect(body.authenticationConfigured).toBe(false);
  });
});
