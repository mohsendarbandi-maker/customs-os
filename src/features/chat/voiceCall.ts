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

type BroadcastPayload = Record<string, unknown>;

type StartVoiceCallResponse = {
  created: boolean;
  call: VoiceCallRow;
};

export type VoiceCallController = ReturnType<typeof useVoiceCall>;

const isSdpType = (value: string): value is RTCSdpType =>
  value === 'offer' || value === 'answer' || value === 'pranswer' || value === 'rollback';

const callError = (value: unknown) =>
  value instanceof Error ? value.message : 'تماس صوتی برقرار نشد. دوباره تلاش کنید.';

const isTerminal = (status: string) =>
  status === 'rejected' || status === 'cancelled' || status === 'ended' || status === 'missed';

const asRecord = (value: unknown): BroadcastPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
};

const stringValue = (record: BroadcastPayload, key: string): string => {
  const value = record[key];
  return typeof value === 'string' ? value : '';
};

const booleanValue = (record: BroadcastPayload, key: string): boolean | null => {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
};

const parseVoiceCallRow = (value: unknown): VoiceCallRow | null => {
  const record = asRecord(value);
  const id = stringValue(record, 'id');
  const organizationId = stringValue(record, 'organization_id');
  const conversationId = stringValue(record, 'conversation_id');
  const callerId = stringValue(record, 'caller_id');
  const calleeId = stringValue(record, 'callee_id');
  const status = stringValue(record, 'status');

  if (!id || !organizationId || !conversationId || !callerId || !calleeId || !status) return null;

  return {
    id,
    organization_id: organizationId,
    conversation_id: conversationId,
    caller_id: callerId,
    callee_id: calleeId,
    status,
  };
};

const parseStartVoiceCallResponse = (value: unknown): StartVoiceCallResponse | null => {
  const record = asRecord(value);
  const created = booleanValue(record, 'created');
  const call = parseVoiceCallRow(record.call);
  if (created === null || !call) return null;
  return { created, call };
};

const getIceServers = async (): Promise<RTCConfiguration> => {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error('نشست کاربر منقضی شده است. دوباره وارد شوید.');

  const response = await fetch('/api/webrtc/ice', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    cache: 'no-store',
  });

  const payload = asRecord(await response.json().catch(() => ({})));
  const rawIceServers = payload.iceServers;

  if (!response.ok || !Array.isArray(rawIceServers) || rawIceServers.length === 0) {
    const message = stringValue(payload, 'error');
    throw new Error(message || 'تنظیمات ارتباط صوتی دریافت نشد.');
  }

  const iceServers = rawIceServers.filter((value): value is RTCIceServer => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = asRecord(value);
    const urls = record.urls;
    return typeof urls === 'string' || (Array.isArray(urls) && urls.every((url) => typeof url === 'string'));
  });

  if (!iceServers.length) throw new Error('تنظیمات شبکه تماس صوتی معتبر نیست.');
  return { iceServers };
};

const getProfileName = async (userId: string) => {
  const result = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .eq('is_active', true)
    .maybeSingle();

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
  const heartbeatTimerRef = useRef<number | null>(null);
  const incomingPollRef = useRef<number | null>(null);
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
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const cleanupTransport = useCallback(async () => {
    clearTimers();

    try {
      if (callChannelRef.current) {
        await supabase.removeChannel(callChannelRef.current);
      }
    } catch {
      // Transport cleanup must not surface as a second user-facing error.
    }
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
    const result = await supabase
      .from('chat_voice_calls')
      .update({ status })
      .eq('id', id)
      .select('id,status')
      .single();

    if (result.error) throw new Error(result.error.message);
    return result.data;
  }, []);

  const broadcast = useCallback((event: string, payload: BroadcastPayload) => {
    const channel = callChannelRef.current;
    if (!channel) return;
    void channel.send({ type: 'broadcast', event, payload });
  }, []);

  const startHeartbeat = useCallback((id: string) => {
    if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = window.setInterval(() => {
      void updateStatus(id, 'active').catch(() => {});
    }, 20000);
  }, [updateStatus]);

  const setupPeer = useCallback(async (
    row: VoiceCallRow,
    role: 'caller' | 'callee',
    stream: MediaStream,
  ) => {
    if (!userId) throw new Error('کاربر احراز هویت نشده است.');

    const pc = new RTCPeerConnection(await getIceServers());
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
        void updateStatus(row.id, 'active').then(() => startHeartbeat(row.id)).catch(() => startHeartbeat(row.id));
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
      .on('broadcast', { event: 'voice_ready' }, (payload) => {
        if (role !== 'caller' || payload.payload?.call_id !== row.id || !pcRef.current) return;
        void (async () => {
          const peer = pcRef.current;
          if (!peer) return;
          const offer = await peer.createOffer({ offerToReceiveAudio: true });
          await peer.setLocalDescription(offer);
          broadcast('voice_offer', {
            call_id: row.id,
            from_user_id: userId,
            description: peer.localDescription?.toJSON() ?? null,
          });
          setPhase('connecting');
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_offer' }, (payload) => {
        if (role !== 'callee' || payload.payload?.call_id !== row.id || !pcRef.current) return;
        void (async () => {
          const peer = pcRef.current;
          if (!peer) return;
          const descriptionRecord = asRecord(payload.payload?.description);
          const type = stringValue(descriptionRecord, 'type');
          const sdp = stringValue(descriptionRecord, 'sdp');
          if (!type || !sdp) return;
          if (!isSdpType(type)) return;
          await peer.setRemoteDescription({ type, sdp });
          for (const candidate of pendingIceRef.current.splice(0)) await peer.addIceCandidate(candidate);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          broadcast('voice_answer', {
            call_id: row.id,
            from_user_id: userId,
            description: peer.localDescription?.toJSON() ?? null,
          });
          setPhase('connecting');
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_answer' }, (payload) => {
        if (role !== 'caller' || payload.payload?.call_id !== row.id || !pcRef.current) return;
        void (async () => {
          const descriptionRecord = asRecord(payload.payload?.description);
          const type = stringValue(descriptionRecord, 'type');
          const sdp = stringValue(descriptionRecord, 'sdp');
          if (!type || !sdp) return;
          if (!isSdpType(type)) return;
          await pcRef.current?.setRemoteDescription({ type, sdp });
          for (const candidate of pendingIceRef.current.splice(0)) {
            await pcRef.current?.addIceCandidate(candidate);
          }
        })().catch((error) => setErrorState(callError(error)));
      })
      .on('broadcast', { event: 'voice_ice' }, (payload) => {
        const record = asRecord(payload.payload);
        if (stringValue(record, 'call_id') !== row.id || stringValue(record, 'from_user_id') === userId || !pcRef.current) return;

        const candidateRecord = asRecord(record.candidate);
        const candidate = candidateRecord.candidate;
        if (typeof candidate !== 'string' && candidate !== null) return;

        const candidateInit: RTCIceCandidateInit = {
          candidate: typeof candidate === 'string' ? candidate : '',
        };
        const sdpMid = candidateRecord.sdpMid;
        const sdpMLineIndex = candidateRecord.sdpMLineIndex;
        const usernameFragment = candidateRecord.usernameFragment;
        const candidateWithOptionalFields: RTCIceCandidateInit = { ...candidateInit };
        if (typeof sdpMid === 'string' || sdpMid === null) candidateWithOptionalFields.sdpMid = sdpMid;
        if (typeof sdpMLineIndex === 'number' || sdpMLineIndex === null) candidateWithOptionalFields.sdpMLineIndex = sdpMLineIndex;
        if (typeof usernameFragment === 'string' || usernameFragment === null) candidateWithOptionalFields.usernameFragment = usernameFragment;

        void (async () => {
          if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(candidateWithOptionalFields);
          else pendingIceRef.current.push(candidateWithOptionalFields);
        })().catch(() => {});
      })
      .on('broadcast', { event: 'voice_hello' }, (payload) => {
        const record = asRecord(payload.payload);
        if (stringValue(record, 'call_id') !== row.id || stringValue(record, 'from_user_id') === userId) return;
        if (role === 'callee') {
          broadcast('voice_ready', { call_id: row.id, from_user_id: userId });
        }
      })
      .on('broadcast', { event: 'voice_hangup' }, (payload) => {
        const record = asRecord(payload.payload);
        if (stringValue(record, 'call_id') !== row.id) return;
        void updateStatus(row.id, 'ended').catch(() => {});
        void cleanupTransport();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcast('voice_hello', { call_id: row.id, from_user_id: userId });
          if (role === 'callee') {
            broadcast('voice_ready', { call_id: row.id, from_user_id: userId });
          }
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setErrorState('کانال تماس وصل نشد. اتصال اینترنت را بررسی کنید.');
        }
      });

    callChannelRef.current = channel;
  }, [broadcast, cleanupTransport, setPhase, startHeartbeat, updateStatus, userId]);

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

    let stream: MediaStream | null = null;

    try {
      stream = await acquireMicrophone();

      const rpcResult = await supabase.rpc('start_chat_voice_call', {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_callee_id: peerUserId,
      });

      if (rpcResult.error) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(rpcResult.error.message);
      }

      const result = parseStartVoiceCallResponse(rpcResult.data);
      if (!result) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('پاسخ ایجاد تماس معتبر نیست.');
      }

      if (!result.created) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('این مخاطب هم‌اکنون یک تماس فعال با شما دارد. ابتدا همان تماس را پاسخ دهید یا پایان دهید.');
      }

      const row = result.call;
      setCall(row, 'caller', peerName || 'همکار');
      setPhase('outgoing');
      await supabase.realtime.setAuth();
      await setupPeer(row, 'caller', stream);
      stream = null;

      ringTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === 'outgoing' && callRef.current?.id === row.id) {
          void updateStatus(row.id, 'cancelled').catch(() => {});
          broadcast('voice_hangup', { call_id: row.id, from_user_id: userId });
          void cleanupTransport();
        }
      }, 30000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setErrorState(callError(error));
      await cleanupTransport();
    }
  }, [
    acquireMicrophone,
    broadcast,
    cleanupTransport,
    conversationId,
    organizationId,
    peerName,
    peerUserId,
    setCall,
    setPhase,
    setupPeer,
    updateStatus,
    userId,
  ]);

  const acceptIncoming = useCallback(async () => {
    const call = callRef.current;
    if (!call || call.role !== 'callee' || phaseRef.current !== 'incoming') return;

    setErrorState(null);

    try {
      const rowResult = await supabase
        .from('chat_voice_calls')
        .select('id,organization_id,conversation_id,caller_id,callee_id,status')
        .eq('id', call.id)
        .maybeSingle();

      if (rowResult.error) throw new Error(rowResult.error.message);
      const row = parseVoiceCallRow(rowResult.data);
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
    broadcast('voice_hangup', { call_id: call.id, from_user_id: userId || '' });
    await cleanupTransport();
  }, [broadcast, cleanupTransport, updateStatus, userId]);

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

        const acceptInvite = async (incoming: BroadcastPayload) => {
          const incomingId = stringValue(incoming, 'call_id');
          const callerId = stringValue(incoming, 'caller_id');
          const incomingConversationId = stringValue(incoming, 'conversation_id');

          if (!incomingId || !callerId || !incomingConversationId || callerId === userId || disposedRef.current) return;

          if (phaseRef.current !== 'idle') {
            void updateStatus(incomingId, 'rejected').catch(() => {});
            return;
          }

          try {
            const explicitName = stringValue(incoming, 'caller_name');
            const name = explicitName || await getProfileName(callerId);
            const row: VoiceCallRow = {
              id: incomingId,
              organization_id: stringValue(incoming, 'organization_id') || organizationId || '',
              conversation_id: incomingConversationId,
              caller_id: callerId,
              callee_id: userId,
              status: 'ringing',
            };

            setCall(row, 'callee', name);
            setPhase('incoming');

            if ('vibrate' in navigator) navigator.vibrate?.([300, 150, 300, 150, 300]);

            if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(`تماس صوتی از ${name}`, { body: 'برای پاسخ وارد Customs OS شوید.' });
              } catch {
                // Notification permission is optional; the in-app call panel remains authoritative.
              }
            }

            if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
            ringTimerRef.current = window.setTimeout(() => {
              if (phaseRef.current === 'incoming' && callRef.current?.id === incomingId) {
                void updateStatus(incomingId, 'missed').catch(() => {});
                void cleanupTransport();
              }
            }, 45000);
          } catch (error) {
            setErrorState(callError(error));
          }
        };

        channel = supabase
          .channel(`chat-voice-user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'voice_invite' }, (payload) => {
            void acceptInvite(asRecord(payload.payload));
          })
          .on('broadcast', { event: 'voice_status' }, (payload) => {
            const incoming = asRecord(payload.payload);
            const incomingId = stringValue(incoming, 'call_id');
            if (!incomingId || incomingId !== callRef.current?.id) return;

            const status = stringValue(incoming, 'status');
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
          .subscribe(() => {});

        userChannelRef.current = channel;

        const pollIncomingCalls = async () => {
          if (disposedRef.current || phaseRef.current !== 'idle') return;

          const result = await supabase
            .from('chat_voice_calls')
            .select('id,organization_id,conversation_id,caller_id,callee_id,status')
            .eq('callee_id', userId)
            .eq('status', 'ringing')
            .order('created_at', { ascending: false })
            .limit(1);

          if (result.error || !Array.isArray(result.data) || result.data.length === 0) return;

          const row = result.data[0];
          await acceptInvite({
            call_id: row.id,
            organization_id: row.organization_id,
            conversation_id: row.conversation_id,
            caller_id: row.caller_id,
            callee_id: row.callee_id,
            status: row.status,
          });
        };

        void pollIncomingCalls();
        incomingPollRef.current = window.setInterval(() => {
          void pollIncomingCalls();
        }, 4000);
      } catch (error) {
        setErrorState(callError(error));
      }
    })();

    return () => {
      disposedRef.current = true;
      if (incomingPollRef.current !== null) {
        window.clearInterval(incomingPollRef.current);
        incomingPollRef.current = null;
      }
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
