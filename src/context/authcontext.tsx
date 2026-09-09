import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const currentFetchId = useRef<number>(0);
  const isMounted = useRef<boolean>(true);

  // Cleanup on unmount to prevent state updates on unmounted components
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    const fetchId = ++currentFetchId.current;
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!isMounted.current || fetchId !== currentFetchId.current) return;

      if (fetchError) throw fetchError;

      if (!data) {
        setProfile(null);
        setNeedsOnboarding(true);
      } else {
        setProfile(data as UserProfile);
        setNeedsOnboarding(false);
      }
    } catch (err: unknown) {
      if (!isMounted.current || fetchId !== currentFetchId.current) return;
      
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred while fetching user data.';
      setError(errorMessage);
      setProfile(null);
    } finally {
      if (isMounted.current && fetchId === currentFetchId.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const initializeAuth = async () => {
      // Fetch initial session
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      
      if (isMounted.current) {
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        
        if (initialSession?.user) {
          await fetchProfile(initialSession.user.id);
        } else {
          setLoading(false);
        }
      }

      // Listen for auth changes
      const { data } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
        if (!isMounted.current) return;
        
        setSession(currentSession);
        const currentUser = currentSession?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          await fetchProfile(currentUser.id);
        } else {
          currentFetchId.current++; // Invalidate pending fetches
          setProfile(null);
          setNeedsOnboarding(false);
          setLoading(false);
        }
      });
      
      subscription = data.subscription;
    };

    initializeAuth();

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    currentFetchId.current++; 
    setLoading(true);
    
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      if (isMounted.current) {
        setUser(null);
        setSession(null);
        setProfile(null);
        setNeedsOnboarding(false);
        setLoading(false);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      setLoading(true);
      await fetchProfile(user.id);
    }
  }, [user?.id, fetchProfile]);

  // Memoize context value to prevent unnecessary re-renders of consuming components
  const contextValue = useMemo(() => ({
    user,
    session,
    profile,
    loading,
    needsOnboarding,
    error,
    signOut,
    refreshProfile,
  }), [user, session, profile, loading, needsOnboarding, error, signOut, refreshProfile]);

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
