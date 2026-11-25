import { isCloudflareStagingHost } from './recoveryHost';
import { buildCustomsWorkflowJsonbPatch } from './customsWorkflowPatch';

export interface D1ProcedureWorkflow {
  id: string;
  organization_id: string;
  declaration_id: string;
  current_stage: string;
  procedure_state: Record<string, unknown>;
  updated_at: string;
}
export interface D1ProcedureSaveInput {
  declarationId: string;
  workflowExists: boolean;
  currentStage: string;
  savedStage: string;
  procedureState: Record<string, unknown>;
  baseState: Record<string, unknown>;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const request = async (
  declarationId: string,
  action = '',
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<Record<string, any>> => {
  const response = await fetch(
    '/api/customs-declaration-workflows/' + encodeURIComponent(declarationId) + (action ? '/' + action : ''),
    {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(result?.error || 'CUSTOMS_WORKFLOW_REQUEST_FAILED')) as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = String(result?.error || '');
    error.details = result;
    throw error;
  }
  return result as Record<string, any>;
};

export const isD1CustomsWorkflowEnabled = () => isCloudflareStagingHost();

export const readD1CustomsProcedureWorkflow = async (declarationId: string) => {
  const result = await request(declarationId);
  return {
    declaration: result.declaration as Record<string, unknown>,
    workflow: (result.workflow || null) as D1ProcedureWorkflow | null,
  };
};

export const saveD1CustomsProcedureWorkflow = async (
  input: D1ProcedureSaveInput,
): Promise<D1ProcedureWorkflow> => {
  if (!input.workflowExists) {
    const result = await request(input.declarationId, '', 'POST', {
      currentStage: input.currentStage,
      procedureState: input.procedureState,
    });
    return result.workflow as D1ProcedureWorkflow;
  }
  const patch = buildCustomsWorkflowJsonbPatch(
    input.baseState,
    input.procedureState,
  );
  const result = await request(input.declarationId, 'procedure', 'PATCH', {
    patch,
    baseState: input.baseState,
    expectedCurrentStage: input.savedStage,
    nextStage: input.currentStage,
  });
  return result.workflow as D1ProcedureWorkflow;
};

export const cloneD1CustomsProcedureState = clone;

export const readD1CustomsWorkflowEvents = async (declarationId: string) => {
  const result = await request(declarationId, 'events');
  return Array.isArray(result.events) ? result.events : [];
};
