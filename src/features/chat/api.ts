import { supabase } from '../../lib/supabase';
import { makeClientId } from '../../lib/clientId';
import { sendChatRpc } from '../../lib/offlineQueue';
import type { ChatConversation, ChatMessage, ChatMessageReceipt } from './types';
import { mergeChatConversationSources } from './conversationModel';

const unwrap = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('پاسخ سامانه خالی است.');
  return result.data;
};

type SignedAttachmentUrl = { url: string; expiresAt: number };
const signedAttachmentUrlCache = new Map<string, SignedAttachmentUrl>();
const signedAttachmentUrlPending = new Map<string, Promise<string | null>>();
const SIGNED_ATTACHMENT_URL_CACHE_TTL_MS = 50 * 60 * 1000;
const SIGNED_ATTACHMENT_URL_CACHE_LIMIT = 200;

// Signed URLs expire after one hour. Reuse them in this app session for 50 minutes,
// and coalesce concurrent refreshes so every chat re-render does not sign every file again.
async function getSignedAttachmentUrl(storagePath: string, userId: string): Promise<string | null> {
  const cacheKey = userId + ':' + storagePath;
  const now = Date.now();
  const cached = signedAttachmentUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    signedAttachmentUrlCache.delete(cacheKey);
    signedAttachmentUrlCache.set(cacheKey, cached);
    return cached.url;
  }
  if (cached) signedAttachmentUrlCache.delete(cacheKey);

  const pending = signedAttachmentUrlPending.get(cacheKey);
  if (pending) return pending;

  const request = (async (): Promise<string | null> => {
    try {
      const signed = await supabase.storage.from('chat-files').createSignedUrl(storagePath, 3600);
      const url = signed.data?.signedUrl;
      if (signed.error || !url) return null;
      while (signedAttachmentUrlCache.size >= SIGNED_ATTACHMENT_URL_CACHE_LIMIT) {
        const oldest = signedAttachmentUrlCache.keys().next().value;
        if (oldest === undefined) break;
        signedAttachmentUrlCache.delete(oldest);
      }
      signedAttachmentUrlCache.set(cacheKey, {
        url,
        expiresAt: Date.now() + SIGNED_ATTACHMENT_URL_CACHE_TTL_MS,
      });
      return url;
    } catch {
      return null;
    } finally {
      signedAttachmentUrlPending.delete(cacheKey);
    }
  })();
  signedAttachmentUrlPending.set(cacheKey, request);
  return request;
}

export async function listConversations(): Promise<ChatConversation[]> {
  const result = await supabase.rpc('chat_conversation_list', { p_limit: 100 });
  const conversations = unwrap(result) as ChatConversation[];

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return conversations;

  // Keep the hierarchy lookup independent of the ordinary conversation query.
  // Special owner/shipment groups can exist even when the regular list is empty,
  // and must remain valid forwarding destinations in that case.
  let regular = conversations;
  if (conversations.length) {
    const conversationIds = conversations.map((item) => item.conversation_id);
    const members = await supabase
      .from('chat_conversation_members')
      .select('conversation_id,user_id')
      .in('conversation_id', conversationIds)
      .is('deleted_at', null)
      .is('left_at', null)
      .neq('user_id', userId);

    if (!members.error && members.data?.length) {
      const partnerIds = [...new Set(members.data.map((item) => item.user_id))];
      const profiles = await supabase
        .from('profiles')
        .select('id,full_name,phone')
        .in('id', partnerIds)
        .eq('is_active', true);

      if (!profiles.error) {
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

        regular = conversations
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
      }
    }
  }

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

  return mergeChatConversationSources(regular, hierarchyConversations);
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

  const sessionResult = await supabase.auth.getSession();
  const signingUserId = sessionResult.data.session?.user.id ?? null;
  const enrichedAttachments = await Promise.all(
    (attachmentsResult.data ?? []).map(async (attachment) => ({
      ...attachment,
      url: attachment.storage_path && signingUserId
        ? await getSignedAttachmentUrl(attachment.storage_path, signingUserId)
        : null,
    })),
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
    sender_name: message.external_sender_name ?? senderNames.get(message.sender_id ?? '') ?? null,
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

export async function createDirectConversation(userId: string): Promise<ChatConversation & { id: string }> {
  const result = await supabase.rpc('chat_create_conversation', {
    p_type: 'direct',
    p_title: null,
    p_related_type: null,
    p_related_id: null,
    p_shared_with_organization_id: null,
    p_org_connection_id: null,
    p_direct_user_id: userId,
  });
  return unwrap(result) as ChatConversation & { id: string };
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

const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function chatStorageBaseUrl(): string {
  const env = (import.meta as any).env;
  const local = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return (local ? String(env.VITE_SUPABASE_URL || '') : window.location.origin).replace(/\/$/, '');
}

async function uploadChatAttachmentResumable(
  storagePath: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('نشست معتبر نیست؛ دوباره وارد وب‌سایت شوید.');
  const env = (import.meta as any).env;
  const apiKey = String(env.VITE_SUPABASE_ANON_KEY || '');
  if (!apiKey) throw new Error('کلید عمومی ذخیره‌سازی تنظیم نشده است.');
  const baseUrl = chatStorageBaseUrl();
  const endpoint = new URL('/storage/v1/upload/resumable', baseUrl).toString();
  const mime = file.type || 'application/octet-stream';
  const metadata = [
    ['bucketName', 'chat-files'],
    ['objectName', storagePath],
    ['contentType', mime],
    ['cacheControl', '3600'],
  ].map(([key, value]) => key + ' ' + base64Utf8(value)).join(',');
  const create = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      apikey: apiKey,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.size),
      'Upload-Metadata': metadata,
    },
    cache: 'no-store',
  });
  if (create.status !== 201) {
    const detail = (await create.text().catch(() => '')).slice(0, 240);
    throw new Error(('ایجاد آپلود قابل‌ادامه ناموفق بود (' + create.status + ') ' + detail).trim());
  }
  const location = create.headers.get('Location');
  if (!location) throw new Error('سرور نشانی ادامهٔ آپلود را برنگرداند.');
  const uploadUrl = new URL(location, endpoint);
  const configuredBase = new URL(baseUrl);
  if (uploadUrl.pathname.startsWith('/upload/resumable/')) {
    uploadUrl.pathname = '/storage/v1' + uploadUrl.pathname;
  }
  if (!uploadUrl.pathname.startsWith('/storage/v1/upload/resumable/')) {
    throw new Error('مسیر ادامهٔ آپلود از سوی ذخیره‌سازی معتبر نیست.');
  }
  // Keep upload chunks on the same-origin Cloudflare proxy in production.
  uploadUrl.protocol = configuredBase.protocol;
  uploadUrl.host = configuredBase.host;

  const commonHeaders = {
    authorization: 'Bearer ' + token,
    apikey: apiKey,
    'Tus-Resumable': '1.0.0',
  };
  const readOffset = async (): Promise<number> => {
    const response = await fetch(uploadUrl.toString(), { method: 'HEAD', headers: commonHeaders, cache: 'no-store' });
    if (!response.ok) throw new Error('دریافت وضعیت ادامهٔ آپلود ناموفق بود (' + response.status + ').');
    const offset = Number(response.headers.get('Upload-Offset'));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
      throw new Error('وضعیت بایت‌های آپلودشده معتبر نیست.');
    }
    return offset;
  };
  const patchChunk = (offset: number, chunk: Blob): Promise<number> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', uploadUrl.toString(), true);
    xhr.setRequestHeader('authorization', commonHeaders.authorization);
    xhr.setRequestHeader('apikey', commonHeaders.apikey);
    xhr.setRequestHeader('Tus-Resumable', commonHeaders['Tus-Resumable']);
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && file.size > 0) onProgress?.(Math.min(99, ((offset + event.loaded) / file.size) * 100));
    };
    xhr.onerror = () => reject(new Error('ارتباط هنگام ارسال بخشی از فایل قطع شد.'));
    xhr.ontimeout = () => reject(new Error('ارسال بخشی از فایل بیش از حد طول کشید.'));
    xhr.onload = () => {
      if (xhr.status !== 204) {
        reject(new Error('ارسال بخشی از فایل ناموفق بود (' + xhr.status + ').'));
        return;
      }
      const nextOffset = Number(xhr.getResponseHeader('Upload-Offset'));
      resolve(Number.isSafeInteger(nextOffset) && nextOffset >= offset ? nextOffset : offset + chunk.size);
    };
    xhr.send(chunk);
  });

  let offset = 0;
  let retries = 0;
  const retryDelays = [700, 1500, 3000, 5000, 8000];
  onProgress?.(0);
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + TUS_CHUNK_BYTES, file.size));
    try {
      const nextOffset = await patchChunk(offset, chunk);
      if (nextOffset <= offset || nextOffset > file.size) throw new Error('ذخیره‌سازی پیشرفت نامعتبر برگرداند.');
      offset = nextOffset;
      retries = 0;
      onProgress?.(Math.min(99, (offset / file.size) * 100));
    } catch (uploadError) {
      retries += 1;
      if (retries > retryDelays.length) throw uploadError;
      await new Promise((resolve) => setTimeout(resolve, retryDelays[retries - 1]));
      // A failed PATCH may still have reached Storage; HEAD prevents resending accepted bytes.
      offset = await readOffset();
      onProgress?.(Math.min(99, (offset / file.size) * 100));
    }
  }
  onProgress?.(100);
}

async function uploadChatStorageObject(
  storagePath: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const uploadDirect = () => supabase.storage.from('chat-files').upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });

  if (file.size > TUS_THRESHOLD_BYTES) {
    try {
      await uploadChatAttachmentResumable(storagePath, file, onProgress);
      return;
    } catch (resumableError) {
      // The app's same-origin proxy can fail the TUS handshake/Location handoff on
      // mobile browsers even though the regular authenticated Storage upload works.
      // Try the supported SDK upload before failing the message, keeping the same
      // unique object path so attachment registration can proceed normally.
      const resumableMessage = resumableError instanceof Error
        ? resumableError.message
        : String(resumableError);
      let fallback;
      try {
        fallback = await uploadDirect();
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          'آپلود قابل‌ادامه ناموفق بود: ' + resumableMessage +
          '؛ آپلود جایگزین هم ناموفق بود: ' + fallbackMessage,
        );
      }
      if (fallback.error) {
        // A final TUS PATCH may have committed the object before the client lost
        // the response. Accept it only when Storage confirms the exact byte size.
        if (/already exists|duplicate|409/i.test(fallback.error.message)) {
          const info = await supabase.storage.from('chat-files').info(storagePath);
          if (!info.error && Number(info.data?.size) === file.size) {
            onProgress?.(100);
            return;
          }
        }
        throw new Error(
          'آپلود قابل‌ادامه ناموفق بود: ' + resumableMessage +
          '؛ آپلود جایگزین هم ناموفق بود: ' + fallback.error.message,
        );
      }
      onProgress?.(100);
      return;
    }
  }

  const upload = await uploadDirect();
  if (upload.error) throw new Error(upload.error.message);
}

export async function sendFileMessage(
  conversationId: string,
  organizationId: string,
  file: File,
  messageType: 'file' | 'voice' = 'file',
  onProgress?: (percentage: number) => void,
  caption?: string,
): Promise<ChatMessage> {
  const clientUuid = makeClientId();
  const result = await sendChatRpc({
    p_conversation_id: conversationId,
    p_client_uuid: clientUuid,
    p_message_type: messageType,
    p_body: caption?.trim() || null,
    p_reply_to_message_id: null,
    p_forwarded_from_message_id: null,
    p_thread_root_message_id: null,
  }, { durable: false });

  const message = result.data as ChatMessage;

  const objectId = makeClientId();
  const storagePath = `${organizationId}/${conversationId}/${objectId}`;

  try {
    await uploadChatStorageObject(storagePath, file, onProgress);

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
  const forwarded = unwrap(result) as ChatMessage;
  const sourceResult = await supabase
    .from('chat_attachments')
    .select('storage_path,original_name,mime_type,size_bytes,duration_seconds,waveform')
    .eq('message_id', messageId)
    .is('deleted_at', null);
  if (sourceResult.error) {
    try { await deleteForAll(forwarded.id); } catch {}
    throw new Error(sourceResult.error.message);
  }

  const sourceAttachments = sourceResult.data ?? [];
  if (
    (forwarded.message_type === 'file' || forwarded.message_type === 'voice') &&
    sourceAttachments.length === 0
  ) {
    try { await deleteForAll(forwarded.id); } catch {}
    throw new Error('پیوست این پیام پیدا نشد؛ پیام بدون فایل منتقل نشد.');
  }

  const copiedPaths: string[] = [];
  try {
    for (const attachment of sourceAttachments) {
      if (!attachment.storage_path) {
        throw new Error('مسیر فایل اصلی موجود نیست؛ پیام منتقل نشد.');
      }
      const download = await supabase.storage.from('chat-files').download(attachment.storage_path);
      if (download.error || !download.data) {
        throw new Error(download.error?.message || 'پیوست اصلی قابل دریافت نیست.');
      }

      const objectId = makeClientId();
      const storagePath = forwarded.organization_id + '/' + targetConversationId + '/' + objectId;
      const file = new File([download.data], attachment.original_name || 'attachment', {
        type: attachment.mime_type || 'application/octet-stream',
      });
      await uploadChatStorageObject(storagePath, file);
      copiedPaths.push(storagePath);

      const registered = await supabase.rpc('chat_register_attachment', {
        p_conversation_id: targetConversationId,
        p_message_id: forwarded.id,
        p_storage_path: storagePath,
        p_original_name: attachment.original_name || file.name,
        p_mime_type: attachment.mime_type || file.type || 'application/octet-stream',
        p_size_bytes: attachment.size_bytes ?? file.size,
        p_duration_seconds: attachment.duration_seconds ?? null,
        p_waveform: attachment.waveform ?? null,
        p_thumbnail_path: null,
      });
      if (registered.error) throw new Error(registered.error.message);
    }
    return forwarded;
  } catch (error) {
    if (copiedPaths.length) {
      try { await supabase.storage.from('chat-files').remove(copiedPaths); } catch {}
    }
    try { await deleteForAll(forwarded.id); } catch {}
    throw error;
  }
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
