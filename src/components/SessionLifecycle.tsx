import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { describeDevice, getSessionIdFromAccessToken } from '../lib/deviceSessions';

export function SessionLifecycle() {
  const { session, signOut } = useAuth();
  const userId = session?.user.id ?? null;
  const sessionId = getSessionIdFromAccessToken(session?.access_token);

  useEffect(() => {
    if (!userId || !sessionId) return;

    let active = true;
    let signingOut = false;

    const signOutRevokedSession = async () => {
      if (signingOut) return;
      signingOut = true;
      try {
        // Use the central AuthContext logout so local storage and UI state are
        // cleared even if the server has already invalidated the refresh token.
        await signOut();
      } catch (error) {
        console.warn('[Auth] local sign-out for a revoked device session failed:', error);
      }
    };

    const checkAndHeartbeat = async () => {
      if (!active || signingOut) return;

      const { data, error } = await supabase
        .from('user_device_sessions')
        .select('revoked_at')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.warn('[Auth] device-session check failed:', error);
        return;
      }

      if (data?.revoked_at) {
        await signOutRevokedSession();
        return;
      }

      const now = new Date().toISOString();
      if (!data) {
        const { error: insertError } = await supabase.from('user_device_sessions').insert({
          session_id: sessionId,
          user_id: userId,
          device_label: describeDevice(navigator.userAgent),
          user_agent: navigator.userAgent,
          app_origin: window.location.hostname,
          last_seen_at: now,
        });

        if (insertError && insertError.code !== '23505') {
          console.warn('[Auth] device-session registration failed:', insertError);
        }
        if (insertError?.code === '23505') {
          // Another tab may have registered this same session concurrently.
          await checkAndHeartbeat();
        }
        return;
      }

      const { error: updateError } = await supabase
        .from('user_device_sessions')
        .update({
          device_label: describeDevice(navigator.userAgent),
          user_agent: navigator.userAgent,
          app_origin: window.location.hostname,
          last_seen_at: now,
        })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .is('revoked_at', null);

      if (updateError) {
        console.warn('[Auth] device-session heartbeat failed:', updateError);
      }
    };

    const channel = supabase
      .channel(`device-session-control-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_device_sessions',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const updated = payload.new as { revoked_at?: string | null };
          if (updated.revoked_at) void signOutRevokedSession();
        },
      )
      .subscribe();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void checkAndHeartbeat();
    };

    void checkAndHeartbeat();
    const heartbeat = window.setInterval(() => void checkAndHeartbeat(), 60_000);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, userId, signOut]);

  return null;
}
