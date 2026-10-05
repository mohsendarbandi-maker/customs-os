import React from 'react';
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Volume2 } from 'lucide-react';
import type { VoiceCallController, VoicePhase } from './voiceCall';

const phaseText = (phase: VoicePhase) => {
  if (phase === 'incoming') return 'تماس صوتی ورودی';
  if (phase === 'outgoing') return 'در حال تماس…';
  if (phase === 'connecting') return 'در حال اتصال صوت…';
  if (phase === 'connected') return 'تماس صوتی';
  return '';
};

export const VoiceCallPanel: React.FC<{ controller: VoiceCallController }> = ({ controller }) => {
  const {
    phase,
    remoteName,
    muted,
    audioBlocked,
    hangup,
    acceptIncoming,
    rejectIncoming,
    toggleMute,
    resumeRemoteAudio,
    remoteAudioRef,
  } = controller;

  if (phase === 'idle') return null;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />
      <div
        dir="rtl"
        className="fixed z-[800] inset-x-3 top-[calc(12px+env(safe-area-inset-top))] md:inset-x-auto md:right-5 md:top-5 md:w-[390px] rounded-3xl border shadow-2xl overflow-hidden chat-call-panel bg-[var(--surface)] text-[var(--text)] border-[var(--border)]"
      >
        <div className="p-5 md:p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-[var(--primary)] text-white grid place-items-center shadow-lg">
              {phase === 'incoming' ? <PhoneCall size={28} /> : <Phone size={28} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm app-muted">{phaseText(phase)}</div>
              <div className="text-xl font-black truncate mt-1">{remoteName}</div>
              <div className="text-xs app-muted mt-1">
                {phase === 'incoming' ? 'آماده پاسخ‌گویی است' : phase === 'connected' ? 'ارتباط زنده برقرار است' : 'لطفاً منتظر بمانید…'}
              </div>
            </div>
          </div>

          {audioBlocked && (
            <button
              type="button"
              onClick={resumeRemoteAudio}
              className="mt-4 w-full min-h-12 rounded-2xl border border-amber-300/70 bg-amber-50 text-amber-900 px-4 flex items-center gap-2 justify-center font-bold text-sm"
            >
              <Volume2 size={18} />
              فعال‌کردن صدای تماس
            </button>
          )}

          {phase === 'incoming' ? (
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                type="button"
                onClick={()=>void rejectIncoming()}
                className="min-h-14 rounded-2xl bg-red-600 text-white font-black flex items-center justify-center gap-2"
              >
                <PhoneOff size={20} />
                رد تماس
              </button>
              <button
                type="button"
                onClick={()=>void acceptIncoming()}
                className="min-h-14 rounded-2xl bg-emerald-600 text-white font-black flex items-center justify-center gap-2"
              >
                <Phone size={20} />
                پاسخ
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 mt-5">
              {phase === 'connected' && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={"h-14 w-14 rounded-full border flex items-center justify-center " + (muted ? "bg-red-600 text-white border-red-600" : "border-black/10")}
                  aria-label={muted ? 'فعال‌کردن میکروفن' : 'قطع میکروفن'}
                >
                  {muted ? <MicOff size={21} /> : <Mic size={21} />}
                </button>
              )}
              <button
                type="button"
                onClick={()=>void hangup()}
                className="h-16 w-16 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg"
                aria-label="پایان تماس"
              >
                <PhoneOff size={24} />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
