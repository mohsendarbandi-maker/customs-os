import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-cloudflare-staging.yml'),
  'utf8',
);

describe('Cloudflare Staging deployment workflow safety', () => {
  it('deploys automatically only from main and never cancels a remote migration in progress', () => {
    expect(workflow).toContain('branches:\n      - main');
    expect(workflow).not.toContain('rebuild/cloudflare-free-first');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('pins the Worker and D1 to the isolated Staging environment', () => {
    expect(workflow).toContain("config.name === 'customs-os-migration-staging'");
    expect(workflow).toContain("database_name === 'customs-os-migration-staging'");
    expect(workflow).toContain('b938fa3c-4995-4d27-aeda-f72f2d484a3c');
    expect(workflow).toContain("config.vars?.PRODUCTION_DATA_IMPORTED === 'false'");
    expect(workflow).toContain('Production hostnames still target the Staging Worker');
  });

  it('applies the D1 versioned migrations before the only Worker deployment', () => {
    const migration = workflow.indexOf('wrangler@4 d1 migrations apply customs-os-migration-staging');
    const deployment = workflow.indexOf('wrangler@4 deploy --config wrangler.migration-staging.jsonc');
    expect(migration).toBeGreaterThan(-1);
    expect(deployment).toBeGreaterThan(migration);
    expect(workflow.match(/wrangler@4 deploy --config wrangler\.migration-staging\.jsonc/g) || []).toHaveLength(1);
  });

  it('requires workflow and permit tables in the verified deployed D1 schema', () => {
    for (const table of [
      'customs_declaration_workflow',
      'customs_declaration_workflow_events',
      'permits',
    ]) {
      expect(workflow).toContain(table);
    }
  });

  it('runs the login and permit smoke test only after the deploy job, without another deploy', () => {
    const postDeploy = workflow.slice(workflow.indexOf('  verify-staging-login-and-case-permits:'));
    expect(postDeploy).toContain('needs: build-and-deploy');
    expect(postDeploy).toContain('/api/cases/$case_id/permits');
    expect(postDeploy).toContain('/api/shipments?limit=200&offset=0');
    expect(postDeploy).not.toMatch(/wrangler@4 deploy/);
    expect(postDeploy).not.toMatch(/wrangler@4 d1 migrations apply/);
  });
});
