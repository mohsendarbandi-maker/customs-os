import type { RealtimeChannel } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import { supabase } from '../../lib/supabase';
import { rpcWithOfflineQueue } from '../../lib/offlineQueue';
import type { ChatAttachment, ChatConversation, ChatMember, ChatMessage, ChatSearchResult } from './types';

export const chatApi = {
  async conversations(): Promise<ChatConversation[]> {
    const { data, error } = await supabase.rpc('chat_conversation_list', { p_limit: 100 });
    if (error) throw error;
    return (data ?? []) as ChatConversation[];
  },

  async members(conversationId: string): Promise<ChatMember[]> {
    const { data, error } = await supabase
      .from('chat_conversation_members')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ChatMember[];
  },

  async messages(conversationId: string, cursor?: { createdAt: string; id: string }): Promise<ChatMessage[]> {
    const { data, error } = await supabase.rpc('chat_list_messages', {
      p_conversation_id: conversationId,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 50,
    });
    if (error) throw error;
    return ((data ?? []) as ChatMessage[]).reverse();
  },

  async firstUnread(conversationId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('chat_first_unread', { p_conversation_id: conversationId });
    if (error) throw error;
    return (data as string | null) ?? null;
  },

  async sendMessage(input: {
    conversationId: string;
    clientUuid: string;
    messageType: 'text' | 'system' | 'file' | 'voice';
    body?: string | null;
    replyToMessageId?: string | null;
    forwardedFromMessageId?: string | null;
    threadRootMessageId?: string | null;
  }): Promise<{ data: ChatMessage | null; error: unknown; queued: boolean; queueId?: string }> {
    const result = await rpcWithOfflineQueue(
      'chat_insert_message',
      {
        p_conversation_id: input.conversationId,
        p_client_uuid: input.clientUuid,
        p_message_type: input.messageType,
        p_body: input.body ?? null,
        p_reply_to_message_id: input.replyToMessageId ?? null,
        p_forwarded_from_message_id: input.forwardedFromMessageId ?? null,
        p_thread_root_message_id: input.threadRootMessageId ?? null,
      },
      { queueWhenOffline: true },
    );
    return {
      data: result.data as ChatMessage | null,
      error: result.error,
      queued: result.queued,
      queueId: result.queueId,
    };
  },

  async markRead(conversationId: string, messageId: string): Promise<void> {
    const { error } = await supabase.rpc('chat_mark_read', {
      p_conversation_id: conversationId,
      p_message_id: messageId,
    });
    if (error) throw error;
  },

  async markDelivered(messageId: string): Promise<void> {
    const { error } = await supabase.rpc('chat_mark_delivered', { p_message_id: messageId });
    if (error) throw error;
  },

  async deleteForMe(messageId: string): Promise<void> {
    const { error } = await supabase.rpc('chat_delete_message_for_me', { p_message_id: messageId });
    if (error) throw error;
  },

  async deleteForAll(messageId: string): Promise<void> {
    const { error } = await supabase.rpc('chat_delete_message_for_all', { p_message_id: messageId });
    if (error) throw error;
  },

  async star(messageId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('chat_toggle_star', { p_message_id: messageId });
    if (error) throw error;
    return Boolean(data);
  },

  async react(messageId: string, emoji: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('chat_toggle_reaction', {
      p_message_id: messageId,
      p_emoji: emoji,
    });
    if (error) throw error;
    return Boolean(data);
  },

  async pin(messageId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('chat_toggle_pin', { p_message_id: messageId });
    if (error) throw error;
    return Boolean(data);
  },

  async search(query: string, conversationId?: string): Promise<ChatSearchResult[]> {
    const { data, error } = await supabase.rpc('chat_search', {
      p_query: query,
      p_conversation_id: conversationId ?? null,
      p_limit: 30,
    });
    if (error) throw error;
    return (data ?? []) as ChatSearchResult[];
  },

  async createConversation(input: {
    type: 'direct' | 'group' | 'company_channel' | 'related' | 'shared_company';
    title?: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
    sharedWithOrganizationId?: string | null;
    orgConnectionId?: string | null;
    directUserId?: string | null;
  }): Promise<ChatConversation> {
    const { data, error } = await supabase.rpc('chat_create_conversation', {
      p_type: input.type,
      p_title: input.title ?? null,
      p_related_type: input.relatedType ?? null,
      p_related_id: input.relatedId ?? null,
      p_shared_with_organization_id: input.sharedWithOrganizationId ?? null,
      p_org_connection_id: input.orgConnectionId ?? null,
      p_direct_user_id: input.directUserId ?? null,
    });
    if (error) throw error;
    return data as unknown as ChatConversation;
  },

  async addMember(
    conversationId: string,
    userId: string,
    role: 'admin' | 'member' | 'guest' = 'member',
  ): Promise<ChatMember> {
    const { data, error } = await supabase.rpc('chat_add_member', {
      p_conversation_id: conversationId,
      p_user_id: userId,
      p_role: role,
    });
    if (error) throw error;
    return data as unknown as ChatMember;
  },

  async registerAttachment(input: {
    conversationId: string;
    messageId: string;
    storagePath: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    durationSeconds?: number | null;
    waveform?: number[] | null;
    thumbnailPath?: string | null;
  }): Promise<ChatAttachment> {
    const { data, error } = await supabase.rpc('chat_register_attachment', {
      p_conversation_id: input.conversationId,
      p_message_id: input.messageId,
      p_storage_path: input.storagePath,
      p_original_name: input.originalName,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_duration_seconds: input.durationSeconds ?? null,
      p_waveform: input.waveform ?? null,
      p_thumbnail_path: input.thumbnailPath ?? null,
    });
    if (error) throw error;
    return data as unknown as ChatAttachment;
  },

  async attachments(messageIds: string[]): Promise<ChatAttachment[]> {
    if (!messageIds.length) return [];
    const { data, error } = await supabase
      .from('chat_attachments')
      .select('*')
      .in('message_id', messageIds)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []) as ChatAttachment[];
  },

  async signedUrl(path: string, expiresIn = 120): Promise<string> {
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },

  async focus(conversationId: string | null): Promise<void> {
    const { error } = conversationId
      ? await supabase.rpc('chat_mark_focus', { p_conversation_id: conversationId })
      : await supabase.rpc('chat_clear_focus');
    if (error) throw error;
  },
};

export type UploadHandle = {
  promise: Promise<string>;
  cancel: () => void;
  storagePath: string;
};

const projectUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '');
const projectId = projectUrl.match(/^https:\/\/([^.]+)\./)?.[1] ?? '';

export function uploadChatFile(
  file: File,
  organizationId: string,
  conversationId: string,
  onProgress: (percent: number) => void,
): UploadHandle {
  const storagePath = 'quarantine/' + organizationId + '/' + conversationId + '/' + crypto.randomUUID();
  let cancelUpload: () => void = () => undefined;

  const promise = (async (): Promise<string> => {
    if (file.size <= 6 * 1024 * 1024) {
      const { error } = await supabase.storage.from('chat-files').upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (error) throw error;
      onProgress(100);
      return storagePath;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token || !projectId) throw new Error('جلسه یا نشانی ذخیره‌سازی در دسترس نیست.');

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: 'https://' + projectId + '.storage.supabase.co/storage/v1/upload/resumable',
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: 'Bearer ' + token,
          'x-upsert': 'false',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: 'chat-files',
          objectName: storagePath,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        onError(error) {
          reject(error);
        },
        onProgress(bytesUploaded, bytesTotal) {
          if (bytesTotal > 0) onProgress(Math.round((bytesUploaded / bytesTotal) * 100));
        },
        onSuccess() {
          resolve();
        },
      });

      cancelUpload = () => {
        void upload.abort(true);
        reject(new Error('آپلود لغو شد.'));
      };

      void upload.findPreviousUploads()
        .then((previous) => {
          if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(reject);
    });

    return storagePath;
  })();

  return { promise, cancel: () => cancelUpload(), storagePath };
}

const realtimeChannels = new Map<string, RealtimeChannel>();

export function subscribeToConversation(
  conversationId: string,
  userId: string,
  callbacks: {
    onMessage: (payload: unknown) => void;
    onTyping: (payload: unknown) => void;
    onPresence: (state: Record<string, unknown[]>) => void;
  },
): () => void {
  const existing = realtimeChannels.get(conversationId);
  if (existing) void supabase.removeChannel(existing);

  const channel = supabase.channel('chat:' + conversationId, {
    config: { presence: { key: userId } },
  });
  realtimeChannels.set(conversationId, channel);

  channel
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
        filter: 'conversation_id=eq.' + conversationId,
      },
      callbacks.onMessage,
    )
    .on('broadcast', { event: 'typing' }, (payload) => callbacks.onTyping(payload.payload))
    .on('presence', { event: 'sync' }, () => {
      callbacks.onPresence(channel.presenceState() as Record<string, unknown[]>);
    });

  void channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ userId, online: true });
    }
  });

  return () => {
    realtimeChannels.delete(conversationId);
    void channel.untrack();
    void supabase.removeChannel(channel);
  };
}

export async function broadcastTyping(
  conversationId: string,
  userId: string,
  typing: boolean,
): Promise<void> {
  const channel = realtimeChannels.get(conversationId);
  if (!channel) return;
  await channel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { userId, typing },
  });
}
