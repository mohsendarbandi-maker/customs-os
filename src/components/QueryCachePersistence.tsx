import React, { useEffect, useRef, useState } from 'react';
import { dehydrate, hydrate, useQueryClient, type DehydratedState } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { readOfflineQueryCache, saveOfflineQueryCache } from '../lib/offlineQueue';

const CACHE_NAMESPACE = 'react-query-snapshot-v1';
const MAX_SNAPSHOT_BYTES = 3_500_000;
const MAX_PERSISTED_QUERIES = 45;
const BLOCKED_QUERY_TERMS = [
  'auth', 'session', 'token', 'password', 'secret', 'credential',
  'chat', 'message', 'attachment', 'fileblob', 'blob', 'binary', 'storage', 'signed_url', 'signedurl',
  'document', 'document_content', 'documentcontent', 'file-manager', 'file_manager', 'download',
];

type CachedQuerySnapshot = { version: 1; state: DehydratedState };

const isSafeQueryKey = (key: readonly unknown[]) => {
  let normalized = '';
  try { normalized = JSON.stringify(key).toLowerCase(); } catch { return false; }
  return !BLOCKED_QUERY_TERMS.some((term) => normalized.includes(term));
};

const createBoundedSnapshot = (queryClient: ReturnType<typeof useQueryClient>): CachedQuerySnapshot | null => {
  try {
    const dehydrated = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => query.state.status === 'success' && isSafeQueryKey(query.queryKey),
      shouldDehydrateMutation: () => false,
    });
    const newest = [...dehydrated.queries].sort(
      (a, b) => (b.state.dataUpdatedAt || 0) - (a.state.dataUpdatedAt || 0),
    );
    const selected: DehydratedState['queries'] = [];
    let totalBytes = 0;
    for (const query of newest) {
      if (selected.length >= MAX_PERSISTED_QUERIES) break;
      const size = JSON.stringify(query).length;
      if (!Number.isFinite(size) || totalBytes + size > MAX_SNAPSHOT_BYTES) continue;
      selected.push(query);
      totalBytes += size;
    }
    if (!selected.length) return null;
    return { version: 1, state: { mutations: [], queries: selected } };
  } catch (error) {
    console.warn('[Query cache] unable to create local snapshot:', error);
    return null;
  }
};

/**
 * Persists a small, user/organization-partitioned snapshot of successful query results.
 * Restored data is immediately visible while stale queries revalidate against Supabase.
 * Auth tokens, chat bodies, attachments, downloaded documents and mutations are never persisted here.
 */
export const QueryCachePersistence: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const scope = user && profile?.id === user.id && profile.organization_id
    ? `${user.id}:${profile.organization_id}`
    : null;
  const activeScope = useRef<string | null>(null);
  const restoreInProgress = useRef(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      activeScope.current = null;
      restoreInProgress.current = false;
      queryClient.clear();
      setReadyScope(null);
      return () => { cancelled = true; };
    }
    if (!scope) {
      if (activeScope.current && user && activeScope.current.split(':', 1)[0] !== user.id) {
        activeScope.current = null;
        restoreInProgress.current = false;
        queryClient.clear();
      }
      setReadyScope(null);
      return () => { cancelled = true; };
    }
    if (activeScope.current === scope) {
      setReadyScope(scope);
      return () => { cancelled = true; };
    }

    const previousScope = activeScope.current;
    activeScope.current = null;
    restoreInProgress.current = true;
    setReadyScope(null);
    if (previousScope && previousScope !== scope) queryClient.clear();
    void readOfflineQueryCache<CachedQuerySnapshot>(CACHE_NAMESPACE, user.id, profile!.organization_id)
      .then((cached) => {
        if (cancelled) return;
        const snapshot = cached?.payload;
        if (snapshot?.version === 1 && snapshot.state && Array.isArray(snapshot.state.queries)) {
          const safeState: DehydratedState = {
            mutations: [],
            queries: snapshot.state.queries.filter((query) => isSafeQueryKey(query.queryKey)),
          };
          hydrate(queryClient, safeState);
        }
      })
      .catch((error) => console.warn('[Query cache] restore skipped:', error))
      .finally(() => {
        if (cancelled) return;
        activeScope.current = scope;
        restoreInProgress.current = false;
        setReadyScope(scope);
      });
    return () => { cancelled = true; };
  }, [profile?.organization_id, profile?.id, queryClient, scope, user, user?.id]);

  useEffect(() => {
    const persist = () => {
      if (restoreInProgress.current || !activeScope.current || !user || !profile) return;
      const currentScope = `${user.id}:${profile.organization_id}`;
      if (activeScope.current !== currentScope || profile.id !== user.id) return;
      const snapshot = createBoundedSnapshot(queryClient);
      if (!snapshot) return;
      void saveOfflineQueryCache(CACHE_NAMESPACE, user.id, profile.organization_id, snapshot)
        .catch((error) => console.warn('[Query cache] snapshot save skipped:', error));
    };
    const schedule = () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(persist, 650);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.status === 'success') schedule();
    });
    const persistOnHide = () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      persist();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistOnHide();
    };
    window.addEventListener('pagehide', persistOnHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', persistOnHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [profile, queryClient, user]);

  // Render immediately on ordinary app reopens; the REST and React Query caches
  // hydrate in the background. Only block during an in-place account/organization switch
  // so the previous account's query data cannot flash in the new workspace.
  const activeUserId = activeScope.current?.split(':', 1)[0] ?? null;
  if (
    activeScope.current &&
    ((scope && activeScope.current !== scope) || (user && activeUserId !== user.id))
  ) {
    return (
      <div dir="rtl" className="min-h-[100dvh] grid place-items-center bg-[var(--bg)] text-[var(--text)]" aria-busy="true">
        <div className="rounded-2xl border app-border bg-[var(--surface)] px-5 py-4 text-center shadow-sm">
          <div className="mx-auto mb-3 h-7 w-7 rounded-full border-3 border-[var(--primary)]/20 border-t-[var(--primary)] animate-spin" />
          <div className="text-sm font-bold">در حال آماده‌سازی فضای کاری…</div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};
