import { supabase } from '../../lib/supabase';
import { makeClientId } from '../../lib/clientId';
import { sendChatRpc } from '../../lib/offlineQueue';
import type { ChatConversation, ChatMessage, ChatMessageReceipt } from './types';

const unwrap = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('پاسخ سامانه خالی است.');
  return result.data;
};

export async function listConversations(): Promise<ChatConversation[]> {
  const result = await supabase.rpc('chat_conversation_list', { p_limit: 100 });
  const conversations = unwrap(result) as ChatConversation[];
  if (!conversations.length) return conversations;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return conversations;

  const conversationIds = conversations.map((item) => item.conversation_id);
  const members = await supabase
    .from('chat_conversation_members')
    .select('conversation_id,user_id')
    .in('conversation_id', conversationIds)
    .is('deleted_at', null)
    .is('left_at', null)
    .neq('user_id', userId);

  if (members.error || !members.data?.length) return conversations;

  const partnerIds = [...new Set(members.data.map((item) => item.user_id))];
  const profiles = await supabase
    .from('profiles')
    .select('id,full_name,phone')
    .in('id', partnerIds)
    .eq('is_active', true);

  if (profiles.error) return conversations;

  const profileMap = new Map((profiles.data ?? []).map((item) => [item.id, item]));
  const partnerMap = new Map<string, { full_name: string; phone: string | null }>();
  const partnerIdMap = new Map<string, string>();

  for (const member of members.data) {
    const person = profileMap.get(member.user_id);
    if (person && !partnerMap.has(member.conversation_id)) {
      partnerMap.set(member.conversation_id, person);
      partnerIdMap.set(member.conversation_id, member.user_id);
    }
  }

  const regular = conversations
    .filter((conversation) => conversation.type !== 'direct' || partnerMap.has(conversation.conversation_id))
    .map((conversation) => {
      const person = conversation.type === 'direct' ? partnerMap.get(conversation.conversation_id) : undefined;
      return person
        ? {
            ...conversation,
            display_name: person.full_name || null,
            display_phone: person.phone,
            display_user_id: partnerIdMap.get(conversation.conversation_id) ?? null,
          }
        : conversation;
    });

  const hierarchy = await listChatHierarchy();
  const hierarchyConversations: ChatConversation[] = hierarchy.map((item) => ({
    conversation_id: item.conversation_id,
    type: item.type,
    title: item.title,
    updated_at: item.updated_at,
    last_message_id: item.last_message_id,
    last_message_body: item.last_message_body,
    last_message_created_at: item.last_message_created_at,
    unread_count: item.unread_count,
    muted_until: item.muted_until,
    hierarchy_kind: item.hierarchy_kind,
    parent_conversation_id: item.parent_conversation_id,
    cargo_owner_id: item.cargo_owner_id,
    shipment_id: item.shipment_id,
    shipment_display_name: item.shipment_display_name,
    shipment_bl_number: item.shipment_bl_number,
    shipment_status: item.shipment_status,
  }));

  return [...regular, ...hierarchyConversations].sort((a, b) => {
    if ((a.hierarchy_kind === 'owner_group') !== (b.hierarchy_kind === 'owner_group')) {
      return a.hierarchy_kind === 'owner_group' ? -1 : 1;
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

async function enrichMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  if (!messages.length) return messages;

  const senderIds = [...new Set(messages.map((m) => m.sender_id).filter(Boolean))];
  const senderProfiles = senderIds.length
    ? await supabase.from('profiles').select('id,full_name').in('id', senderIds)
    : { data: [], error: null };
  const senderNames = new Map((senderProfiles.data ?? []).map((item) => [item.id, item.full_name]));

  const ids = messages.map((m) => m.id);
  const [attachmentsResult, reactionsResult, pinsResult, starsResult, receiptsResult] = await Promise.all([
    supabase
      .from('chat_attachments')
      .select(
        'id,message_id,storage_path,original_name,mime_type,size_bytes,duration_seconds,waveform,security_status,security_checked_at,security_error',
      )
      .in('message_id', ids)
      .is('deleted_at', null),
    supabase
      .from('chat_message_reactions')
      .select('id,message_id,user_id,emoji,created_at')
      .in('message_id', ids),
    supabase.from('chat_message_pins').select('message_id').in('message_id', ids),
    supabase
      .from('chat_message_user_states')
      .select('message_id,starred_at,deleted_at')
      .in('message_id', ids)
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? ''),
    supabase
      .from('chat_message_receipts')
      .select('message_id,user_id,status,delivered_at,read_at,played_at')
      .in('message_id', ids),
  ]);

  if (attachmentsResult.error) throw new Error(attachmentsResult.error.message);
  if (reactionsResult.error) throw new Error(reactionsResult.error.message);
  if (pinsResult.error) throw new Error(pinsResult.error.message);
  if (starsResult.error) throw new Error(starsResult.error.message);
  if (receiptsResult.error) throw new Error(receiptsResult.error.message);

  const enrichedAttachments = await Promise.all(
    (attachmentsResult.data ?? []).map(async (attachment) => {
      if (
        attachment.security_status !== 'clean' ||
        !attachment.storage_path ||
        attachment.storage_path.startsWith('quarantine/')
      ) {
        return { ...attachment, url: null };
      }

      const signed = await supabase.storage.from('chat-files').createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, url: signed.data?.signedUrl ?? null };
    }),
  );

  const byMessage = new Map<string, ChatMessage['attachments']>();
  for (const attachment of enrichedAttachments) {
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    byMessage.set(attachment.message_id, list);
  }

  const reactionMap = new Map<string, ChatMessage['reactions']>();
  for (const reaction of reactionsResult.data ?? []) {
    const list = reactionMap.get(reaction.message_id) ?? [];
    list.push(reaction);
    reactionMap.set(reaction.message_id, list);
  }

  const pinnedIds = new Set((pinsResult.data ?? []).map((item) => item.message_id));
  const starredIds = new Set(
    (starsResult.data ?? [])
      .filter((item) => item.starred_at !== null && item.deleted_at === null)
      .map((item) => item.message_id),
  );

  const receiptMap = new Map<string, ChatMessageReceipt[]>();
  for (const receipt of receiptsResult.data ?? []) {
    const list = receiptMap.get(receipt.message_id) ?? [];
    list.push(receipt);
    receiptMap.set(receipt.message_id, list);
  }

  return messages.map((message) => ({
    ...message,
    sender_name: senderNames.get(message.sender_id) ?? null,
    attachments: byMessage.get(message.id) ?? [],
    reactions: reactionMap.get(message.id) ?? [],
    pinned: pinnedIds.has(message.id),
    starred: starredIds.has(message.id),
    receipts: receiptMap.get(message.id) ?? [],
  }));
}

export async function listMessages(
  conversationId: string,
  cursor?: { createdAt: string; id: string },
): Promise<ChatMessage[]> {
  const result = await supabase.rpc('chat_list_messages', {
    p_conversation_id: conversationId,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 50,
  });
  return enrichMessages(unwrap(result) as ChatMessage[]);
}

export async function listMessagesAfter(
  conversationId: string,
  cursor: { createdAt: string; id: string },
): Promise<ChatMessage[]> {
  const result = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .or(
      `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100);

  if (result.error) throw new Error(result.error.message);
  return enrichMessages((result.data ?? []) as ChatMessage[]);
}

export async function listMessageReceipts(messageIds: string[]): Promise<ChatMessageReceipt[]> {
  if (!messageIds.length) return [];
  const result = await supabase
    .from('chat_message_receipts')
    .select('message_id,user_id,status,delivered_at,read_at,played_at')
    .in('message_id', messageIds);
  if (result.error) throw new Error(result.error.message);
  return result.data as ChatMessageReceipt[];
}

export async function getMessageById(messageId: string): Promise<ChatMessage | null> {
  const result = await supabase.from('chat_messages').select('*').eq('id', messageId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) return null;
  const messages = await enrichMessages([result.data as ChatMessage]);
  return messages[0] ?? null;
}

export async function sendMessage(
  conversationId: string,
  clientUuid: string,
  body: string,
  replyToMessageId?: string | null,
): Promise<ChatMessage | { queued: true; queueId: string }> {
  const result = await sendChatRpc({
    p_conversation_id: conversationId,
    p_client_uuid: clientUuid,
    p_message_type: 'text',
    p_body: body,
    p_reply_to_message_id: replyToMessageId ?? null,
    p_forwarded_from_message_id: null,
    p_thread_root_message_id: null,
  });

  if (result.queued) return { queued: true, queueId: result.queueId };
  return result.data as ChatMessage;
}

export async function setMessageMentions(messageId: string, userIds: string[]): Promise<number> {
  const result = await supabase.rpc('chat_set_message_mentions', {
    p_message_id: messageId,
    p_user_ids: userIds,
  });
  return unwrap(result) as number;
}

export async function markRead(conversationId: string, messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_read', {
    p_conversation_id: conversationId,
    p_message_id: messageId,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function markDelivered(messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_delivered', { p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function markPlayed(messageId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_played', { p_message_id: messageId });
  if (result.error) throw new Error(result.error.message);
}

export async function markChatFocus(conversationId: string): Promise<void> {
  const result = await supabase.rpc('chat_mark_focus', { p_conversation_id: conversationId });
  if (result.error) throw new Error(result.error.message);
}

export async function clearChatFocus(): Promise<void> {
  const result = await supabase.rpc('chat_clear_focus');
  if (result.error) throw new Error(result.error.message);
}

export async function createDirectConversation(userId: string): Promise<ChatConversation> {
  const result = await supabase.rpc('chat_create_conversation', {
    p_type: 'direct',
    p_title: null,
    p_related_type: null,
    p_related_id: null,
    p_shared_with_organization_id: null,
    p_org_connection_id: null,
    p_direct_user_id: userId,
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
  const result = await supabase.rpc('chat_search', {
    p_query: query,
    p_conversation_id: conversationId ?? null,
    p_limit: 30,
  });
  return unwrap(result) as Array<{
    kind: string;
    id: string;
    conversation_id: string;
    title: string;
    snippet: string;
    created_at: string;
  }>;
}

export type OrgConnection = {
  id: string;
  source_organization_id: string;
  target_organization_id: string;
  relationship_type: string;
  status: string;
  requested_by: string;
  accepted_by: string | null;
  created_at: string;
  updated_at: string;
  source_name: string;
  target_name: string;
};

export async function listOrgConnections(): Promise<OrgConnection[]> {
  const result = await supabase.rpc('chat_list_org_connections');
  return unwrap(result) as OrgConnection[];
}

export async function createOrgConnection(targetOrganizationId: string, relationshipType = 'business_partner') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ابتدا وارد سیستم شوید.');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;
  const result = await supabase
    .from('org_connections')
    .insert({
      source_organization_id: profile.organization_id,
      target_organization_id: targetOrganizationId,
      relationship_type: relationshipType,
      status: 'pending',
      requested_by: user.id,
    })
    .select('*')
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function acceptOrgConnection(connectionId: string) {
  const result = await supabase
    .from('org_connections')
    .update({
      status: 'accepted',
      accepted_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .eq('id', connectionId)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function cancelOrgConnection(connectionId: string) {
  const result = await supabase
    .from('org_connections')
    .update({ status: 'cancelled' })
    .eq('id', connectionId)
    .select('*')
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
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
  const clientUuid = makeClientId();
  const result = await sendChatRpc({
    p_conversation_id: conversationId,
    p_client_uuid: clientUuid,
    p_message_type: messageType,
    p_body: null,
    p_reply_to_message_id: null,
    p_forwarded_from_message_id: null,
    p_thread_root_message_id: null,
  }, { durable: false });

  const message = result.data as ChatMessage;

  const objectId = makeClientId();
  const storagePath = `quarantine/${organizationId}/${conversationId}/${objectId}`;

  try {
    const upload = await supabase.storage.from('chat-files').upload(storagePath, file, {
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
    try {
      await supabase.storage.from('chat-files').remove([storagePath]);
    } catch {}
    try {
      await deleteForAll(message.id);
    } catch {}
    throw error;
  }
}

export type ChatHierarchyItem = {
  conversation_id: string;
  type: string;
  title: string | null;
  updated_at: string;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_created_at: string | null;
  unread_count: number;
  muted_until: string | null;
  hierarchy_kind: 'regular' | 'owner_group' | 'shipment_group';
  parent_conversation_id: string | null;
  cargo_owner_id: string | null;
  shipment_id: string | null;
  shipment_display_name: string | null;
  shipment_bl_number: string | null;
  shipment_status: string | null;
};

export async function listChatHierarchy(): Promise<ChatHierarchyItem[]> {
  const result = await supabase.rpc('chat_hierarchy_list', { p_limit: 200 });
  return unwrap(result) as ChatHierarchyItem[];
}

export async function editChatMessage(messageId: string, body: string): Promise<ChatMessage> {
  const result = await supabase.rpc('chat_edit_message', {
    p_message_id: messageId,
    p_body: body,
  });
  return unwrap(result) as ChatMessage;
}

export async function forwardChatMessage(
  messageId: string,
  targetConversationId: string,
): Promise<ChatMessage> {
  const result = await supabase.rpc('chat_forward_message', {
    p_message_id: messageId,
    p_target_conversation_id: targetConversationId,
    p_client_uuid: makeClientId(),
  });
  return unwrap(result) as ChatMessage;
}

export async function shareShipmentUpdate(
  conversationId: string,
  shipmentId: string,
  status: string,
  note?: string,
): Promise<ChatMessage> {
  const result = await supabase.rpc('chat_share_shipment_update', {
    p_conversation_id: conversationId,
    p_shipment_id: shipmentId,
    p_status: status,
    p_note: note ?? null,
  });
  return unwrap(result) as ChatMessage;
}

export async function toggleChatReaction(messageId: string, emoji: string): Promise<boolean> {
  const result = await supabase.rpc('chat_toggle_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  return unwrap(result) as boolean;
}

export async function toggleChatPin(messageId: string): Promise<boolean> {
  const result = await supabase.rpc('chat_toggle_pin', {
    p_message_id: messageId,
  });
  return unwrap(result) as boolean;
}

export async function toggleChatStar(messageId: string): Promise<boolean> {
  const result = await supabase.rpc('chat_toggle_star', {
    p_message_id: messageId,
  });
  return unwrap(result) as boolean;
}
