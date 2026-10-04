import { supabase } from './supabase';
import { invokeEdgeFunction } from './edgeFunction';

type OwnerConsoleArgs = {
  body: Record<string, unknown>;
};

const getErrorMessage = (error: unknown): string => {
  if (!error) {
    return 'خطای نامشخص در ارتباط با Owner Console';
  }

  if (typeof error === 'string') {
    return error;
  }

  const value = error as {
    message?: unknown;
  };

  if (
    typeof value.message === 'string' &&
    value.message.trim()
  ) {
    return value.message;
  }

  return 'خطا در ارتباط با Owner Console';
};

export async function invokeOwnerConsole<T = unknown>({ body }: OwnerConsoleArgs) {
  const result = await invokeEdgeFunction<T>('owner-console', { body });
  return result;
}
