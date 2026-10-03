import { supabase } from './supabase';

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

export async function invokeOwnerConsole({
  body,
}: OwnerConsoleArgs) {
  /*
   * Always obtain the current session immediately before
   * invoking the Edge Function.
   *
   * This prevents sending an expired/missing Authorization
   * header when the access token has just been refreshed.
   */
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(
      `خطا در دریافت نشست کاربر: ${getErrorMessage(sessionError)}`,
    );
  }

  const accessToken = session?.access_token?.trim();

  if (!accessToken) {
    throw new Error(
      'نشست کاربر معتبر نیست یا منقضی شده است. لطفاً دوباره وارد شوید.',
    );
  }

  const anonKey = (
    import.meta as any
  ).env.VITE_SUPABASE_ANON_KEY;

  const { data, error } =
    await supabase.functions.invoke('owner-console', {
      body,

      /*
       * Explicitly send the JWT.
       *
       * Do NOT use the service_role key here.
       * The Edge Function validates this user server-side.
       */
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(anonKey
          ? {
              apikey: anonKey,
            }
          : {}),
      },
    });

  if (error) {
    let message = getErrorMessage(error);

    /*
     * FunctionsHttpError may contain the actual Edge Function
     * response in error.context.
     */
    try {
      const context = (error as any).context;

      if (context) {
        if (
          typeof context === 'string' &&
          context.trim()
        ) {
          message = context;
        } else if (
          typeof context.json === 'function'
        ) {
          const payload = await context.json();

          if (payload?.error) {
            message = String(payload.error);
          } else if (payload?.message) {
            message = String(payload.message);
          }
        }
      }
    } catch {
      // Keep the original error message.
    }

    throw new Error(message);
  }

  return {
    data,
    error: null,
  };
}