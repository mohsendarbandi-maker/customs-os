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
  const isMounted = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    const fetchId = ++currentFetchId.current;

    if (isMounted.current) {
      setError(null);
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!isMounted.current || fetchId !== currentFetchId.current) {
        return;
      }

      if (fetchError) {
        throw fetchError;
      }

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

      const message =
        err instanceof Error
          ? err.message
          : 'خطا در دریافت اطلاعات کاربر';

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
  }, []);

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

    subscription = authSubscription;
    void loadInitialSession();

    return () => {
      active = false;
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
