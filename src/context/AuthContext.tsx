import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';

export type UserRole = 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client';

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

type SessionResponse = {
  authenticated: boolean;
  user?: { id: string; email: string; full_name: string };
  profile?: UserProfile;
};

const createIdentity = (data: SessionResponse): { user: User; session: Session; profile: UserProfile } | null => {
  if (!data.authenticated || !data.user || !data.profile) return null;
  const user = {
    id: data.user.id,
    email: data.user.email,
    app_metadata: { provider: 'cloudflare', providers: ['cloudflare'] },
    user_metadata: { full_name: data.user.full_name },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    role: 'authenticated',
  } as unknown as User;
  const session = {
    access_token: 'cloudflare-http-only-session',
    token_type: 'bearer',
    expires_in: 12 * 60 * 60,
    expires_at: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    refresh_token: 'cloudflare-http-only-session',
    user,
  } as Session;
  return { user, session, profile: data.profile };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('ارتباط با سرویس ورود برقرار نشد.');
      const data = await response.json() as SessionResponse;
      const identity = createIdentity(data);
      setUser(identity?.user ?? null);
      setSession(identity?.session ?? null);
      setProfile(identity?.profile ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در بازیابی نشست');
      setUser(null);
      setSession(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('سرویس ورود موقتاً در دسترس نیست.');
        const data = await response.json() as SessionResponse;
        const identity = createIdentity(data);
        if (!active) return;
        setUser(identity?.user ?? null);
        setSession(identity?.session ?? null);
        setProfile(identity?.profile ?? null);
        setError(null);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'خطا در بررسی نشست');
      } finally {
        if (active) setLoading(false);
      }
    };
    void bootstrap();
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshProfile(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    } catch (cause) {
      console.warn('[Auth] logout request failed', cause);
    } finally {
      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    session,
    profile,
    loading,
    needsOnboarding: false,
    error,
    signOut,
    refreshProfile,
  }), [user, session, profile, loading, error, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
