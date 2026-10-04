import { supabase } from '../../lib/supabase';
import type { ChatConversation, ChatMessage } from './types';

const unwrap = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('پاسخ سامانه خالی است.');
  return result.data;
};

export async function listConversations(): Promise<ChatConversation[]> {
  const result = await supabase.rpc('chat_conversation_list', { p_limit: 100 });
  return unwrap(result) as ChatConversation[];
}

export async function listMessages(conversationId: string, cursor?: { createdAt: string; id: string }): Promise<ChatMessage[]> {
  const result = await supabase.rpc('chat_list_messages', {
    p_conversation_id: conversationId,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 50,
  });
  const messages = unwrap(result) as ChatMessage[];
  if (!messages.length) return messages;

  const ids = messages.map((m) => m.id);
  const attachments = await supabase
    .from('chat_attachments')
    .select('id,message_id,storage_path,original_name,mime_type,size_bytes,duration_seconds,waveform,security_status,security_checked_at,security_error')
    .in('message_id', ids)
    .is('deleted_at', null);

  if (attachments.error) throw new Error(attachments.error.message);

  const enriched = await Promise.all(
    (attachments.data ?? []).map(async (attachment) => {
      if (attachment.security_status !== 'clean' || !attachment.storage_path || attachment.storage_path.startsWith('quarantine/')) {
        return { ...attachment, url: null };
      }
      const signed = await supabase.storage.from('chat-files').createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, url: signed.data?.signedUrl ?? null };
    }),
  );

  const byMessage = new Map<string, typeof enriched>();
  for (const attachment of enriched) {
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    byMessage.set(attachment.message_id, list);
  }

  return messages.map((message) => ({
    ...message,
    attachments: byMessage.get(message.id) ?? [],
  }));
}

export async function sendMessage(conversationId: string, clientUuid: string, body: string, replyToMessageId?: string | null): Promise<ChatMessage | { queued: true; queueId: string }> {
  const result = await supabase.rpc('chat_insert_message', {
    p_conversation_id: conversationId,
    p_client_uuid: clientUuid,
    p_message_type: 'text',
    p_body: body,
    p_reply_to_message_id: replyToMessageId ?? null,
    p_forwarded_from_message_id: null,
    p_thread_root_message_id: null,
  });
  const queuedResult = result as typeof result & { queued?: boolean; queueId?: string };
  if (queuedResult.queued && queuedResult.queueId) return { queued: true, queueId: queuedResult.queueId };
  return unwrap(result) as ChatMessage;
}

export async function markRead(conversationId: string, messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_read', { p_conversation_id: conversationId, p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function markDelivered(messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_delivered', { p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function createDirectConversation(userId: string): Promise<ChatConversation> {
  const result = await supabase.rpc('chat_create_conversation', {
    p_type: 'direct', p_title: null, p_related_type: null, p_related_id: null,
    p_shared_with_organization_id: null, p_org_connection_id: null, p_direct_user_id: userId,
  });
  return unwrap(result) as ChatConversation;
}

export async function deleteForMe(messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_delete_message_for_me', { p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function deleteForAll(messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_delete_message_for_all', { p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function searchChat(query: string, conversationId?: string) {
  const result = await supabase.rpc('chat_search', { p_query: query, p_conversation_id: conversationId ?? null, p_limit: 30 });
  return unwrap(result) as Array<{kind:string;id:string;conversation_id:string;title:string;snippet:string;created_at:string}>;
}


export async function addConversationMember(conversationId: string, userId: string, role = 'member') {
  const result = await supabase.rpc('chat_add_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_role: role,
  });
  return unwrap(result);
}

export async function createConversation(input: {
  type: 'group' | 'company_channel' | 'related' | 'shared_company';
  title: string;
  relatedType?: string | null;
  relatedId?: string | null;
  sharedWithOrganizationId?: string | null;
  orgConnectionId?: string | null;
}) {
  const result = await supabase.rpc('chat_create_conversation', {
    p_type: input.type,
    p_title: input.title,
    p_related_type: input.relatedType ?? null,
    p_related_id: input.relatedId ?? null,
    p_shared_with_organization_id: input.sharedWithOrganizationId ?? null,
    p_org_connection_id: input.orgConnectionId ?? null,
    p_direct_user_id: null,
  });
  return unwrap(result);
}

export async function sendFileMessage(
  conversationId: string,
  organizationId: string,
  file: File,
  messageType: 'file' | 'voice' = 'file',
): Promise<ChatMessage> {
  const clientUuid = crypto.randomUUID();
  const message = unwrap(await supabase.rpc('chat_insert_message', {
    p_conversation_id: conversationId,
    p_client_uuid: clientUuid,
    p_message_type: messageType,
    p_body: null,
    p_reply_to_message_id: null,
    p_forwarded_from_message_id: null,
    p_thread_root_message_id: null,
  })) as ChatMessage;

  const objectId = crypto.randomUUID();
  const storagePath = `quarantine/${organizationId}/${conversationId}/${objectId}`;

  try {
    const upload = await supabase.storage
      .from('chat-files')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false,
      });

    if (upload.error) throw new Error(upload.error.message);

    const attachment = await supabase.rpc('chat_register_attachment', {
      p_conversation_id: conversationId,
      p_message_id: message.id,
      p_storage_path: storagePath,
      p_original_name: file.name,
      p_mime_type: file.type || 'application/octet-stream',
      p_size_bytes: file.size,
      p_duration_seconds: null,
      p_waveform: null,
      p_thumbnail_path: null,
    });

    if (attachment.error) throw new Error(attachment.error.message);

    return message;
  } catch (error) {
    try { await supabase.storage.from('chat-files').remove([storagePath]); } catch {}
    try { await deleteForAll(message.id); } catch {}
    throw error;
  }
}
