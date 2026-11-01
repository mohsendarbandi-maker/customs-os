import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns a resolved operation without waiting for the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 1000, 'workspace profile'))
      .resolves.toBe('ready');
  });

  it('rejects a stalled operation with a diagnosable timeout message', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => undefined), 1500, 'workspace profile');
    const assertion = expect(pending).rejects.toThrow('Request timed out while workspace profile');

    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it('clears the timer when the operation wins the race', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(Promise.resolve('ready'), 1500, 'profile');
    await expect(pending).resolves.toBe('ready');
    await vi.advanceTimersByTimeAsync(2000);
  });
});
