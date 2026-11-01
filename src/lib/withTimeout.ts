export function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  operationLabel: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out while ${operationLabel}`));
    }, Math.max(1, timeoutMs));
  });

  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}
