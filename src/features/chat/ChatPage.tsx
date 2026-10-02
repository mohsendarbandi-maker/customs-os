import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  File,
  Image as ImageIcon,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { chatApi, uploadChatFile, broadcastTyping, type UploadHandle } from './api';
import { compressImage, formatFileSizeFa, inspectFileMagic, sanitizeFileName, toPersianDigits } from './utils';
import type { ChatAttachment, ChatConversation, ChatMessage, PendingSend } from './types';
import { useAuth } from '../../context/AuthContext';

type QueueFile = {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'sent' | 'error';
  error?: string;
  handle?: UploadHandle;
};

const formatTimeFa = (iso: string): string =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const friendlyError = (error: unknown): string => {
  const value = String(error instanceof Error ? error.message : error);
  if (/network|fetch|offline|connection/i.test(value)) return 'اتصال اینترنت در دسترس نیست.';
  if (/permission|unauthor|اجازه/i.test(value)) return 'اجازه انجام این عملیات را ندارید.';
  if (/مهلت حذف/i.test(value)) return 'مهلت حذف این پیام گذشته است.';
  return 'انجام عملیات ممکن نشد.';
};

const messageLabel = (message: ChatMessage): string => {
  if (message.message_type === 'voice') return 'پیام صوتی';
  if (message.message_type === 'file') return 'فایل';
  return message.body ?? '';
};

const StatusIcon: React.FC<{ status: ChatMessage['delivery_status'] }> = ({ status }) => {
  if (status === 'read') return <CheckCheck size={14} aria-label="خوانده‌شده" />;
  if (status === 'delivered') return <CheckCheck size={14} aria-label="تحویل‌شده" />;
  if (status === 'sent') return <Check size={14} aria-label="ارسال‌شده" />;
  if (status === 'failed') return <X size={13} aria-label="خطا" />;
  return <span className="text-[9px]">در انتظار</span>;
};

const MessageMenu: React.FC<{
  mine: boolean;
  onStar: () => void;
  onDeleteMe: () => void;
  onDeleteAll: () => void;
  onClose: () => void;
}> = ({ mine, onStar, onDeleteMe, onDeleteAll, onClose }) => (
  <div
    className="absolute z-30 top-1 left-1 w-44 rounded-2xl border app-border bg-[var(--surface)] p-1 shadow-2xl"
    role="menu"
  >
    <button className="app-nav-item w-full !min-h-10" onClick={() => { onClose(); onStar(); }}>
      <Star size={15} />
      <span>ستاره‌دار کردن</span>
    </button>
    <button className="app-nav-item w-full !min-h-10" onClick={() => { onClose(); onDeleteMe(); }}>
      <Trash2 size={15} />
      <span>حذف برای من</span>
    </button>
    {mine && (
      <button className="app-nav-item w-full !min-h-10" onClick={() => { onClose(); onDeleteAll(); }}>
        <Trash2 size={15} />
        <span>حذف برای همه</span>
      </button>
    )}
  </div>
);

const MessageBubble: React.FC<{
  message: ChatMessage;
  mine: boolean;
  attachment?: ChatAttachment;
  pending?: PendingSend;
  onStar: () => void;
  onDeleteMe: () => void;
  onDeleteAll: () => void;
  onOpenFile: () => void;
}> = ({ message, mine, attachment, pending, onStar, onDeleteMe, onDeleteAll, onOpenFile }) => {
  const [menu, setMenu] = useState(false);
  const body = messageLabel(message);

  return (
    <div id={'chat-msg-' + message.id} className={'flex px-2 md:px-5 ' + (mine ? 'justify-start' : 'justify-end')}>
      <div className="relative max-w-[90%] md:max-w-[72%]">
        <div className={'rounded-3xl border app-border px-4 py-3 shadow-sm ' + (mine ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface)]')}>
          {attachment && (
            <button
              className="mb-2 w-full min-w-[220px] rounded-2xl border border-white/20 bg-black/5 p-3 text-right"
              onClick={onOpenFile}
              disabled={attachment.security_status !== 'clean'}
            >
              <div className="flex items-center gap-2">
                {attachment.mime_type.startsWith('image/') ? <ImageIcon size={18} /> : <File size={18} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{attachment.original_name}</div>
                  <div className="text-[10px] opacity-70">{formatFileSizeFa(attachment.size_bytes)}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] opacity-80">
                {attachment.security_status === 'clean'
                  ? 'فایل سالم و آماده مشاهده'
                  : attachment.security_status === 'blocked'
                    ? 'فایل مسدود شد'
                    : 'فایل در حال بررسی امنیتی است'}
              </div>
            </button>
          )}
          {!attachment && body && (
            <div className="whitespace-pre-wrap break-words text-sm leading-7">{body}</div>
          )}
          <div className="mt-2 flex items-center justify-end gap-2 text-[10px] opacity-70">
            {message.edited_at && <span>ویرایش‌شده</span>}
            {pending?.queued && <span>در انتظار اتصال</span>}
            <span>{formatTimeFa(message.created_at)}</span>
            {mine && <StatusIcon status={message.delivery_status} />}
            <button
              type="button"
              className="min-h-8 min-w-8 rounded-full flex items-center justify-center hover:bg-black/10"
              aria-label="عملیات پیام"
              onClick={() => setMenu((value) => !value)}
            >
              <MoreVertical size={14} />
            </button>
          </div>
        </div>
        {menu && (
          <MessageMenu
            mine={mine}
            onStar={onStar}
            onDeleteMe={onDeleteMe}
            onDeleteAll={onDeleteAll}
            onClose={() => setMenu(false)}
          />
        )}
      </div>
    </div>
  );
};

const QueueList: React.FC<{
  items: QueueFile[];
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}> = ({ items, onCancel, onRemove }) => {
  if (!items.length) return null;
  return (
    <div className="px-3 pb-2 space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border app-border bg-[var(--surface)] p-2">
          <div className="flex items-center gap-2">
            <File size={15} />
            <div className="min-w-0 flex-1 truncate text-xs">{item.file.name}</div>
            <span className="text-[10px] app-muted">{toPersianDigits(item.progress)}٪</span>
            {item.status === 'uploading' && (
              <button className="min-h-9 min-w-9 rounded-full" onClick={() => onCancel(item.id)} aria-label="لغو آپلود">
                <X size={14} />
              </button>
            )}
            {(item.status === 'sent' || item.status === 'error') && (
              <button className="min-h-9 min-w-9 rounded-full" onClick={() => onRemove(item.id)} aria-label="بستن">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-black/10">
            <div className="h-full bg-[var(--primary)]" style={{ width: String(item.progress) + '%' }} />
          </div>
          {item.error && <div className="mt-1 text-[10px] text-red-500">{item.error}</div>}
        </div>
      ))}
    </div>
  );
};

export const ChatPage: React.FC = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'group' | 'company_channel'>('group');
  const [showNew, setShowNew] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);

  const conversations = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: chatApi.conversations,
    staleTime: 5000,
  });

  const active = useMemo<ChatConversation | null>(
    () => conversations.data?.find((item) => item.conversation_id === selectedId) ?? null,
    [conversations.data, selectedId],
  );

  const messages = useQuery({
    queryKey: ['chat-messages', selectedId],
    queryFn: () => chatApi.messages(selectedId as string),
    enabled: Boolean(selectedId),
    staleTime: 2000,
  });

  const attachments = useQuery({
    queryKey: ['chat-attachments', messages.data?.map((item) => item.id).join(',')],
    queryFn: () => chatApi.attachments((messages.data ?? []).map((item) => item.id)),
    enabled: Boolean(messages.data?.length),
    staleTime: 3000,
  });

  const searchResults = useQuery({
    queryKey: ['chat-search', search],
    queryFn: () => chatApi.search(search),
    enabled: search.trim().length >= 2,
    staleTime: 5000,
  });

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] }),
      selectedId
        ? queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedId] })
        : Promise.resolve(),
    ]);
  }, [queryClient, selectedId]);

  useEffect(() => {
    if (!selectedId || !user?.id) return;
    void chatApi.focus(selectedId);
    return () => { void chatApi.focus(null); };
  }, [selectedId, user?.id]);

  useEffect(() => {
    if (!selectedId || !user?.id) return;
    const stop = chatApi.subscribeToConversation(selectedId, user.id, {
      onMessage: () => { void refresh(); },
      onTyping: (payload: unknown) => {
        const value = payload as { userId?: string; typing?: boolean };
        if (value.userId === user.id) return;
        setTypingUser(value.typing ? value.userId ?? 'کاربر' : null);
      },
      onPresence: (state) => {
        setOnlineCount(Object.keys(state).length);
      },
    });
    return stop;
  }, [selectedId, user?.id, refresh]);

  useEffect(() => {
    if (!selectedId || !messages.data?.length || !user?.id) return;
    const last = messages.data[messages.data.length - 1];
    if (last.sender_id !== user.id) {
      void chatApi.markRead(selectedId, last.id).then(refresh).catch(() => undefined);
    }
  }, [selectedId, messages.data, user?.id, refresh]);

  useEffect(() => {
    if (!selectedId || !messages.data?.length) return;
    let alive = true;
    void chatApi.firstUnread(selectedId).then((id) => {
      if (!alive || !id) return;
      const node = document.getElementById('chat-msg-' + id);
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [selectedId, messages.data]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const shouldStick = node.scrollHeight - node.scrollTop - node.clientHeight < 180;
    if (shouldStick) node.scrollTop = node.scrollHeight;
  }, [messages.data?.length]);

  const sendMutation = useMutation({
    mutationFn: async (body: string): Promise<{ body: string; queued: boolean }> => {
      const clientUuid = crypto.randomUUID();
      const optimistic: PendingSend = {
        clientUuid,
        body,
        createdAt: new Date().toISOString(),
        queued: !navigator.onLine,
      };
      setPending((items) => items.concat(optimistic));
      const result = await chatApi.sendMessage({
        conversationId: selectedId as string,
        clientUuid,
        messageType: 'text',
        body,
      });
      if (result.error) throw result.error;
      return { body, queued: result.queued };
    },
    onSuccess: () => {
      setDraft('');
      setPending((items) => items.slice(1));
      void refresh();
    },
    onError: (error) => {
      setPending((items) => items.slice(1));
      window.alert(friendlyError(error));
    },
  });

  const setTyping = (value: boolean): void => {
    if (!selectedId || !user?.id) return;
    void broadcastTyping(selectedId, user.id, value);
  };

  const onDraftChange = (value: string): void => {
    setDraft(value);
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 1000);
  };

  const removeForMe = async (id: string): Promise<void> => {
    try {
      await chatApi.deleteForMe(id);
      await refresh();
    } catch (error) {
      window.alert(friendlyError(error));
    }
  };

  const removeForAll = async (id: string): Promise<void> => {
    try {
      await chatApi.deleteForAll(id);
      await refresh();
    } catch (error) {
      window.alert(friendlyError(error));
    }
  };

  const openAttachment = async (attachment: ChatAttachment): Promise<void> => {
    if (attachment.security_status !== 'clean') return;
    try {
      const url = await chatApi.signedUrl(attachment.storage_path, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      window.alert(friendlyError(error));
    }
  };

  const handleFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    if (!selectedId || !profile?.organization_id || !user?.id) return;
    for (const raw of Array.from(files)) {
      let file = raw;
      try {
        file = await compressImage(raw);
        const check = await inspectFileMagic(file);
        if (!check.ok || file.size > 50 * 1024 * 1024) {
          setFileQueue((items) => items.concat({
            id: crypto.randomUUID(),
            file,
            progress: 0,
            status: 'error',
            error: check.reason ?? 'حجم فایل بیش از ۵۰ مگابایت است.',
          }));
          continue;
        }

        const queueId = crypto.randomUUID();
        setFileQueue((items) => items.concat({
          id: queueId,
          file,
          progress: 0,
          status: 'uploading',
        }));

        const clientUuid = crypto.randomUUID();
        const message = await chatApi.sendMessage({
          conversationId: selectedId,
          clientUuid,
          messageType: 'file',
          body: null,
        });
        if (message.error || !message.data) {
          throw message.error ?? new Error('ثبت پیام فایل ناموفق بود.');
        }

        const handle = uploadChatFile(
          file,
          profile.organization_id,
          selectedId,
          (progress) => {
            setFileQueue((items) => items.map((item) =>
              item.id === queueId ? { ...item, progress } : item,
            ));
          },
        );
        setFileQueue((items) => items.map((item) =>
          item.id === queueId ? { ...item, handle } : item,
        ));

        const path = await handle.promise;
        await chatApi.registerAttachment({
          conversationId: selectedId,
          messageId: (message.data as ChatMessage).id,
          storagePath: path,
          originalName: sanitizeFileName(file.name),
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });

        setFileQueue((items) => items.map((item) =>
          item.id === queueId ? { ...item, progress: 100, status: 'sent' } : item,
        ));
        await refresh();
      } catch (error) {
        setFileQueue((items) => items.map((item) =>
          item.id === (files.length === 1 ? item.id : item.id) ? { ...item, status: 'error', error: friendlyError(error) } : item,
        ));
      }
    }
  }, [profile?.organization_id, selectedId, user?.id, refresh]);

  const cancelUpload = (id: string): void => {
    const item = fileQueue.find((value) => value.id === id);
    item?.handle?.cancel();
    setFileQueue((items) => items.filter((value) => value.id !== id));
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (!selectedId || !event.clipboardData) return;
      const image = Array.from(event.clipboardData.items)
        .map((item) => item.type.startsWith('image/') ? item.getAsFile() : null)
        .find((value): value is File => Boolean(value));
      if (image) void handleFiles([image]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles, selectedId]);

  const createConversation = async (): Promise<void> => {
    if (!newTitle.trim()) return;
    try {
      const created = await chatApi.createConversation({ type: newType, title: newTitle.trim() });
      setNewTitle('');
      setShowNew(false);
      setParams({ conversation: created.conversation_id });
      await conversations.refetch();
    } catch (error) {
      window.alert(friendlyError(error));
    }
  };

  const visibleConversations = useMemo(() => {
    const source = conversations.data ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return source;
    return source.filter((item) => (item.title ?? '').toLowerCase().includes(query));
  }, [conversations.data, search]);

  return (
    <div
      dir="rtl"
      className="h-[calc(100vh-120px)] min-h-[620px] overflow-hidden rounded-3xl border app-border bg-[var(--surface)] shadow-sm flex"
    >
      <aside className={selectedId ? 'hidden md:flex w-full md:w-[310px] shrink-0 border-l app-border flex-col' : 'flex w-full md:w-[310px] shrink-0 border-l app-border flex-col'}>
        <div className="p-3 border-b app-border">
          <div className="flex items-center gap-2">
            <div className="font-black">چت سازمانی</div>
            <div className="flex-1" />
            <button
              className="min-h-11 min-w-11 rounded-2xl bg-[var(--primary)] text-white flex items-center justify-center"
              onClick={() => setShowNew(true)}
              aria-label="گفتگوی جدید"
            >
              <Plus size={18} />
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-2xl border app-border px-3 min-h-11">
            <Search size={16} className="app-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جست‌وجوی گفتگو، پیام، فایل یا شخص"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </label>
        </div>

        {search.trim().length >= 2 && searchResults.data && (
          <div className="max-h-56 overflow-y-auto border-b app-border">
            {searchResults.data.map((result) => (
              <button
                key={result.kind + result.id + result.conversation_id}
                className="w-full text-right px-3 py-2 border-b app-border hover:bg-black/5"
                onClick={() => {
                  setParams({ conversation: result.conversation_id });
                  setSearch('');
                }}
              >
                <div className="text-xs font-bold">{result.title}</div>
                <div className="text-[11px] app-muted truncate">{result.snippet}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {conversations.isLoading && (
            <div className="p-4 space-y-3">
              <div className="h-16 rounded-2xl bg-black/5 animate-pulse" />
              <div className="h-16 rounded-2xl bg-black/5 animate-pulse" />
            </div>
          )}

          {!conversations.isLoading && visibleConversations.length === 0 && (
            <div className="p-8 text-center app-muted text-sm">گفتگویی برای نمایش وجود ندارد.</div>
          )}

          {visibleConversations.map((item) => (
            <button
              key={item.conversation_id}
              className={'w-full text-right p-3 border-b app-border min-h-20 hover:bg-black/5 ' + (item.conversation_id === selectedId ? 'bg-black/5' : '')}
              onClick={() => setParams({ conversation: item.conversation_id })}
            >
              <div className="flex items-center gap-2">
                <div className="w-11 h-11 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
                  <Users size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">{item.title ?? 'مکالمه بدون عنوان'}</div>
                  <div className="text-[11px] app-muted truncate">{item.last_message_body ?? 'هنوز پیامی ثبت نشده است'}</div>
                </div>
                {item.unread_count > 0 && (
                  <span className="min-w-6 h-6 px-1 rounded-full bg-[var(--primary)] text-white text-[11px] flex items-center justify-center">
                    {toPersianDigits(item.unread_count)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className={selectedId ? 'flex flex-1 min-w-0 flex-col' : 'hidden md:flex flex-1 min-w-0 flex-col'}>
        {!active ? (
          <div className="m-auto text-center app-muted">
            <Users className="mx-auto mb-3" size={42} />
            <div>یک گفتگو را انتخاب کنید.</div>
          </div>
        ) : (
          <>
            <header className="min-h-16 border-b app-border px-3 md:px-5 flex items-center gap-3">
              <button
                className="md:hidden min-h-11 min-w-11 rounded-xl border app-border"
                onClick={() => navigate(location.pathname)}
                aria-label="بازگشت"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="w-10 h-10 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center">
                <Users size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-black truncate">{active.title ?? 'مکالمه'}</div>
                <div className="text-[10px] app-muted">
                  {toPersianDigits(onlineCount)} نفر آنلاین
                  {typingUser ? ' • در حال نوشتن…' : ''}
                </div>
              </div>
              <button
                className="min-h-11 min-w-11 rounded-xl border app-border"
                onClick={() => setShowDetails((value) => !value)}
                aria-label="جزئیات"
              >
                <Users size={17} />
              </button>
            </header>

            <div ref={messageListRef} className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2">
              {messages.isLoading && (
                <div className="space-y-2 px-4">
                  <div className="h-10 w-2/3 rounded-3xl bg-black/5 animate-pulse" />
                  <div className="h-12 w-1/2 rounded-3xl bg-black/5 animate-pulse" />
                </div>
              )}

              {messages.data?.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.sender_id === user?.id}
                  pending={pending.find((item) => item.clientUuid === message.client_uuid)}
                  attachment={attachments.data?.find((item) => item.message_id === message.id)}
                  onStar={() => void chatApi.star(message.id).then(refresh).catch(() => undefined)}
                  onDeleteMe={() => void removeForMe(message.id)}
                  onDeleteAll={() => void removeForAll(message.id)}
                  onOpenFile={() => {
                    const attachment = attachments.data?.find((item) => item.message_id === message.id);
                    if (attachment) void openAttachment(attachment);
                  }}
                />
              ))}

              {pending.map((item) => (
                <div key={item.clientUuid} className="flex justify-start px-2 md:px-5">
                  <div className="max-w-[90%] md:max-w-[72%] rounded-3xl border app-border bg-[var(--primary)]/10 px-4 py-3 text-sm">
                    <div className="whitespace-pre-wrap break-words">{item.body}</div>
                    <div className="mt-1 text-[10px] app-muted">{item.queued ? 'در انتظار اتصال' : 'در حال ارسال'}</div>
                  </div>
                </div>
              ))}

              <div className="h-2" />
            </div>

            <div
              className="border-t app-border bg-[var(--surface)]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFiles(event.dataTransfer.files);
              }}
            >
              <QueueList
                items={fileQueue}
                onCancel={cancelUpload}
                onRemove={(id) => setFileQueue((items) => items.filter((item) => item.id !== id))}
              />

              <div className="p-2 md:p-3 flex items-end gap-2">
                <input
                  id="chat-files"
                  type="file"
                  multiple
                  accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void handleFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <label
                  htmlFor="chat-files"
                  className="min-h-12 min-w-12 rounded-2xl border app-border flex items-center justify-center cursor-pointer"
                  title="افزودن فایل"
                >
                  <Paperclip size={19} />
                </label>

                <input
                  id="chat-camera"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void handleFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <label
                  htmlFor="chat-camera"
                  className="min-h-12 min-w-12 rounded-2xl border app-border hidden sm:flex items-center justify-center cursor-pointer"
                  title="دوربین"
                >
                  <ImageIcon size={19} />
                </label>

                <textarea
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      const value = draft.trim();
                      if (value && !sendMutation.isPending) void sendMutation.mutateAsync(value).catch(() => undefined);
                    }
                  }}
                  placeholder="پیام خود را بنویسید…"
                  rows={1}
                  className="min-h-12 max-h-36 resize-none flex-1 rounded-2xl border app-border bg-transparent px-4 py-3 text-sm outline-none"
                />

                <button
                  disabled={!draft.trim() || sendMutation.isPending}
                  onClick={() => {
                    const value = draft.trim();
                    if (value) void sendMutation.mutateAsync(value).catch(() => undefined);
                  }}
                  className="min-h-12 min-w-12 rounded-2xl bg-[var(--primary)] text-white disabled:opacity-40 flex items-center justify-center"
                  aria-label="ارسال پیام"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {showDetails && active && (
        <aside className="fixed inset-0 z-40 bg-[var(--surface)] md:static md:w-[280px] border-r app-border flex flex-col">
          <div className="p-4 flex items-center gap-2 border-b app-border">
            <button className="min-h-11 min-w-11 rounded-xl border app-border" onClick={() => setShowDetails(false)} aria-label="بستن">
              <X size={17} />
            </button>
            <b>جزئیات گفتگو</b>
          </div>
          <div className="p-4 space-y-3 text-sm app-muted">
            <div className="rounded-2xl border app-border p-3">نوع: {active.type === 'direct' ? 'مستقیم' : active.type === 'company_channel' ? 'کانال شرکت' : active.type === 'shared_company' ? 'مشترک بین شرکت‌ها' : 'گروه'}</div>
            <div className="rounded-2xl border app-border p-3">خوانده‌نشده: {toPersianDigits(active.unread_count)}</div>
            <div className="rounded-2xl border app-border p-3">اعضای آنلاین: {toPersianDigits(onlineCount)}</div>
          </div>
        </aside>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end md:items-center justify-center p-3" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-md rounded-3xl border app-border bg-[var(--surface)] p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              <b>گفتگوی جدید</b>
              <div className="flex-1" />
              <button className="min-h-10 min-w-10 rounded-xl" onClick={() => setShowNew(false)} aria-label="بستن">
                <X size={17} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className={'min-h-11 rounded-xl border app-border ' + (newType === 'group' ? 'bg-[var(--primary)] text-white' : '')}
                onClick={() => setNewType('group')}
              >
                گروه
              </button>
              <button
                className={'min-h-11 rounded-xl border app-border ' + (newType === 'company_channel' ? 'bg-[var(--primary)] text-white' : '')}
                onClick={() => setNewType('company_channel')}
              >
                کانال شرکت
              </button>
            </div>
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="نام گفتگو"
              className="mt-3 w-full min-h-12 rounded-2xl border app-border bg-transparent px-3 outline-none"
            />
            <button onClick={() => void createConversation()} className="mt-3 w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white font-bold">
              ایجاد
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
