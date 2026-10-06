export const userSettingsStorageKey = (userId?: string | null) =>
  userId ? `customs-settings:${userId}` : 'customs-settings:anonymous';

export const userChatPreferencesStorageKey = (userId?: string | null) =>
  userId ? `customs-chat-preferences:${userId}` : 'customs-chat-preferences:anonymous';

export function readUserSettings<T extends Record<string, unknown>>(
  userId: string | null | undefined,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(userSettingsStorageKey(userId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? ({ ...fallback, ...parsed } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeUserSettings(
  userId: string | null | undefined,
  settings: Record<string, unknown>,
): void {
  try {
    localStorage.setItem(userSettingsStorageKey(userId), JSON.stringify(settings));
  } catch {
    // Local persistence is an optimization; server persistence remains authoritative.
  }
}
