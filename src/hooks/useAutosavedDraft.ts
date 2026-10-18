import { useCallback, useEffect, useRef, useState } from 'react';
import { readDraftValue, removeDraftValue, writeDraftValue } from '../lib/draftStorage';

export type AutosavedDraftStatus =
  | 'idle'
  | 'restoring'
  | 'restored'
  | 'saving'
  | 'saved'
  | 'error';

export function formDraftKey(
  userId: string | null | undefined,
  formId: string,
  organizationId?: string | null,
): string {
  if (!userId || !formId) return '';
  // New keys are scoped by user + organization + form/entity. The namespace version
  // changes the key so old drafts are not accidentally restored into a different org.
  if (!organizationId) {
    // Preserve existing drafts for older call sites until they explicitly pass org scope.
    return `customs-os:form-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(formId)}`;
  }
  return `customs-os:form-draft:v2:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}:${encodeURIComponent(formId)}`;
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

function legacyFormDraftKey(key: string): string | null {
  const prefix = 'customs-os:form-draft:v2:';
  if (!key.startsWith(prefix)) return null;
  const scoped = key.slice(prefix.length);
  const firstSeparator = scoped.indexOf(':');
  const secondSeparator = scoped.indexOf(':', firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null;
  const encodedUserId = scoped.slice(0, firstSeparator);
  const encodedFormId = scoped.slice(secondSeparator + 1);
  if (!encodedUserId || !encodedFormId) return null;
  return `customs-os:form-draft:v1:${encodedUserId}:${encodedFormId}`;
}

/**
 * Saves serializable form values to a per-user/per-org local draft in localStorage
 * and IndexedDB. It is deliberately separate from database submit actions: a
 * background auth/session check must never erase unsubmitted user work.
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
  const restorePendingRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const serialized = JSON.stringify(value);
  const valueRef = useRef(value);
  valueRef.current = value;

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
    let cancelled = false;
    if (!key) {
      restoredKeyRef.current = '';
      restorePendingRef.current = false;
      skipNextPersistRef.current = false;
      updateStatus('idle');
      updateHasDraft(false);
      return undefined;
    }

    restoredKeyRef.current = key;
    restorePendingRef.current = true;
    skipNextPersistRef.current = false;
    updateStatus('restoring');

    const localDraft = readStoredDraft(key);
    if (localDraft !== null) {
      // Restore synchronously for the common path, then mirror it to IndexedDB.
      skipNextPersistRef.current = true;
      setValueRef.current(localDraft as T);
      updateHasDraft(true);
      updateStatus('restored');
      restorePendingRef.current = false;
      void readDraftValue(key);
    } else {
      // Do not persist the blank initial form before the asynchronous IndexedDB lookup
      // finishes; that race used to overwrite the only recoverable copy.
      void (async () => {
        let stored = await readDraftValue(key);
        const legacyKey = stored === null ? legacyFormDraftKey(key) : null;
        if (stored === null && legacyKey) {
          const legacyDraft = await readDraftValue(legacyKey);
          if (legacyDraft !== null) {
            // Migrate only after the new key accepted a durable copy. If storage fails,
            // keep the old draft in place so a reload cannot destroy the only copy.
            if (await writeDraftValue(key, legacyDraft)) {
              stored = legacyDraft;
              await removeDraftValue(legacyKey);
            }
          }
        }
        return stored;
      })().then((stored) => {
        if (cancelled) return;
        if (stored !== null) {
          skipNextPersistRef.current = true;
          setValueRef.current(stored as T);
          updateHasDraft(true);
          updateStatus('restored');
        } else {
          updateHasDraft(false);
          updateStatus('idle');
        }
      }).catch((error: unknown) => {
        if (cancelled) return;
        console.warn('[FormDraft] Failed to restore IndexedDB draft:', error);
        updateStatus('error');
      }).finally(() => {
        if (!cancelled) restorePendingRef.current = false;
      });
    }

    return () => {
      cancelled = true;
      restorePendingRef.current = false;
    };
  }, [key, updateStatus, updateHasDraft]);

  useEffect(() => {
    if (!key || restoredKeyRef.current !== key || restorePendingRef.current) return;

    // Do not overwrite the draft with a blank initial value before restoration.
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    updateStatus('saving');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void writeDraftValue(key, valueRef.current).then((saved) => {
        if (restoredKeyRef.current !== key) return;
        if (saved) {
          updateHasDraft(true);
          updateStatus('saved');
        } else {
          updateStatus('error');
        }
      }).catch((error: unknown) => {
        console.warn('[FormDraft] Auto-save failed:', error);
        if (restoredKeyRef.current === key) updateStatus('error');
      });
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

    // Keep the synchronous confirmation used by existing form controls, while
    // IndexedDB persistence completes independently as a second durable copy.
    try {
      localStorage.setItem(key, serialized);
      updateHasDraft(true);
      updateStatus('saving');
      void writeDraftValue(key, value).then((saved) => {
        if (restoredKeyRef.current !== key) return;
        updateStatus(saved ? 'saved' : 'error');
      }).catch((error: unknown) => {
        console.warn('[FormDraft] Manual draft save failed:', error);
        if (restoredKeyRef.current === key) updateStatus('error');
      });
      return true;
    } catch (error) {
      console.warn('[FormDraft] localStorage blocked; trying IndexedDB:', error);
      updateStatus('saving');
      void writeDraftValue(key, value).then((saved) => {
        if (restoredKeyRef.current !== key) return;
        updateHasDraft(saved);
        updateStatus(saved ? 'saved' : 'error');
      }).catch((saveError: unknown) => {
        console.warn('[FormDraft] Manual draft save failed:', saveError);
        if (restoredKeyRef.current === key) updateStatus('error');
      });
      return false;
    }
  }, [key, serialized, value, updateStatus, updateHasDraft]);

  const clearDraft = useCallback((skipNextValueWrite = false, nextValue?: T) => {
    if (!key) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Remove both stores; do not allow the IndexedDB copy to resurrect a submitted draft.
    void removeDraftValue(key).then((cleared) => {
      if (restoredKeyRef.current !== key) return;
      updateHasDraft(false);
      updateStatus(cleared ? 'idle' : 'error');
    }).catch((error: unknown) => {
      console.warn('[FormDraft] Draft removal failed:', error);
      if (restoredKeyRef.current === key) updateStatus('error');
    });
    skipNextPersistRef.current =
      skipNextValueWrite && nextValue !== undefined && JSON.stringify(nextValue) !== serialized;
    updateHasDraft(false);
    updateStatus('idle');
  }, [key, serialized, updateStatus, updateHasDraft]);

  return { status, hasDraft, statusRef, hasDraftRef, saveDraftNow, clearDraft };
}
