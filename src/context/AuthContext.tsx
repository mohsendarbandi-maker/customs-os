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

      // Do not discard an already loaded profile when a background refresh fails.
      // The current route and its form must remain mounted; on a true account switch,
      // the SIGNED_IN handler below clears a profile that belongs to another user.
      setNeedsOnboarding(false);
      setError(message);
    } finally {
      if (isMounted.current && fetchId === currentFetchId.current) {
        setLoading(false);
      }
    }
  }, []);

  /*
   * IMPORTANT:
   * Never await Supabase database requests directly inside
   * onAuthStateChange().
   *
   * Supabase can internally hold auth locks while emitting the
   * auth event. Waiting for another Supabase request here can
   * cause initialization/session races and white-screen states.
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
          if (/refresh_token_not_found|invalid refresh token|refresh token/i.test(sessionError.message)) {
            clearLocalAuthStorage();
          }

          setSession(null);
          setUser(null);
          setProfile(null);
          setNeedsOnboarding(false);
          setError(sessionError.message);
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
        if (/refresh_token_not_found|invalid refresh token|refresh token/i.test(String((err as any)?.message || err))) {
          clearLocalAuthStorage();
        }

        setSession(null);
        setUser(null);
        setProfile(null);
        setNeedsOnboarding(false);
        setError(
          err instanceof Error
            ? err.message
            : 'خطا در راه‌اندازی احراز هویت',
        );
        setLoading(false);
      }
    };

    /*
     * Register the listener immediately.
     * The callback only updates auth state.
     * Profile loading is scheduled outside the callback.
     */
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!active || !isMounted.current) return;

      console.log('[Auth] state changed:', event);

      // Supabase emits INITIAL_SESSION while getSession() is still resolving.
      // Do not turn that transient event into a login redirect.
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

      /*
       * Do NOT await anything here.
       * Defer profile loading until Supabase has finished
       * processing the auth event.
       */
      if (event === 'SIGNED_IN') {
        const userId = currentSession.user.id;
        // Avoid briefly showing one account's data after an actual account switch,
        // while keeping the already-mounted page for the same account.
        setProfile((previous) => previous?.id === userId ? previous : null);
        setLoading(true);

        setTimeout(() => {
          if (!active || !isMounted.current) return;
          void fetchProfile(userId);
        }, 0);
      }

      // A token refresh is a background auth maintenance event.
      // Keep the current UI mounted; it must never look like the app is
      // logging the user out or re-checking the session.
      if (event === 'TOKEN_REFRESHED') {
        initialized.current = true;
        setError(null);
      }
    });

    subscription = authSubscription;

    /*
     * Initial getSession is intentionally performed separately.
     */
    void loadInitialSession();

    return () => {
      active = false;

      if (subscription) {
        subscription.unsubscribe();
      }
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

    if (!currentUserId) {
      setProfile(null);
      setNeedsOnboarding(false);
      return;
    }

    setLoading(true);

    await fetchProfile(currentUserId);
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