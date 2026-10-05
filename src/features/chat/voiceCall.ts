import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

export type VoicePhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'connected';

type VoiceCallRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: string;
};

export type VoiceCallController = ReturnType<typeof useVoiceCall>;

const voiceTable = () => (supabase as any).from('chat_voice_calls');

const callError = (value: unknown) =>
  value instanceof Error ? value.message : 'تماس صوتی برقرار نشد. دوباره تلاش کنید.';

const isTerminal = (status: string) =>
  status === 'rejected' || status === 'cancelled' || status === 'ended' || status === 'missed';

const buildIceServers = (): RTCConfiguration => {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
  ];

  const turnUrl = String((import.meta as any).env?.VITE_WEBRTC_TURN_URL || '').trim();
  const turnUsername = String((import.meta as any).env?.VITE_WEBRTC_TURN_USERNAME || '').trim();
  const turnCredential = String((import.meta as any).env?.VITE_WEBRTC_TURN_CREDENTIAL || '').trim();

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }

  return { iceServers: servers };
};

const getProfileName = async (userId: string) => {
  const result = await supabase.from('profiles').select('full_name').eq('id', userId).eq('is_active', true).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data?.full_name || 'همکار';
};

export function useVoiceCall({
  userId,
  organizationId,
  conversationId,
  peerUserId,
  peerName,
}: {
  userId: string | undefined;
  organizationId: string | null | undefined;
  conversationId: string | null;
  peerUserId: string | null | undefined;
  peerName: string;
}) {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [callId, setCallIdState] = useState<string | null>(null);
  const [remoteUserId, setRemoteUserIdState] = useState<string | null>(null);
  const [remoteName, setRemoteNameState] = useState('همکار');
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  const phaseRef = useRef<VoicePhase>('idle');
  const callRef = useRef<{ id: string; conversationId: string; remoteUserId: string; role: 'caller' | 'callee' } | null>(null);
  const userChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const callChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setCall = useCallback((row: VoiceCallRow, role: 'caller' | 'callee', name: string) => {
    const remoteId = role === 'caller' ? row.callee_id : row.caller_id;
    callRef.current = {
      id: row.id,
      conversationId: row.conversation_id,
      remoteUserId: remoteId,
      role,
    };
    setCallIdState(row.id);
    setRemoteUserIdState(remoteId);
    setRemoteNameState(name);
  }, []);

  const clearTimers = useCallback(() => {
    if (ringTimerRef.current !== null) {
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (disconnectTimerRef.current !== null) {
      window.clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const cleanupTransport = useCallback(async () => {
    clearTimers();
    try {
      if (callChannelRef.current) {
        await supabase.removeChannel(callChannelRef.current);
      }
    } catch {}
    callChannelRef.current = null;

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    }
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    pendingIceRef.current = [];
    setMuted(false);
    setAudioBlocked(false);
    setCallIdState(null);
    setRemoteUserIdState(null);
    setRemoteNameState('همکار');
    callRef.current = null;
    setPhase('idle');
  }, [clearTimers, setPhase]);

  const updateStatus = useCallback(async (id: string, status: string) => {
    const result = await voiceTable().update({ status }).eq('id', id).select('id,status').single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }, []);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = callChannelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event, payload });
  }, []);

  const setupPeer = useCallback(async (
    row: VoiceCallRow,
    role: 'caller' | 'callee',
    stream: MediaStream,
  ) => {
    if (!userId) throw new Error('کاربر احراز هویت نشده است.');

    const pc = new RTCPeerConnection(buildIceServers());
    pcRef.current = pc;
    localStreamRef.current = stream;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      broadcast('voice_ice', {
        call_id: row.id,
        from_user_id: userId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      const audio = remoteAudioRef.current;
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      if (!audio) return;
      audio.srcObject = remoteStream;
      audio.muted = false;
      void audio.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        if (disconnectTimerRef.current !== null) {
          window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setPhase('connected');
        void updateStatus(row.id, 'active').catch(() => {});
      } else if (state === 'disconnected') {
        if (disconnectTimerRef.current === null) {
          disconnectTimerRef.current = window.setTimeout(() => {
            if (pc.connectionState === 'disconnected') {
              void updateStatus(row.id, 'ended').catch(() => {});
              void cleanupTransport();
            }
          }, 7000);
        }
      } else if (state === 'failed' || state === 'closed') {
        void updateStatus(row.id, 'ended').catch(() => {});
        void cleanupTransport();
      }
    };

    const channel = supabase
      .channel(`voice:${row.id}`, { config: { private: true } })
      .on('broadcast', { event: 'voice_ready' }, () => {
        if (role !== 'caller' || !pcRef.current || pcRef.current.localDescription) return;
        void (async () => {
          const peer = pcRef.current;
          if (!peer) return;
          const offer = await peer.createOffer({ offerToReceiveAudio: true });
          await peer.setLocalDescription(offer);
          broadcast('voice_offer', {
            call_id: row.id,
            from_user_id: userId,
            description: peer.localDescription,
          });
          setPhase('connecting');
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_offer' }, (payload) => {
        if (role !== 'callee' || payload.payload?.call_id !== row.id || !pcRef.current) return;
        void (async () => {
          const peer = pcRef.current;
          if (!peer) return;
          const description = payload.payload?.description as RTCSessionDescriptionInit | undefined;
          if (!description) return;
          await peer.setRemoteDescription(description);
          for (const candidate of pendingIceRef.current.splice(0)) await peer.addIceCandidate(candidate);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          broadcast('voice_answer', {
            call_id: row.id,
            from_user_id: userId,
            description: peer.localDescription,
          });
          setPhase('connecting');
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_answer' }, (payload) => {
        if (role !== 'caller' || payload.payload?.call_id !== row.id || !pcRef.current) return;
        void (async () => {
          const description = payload.payload?.description as RTCSessionDescriptionInit | undefined;
          if (!description) return;
          await pcRef.current?.setRemoteDescription(description);
          for (const candidate of pendingIceRef.current.splice(0)) {
            await pcRef.current?.addIceCandidate(candidate);
          }
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_ice' }, (payload) => {
        if (payload.payload?.call_id !== row.id || payload.payload?.from_user_id === userId || !pcRef.current) return;
        const candidate = payload.payload?.candidate as RTCIceCandidateInit | undefined;
        if (!candidate) return;
        void (async () => {
          if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(candidate);
          else pendingIceRef.current.push(candidate);
        })().catch(() => {});
      })
      .on('broadcast', { event: 'voice_hangup' }, (payload) => {
        if (payload.payload?.call_id !== row.id) return;
        void cleanupTransport();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && role === 'callee') {
          broadcast('voice_ready', { call_id: row.id, from_user_id: userId });
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setErrorState('کانال تماس وصل نشد. اتصال اینترنت را بررسی کنید.');
        }
      });

    callChannelRef.current = channel;
  }, [broadcast, cleanupTransport, setPhase, updateStatus, userId]);

  const acquireMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('مرورگر این دستگاه از دسترسی زنده به میکروفن پشتیبانی نمی‌کند.');
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  }, []);

  const startCall = useCallback(async () => {
    if (phaseRef.current !== 'idle' || !userId || !organizationId || !conversationId || !peerUserId) return;

    setErrorState(null);
    try {
      const stream = await acquireMicrophone();

      const result = await voiceTable()
        .insert({
          organization_id: organizationId,
          conversation_id: conversationId,
          caller_id: userId,
          callee_id: peerUserId,
          status: 'ringing',
        })
        .select('*')
        .single();

      if (result.error || !result.data) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(result.error?.message || 'تماس دیگری در حال برقراری است.');
      }

      const row = result.data as VoiceCallRow;
      setCall(row, 'caller', peerName || 'همکار');
      setPhase('outgoing');
      await supabase.realtime.setAuth();
      await setupPeer(row, 'caller', stream);

      ringTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === 'outgoing' && callRef.current?.id === row.id) {
          void updateStatus(row.id, 'cancelled').catch(() => {});
          void cleanupTransport();
        }
      }, 30000);
    } catch (error) {
      setErrorState(callError(error));
      await cleanupTransport();
    }
  }, [acquireMicrophone, cleanupTransport, conversationId, organizationId, peerName, peerUserId, setCall, setPhase, setupPeer, updateStatus, userId]);

  const acceptIncoming = useCallback(async () => {
    const call = callRef.current;
    if (!call || call.role !== 'callee' || phaseRef.current !== 'incoming') return;

    setErrorState(null);
    try {
      const rowResult = await voiceTable().select('*').eq('id', call.id).maybeSingle();
      if (rowResult.error) throw new Error(rowResult.error.message);
      const row = rowResult.data as VoiceCallRow | null;
      if (!row || row.status !== 'ringing') throw new Error('این تماس دیگر فعال نیست.');

      await updateStatus(row.id, 'accepted');
      const stream = await acquireMicrophone();
      setPhase('connecting');
      await supabase.realtime.setAuth();
      await setupPeer(row, 'callee', stream);
      clearTimers();
    } catch (error) {
      setErrorState(callError(error));
      await updateStatus(call.id, 'rejected').catch(() => {});
      await cleanupTransport();
    }
  }, [acquireMicrophone, cleanupTransport, clearTimers, setPhase, setupPeer, updateStatus]);

  const rejectIncoming = useCallback(async () => {
    const call = callRef.current;
    if (!call || call.role !== 'callee') return;
    setErrorState(null);
    await updateStatus(call.id, 'rejected').catch((error) => setErrorState(callError(error)));
    await cleanupTransport();
  }, [cleanupTransport, updateStatus]);

  const hangup = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    const status = phaseRef.current === 'outgoing' ? 'cancelled' : 'ended';
    broadcast('voice_hangup', { call_id: call.id, from_user_id: userId || '' });
    await updateStatus(call.id, status).catch((error) => setErrorState(callError(error)));
    await cleanupTransport();
  }, [broadcast, cleanupTransport, updateStatus, userId]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const resumeRemoteAudio = useCallback(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;
    void audio.play().then(() => setAudioBlocked(false)).catch(() => {});
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    if (!userId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      try {
        await supabase.realtime.setAuth();
        channel = supabase
          .channel(`chat-voice-user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'voice_invite' }, (payload) => {
            const incoming = payload.payload as Record<string, unknown>;
            const incomingId = String(incoming.call_id || '');
            const callerId = String(incoming.caller_id || '');
            const incomingConversationId = String(incoming.conversation_id || '');
            if (!incomingId || !callerId || !incomingConversationId || callerId === userId || disposedRef.current) return;
            if (phaseRef.current !== 'idle') {
              void updateStatus(incomingId, 'rejected').catch(() => {});
              return;
            }

            void (async () => {
              try {
                const name = String(incoming.caller_name || await getProfileName(callerId));
                const row: VoiceCallRow = {
                  id: incomingId,
                  organization_id: String(incoming.organization_id || organizationId || ''),
                  conversation_id: incomingConversationId,
                  caller_id: callerId,
                  callee_id: userId,
                  status: 'ringing',
                };
                setCall(row, 'callee', name);
                setPhase('incoming');
                if ('vibrate' in navigator) {
                  navigator.vibrate?.([300, 150, 300, 150, 300]);
                }
                if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
                  try {
                    new Notification(`تماس صوتی از ${name}`, { body: 'برای پاسخ وارد Customs OS شوید.' });
                  } catch {}
                }

                ringTimerRef.current = window.setTimeout(() => {
                  if (phaseRef.current === 'incoming' && callRef.current?.id === incomingId) {
                    void updateStatus(incomingId, 'missed').catch(() => {});
                    void cleanupTransport();
                  }
                }, 45000);
              } catch (error) {
                setErrorState(callError(error));
              }
            })();
          })
          .on('broadcast', { event: 'voice_status' }, (payload) => {
            const incoming = payload.payload as Record<string, unknown>;
            const incomingId = String(incoming.call_id || '');
            if (!incomingId || incomingId !== callRef.current?.id) return;
            const status = String(incoming.status || '');
            if (status === 'accepted' && phaseRef.current === 'outgoing') {
              setPhase('connecting');
            }
            if (isTerminal(status)) {
              setErrorState(
                status === 'rejected'
                  ? 'تماس رد شد.'
                  : status === 'cancelled'
                    ? 'تماس لغو شد.'
                    : status === 'missed'
                      ? 'تماس بی‌پاسخ ماند.'
                      : 'تماس پایان یافت.',
              );
              void cleanupTransport();
            }
          })
          .subscribe((status) => {
            if (status !== 'SUBSCRIBED' && status !== 'TIMED_OUT' && status !== 'CHANNEL_ERROR') return;
          });

        userChannelRef.current = channel;
      } catch (error) {
        setErrorState(callError(error));
      }
    })();

    return () => {
      disposedRef.current = true;
      if (channel) void supabase.removeChannel(channel);
      userChannelRef.current = null;
      if (callRef.current) {
        void updateStatus(callRef.current.id, phaseRef.current === 'outgoing' ? 'cancelled' : 'ended').catch(() => {});
      }
      void cleanupTransport();
    };
  }, [cleanupTransport, organizationId, setCall, setPhase, updateStatus, userId]);

  const selectConversationPeer = useMemo(() => ({
    canCall: phase === 'idle' && Boolean(conversationId && peerUserId && peerUserId !== userId),
  }), [conversationId, peerUserId, phase, userId]);

  return {
    phase,
    callId,
    remoteName,
    remoteUserId,
    muted,
    audioBlocked,
    error,
    clearError: () => setErrorState(null),
    startCall,
    acceptIncoming,
    rejectIncoming,
    hangup,
    toggleMute,
    resumeRemoteAudio,
    remoteAudioRef,
    canCall: selectConversationPeer.canCall,
  };
}
