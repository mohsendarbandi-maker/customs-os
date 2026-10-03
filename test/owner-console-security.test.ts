import{describe,expect,it}from'vitest';
import{readFileSync}from'node:fs';

const root=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=root('src/App.tsx');
const page=root('src/pages/AdvancedSettingsPage.tsx');
const api=root('supabase/functions/owner-console/index.ts');
const migration=root('supabase/migrations/20260929190356_owner_console_full_rbac_patch2.sql');
const globalMigration=root('supabase/migrations/20260929191516_owner_console_global_reference_rbac.sql');

describe('Owner Console security',()=>{
 it('has an explicit owner-only route and page guard',()=>{
  expect(app).toContain('<Route path="/settings/advanced" element={<ProtectedRoute allowedRoles={["owner"]}><AdvancedSettingsPage/></ProtectedRoute>}/>');
  expect(page).toContain("profile?.role==='owner'");
 });
 it('rejects direct non-owner API access and keeps admin Auth actions server-side',()=>{
  expect(api).toContain("profile.role!=='owner'");
  expect(api).toContain("sb.auth.getUser(jwt)");
  expect(api).toContain("SUPABASE_ANON_KEY");
  expect(api).toContain("auth.admin.createUser");
  expect(api).toContain("SUPABASE_SERVICE_ROLE_KEY");
  expect(root('src/lib/ownerConsole.ts')).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role|auth\.admin\./i);
 });
 it('covers all requested Owner Console sections',()=>{
  for(const section of ['users','cases','registration','maritime','documents','doc_rules','permit_rules','finance','declarations','exit','ai','print','offline','org'])expect(page).toContain("id:'"+section+"'");
 });
 it('covers the core mutable data registry',()=>{
  for(const resource of ['clients','cases','registration_orders','shipments','containers','shipment_customs_data','shipping_lines','vessels','contacts','shipment_documents','customs_documents','shipment_document_extractions','document_extraction_fields','document_requirement_rules','permit_rules','permits','customs_declarations','finance_cost_categories','finance_org_settings','finance_cost_items','finance_payments','finance_payment_requests','finance_invoices','customs_accounting_vouchers','case_exit_operations','organization_settings','ai_gateway_settings','print_templates','knowledge_sources','knowledge_chunks'])expect(api).toContain(resource);
 });
 it('keeps history immutable and documents archived instead of physically removed',()=>{
  expect(migration).toContain("owner_archive_document");
  expect(migration).toContain("is_archived boolean not null default false");
  expect(api).toContain("document_archive");
  expect(api).toContain("Final confirmation phrase is required.");
  expect(migration).toContain("case_status_history");
  expect(migration).toContain("ai_operator_commands");
 });
 it('enforces high-risk confirmations server-side',()=>{
  for(const phrase of ['تأیید نهایی تغییر کاربر','تأیید نهایی غیرفعال‌سازی کاربر','تأیید نهایی اصلاح وضعیت','تأیید نهایی حذف پرونده','تأیید نهایی ابطال ردیف سند'])expect(api).toContain(phrase);
  expect(api).toContain('غیرفعال‌سازی کاربر');
  expect(api).toContain('Final confirmation phrase is required.');
 });
 it('does not expose CRUD writes for immutable logs in the UI',()=>{
  expect(page).not.toMatch(/from\(['"]audit_logs['"]\)\.(update|delete)/);
  expect(page).toContain('فقط خواندنی');
  expect(api).toContain('const READ_ONLY');
  expect(migration).toContain("grant execute on function public.owner_console_guard()");
 });
 it('protects global reference tables with owner-only RLS and audit',()=>{
  expect(globalMigration).toContain("user_role()='owner'::public.user_role");
  expect(globalMigration).toContain('record_global_reference_audit');
 });
});