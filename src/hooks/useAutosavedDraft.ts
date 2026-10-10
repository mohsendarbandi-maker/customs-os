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
  const serialized = JSON.stringify(value);

  const [status, setStatus] = useState<AutosavedDraftStatus>(key ? 'restoring' : 'idle');
  const [hasDraft, setHasDraft] = useState(() => readStoredDraft(key) !== null);

  useEffect(() => {
    if (!key) {
      restoredKeyRef.current = '';
      skipNextPersistRef.current = false;
      setStatus('idle');
      setHasDraft(false);
      return;
    }

    restoredKeyRef.current = key;
    skipNextPersistRef.current = true;

    const stored = readStoredDraft(key);
    if (stored !== null) {
      setValueRef.current(stored as T);
      setHasDraft(true);
      setStatus('restored');
    } else {
      setHasDraft(false);
      setStatus('idle');
    }
  }, [key]);

  useEffect(() => {
    if (!key || restoredKeyRef.current !== key) return;

    // Do not overwrite the draft with the form's blank initial state before
    // the restoration state update has been applied.
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    setStatus('saving');
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, serialized);
        setHasDraft(true);
        setStatus('saved');
      } catch (error) {
        console.warn('[FormDraft] Local draft could not be saved:', error);
        setStatus('error');
      }
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [key, serialized, delayMs]);

  const saveDraftNow = useCallback(() => {
    if (!key) return false;
    try {
      localStorage.setItem(key, serialized);
      setHasDraft(true);
      setStatus('saved');
      return true;
    } catch (error) {
      console.warn('[FormDraft] Local draft could not be saved:', error);
      setStatus('error');
      return false;
    }
  }, [key, serialized]);

  const clearDraft = useCallback(() => {
    if (!key) return;
    try {
      localStorage.removeItem(key);
      setHasDraft(false);
      setStatus('idle');
      // A deliberate reset should remain cleared until the user types again.
      skipNextPersistRef.current = true;
    } catch (error) {
      console.warn('[FormDraft] Local draft could not be cleared:', error);
      setStatus('error');
    }
  }, [key]);

  return { status, hasDraft, saveDraftNow, clearDraft };
}
