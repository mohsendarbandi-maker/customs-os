import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261117011900_customs_workflow_atomic_activity_and_server_exit_gate.sql"),
  "utf8",
);
const workflowUi = fs.readFileSync(
  path.join(root, "src/components/CustomsDeclarationWorkflow.tsx"),
  "utf8",
);
const exitUi = fs.readFileSync(
  path.join(root, "src/pages/ExitPage.tsx"),
  "utf8",
);

const functionBody = (name: string) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function: ${name}`);
  const end = migration.indexOf("$function$;", start);
  if (end < 0) throw new Error(`Unterminated SQL function: ${name}`);
  return migration.slice(start, end + "$function$;".length);
};

describe("atomic customs workflow activities", () => {
  it("uses a single invoker RPC with a row lock and leaf-level stale-write detection", () => {
    const patch = functionBody("patch_customs_declaration_workflow_activity");
    expect(patch).toContain("SECURITY INVOKER");
    expect(patch).toContain("FOR UPDATE");
    expect(patch).toContain("customs_workflow_jsonb_conflicts");
    expect(patch).toContain("customs_workflow_jsonb_merge");
    expect(patch).toContain("ERRCODE = '40001'");
    expect(patch).not.toContain("SECURITY DEFINER");
  });

  it("limits patch keys to the relevant activity and nested standards fields", () => {
    const patch = functionBody("patch_customs_declaration_workflow_activity");
    expect(patch).toContain("'appointment_status','appointment_number','road_authority_status','plant_quarantine_status','standard'");
    expect(patch).toContain("'expert_review','inspection_status','inspection_company','inspection_fee'");
    expect(patch).toContain("Invalid expertise patch fields");
    expect(patch).toContain("Invalid standards patch fields");
  });

  it("does not advance the stage pointer over a newer parallel operator", () => {
    const patch = functionBody("patch_customs_declaration_workflow_activity");
    expect(patch).toContain("WHEN current_stage IS NOT DISTINCT FROM p_expected_current_stage THEN p_activity");
  });

  it("updates only the touched leaves in the undo/rollback path", () => {
    const undo = functionBody("customs_workflow_jsonb_undo");
    const rollback = functionBody("rollback_customs_declaration_workflow");
    expect(undo).toContain("v_current_value IS NOT DISTINCT FROM v_after_value");
    expect(undo).toContain("v_result - v_key");
    expect(rollback).toContain("SECURITY INVOKER");
    expect(rollback).toContain("customs_workflow_jsonb_undo");
    expect(rollback).toContain("v_event.changed_fields");
    const eventRead = rollback.slice(rollback.indexOf("FROM public.customs_declaration_workflow_events"));
    expect(eventRead).not.toContain("FOR UPDATE");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.customs_workflow_jsonb_undo(jsonb, jsonb, jsonb) TO authenticated");
  });

  it("enforces every readiness condition and all exit checklist rows on the server", () => {
    const completion = functionBody("complete_customs_declaration_exit");
    expect(completion).toContain("SECURITY INVOKER");
    expect(completion).toContain("FOR UPDATE");
    expect(completion).toContain("customs_workflow_readiness_issues");
    expect(completion).toContain("warehouse_invoice_initial");
    expect(completion).toContain("warehouse_invoice_supplement");
    expect(completion).toContain("transport_power_of_attorney");
    expect(completion).toContain("IF COALESCE(pg_catalog.array_length(v_issues, 1), 0) > 0 THEN");
    expect(completion).toContain("finance_status = 'ready'");
    expect(completion).toContain("v_declaration.customs_regime IS DISTINCT FROM 'import_definitive'");
    expect(completion).toContain("v_shipment.finance_status NOT IN ('not_ready', 'ready', 'closed')");
    expect(completion).toContain("IF v_shipment.finance_status = 'not_ready' THEN");
    expect(completion).toContain("IF v_declaration.workflow_stage IS DISTINCT FROM 6 THEN");
    expect(completion.indexOf("IF COALESCE(pg_catalog.array_length(v_issues, 1), 0) > 0 THEN"))
      .toBeLessThan(completion.indexOf("finance_status = 'ready'"));
  });

  it("uses the same Persian calendar leap-year rules in the server gate", () => {
    const leap = functionBody("customs_workflow_jalali_leap_code");
    const dateKey = functionBody("customs_workflow_jalali_date_key");
    expect(leap).toContain("ARRAY[-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635]");
    expect(dateKey).toContain("customs_workflow_jalali_leap_code(v_year) = 0");
    expect(dateKey).toContain("v_year > 1600");
  });

  it("uses the atomic patch RPC from the workflow editor", () => {
    expect(workflowUi).toContain("buildCustomsWorkflowJsonbPatch");
    expect(workflowUi).toContain("mergeCustomsWorkflowJsonbPatch");
    expect(workflowUi).toContain("rpc('patch_customs_declaration_workflow_activity'");
    expect(workflowUi).toContain("rpc('complete_customs_declaration_workflow'");
    expect(workflowUi).toContain("CUSTOMS_WORKFLOW_CONFLICT");
  });

  it("routes definitive-import exit completion through the server transaction", () => {
    expect(exitUi).toContain("declaration.customs_regime === 'import_definitive'");
    expect(exitUi).toContain("'complete_customs_declaration_exit'");
    expect(exitUi).toContain("if (!result?.ready)");
  });

  it("keeps each activity's original database compare snapshot until its own patch succeeds", () => {
    expect(workflowUi).toContain("db:{evaluation:cloneWorkflowState(r.evaluation_state||{})");
    expect(workflowUi).toContain("baseState=workflowBaseline.current.db.expertise");
    expect(workflowUi).toContain("mergeCustomsWorkflowJsonbPatch(workflowBaseline.current.db.expertise,patch)");
  });
});
