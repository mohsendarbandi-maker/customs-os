import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosavedDraftStatus =
  | 'idle'
  | 'restoring'
  | 'restored'
  | 'saving'
  | 'saved'
  | 'error';

export function formDraftKey(userId: string | null | undefined, formId: string): string {
  if (!userId || !formId) return '';
  return `customs-os:form-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(formId)}`;
}

function readStoredDraft(key: string): unknown | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Saves serializable form values to a per-user local draft. This is deliberately
 * separate from the database submit action: background auth/session checks must
 * never erase work that has not yet been submitted.
 */
export function useAutosavedDraft<T>(
  key: string,
  value: T,
  setValue: (value: T) => void,
  delayMs = 350,
) {
  const setValueRef = useRef(setValue);
  setValueRef.current = setValue;
  const restoredKeyRef = useRef('');
  const skipNextPersistRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const serialized = JSON.stringify(value);

  const [status, setStatus] = useState<AutosavedDraftStatus>(key ? 'restoring' : 'idle');
  const [hasDraft, setHasDraft] = useState(() => readStoredDraft(key) !== null);
  const statusRef = useRef<AutosavedDraftStatus>(key ? 'restoring' : 'idle');
  const hasDraftRef = useRef(readStoredDraft(key) !== null);
  const updateStatus = useCallback((next: AutosavedDraftStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const updateHasDraft = useCallback((next: boolean) => {
    hasDraftRef.current = next;
    setHasDraft(next);
  }, []);

  useEffect(() => {
    if (!key) {
      restoredKeyRef.current = '';
      skipNextPersistRef.current = false;
      updateStatus('idle');
      updateHasDraft(false);
      return;
    }

    restoredKeyRef.current = key;
    skipNextPersistRef.current = true;

    const stored = readStoredDraft(key);
    if (stored !== null) {
      setValueRef.current(stored as T);
      updateHasDraft(true);
      updateStatus('restored');
    } else {
      updateHasDraft(false);
      updateStatus('idle');
    }
  }, [key, updateStatus, updateHasDraft]);

  useEffect(() => {
    if (!key || restoredKeyRef.current !== key) return;

    // Do not overwrite the draft with the form's blank initial state before
    // the restoration state update has been applied.
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    updateStatus('saving');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      try {
        localStorage.setItem(key, serialized);
        updateHasDraft(true);
        updateStatus('saved');
      } catch (error) {
        console.warn('[FormDraft] Local draft could not be saved:', error);
        updateStatus('error');
      }
    }, delayMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [key, serialized, delayMs, updateStatus, updateHasDraft]);

  const saveDraftNow = useCallback(() => {
    if (!key) return false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      localStorage.setItem(key, serialized);
      updateHasDraft(true);
      updateStatus('saved');
      return true;
    } catch (error) {
      console.warn('[FormDraft] Local draft could not be saved:', error);
      updateStatus('error');
      return false;
    }
  }, [key, serialized, updateStatus, updateHasDraft]);

  const clearDraft = useCallback(() => {
    if (!key) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      localStorage.removeItem(key);
      updateHasDraft(false);
      updateStatus('idle');
      // A deliberate reset should remain cleared until the user types again.
      skipNextPersistRef.current = true;
    } catch (error) {
      console.warn('[FormDraft] Local draft could not be cleared:', error);
      updateStatus('error');
    }
  }, [key, updateStatus, updateHasDraft]);

  return { status, hasDraft, statusRef, hasDraftRef, saveDraftNow, clearDraft };
}
