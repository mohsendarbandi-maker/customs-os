import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260915210000_security_and_rbac_hardening.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/AppShell.tsx'), 'utf8');
const shipment = fs.readFileSync(path.join(root, 'src/pages/ShipmentFirstPage.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');

describe('Customs OS security hardening', () => {
  it('scopes shipment documents and extraction to client-owned shipments', () => {
    expect(migration).toContain("s.client_id = public.user_client_id()");
    expect(migration).toContain('shipment_documents_select');
    expect(migration).toContain('shipment_doc_extractions_select');
  });

  it('restricts shipping-line mutations to operational roles', () => {
    expect(migration).toContain("shipping_lines_insert");
    expect(migration).toContain("'owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role");
    expect(migration).toContain("shipping_lines_delete");
  });

  it('scopes document storage by shipment ownership for clients', () => {
    expect(migration).toContain('shipment_documents_storage_select');
    expect(migration).toContain("s.id::text = split_part(name, '/', 2)");
  });

  it('has role-aware route guards and matching navigation visibility', () => {
    expect(app).toContain('allowedRoles={financeRoles}');
    expect(app).toContain('allowedRoles={managementRoles}');
    expect(shell).toContain('visibleNav=nav.filter(x=>canSee(x,profile?.role))');
  });

  it('passes the created shipping-line id directly to vessel creation', () => {
    expect(shipment).toContain('lineIdOverride?:string');
    expect(shipment).toContain('const effectiveLineId=lineIdOverride||lineId');
    expect(shipment).toContain('createVessel(input.vesselName,input.imo,l.id)');
  });

  it('requires typecheck in CI', () => {
    expect(workflow).toContain('npm run typecheck');
  });
});
