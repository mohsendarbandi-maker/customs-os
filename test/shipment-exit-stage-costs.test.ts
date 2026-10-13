import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../src/pages/ExitPage.tsx'), 'utf8');

describe('shipment costs at exit stages — phase 9', () => {
  it('keeps preparation costs linked to stage five', () => {
    expect(source).toContain('stage="STAGE_5_EXIT_PREPARATION"');
  });

  it('provides direct cost entry at the final exit stage', () => {
    expect(source).toContain('stage="STAGE_6_EXIT"');
    expect(source).toContain('shipmentId={shipmentId}');
  });
});
