import { describe, expect, it } from 'vitest';
import { signAiOperatorTransitionProof } from '../supabase/functions/_shared/aiOperatorTransitionProof';

const encoder = new TextEncoder();
const secret = 'unit-test-only-ai-operator-transition-secret-2026';

describe('AI Operator signed transition proof', () => {
  it('uses HMAC-SHA256 and signs the exact serialized proof payload', async () => {
    const payload = JSON.stringify({
      version: 1,
      purpose: 'completion',
      command_id: '00000000-0000-0000-0000-000000000201',
      user_id: '00000000-0000-0000-0000-000000000101',
      status: 'executed',
      issued_at: '2026-11-17T20:00:00.000Z',
      nonce: 'test-nonce',
      result: { ok: true },
    });

    const signature = await signAiOperatorTransitionProof(secret, payload);
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/.{2}/g)!.map(x => parseInt(x,16))), encoder.encode(payload))).toBe(true);
    expect(await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/.{2}/g)!.map(x => parseInt(x,16))), encoder.encode(payload.replace('"ok":true','"ok":false')))).toBe(false);
  });

  it('rejects short secrets rather than creating weak signatures', async () => {
    await expect(signAiOperatorTransitionProof('too-short', '{}')).rejects.toThrow('at least 32 characters');
  });
});
