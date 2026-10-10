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
import {
  AUTH_SESSION_RETRY_MESSAGE,
  isAuthTokenExpiredError,
  isUnrecoverableAuthSessionError,
} from '../lib/authSessionErrors';

const clearLocalAuthStorage = () => {
  try {
    localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    sessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  } catch {}
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
        const { data, error: refreshError } = await supabase.auth.refreshSession();
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

      let profileResult = await loadProfile();

      // An idle/background tab can resume with an expired access token before
      // the SDK's foreground refresh cycle has completed. Refresh once and retry.
      if (isAuthTokenExpiredError(profileResult.error)) {
        await refreshSessionForUser(userId);

        if (!isMounted.current || fetchId !== currentFetchId.current) {
          return;
        }

        profileResult = await loadProfile();
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
      } else {
        setProfile(data as UserProfile);
        setNeedsOnboarding(false);
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
        isAuthTokenExpiredError(err) ||
        rawMessage === AUTH_SESSION_RETRY_MESSAGE ||
        /failed to fetch|network error|timed? ?out|gateway timeout/i.test(rawMessage);
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
        } = await supabase.auth.getSession();

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
          await fetchProfile(initialSession.user.id);
        } else {
          currentFetchId.current++;
          setProfile(null);
          setNeedsOnboarding(false);
          setError(null);
          setLoading(false);
        }

        initialized.current = true;
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

    const handleVisibilityChange = () => {
      if (
        !active ||
        !isMounted.current ||
        !initialized.current ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      // getSession() refreshes expired sessions when possible. This runs outside
      // onAuthStateChange so it cannot wait on the SDK's auth lock from a callback.
      void supabase.auth.getSession().then(({ data: { session: visibleSession }, error: sessionError }) => {
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
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    subscription = authSubscription;
    void loadInitialSession();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    currentFetchId.current++;

    if (isMounted.current) {
      setLoading(true);
    }

    try {
      const { error: signOutError } = await supabase.auth.signOut();

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
      } = await supabase.auth.getSession();

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
