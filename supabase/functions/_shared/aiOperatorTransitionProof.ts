export async function signAiOperatorTransitionProof(secret: string, payload: string): Promise<string> {
  if (secret.length < 32) {
    throw new Error('AI Operator transition signing secret must contain at least 32 characters.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
