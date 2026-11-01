import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, SUPABASE_AUTH_STORAGE_KEY } from '../lib/supabase';
import { authSessionStorage } from '../lib/authStorage';
import { withTimeout } from '../lib/withTimeout';

const AUTH_SESSION_TIMEOUT_MS = 10_000;
const AUTH_PROFILE_TIMEOUT_MS = 12_000;
const AUTH_CACHE_TIMEOUT_MS = 2_500;
import { readOfflineQueryCache, saveOfflineQueryCache } from '../lib/offlineQueue';
import {
  AUTH_SESSION_RETRY_MESSAGE,
  isAuthTokenExpiredError,
  isRetryableAuthSessionError,
  isUnrecoverableAuthSessionError,
} from '../lib/authSessionErrors';

const clearLocalAuthStorage = () => {
  try {
    localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    sessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  } catch {}
  // Also remove the async fallback; otherwise a stale IndexedDB copy could revive
  // a session after an explicit sign-out or a confirmed invalid refresh token.
  void authSessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY).catch((error) => {
    console.warn('[Auth] failed to clear fallback session storage:', error);
  });
};

export type UserRole =
  | 'owner'
  | 'admin'
  | 'broker'
  | 'accountant'
  | 'warehouse'
  | 'client';

export interface UserProfile {
  id: string;
  organization_id: string;
  role: UserRole;
  client_id?: string | null;
  full_name: string;
  phone?: string | null;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  needsOnboarding: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFetchId = useRef(0);
  const sessionRefreshPromise = useRef<Promise<void> | null>(null);
  const activeUserId = useRef<string | null>(null);
  const activeProfileId = useRef<string | null>(null);
  const activeAuthError = useRef<string | null>(null);
  const isMounted = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    activeUserId.current = user?.id ?? null;
    activeProfileId.current = profile?.id ?? null;
    activeAuthError.current = error;
  }, [user?.id, profile?.id, error]);

  const refreshSessionForUser = useCallback(async (userId: string) => {
    let pending = sessionRefreshPromise.current;

    if (!pending) {
      pending = (async () => {
        const { data, error: refreshError } = await withTimeout(
          supabase.auth.refreshSession(),
          AUTH_SESSION_TIMEOUT_MS,
          'refreshing the login session',
        );
        if (refreshError) throw refreshError;

        const refreshedSession = data.session;
        if (!refreshedSession?.user || refreshedSession.user.id !== userId) {
          throw new Error(AUTH_SESSION_RETRY_MESSAGE);
        }

        if (isMounted.current) {
          setSession(refreshedSession);
          setUser(refreshedSession.user);
          setError(null);
        }
      })();
      sessionRefreshPromise.current = pending;
    }

    try {
      await pending;
    } finally {
      if (sessionRefreshPromise.current === pending) {
        sessionRefreshPromise.current = null;
      }
    }
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    const fetchId = ++currentFetchId.current;

    if (isMounted.current) {
      setError(null);
    }

    try {
      const loadProfile = () =>
        supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

      let profileResult = await withTimeout(
        loadProfile(),
        AUTH_PROFILE_TIMEOUT_MS,
        'loading the workspace profile',
      );

      // An idle/background tab can resume with an expired access token before
      // the SDK's foreground refresh cycle has completed. Refresh once and retry.
      if (isAuthTokenExpiredError(profileResult.error)) {
        await refreshSessionForUser(userId);

        if (!isMounted.current || fetchId !== currentFetchId.current) {
          return;
        }

        profileResult = await withTimeout(
          loadProfile(),
          AUTH_PROFILE_TIMEOUT_MS,
          'retrying the workspace profile request',
        );
        if (isAuthTokenExpiredError(profileResult.error)) {
          throw new Error(AUTH_SESSION_RETRY_MESSAGE);
        }
      }

      if (!isMounted.current || fetchId !== currentFetchId.current) {
        return;
      }

      if (profileResult.error) {
        throw profileResult.error;
      }

      const { data } = profileResult;

      if (!data) {
        setProfile(null);
        setNeedsOnboarding(true);
        // A server-confirmed missing profile invalidates any old offline profile snapshot.
        void saveOfflineQueryCache<UserProfile | null>('auth-profile', userId, userId, null).catch(() => undefined);
      } else {
        const loadedProfile = data as UserProfile;
        setProfile(loadedProfile);
        setNeedsOnboarding(false);
        // Keep a short-lived, user-partitioned profile snapshot so an already
        // authenticated user can reopen the app shell during a temporary outage.
        void saveOfflineQueryCache<UserProfile>('auth-profile', userId, userId, loadedProfile).catch(() => undefined);
      }

      setError(null);
    } catch (err: unknown) {
      if (!isMounted.current || fetchId !== currentFetchId.current) {
        return;
      }

      if (isUnrecoverableAuthSessionError(err)) {
        // An actually invalid/revoked refresh token cannot be recovered. Clear
        // this browser's credentials locally; transient network failures never do.
        clearLocalAuthStorage();
        currentFetchId.current++;
        initialized.current = true;
        setSession(null);
        setUser(null);
        setProfile(null);
        setNeedsOnboarding(false);
        setError(null);
        setLoading(false);
        return;
      }

      const errorRecord = err && typeof err === 'object'
        ? (err as { message?: unknown })
        : null;
      const rawMessage = err instanceof Error
        ? err.message
        : typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : '';
      const retryableAuthFailure =
        isRetryableAuthSessionError(err) ||
        rawMessage === AUTH_SESSION_RETRY_MESSAGE;

      if (retryableAuthFailure) {
        const cachedProfile = await withTimeout(
          readOfflineQueryCache<UserProfile | null>('auth-profile', userId, userId),
          AUTH_CACHE_TIMEOUT_MS,
          'reading the offline workspace profile',
        ).catch(() => null);
        if (!isMounted.current || fetchId !== currentFetchId.current) return;
        const offlineProfile = cachedProfile?.payload;
        if (
          offlineProfile &&
          offlineProfile.id === userId &&
          offlineProfile.is_active &&
          Boolean(offlineProfile.organization_id)
        ) {
          setProfile(offlineProfile);
          setNeedsOnboarding(false);
          setError(null);
          return;
        }
      }

      const message = retryableAuthFailure
        ? AUTH_SESSION_RETRY_MESSAGE
        : rawMessage || 'خطا در دریافت اطلاعات کاربر';

      console.error('[Auth] fetchProfile failed:', err);

      // Keep a previously loaded profile and its page mounted if a background
      // request fails. A new account never inherits another user's profile.
      setNeedsOnboarding(false);
      setError(message);
    } finally {
      if (isMounted.current && fetchId === currentFetchId.current) {
        setLoading(false);
      }
    }
  }, [refreshSessionForUser]);

  /*
   * Never await Supabase database requests inside onAuthStateChange().
   * Supabase may hold auth locks while emitting an event; waiting for another
   * Supabase request there can cause initialization/session races.
   */
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const loadInitialSession = async () => {
      try {
        const {
          data: { session: initialSession },
          error: sessionError,
        } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_SESSION_TIMEOUT_MS,
          'restoring the saved login session',
        );

        if (!active || !isMounted.current) return;

        if (sessionError) {
          console.error('[Auth] getSession failed:', sessionError);

          if (isUnrecoverableAuthSessionError(sessionError)) {
            // Only remove persisted credentials when Auth says the token/session
            // is invalid or revoked. A network outage must not look like logout.
            clearLocalAuthStorage();
            currentFetchId.current++;
            setSession(null);
            setUser(null);
            setProfile(null);
            setNeedsOnboarding(false);
            setError(null);
            initialized.current = true;
          } else {
            // Preserve stored credentials and show recovery controls instead of
            // redirecting the user to login after a temporary connectivity error.
            setError(AUTH_SESSION_RETRY_MESSAGE);
          }

          setLoading(false);
          return;
        }

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          const userId = initialSession.user.id;
          // Warm-start the authenticated shell from the previously verified,
          // user-scoped IndexedDB profile before waiting on the network. The
          // server profile is still refreshed immediately in the background;
          // all data writes remain protected by Supabase RLS.
          const cachedProfile = await withTimeout(
            readOfflineQueryCache<UserProfile | null>('auth-profile', userId, userId),
            AUTH_CACHE_TIMEOUT_MS,
            'reading the cached workspace profile',
          ).catch(() => null);
          const offlineProfile = cachedProfile?.payload;
          if (
            offlineProfile &&
            offlineProfile.id === userId &&
            offlineProfile.is_active &&
            Boolean(offlineProfile.organization_id)
          ) {
            setProfile(offlineProfile);
            setNeedsOnboarding(false);
            setError(null);
            initialized.current = true;
            setLoading(false);
            void fetchProfile(userId);
          } else {
            await fetchProfile(userId);
            initialized.current = true;
          }
        } else {
          currentFetchId.current++;
          setProfile(null);
          setNeedsOnboarding(false);
          setError(null);
          setLoading(false);
          initialized.current = true;
        }
      } catch (err: unknown) {
        if (!active || !isMounted.current) return;

        console.error('[Auth] initialization failed:', err);

        if (isUnrecoverableAuthSessionError(err)) {
          clearLocalAuthStorage();
          currentFetchId.current++;
          setSession(null);
          setUser(null);
          setProfile(null);
          setNeedsOnboarding(false);
          setError(null);
          initialized.current = true;
        } else {
          // Do not discard the persistent session because getSession failed
          // transiently (offline, timeout, or Auth service unavailable).
          setError(AUTH_SESSION_RETRY_MESSAGE);
        }

        setLoading(false);
      }
    };

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!active || !isMounted.current) return;

      console.log('[Auth] state changed:', event);

      // INITIAL_SESSION can fire before getSession() settles. Ignore that
      // transient event so it cannot erase the retry state during bootstrap.
      if (event === 'INITIAL_SESSION' && !initialized.current) {
        return;
      }

      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (!currentSession?.user) {
        if (event === 'SIGNED_OUT') clearLocalAuthStorage();
        currentFetchId.current++;

        setProfile(null);
        setNeedsOnboarding(false);
        setError(null);
        setLoading(false);
        return;
      }

      // Do not await anything inside the auth callback.
      if (event === 'SIGNED_IN') {
        const userId = currentSession.user.id;

        // Do not briefly show one account's profile after a real account switch.
        setProfile((previous) => (previous?.id === userId ? previous : null));
        setLoading(true);

        setTimeout(() => {
          if (!active || !isMounted.current) return;
          void fetchProfile(userId);
        }, 0);
      }

      // Token refresh is routine session maintenance, not a reason to unmount
      // the current page or clear form state.
      if (event === 'TOKEN_REFRESHED') {
        initialized.current = true;
        setError(null);
      }
    });

    let lastLifecycleRecoveryAt = 0;
    let lifecycleRecoveryInFlight = false;
    const handleVisibilityChange = () => {
      if (
        !active ||
        !isMounted.current ||
        !initialized.current ||
        document.visibilityState !== 'visible' ||
        lifecycleRecoveryInFlight ||
        Date.now() - lastLifecycleRecoveryAt < 15_000
      ) {
        return;
      }

      // Safari can resume from its frozen state via focus/pageshow without a
      // visibilitychange event. Coalesce these signals to avoid overlapping refreshes.
      lastLifecycleRecoveryAt = Date.now();
      lifecycleRecoveryInFlight = true;

      // getSession() refreshes expired sessions when possible. This runs outside
      // onAuthStateChange so it cannot wait on the SDK's auth lock from a callback.
      void withTimeout(
        supabase.auth.getSession(),
        AUTH_SESSION_TIMEOUT_MS,
        'recovering the active login session',
      ).then(({ data: { session: visibleSession }, error: sessionError }) => {
        if (!active || !isMounted.current) return;

        if (sessionError) {
          console.warn('[Auth] visible session recovery failed:', sessionError);

          if (isUnrecoverableAuthSessionError(sessionError)) {
            clearLocalAuthStorage();
            currentFetchId.current++;
            initialized.current = true;
            setSession(null);
            setUser(null);
            setProfile(null);
            setNeedsOnboarding(false);
            setError(null);
            setLoading(false);
          } else if (!activeProfileId.current) {
            setError(AUTH_SESSION_RETRY_MESSAGE);
            setLoading(false);
          }
          return;
        }

        if (!visibleSession?.user) return;

        const visibleUserId = visibleSession.user.id;
        setSession(visibleSession);
        setUser(visibleSession.user);

        if (
          activeUserId.current !== visibleUserId ||
          activeProfileId.current !== visibleUserId ||
          activeAuthError.current
        ) {
          setProfile((previous) => (previous?.id === visibleUserId ? previous : null));
          setLoading(true);
          void fetchProfile(visibleUserId);
        } else {
          setError(null);
        }
      }).catch((err: unknown) => {
        console.warn('[Auth] visible session recovery exception:', err);
        if (active && isMounted.current && !activeProfileId.current) {
          setError(AUTH_SESSION_RETRY_MESSAGE);
          setLoading(false);
        }
      }).finally(() => {
        lifecycleRecoveryInFlight = false;
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);
    subscription = authSubscription;
    void loadInitialSession();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
      subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    currentFetchId.current++;

    if (isMounted.current) {
      setLoading(true);
    }

    try {
      // A normal logout must only revoke this browser/device. Do not broadcast
      // a remote-revocation marker for this same session: its own lifecycle
      // listener would race this logout with a second signOut request.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });

      if (signOutError) {
        console.error('[Auth] signOut failed:', signOutError);
      }
    } catch (err) {
      console.error('[Auth] signOut exception:', err);
    } finally {
      // Logout is explicit: clear this browser's saved session even when the
      // network is unavailable and the server-side request cannot complete.
      clearLocalAuthStorage();

      if (isMounted.current) {
        setUser(null);
        setSession(null);
        setProfile(null);
        setNeedsOnboarding(false);
        setError(null);
        setLoading(false);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUserId = user?.id;

    setLoading(true);
    setError(null);

    if (currentUserId) {
      await fetchProfile(currentUserId);
      return;
    }

    // The recovery button must retry the session itself when the initial
    // auth bootstrap failed before it could populate user/profile state.
    try {
      const {
        data: { session: recoveredSession },
        error: sessionError,
      } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_SESSION_TIMEOUT_MS,
        'restoring the login session',
      );

      if (sessionError) {
        console.error('[Auth] session recovery failed:', sessionError);

        if (isUnrecoverableAuthSessionError(sessionError)) {
          clearLocalAuthStorage();
          currentFetchId.current++;
          setSession(null);
          setUser(null);
          setProfile(null);
          setNeedsOnboarding(false);
          setError(null);
          initialized.current = true;
        } else {
          setError(AUTH_SESSION_RETRY_MESSAGE);
        }
        return;
      }

      initialized.current = true;
      setSession(recoveredSession);
      setUser(recoveredSession?.user ?? null);

      if (recoveredSession?.user) {
        await fetchProfile(recoveredSession.user.id);
      } else {
        currentFetchId.current++;
        setProfile(null);
        setNeedsOnboarding(false);
        setError(null);
      }
    } catch (err: unknown) {
      console.error('[Auth] session recovery exception:', err);

      if (isUnrecoverableAuthSessionError(err)) {
        clearLocalAuthStorage();
        currentFetchId.current++;
        setSession(null);
        setUser(null);
        setProfile(null);
        setNeedsOnboarding(false);
        setError(null);
        initialized.current = true;
      } else {
        setError(AUTH_SESSION_RETRY_MESSAGE);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [user?.id, fetchProfile]);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      profile,
      loading,
      needsOnboarding,
      error,
      signOut,
      refreshProfile,
    }),
    [
      user,
      session,
      profile,
      loading,
      needsOnboarding,
      error,
      signOut,
      refreshProfile,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
