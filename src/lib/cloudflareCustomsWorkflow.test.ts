import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readD1CustomsWorkflowEvents,
  saveD1CustomsProcedureWorkflow,
} from './cloudflareCustomsWorkflow';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare D1 customs procedure workflow client', () => {
  it('creates a first procedure workflow with the current state and stage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      workflow: { id: 'workflow-1', current_stage: 'documents', procedure_state: {} },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const workflow = await saveD1CustomsProcedureWorkflow({
      declarationId: 'decl-1',
      workflowExists: false,
      currentStage: 'documents',
      savedStage: 'documents',
      procedureState: { documents: { invoiceNo: 'INV-1' } },
      baseState: {},
    });

    expect(workflow.id).toBe('workflow-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/customs-declaration-workflows/decl-1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      currentStage: 'documents',
      procedureState: { documents: { invoiceNo: 'INV-1' } },
    });
  });

  it('sends only changed nested procedure leaves for an existing workflow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      workflow: { id: 'workflow-1', current_stage: 'permits', procedure_state: {} },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await saveD1CustomsProcedureWorkflow({
      declarationId: 'decl-1',
      workflowExists: true,
      currentStage: 'permits',
      savedStage: 'documents',
      baseState: {
        documents: { invoiceNo: 'INV-1', goodsDescription: 'کالا' },
        permits: { status: 'pending' },
      },
      procedureState: {
        documents: { invoiceNo: 'INV-2', goodsDescription: 'کالا' },
        permits: { status: 'approved' },
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/customs-declaration-workflows/decl-1/procedure');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      patch: { documents: { invoiceNo: 'INV-2' }, permits: { status: 'approved' } },
      baseState: {
        documents: { invoiceNo: 'INV-1', goodsDescription: 'کالا' },
        permits: { status: 'pending' },
      },
      expectedCurrentStage: 'documents',
      nextStage: 'permits',
    });
  });

  it('reads D1 workflow events through the protected API path', async () => {
    const events = [{ id: 'event-1', event_type: 'created' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, events }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(readD1CustomsWorkflowEvents('decl-1')).resolves.toEqual(events);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/customs-declaration-workflows/decl-1/events');
  });
});
